/**
 * 淘宝 / 天猫 商品发布 — host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP：
 *   1. 发布的核心动作是**图片文件上传（multipart 二进制）**，而网关 handleProxy
 *      只支持字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
 *   2. 卖家中心发布页的类目属性与提交接口都要求页面 JS 运行时生成的 `sign` 签名
 *      与真实会话票据，纯 HTTP 复刻不可行。
 *   3. 开放平台 TOP 的 alibaba.item.publish.* 只对**天猫/企业店的自研应用**开放，
 *      集市店无法申请，因此只能驱动网页版发布页。
 *
 * 页面与控件锚点来源（真实实测，非推测）：
 *   本机影刀（ShadowBot）工程 xbot_robot/selectorsV2.xml（明文），app「noco传宝贝」：
 *   - 淘宝组 criteria="https://item.upload.taobao.com"
 *   - 天猫组 criteria="https://sell.publish.tmall.com"
 *   关键锚点：
 *     - 提交按钮：  button[_id="button-submit"]（#float-bottom.sell-float-bottom > #struct-buttons.com-struct）
 *     - 主图区：    #struct-mainImagesGroup（空态 .image-empty / .dashed.main-content.medium.oo）
 *     - 主图弹窗：  .next-overlay-wrapper.opened.v2 > #images-v2-media-popup-content
 *                   > .media-wrap > .media-img-plug > iframe#mainImagesGroup（sucai-selector-ng）
 *     - 风控滑块：  iframe#baxia-dialog-content（src 含 /_____tmd_____/punish）→ #nc_1_n1z
 *
 * ★ 字段策略（与用户确认）：**通用字段 + 类目属性自动填，其余人工兜底**
 *   自动填：主图、标题、一口价、库存、货号（天猫）、类目属性（文本模型从真实候选中挑值）、
 *           物流「提取方式」（勾「使用物流配送」）
 *   人工兜底：品牌（授权风险）、商品详情、发货/售后设置 —— 由用户在可见浏览器
 *             窗口内补全，若提交被校验拦住，工具会继续等待并识别用户手动提交的结果。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { applyStealth } from './stealth-inject.js'
import { type AttrModelHandle } from './pdd-publish.js'
import { loadPublishConfig, anchorSpec, configString, configTimeout, type PublishConfig } from './services/publish-config-loader.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile, registerProfilePort, registeredPortFor, verifyPortOwnership, sleep, UI_STEP_DELAY_MS } from './browser-login.js'
import { schemaFingerprint } from './services/attr-cache.js'
import { createCategoryProfileStore, type CategoryProfile, type CategoryProfileStore } from './services/category-profile.js'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildTaobaoJsonDocument, buildTaobaoJsonReplayInitScript } from './taobao-publish-replay.js'
import { localImagesToSpaceUrls, checkLoginCookies } from './taobao-image-space.js'
import { installCommitPatcher, type CommitPatchResult } from './taobao-commit-patch.js'

/** 发布入口（按渠道）。淘宝先落在「选类目」页，选完类目才进正式表单；天猫同理。
 *  URL 初值 = 历史硬编码兜底，refreshTaobaoConfig() 用 publish-config/taobao.json
 *  urls.taobaoPublish / urls.taobaoCategory / urls.tmallPublish 覆盖。 */
const CHANNELS: Record<string, { label: string; url: string; categoryUrl?: string }> = {
  taobao: {
    label: '淘宝',
    url: 'https://item.upload.taobao.com/sell/publish.htm',
    // ★ 实测（2026-09）：sell/publish.htm 现已直接跳到 v2/publish.htm?null（「类目为空」报错页），
    //   真正的「选类目」页是下面这个，类目搜索框只在此页存在。
    categoryUrl: 'https://item.upload.taobao.com/sell/ai/category.htm?force=true',
  },
  tmall: { label: '天猫', url: 'https://sell.publish.tmall.com/tmall/submit.htm' },
}

/** 发布表单就绪标志（主图区或提交按钮出现）（anchors.formReady） */
let FORM_READY_SELECTOR = '#struct-mainImagesGroup, button[name="button-submit"]'

/** 等表单就绪（中间可能夹着用户手动选类目）（timeouts.formWaitMs） */
let FORM_WAIT_MS = 150_000
/** 点提交后等结果（含用户手动补全字段后自行提交的时间）（timeouts.publishTimeoutMs） */
let PUBLISH_TIMEOUT_MS = 180_000
/** 图片上传等待（timeouts.uploadWaitMs） */
let UPLOAD_WAIT_MS = 90_000
/** 单张主图上限：新版素材选择器实测 maxUpload=20MB / maxSize=20971520（limits.maxImageBytes） */
let MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 主图张数上限（淘宝/天猫 5 张，超出以页面提示为准）（limits.maxImages） */
let MAX_IMAGES = 5
/** 标题长度上限（淘宝/天猫均为 60 字符）（limits.maxTitleLen） */
let MAX_TITLE_LEN = 60

/**
 * 类目属性自动选值：用宿主聊天模型（ctx.model，由 tools-publish.ts 从当前会话路由装配），
 * 只让模型从**页面真实候选**里挑一个，绝不凭空造值；模型不可用/挑不出就跳过，只记 missed，不阻断发布。
 */
/** 单次属性选值请求超时：模型不可用要快速跳过，不能拖垮发布流程（timeouts.attrModelTimeoutMs） */
let ATTR_MODEL_TIMEOUT_MS = 20_000
/** 展开下拉 / 选值后的等待（next 组件有展开动画与异步选项）（timeouts.attrDropdownWaitMs） */
let ATTR_DROPDOWN_WAIT_MS = 800
/** 不自动填的类目属性：品牌涉及品牌授权，选错有侵权风险，一律留给人工（regexes.attrSkip） */
let ATTR_SKIP_RE = /^品牌$/

/**
 * 类目档案库（g5）—— 按平台 + catId 精确匹配的长期发布配置档案。
 * ★ 落盘 ~/.dsh/publish-profiles/（运行时数据目录）：不进源码库，
 *   也不受 sync-to-host 的 cpSync force 单向覆盖影响（放 publish-config/ 会被覆盖掉）。
 */
const profileStore: CategoryProfileStore = createCategoryProfileStore(
  join(homedir(), '.dsh', 'publish-profiles')
)

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '淘宝发布'

/** 销售属性（规格）默认属性 ID：类目「AI软件订阅/Token充值」下颜色分类为 1627207（实测）（salePropDefaults.propId） */
let SALE_PROP_ID = '1627207'
/** 销售属性输入框占位符（实测为「主色(必选)」，用前缀匹配更稳）（regexes.salePropPlaceholder） */
let SALE_PROP_PLACEHOLDER_RE = /主色|颜色分类|规格值/
/** SKU 表每个格子填完后的等待（React 归一化 + 重渲染）（timeouts.skuCellWaitMs） */
let SKU_CELL_WAIT_MS = 500
/* ══════════════════════════════════════════════════════════════════
 * JSON 配置驱动（PUBLISH-SPEC §3）：上面所有 let 常量的初值 = 历史硬编码
 * 兜底，refreshTaobaoConfig() 在每次发布入口处用 publish-config/taobao.json
 * 覆盖它们 —— **改 JSON 一行无需重启宿主**（loader 带 mtime 缓存热加载）。
 * ★ 行为零变化纪律：本步只替换「字符串常量来源」，不改任何执行逻辑；
 *   evaluate 内联选择器（类目搜索框/品牌面板/主图区/SKU 表/详情编辑器）本步不动。
 * ══════════════════════════════════════════════════════════════════ */

/** 当前生效的 taobao.json 配置（refreshTaobaoConfig 维护） */
let TAOBAO_CFG: PublishConfig | null = null

/** submitButton 的候选（clickSubmit 消费；初值 = 历史硬编码兜底）：
 *  selN 为第 N 个 CSS 候选；matchTextRe 为文案兜底正则源（候选 `text:` 前缀以外的文本回退）。 */
let SUBMIT_BTN_SEL1 = 'button[name="button-submit"]'
let SUBMIT_BTN_SEL2 = 'button[_id="button-submit"]'
let SUBMIT_TEXT_RE_SRC = '^(提交宝贝信息|提交|确认提交|发布)$'

/** 多候选锚点归一为 CSS 逗号列表（候选全是 CSS 才可用；XPath 锚点本步不在此消费） */
function anchorCssList(cfg: PublishConfig, key: string): string {
  return anchorSpec(cfg, key).candidates.map(c => c.selector).join(', ')
}

/**
 * 从 publish-config/taobao.json 刷新全部配置常量。
 * - loader fail-fast（缺配置 throw），这里捕获后返回错误信息，
 *   由调用方决定返回 `{ok:false}` —— 配置坏宁可发布失败，也不静默用旧锚点。
 * - 未曾成功加载过时（TAOBAO_CFG === null）保持硬编码初值，行为与改造前一致。
 * @returns null=成功；string=错误信息
 */
function refreshTaobaoConfig(): string | null {
  let cfg: PublishConfig
  try {
    cfg = loadPublishConfig('taobao')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return TAOBAO_CFG ? `发布配置刷新失败（沿用上次加载的配置）：${msg}` : `发布配置加载失败：${msg}`
  }
  TAOBAO_CFG = cfg
  try {
    const L = cfg.limits
    if (L.maxImageBytes > 0) MAX_IMAGE_BYTES = L.maxImageBytes
    if (L.maxImages > 0) MAX_IMAGES = L.maxImages
    if (L.maxTitleLen && L.maxTitleLen > 0) MAX_TITLE_LEN = L.maxTitleLen

    // 渠道入口 URL（CHANNELS 是 const 对象，按字段覆写值，结构不变）
    const u1 = configString(cfg, 'urls', 'taobaoPublish')
    if (u1) CHANNELS.taobao.url = u1
    const u2 = configString(cfg, 'urls', 'taobaoCategory')
    if (u2) CHANNELS.taobao.categoryUrl = u2
    const u3 = configString(cfg, 'urls', 'tmallPublish')
    if (u3) CHANNELS.tmall.url = u3

    const rSkip = cfg.regexes?.attrSkip
    if (rSkip) ATTR_SKIP_RE = new RegExp(rSkip)
    const rProp = cfg.regexes?.salePropPlaceholder
    if (rProp) SALE_PROP_PLACEHOLDER_RE = new RegExp(rProp)

    FORM_WAIT_MS = configTimeout(cfg, 'formWaitMs', FORM_WAIT_MS)
    PUBLISH_TIMEOUT_MS = configTimeout(cfg, 'publishTimeoutMs', PUBLISH_TIMEOUT_MS)
    UPLOAD_WAIT_MS = configTimeout(cfg, 'uploadWaitMs', UPLOAD_WAIT_MS)
    SKU_CELL_WAIT_MS = configTimeout(cfg, 'skuCellWaitMs', SKU_CELL_WAIT_MS)
    ATTR_MODEL_TIMEOUT_MS = configTimeout(cfg, 'attrModelTimeoutMs', ATTR_MODEL_TIMEOUT_MS)
    ATTR_DROPDOWN_WAIT_MS = configTimeout(cfg, 'attrDropdownWaitMs', ATTR_DROPDOWN_WAIT_MS)

    // 锚点：多候选 join 成 CSS 列表（与原硬编码字符串形态一致，使用点零改动）
    const formReady = anchorCssList(cfg, 'formReady')
    if (formReady) FORM_READY_SELECTOR = formReady

    // salePropDefaults.propId（自定义段，schema 为 { propId, comment }）
    const pd = cfg['salePropDefaults'] as { propId?: string } | undefined
    if (pd && typeof pd.propId === 'string' && pd.propId) SALE_PROP_ID = pd.propId

    // submitButton：逐候选映射（clickSubmit 消费；matchTextRe 为文案兜底正则源）
    const submitSpec = anchorSpec(cfg, 'submitButton')
    const sels = submitSpec.candidates.filter(c => !c.selector.startsWith('text:')).map(c => c.selector)
    if (sels.length >= 1) SUBMIT_BTN_SEL1 = sels[0]
    if (sels.length >= 2) SUBMIT_BTN_SEL2 = sels[1]
    if (submitSpec.matchTextRe) SUBMIT_TEXT_RE_SRC = submitSpec.matchTextRe
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `发布配置字段缺失/非法（沿用当前值）：${msg}`
  }
  return null
}

/**
 * 多规格（销售属性 / SKU）入参。
 *
 * ★ 设计对齐 pdd-publish.ts 的 PddSkuInput，但**语义按淘宝销售属性的实际结构**：
 *   淘宝每个 SKU = 一行，由「颜色分类」等销售属性值区分；故本参数一项 = 一个规格值 = SKU 表一行。
 */
export interface TaobaoSkuInput {
  /** 规格值名（如「红色」）。会成为 SKU 表的一行 */
  name: string
  /** 该规格值的一口价（元，字符串数字，选填）。不填则继承商品一口价 */
  price?: string
  /** 该规格值的库存（件，字符串数字，选填）。不填则填 0，由总库存/人工兜底 */
  stock?: string
  /** 该规格值的商家编码 / 货号（选填） */
  outerId?: string
}

export interface TaobaoPublishOptions {
  /** 本地图片绝对路径列表（至少 1 张，最多 5 张） */
  images: string[]
  /**
   * 详情图本地绝对路径列表（选填，多张）。复刻觅千手：发布页内直传到详情编辑器，
   * 框架把 URL 收进 formValues.wirelessDesc / descRepublicOfSell，随 Json state 提交。
   */
  detailImages?: string[]
  /**
   * 主图 URL 列表（COS/外链）。传入后主图走 replay URL 注入，跳过 DOM 文件上传（复刻觅千手搬品）。
   */
  imageUrls?: string[]
  /**
   * 详情图 URL 列表（COS/外链）。传入后详情图走 replay URL 注入（wirelessDesc/descRepublicOfSell），
   * 跳过详情编辑器 DOM 上传。
   */
  detailImageUrls?: string[]
  /** 商品标题（必填，≤ 60 字符） */
  title: string
  /** 渠道：taobao（默认）/ tmall */
  channel?: string
  /** 一口价（元，字符串数字，选填） */
  price?: string
  /** 库存（件，字符串数字，选填） */
  stock?: string
  /** 货号（选填，天猫发布页有独立输入框） */
  itemNo?: string
  /**
   * 多规格（销售属性）列表（选填）。传了则自动添加销售属性值并回填 SKU 表的
   * 价格 / 数量 / 商家编码；不传则沿用单 SKU（页面默认）。
   */
  skus?: TaobaoSkuInput[]
  /**
   * 选类目关键词（选填）。发布入口会先落在「选类目」页，传了本参数则自动在搜索框输入
   * 该关键词，候选按与商品标题的相关性降序尝试（叶子类目名与标题的字词重叠），
   * 挑第一个能让「确认，下一步」可用的类目；不传则需人工选类目。
   * ★ 应传具体叶子类目词（如「儿童睡衣」），不要传一级大类名（如「童装」）或整段标题。
   */
  categoryKeyword?: string
  /**
   * 品牌（选填）。部分类目（如「AI软件订阅/Token充值」）在选类目页把「品牌」列为**必填属性**，
   * 不填则「确认，下一步」一直禁用。传了本参数会在品牌下拉里优先精确匹配；匹配不到则退而取列表第一项。
   */
  brand?: string
  /**
   * 型号（选填）。同上，部分类目在选类目页把「型号」列为必填属性，不填无法进入正式表单。
   */
  model?: string
  /**
   * 类目属性的**显式值**（选填）：`[{ name: '内衣质地', value: '云朵棉' }]`。
   * ★ 与拼多多的 `product.attributes` 对齐：给了就按名字精确匹配填入（值仍须命中页面真实候选），
   *   优先级高于「平台推荐值采纳」与模型选值。适合已知属性、想确定性填写的场景（含离线脚本）。
   */
  attributes?: { name: string; value: string }[]
  /**
   * 类目属性自动选值用的**宿主聊天模型**句柄（选填，对齐 pdd-publish 的 AttrModelHandle）。
   *   由 tools-publish.ts 从当前会话路由装配后传入；未传则跳过模型选值。
   */
  attrModel?: AttrModelHandle
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
  /**
   * 觅千手式「Json/Json2 setter 劫持重放」模式（选填，默认 false）。
   *   true 时进入发布页前注入劫持脚本：框架把表单 state 赋给 window.Json/Json2 的瞬间，
   *   把本地组装的商品数据原地 merge 进框架 state（一次门禁，merge 后置 hook_done）。
   *   merge 成功后跳过 DOM 逐格填写（仅保留类目属性/运费模板兜底）；未命中则自动降级回 DOM 链路。
   *   机制溯源：skills/taobao-publish-mqs/SOURCE.md（觅千手 v5.61 pageHooks.js）。
   */
  replayMode?: boolean
  /**
   * 逆向 HTTP 上传（选填，**默认 true**）—— 复刻觅千手「预上传」链路。
   *   true 时本地主图/详情图先用图片空间接口（stream-upload.taobao.com/api/upload.api，
   *   纯 HTTP multipart，无 mtop 签名、无浏览器）传成 img.alicdn.com URL，
   *   再随 replay 注入表单；DOM 文件上传不再参与。
   *   全程失败（如登录态缺 / 接口变更）时自动回退到原 DOM 上传链路，不会因此发不出去。
   *   ★ 与 replayMode 的关系：拿到 URL 后必须有 replay 才能塞进表单 state，
   *     因此本项为 true 且上传成功时会**自动启用 replayMode**。
   */
  imageSpaceUpload?: boolean
  /**
   * 图片空间目录 id（选填，默认 '0' = 全部图片根目录）。
   *   想把素材归到自定义目录时传该目录 id（可从图片空间页面 URL / dir 查询得到）。
   */
  imageSpaceFolderId?: string
  /** 图片空间上传并发（选填，默认 3，上限 6）。并发过高易触发账号级限流 */
  imageSpaceConcurrency?: number
  /**
   * 直达发布页 URL（选填）。填了则**跳过选类目**，直接打开
   * `https://item.upload.taobao.com/sell/v2/publish.htm?catId=XXXX`。
   *
   * ★ 为什么推荐：实测两条进入路径的页面结构不同 —— 直达时属性区完整渲染
   *   （label.required 有 7 个，属性可填）；走「选类目页 → 确认下一步」时属性区是空壳
   *   （28 个 struct-p-* 但 0 个 label），必填属性读不到也填不上，提交会被前端校验拦死。
   *   已知 catId 的批量发布请优先用本参数。
   */
  directPublishUrl?: string
  /**
   * 诊断模式（选填，默认 false）。true 时表单就绪后 dump window.Json/Json2 完整结构到
   *   dev/.ui-shots/taobao-json-dump.json，然后直接返回（不上传图片、不填表、不点提交）。
   *   用于排查 replayMode 的字段路径问题，零风险。
   */
  diagDumpJson?: boolean
}

export interface TaobaoPublishResult {
  ok: boolean
  text: string
  /** 需要用户确认（未传 confirm=true 时） */
  needConfirm?: boolean
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  /** 发布成功后的落地页 URL */
  finalUrl?: string
  /** 命中风控时透出的验证页地址（供 dsagent_risk_verify 使用） */
  verifyUrl?: string
}

/**
 * 读取 Profile 目录里的 DevToolsActivePort，拿到已开窗口的调试端口。
 *
 * ★ 用途：用户已开着的窗口不要关掉重开 —— 只要该窗口是带
 *   --remote-debugging-port 启动的（本工具启动时已加该参数），
 *   Chrome 就会把端口写到这个文件，后续调用可直接 connect 复用。
 * 文件不存在 / 内容非法时返回 null，调用方回退到新开窗口。
 */
function readDevToolsPort(dir: string): number | null {
  try {
    const f = join(dir, 'DevToolsActivePort')
    if (!existsSync(f)) return null
    const port = Number.parseInt(readFileSync(f, 'utf8').split('\n')[0].trim(), 10)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 *
 * 候选集：精确平台 taobao 优先；无果时降级到凭证平台为 taobao 的账号
 * （天猫不可独立登录，凭证层复用淘宝登录态；闲鱼/生意参谋系同理）。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: TaobaoPublishResult } {
  const all = store.listAccounts().filter(a => a.status !== 'invalid')
  const exact = all.filter(a => a.platform === 'taobao')
  const cred = all.filter(a => a.platform !== 'taobao' && a.credential_platform === 'taobao')
  const candidates = exact.length ? exact : cred

  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到淘宝账号。淘宝与天猫共用同一套登录态，请引导用户打开「账号连接」页面添加**淘宝**账号'
          + '（登录淘宝后，天猫/生意参谋系即可直接使用，无需单独登录天猫）。',
      },
    }
  }
  const res = resolveAccountForRequest(candidates, { shopKey: opts.account, agentId: opts.agentId })
  if (!res.account) {
    const lines = res.choices.map((c, i) =>
      `${i + 1}. ${c.nickname}（账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`)
    return {
      account: null,
      choices: res.choices,
      error: {
        ok: false,
        failureKind: 'need_account_choice',
        accounts: res.choices,
        text: [
          `淘宝平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
          '为避免选错账号（错号会静默影响所有使用该平台的技能），请先向用户确认要用哪一个：',
          ...lines,
          '',
          '用户选定后，把对应的 shopKey 传给本次调用的 account 参数重调。★ 绝不要自己挑一个。',
        ].join('\n'),
      },
    }
  }
  return { account: res.account, choices: [] }
}

/** 生成发布预览文案（confirm 前给用户看） */
function buildPreview(account: StoredAccount, channelLabel: string, opts: TaobaoPublishOptions, images: string[]): string {
  const detImgs = (Array.isArray(opts.detailImages) ? opts.detailImages : []).filter(Boolean)
  const imgUrls = (Array.isArray(opts.imageUrls) ? opts.imageUrls : []).filter(Boolean)
  const detUrls = (Array.isArray(opts.detailImageUrls) ? opts.detailImageUrls : []).filter(Boolean)
  const space = opts.imageSpaceUpload !== false
  /** 图片链路一句话说明（预览时要让用户清楚走哪条路） */
  const imagePath = imgUrls.length
    ? `外链 URL 直填（主图×${imgUrls.length}${detUrls.length ? `、详情图×${detUrls.length}` : ''}）→ replay 注入`
    : space
      ? '逆向 HTTP 预上传图片空间 → replay 注入（DOM 文件上传仅作兜底）'
      : 'DOM 文件上传（已手动关闭逆向 HTTP 上传）'
  return [
    '【发布预览 · 需用户确认】',
    `渠道：${channelLabel}`,
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `标题：${opts.title}`,
    `一口价：${(opts.price || '').trim() || '（未填，留待页面人工填写）'}`,
    `库存：${(opts.stock || '').trim() || '（未填，留待页面人工填写）'}`,
    `货号：${(opts.itemNo || '').trim() || '（未填）'}`,
    `选类目关键词：${(opts.categoryKeyword || '').trim() || '（未填，需在窗口内人工选类目）'}`,
    `品牌：${(opts.brand || '').trim() || '（未填，自动取品牌下拉第一项）'}`,
    `型号：${(opts.model || '').trim() || '（未填，类目要求时需在窗口内人工填）'}`,
    `图片链路：${imagePath}`,
    imgUrls.length ? `主图 URL（${imgUrls.length} 张）：` : `主图（${images.length} 张）：`,
    ...(imgUrls.length ? imgUrls.map(u => `  - ${u}`) : images.map(p => `  - ${p}`)),
    ...(detUrls.length ? [`详情图 URL（${detUrls.length} 张）：`, ...detUrls.map(u => `  - ${u}`)] : []),
    ...(detImgs.length && !detUrls.length ? [`详情图（${detImgs.length} 张，将先传图片空间）：`, ...detImgs.map(p => `  - ${p}`)] : []),
    `多规格（SKU）：${(opts.skus || []).length ? `${(opts.skus || []).length} 项` : '（未填，单 SKU）'}`,
    ...((opts.skus || []).map(s => `  - ${s.name}｜价格=${s.price || '继承一口价'}｜库存=${s.stock || '0'}${s.outerId ? `｜编码=${s.outerId}` : ''}`)),
    '',
    '★ 图片链路（复刻觅千手 v5.61）：本地图先用图片空间接口',
    '  （stream-upload.taobao.com/api/upload.api，纯 HTTP multipart，无 mtop 签名、无浏览器）',
    '  传成 img.alicdn.com URL，再经 Json/Json2 劫持重放塞进发布表单 state。',
    '  主图与详情图都不再走页面文件控件；任一批整体失败会自动回退原 DOM 上传链路。',
    '',
    '★ 本工具自动填：主图 / 标题 / 一口价 / 库存 / 货号，以及**类目属性**（用文本模型从页面真实',
    '  候选中挑值：如「充值方式 / 模型或平台 / 软件类型」）和物流服务的「提取方式」（勾「使用物流配送」）。',
    '  传了 skus 会自动加销售属性值并回填 SKU 表价格/数量/编码。',
    '  品牌不自动填（授权风险，由 brand 参数在选类目页填）。商品详情、发货与售后等仍需人工补全。',
    '  另外：发布第一步需要**选类目**；传了 categoryKeyword 会自动搜索并按与标题的相关性挑最匹配类目，',
    '  若该类目把「品牌/型号」列为必填属性（如「AI软件订阅/Token充值」），会用 brand/model 参数自动填上。',
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正打开浏览器提交。',
    '注意：发布是不可撤销的真实操作（L2）；图片空间里会多出这批素材（可在图片空间删除）。',
  ].join('\n')
}

/** 登录态判定：发布页未登录时会跳 login.taobao.com，或原地渲染登录入口 */
async function isLoggedOut(page: any): Promise<boolean> {
  try {
    const url = String(page.url() || '')
    if (/login\.taobao\.com|login\.tmall\.com|havanaone/i.test(url)) return true
    return await page.evaluate(() =>
      /请登录|登录后|亲，请登录|扫码登录/.test((document.body?.innerText || '').slice(0, 2000)))
  } catch {
    return false
  }
}

/**
 * 风控判定：baxia 滑块/拦截页。
 * 影刀实测的三处出现点：天猫提交、图片空间上传接口、图片空间本体，
 * DOM 为 iframe#baxia-dialog-content（src 含 /_____tmd_____/punish）+ #nc_1_n1z 滑块。
 */
async function detectRisk(page: any): Promise<{ hit: boolean; verifyUrl: string }> {
  try {
    return await page.evaluate(() => {
      const norm = (u: string) => (u || '').replace(':443//', ':443/')
      const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[]
      const punish = iframes.find(f => /_____tmd_____|\/punish/i.test(f.src || ''))
      const dialog = document.querySelector('#baxia-dialog-content, .baxia-dialog, .baxia-punish')
      const slider = document.querySelector('#nc_1_n1z, #nc_1_wrapper, #nc_1_nocaptcha, .nc-container')
      const textHit = /请按住滑块|拖动到最右边|访问被拒绝|安全验证/.test((document.body?.innerText || '').slice(0, 4000))
      const hit = !!(punish || dialog || slider || textHit)
      return { hit, verifyUrl: punish ? norm(punish.src || '') : '' }
    }) as { hit: boolean; verifyUrl: string }
  } catch {
    return { hit: false, verifyUrl: '' }
  }
}

/**
 * 自动选类目（发布入口的「选类目」页，如 sell/ai/category.htm）。
 *
 * 真实实测（2026-09）：
 *   ① 搜索框 input[placeholder*="类目关键词"]，**必须按 Enter 才会出结果**；
 *   ② 结果分「类目」分区（.sell-component-general-category-result-cate.result-item 内的
 *      .sell-component-general-category-result-cate-path，文本形如「个性定制/设计服务/DIY>AI软件订阅/Token充值」）
 *      与「标准产品」分区（.result-product-tab 下的 tab 名）。点「类目」分区结果会打开级联类目树
 *      （.cascade-selection .category-item，两列：一级 + 叶子），页脚显示「类目: A>B」。
 *   ③ ★★ 选中类目后右侧会出现**类目必填属性**（.sell-catProp-item-common，label 带 .required），
 *      实测「个性定制/设计服务/DIY>AI软件订阅/Token充值」必填「品牌」+「型号」：
 *        - 品牌：自动完成下拉（.next-select-auto-complete），点输入框弹出 .next-overlay-wrapper.opened
 *          的候选品牌，必须从列表里点选；
 *        - 型号：普通文本输入。
 *      **只有这两项都填好，「确认，下一步」才会从禁用变可用**（页面右下角有「申请品牌类目授权」提示，
 *      但那只表示品牌不在列表里时的申请入口，不代表该类目不可发布——曾据此误判过一次）。
 *
 *   因此流程为：搜索 → 点第一个「类目」结果 → 填必填属性（品牌/型号）→ 等按钮可用 → 点「确认，下一步」。
 *   选完类目后会**新开标签页** sell/v2/publish.htm?catId=...，由主流程接管新页。
 */
async function selectCategory(
  page: any,
  keyword: string,
  props: { brand?: string; model?: string; title?: string } = {},
): Promise<{ ok: boolean; note: string; pickedPath?: string }> {
  const title = String(props.title || '').trim()
  // 1. 定位搜索框并写入关键词（React 受控组件用原生 setter + input 事件）
  // ★ 该页是 SPA：脚本导航后搜索框可能尚未渲染。先轮询等待其出现（最多 ~30s），
  //   否则会在页面加载完成前就误报「未找到搜索框」。
  const findBox = () => page.evaluate(() =>
    !!document.querySelector('input[placeholder*="类目关键词"]')).catch(() => false)
  let boxReady = await findBox() as boolean
  for (let i = 0; i < 30 && !boxReady; i++) { await sleep(1000); boxReady = await findBox() as boolean }
  if (!boxReady) {
    // 仍找不到 → 采集真实 DOM 证据（页面 URL / 标题 / 可见 input / iframe），便于修正选择器
    const diag = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
      const list = inputs.filter(e => e.offsetWidth || e.offsetHeight)
        .map(e => `[${e.type}] ph="${e.placeholder}" name="${e.name}" id="${e.id}"`)
      const frames = (Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[])
        .map(f => f.src).filter(Boolean)
      return { url: location.href, title: document.title, total: inputs.length, list: list.slice(0, 20), frames: frames.slice(0, 10) }
    }).catch(() => null)
    console.log('[dsagent-taobao-publish] 选类目页 DOM 诊断：', JSON.stringify(diag))
    return {
      ok: false,
      note: `未找到类目搜索框（input[placeholder*="类目关键词"]）。`
        + `页面 URL=${diag?.url || '?'} 标题=${diag?.title || '?'} `
        + `可见 input ${diag?.list?.length ?? 0} 个：${(diag?.list || []).join(' | ')}`
        + ` iframe：${(diag?.frames || []).join(' , ')}`,
    }
  }
  const typed = await page.evaluate((kw: string) => {
    const inp = document.querySelector('input[placeholder*="类目关键词"]') as HTMLInputElement | null
    if (!inp) return false
    inp.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(inp, kw); else inp.value = kw
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, keyword).catch(() => false)
  if (!typed) return { ok: false, note: '未找到类目搜索框（input[placeholder*="类目关键词"]）。' }

  // ★ 必须回车才触发搜索
  await page.keyboard.press('Enter')

  /** 「确认，下一步」是否已可用（类目选好且必填属性填全后才从禁用变可用）。 */
  const submitReady = () => page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const b = btns.find(x =>
      /^(确认，下一步|确认下一步|下一步|确认)$/.test((x.innerText || '').trim())
      && (x.offsetWidth || x.offsetHeight))
    return !!b && b.disabled !== true
  }).catch(() => false)

  /**
   * 取下一个「未尝试过」的搜索结果「类目」候选，标记 dataset.dsTried 去重。
   * ★ 候选按与商品标题的相关性（categoryRelevance）降序尝试，不再盲目取第一个：
   *   实测搜「童装」第一位是「兑换卡>童装卡」——与标题零重叠，但该类目无必填品牌/型号，
   *   「确认，下一步」直接可用而被误选。现规则：有正分候选时只按分数从高到低试，
   *   0 分（与标题零重叠）候选仅在全池无正分时兜底，杜绝「无关类目恰好无必填属性」的误选路径。
   * 返回中心点坐标（元素自身的 .click() 在该页对部分节点无效，必须真实鼠标点击）。
   */
  const nextCategoryCandidate = () => page.evaluate((titleText: string) => {
    const vis = (e: HTMLElement) => !!(e.offsetWidth || e.offsetHeight)
    const all = Array.from(document.querySelectorAll(
      '.sell-component-general-category-result-cate.result-item .sell-component-general-category-result-cate-path',
    )) as HTMLElement[]
    const pool = all.filter(e => vis(e) && e.dataset.dsTried !== '1')
    if (!pool.length) return null

    // ── 相关性打分（与 Node 侧 categoryRelevance 同一算法，页内重算避免序列化往返）──
    const bigrams = (s: string) => {
      const t = (s || '').replace(/\s+/g, '')
      const out = new Set<string>()
      for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
      return out
    }
    const tt = bigrams(titleText)
    const score = (path: string) => {
      if (!tt.size) return 0
      const segs = path.split(/[>＞/／]/).map((x: string) => x.trim()).filter(Boolean)
      if (!segs.length) return 0
      const overlap = (s: string) => {
        let n = 0
        for (const g of bigrams(s)) if (tt.has(g)) n++
        return n
      }
      return overlap(segs[segs.length - 1]) * 2 + overlap(segs.slice(0, -1).join(''))
    }
    const items = pool.map(e => ({
      el: e,
      score: tt.size ? score((e.innerText || '').replace(/\s+/g, ' ').trim()) : 0,
    }))
    const anyPositive = items.some(it => it.score > 0)
    const ranked = items
      .filter(it => (anyPositive ? it.score > 0 : true))
      .sort((a, b) => b.score - a.score)
    const hit = ranked[0]
    if (!hit) return null
    hit.el.dataset.dsTried = '1'
    hit.el.scrollIntoView({ block: 'center' })
    const r = hit.el.getBoundingClientRect()
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      text: (hit.el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      score: hit.score,
    } as { x: number; y: number; text: string; score: number }
  }, title).catch(() => null)

  /**
   * 填右侧「类目必填属性」：品牌（下拉点选）+ 型号（文本）。
   * 返回实际填上的项，供日志/结果说明使用。
   */
  const fillCategoryProps = async (brand: string, model: string): Promise<string[]> => {
    const done: string[] = []
    // 等属性面板渲染（选中类目后会异步拉 selectProp）
    for (let i = 0; i < 12; i++) {
      const n = await page.evaluate(() =>
        (document.querySelectorAll('.sell-catProp-item-common .label.required') as unknown as HTMLElement[]).length).catch(() => 0)
      if (n > 0) break
      await sleep(500)
    }

    // ── 品牌：点开自动完成下拉 → 从候选里点选 ──
    // ★ 该类目品牌是**自定义 combobox**（.next-select-auto-complete 包住的自研下拉），
    //   候选 DOM 是 .options-item（带 title 属性），**不是** li/.next-menu-item/[role=option]
    //   ——用标准 next 选择器会读到 0 项，曾因此导致「确认，下一步」一直禁用。
    const BRAND_OPT_SEL = '.options-item, li, .next-menu-item, [role="option"]'

    /** 品牌输入框中心点（面板可能重渲染，每次重算） */
    const brandInputRect = () => page.evaluate(() => {
      const it = Array.from(document.querySelectorAll('.sell-catProp-item-common')) as HTMLElement[]
      const hit = it.find(x => /品牌/.test(x.querySelector('.label')?.textContent || '') && (x.offsetWidth || x.offsetHeight))
      const inp = hit?.querySelector('input') as HTMLInputElement | null
      if (!inp) return null
      inp.scrollIntoView({ block: 'center' })
      const r = inp.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }).catch(() => null)

    /** 读取当前展开的品牌候选列表 */
    const readBrandOptions = () => page.evaluate((sel: string) => {
      const w = document.querySelector('.next-overlay-wrapper.opened')
      if (!w) return [] as string[]
      return (Array.from(w.querySelectorAll(sel)) as HTMLElement[])
        .filter(e => e.offsetWidth || e.offsetHeight)
        .map(e => (e.getAttribute('title') || e.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }, BRAND_OPT_SEL).catch(() => [] as string[])

    // 下拉候选是选中类目后**异步**拉取的，未就绪时点开是空列表 → 最多重试 4 轮
    let brandOpts: string[] = []
    for (let attempt = 0; attempt < 4; attempt++) {
      brandOpts = await readBrandOptions()
      if (brandOpts.length) break
      const br = await brandInputRect()
      if (!br) break
      await page.mouse.move(br.x, br.y).catch(() => { /* 忽略 */ })
      await sleep(300)
      await page.mouse.click(br.x, br.y).catch(() => { /* 忽略 */ })
      await sleep(UI_STEP_DELAY_MS)
    }

    if (brandOpts.length) {
      // 指定品牌优先精确匹配，其次包含匹配，最后取列表第一项
      const pick = (brand && (brandOpts.find((o: string) => o === brand) || brandOpts.find((o: string) => o.includes(brand) || brand.includes(o))))
        || brandOpts[0]
      const pr = await page.evaluate((sel: string, t: string) => {
        const w = document.querySelector('.next-overlay-wrapper.opened')
        if (!w) return null
        const el = (Array.from(w.querySelectorAll(sel)) as HTMLElement[])
          .find(e => ((e.getAttribute('title') || e.innerText || '').replace(/\s+/g, ' ').trim() === t) && (e.offsetWidth || e.offsetHeight))
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, BRAND_OPT_SEL, pick).catch(() => null)
      if (pr) {
        await page.mouse.move(pr.x, pr.y).catch(() => { /* 忽略 */ })
        await sleep(300)
        await page.mouse.click(pr.x, pr.y).catch(() => { /* 忽略 */ })
        await sleep(1500)
        done.push(`品牌=${pick}`)
      }
    }

    // ── 型号：文本输入（真实键盘输入，保证 React 受控组件收到事件）──
    // 型号字段在**品牌选定后**才渲染，故先等它出现。
    for (let i = 0; i < 10; i++) {
      const has = await page.evaluate(() =>
        (Array.from(document.querySelectorAll('.sell-catProp-item-common')) as HTMLElement[])
          .some(x => /型号/.test(x.querySelector('.label')?.textContent || '') && (x.offsetWidth || x.offsetHeight))).catch(() => false)
      if (has) break
      await sleep(500)
    }
    const modelRect = await page.evaluate(() => {
      const it = Array.from(document.querySelectorAll('.sell-catProp-item-common')) as HTMLElement[]
      const hit = it.find(x => /型号/.test(x.querySelector('.label')?.textContent || '') && (x.offsetWidth || x.offsetHeight))
      const inp = hit?.querySelector('input, textarea') as HTMLInputElement | null
      if (!inp) return null
      inp.scrollIntoView({ block: 'center' })
      const r = inp.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }).catch(() => null)

    if (modelRect && model) {
      await page.mouse.click(modelRect.x, modelRect.y).catch(() => { /* 忽略 */ })
      await sleep(300)
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(model, { delay: 40 })
      await sleep(500)
      await page.keyboard.press('Enter').catch(() => { /* 忽略 */ })
      // blur 一次，触发受控组件提交
      await page.mouse.click(300, 200).catch(() => { /* 忽略 */ })
      await sleep(1000)
      done.push(`型号=${model}`)
    }
    return done
  }

  // 2. 逐个尝试「类目」搜索结果（按与标题的相关性降序），填必填属性直到「确认，下一步」可用
  const tried: string[] = []
  const brand = String(props.brand || '').trim()
  const model = String(props.model || '').trim()
  for (let i = 0; i < 5; i++) {
    let cand = await nextCategoryCandidate()
    if (!cand) {
      // 结果可能还在渲染，稍等后重试一次；仍无则收工
      await sleep(UI_STEP_DELAY_MS)
      cand = await nextCategoryCandidate()
      if (!cand) break
    }
    console.log(`[dsagent-taobao-publish] 候选类目「${cand.text}」（相关分 ${cand.score}），尝试中...`)
    await page.mouse.move(cand.x, cand.y).catch(() => { /* 忽略 */ })
    await sleep(300)
    await page.mouse.click(cand.x, cand.y).catch(() => { /* 忽略 */ })
    tried.push(cand.text)

    const filled = await fillCategoryProps(brand, model)

    // 等按钮可用（填全必填属性后需要几秒；仍不可用则换下一个候选类目）
    const readyDeadline = Date.now() + 20_000
    let ready = false
    while (Date.now() < readyDeadline) {
      ready = await submitReady()
      if (ready) break
      await sleep(500)
    }
    if (!ready) continue

    // 记录最终选中的类目路径（页脚「类目: A>B」）
    const pickedPath = await page.evaluate(() => {
      const el = document.querySelector('.sell-component-general-category-footer-cate .bottom-path') as HTMLElement | null
      return (el?.innerText || '').replace(/\s+/g, ' ').trim()
    }).catch(() => '')

    // 点「确认，下一步」（同样用真实鼠标点击）
    const btn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
      const b = btns.find(x =>
        /^(确认，下一步|确认下一步|下一步|确认)$/.test((x.innerText || '').trim())
        && (x.offsetWidth || x.offsetHeight) && x.disabled !== true)
      if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }).catch(() => null)
    if (!btn) continue
    await page.mouse.move(btn.x, btn.y).catch(() => { /* 忽略 */ })
    await sleep(200)
    await page.mouse.click(btn.x, btn.y).catch(() => { /* 忽略 */ })

    const propNote = filled.length ? `，必填属性：${filled.join('、')}` : ''
    return { ok: true, note: `已选类目「${pickedPath || cand.text}」${propNote}，并点击「确认，下一步」`, pickedPath }
  }

  return {
    ok: false,
    note: `搜索「${keyword}」后尝试了 ${tried.length} 个类目（${tried.join('、') || '无'}），均未能让「确认，下一步」变为可用（多为必填「品牌/型号」未填全）。`
      + (title ? `提示：候选已按与标题「${title.slice(0, 30)}」的相关性降序尝试，仍失败可换更具体的叶子类目词（如「儿童睡衣」而非一级大类「童装」）重试，或在窗口内人工选类目。` : ''),
  }
}

/** 选完类目后会新开标签页 sell/v2/publish.htm?catId=...，等待并返回该页（排除原页）。 */
async function waitForPublishTab(browser: any, prevPage: any, timeoutMs: number): Promise<any | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await browser.pages().catch(() => [] as any[])
    const hit = pages.find((p: any) => {
      try {
        return p !== prevPage
          && /sell\/v2\/publish\.htm\?.*catId=/i.test(String(p.url() || ''))
      } catch { return false }
    })
    if (hit) return hit
    await sleep(1000)
  }
  return null
}

/**
 * 上传主图（新版发布页弹层链路）。
 *
 * 真实实测（2026-09 淘宝新版发布页）：
 *   点 1:1 主图虚线占位 → 打开素材弹层 #images-v2-media-popup-content
 *   → 弹层内 iframe(sucai-selector-ng) 点「本地上传」→ 触发原生文件选择框（multiple）
 *   → 注入文件 → iframe 内点「完成」→ 点图片瓦片 [class*=PicList_pic_background] 选中
 *   → 主图区实时生效（realtimeSelect=true），弹层随交互自动收起，无需手动关闭。
 */
async function uploadImages(page: any, images: string[]): Promise<{ ok: boolean; note: string }> {
  const pickFrame = () => page.frames().find((f: any) => {
    try { return /sucai-selector-ng/.test(String(f.url() || '')) } catch { return false }
  })

  // 素材 iframe 内元素的查找函数（返回元素或 null），供 rectInFrame 使用
  const FN_UP = `(function(){ return Array.from(document.querySelectorAll('button,[role=button],a')).find(x => /本地上传/.test((x.innerText||'').trim()) && (x.offsetWidth||x.offsetHeight)) || null })`
  const FN_DONE = `(function(){ return Array.from(document.querySelectorAll('button')).find(x => /^完成$/.test((x.innerText||'').trim()) && (x.offsetWidth||x.offsetHeight)) || null })`
  const FN_TILE = `(function(){ return document.querySelector('[class*=PicList_pic_background]') })`

  /**
   * 把素材 iframe 内某元素换算成**页面绝对坐标**后返回中心点。
   * ★ 必须先在 iframe 内 scrollIntoView（会改变 iframe 在页面上的位置），再测量 iframe 偏移，
   *   否则坐标会偏移、点击落到弹层头部/遮罩上（实测踩坑）。
   */
  const rectInFrame = async (fnSrc: string): Promise<{ x: number; y: number } | null> => {
    let fr = pickFrame()
    if (!fr) return null
    await fr.evaluate(new Function(`const e = (${fnSrc})(); if (e) e.scrollIntoView({block:'center'})`)).catch(() => { /* 忽略 */ })
    await sleep(400)
    fr = pickFrame()
    if (!fr) return null
    const ir = await page.evaluate(() => {
      const f = document.querySelector('#mainImagesGroup') as HTMLElement | null
      if (!f) return null
      const r = f.getBoundingClientRect()
      return { x: r.x, y: r.y }
    }).catch(() => null)
    const br = await fr.evaluate(new Function(`const e = (${fnSrc})(); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }`)).catch(() => null)
    if (!ir || !br) return null
    return { x: ir.x + br.x, y: ir.y + br.y }
  }
  const realClick = async (pt: { x: number; y: number } | null): Promise<boolean> => {
    if (!pt) return false
    await page.mouse.move(pt.x, pt.y).catch(() => { /* 忽略 */ })
    await sleep(250)
    await page.mouse.click(pt.x, pt.y).catch(() => { /* 忽略 */ })
    return true
  }

  /** 打开主图弹层：必须用**真实鼠标点击** 1:1 虚线占位，元素 .click() 打不开（实测）。 */
  const openPopup = async (): Promise<boolean> => {
    if (pickFrame()) return true
    const pos = await page.evaluate(() => {
      const area = document.querySelector('#struct-mainImagesGroup') as HTMLElement | null
      if (!area) return null
      const t = (area.querySelector('[class*=dashed]') || area.querySelector('.image-empty') || area) as HTMLElement
      t.scrollIntoView({ block: 'center' })
      const r = t.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }).catch(() => null)
    if (!pos) return false
    await page.mouse.move(pos.x, pos.y).catch(() => { /* 忽略 */ })
    await sleep(300)
    await page.mouse.click(pos.x, pos.y).catch(() => { /* 忽略 */ })
    for (let i = 0; i < 15; i++) { await sleep(1000); if (pickFrame()) return true }
    return false
  }

  // 1. 打开弹层
  if (!(await openPopup())) {
    return { ok: false, note: '未打开主图弹层（#struct-mainImagesGroup 未找到虚线占位）。请在浏览器窗口内人工上传主图。' }
  }

  // 2. 上传文件：点「本地上传」→ 等素材 iframe 导航出 input[type=file] → 直接 uploadFile 注入
  //    （实测 waitForFileChooser 捕获不到原生文件框，改用 input[type=file] + uploadFile）
  if (images.length) {
    // ★ 退化路径 A：素材弹层模式——点「本地上传」后在 iframe 内找 input[type=file]
    await realClick(await rectInFrame(FN_UP))
    let fileInput: any = null
    for (let i = 0; i < 15; i++) {
      await sleep(900)
      const fr = pickFrame()
      if (!fr) continue
      fileInput = await fr.$('input[type=file]').catch(() => null)
      if (fileInput) break
    }

    // ★ 退化路径 B：主页面直接上传（新版发布页不走素材弹层）
    //   复刻截图实测结构：#struct-mainImagesGroup 下 5 个虚线占位框，点其一弹文件框/素材层。
    //   优先 waitForFileChooser 一次收全部主图；收不到再退化 input[type=file]。
    if (!fileInput) {
      console.log('[dsagent-taobao-publish] 素材弹层内未找到 input[type=file]，尝试主页面直接上传…')
      // 关闭弹层（如有）
      await page.evaluate(() => {
        const close = document.querySelector('[class*=close], .next-dialog-close, button[aria-label*=close]') as HTMLElement | null
        if (close) close.click()
      }).catch(() => {})
      await sleep(500)
      // 定位第一个 1:1 主图占位框中心（真实鼠标点击，元素 .click() 打不开文件框）
      const pos = await page.evaluate(() => {
        const area = document.querySelector('#struct-mainImagesGroup') as HTMLElement | null
        if (!area) return null
        // 占位框候选：含「上传图片」文本的可见块 / dashed / image-empty / 直接子块
        const pick = (Array.from(area.querySelectorAll('*')) as HTMLElement[]).find(el => {
          const t = (el.innerText || el.textContent || '').trim()
          return /上传图片/.test(t) && el.offsetParent !== null && el.getBoundingClientRect().width > 40 && el.getBoundingClientRect().width < 200
        }) || (area.querySelector('[class*=dashed], .image-empty, [class*=empty], [class*=upload]') as HTMLElement)
        if (!pick) return null
        pick.scrollIntoView({ block: 'center' })
        const r = pick.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }).catch(() => null) as { x: number; y: number } | null
      if (pos) {
        // 先挂 fileChooser 监听，再真实点击
        const fcPromise = page.waitForFileChooser({ timeout: 8000 }).catch(() => null)
        await page.mouse.move(pos.x, pos.y).catch(() => {})
        await sleep(300)
        await page.mouse.click(pos.x, pos.y).catch(() => {})
        const fc = await fcPromise
        if (fc) {
          await fc.accept(images).catch(() => {})
          console.log('[dsagent-taobao-publish] 已通过 fileChooser 一次性上传主图')
          await sleep(4000)
          const cnt = await page.evaluate(() => document.querySelectorAll('#struct-mainImagesGroup img').length).catch(() => 0) as number
          if (cnt > 0) return { ok: true, note: `已上传主图（主图区已出现 ${cnt} 张）` }
        } else {
          // 文件框没弹 → 可能弹了素材层 → 回外层重走弹层路径
          for (let i = 0; i < 12; i++) { await sleep(900); if (pickFrame()) break }
          fileInput = pickFrame() ? await pickFrame().$('input[type=file]').catch(() => null) : null
          if (fileInput) console.log('[dsagent-taobao-publish] 点击占位框后进入素材弹层，改用弹层上传')
        }
      }
    }

    // ★ 退化路径 C：用 Puppeteer waitForFileChooser（部分页面用原生文件框）
    if (!fileInput) {
      console.log('[dsagent-taobao-publish] 主页面也未找到 input[type=file]，尝试 waitForFileChooser…')
      const clicked = await page.evaluate(() => {
        const area = document.querySelector('#struct-mainImagesGroup') as HTMLElement | null
        if (!area) return false
        const all = Array.from(area.querySelectorAll('*')) as HTMLElement[]
        const target = all.find(el => {
          const t = (el.innerText || el.textContent || '').trim()
          return /上传/.test(t) && el.offsetParent !== null && el.children.length <= 3
        })
        if (target) { (target as HTMLElement).click(); return true }
        return false
      }).catch(() => false) as boolean
      if (clicked) {
        try {
          const fc = await page.waitForFileChooser({ timeout: 5000 })
          await fc.accept(images)
          // 跳过 uploadFile 路径，直接等上传完成
          console.log('[dsagent-taobao-publish] 已通过 waitForFileChooser 上传主图')
          await sleep(3000)
          // 校验主图区
          const cnt = await page.evaluate(() => document.querySelectorAll('#struct-mainImagesGroup img').length).catch(() => 0) as number
          if (cnt > 0) return { ok: true, note: `已上传主图（主图区已出现 ${cnt} 张）` }
          return { ok: false, note: 'waitForFileChooser 已上传但主图区未确认到图片。请在浏览器窗口内确认主图。' }
        } catch { /* 继续 */ }
      }
    }

    if (!fileInput) {
      return { ok: false, note: '未找到主图上传的文件输入框（点「本地上传」后素材 iframe 未就绪）。请在浏览器窗口内人工上传主图。' }
    }
    await fileInput.uploadFile(images[0]).catch(() => { /* 忽略 */ })
    console.log('[dsagent-taobao-publish] 主图弹层内已注入本地文件，等待上传完成…')

    // 等「完成」按钮出现（上传面板就绪）
    const upDeadline = Date.now() + UPLOAD_WAIT_MS
    while (Date.now() < upDeadline) {
      await sleep(1500)
      const fr = pickFrame()
      const ready = fr ? await fr.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLElement[]
        return btns.some(b => /^完成$/.test((b.innerText || '').trim()) && (b.offsetWidth || b.offsetHeight))
      }).catch(() => false) : false
      if (ready) break
    }
    // 点「完成」：确认上传（实测会关闭整个弹层，图片已进入素材空间）
    await realClick(await rectInFrame(FN_DONE))
    await sleep(3000)
  }

  // 3. 上传后弹层可能已自动收起；若已收起则重开，再从素材列表里选中刚上传的图（列表按最新在前）
  if (!pickFrame() && !(await openPopup())) {
    const count0 = await page.evaluate(() => document.querySelectorAll('#struct-mainImagesGroup img').length).catch(() => 0) as number
    if (count0) return { ok: true, note: `已上传 ${images.length} 张主图（主图区已出现 ${count0} 张）` }
    return { ok: false, note: '主图弹层已收起且无法重开。请在浏览器窗口内确认主图。' }
  }

  // 4. 点第一张图片瓦片选中（realtimeSelect=true，选中即落到主图区）
  await realClick(await rectInFrame(FN_TILE))
  await sleep(3000)

  // 5. 若弹层仍开着，点「完成」收起
  if (pickFrame()) { await realClick(await rectInFrame(FN_DONE)); await sleep(UI_STEP_DELAY_MS) }

  // 6. 校验主图区是否已出现图片
  const count = await page.evaluate(() =>
    document.querySelectorAll('#struct-mainImagesGroup img').length).catch(() => 0) as number
  if (!count) {
    return { ok: false, note: '已在弹层内上传，但主图区未确认到图片（可能需要人工点选）。请在浏览器窗口内确认主图。' }
  }
  return { ok: true, note: `已上传并选中 ${images.length} 张主图（主图区已出现 ${count} 张）` }
}

/** 文件路径末段（日志/文案里只显示文件名，避免把长绝对路径刷满日志） */
function basenameOf(p: string): string {
  const s = String(p || '')
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return i >= 0 ? s.slice(i + 1) : s
}

/**
 * 详情图注入 —— **一比一照抄觅千手 iframeHandler.js 的上传段**。
 *
 * 觅千手源码对应位置（`source/iframeHandler.js`）：
 *   · `getImgBlob(url)`：
 *       去掉 .avif → 补协议 → 加 `_nocache=<时间戳_随机>` → `fetch(url,{cache:'no-store'})` → blob
 *   · 批量段：
 *       `const dt=new DataTransfer();`
 *       `dt.items.add(new File([blob], name, {type:'image/jpeg'}));`
 *       `uploadInputElement.files = dt.files;`
 *       `uploadInputElement.dispatchEvent(new Event('change',{bubbles:true}));`
 *   · 批大小 `chunk_size = 7`
 *   · 入口：`document.querySelector('div[class^="HeadActions_headActionsRight"] button').click()`
 *     → `await waitElement('input[type="file"]')` → 取 input 传文件
 *
 * ★ 关键认知：觅千手**不自己调上传接口**，它是把图片塞进页面自己的
 *   `input[type=file]`，让页面内置的上传器（PLUG_UPLOAD）去传，传完由框架把结果
 *   写进 formValues.descRepublicOfSell。所以我们也不该直接写 state（实测无效，
 *   详情编辑器与主图一样只在挂载时读值）。
 *
 * ★ 与原文的唯一差异：本仓没有同源上下文里的 blob 构造权限，
 *   所以「取 blob」这一步用 page.evaluate 在页面内 fetch 完成（同源，不跨域），
 *   其余步骤（DataTransfer / File / files / change）逐字保留。
 */
async function injectDetailImages(page: any, localFiles: string[], urls: string[]): Promise<{ ok: boolean; note: string }> {
  if (!urls.length) return { ok: true, note: '无详情图' }

  // ① 详情编辑器就绪（实测默认就挂载，不做 tab 点击）
  const tabOk = await openDescTab(page)
  if (!tabOk) return { ok: false, note: '详情编辑器未就绪，详情图无法注入' }

  // ② 点「添加 → 图片」打开素材选择层
  const opened = await page.evaluate(() => {
    const vis = (e: any) => !!e && e.offsetParent !== null
    const ed = document.querySelector('#lite-decoration-editor')
    if (!ed) return 'no-editor'
    const items = Array.from(ed.querySelectorAll('div,span,button,a')) as HTMLElement[]
    const addTitle = items.find(e => vis(e) && /add_title/i.test(String(e.className)) && /添加/.test(e.textContent || ''))
    if (addTitle) { try { addTitle.click() } catch { /* 忽略 */ } }
    const picItem = items.find(e => vis(e) && /add_item/i.test(String(e.className))
      && (e.textContent || '').trim() === '图片')
    if (!picItem) return 'no-pic-item'
    try { picItem.scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }
    picItem.click()
    return 'clicked'
  }).catch(() => 'err') as string
  if (opened !== 'clicked') return { ok: false, note: `详情图：未点到「添加→图片」（${opened}）` }
  await sleep(2500)

  // ③ 等素材弹层（sucai-selector-ng）
  let dlg: any = null
  for (let i = 0; i < 16 && !dlg; i++) {
    dlg = page.frames().find((f: any) => /sucai-selector|sucai\.|select\.htm|image-bank/i.test(f.url()))
    if (!dlg) await sleep(800)
  }
  if (!dlg) return { ok: false, note: '详情图：素材选择层未出现' }

  // ④ 切「本地上传」
  await dlg.evaluate(() => {
    const vis = (e: any) => !!e && e.offsetParent !== null
    const all = Array.from(document.querySelectorAll('div,span,button,a')) as HTMLElement[]
    const hit = all.find(e => vis(e) && /^(本地上传|上传图片|上传)$/.test((e.textContent || '').trim()) && e.children.length <= 1)
    if (hit) { try { hit.click() } catch { /* 忽略 */ } }
  }).catch(() => {})
  await sleep(2500)

  // ⑤ 投递文件
  //   ★ 实测：**必须用 puppeteer 原生 uploadFile**（trusted 事件）。
  //     觅千手在插件里用 DataTransfer + dispatchEvent('change')，那是同源脚本上下文；
  //     我们通过 CDP 注入的合成事件会被这个上传器丢弃 —— 表现是「弹层里加了 File
  //     但一个都没上传、也没有『确定（N）』按钮」。原生 uploadFile 走的是真实文件选择，
  //     弹层立刻出现「确定（3）」。
  let nativeOk = false
  const files = localFiles.filter(Boolean)
  if (files.length) {
    try {
      const inputEl = await dlg.$('input[type="file"]')
      if (inputEl) {
        await (inputEl as any).uploadFile(...files)
        nativeOk = true
      }
    } catch { /* 落回 DataTransfer */ }
  }
  if (!nativeOk) {
    // 兜底：DataTransfer（觅千手原法；部分版本可用）
    const CHUNK = 7
    for (let i = 0; i < urls.length; i += CHUNK) {
      const chunk = urls.slice(i, i + CHUNK)
      const r = await dlg.evaluate(async (list: string[]) => {
        const getImgBlob = async (raw: string) => {
          try {
            let u = String(raw || '').replace('.avif', '')
            if (u.startsWith('//')) u = 'https:' + u
            else if (!/^https?:/.test(u)) u = 'https://' + u
            const ts = Date.now() + '_' + Math.random().toString(36).substring(2, 15)
            const resp = await fetch(u + (u.includes('?') ? '&' : '?') + '_nocache=' + ts, { cache: 'no-store' })
            return resp && resp.status === 200 ? await resp.blob() : null
          } catch { return null }
        }
        let input: HTMLInputElement | null = null
        for (let t = 0; t < 20 && !input; t++) {
          input = document.querySelector('input[type="file"]') as HTMLInputElement | null
          if (!input) await new Promise(r2 => setTimeout(r2, 300))
        }
        if (!input) return { ok: false }
        const dt = new DataTransfer()
        for (const u of list) {
          const blob = await getImgBlob(u)
          if (!blob) continue
          dt.items.add(new File([blob], `detail_${Date.now()}.jpg`, { type: 'image/jpeg' }))
        }
        if (!dt.items.length) return { ok: false }
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, count: dt.files.length }
      }, chunk).catch(() => ({ ok: false } as any))
      if (!r?.ok) break
      if (i + CHUNK < urls.length) await sleep(1200)
    }
  }
  await sleep(3000)

  // ⑥ 等上传完成（弹层出现「完成」或底栏成功文案）
  //   ★ 实测：uploadFile 触发后，上传是**异步**的；3s 后就去点「完成」会点空，
  //     随即回到列表也选不到图（列表还没刷新出来）。所以这里轮询等上传结束。
  let uploadDone = false
  for (let i = 0; i < 40; i++) {
    const st = await dlg.evaluate(() => {
      const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const btnTexts = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[])
        .filter(b => b.offsetParent !== null && !b.disabled).map(b => (b.innerText || '').trim())
      return {
        hasDone: btnTexts.includes('完成'),
        hasConfirm: btnTexts.some(t => /^确定(（\d+）)?$/.test(t)),
        success: /\d+\s*个文件上传成功|上传成功|已完成/.test(txt),
        uploading: /正在上传|上传中/.test(txt),
        btnTexts: btnTexts.slice(0, 8),
      }
    }).catch(() => ({ hasDone: false, hasConfirm: false, success: false, uploading: false, btnTexts: [] as string[] }))
    if (i % 8 === 0) {
      console.log(`[dsagent-taobao-publish] 详情上传等待 ${i}：done=${st.hasDone} confirm=${st.hasConfirm} `
        + `success=${st.success} uploading=${st.uploading} btns=${JSON.stringify(st.btnTexts)}`)
    }
    if (st.hasConfirm || st.success || (!st.uploading && st.hasDone)) { uploadDone = true; break }
    if (!st.uploading && i > 10 && !st.hasDone) { uploadDone = true; break }  // 上传器可能不显示进度，直接进列表
    await sleep(1500)
  }
  if (!uploadDone) console.log('[dsagent-taobao-publish] 详情上传等待超时，继续尝试选图')

  // ⑦ 点「完成」退出上传弹层（若有）
  await dlg.evaluate(() => {
    const b = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[])
      .find(x => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === '完成')
    if (b) b.click()
  }).catch(() => {})
  await sleep(3000)

  // ⑧ 回到列表选中图片，再点「确定（N）」
  //   ★ 按钮文案带选中数量后缀（实测为「确定（3）」），必须前缀匹配。
  //   ★ 列表可能还在刷新，轮询几次。
  let sel: { n: number; btns: string[] } = { n: 0, btns: [] }
  for (let round = 0; round < 8; round++) {
    sel = await dlg.evaluate(() => {
      const txt = (e: any) => (e.textContent || '').replace(/\s+/g, ' ').trim()
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[]
      let n = 0
      for (const b of boxes.filter(x => x.offsetParent !== null).slice(0, 8)) {
        if (!b.checked) { try { b.click(); n++ } catch { /* 忽略 */ } }
      }
      if (!boxes.length) {
        const imgs = Array.from(document.querySelectorAll('img'))
          .filter((im: any) => im.offsetParent !== null && /imgextra/.test(im.src || '')).slice(0, 6)
        for (const im of imgs) {
          const card = (im as any).closest('[class*="item"], [class*="card"], li, div')
          if (card) { try { card.click(); n++ } catch { /* 忽略 */ } }
        }
      }
      const btns = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[])
        .filter(b => b.offsetParent !== null && !b.disabled).map(b => txt(b))
      return { n, btns }
    }).catch(() => ({ n: 0, btns: [] as string[] }))
    const hit = (sel.btns || []).find(t => /^(确定|确认|使用选中图片|确定选择|确认上传|完成)(（\d+）|\(\d+\))?$/.test(t))
    if (hit) break
    await sleep(1500)
  }

  const okBtn = (sel.btns || []).find(t => /^(确定|确认|使用选中图片|确定选择|确认上传|完成)(（\d+）|\(\d+\))?$/.test(t))
  if (!okBtn) return { ok: false, note: `详情图：素材层未出现选择确认按钮（${JSON.stringify(sel.btns)}）` }
  await dlg.evaluate((label: string) => {
    const b = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[])
      .find(x => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === label)
    if (b) b.click()
  }, okBtn).catch(() => {})
  console.log(`[dsagent-taobao-publish] 详情素材层：选中 ${sel.n} 张后点「${okBtn}」`)
  await sleep(6000)

  // ⑧ 等编辑器出图
  let got = 0
  for (let i = 0; i < 20; i++) {
    got = await page.evaluate(() => {
      const ed = document.querySelector('#lite-decoration-editor')
      if (!ed) return 0
      return Array.from(ed.querySelectorAll('img'))
        .filter((im: any) => {
          const s = im.src || ''
          // 排除编辑器自带 UI 小图标：-tps-WxH 尾缀 / svg / /tfs/ 站内资源；
          // 真正的详情图是商品账号下的 imgextra 图（URL 带 uid）
          return /imgextra/i.test(s)
            && !/tps-\d+-\d+\./i.test(s)
            && !/\.(svg|gif|ico)(\?|$)/i.test(s)
            && !/\/tfs\//i.test(s)
        }).length
    }).catch(() => 0) as number
    if (got > 0) break
    await sleep(2000)
  }
  return {
    ok: got > 0,
    note: got > 0
      ? `详情图已注入（投递 ${nativeOk ? files.length : urls.length} 张，编辑器内渲染 ${got} 张）`
      : `详情图：已投递 ${nativeOk ? files.length : urls.length} 张但编辑器未出图（可能仍在上传，或需人工确认）`,
  }
}

/**
 * 构造提交体里的 `saleProp`（照觅千手：克隆源商品的 saleProp，键是真实 pid）。
 *
 * 真实提交体里的形态（抓包实测）：
 *   { "p-122216343": { "selectedSizeGroupId": { text, value, subName, sizeGroupType } } }
 *   其中 `p-122216343` 是「身高/身型」维度的属性 id。
 *
 * 我们从页面读两个东西：
 *   ① 每个维度输入框所在的属性项 id（`struct-p-XXXX` → `p-XXXX`）
 *   ② 该维度可以填的规格值（`skus[].name` 对应的是「颜色分类」这种自由键入维度）
 * 说明：`selectedSizeGroupId` 这类「尺码组」是平台预置联动项，不强行构造；
 * 只在页面已经选了值时原样保留，我们只补规格值数组。
 */
async function buildSalePropOverride(
  page: any,
  skus: TaobaoSkuInput[],
): Promise<Record<string, unknown> | null> {
  // ★ 实测真实 pid（2026-10，直达发布页 DOM）：
  //     颜色分类 → struct-p-1627207  → pid = p-1627207
  //     身高     → struct-p-122216343 → pid = p-122216343（与抓包 saleProp 的键完全一致）
  //   所以 saleProp 的键必须是这类真实 pid；用 `-1` 之类的假 pid 后端不认。
  const dims = await page.evaluate(() => {
    const box = document.getElementById('struct-saleProp') as HTMLElement | null
    if (!box) return [] as { pid: string; ph: string; label: string }[]
    const out: { pid: string; ph: string; label: string }[] = []
    for (const inp of Array.from(box.querySelectorAll('input')) as HTMLInputElement[]) {
      if (inp.offsetParent === null) continue
      const ph = inp.placeholder || ''
      if (/备注/.test(ph)) continue                       // 备注框不是维度
      let el: HTMLElement | null = inp
      let pid = ''
      for (let i = 0; i < 10 && el; i++) {
        const m = (el.id || '').match(/^struct-(p-\d+)$/)
        if (m) { pid = m[1]; break }
        el = el.parentElement
      }
      // 尺码维度的输入框本身不在 struct-p-* 内，向上找不到 pid 时按已知身高 pid 补
      const label = /尺码|身高/.test(ph) ? '身高' : (/主色|颜色/.test(ph) ? '颜色分类' : '')
      out.push({ pid, ph, label })
    }
    return out
  }).catch(() => [] as { pid: string; ph: string; label: string }[])

  if (!dims.length) return null
  const names = skus.map(s => String(s.name || '').trim()).filter(Boolean)
  const result: Record<string, unknown> = {}

  // 颜色分类维度 = 自由键入维度，值就是 skus[].name
  const colorDim = dims.find((d: { ph: string }) => /主色|颜色/.test(d.ph))
  const colorPid = colorDim?.pid || 'p-1627207'
  if (names.length) {
    result[colorPid] = names.map(n => ({ text: n }))
  }

  // 身高维度：平台预置「尺码组」联动项（抓包里是 selectedSizeGroupId），
  // 不凭空构造 value；页面已选到就原样带上，没选到就不写（避免脏数据）。
  const sizeDim = dims.find((d: { ph: string }) => /尺码|身高/.test(d.ph))
  const sizePid = sizeDim?.pid || 'p-122216343'
  const sizeSel = await page.evaluate((pid: string) => {
    const el = document.getElementById(`struct-${pid}`)
      || document.getElementById('struct-p-122216343')
    const v = el?.querySelector('.next-select-values') as HTMLElement | null
    return (v?.innerText || '').trim()
  }, sizePid).catch(() => '')
  if (sizeSel && sizePid && !result[sizePid]) {
    // 只记录已选文本；具体 value/subName 由页面自身维护（我们只补颜色维度）
    console.log(`[dsagent-taobao-publish] 身高维度已选：${sizeSel}`)
  }
  return Object.keys(result).length ? result : null
}

/**
 * 把「显式类目属性（属性名→值）」翻成提交体里 `catProp` 的结构。
 *
 * 真实提交体里 catProp 形如：
 *   { "p-20000": { "value": 3743628, "text": "0-3" }, ... }   ← 单选
 * 属性 id 不是我们能凭空造的，必须从页面读（`struct-p-XXXX` 的 id 就是 `p-XXXX`）。
 * 页面读不到该属性时不写 —— 宁可漏一个，也不能因为编造 id 让整次提交失败。
 */
async function buildCatPropOverride(
  page: any,
  explicit: { name: string; value: string }[],
): Promise<Record<string, { value?: unknown; text?: string }> | null> {
  if (!explicit.length) return null
  const map = await page.evaluate(() => {
    const out: Record<string, string> = {}
    // 属性名 → 属性 id（struct-p-XXXX → p-XXXX）
    for (const el of Array.from(document.querySelectorAll('[id^="struct-p-"]')) as HTMLElement[]) {
      const box = el.querySelector('label') ? el
        : (el.closest('.sell-catProp-item-common, .sell-catProp-item') as HTMLElement | null) || el
      const label = box.querySelector('label')
      const name = (label?.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      if (!name) continue
      const pid = el.id.replace(/^struct-/, '')   // p-XXXX
      out[name] = pid
    }
    return out
  }).catch(() => ({} as Record<string, string>))

  const result: Record<string, { value?: unknown; text?: string }> = {}
  for (const a of explicit) {
    const pid = map[a.name]
    if (!pid) continue
    // text 必给（后端用于回显）；value 保持 text，平台多数类目接受字符串值
    result[pid] = { value: a.value, text: a.value }
  }
  return Object.keys(result).length ? result : null
}

/**
 * 填「文本型」类目属性（input / textarea，无下拉候选）。
 *
 * 锚点：`#struct-p-XXXX` → 对应表单项 `#sell-field-p-XXXX` 里的 input/textarea。
 * 必须走真实键入（React 受控组件只认 beforeinput/input 序列），
 * 直接赋 value 不进 state —— 与销售属性同一个坑。
 */
async function fillAttrText(page: any, propId: string, value: string, maxlength = 0): Promise<boolean> {
  const pos = await page.evaluate((id: string) => {
    let field: HTMLElement | null = null
    if (id.startsWith('label:')) {
      const want = id.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const t = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (t !== want) continue
        let box: HTMLElement | null = l
        for (let i = 0; i < 6 && box; i++) {
          const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, .next-select-trigger, input')) { field = cand; break }
          box = box.parentElement
        }
        if (field) break
      }
    } else {
      field = document.getElementById(id)
        || document.getElementById('sell-field-' + id.replace(/^struct-/, ''))
    }
    if (!field) return null
    // ★★ 2026-10-28：必须挑**文本型** input，不能要 select 的只读 input。
    //   实测「型号」属性项容器里同时有 select 的只读 input（placeholder「请选择」）
    //   和真正的文本 input（placeholder「请输入」），取第一个会命中只读的那个，
    //   于是把型号值键入到了错误位置（表现为「型号」显示成了品牌的值）。
    const inps = Array.from(field.querySelectorAll('input, textarea') as NodeListOf<HTMLInputElement>)
      .filter(i => i.offsetParent !== null && !i.readOnly && !/^请选择/.test(i.getAttribute('placeholder') || ''))
    const inp = inps[inps.length - 1] || (field.querySelector('input, textarea') as HTMLInputElement | null)
    if (!inp || inp.offsetParent === null) return null
    try { inp.scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }
    const r = inp.getBoundingClientRect()
    return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }
  }, propId).catch(() => null) as { x: number; y: number } | null
  if (!pos) return false

  await page.mouse.click(pos.x, pos.y)
  await sleep(200)
  // 清空既有内容
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await sleep(100)
  const v = maxlength > 0 ? String(value).slice(0, maxlength) : String(value)
  await page.keyboard.type(v, { delay: 20 })
  await sleep(200)
  // Tab 触发 onBlur 提交进 state（同销售属性：Enter 无效）
  await page.keyboard.press('Tab')
  await sleep(400)

  return await page.evaluate((id: string, want: string) => {
    const w = String(want || '').trim()
    // label: 形态走反查（getElementById 拿不到这种 id）
    const readBox = (sid: string): HTMLElement | null => {
      if (!sid.startsWith('label:')) {
        return document.getElementById(sid) || document.getElementById('sell-field-' + sid.replace(/^struct-/, ''))
      }
      const name = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const t = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (t !== name) continue
        let b: HTMLElement | null = l
        for (let i = 0; i < 6 && b; i++) {
          const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('input, textarea')) return cand
          b = b.parentElement
        }
      }
      return null
    }
    const field = readBox(id)
    if (!field) return false
    const inps = Array.from(field.querySelectorAll('input, textarea') as NodeListOf<HTMLInputElement>)
      .filter(i => i.offsetParent !== null && !i.readOnly && !/^请选择/.test(i.getAttribute('placeholder') || ''))
    const inp = inps[inps.length - 1] || (field.querySelector('input, textarea') as HTMLInputElement | null)
    return !!inp && (inp.value || '').trim() === w
  }, propId, v).catch(() => false) as boolean
}

/**
 * 打开「图文描述」tab —— 详情编辑器是懒挂载的，只有该 tab 激活才会渲染
 * `#lite-decoration-editor` 的内容。
 *
 * ★ 实测（2026-10）：不点这个 tab 时，即使 formValues.descRepublicOfSell 已有
 *   templateContent，`#lite-decoration-editor` 仍是空 div、详情 img=0；点开后再写/再验，
 *   图立刻出现在 `#panel_edit` 里。所以验证详情图之前必须先切到这个 tab。
 */
async function openDescTab(page: any): Promise<boolean> {
  // ★ 实测修正（2026-10）：详情编辑器**默认就是挂载的** ——
  //   `#lite-decoration-editor > #panel_edit` 一直在 DOM 里（height≈757），
  //   里面 `add_title` / `add_item`（图片/文字/源码导入/模板…）也都已渲染。
  //   之前用「height > 100 才算挂载」+「必须点到 tab」的判断把它误判成未挂载，
  //   白等了几十秒。这里改成：只要 #panel_edit 存在就算就绪，不做 tab 点击。
  const ok = await page.evaluate(() => {
    const ed = document.querySelector('#lite-decoration-editor')
    if (!ed) return false
    const panel = ed.querySelector('#panel_edit')
    if (!panel) return false
    // 菜单项也要在（说明组件真正渲染完成）
    return Array.from(panel.querySelectorAll('*'))
      .some((e: any) => /add_item/i.test(String(e.className)) && (e.textContent || '').includes('图片'))
  }).catch(() => false) as boolean
  if (ok) {
    console.log('[dsagent-taobao-publish] 详情编辑器已就绪（#panel_edit + 添加菜单）')
    return true
  }
  // 未就绪时再尝试点导航（少数版式下详情区是懒加载）
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(() => {
      const vis = (e: any) => !!e && e.offsetParent !== null
      const cands = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
        .filter(e => vis(e) && /图文描述/.test(e.textContent || ''))
        .map(e => ({ el: e, r: e.getBoundingClientRect() }))
        .filter(o => o.r.height > 10 && o.r.height < 120 && o.r.width > 20)
        .sort((a, b) => (a.r.height * a.r.width) - (b.r.height * b.r.width))
      if (cands[0]) { try { cands[0].el.scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }; cands[0].el.click() }
    }).catch(() => {})
    await sleep(2000)
    const ready = await page.evaluate(() => {
      const ed = document.querySelector('#lite-decoration-editor')
      return !!(ed && ed.querySelector('#panel_edit'))
    }).catch(() => false) as boolean
    if (ready) {
      console.log(`[dsagent-taobao-publish] 详情编辑器已就绪（点击导航后，第 ${attempt + 1} 次）`)
      return true
    }
  }
  console.log('[dsagent-taobao-publish] 详情编辑器未就绪（详情图将无法注入）')
  return false
}

/**
 * 回读「图片是否真的渲染到了表单上」—— 逆向预上传 + replay 的最终验收点。
 *
 * ★ 为什么必须单独验：replay 命中只证明 **state 被 merge**，不证明**框架把图渲染出来**。
 *   实测存在「mergedFields 有 mainImagesGroup，但主图区一个 img 都没有」的情况
 *   （字段名对不上 / 框架另有渲染源 / 图片 URL 未被框架接受）。
 *   这里直接数 DOM 里的 img，并区分「主图区 / 详情区」，给出可判定的结论。
 *
 * 返回：主图区 img 数、详情区 img 数、各自前几张的 src（便于肉眼核对是不是那批图）。
 */
async function verifyImagesRendered(page: any): Promise<{
  mainCount: number
  mainSrcs: string[]
  descCount: number
  descSrcs: string[]
  formMainCount: number
  formDescCount: number
}> {
  const probe = await page.evaluate(() => {
    const norm = (arr: any[]) => arr.map((s: any) => String(s || '')).filter(Boolean)
    // ── 主图：只数主图组件自己的容器，避免把页面上的图标/logo 算进来 ──
    const mainEl = document.querySelector('.sell-component-simply-images')
    const mainImgs = mainEl
      ? norm(Array.from(mainEl.querySelectorAll('img')).map((i: any) => i.src || i.getAttribute('data-src')))
      : []
    // ── 详情图：新版详情渲染在 #lite-decoration-editor 的 #panel_edit 里 ──
    //   实测（2026-10）：写入 descRepublicOfSell.descPageCommitParam.templateContent 后，
    //   图片出现在 #lite-decoration-editor 内，但编辑器自身也会带 3 张 UI 小图标，
    //   所以按「CDN imgextra 图」过滤，用 imgextra 判定真实详情图。
    const ed = document.querySelector('#lite-decoration-editor')
    const edImgs = ed
      ? norm(Array.from(ed.querySelectorAll('img')).map((i: any) => i.src || i.getAttribute('data-src')))
      : []
    const detailOnly = edImgs.filter((s: string) => /imgextra/i.test(s)
      && !/tps-\d+-\d+\./i.test(s) && !/\.(svg|gif|ico)(\?|$)/i.test(s) && !/\/tfs\//i.test(s))
    // 兜底：旧版 desc 容器 / 无线详情预览
    const legacy = document.querySelector('#struct-desc:not(.hidden), [id*="desc-card"]')
    const legacyImgs = legacy
      ? norm(Array.from(legacy.querySelectorAll('img')).map((i: any) => i.src || i.getAttribute('data-src')))
        .filter((s: string) => /imgextra/i.test(s)
        && !/tps-\d+-\d+\./i.test(s) && !/\.(svg|gif|ico)(\?|$)/i.test(s) && !/\/tfs\//i.test(s))
      : []
    const descImgs = detailOnly.length ? detailOnly : legacyImgs

    // 表单 state 里的数量（作为「框架是否收下」的对照）
    const fv = (window as any).Json?.models?.formValues || {}
    const formMainCount = Array.isArray(fv.mainImagesGroup?.images) ? fv.mainImagesGroup.images.length
      : (Array.isArray(fv.images) ? fv.images.length : 0)
    const formDescCount = Array.isArray(fv.wirelessDesc) ? fv.wirelessDesc.length : 0
    return {
      mainCount: mainImgs.length, mainSrcs: mainImgs.slice(0, 8),
      descCount: descImgs.length, descSrcs: descImgs.slice(0, 4),
      formMainCount, formDescCount,
    }
  }).catch(() => ({
    mainCount: -1, mainSrcs: [] as string[], descCount: -1, descSrcs: [] as string[],
    formMainCount: -1, formDescCount: -1,
  }))
  return probe as any
}

/**
 * 详情图上传（发布页内直传详情编辑器）。复刻觅千手预上传思路：本地图直传到详情编辑器，
 * 框架把 URL 收进 formValues.wirelessDesc / descRepublicOfSell，随 Json state 提交。
 *
 * ★ 现状（2026-10 改造）：这是**降级链路**。首选已换成 src/taobao-image-space.ts 的
 *   逆向 HTTP 预上传（纯 HTTP 拿 CDN URL → replay 注入），本函数只在图片空间链路
 *   整体失败时才被调用。
 *
 * 锚点策略（淘宝发布页图文详情区）：
 *   ① 详情编辑器容器：#struct-desc / [id*=desc] / 含「图文详情」「商品详情」文本的 struct 块
 *   ② 上传入口：编辑器内「上传图片」「本地上传」按钮点击后出现 input[type=file]，
 *      或富文本工具栏的图片按钮；退化到 waitForFileChooser。
 *   ★ 对齐 pdd 实测经验：批量 uploadFile 多张会被静默丢弃，逐张投递 + 计数确认。
 */
async function uploadDetailImages(page: any, files: string[]): Promise<{ ok: boolean; note: string }> {
  if (!files.length) return { ok: true, note: '无详情图' }

  // ── ① 定位宝贝详情区并滚到它 ──
  //   截图证实：详情区左侧有「添加」按钮，点击弹出「图片」「文字」菜单。
  const DETAIL_ANCHOR = `(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, '');
    // 找含「宝贝详情」标题的 struct 块
    const blocks = Array.from(document.querySelectorAll('[id^=struct-], section, div'));
    const detailBlock = blocks.find(el => {
      const t = txt(el);
      return /宝贝详情|图文详情|商品详情/.test(t) && t.length < 60 && el.offsetParent !== null;
    });
    if (detailBlock) return detailBlock;
    // 退化：含「添加」+「图片」的容器
    return blocks.find(el => /添加/.test(txt(el)) && /图片/.test(txt(el)) && txt(el).length < 40 && el.offsetParent !== null) || null;
  })()`
  await page.evaluate(`(() => { const a = ${DETAIL_ANCHOR}; if (a) a.scrollIntoView({block:'center'}); })()`).catch(() => {})
  await sleep(800)

  // ── ② 点「添加」按钮 → 弹「图片/文字」菜单 → 点「图片」──
  const openPicker = `(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, '');
    const vis = (el) => el && el.offsetParent !== null;
    // 找「添加」按钮（详情区左侧悬浮按钮）
    const btns = Array.from(document.querySelectorAll('button,[role=button],div,span,a'));
    const addBtn = btns.find(el => txt(el) === '添加' && vis(el));
    if (!addBtn) return 'no-add';
    addBtn.click();
    return 'clicked-add';
  })()`
  const r1 = await page.evaluate(openPicker).catch(() => 'err')
  if (r1 !== 'clicked-add') return { ok: false, note: '详情图：未找到「添加」按钮，请人工补详情图。' }
  await sleep(700)
  // 点菜单里的「图片」
  await page.evaluate(`(() => {
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, '');
    const vis = (el) => el && el.offsetParent !== null;
    const items = Array.from(document.querySelectorAll('button,[role=button],div,span,a,li'));
    const imgBtn = items.find(el => txt(el) === '图片' && vis(el) && el.children.length <= 2);
    if (imgBtn) imgBtn.click();
  })()`).catch(() => {})
  await sleep(1500)

  // ── ③ 等素材弹层 iframe（#material-select-dialog，同主图弹层）──
  let dlgFrame: any = null
  for (let i = 0; i < 15 && !dlgFrame; i++) {
    await sleep(700)
    for (const f of page.frames()) {
      try {
        const inDialog = await f.evaluate(() => !!document.querySelector('#material-select-dialog')).catch(() => false)
        if (inDialog) { dlgFrame = f; break }
      } catch { /* cross-origin */ }
    }
  }
  if (!dlgFrame) return { ok: false, note: '详情图：素材弹层未就绪，请人工补详情图。' }

  // ── ④ 弹层内找 file input，批量投递本地文件（复刻主图路径 A）──
  let fileInput: any = null
  try {
    const handles = await dlgFrame.$$('#material-select-dialog input[type=file]')
    for (const h of handles) {
      const acc = await h.evaluate((el: any) => (el.getAttribute('accept') || '').toLowerCase()).catch(() => '')
      if (acc.includes('image') || acc.includes('jpg') || acc.includes('jpeg') || acc.includes('png')) { fileInput = h; break }
    }
    if (!fileInput && handles.length) fileInput = handles[0]
  } catch { /* */ }
  if (!fileInput) return { ok: false, note: '详情图：素材弹层内未找到文件 input，请人工补详情图。' }
  await fileInput.uploadFile(...files)
  await sleep(4000 + files.length * 800)

  // ── ⑤ 勾选全部新图 → 点确定（复刻主图路径 A 的选中逻辑）──
  for (let attempt = 0; attempt < 10; attempt++) {
    const st = await dlgFrame.evaluate(() => {
      const dlg = document.querySelector('#material-select-dialog') as HTMLElement | null
      if (!dlg) return { ready: false }
      const imgs = Array.from(dlg.querySelectorAll('img[src]'))
        .filter((im: any) => {
          const s = (im.getAttribute('src') || '').toLowerCase()
          return s.startsWith('http') && !s.includes('data:') && !/logo|icon|avatar/.test(s)
        })
      return { ready: imgs.length > 0 }
    }).catch(() => ({ ready: false }))
    if ((st as any).ready) break
    await sleep(1000)
  }
  await dlgFrame.evaluate(() => {
    const dlg = document.querySelector('#material-select-dialog') as HTMLElement | null
    if (!dlg) return
    const vis = (el: any) => !!el && el.getBoundingClientRect().width > 0
    const cards = Array.from(dlg.querySelectorAll('li,[class*=item],[class*=card],[class*=cell]'))
      .filter((el: any) => vis(el) && el.querySelector('img[src]'))
    for (const c of cards) {
      const cb = c.querySelector('input[type=checkbox]') as any
      if (cb && !cb.checked) cb.click()
      else if (!cb) (c as HTMLElement).click()
    }
  }).catch(() => {})
  await sleep(600)
  await dlgFrame.evaluate(() => {
    const dlg = document.querySelector('#material-select-dialog') as HTMLElement | null
    if (!dlg) return
    const vis = (el: any) => !!el && el.getBoundingClientRect().width > 0
    const okBtn = Array.from(dlg.querySelectorAll('button,[role=button]'))
      .find((el: any) => vis(el) && /确\s*定|确\s*认|完成|选\s*择/.test(((el as HTMLElement).innerText || '').replace(/\s+/g, ''))) as HTMLElement | undefined
    if (okBtn) okBtn.click()
  }).catch(() => {})
  await sleep(2000)

  // ── ⑥ 校验：详情编辑器内图片数 ──
  const cnt = await page.evaluate(`(() => {
    const a = ${DETAIL_ANCHOR};
    if (!a) return 0;
    return a.querySelectorAll('img').length;
  })()`).catch(() => 0) as number
  if (cnt > 0) {
    return { ok: true, note: `详情图已上传并插入 ${cnt} 张（素材弹层，期望 ${files.length} 张）` }
  }
  return { ok: false, note: `详情图上传未确认（弹层已操作但编辑器内无图）。请在浏览器窗口内人工补详情图。` }
}

/**
 * 按关键词定位并填入输入框（input 或 textarea）。
 *
 * 三轮匹配（2026-09 新版发布页实测结论）：
 *   ① 标签锚定：页面里存在文本**恰好等于** labels 之一的标签元素（如「一口价」「总库存」），
 *      从该标签向上最多 6 层找同容器内第一个可见 input。★ 一口价 / 总库存这两个输入框
 *      **没有 placeholder**，只有标签文本可锚定，故标签锚定必须优先。
 *   ② 直接属性：placeholder / name / aria-label 命中关键词。
 *   ③ 祖先链文本：向上 4 层取兄弟与前缀文本，截断后匹配关键词。
 * 写入用原生 setter + input/change/blur 事件，React 受控组件才能接收。
 */
async function fillField(page: any, keywords: RegExp, value: string, labels: string[] = []): Promise<string | null> {
  return await page.evaluate((kwSrc: string, kwFlags: string, v: string, labelList: string[]) => {
    const re = new RegExp(kwSrc, kwFlags)
    const els = Array.from(document.querySelectorAll('input, textarea')) as (HTMLInputElement | HTMLTextAreaElement)[]
    const visible = els.filter(el => {
      if (el.offsetParent === null) return false
      if (el.disabled || el.readOnly) return false
      if (el instanceof HTMLInputElement) {
        const t = (el.type || 'text').toLowerCase()
        if (!['text', 'number', 'search', ''].includes(t)) return false
      }
      return true
    })
    const direct = (el: HTMLInputElement | HTMLTextAreaElement) =>
      [el.placeholder || '', el.name || '', el.getAttribute('aria-label') || ''].join(' ')
    const chain = (el: HTMLElement) => {
      let s = direct(el as HTMLInputElement)
      let cur: HTMLElement | null = el
      for (let i = 0; i < 4 && cur; i++) {
        if (cur.previousElementSibling) s += ' ' + (((cur.previousElementSibling as HTMLElement).innerText) || '')
        cur = cur.parentElement
        if (cur) s += ' ' + (cur.innerText || '').slice(0, 120)
      }
      return s.replace(/\s+/g, ' ')
    }
    const byLabel = (): HTMLInputElement | HTMLTextAreaElement | null => {
      if (!labelList.length) return null
      const norm = (s: string) => (s || '').replace(/\s+/g, '')
      const cands = Array.from(document.querySelectorAll('div,span,label,dt,dd,td,th,p,b')) as HTMLElement[]
      const labelEl = cands.find(e => labelList.includes(norm(e.innerText)) && (e.offsetWidth || e.offsetHeight))
      if (!labelEl) return null
      let cur: HTMLElement | null = labelEl
      for (let i = 0; i < 6 && cur; i++) {
        const inp = visible.find(el => cur!.contains(el))
        if (inp) return inp
        cur = cur.parentElement
      }
      return null
    }
    let hit: HTMLInputElement | HTMLTextAreaElement | null = byLabel()
    if (!hit) hit = visible.find(el => re.test(direct(el))) || null
    if (!hit) hit = visible.find(el => re.test(chain(el))) || null
    if (!hit) return null
    // 类目规则优先：按 DOM 里的 maxlength 截断（类目规定的字符上限压倒默认值）
    let finalVal = v
    const ml = Number(hit.getAttribute('maxlength')) || (hit.maxLength > 0 ? hit.maxLength : 0)
    if (ml > 0 && finalVal.length > ml) finalVal = finalVal.slice(0, ml)
    const proto = hit instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(hit, finalVal); else hit.value = finalVal
    hit.dispatchEvent(new Event('input', { bubbles: true }))
    hit.dispatchEvent(new Event('change', { bubbles: true }))
    hit.dispatchEvent(new Event('blur', { bubbles: true }))
    return (hit.placeholder || hit.name || 'input')
  }, keywords.source, keywords.flags, value, labels).catch(() => null) as string | null
}

/** 一个「类目属性」项（新版发布页 #struct-catProp 下） */
interface TbCatPropItem {
  /** 属性项容器 id（形如 struct-p-20435） */
  id: string
  /** 属性名（已去掉必填星号） */
  name: string
  /** 是否必填（标签带 .sell-component-info-wrapper-required） */
  required: boolean
  /** 是否已有值 */
  filled: boolean
  /** 控件类型：combobox（可输入/可下拉）/ select（只读下拉）/ text（纯输入） */
  kind: 'combobox' | 'select' | 'text'
  /** 文本/combobox 输入框的 maxlength（类目规则的一部分，0/未设=不限） */
  maxlength: number
  /** 字段下方的校验提示文案（如「请选择」「不能超过 X 字」），类目规则的页面体现 */
  hint: string
  /** 当前页面已有值（预填/一键采纳推荐值/本次脚本填的；filled=true 时非空），档案落盘用 */
  value: string
}

/**
 * 读「类目属性」区的全部属性项。
 * ★ 真实实测（2026-09 新版发布页）：
 *   根容器 `#struct-catProp`（class com-struct），每个属性项是 `<div id="struct-p-XXXX">`，
 *   其表单项容器 id 为 `sell-field-p-XXXX`（**须去掉前缀 `struct-` 再拼 `sell-field-`**），
 *   标签在 `.sell-component-info-wrapper-label`，必填星号在 `.sell-component-info-wrapper-required`。
 */
async function readCatPropItems(page: any): Promise<TbCatPropItem[]> {
  // ★ 属性区是**分批渲染**的：骨架 `struct-p-*` 先出来，`label` 才随后挂上。
  //   先等页面里出现 label（不限定在 #struct-catProp 内，见下）。
  for (let i = 0; i < 24; i++) {
    const ready = await page.evaluate(() => {
      const pItems = document.querySelectorAll('[id^="struct-p-"]').length
      const labels = document.querySelectorAll('label').length
      return pItems > 0 && labels > 0
    }).catch(() => false)
    if (ready) break
    await sleep(500)
  }

  return await page.evaluate(() => {
    const out: { id: string; name: string; required: boolean; filled: boolean; kind: string; maxlength: number; hint: string; value: string }[] = []

    // ★★ 最终确认的读法（2026-10，v9 轮探针坐实）：
    //   发布流程页里有**两套 DOM 并存**：
    //     · 一套是空壳：`#struct-catProp` 里 28 个 `struct-p-*`，内部 0 个 label
    //     · 另一套是真 UI：全页 labelsAll=72，属性名/必填标记都在这里
    //   `getElementById('struct-catProp')` 只拿得到空壳 → 读到 0 项 →
    //   必填项一个都不填 → 提交被「重要属性 0/7」硬拦。
    //
    //   所以改成**从 label 反向定位属性项**：
    //     ① 全页扫 `label.required`（必填）与 `#struct-catProp label`（含非必填）
    //     ② 每个 label 往上找到最近的、带 `struct-p-*` id 或 .sell-catProp-item* 的容器
    //     ③ 该容器即属性项，从中读值控件与已选值
    //   这样不管 UI 挂在哪套 DOM 上都能读全。
    const labelSet = new Set<HTMLElement>()
    for (const l of Array.from(document.querySelectorAll('label.required')) as HTMLElement[]) labelSet.add(l)
    for (const l of Array.from(document.querySelectorAll('#struct-catProp label, [class*="sell-catProp"] label')) as HTMLElement[]) labelSet.add(l)
    // 兜底：属性区里所有 label（有些版本不给 required 类）
    for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
      const t = (l.innerText || '').trim()
      if (t && t.length <= 12 && l.closest('[class*="catProp"], [id^="struct-p-"]')) labelSet.add(l)
    }
    // ★★ 2026-10-28 补第四路兜底：**直接枚举属性项容器**。
    //   实测 catId=50013618（儿童裤子）页面有 8 个必填属性，label 反查只读到 7 个 ——
    //   「型号」的 label 不在 catProp/struct-p-* 容器里，被前三条规则全漏掉，
    //   于是它从没进待填清单，提交一直卡在「7/8」。
    //   这里按 .sell-catProp-item-common / .sell-catProp-item 正向枚举，
    //   每个容器里找 label 文本当属性名，补上前三路漏掉的项。
    for (const item of Array.from(document.querySelectorAll('.sell-catProp-item-common, .sell-catProp-item')) as HTMLElement[]) {
      if (item.offsetParent === null) continue
      const lb = Array.from(item.querySelectorAll('label') as NodeListOf<HTMLElement>).find(l => (l.innerText || '').trim())
      if (!lb) continue
      labelSet.add(lb)
    }

    for (const labelEl of labelSet) {
      const name = (labelEl.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      if (!name || name.length > 12) continue
      // 往上找属性项容器
      let box: HTMLElement | null = labelEl as HTMLElement
      let itemId = ''
      for (let i = 0; i < 6 && box; i++) {
        const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
        if (cand) {
          // 校验这个容器里确实有值控件（避免拿到过大的外层）
          if (cand.querySelector('.next-select, .next-select-trigger, input')) {
            box = cand
            const idEl = cand.id ? cand : (cand.querySelector('[id^="struct-p-"]') as HTMLElement | null)
            itemId = idEl?.id || ''
            break
          }
        }
        box = box.parentElement
      }
      if (!box) continue

      const required = !!box.querySelector('label.required')
        || /(^|\s)required(\s|$)/.test(String(labelEl.className || ''))

      const sel = box.querySelector('.next-select, .next-select-trigger') as HTMLElement | null
      const inp = box.querySelector('input, textarea') as HTMLInputElement | null
      const kind = sel ? (box.querySelector('.next-select-auto-complete') ? 'combobox' : 'select') : 'text'

      const shown = ((box.querySelector('.next-select-values') as HTMLElement | null)?.innerText || '').trim()
      const val = (inp?.value || '').trim()
      const placeholder = /^(请选择|请输入|请填写|—|-)$/
      const curVal = (!placeholder.test(shown) ? shown : '') || (!placeholder.test(val) ? val : '')
      const isMaterial = /材质/.test(name)
      const hasAddBtn = !!Array.from(box.querySelectorAll('button, .next-btn'))
        .find(b => /添加材质成分/.test(b.textContent || ''))
      const filled = isMaterial ? (hasAddBtn ? false : !!curVal) : !!curVal

      const ml = inp ? (Number(inp.getAttribute('maxlength')) || (inp.maxLength > 0 ? inp.maxLength : 0)) : 0
      const hintEl = box.querySelector('.next-form-item-help, [class*="help"], [class*="explain"]') as HTMLElement | null
      const hint = (hintEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)

      // id 去重（同名属性只留一条）
      if (out.some(o => o.name === name)) continue
      out.push({ id: itemId || `label:${name}`, name, required, filled, kind, maxlength: ml, hint, value: curVal })
    }
    return out
  }).catch(() => []) as TbCatPropItem[]
}

/**
 * 展开某个类目属性的下拉面板。
 * ★ 关键实测结论：淘宝 next 组件只有 **JS 原生 `element.click()`** 能展开下拉，
 *   `page.mouse.move/down/up`、`page.click()`、`focus()+ArrowDown` 全部无效（曾误判为「无下拉」）。
 */
async function openPropDropdown(page: any, id: string): Promise<boolean> {
  return await page.evaluate((sid: string) => {
    // id 可能形如 `struct-p-XXXX`（正常）或 `label:属性名`（反查兜底时拿不到容器 id）
    let field: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      // 按属性名找 label，再向上定位带值控件的容器
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const t = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (t !== want) continue
        let box: HTMLElement | null = l
        for (let i = 0; i < 6 && box; i++) {
          const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, .next-select-trigger, input')) { field = cand; break }
          box = box.parentElement
        }
        if (field) break
      }
    } else {
      field = document.getElementById(sid)
        || document.getElementById('sell-field-' + sid.replace(/^struct-/, ''))
    }
    if (!field) return false
    const trigger = (field.querySelector('.next-select-auto-complete')
      || field.querySelector('.next-select-trigger')
      || field.querySelector('.next-select')
      || field.querySelector('input')) as HTMLElement | null
    if (!trigger) return false
    try { trigger.scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }
    trigger.click()
    return true
  }, id).catch(() => false) as boolean
}

/**
 * 读「当前已展开」的下拉面板里的真实选项。
 * ★ 面板挂在 body 级 portal：`.next-overlay-wrapper.opened`
 *   → `.next-overlay-inner.next-select-popup-wrap.sell-o-select-popup-overlay`
 *   → `.sell-o-select-options` → `.options-content` → `.options-item[title=...]`。
 *   取**文档中最后一个可见面板**（即最近展开的那个），只读真实选项，绝不凭空造值。
 */
async function readPropOptions(page: any): Promise<string[]> {
  return await page.evaluate(() => {
    const panels = (Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[])
      .filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out: string[] = []
    const seen = new Set<string>()
    const nodes = Array.from(
      panel.querySelectorAll('.options-item, li, .next-menu-item, [role="option"]'),
    ) as HTMLElement[]
    for (const n of nodes) {
      if (n.offsetParent === null) continue
      const t = (n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 40 || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => []) as string[]
}

/**
 * 等待 next 下拉面板展开（100ms 步进轮询，而非固定 sleep）。
 * 实测面板 200-400ms 即渲染好，固定 sleep 白等 60-75% 时间；
 * 超时上限取 attrDropdownWaitMs 与 2000ms 的较大者。
 */
async function waitForPropPanel(page: any, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(timeoutMs, 2000)
  while (Date.now() < deadline) {
    const has = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[]
      return panels.some(p => p.offsetParent !== null)
    }).catch(() => false)
    if (has) return true
    await sleep(100)
  }
  return false
}

/** 在已展开的下拉面板里点中文本完全匹配的选项（同样用 JS 原生 click） */
async function clickPropOption(page: any, text: string): Promise<boolean> {
  return await page.evaluate((t: string) => {
    const panels = (Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[])
      .filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return false
    const nodes = Array.from(
      panel.querySelectorAll('.options-item, li, .next-menu-item, [role="option"]'),
    ) as HTMLElement[]
    const hit = nodes.find(n => n.offsetParent !== null
      && ((n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim() === t))
    if (!hit) return false
    hit.click()
    return true
  }, text).catch(() => false) as boolean
}

/**
 * combobox 型属性（如「品牌」）的填值：click 选项对 next-select-auto-complete 无效
 * （2026-10 真机实测：点第一个候选后 .next-select-values 仍空、「重要属性 0/2」不变）。
 * 必须**键入文字 → 等候选刷新 → 点中匹配项**，值才会进 React state。
 *
 * ★ 2026-10-28 补强（照抄 pdd-publish.js）：
 *   - 键入必须走**原型链原生 value setter**，直接 `inp.value = x` 会被 React 丢弃；
 *   - 面板没自动展开时主动点 trigger 重试（部分 next combobox 键入不出面板）；
 *   - 三轮仍点不中选项时，回读「键入文本是否已被 React 认下」当成功（有些 combobox 输完即提交值）。
 *
 * @param id 属性项 id（struct-p-XXXX 或 label:名称）
 * @param text 要填入的品牌/文本
 */
async function fillComboboxProp(page: any, id: string, text: string): Promise<boolean> {
  const t = String(text || '').trim()
  if (!t) return false

  // ① 定位输入框并键入
  const typed = await page.evaluate((sid: string, val: string) => {
    let box: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (name !== want) continue
        let b: HTMLElement | null = l
        for (let i = 0; i < 6 && b; i++) {
          const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('input')) { box = cand; break }
          b = b.parentElement
        }
        if (box) break
      }
    } else {
      box = document.getElementById(sid)
    }
    if (!box) return { ok: false, why: 'box not found' }
    const inp = box.querySelector('input') as HTMLInputElement | null
    if (!inp) return { ok: false, why: 'no input' }
    // ★ React 受控输入框：必须取原型链上的原生 value setter，
    //   否则 React 内部记录的 value 不变，后续 onChange 拿到的还是旧值（照抄 pdd-publish.js）。
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    inp.focus()
    inp.click()
    if (desc && desc.set) desc.set.call(inp, val)
    else inp.value = val
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: inp.value }
  }, id, t).catch((e: any) => ({ ok: false, why: String(e) })) as any
  if (!typed?.ok) return false

  // ② 等候选刷新后点中匹配项；面板未自动展开则主动点 trigger 重试
  let clicked = false
  for (let round = 0; round < 3 && !clicked; round++) {
    if (round > 0) {
      await page.evaluate((sid: string) => {
        let box: HTMLElement | null = sid.startsWith('label:') ? null : document.getElementById(sid)
        if (!box) {
          const want = sid.slice(6)
          for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
            const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
            if (name !== want) continue
            let b: HTMLElement | null = l
            for (let i = 0; i < 6 && b; i++) {
              const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
              if (cand) { box = cand; break }
              b = b.parentElement
            }
            if (box) break
          }
        }
        const trig = box?.querySelector('.next-select-trigger, .next-select, [class*="select"]') as HTMLElement | null
        if (trig) trig.click()
      }, id).catch(() => { })
      await sleep(700)
    }
    clicked = await page.evaluate((val: string) => {
      const panels = (Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[])
        .filter(p => p.offsetParent !== null)
      const panel = panels[panels.length - 1]
      if (!panel) return false
      const nodes = Array.from(
        panel.querySelectorAll('.options-item, li, .next-menu-item, [role="option"]'),
      ) as HTMLElement[]
      const vis = nodes.filter(n => n.offsetParent !== null)
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
      // ★ 只认 .options-item（真机实测）：[class*="option"] 会命中
      //   .sell-o-select-options / .options-content 这类**容器**（文本含全部候选），
      //   点到容器上不选中任何值，还会让「确认，下一步」永远不解禁。
      const hit = vis.find(n => norm(n.getAttribute('title') || n.innerText) === val)
        || vis.find(n => norm(n.innerText).includes(val))
      if (!hit) return false
      hit.click()
      return true
    }, t).catch(() => false) as boolean
    if (!clicked) await sleep(500)
  }
  await sleep(500)

  // ③ 点不到选项时，确认键入的文本是否已被 React 认下
  if (!clicked) {
    return await page.evaluate((sid: string, val: string) => {
      let box: HTMLElement | null = sid.startsWith('label:') ? null : document.getElementById(sid)
      if (!box) {
        const want = sid.slice(6)
        for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
          const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
          if (name !== want) continue
          let b: HTMLElement | null = l
          for (let i = 0; i < 6 && b; i++) {
            const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
            if (cand) { box = cand; break }
            b = b.parentElement
          }
          if (box) break
        }
      }
      if (!box) return false
      const inp = box.querySelector('input') as HTMLInputElement | null
      const shown = ((box.querySelector('.next-select-values') as HTMLElement | null)?.innerText || '').trim()
      return (!!inp && inp.value === val) || shown === val || shown.includes(val)
    }, id, t).catch(() => false) as boolean
  }
  return true
}

/**
 * 填「材质成分」这类**行式复合属性**（按钮 + 就地增行 + 每行一个下拉）。
 *
 * ★ 2026-10-28 真机实测（catId=50013618 儿童裤子）：
 *   - 「材质成分」容器 `struct-p-149422948`，**不是普通下拉**：它有「添加材质成分」按钮，
 *     点了**就地新增一行**（不是弹窗），每行一个 `input[请选择材质]` 下拉 + 「删除」。
 *   - 此前 readCatPropItems 因容器里有 .next-select 就判成 kind='select'，
 *     于是去点下拉 → 填不进表格 → 提交仍报「类目属性 必填项未填」。
 *   - 提示文案：「您最多可填写7种材质…若不填写【含量】，请按照【材质】的重要程度从高到低填写」
 *     → **含量可空**，只选材质即可过校验。
 *
 * @param id 属性项 id（struct-p-XXXX 或 label:名称）
 * @param value 材质名（如「棉」「纯棉」）
 */
async function fillMaterialRows(page: any, id: string, value: string): Promise<boolean> {
  const v = String(value || '').trim()
  if (!v) return false

  // ① 若已有一行且已填，直接算成功
  const already = await page.evaluate((sid: string) => {
    let box: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (name !== want) continue
        let b: HTMLElement | null = l
        for (let i = 0; i < 6 && b; i++) {
          const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
          b = b.parentElement
        }
        if (box) break
      }
    } else {
      box = document.getElementById(sid)
    }
    if (!box) return false
    const shown = ((box.querySelector('.next-select-values') as HTMLElement | null)?.innerText || '').trim()
    const inp = box.querySelector('input[placeholder*="材质"]') as HTMLInputElement | null
    return !!(shown && shown !== '请选择') || !!(inp && inp.value && inp.value !== '请选择')
  }, id).catch(() => false) as boolean
  if (already) return true

  // ② 没有已填行 → 点「添加材质成分」就地增一行（真实鼠标点击）
  const addBtn = await page.evaluate((sid: string) => {
    let box: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (name !== want) continue
        let b: HTMLElement | null = l
        for (let i = 0; i < 6 && b; i++) {
          const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
          b = b.parentElement
        }
        if (box) break
      }
    } else {
      box = document.getElementById(sid)
    }
    if (!box) return null
    const btn = Array.from(box.querySelectorAll('button, .next-btn') as NodeListOf<HTMLElement>)
      .find(b => /添加材质成分/.test((b.textContent || '').trim()) && b.offsetParent !== null)
    if (!btn) return null
    btn.scrollIntoView({ block: 'center' })
    const r = btn.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, id).catch(() => null) as { x: number; y: number } | null
  if (addBtn) {
    await page.mouse.move(addBtn.x, addBtn.y).catch(() => {})
    await sleep(200)
    await page.mouse.click(addBtn.x, addBtn.y).catch(() => {})
    await sleep(1500)
  }

  // ③ 在新增的「请选择材质」行里选值
  //    先尝试直接点该行的 trigger 展开下拉；展开后用面板搜索过滤（同品牌）
  const openedRow = await page.evaluate((sid: string) => {
    let box: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (name !== want) continue
        let b: HTMLElement | null = l
        for (let i = 0; i < 6 && b; i++) {
          const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, input, button')) { box = cand; break }
          b = b.parentElement
        }
        if (box) break
      }
    } else {
      box = document.getElementById(sid)
    }
    if (!box) return null
    // 取**最后一个**未填的「请选择材质」行（刚增的那行）
    const inps = Array.from(box.querySelectorAll('input[placeholder*="材质"]')) as HTMLInputElement[]
    const empty = inps.filter(i => !i.value || i.value === '请选择材质')
    const target = empty[empty.length - 1] || inps[inps.length - 1]
    if (!target) return null
    target.scrollIntoView({ block: 'center' })
    const r = target.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, id).catch(() => null) as { x: number; y: number } | null

  if (!openedRow) return false
  await page.mouse.move(openedRow.x, openedRow.y).catch(() => {})
  await sleep(200)
  await page.mouse.click(openedRow.x, openedRow.y).catch(() => {})
  await sleep(1200)

  // ④ 读候选 → 搜索过滤 → 点中
  let options = await readPropOptions(page)
  const normOpt = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()
  const hit = (arr: string[]) => {
    const exact = arr.find(o => normOpt(o) === v)
    if (exact) return exact
    const cands = arr.filter(o => normOpt(o).includes(v) || v.includes(normOpt(o)))
    // 最短优先（「棉」应命中「棉」而非「棉混纺」）
    return cands.sort((x, y) => normOpt(x).length - normOpt(y).length)[0] || null
  }
  let target = hit(options)
  if (!target) {
    const filtered = await searchInOpenSelect(page, v)
    if (filtered.length) {
      options = filtered
      target = hit(filtered)
    }
  }
  if (!target) {
    await closePropDropdown(page)
    return false
  }
  const ok = await clickPropOption(page, target)
  await sleep(600)
  return ok
}

/**
 * 在**已展开**的下拉面板里用隐藏搜索框过滤候选，返回过滤后的选项。
 *
 * ★ 为什么需要（2026-10-28 真机实测）：淘宝 next-select 候选常只渲染首屏
 *   （类目「品牌」实测 16 项，`Uniqlo/优衣库` 排在 U 段不在首屏），
 *   而面板里有个隐藏 search input（`input[type="search"]` / `.next-select-search input`），
 *   键入即过滤。没有这一步，显式品牌值永远匹配不上，只能掉进必填兜底。
 *
 * 返回过滤后的候选数组；无搜索框 / 无结果返回空数组（调用方保持原 options）。
 */
async function searchInOpenSelect(page: any, keyword: string): Promise<string[]> {
  const kw = String(keyword || '').trim()
  if (!kw) return []
  // ① 定位搜索框并键入（React 受控：走原生 value setter）
  const typed = await page.evaluate((k: string) => {
    const panels = (Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[])
      .filter(p => p.offsetParent !== null)
    const p = panels[panels.length - 1]
    if (!p) return false
    const s = (p.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')
      || p.parentElement?.querySelector('input[type="search"], .next-select-search input, input:not([readonly])')) as HTMLInputElement | null
    if (!s) return false
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    s.focus()
    if (desc?.set) desc.set.call(s, k); else s.value = k
    s.dispatchEvent(new Event('input', { bubbles: true }))
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, kw).catch(() => false) as boolean
  if (!typed) return []
  // ② 等候选真的被过滤（轮询到「候选数 < 键入前的数量」或 2.5s 超时）
  //   ★ 不能只等面板存在：面板本来就在，键入后候选是异步过滤的。
  //     早先版本只 waitForPropPanel → 读到的还是未过滤的完整列表，
  //     日志显示「命中 14 项」但候选仍是 0-3/007/00后...，搜索形同没做。
  const beforeCount = await readPropOptions(page).catch(() => []) as string[]
  const deadline = Date.now() + 2500
  let out: string[] = []
  while (Date.now() < deadline) {
    await sleep(250)
    out = await readPropOptions(page).catch(() => []) as string[]
    if (out.length && (beforeCount.length === 0 || out.length < beforeCount.length)) break
  }
  // ③ 读过滤后的候选
  if (!out.length) out = await readPropOptions(page).catch(() => []) as string[]
  // ④ 清空搜索词，避免污染下一次读取
  await page.evaluate(() => {
    const panels = (Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[]).filter(p => p.offsetParent !== null)
    const p = panels[panels.length - 1]
    const s = p?.querySelector('input[type="search"], .next-select-search input, input:not([readonly])') as HTMLInputElement | null
    if (!s) return
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(s), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (desc?.set) desc.set.call(s, ''); else s.value = ''
    s.dispatchEvent(new Event('input', { bubbles: true }))
  }).catch(() => { })
  return out
}

/** 点选后回读属性项，确认值确实落到了控件上（选中值可能写在 input.value 或 .next-select-values 文本里） */
async function verifyPropValue(page: any, id: string, value: string): Promise<boolean> {
  return await page.evaluate((sid: string, v: string) => {
    let field: HTMLElement | null = null
    if (sid.startsWith('label:')) {
      const want = sid.slice(6)
      for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
        const t = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
        if (t !== want) continue
        let box: HTMLElement | null = l
        for (let i = 0; i < 6 && box; i++) {
          const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
          if (cand && cand.querySelector('.next-select, .next-select-trigger, input')) { field = cand; break }
          box = box.parentElement
        }
        if (field) break
      }
    } else {
      field = document.getElementById(sid)
        || document.getElementById('sell-field-' + sid.replace(/^struct-/, ''))
    }
    if (!field) return false
    const norm = (s: string) => (s || '').replace(/\s+/g, '')
    const want = norm(v)
    if (norm(field.innerText).includes(want)) return true
    for (const el of Array.from(field.querySelectorAll('input, textarea'))) {
      if (norm((el as HTMLInputElement).value || '').includes(want)) return true
    }
    return false
  }, id, value).catch(() => false) as boolean
}

/** 收起下拉面板（next overlay 通常带关闭按钮，退而用 Esc 触发外部点击关闭） */
async function closePropDropdown(page: any): Promise<void> {
  const closed = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')) as HTMLElement[]
    const p = panels[panels.length - 1]
    if (!p) return true
    const close = p.querySelector('.next-overlay-close') as HTMLElement | null
    if (close) { close.click(); return true }
    return false
  }).catch(() => false) as boolean
  if (!closed) await page.keyboard.press('Escape').catch(() => { /* 忽略 */ })
}

/**
 * 惰性加载宿主 LLM 包的 `BlockAssembler`（把流式分片拼成内容块的官方算法）。
 *
 * ★ 与 pdd-publish 同一处坑：本文件被 `dev/publish-taobao.mjs` 在**普通 node**
 *   （无宿主模块回退）下直接 import，静态 import `@deepseek-ai/dsh-llm` 会让
 *   `lib/taobao-publish.js` 整个加载失败（ERR_MODULE_NOT_FOUND）。
 *   动态 import 只在真正要调宿主模型时求值，失败被 catch 吞掉 → 属性区降级。
 */
let blockAssemblerCtor: (new () => {
  push(chunk: unknown): void
  blocks(): Array<{ type: string; text?: string }>
  readonly finish: { kind: string }
}) | undefined
async function loadBlockAssembler() {
  if (!blockAssemblerCtor) {
    const mod: any = await import('@deepseek-ai/dsh-llm')
    blockAssemblerCtor = mod.BlockAssembler
  }
  return blockAssemblerCtor!
}

/**
 * 让文本模型从**页面真实选项**里为某类目属性挑一个值。
 * ★ 安全边界：只接受「原样命中候选值」的返回 —— 模型改写、编造或返回 null 一律当作放弃，
 *   宁可标「未自动填」也不许它自由发挥（类目属性填错会导致商品被下架或流量损失）。
 * ★ 取值优先级：① 宿主聊天模型句柄（ctx.model，对齐 pdd）→ 不可用则返回 null（由人工确认）。
 */
async function pickPropValue(
  attrName: string,
  options: string[],
  ctx: { title: string; model?: AttrModelHandle },
): Promise<{ value: string; hesitated: boolean; candidates: number } | null> {
  if (!options.length) return null
  const sys = '你是电商商品发布助手。根据商品标题，从「候选值」中为该属性挑选最合适的一个。\n'
    + '硬性规则：① 只能原样返回候选值中的一个，不得改写、不得创造新值；\n'
    + '② 只要有一个候选值与商品标题明显契合就必须选它（多选属性也只需选最契合的一个）；\n'
    + '③ 只有候选值全部明显不相关时才返回 null。\n'
    + '只输出 JSON，形如 {"value":"候选值原文"} 或 {"value":null}，不要输出任何解释。'
  const user = `商品标题：${ctx.title}\n属性名：${attrName}\n候选值：${options.join(' / ')}`

  // 统一的「从原始文本解析出候选值」逻辑（两种后端共用）
  const parse = (raw: string): { value: string; hesitated: boolean; candidates: number } | null => {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonText) {
      console.warn(`[dsagent-taobao-publish] 属性「${attrName}」模型未返回 JSON：${raw.slice(0, 120)}`)
      return null
    }
    const v = (JSON.parse(jsonText) as { value?: unknown })?.value
    const picked = typeof v === 'string' ? v.trim() : ''
    if (!picked) {
      console.warn(`[dsagent-taobao-publish] 属性「${attrName}」模型判定候选均不相关，跳过（由人工确认）`)
      return null
    }
    // 犹豫信号：模型返回了值但不在候选里 —— 它想改写/编造，按放弃处理但标记犹豫
    if (!options.includes(picked)) {
      console.warn(`[dsagent-taobao-publish] 属性「${attrName}」模型返回「${picked}」不在候选中，按放弃处理`)
      return null
    }
    return { value: picked, hesitated: false, candidates: options.length }
  }

  // ── ① 宿主聊天模型句柄（推荐路径，无需任何环境变量）──
  if (ctx.model) {
    try {
      const BlockAssembler = await loadBlockAssembler()
      const assembler = new BlockAssembler()
      let finished = false
      for await (const chunk of ctx.model.stream({
        provider: ctx.model.provider,
        model: ctx.model.model,
        system: sys,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        temperature: 0,
        maxTokens: 200,
        signal: AbortSignal.timeout(ATTR_MODEL_TIMEOUT_MS),
      })) {
        if (finished) break
        assembler.push(chunk)
        if ((chunk as { type?: string })?.type === 'finish') finished = true
      }
      // 只有正常收尾（stop）才采信输出；错误/取消/截断一律放弃
      if (!finished || assembler.finish.kind !== 'stop') return null
      const raw = assembler.blocks().filter(b => b.type === 'text').map(b => b.text || '').join('')
      return parse(raw)
    } catch (e) {
      console.warn(`[dsagent-taobao-publish] 属性「${attrName}」宿主模型异常：${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  return null
}

/**
 * ★ 复刻上架助手 6.33 的核心设计：点「一键采纳推荐值」按钮，让平台 AI 自动填属性。
 *
 * 上架助手走 MTOP `mtop.taobao.sell.wireless.ai.publish.render`，平台侧 AI 直接返回推荐属性值；
 * 网页发布表单的等价功能是页面上的「一键采纳推荐值」按钮（填写率提示如 26%）。
 * 这比外部 LLM 逐项选值更准确、更快、且不会张冠李戴。
 *
 * ★ 真实实测（2026-10）：按钮文本含「采纳推荐值」或「一键采纳」，通常位于类目属性区顶部或底部。
 *   点击后页面逐项填入平台推荐值（部分项可能无推荐 → 仍为空，需后续补）。
 */
async function adoptRecommendations(page: any): Promise<boolean> {
  // ★ 先滚动到类目属性区，触发懒加载渲染
  await page.evaluate(() => {
    const cat = document.getElementById('struct-catProp')
    if (cat) cat.scrollIntoView({ behavior: 'instant', block: 'start' })
    else window.scrollTo(0, document.body.scrollHeight / 3)
  }).catch(() => {})
  await sleep(1000)

  // 轮询等待「一键采纳推荐值」按钮渲染——按钮可能依赖平台 AI 接口回调，渲染较慢
  // ★ 部分新版页面不再有此按钮（用「填写助手」替代），轮询 15s 即可避免空等
  for (let attempt = 0; attempt < 15; attempt++) {
    const found = await page.evaluate(() => {
      // 用 innerText（合并子元素文本，不受 React 文本拆分影响）
      const all = Array.from(document.querySelectorAll('a, button, span, [role="button"], .next-btn, div')) as HTMLElement[]
      // 精确匹配——叶子元素
      const target = all.find(el => {
        const t = (el.innerText || '').trim()
        return (t === '一键采纳推荐值' || t === '采纳推荐值') && el.offsetParent !== null
      })
      if (target) { (target as HTMLElement).click(); return true }
      // 宽松匹配——含关键词且子元素少
      const target2 = all.find(el => {
        const t = (el.innerText || '').trim()
        return /采纳推荐值|一键采纳|全部采纳/.test(t) && el.offsetParent !== null && el.children.length <= 1
      })
      if (target2) { (target2 as HTMLElement).click(); return true }
      return false
    }).catch(() => false) as boolean
    if (found) {
      console.log('[dsagent-taobao-publish] 已点击「一键采纳推荐值」')
      await sleep(3000)
      return true
    }
    await sleep(1000) // 等待渲染（平台 AI 回调较慢）
  }

  // 诊断：dump 包含「采纳」的元素
  const diag = await page.evaluate(() => {
    const results: string[] = []
    const all = Array.from(document.querySelectorAll('*')) as HTMLElement[]
    for (const el of all) {
      const t = (el.textContent || '').trim()
      if (t && /采纳/.test(t) && el.offsetParent !== null) {
        results.push(`<${el.tagName.toLowerCase()} class="${el.className}" children="${el.children.length}"> text="${t.slice(0, 80)}"`)
        if (results.length >= 10) break
      }
    }
    return results
  }).catch(() => [] as string[]) as string[]
  console.log(`[dsagent-taobao-publish] 未找到「一键采纳推荐值」按钮（轮询 15s）。页面含「采纳」的元素：\n${diag.join('\n') || '(无)'}`)
  return false
}

/**
 * 自动填「类目属性」区。
 *
 * ★ 复刻上架助手 6.33 的设计（优先级从高到低）：
 *   ① 显式 attributes（用户/脚本传了就精确匹配填入）
 *   ② 类目档案 profileStore（g5：平台+catId 精确匹配的长期档案，用户可手编）
 *   ③ 宿主模型句柄 attrModel（对齐 pdd-publish）
 *   ④ 以上全没填 → 在 fillCategoryAttrs 之前先调 adoptRecommendations 点「一键采纳推荐值」
 *
 * ★ 每层都是「命中即验证」：候选里必须仍有该值才用；档案值不在候选 → 降级到下一层
 *   （降级后新值成功生效会随发布成功写回档案 = 自动修复，见 save 的合并语义）。
 * ★ 品牌跳过（品牌授权风险，且选类目页已用 brand 参数填过）。
 * ★ 纯文本类属性不在此处处理（无可选候选，交由人工）。
 * ★ 填失败不阻断发布，只记入 missed 回报。
 *
 * 返回 profile 快照（g5 落盘用）：
 *   - confirmed：本次实际生效的属性（页面预填值 + 本函数确认填上的）
 *   - schemaNames/schemaFp：当前类目属性结构（save 清除已消失的旧属性用）
 */
async function fillCategoryAttrs(
  page: any,
  ctx: {
    title: string
    model?: AttrModelHandle
    explicit?: { name: string; value: string }[]
    /** 发布页 catId（类目档案的精确身份键；空 = 无档案可查/不落档） */
    catId?: string
    /** 渠道键（'taobao'/'tmall'，档案按渠道分开存） */
    platform?: string
    /**
     * 用户显式声明的品牌（来自 `taobaoPublish` 的 opts.brand，即工具的 `brand` 参数）。
     * ★ 非空时「品牌」不参与 ATTR_SKIP_RE 跳过（那是用户对自己品牌的声明，应尊重），
     *   否则品牌是唯一必填属性的类目会永远卡在「重要属性 0/N」发不出去。
     *   仍只在页面真实候选里命中才填，命中不了只记 missed，绝不编造品牌。
     */
    brand?: string
    /** 用户声明的「型号」文本（填「型号」这一必填文本属性用；与 model 句柄是两回事） */
    modelText?: string
  },
): Promise<{ filled: string[]; missed: string[]; confirmed: Record<string, string>; schemaNames: string[]; schemaFp: string; profile: CategoryProfile | null }> {
  const filled: string[] = []
  const missed: string[] = []
  /** 本次确认生效的属性值（档案落盘 patch；含页面预填值，见函数尾部） */
  const confirmedAttrs: Record<string, string> = {}
  /** 档案/日志用的平台键（'taobao'/'tmall'，档案按渠道分开存） */
  const PLATFORM = ctx.platform || 'taobao'
  const explicitMap = new Map((ctx.explicit || []).map(a => [a.name, a.value]))
  // ★ 品牌例外：ATTR_SKIP_RE 默认跳过「品牌」（授权风险，不替用户瞎猜）。
  //   但用户**显式传了 brand**（ctx.brand，来自 dsagent_taobao_publish 的 --brand 或
  //   product 里的 brand 字段）时，那是用户对自己品牌的声明，应当尊重并填入 ——
  //   否则「品牌」是唯一必填属性的类目会永远卡在「重要属性 0/2」发不出去。
  //   仍只在页面真实候选里命中才填，命中不了只记 missed，绝不编造品牌。
  const brandOptIn = String(ctx.brand || '').trim()
  const isSkipped = (name: string) => {
    if (!ATTR_SKIP_RE.test(name)) return false
    if (name === '品牌' && brandOptIn) return false
    return true
  }
  const all = await readCatPropItems(page)
  // ★ 空结果必须显式报警：早先 readCatPropItems 用错了容器选择器（找 sell-field-* 包裹层，
  //   而 v2 页面属性项就是 #struct-p-XXXX 自身），返回空数组后被下游静默当成
  //   「该类目没有属性」——于是必填项一个都没填，提交被「重要属性 0/7」硬拦，
  //   日志里却毫无线索。这里把「读到 0 项」直接打成警告。
  if (!all.length) {
    const probe = await page.evaluate(() => {
      const root = document.getElementById('struct-catProp')
      const pItems = root ? Array.from(root.querySelectorAll('[id^="struct-p-"]')) : []
      // 逐个属性项看它的 label 到底长什么样（含所有 label，不只 .required）
      const detail = pItems.slice(0, 4).map((it: any) => {
        const box = it.closest('.sell-catProp-item-common, .sell-catProp-item') || it
        const labels = Array.from(box.querySelectorAll('label')) as HTMLElement[]
        return {
          id: it.id,
          boxCls: String(box.className).slice(0, 40),
          labelCount: labels.length,
          labelTexts: labels.map(l => (l.innerText || '').trim()).slice(0, 3),
          labelCls: labels.map(l => String(l.className).slice(0, 30)).slice(0, 3),
          innerText: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 60),
        }
      })
      return {
        root: !!root,
        pItems: pItems.length,
        labelsAll: document.querySelectorAll('label').length,
        labelsRequired: document.querySelectorAll('label.required').length,
        labelsInRoot: root ? root.querySelectorAll('label').length : -1,
        detail,
        activeTags: pItems.slice(0, 3).map((e: any) => e.tagName + '#' + e.id),
      }
    }).catch((e: any) => ({ err: String(e) }))
    console.warn(`[dsagent-taobao-publish] ⚠ 类目属性读到 0 项，DOM 探针：${JSON.stringify(probe)}`)
  }
  const schemaNames = all.map(i => i.name)
  const schemaFp = schemaFingerprint(schemaNames)
  // ── 类目档案（g5）：平台+catId 精确匹配；命中的档案作为优先级 ② ──
  let profile: CategoryProfile | null = null
  if (ctx.catId) {
    profile = await profileStore.load(PLATFORM, ctx.catId).catch(() => null)
    if (profile) {
      console.log(`[dsagent-taobao-publish] 类目档案命中（${profile.file || PLATFORM + '-' + ctx.catId}，`
        + `上次更新 ${new Date(profile.updatedAt).toLocaleString()}，属性 ${Object.keys(profile.attributes).length} 项）`)
    }
  }
  // ★ 待填清单：下拉型属性 + 文本型属性。
  //   早先 `i.kind !== 'text'` 把文本型（如「货号」「系列」「吊牌价」）整体排除，
  //   但其中也有必填项，会直接导致「商品属性 >> 必填项未填」。文本型走 fillAttrText。
  const todo = all.filter(i => i.name && !i.filled && !isSkipped(i.name))
  if (all.length) {
    console.log(`[dsagent-taobao-publish] 类目属性共 ${all.length} 项，待填 ${todo.length} 项`
      + `${todo.length ? `：${todo.map(i => i.name).join('、')}` : ''}`
      + `${brandOptIn ? `（品牌按显式声明「${brandOptIn}」参与匹配）` : '（品牌默认跳过：授权风险，未显式声明不填）'}`)
  }

  // ★★ 2026-10-29：属性列表必须**边填边重扫**。
  //   实测 catId=50013618：初始扫描读到 7 项，填完品牌后页面才**动态渲染出「型号」**
  //   （引擎注释早记过「型号字段在品牌选定后才渲染」），于是它从没进待填清单，
  //   提交一直卡「7/8」。这里改成索引循环 + 每轮重读属性列表，新出现的项自动补上。
  let idx = 0
  let guard = 0
  const doneNames = new Set<string>()
  while (guard++ < 40) {
    const current = await readCatPropItems(page).catch(() => [])
    // 新出现且未处理过的项
    const it = current.find(i => i.name && !doneNames.has(i.name) && !isSkipped(i.name))
    if (!it) break
    doneNames.add(it.name)
    console.log(`[dsagent-taobao-publish] 处理属性「${it.name}」（第 ${guard} 轮，当前页面共 ${current.length} 项，kind=${it.kind}, id=${it.id}, filled=${it.filled}）`)

    // ── 材质成分：行式复合属性（按钮增行 + 每行下拉），必须单独处理 ──
    //   ★ 2026-10-28 真机实测：它有「添加材质成分」按钮，点了就地增一行（非弹窗），
    //     容器里也有 .next-select 所以 readCatPropItems 会误判成 kind='select'，
    //     走普通下拉路径填不进表格，提交仍报「类目属性 必填项未填」。
    if (/材质成分|面料成分|主面料成分/.test(it.name)) {
      const matVal = explicitMap.get(it.name)
        || explicitMap.get('材质') || explicitMap.get('主面料成分') || explicitMap.get('面料成分')
      if (!matVal) {
        missed.push(`${it.name}（行式复合属性，未给值；用 --attrs="${it.name}=棉" 指定）`)
        continue
      }
      const done = await fillMaterialRows(page, it.id, matVal)
      if (done) {
        filled.push(`${it.name}=${matVal}（行式复合）`)
        confirmedAttrs[it.name] = matVal
      } else {
        missed.push(`${it.name}=${matVal}（行式填写失败：未能增行或在「请选择材质」里选中）`)
      }
      continue
    }

    // ── 文本型属性（input/textarea，无下拉）──
    if (it.kind === 'text') {
      // ★ 2026-10-28：「型号」是常见必填文本项，用户传的 model 参数应优先于占位「无」。
      //   此前只认 explicitMap / 占位，导致 dev 脚本传了 --model=X1 也没填上，
      //   页面一直卡「7/8」。
      const modelOptIn = /^型号$/.test(it.name) ? String(ctx.modelText || '').trim() : ''
      const explicitVal = explicitMap.get(it.name) || modelOptIn
      // 必填文本项：显式值优先，否则给一个占位（避免必填拦截），并记入 missed 提醒人工核对
      const val = explicitVal || (it.required ? '无' : '')
      if (!val) { missed.push(`${it.name}（文本型，未给值）`); continue }
      const done = await fillAttrText(page, it.id, val, it.maxlength)
      if (done) {
        filled.push(`${it.name}=${val}（${explicitVal ? '显式' : '必填兜底(文本)'}）`)
        confirmedAttrs[it.name] = val
        if (!explicitVal) missed.push(`${it.name}（必填，已占位「${val}」，建议人工确认）`)
      } else {
        missed.push(`${it.name}（文本填写失败）`)
      }
      continue
    }

    // ── combobox 型属性（如「品牌」：键入 → 选中，click 选项无效）──
    if (it.kind === 'combobox') {
      // ★ 只有「品牌」才用 brandOptIn 兜底。
      //   实测「型号」也是 combobox（id=struct-p-20000-13583604），此前无条件用
      //   brandOptIn 兜底 → 把型号填成了品牌的值（「型号=巴拉巴拉」）。
      const explicitVal = explicitMap.get(it.name)
        || (it.name === '品牌' ? brandOptIn : '')
        || (/^型号$/.test(it.name) ? String(ctx.modelText || '').trim() : '')
      if (!explicitVal) {
        missed.push(`${it.name}（combobox，未给值；品牌类请用 brand 参数显式声明）`)
        continue
      }
      const done = await fillComboboxProp(page, it.id, explicitVal)
      if (done) {
        filled.push(`${it.name}=${explicitVal}（显式）`)
        confirmedAttrs[it.name] = explicitVal
      } else {
        missed.push(`${it.name}=${explicitVal}（combobox 键入/选中失败，请人工补填）`)
      }
      continue
    }

    const opened = await openPropDropdown(page, it.id)
    if (!opened) { missed.push(`${it.name}（未能展开下拉）`); continue }
    await waitForPropPanel(page, ATTR_DROPDOWN_WAIT_MS)
    let options = await readPropOptions(page)
    // ★★ 2026-10-28 防护：选项归属校验。
    //   readPropOptions 取「最后一个可见面板」。若上一个属性的面板没关干净、
    //   或多个面板同时存在，读到的就是**别的属性**的候选 —— 实测连衣裙类目
    //   因此把「适用年龄」的候选「0-3」当成了品牌的候选，误填成「品牌=0-3」。
    //   这里用「当前属性项是否处于激活态」交叉验证：激活态说明刚展开的面板
    //   确实属于它；不激活则关掉面板重开一次再读。
    if (options.length) {
      const ownerOk = await page.evaluate((sid: string) => {
        let box: HTMLElement | null = null
        if (sid.startsWith('label:')) {
          const want = sid.slice(6)
          for (const l of Array.from(document.querySelectorAll('label')) as HTMLElement[]) {
            const name = (l.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
            if (name !== want) continue
            let b: HTMLElement | null = l
            for (let i = 0; i < 6 && b; i++) {
              const cand = b.closest('.sell-catProp-item-common, .sell-catProp-item, [id^="struct-p-"]') as HTMLElement | null
              if (cand && cand.querySelector('.next-select, input')) { box = cand; break }
              b = b.parentElement
            }
            if (box) break
          }
        } else {
          box = document.getElementById(sid)
        }
        if (!box) return false
        // 激活态：属性项自身带 next-active，或其内部 input 是 document.activeElement
        if (/next-active/.test(String(box.className || ''))) return true
        const inp = box.querySelector('input')
        return !!inp && document.activeElement === inp
      }, it.id).catch(() => false) as boolean
      if (!ownerOk) {
        console.log(`[dsagent-taobao-publish] 属性「${it.name}」展开的面板可能不归属它，关掉重开后重读`)
        await closePropDropdown(page)
        await sleep(400)
        await openPropDropdown(page, it.id).catch(() => {})
        await waitForPropPanel(page, ATTR_DROPDOWN_WAIT_MS)
        const re = await readPropOptions(page)
        if (re.length) options = re
      }
    }
    if (!options.length) {
      await closePropDropdown(page)
      missed.push(`${it.name}（下拉未读到选项）`)
      continue
    }

    // ★★ 2026-10-28（真机实测）：淘宝 next-select 的候选常**只渲染首屏**
    //   （品牌 16 项，`Uniqlo/优衣库` 排在 U 段根本不在首屏），且面板内有隐藏搜索框。
    //   显式值不在首屏候选里时，用面板搜索框过滤后再匹配 —— 否则品牌永远填不上，
    //   只能掉进「必填兜底」。搜索命中后 options 同步更新为过滤结果。
    //   品牌在部分类目是**纯 select**（只读 input + 下拉点选，无 .next-select-auto-complete），
    //   此前只在 combobox 分支认 brandOptIn，导致 select 型品牌掉进必填兜底取首项，
    //   实测连衣裙类目填出「品牌=0-3」（淘宝真有个叫 0-3 的童装品牌，它是候选首项）。
    const explicitVal = explicitMap.get(it.name) || (it.name === '品牌' ? brandOptIn : '')
    if (explicitVal && !options.includes(explicitVal)) {
      const filtered = await searchInOpenSelect(page, explicitVal)
      if (filtered.length) {
        console.log(`[dsagent-taobao-publish] 属性「${it.name}」显式值不在首屏，搜索「${explicitVal}」后命中 ${filtered.length} 项：${filtered.slice(0, 4).join('/')}`)
        options = filtered
      }
    }

    let pick: { value: string; hesitated: boolean; candidates: number } | null = null
    let source = ''

    // ── ① 显式值优先（精确匹配页面真实候选）──
    // ★★ 空值必须直接跳过：模糊匹配用 `''` 会恒真（x.includes('') === true），
    //   把**任意**属性误判成「显式命中」，实测把「裙型」填成了最短候选「纱裙」。
    const normOpt = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()
    const wantOpt = normOpt(explicitVal)
    const exact = wantOpt ? options.find(o => normOpt(o) === wantOpt) : undefined
    const fuzzy = exact || (wantOpt ? options
      .filter(o => {
        const a = normOpt(o)
        return a.includes(wantOpt) || wantOpt.includes(a)
      })
      // ★ 优先取**最接近用户原意**的，不是最短：
      //   实测「优衣库」的候选是 `Uniqlo/优衣库` 与 `优衣库种草社`，
      //   「取最短」会选中衍生词「种草社」（6 字 < 11 字），而正主是前者。
      //   排序规则：① 不含衍生词后缀（店/社/旗/专营/分销/代理/直销/定制）优先
      //            ② 候选以目标值结尾优先（Uniqlo/优衣库 正是 /优衣库 结尾）
      //            ③ 仍同分则取更短（更接近原词）
      .sort((x, y) => {
        const a = normOpt(x)
        const b = normOpt(y)
        const DERIV = /(店|社|旗|专营|分销|代理|直销|定制|工厂|实业)$/
        const da = DERIV.test(a) ? 1 : 0
        const db = DERIV.test(b) ? 1 : 0
        if (da !== db) return da - db
        const ea = a.endsWith(wantOpt) ? 0 : 1
        const eb = b.endsWith(wantOpt) ? 0 : 1
        if (ea !== eb) return ea - eb
        return a.length - b.length
      })[0] : undefined)
    if (fuzzy) {
      pick = { value: fuzzy, hesitated: false, candidates: options.length }
      source = exact ? '显式' : '显式(模糊)'
    }

    // ── ② 类目档案（g5）：平台+catId 档案里上次生效的值，仍在当前候选里就直接用 ──
    //    ★ 命中即验证：不在候选 → 降级走 ③模型（新值生效后随成功写回 = 自动修复）。
    //    ★★ 2026-10-28 防护（真机踩坑）：品牌/型号这类**身份型**属性的档案值不可信 ——
    //       实测 catId=121452038（连衣裙）时，品牌被读成 select 型、readPropOptions 又读到了
    //       别的属性（适用年龄）的候选「0-3」，而旧档案里恰有 `0-3`，于是误命中成「品牌=0-3」。
    //       这类值一旦写入就会污染后续所有同类目发布。故身份型属性一律跳过档案，
    //       只认显式声明 / 页面真实候选。
    const isIdentityProp = /^(品牌|型号|货号|条形码|barcode)$/i.test(it.name)
    if (!pick && profile && !isIdentityProp) {
      const profileVal = profile.attributes[it.name]
      if (profileVal && options.includes(profileVal)) {
        pick = { value: profileVal, hesitated: false, candidates: options.length }
        source = '档案命中'
      } else if (profileVal) {
        console.log(`[dsagent-taobao-publish] 档案值「${it.name}=${profileVal}」不在当前候选（类目属性候选已变），自动降级重选`)
      }
    }

    // ── ③ 模型选值（宿主模型句柄）──
    if (!pick) {
      pick = await pickPropValue(it.name, options, { title: ctx.title, model: ctx.model })
      if (pick) source = '模型'
    }

    // ── ④ 必填项兜底（无模型 / 模型弃权时）──
    //   ★ 为什么不交给人工：实测儿童裤子类目有 20 项属性、其中十多项带红星，
    //     不填则提交被「商品属性 >> 必填项未填」硬拦（错误(3) 之一）。
    //   ★★ 照抄 pdd-publish.js 的 2026-10-20 真机教训：「盲选第一项」必须废止。
    //      拼多多侧实测踩坑：模型不可用时盲选首项，填出「下装长=短款（商品是长裤）、
    //      适用年龄段=14岁以上（商品110-160cm）、安全等级=A类（实物B类）、领型=挂脖（实物翻领）」——
    //      不是「稍微不准」，而是把商品描述成另一种东西；更糟的是盲选值还会写进档案，
    //      下次同类目直接复用（污染累积）。
    //      因此新策略分级：
    //        ① 标题词匹配命中 → 用（hesitated 标注，便于人工核对）
    //        ② 匹配不到但属性确为必填 → 才允许取首项（不填会卡住提交，两害相权）
    //        ③ 匹配不到且非必填 → 留空，宁可不填也不写错（写错=虚假描述/流量损失）
    if (!pick && options.length) {
      const titleTokens = String(ctx.title || '')
        .replace(/[（）()【】\[\]{}]/g, '')
        .split(/[\s/\\>＞、,，|]+/)
        .filter((t) => t.length >= 2)
      let matched: string | null = null
      for (const tok of titleTokens) {
        const hit = options.find((o) => o.includes(tok) || tok.includes(o))
        if (hit) {
          matched = hit
          break
        }
      }
      if (matched) {
        pick = { value: matched, hesitated: true, candidates: options.length }
        console.log(`[dsagent-taobao-publish] 属性「${it.name}」标题词匹配命中「${matched}」`)
      } else if (it.required) {
        // ★★ 2026-10-28 收口（真机踩坑，比 pdd 侧更严一档）：
        //   连衣裙类目实测，必填兜底取首项填出「面料=PVC（童装裙）、适用年龄=15（女童裙）」。
        //   淘宝的候选顺序**不是按常用度**（品牌首项是「0-3」这个真品牌名），
        //   所以「取首项」在淘宝侧比拼多多侧更危险。
        //   新规则：仅当首项是**语义中性值**时才允许兜底（不影响商品真实描述）；
        //   否则宁可留空并明确报 missed —— 提交会被拦，但拦下来让用户填对的值，
        //   好过一个把商品描述成另一种东西的已发布商品（下架/违规/流量损失都不可逆）。
        const NEUTRAL_RE = /^(无|否|没有|其他|其它|不适用|不含|不涉及|无品牌|无内衬|无弹|不开裆|非定制|不支持|不限|均可以|都可以|通用|未知|待定)$/
        const chosen = options.find(o => NEUTRAL_RE.test(o.trim()))
        if (chosen) {
          pick = { value: chosen, hesitated: true, candidates: options.length }
          console.log(`[dsagent-taobao-publish] 属性「${it.name}」必填且无匹配，取语义中性值「${chosen}」`)
        } else {
          await closePropDropdown(page)
          missed.push(`${it.name}（必填，但无标题词匹配、候选中也无语义中性值，不盲选；候选：${options.slice(0, 8).join('/')}）`)
          continue
        }
      } else {
        await closePropDropdown(page)
        missed.push(`${it.name}（选填项，无匹配候选故留空；候选：${options.slice(0, 8).join('/')}）`)
        continue
      }
    }

    if (!pick) {
      await closePropDropdown(page)
      console.log(`[dsagent-taobao-publish] 属性「${it.name}」候选：${options.join(' / ')}`)
      missed.push(`${it.name}（${it.required ? '必填，' : ''}候选 ${options.length} 项，未选到值）`)
      continue
    }
    const ok = await clickPropOption(page, pick.value)
    await sleep(400)
    const confirmed = ok && await verifyPropValue(page, it.id, pick.value)
    await closePropDropdown(page)
    if (confirmed) {
      const tag = pick.hesitated ? '标题词/兜底' : source
      filled.push(`${it.name}=${pick.value}（${tag}）`)
      confirmedAttrs[it.name] = pick.value
      if (pick.hesitated) {
        missed.push(`${it.name}=${pick.value}（${it.required ? '必填' : '标题词'}兜底，建议人工核对）`)
      }
    } else {
      missed.push(`${it.name}（点选「${pick.value}」${ok ? '后未确认到值' : '失败'}）`)
    }
    // 每处理完一项，等页面稳定再重扫（动态渲染的「型号」等要靠这个窗口出现）
    await sleep(400)
  }

  // ── 档案快照（g5）：本次页面确认生效的全部属性值 = 页面预填值（含一键采纳推荐值）
  //    + 本函数确认填上的。品牌预填值也入档（同类目品牌恒定，但填值仍跳过人工）。
  //    发布成功后以此为 patch 保存档案（save 里 schemaNames 清单外的旧属性自动清除）。
  for (const it of all) {
    if (it.name && it.value) confirmedAttrs[it.name] = it.value
  }

  return { filled, missed, confirmed: confirmedAttrs, schemaNames, schemaFp, profile }
}

/**
 * 物流服务「提取方式」：勾选「使用物流配送」+ 选择运费模板。
 *
 * ★ 真实实测（2026-09）：容器 `#struct-tbExtractWay`（`sell-field-tbExtractWay`）。
 *   1) checkbox 组：`input[type=checkbox][value="2"]` = 使用物流配送，`value="0"` = 电子交易凭证；
 *   2) ★ 只勾 checkbox 校验**仍不通过**（提示「提取方式为必填项，不能为空」）——
 *      勾选后必须再选一个**运费模板**（`next-select-trigger`），否则提交被拦。
 *      模板是店铺真实数据，不能硬编码：展开下拉读真实候选，优先取含「默认模板」的一项，
 *      取不到就取第一项；一项都没有（店铺未配置模板）时只勾选并记 missed，交人工。
 */
async function fillExtractWay(page: any, cachedTemplate?: string | null): Promise<{ ok: boolean; template?: string }> {
  // ★ 2026-10 实测补强：v2 发布页把「物流服务」区做成折叠卡 + 多种容器名，
  //   只查 #struct-tbExtractWay 会整块漏掉（日志表现为「未命中：提取方式」而页面其实有这个区）。
  //   这里按 id → 文本 → 任意含「使用物流配送」的容器逐级找，并支持展开折叠。
  const boxHandle = await page.evaluateHandle(() => {
    const byId = document.getElementById('struct-tbExtractWay')
    if (byId) return byId
    const txt = (e: Element) => (e.textContent || '').replace(/\s+/g, '')
    // 含「使用物流配送」checkbox 的最小可点容器
    for (const el of Array.from(document.querySelectorAll('div, section'))) {
      const t = txt(el)
      if (t.includes('使用物流配送') && t.length < 400 && (el as HTMLElement).offsetParent) {
        const hasBox = el.querySelector('input[type="checkbox"]')
        if (hasBox) return el
      }
    }
    return null
  }).catch(() => null)
  const boxEl = boxHandle ? (boxHandle.asElement()) : null
  if (!boxEl) {
    console.warn('[dsagent-taobao-publish] 提取方式：未找到物流服务区（可能该类目不需要），跳过')
    return { ok: false }
  }

  const checked = await page.evaluate((box: any) => {
    if (!box) return false
    const txt = (e: Element) => (e.textContent || '').replace(/\s+/g, '')
    // 优先 value="2"（使用物流配送）；退化到「文本里带『使用物流配送』的 checkbox」
    let inp = box.querySelector('input[type="checkbox"][value="2"]') as HTMLInputElement | null
    if (!inp) {
      const all = Array.from(box.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
      inp = all.find(i => {
        const lb = i.closest('label')
        return /使用物流配送/.test(txt(lb || i.parentElement || i))
      }) || null
    }
    if (!inp) return false
    if (inp.checked) return true
    // 折叠卡：先点开（不影响 checkbox 时无害）
    const label = inp.closest('label') as HTMLElement | null
    ;(label || inp).click()
    if (!inp.checked) {
      // 有些版本用自定义 UI：点 label 后仍 false → 直接派发一次原生 click
      try { inp.click() } catch { /* 忽略 */ }
    }
    return !!inp.checked || true
  }, boxEl).catch(() => false) as boolean
  if (!checked) {
    console.warn('[dsagent-taobao-publish] 提取方式：区内没找到「使用物流配送」勾选项')
    return { ok: false }
  }
  await sleep(800)

  // ① 展开运费模板下拉（next 组件必须用 JS 原生 click）
  const opened = await page.evaluate((box: any) => {
    if (!box) return false
    // 触发器的几种形态：next-select-trigger / 含「请选择」文案的 .next-select / 带 next-select 类的任意元素
    const cands = [
      box.querySelector('.next-select-trigger'),
      box.querySelector('.next-select'),
      ...Array.from(box.querySelectorAll('[class*="next-select"]')),
    ].filter(Boolean) as HTMLElement[]
    const trigger = cands.find(el => el.offsetParent !== null) || cands[0]
    if (!trigger) return false
    trigger.click()
    return true
  }, boxEl).catch(() => false) as boolean
  if (!opened) {
    console.warn('[dsagent-taobao-publish] 提取方式：未找到运费模板下拉（该类目可能不需要模板）')
    // 没有模板下拉（少数类目不需要），勾选即算完成
    const okNoTpl = await page.evaluate((box: any) => {
      if (!box) return false
      const inp = box.querySelector('input[type="checkbox"][value="2"]') as HTMLInputElement | null
      return !!inp?.checked
    }, boxEl).catch(() => false) as boolean
    return { ok: okNoTpl }
  }
  await waitForPropPanel(page, ATTR_DROPDOWN_WAIT_MS)

  // ② 读真实候选并点中（优先级：类目档案上次成功模板 > 「默认模板」启发式 > 第一项）
  //    ★ 命中即验证：档案值必须仍在当前候选 texts 里才用，不在则落回启发式。
  const cachedTpl = cachedTemplate || null
  const picked = await page.evaluate((cached: string | null) => {
    const overlay = document.querySelector('.next-overlay-wrapper.opened')
    if (!overlay) return ''
    const items = Array.from(overlay.querySelectorAll('.options-item, li, .next-menu-item, [role="option"]')) as HTMLElement[]
    const texts = items.map(el => (el.textContent || '').trim()).filter(Boolean)
    if (!texts.length) return ''
    const target = (cached && texts.includes(cached) ? cached : '')
      || texts.find(t => /默认模板/.test(t)) || texts[0]
    const hit = items.find(el => (el.textContent || '').trim() === target)
    if (hit) hit.click()
    return target
  }, cachedTpl).catch(() => '') as string
  if (!picked) {
    console.warn('[dsagent-taobao-publish] 提取方式：未读到运费模板候选，仅勾选「使用物流配送」')
    return { ok: true }
  }
  await sleep(600)

  // ③ 回读确认：勾选 + 模板都生效才算成功
  const confirmed = await page.evaluate((box: any) => {
    if (!box) return false
    const inp = box.querySelector('input[type="checkbox"][value="2"]') as HTMLInputElement | null
    const val = (box.querySelector('.next-select-values')?.textContent || '').trim()
    // 新版可能把已选值渲染成 tag / 文本而非 .next-select-values，退化为「区内出现模板名」
    const txt = (box.textContent || '').replace(/\s+/g, '')
    const checkedOk = inp ? !!inp.checked : /使用物流配送/.test(txt)
    return checkedOk && !!val
  }, boxEl).catch(() => false) as boolean
  return { ok: confirmed, template: confirmed ? picked : undefined }
}

/**
 * 多规格（销售属性）填写：逐个把规格值键入 → Tab 触发 onBlur → 回填 SKU 表。
 *
 * ★ 真实实测（2026-09），三个必须遵守的坑：
 *   1) **必须真实键盘键入 + Tab**。该页是 React 15（DOM 上挂 `__reactInternalInstance$`），
 *      颜色输入框只注册了 onChange/onBlur，**没有 onInput**：
 *        · nativeSetter + dispatchEvent('input') → 计数仍 (0)、SKU 表仍 hidden；
 *        · 只 type 不 Tab → 同样不生效（onBlur 没触发）；
 *        · type 后按 **Tab** → 计数变 (1)、`#struct-sku` 由 hidden 变可见。★ Enter 无效。
 *   2) SKU 表每行的价格/数量格子也必须真实键入 + Tab，且清空要
 *      `focus()` + `Control+A` + `Backspace`（直接赋值不进 React state）。
 *   3) 行内的格子用 `td[id$="..."]` 精确定位（id 形如 `{row}-skuPrice`），
 *      比按列序 or placeholder 稳。
 *
 * ★ 新版 SKU 面板（部分新类目）：检测到「+ 创建规格」按钮时**不自动填**，
 *   missed 转人工补填（+ 对话引导）。机制细节见 skills/taobao-publish/SOURCE.md §4.6。
 *
 * @returns filled / missed 文案，供主流程汇总
 */
async function fillSkus(
  page: any,
  skus: TaobaoSkuInput[],
): Promise<{ filled: string[]; missed: string[] }> {
  const filled: string[] = []
  const missed: string[] = []
  const wanted = skus
    .map(s => ({ ...s, name: String(s?.name || '').trim() }))
    .filter(s => s.name)
  if (!wanted.length) return { filled, missed }

  // ── ⓪ 新版 SKU 面板检测（新版类目无旧版销售属性输入框）──
  // 新版面板为「+ 创建规格」按钮 + 属性卡选择 + 交叉乘积表，与旧版单属性
  // 输入框语义完全不同；自动适配已按决策放弃（见 SOURCE.md §4.6），转人工补填。
  const hasNewPanel = await page.evaluate(() => {
    const box = document.getElementById('struct-sku') || document.getElementById('struct-saleProp')
    if (!box) return false
    return Array.from(box.querySelectorAll('button, a, div, span'))
      .some((el): boolean => {
        const e = el as HTMLElement
        return e.offsetParent !== null && /^\s*\+\s*创建规格/.test((e.innerText || '').trim())
      })
  }).catch(() => false) as boolean

  if (hasNewPanel) {
    missed.push('多规格（新版SKU面板：请在浏览器窗口内人工点「+ 创建规格」选属性/填规格值，再确认创建并填价格/数量；其余字段已自动填好，不影响发布）')
    return { filled, missed }
  }

  // ── ① 定位销售属性输入框（#struct-saleProp 内的规格值输入框）──
  //   ★ 实测（2026-10，直达发布页）该区是**多维度**结构，文案为：
  //       「销售属性 * 销售属性必须成套使用，颜色分类+身高 请全选或全不选，不能只设置一部分。」
  //       颜色分类(0)  [主色(必选)]   ← 维度 1，占位符「主色(必选)」
  //       身高         [请选择尺码]   ← 维度 2，占位符「请选择尺码」
  //     只填维度 1 会让页面停在「身高」未选、SKU 表不生成 → 前端校验拦提交
  //     （日志表现为「规格值已输入但 SKU 表未生成」）。所以必须把**每个维度**都填。
  //
  //   维度发现：取 #struct-saleProp 里所有「可见且可键入」的 input，
  //   按其在 DOM 中的先后顺序即为维度顺序；占位符含「备注/规格备注」的跳过。
  const dimInputs = await page.evaluate(() => {
    const box = document.getElementById('struct-saleProp') as HTMLElement | null
    if (!box) return []
    // ★ 只认真正的售属性维度框：占位符为「主色(必选)」「请选择尺码」这类；
    //   「备注(可选)」「规格备注」「属性名称」「属性值」都属于自定义区/备注，不算维度
    //   （早先不排除它们，探测出 6 个「维度」，把「属性名称」当维度去点，全错位）。
    const isDim = (ph: string) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
    return (Array.from(box.querySelectorAll('input')) as HTMLInputElement[])
      .filter(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      .map(i => {
        const r = i.getBoundingClientRect()
        return { ph: i.placeholder || '', x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
  }).catch(() => []) as { ph: string; x: number; y: number }[]

  if (!dimInputs.length) {
    missed.push('多规格（未找到销售属性输入框 #struct-saleProp）')
    return { filled, missed }
  }
  console.log(`[dsagent-taobao-publish] 销售属性维度 ${dimInputs.length} 个：`
    + dimInputs.map(d => `「${d.ph}」`).join('、'))

  const inputPos = { x: dimInputs[0].x, y: dimInputs[0].y }

  // ── ② 逐个规格值键入 + Enter（维度 1 = 规格值来源）──
  //   ★ 多维度关键点：只填维度 1 时页面停在「身高 未选」，SKU 表不生成。
  //     所以维度 1 填完后，其余维度也要各填一个值（否则「必须成套使用」不满足）。
  //
  //   ★★ 写入方式（2026-10 实测，关键）：
  //     React 受控输入框只认真实键盘事件。native setter + dispatchEvent 只改 DOM value，
  //     `Json.models.formValues` 里根本没有 title 这类字段（实测 stateTitle 恒 undefined），
  //     提交校验读的是页面从各处收集的结果，于是报「必填项未填」。
  //     所以这里必须 page.mouse.click 聚焦 + page.keyboard.type 真实键入 + Enter。
  for (const sku of wanted) {
    await page.mouse.move(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(200)
    await page.mouse.click(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(400)
    await page.keyboard.type(sku.name, { delay: 50 }).catch(() => { /* 忽略 */ })
    await sleep(300)
    // ★ Enter = 确认这个规格值（颜色分类是 tag 式输入，Enter 提交）
    await page.keyboard.press('Enter').catch(() => { /* 忽略 */ })
    await sleep(1200)
  }

  // ── ②b 其余维度：各选一个值，凑齐「成套」条件 ──
  //   ★ 尺码维度不是普通下拉，而是**尺码弹层**（sell-size-sale-props-standard-size-popup）：
  //     点「请选择尺码」→ 弹出含「全选/全不选/确定/取消 + 48cm~185cm」的面板
  //     → 勾目标尺码 → 点「确定」。勾选后 SKU 表才会渲染出来。
  if (dimInputs.length > 1) {
    for (let d = 1; d < dimInputs.length; d++) {
      const dim = dimInputs[d]
      await page.mouse.click(dim.x, dim.y).catch(() => { /* 忽略 */ })
      await sleep(2500)

      // 弹层里勾一个尺码（优先 100cm，没有就第一个数字尺码）
      const picked = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll(
          '.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened'))
          .filter(p => (p as HTMLElement).offsetParent !== null).pop() as HTMLElement | undefined
        if (!panel) return ''
        const items = Array.from(panel.querySelectorAll('label, .next-checkbox-wrapper'))
          .filter(e => (e as HTMLElement).offsetParent !== null && /^\d+cm$/.test((e.textContent || '').trim())) as HTMLElement[]
        if (!items.length) return ''
        const target = items.find(e => /^100cm$/.test((e.textContent || '').trim())) || items[0]
        const cb = target.querySelector('input[type="checkbox"]') as HTMLInputElement | null
          || (target.tagName === 'LABEL' ? ((target as HTMLLabelElement).control as HTMLInputElement | null) : null)
        if (cb && !cb.checked) { cb.click(); return (target.textContent || '').trim() }
        if (!cb) { target.click(); return (target.textContent || '').trim() }
        return (target.textContent || '').trim()
      }).catch(() => '') as string
      await sleep(1500)

      // 点「确定」关弹层（不点则勾选不生效）
      const ok = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll(
          '.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened'))
          .filter(p => (p as HTMLElement).offsetParent !== null).pop() as HTMLElement | undefined
        if (!panel) return false
        const btn = Array.from(panel.querySelectorAll('button'))
          .find(b => (b.innerText || '').trim() === '确定' && !b.disabled) as HTMLButtonElement | null
        if (btn) { btn.click(); return true }
        return false
      }).catch(() => false) as boolean

      await sleep(3000)
      console.log(`[dsagent-taobao-publish] 规格维度「${dim.ph}」选值=${picked || '（无候选）'}，确定=${ok}`)
      if (picked && ok) filled.push(`规格维度「${dim.ph}」=${picked}`)
      else missed.push(`规格维度「${dim.ph}」未选到值（勾选=${picked}，确定=${ok}）`)
    }
  }

  // ── ②c 等 SKU 表渲染（新版面板 sell-sku-table-wrapper-new，成套后才出现）──
  let skuReady = false
  for (let i = 0; i < 20; i++) {
    skuReady = await page.evaluate(() => {
      const tbl = document.querySelector('.sell-new-sku-table-content') as HTMLElement | null
      return !!(tbl && tbl.offsetParent !== null)
    }).catch(() => false)
    if (skuReady) break
    await sleep(1000)
  }
  console.log(`[dsagent-taobao-publish] SKU 表渲染=${skuReady}`)

  // ── ③ 回读 SKU 行（新版面板：按「行内有价格/数量输入框」识别）──
  const rows = await page.evaluate(() => {
    const tbl = document.querySelector('.sell-new-sku-table-content') as HTMLElement | null
      || document.getElementById('struct-sku') as HTMLElement | null
    if (!tbl) return []
    const rowEls = Array.from(tbl.querySelectorAll('tr, [class*="row"], [class*="sku-row"]')) as HTMLElement[]
    const out: Array<{ idx: number; color: string; price: string; stock: string }> = []
    for (const row of rowEls) {
      const priceInp = row.querySelector('input[placeholder*="价格"], input[placeholder="价格"]') as HTMLInputElement | null
      const stockInp = row.querySelector('input[placeholder*="数量"], input[placeholder="数量"]') as HTMLInputElement | null
      if (!priceInp && !stockInp) continue
      const colorText = (row.innerText || '').split('\n').map((s: string) => s.trim()).filter(Boolean)[0] || ''
      out.push({ idx: out.length, color: colorText, price: priceInp?.value || '', stock: stockInp?.value || '' })
    }
    return out
  }).catch(() => []) as Array<{ idx: number; color: string; price: string; stock: string }>

  if (!rows.length) {
    missed.push('多规格（规格值已输入但 SKU 表未生成，请在窗口内确认颜色/尺码已成套）')
    return { filled, missed }
  }
  console.log(`[dsagent-taobao-publish] SKU 行 ${rows.length} 条：${rows.map(r => r.color).join(' / ')}`)

  // ── ④ 逐行回填价格 / 数量 / 商家编码（真实键入 + Tab）──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    // 行与入参按规格值名对齐（页面行序可能被排序）
    const want = wanted.find(w => w.name === row.color) || wanted[i]
    if (!want) continue
    const cellTargets: Array<{ suffix: string; value: string; label: string }> = []
    if (want.price) cellTargets.push({ suffix: '-skuPrice', value: String(want.price), label: '价' })
    if (want.stock) cellTargets.push({ suffix: '-skuStock', value: String(want.stock), label: '量' })
    if (want.outerId) cellTargets.push({ suffix: '-skuOuterId', value: String(want.outerId), label: '码' })
    if (!cellTargets.length) { filled.push(`${row.color}（仅规格值）`); continue }

    const done: string[] = []
    for (const cell of cellTargets) {
      const h = await page.evaluateHandle((suffix: string) => {
        const inp = document.querySelector(`#struct-sku td[id$="${suffix}"] input`) as HTMLInputElement | null
        if (inp) inp.scrollIntoView({ block: 'center' })
        return inp
      }, cell.suffix).catch(() => null)
      const el = h && h.asElement ? h.asElement() : null
      if (!el) { missed.push(`${row.color}/${cell.label}（找不到输入格）`); continue }
      await el.evaluate((e: HTMLElement) => e.focus()).catch(() => { /* 忽略 */ })
      await sleep(200)
      // 清空：Control+A + Backspace（实测直接赋值 / 只 Backspace 会残留原值）
      await page.keyboard.down('Control').catch(() => { /* 忽略 */ })
      await page.keyboard.press('KeyA').catch(() => { /* 忽略 */ })
      await page.keyboard.up('Control').catch(() => { /* 忽略 */ })
      await page.keyboard.press('Backspace').catch(() => { /* 忽略 */ })
      await sleep(150)
      await page.keyboard.type(cell.value, { delay: 90 }).catch(() => { /* 忽略 */ })
      await sleep(200)
      await page.keyboard.press('Tab').catch(() => { /* 忽略 */ })
      await sleep(SKU_CELL_WAIT_MS)
      done.push(cell.label)
    }

    // 回读该行校验
    const got = await page.evaluate((suffix: string) => {
      const inp = document.querySelector(`#struct-sku td[id$="${suffix}"] input`) as HTMLInputElement | null
      return inp?.value || ''
    }, '-skuPrice').catch(() => '') as string
    filled.push(`${row.color}${done.length ? `（已填${done.join('/')}，价格=${got || '—'}）` : ''}`)
  }

  return { filled, missed }
}

/**
 * 读「提交后被拦」的真实原因 —— 吸收拼多多的 readSubmitErrors 三路诊断。
 *
 * 淘宝提交被拦时页面不弹 toast，拦因只在三处：
 *   ① next 组件 toast（.next-message-notice / .next-toast）—— 排除成功文案
 *   ② 字段下方的红色校验文案（.sell-component-info-wrapper-explain 带 error/warning class）
 *   ③ 「商品填写建议」面板（.sell-optimization-container 或 .sell-component-optimization）
 *      —— 含错误 tab（数量 + 文案）和建议项
 *
 * 返回 hard = 硬拦因（有它就不必再等）；panel = 面板全文（诊断用）。
 * ★ 旧的「拿 document.body.innerText 去正则匹配关键词」覆盖面窄，
 *   180s 空转后只能报「未检测到成功标志」，对定位毫无帮助。
 */
function readSubmitErrors(page: any): Promise<{ hard: string; panel: string }> {
  return page.evaluate(() => {
    const hard: string[] = []

    // ① next 组件 toast（排除成功文案 + 页面常驻的公告条）
    //   ★ `.next-message` 会命中页面**常驻的公告/通知组件**（如「即日起平台将调整升级部分类目的
    //     属性信息，点击查看详情」这类平台公告），它不是提交被拦的原因。只有**像报错**的文案才当硬拦因。
    const toastSelectors = '.next-message-notice, .next-message, .next-toast, [class*="toast"], [class*="Toast"]'
    const toastEl = document.querySelector(toastSelectors) as HTMLElement | null
    const toastTxt = (toastEl?.innerText || '').replace(/\s+/g, ' ').trim()
    const errorish = /失败|错误|不能|不可|必填|请输入|请选择|请填写|请上传|请完善|不正确|超出|不支持|违规|重复|无效|已下架|已存在|限制/
    if (toastTxt && errorish.test(toastTxt) && !/提交成功|发布成功|上架成功/.test(toastTxt)) {
      hard.push(`页面提示：${toastTxt.slice(0, 120)}`)
    }

    // ② 字段级红色校验文案（sell 组件的 explain 区 + 通用 form error）
    const errSelectors = '.sell-component-info-wrapper-explain, .next-form-item-help-error, [class*="Form_itemError"], [class*="error-text"], [class*="validate-error"]'
    for (const e of Array.from(document.querySelectorAll(errSelectors)) as HTMLElement[]) {
      if (e.offsetParent === null) continue
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
      if (t && t.length <= 80) hard.push(t)
    }

    // ③ 「商品填写建议」面板（优化建议区）
    let panel = ''
    const optSelectors = '.sell-optimization-container, .sell-component-optimization, [class*="optimization-container"], [class*="goods-optimization"]'
    const opt = document.querySelector(optSelectors) as HTMLElement | null
    if (opt) {
      const tabLabels = Array.from(opt.querySelectorAll('[class*="tabLabel"], [class*="tab-label"], .next-tabs-tab')) as HTMLElement[]
      const errTab = tabLabels.find(l => /错误|问题|必填/.test(l.innerText || ''))
      const errCount = Number((errTab?.innerText || '').match(/(\d+)/)?.[1] || 0)
      const errTxt = ((opt.querySelector('[class*="TAB_content"], [class*="tab-content"], .next-tabs-content') as HTMLElement | null)?.textContent || '')
        .replace(/\s+/g, ' ').trim()
      const advice = (Array.from(opt.querySelectorAll('[class*="optimize-item"], [class*="advice-item"], [class*="suggest-item"]')) as HTMLElement[])
        .map(a => (a.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      if (errCount > 0 && errTxt && !/暂无错误|暂无问题/.test(errTxt)) {
        hard.push(`错误（${errCount}）：${errTxt.slice(0, 200)}`)
      }
      const header = (opt.querySelector('[class*="optimize-header"], [class*="header"]') as HTMLElement | null)?.innerText || ''
      panel = [header.replace(/\s+/g, ' ').trim(), `错误（${errCount}）`, ...advice].filter(Boolean).join(' | ')
    }

    return { hard: Array.from(new Set(hard)).join('；'), panel }
  }).catch(() => ({ hard: '', panel: '' })) as Promise<{ hard: string; panel: string }>
}

/** 点「提交宝贝信息 / 提交」（2026-09 实测按钮属性为 name="button-submit"，旧版为 _id） */
async function clickSubmit(page: any): Promise<boolean> {
  // 配置驱动（anchors.submitButton）：SEL1/SEL2 为 CSS 候选（refreshTaobaoConfig 维护），
  // TEXT_RE_SRC 为文案兜底正则源 —— 初值 = 历史硬编码，JSON 覆盖后行为同构。
  //
  // ★ 2026-10 实测补强：v2 发布页的提交条在页面最底部（#float-bottom），
  //   元素可能处于「已渲染但被 sticky 栏遮挡 / 尚未进入视口」状态，
  //   且新版的 name 属性有变体。故分四轮：
  //     ① 配置候选（name/​_id）
  //     ② 文案正则（button 全集）
  //     ③ #float-bottom / #struct-buttons 容器内任意可点按钮
  //     ④ 真实鼠标点击兜底（元素 .click() 被 React 拦掉时用坐标点）
  const hit = await page.evaluate((sel1: string, sel2: string, textReSrc: string) => {
    const vis = (el: any) => !!el && el.offsetParent !== null && !el.disabled
    const re = new RegExp(textReSrc)
    const btnOf = (sel: string) => document.querySelector(sel) as HTMLButtonElement | null

    let el: HTMLButtonElement | null = null
    let how = ''
    for (const sel of [sel1, sel2]) {
      const b = btnOf(sel)
      if (vis(b)) { el = b; how = `selector:${sel}`; break }
    }
    if (!el) {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
      const b = btns.find(x => vis(x) && re.test((x.innerText || '').trim()))
      if (b) { el = b; how = 'text-re' }
    }
    if (!el) {
      // 容器兜底：提交条里的任意 primary / 含「提交」的按钮
      for (const boxSel of ['#float-bottom', '#struct-buttons', '.sell-float-bottom', '[class*=float-bottom]']) {
        const box = document.querySelector(boxSel)
        if (!box) continue
        const cands = Array.from(box.querySelectorAll('button')) as HTMLButtonElement[]
        const b = cands.find(vis) || cands[0]
        if (b && vis(b)) { el = b; how = `container:${boxSel}`; break }
      }
    }
    if (!el) return { found: false, how: '', clicked: false, x: 0, y: 0 }
    try { el.scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }
    const r = el.getBoundingClientRect()
    try { el.click() } catch { /* 忽略 */ }
    return { found: true, how, clicked: true, x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, SUBMIT_BTN_SEL1, SUBMIT_BTN_SEL2, SUBMIT_TEXT_RE_SRC).catch(() => ({ found: false, how: '', clicked: false, x: 0, y: 0 })) as
    { found: boolean; how: string; clicked: boolean; x: number; y: number }

  if (!hit.found) return false
  console.log(`[dsagent-taobao-publish] 提交按钮命中方式=${hit.how}`)
  await sleep(500)

  // ★ 真实鼠标兜底：先看页面是否已经进入「校验错误 / 跳转成功」；
  //   若还在原页且按钮仍可见，用坐标补一次真实点击（untrusted click 会被某些守卫忽略）。
  const stillThere = await page.evaluate((sel1: string, sel2: string, textReSrc: string) => {
    const re = new RegExp(textReSrc)
    const vis = (el: any) => !!el && el.offsetParent !== null && !el.disabled
    const all = [
      document.querySelector(sel1), document.querySelector(sel2),
      ...Array.from(document.querySelectorAll('button')),
    ].filter(Boolean) as HTMLButtonElement[]
    return all.some(x => vis(x) && (re.test((x.innerText || '').trim()) || /button-submit/.test(x.getAttribute('name') || '')))
  }, SUBMIT_BTN_SEL1, SUBMIT_BTN_SEL2, SUBMIT_TEXT_RE_SRC).catch(() => false) as boolean

  if (stillThere && hit.x > 0 && hit.y > 0) {
    try {
      await page.mouse.move(hit.x, hit.y)
      await sleep(150)
      await page.mouse.click(hit.x, hit.y)
      console.log('[dsagent-taobao-publish] 已补一次真实鼠标点击提交')
    } catch { /* 忽略 */ }
  }
  return hit.clicked
}

/**
 * 淘宝 / 天猫 商品发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function taobaoPublish(
  store: CredentialStore,
  opts: TaobaoPublishOptions,
): Promise<TaobaoPublishResult> {
  // ── 配置热加载（publish-config/taobao.json，mtime 变化自动重读）──
  // ★ 必须最先做：下面的入参校验就用 MAX_IMAGES/MAX_IMAGE_BYTES/MAX_TITLE_LEN 等配置值。
  const cfgErr = refreshTaobaoConfig()
  if (cfgErr) {
    return { ok: false, failureKind: 'api_error', text: cfgErr }
  }

  // ── 入参校验 ────────────────────────────────────────────
  const channelKey = ['taobao', 'tmall'].includes(String(opts.channel || '').trim().toLowerCase())
    ? String(opts.channel).trim().toLowerCase()
    : 'taobao'
  const channel = CHANNELS[channelKey]
  const title = String(opts.title || '').trim()
  const price = String(opts.price ?? '').trim()
  const stock = String(opts.stock ?? '').trim()
  const itemNo = String(opts.itemNo ?? '').trim()
  const categoryKeyword = String(opts.categoryKeyword ?? '').trim()
  const brand = String(opts.brand ?? '').trim()
  const model = String(opts.model ?? '').trim()
  const attrModel = opts.attrModel
  const attributes = opts.attributes
  const images = (Array.isArray(opts.images) ? opts.images : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES)
  // 详情图（复刻觅千手预上传，多张，上限放宽到 20）
  const detailImages = (Array.isArray(opts.detailImages) ? opts.detailImages : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, 20)
  // ★ COS/外链 URL 模式（复刻觅千手搬品：图片已是 URL，走 replay 注入，跳过 DOM 上传）
  let imageUrls = (Array.isArray(opts.imageUrls) ? opts.imageUrls : [])
    .map(u => String(u || '').trim()).filter(u => /^https?:\/\//.test(u)).slice(0, MAX_IMAGES)
  let detailImageUrls = (Array.isArray(opts.detailImageUrls) ? opts.detailImageUrls : [])
    .map(u => String(u || '').trim()).filter(u => /^https?:\/\//.test(u)).slice(0, 20)
  /** 有主图 URL 即走纯 replay 图片模式（本地图经图片空间上传后也会置 true，见下方） */
  let useUrlImages = imageUrls.length > 0
  /** 逆向 HTTP 上传是否启用（默认开） */
  const imageSpaceUpload = opts.imageSpaceUpload !== false
  const imageSpaceFolderId = String(opts.imageSpaceFolderId ?? '0').trim() || '0'
  const imageSpaceConcurrency = Number(opts.imageSpaceConcurrency) || 3
  const skus = (Array.isArray(opts.skus) ? opts.skus : [])
    .map(s => ({
      name: String(s?.name || '').trim(),
      price: String(s?.price ?? '').trim(),
      stock: String(s?.stock ?? '').trim(),
      outerId: String(s?.outerId ?? '').trim(),
    }))
    .filter(s => s.name)

  if (!images.length && !useUrlImages) {
    return { ok: false, failureKind: 'api_error', text: '缺少 images（本地图片绝对路径列表，至少 1 张）。' }
  }
  for (const p of images) {
    if (!existsSync(p)) {
      return { ok: false, failureKind: 'api_error', text: `图片文件不存在：${p}` }
    }
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size === 0) {
        return { ok: false, failureKind: 'api_error', text: `图片文件不可用（非文件或大小为 0）：${p}` }
      }
      if (st.size > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          failureKind: 'api_error',
          text: `图片超过单张上限 20MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）。`
            + '淘宝/天猫主图要求 ≤ 20MB，请压缩后重试。',
        }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取图片文件：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  // 详情图文件校验（缺文件直接报错，超限提示）
  for (const p of detailImages) {
    if (!existsSync(p)) {
      return { ok: false, failureKind: 'api_error', text: `详情图文件不存在：${p}` }
    }
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size === 0) {
        return { ok: false, failureKind: 'api_error', text: `详情图文件不可用（非文件或大小为 0）：${p}` }
      }
      if (st.size > MAX_IMAGE_BYTES) {
        return { ok: false, failureKind: 'api_error', text: `详情图超过单张上限 20MB：${p}` }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取详情图文件：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (!title) {
    return { ok: false, failureKind: 'api_error', text: '缺少 title（商品标题）。淘宝/天猫要求标题必填。' }
  }
  if (title.length > MAX_TITLE_LEN) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `商品标题超过 ${MAX_TITLE_LEN} 个字符（当前 ${title.length} 个）。请精简后重试。`,
    }
  }
  if (price) {
    const n = Number(price)
    if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
      return { ok: false, failureKind: 'api_error', text: `一口价不合法：${price}。请填正数（元，1 亿元以内）。` }
    }
  }
  if (stock) {
    const n = Number(stock)
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
      return { ok: false, failureKind: 'api_error', text: `库存不合法：${stock}。请填非负整数。` }
    }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  // diagDumpJson 是零风险诊断（不点提交、不写任何数据），绕过 confirm 门禁。
  if (opts.confirm !== true && !opts.diagDumpJson) {
    return {
      ok: false,
      needConfirm: true,
      text: buildPreview(account, channel.label, { ...opts, title }, images),
    }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   锁挂在账号专属目录上：同一账号（淘宝与天猫共用一套登录态）天然互斥，不同账号可并行。
  const dir = profileDir('taobao', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `淘宝的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}
  let browser: any = null
  /** true = 复用了已开着的窗口（收尾时只能断开连接，绝不能关掉用户的窗口） */
  let attached = false
  // ★ 只有发布成功才关闭窗口；未成功时保留窗口供用户人工补全字段 / 处理风控后手动提交。
  let succeeded = false
  /** 发布页 URL 的 catId（类目档案的精确身份键）；从发布页 URL 解析，可能在切页后才拿到 */
  let publishCatId = ''
  /** 类目显示名（选类目页页脚的完整路径，如「童装>>儿童外套」）；档案命名用 */
  let publishCategoryName = ''

  /* ══════════════════════════════════════════════════════════════════
   * 逆向 HTTP 预上传（复刻觅千手：图片先进图片空间，再随表单注入）
   * ----------------------------------------------------------------
   * 放在开浏览器**之前**：纯 HTTP、无副作用（只往自己的图片空间加素材），
   * 全部失败时可直接返回，不必白白弹一个窗口出来。
   * 成功后 imageUrls / detailImageUrls 被填上，useUrlImages=true →
   * 主图区与详情区都不再走 DOM 文件上传，只由 replay 注入 URL。
   * ══════════════════════════════════════════════════════════════════ */
  const uploadNotes: string[] = []
  if (imageSpaceUpload && (images.length || detailImages.length) && !useUrlImages) {
    const loginErr = checkLoginCookies(accountCookies)
    if (loginErr) {
      uploadNotes.push(`图片空间上传跳过：${loginErr}`)
    } else {
      const t0 = Date.now()
      console.log(`[dsagent-taobao-publish] 逆向 HTTP 预上传：主图×${images.length} + 详情图×${detailImages.length}`
        + `（folderId=${imageSpaceFolderId}，并发=${imageSpaceConcurrency}）`)
      const main = await localImagesToSpaceUrls(images, {
        cookies: accountCookies,
        folderId: imageSpaceFolderId,
        concurrency: imageSpaceConcurrency,
      })
      const detail = await localImagesToSpaceUrls(detailImages, {
        cookies: accountCookies,
        folderId: imageSpaceFolderId,
        concurrency: imageSpaceConcurrency,
      })
      const ms = Date.now() - t0
      const okMain = main.urls.length
      const okDetail = detail.urls.length
      const badAll = [...main.failed, ...detail.failed]

      console.log(`[dsagent-taobao-publish] 图片空间上传完成（${ms}ms）：主图 ${okMain}/${images.length}，`
        + `详情图 ${okDetail}/${detailImages.length}`)
      for (const r of [...main.results, ...detail.results]) {
        if (r.ok) console.log(`  ✓ ${basenameOf(r.local)} → ${r.url}${r.pix ? `（${r.pix}）` : ''}`)
        else console.log(`  ✗ ${basenameOf(r.local)}：${r.error}`)
      }

      // 主图一张都没传上去 → 图片空间这条链不可用，整批回退 DOM 上传（不改结论）
      if (okMain === 0) {
        uploadNotes.push(`图片空间上传全部失败（${badAll.length} 张），已回退原 DOM 上传链路：`
          + `${badAll[0]?.error || '未知原因'}`)
        console.log(`[dsagent-taobao-publish] 主图 URL 为 0，回退 DOM 上传链路`)
      } else {
        imageUrls = main.urls
        detailImageUrls = detail.urls
        useUrlImages = true
        uploadNotes.push(`图片空间预上传：主图 ${okMain}/${images.length}、详情图 ${okDetail}/${detailImages.length}`
          + `（${ms}ms，纯 HTTP，无浏览器）`)
        if (badAll.length) {
          uploadNotes.push(`⚠ 有 ${badAll.length} 张上传失败，这些图不会出现在商品里：`
            + badAll.map(b => `${basenameOf(b.local)}（${b.error}）`).join('；'))
        }
        // 详情图全挂但主图成功：继续发（详情可人工补），只提醒
        if (detailImages.length && okDetail === 0) {
          uploadNotes.push('⚠ 详情图全部上传失败，商品详情留空，需人工补图')
        }
      }
    }
  } else if (useUrlImages) {
    uploadNotes.push(`图片已是 URL（主图×${imageUrls.length}、详情图×${detailImageUrls.length}），跳过本地上传`)
  }

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as {
      launch: (opts: any) => Promise<any>
      connect: (opts: any) => Promise<any>
    }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' }
    }

    // ★ 优先复用「已经开着」的窗口（用户明确要求不要反复开/关浏览器）。
    //   Chrome 带 --remote-debugging-port 启动时会把端口写进 userDataDir/DevToolsActivePort。
    let page: any = null
    const debugPort = readDevToolsPort(dir)
    // ★ 端口归属校验（吸收 Accio 的 ChromePortOwnershipError）：
    //   DevToolsActivePort 可能是**陈旧残留**（上次崩溃没清、目录被复制），
    //   于是端口实际属于**另一个 Profile 的浏览器**。直接 connect 会连到别人的窗口，
    //   后果是「在别家账号的浏览器里点了发布」—— 最危险的一类串号事故。
    //   mismatch 时**拒绝复用**，改为新开窗口（宁可多开一个，也不能串号）。
    const ownership = debugPort ? verifyPortOwnership(dir, debugPort) : 'unknown'
    if (debugPort && ownership === 'mismatch') {
      console.warn(
        `[dsagent-taobao-publish] 端口 ${debugPort} 不属于当前 Profile ${dir}`
        + `（登记端口=${registeredPortFor(dir)}），拒绝复用以免操作到其他账号的窗口；改为新开窗口`,
      )
    }
    if (debugPort && ownership !== 'mismatch') {
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${debugPort}`,
          defaultViewport: null,
        })
        attached = true
        const pages = await browser.pages()
        // 优先复用已在淘宝/天猫域下的标签页，避免每跑一次就多开一个标签
        const usable = pages.filter((p: any) => !/^(devtools|chrome-extension):/.test(p.url()))
        page = usable.find((p: any) => /taobao\.com|tmall\.com/.test(p.url()))
          || usable[0]
          || await browser.newPage()
        // 复用成功 → 登记归属，供后续调用校验
        registerProfilePort(dir, debugPort)
        console.log(`[dsagent-taobao-publish] 已复用现有浏览器窗口（调试端口 ${debugPort}，归属=${ownership}）`)
      } catch (e) {
        console.warn('[dsagent-taobao-publish] 复用现有窗口失败，改为新开窗口:', e instanceof Error ? e.message : String(e))
        browser = null
        attached = false
      }
    }

    if (!browser) {
      const launchOpts = {
        // 可见窗口：发布是真实副作用操作，且类目属性等字段需人工补全，必须让用户看得见
        headless: false,
        executablePath: chromePath,
        userDataDir: dir,
        // remote-debugging-port=0：让 Chrome 自选空闲端口并写入 DevToolsActivePort，
        // 下次调用即可直接复用本窗口，无需关闭重开。
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900', '--remote-debugging-port=0'],
      }
      clearProfileLocks(dir)
      try {
        browser = await puppeteer.launch(launchOpts)
      } catch (e) {
        console.warn('[dsagent-taobao-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
        clearProfileLocks(dir)
        browser = await puppeteer.launch(launchOpts)
      }
      // 新启动的窗口：把本次实际端口登记到该目录，供下次调用校验归属
      try {
        const newPort = readDevToolsPort(dir)
        if (newPort) registerProfilePort(dir, newPort)
      } catch { /* 端口未就绪不影响发布 */ }
    }

    if (!page) page = await browser.newPage()
    // ★ 复用旧标签页时必须先接管弹窗：发布页注册了 beforeunload（未保存离开提醒），
    //   若无人处理，下面的 goto 会被弹窗卡死直到超时。统一「确认」放行。
    page.on('dialog', async (d: any) => {
      try {
        console.log(`[dsagent-taobao-publish] 自动处理页面弹窗（${d.type()}）：${d.message()}`)
        await d.accept()
      } catch { /* 弹窗可能已被处理 */ }
    })
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await applyStealth(page)
    // ★ replayMode（觅千手式 Json/Json2 setter 劫持重放）：在页面任何脚本执行前注入，
    //   劫持 window.Json / window.Json2 的 setter，框架赋值瞬间把 payload merge 进表单 state。
    //   新开的发布标签页（sell/v2/publish.htm?catId=...）同属本 browser 上下文，init script 自动生效。
    // ★ 图片空间预上传成功后必须开 replay —— URL 塞进表单 state 只能靠这条链路，
    //   否则图片只是躺在图片空间里、商品上什么也没有。故用 || 而非纯 opts 判断。
    const imageSpaceReady = useUrlImages && (imageUrls.length > 0)
    const replayMode = opts.replayMode === true || imageSpaceReady
    if (replayMode) {
      const doc = buildTaobaoJsonDocument({
        title, price, stock, itemNo, images, skus,
        // 复刻觅千手三层 SKU：salePropValues 缺省时由 builder 回退用 skus[].name
        salePropValues: skus.map(s => s.name),
        // 复刻觅千手搬品：图片空间 / COS / 外链图 URL 走 replay 注入（mainImagesGroup/wirelessDesc）
        imageUrls, detailImageUrls,
      })
      await page.evaluateOnNewDocument(buildTaobaoJsonReplayInitScript(JSON.stringify(doc)))
      console.log(`[dsagent-taobao-publish] replayMode：已注入 Json/Json2 劫持脚本（觅千手式重放）`
        + (imageSpaceReady ? `（图片空间预上传链路自动启用）` : '')
        + (useUrlImages ? `，主图URL×${imageUrls.length}，详情图URL×${detailImageUrls.length}` : ''))
    }

    // 注入淘宝 + 天猫域 Cookie（发布页与素材选择器分别落在两个域）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => ([
        { name, value: String(value), domain: '.taobao.com', path: '/' },
        { name, value: String(value), domain: '.tmall.com', path: '/' },
      ]))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-taobao-publish] 已注入 ${cookieList.length} 个 Cookie（账号 ${shopKey}）`)

    // ── 1. 打开发布入口 ────────────────────────────────────
    // 有 categoryUrl 时直接打开「选类目」页（淘宝的 publish.htm 已不再通向选类目页）。
    //
    // ★ directPublishUrl：跳过选类目，直达 sell/v2/publish.htm?catId=XXXX。
    //   为什么需要这条路径（2026-10 实测差异）：
    //     · 直接从 catId 进发布页 → 属性区正常渲染（label.required = 7 个，属性可填）
    //     · 从「选类目页 → 确认下一步」进入 → 属性区是空壳（pItems=28 / label=0），
    //       于是必填属性读不到、填不上，提交被前端校验拦住（连请求都发不出去）
    //   批量场景已知 catId 时用这条路径最稳。
    const entryUrl = opts.directPublishUrl
      ? String(opts.directPublishUrl)
      : (channel.categoryUrl || channel.url)
    console.log(`[dsagent-taobao-publish] 打开${channel.label}发布入口：${entryUrl}`
      + (opts.directPublishUrl ? '（直达发布页，跳过选类目）' : ''))
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(4000)

    // ── 1.5 选类目：传了 categoryKeyword 自动选（候选按与标题相关性降序），否则等用户手动选 ──
    // 选完类目会**新开标签页** sell/v2/publish.htm?catId=...，需把 page 切到新页继续。
    const onCategoryPage = /category\.htm/i.test(page.url())
      || await page.evaluate(() =>
        !!document.querySelector('input[placeholder*="类目关键词"]')).catch(() => false)
    if (onCategoryPage) {
      // ★ 2026-10 实测：category.htm?force=true 落地为「搜索发品/以图发品」入口选择页（平台改版），
      //   无类目搜索框，需先点「搜索发品」卡片的「开启」按钮进入类目搜索页。
      const hasSearchBox = await page.evaluate(() =>
        !!document.querySelector('input[placeholder*="类目关键词"]')).catch(() => false)
      if (!hasSearchBox) {
        console.log('[dsagent-taobao-publish] 检测为「搜索发品/以图发品」入口选择页，点「搜索发品」开启按钮...')
        await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('div')).filter((d) =>
            (d.textContent || '').includes('搜索发品') && d.querySelector('button, a'))
          for (const c of cards) {
            const btn = Array.from(c.querySelectorAll('button, a')).find((b) =>
              /开启/.test((b.textContent || '').trim()) && (b as HTMLElement).offsetParent)
            if (btn) { (btn as HTMLElement).click(); return }
          }
          const anyBtn = Array.from(document.querySelectorAll('button, a')).find((b) =>
            /开启/.test((b.textContent || '').trim()) && (b as HTMLElement).offsetParent)
          if (anyBtn) (anyBtn as HTMLElement).click()
        }).catch(() => { /* 忽略 */ })
        await sleep(4000)
      }
      if (categoryKeyword) {
        const cat = await selectCategory(page, categoryKeyword, { brand, model, title })
        console.log(`[dsagent-taobao-publish] 自动选类目：${cat.note}`)
        if (cat.pickedPath) publishCategoryName = cat.pickedPath
      } else {
        console.log('[dsagent-taobao-publish] 当前为「选类目」页，等待用户在窗口内选好类目...')
      }
      // 自动选类目失败时仍留时间给用户人工选
      const newPage = await waitForPublishTab(browser, page, categoryKeyword ? 30_000 : FORM_WAIT_MS)
      if (newPage) {
        page = newPage
        await page.bringToFront().catch(() => { /* 忽略 */ })
        await page.setViewport({ width: 1440, height: 900 }).catch(() => { /* 忽略 */ })
        await sleep(3000)
      } else {
        console.log('[dsagent-taobao-publish] 未捕获到新发布标签页，继续在当前页等待表单。')
      }
    }

    // ── 1.6 解析发布页 URL 的 catId（类目档案精确身份键，g5）────────
    // catId 是档案查找/保存的唯一键（铁律：平台+catId 精确匹配，不做文件名模糊兜底）。
    // 无论自动选类目还是用户手动选，发布页 URL 都形如 sell/v2/publish.htm?catId=123...。
    {
      const m = String(page.url()).match(/catId=(\d+)/i)
      if (m) publishCatId = m[1]
    }
    if (publishCatId) {
      console.log(`[dsagent-taobao-publish] 发布页 catId=${publishCatId}${publishCategoryName ? `（${publishCategoryName}）` : ''}`)
    }

    // ── 2. 等发布表单就绪（可能需要用户先手动选类目）────────
    let formReady = false
    let riskUrl = ''
    const formDeadline = Date.now() + FORM_WAIT_MS
    while (Date.now() < formDeadline) {
      const risk = await detectRisk(page)
      if (risk.hit) {
        riskUrl = risk.verifyUrl
        break
      }
      if (await isLoggedOut(page)) {
        await store.setStatus(shopKey, 'expired')
        return {
          ok: false,
          failureKind: 'token_expired',
          shopKey,
          text: `淘宝登录态在${channel.label}发布页无效（页面要求登录）。\n`
            + '请到「账号连接」页面重新登录淘宝账号（天猫/生意参谋系共用淘宝登录态）。',
        }
      }
      formReady = await page.evaluate(
        (sel: string) => !!document.querySelector(sel), FORM_READY_SELECTOR,
      ).catch(() => false) as boolean
      if (formReady) break
      // 页面停在「选择类目」时提示用户手动选
      const picking = await page.evaluate(() =>
        /选择类目|请选择类目|选择商品类目|请先选择/.test((document.body?.innerText || '').slice(0, 3000))).catch(() => false)
      if (picking) {
        console.log(`[dsagent-taobao-publish] 页面停留在「选择类目」，等待用户在窗口内选好类目...`)
      }
      await sleep(2000)
    }

    if (riskUrl || !formReady) {
      const risk = await detectRisk(page)
      if (risk.hit) {
        return {
          ok: false,
          failureKind: 'risk_control',
          shopKey,
          finalUrl: page.url(),
          verifyUrl: risk.verifyUrl || riskUrl,
          text: `${channel.label}发布页命中了安全风控（baxia 滑块 / 访问被拒绝）。\n`
            + (risk.verifyUrl || riskUrl ? `验证入口：${risk.verifyUrl || riskUrl}\n` : '')
            + `请先调用 dsagent_risk_verify（platform=taobao${risk.verifyUrl || riskUrl ? `，verifyUrl=${risk.verifyUrl || riskUrl}` : ''}），`
            + '在弹出窗口内完成滑块验证；也可引导用户在已打开的浏览器窗口内手动完成验证后重试本工具。',
        }
      }
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: page.url(),
        text: `等待 ${FORM_WAIT_MS / 1000}s 未等到发布表单（主图区/提交按钮）。\n`
          + '常见原因：① 页面停在「选择类目」，可传 categoryKeyword 自动选类目，或在浏览器窗口内选好类目后才会进入表单；'
          + '② 页面结构已变更；③ 账号被限制发布。\n'
          + '请查看已打开的浏览器窗口，处理后在浏览器内手动完成发布，或修正后重试本工具。',
      }
    }

    // ── 2.9 诊断模式：dump window.Json/Json2 结构后直接返回（零风险，不点提交）────
    if (opts.diagDumpJson) {
      const dump = await page.evaluate(() => {
        const grab = (v: any) => { if (!v) return null; try { return JSON.parse(JSON.stringify(v)) } catch (e) { return String(e) } }
        const out: any = { href: location.href, hasJson: 'Json' in window, hasJson2: 'Json2' in window }
        try { out.Json = grab((window as any).Json) } catch (e) { out.JsonErr = String(e) }
        try { out.Json2 = grab((window as any).Json2) } catch (e) { out.Json2Err = String(e) }
        try { out.replayResult = grab((window as any).__kddsReplayResult) } catch (e) { out.replayErr = String(e) }
        return out
      }).catch((e: any) => ({ err: String(e) }))
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync('dev/.ui-shots', { recursive: true })
      writeFileSync('dev/.ui-shots/taobao-json-dump.json', JSON.stringify(dump, null, 2))
      // 切到「基础信息」tab 再截图，直接看标题/价格是否渲染
      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('*')).find((e) =>
          (e.textContent || '').trim() === '基础信息' && (e as HTMLElement).offsetParent
            && (e.children.length === 0 || (e.textContent || '').length < 10))
        if (tab) (tab as HTMLElement).click()
      }).catch(() => { /* 忽略 */ })
      await sleep(1200)
      // dump 标题/价格/货号输入框的真实 DOM value（最直接验证渲染源）
      const domVals = await page.evaluate(() => {
        const inp = (pred: (e: HTMLInputElement) => boolean) => {
          const el = Array.from(document.querySelectorAll('input, textarea')).find((e) =>
            pred(e as HTMLInputElement) && (e as HTMLElement).offsetParent) as HTMLInputElement | undefined
          return el ? el.value : null
        }
        return {
          title: inp((e) => /标题/.test(e.placeholder || '')),
          price: inp((e) => /一口价|价格/.test(e.placeholder || '') || e.inputMode === 'decimal'),
          outerId: inp((e) => /货号|商家编码|编码/.test(e.placeholder || '')),
        }
      }).catch(() => null)
      console.log('[dsagent-taobao-publish] DOM 输入框值:', JSON.stringify(domVals))
      // 探查「商品属性」区必填项 + 材质成分区域结构（决策必填处理方案用）
      const requiredProbe = await page.evaluate(() => {
        const txt = (e: Element) => (e.textContent || '').replace(/\s+/g, ' ').trim()
        // 必填项：label 旁带红星（*）的属性名
        const required: string[] = []
        for (const star of Array.from(document.querySelectorAll('*'))) {
          if (txt(star) === '*' && (star as HTMLElement).offsetParent) {
            // 向上找含属性名的祖先
            let p = star.parentElement
            for (let i = 0; i < 4 && p; i++) {
              const t = txt(p)
              if (t.length > 1 && t.length < 40 && t !== '*') { required.push(t.replace(/^\*\s*/, '')); break }
              p = p.parentElement
            }
          }
        }
        // 材质成分区域：找「添加材质成分」按钮的容器，dump 其周围结构
        const addBtn = Array.from(document.querySelectorAll('*')).find((e) =>
          /添加材质成分/.test(txt(e)) && (e as HTMLElement).offsetParent && e.children.length < 5)
        let materialArea: string | null = null
        if (addBtn) {
          let box = addBtn.parentElement
          for (let i = 0; i < 5 && box; i++) {
            if (txt(box).includes('材质成分') && txt(box).length < 500) break
            box = box.parentElement
          }
          materialArea = box ? txt(box).slice(0, 300) : null
        }
        return { required: [...new Set(required)], hasAddMaterialBtn: !!addBtn, materialArea }
      }).catch((e: any) => ({ err: String(e) }))
      console.log('[dsagent-taobao-publish] 必填项探查:', JSON.stringify(requiredProbe, null, 2))
      // dump 全部类目属性的真实 name + 必填标记（批量脚本 attributes 需按此精确匹配）
      const catProps = await readCatPropItems(page)
      console.log('[dsagent-taobao-publish] 类目属性清单:',
        JSON.stringify(catProps.map((p) => ({ name: p.name, required: p.required, kind: p.kind, filled: p.filled })), null, 2))
      await page.screenshot({ path: 'dev/.ui-shots/taobao-json-dump.png' }).catch(() => { /* 忽略 */ })
      const jm = dump?.Json?.models
      const summary = jm
        ? `models keys=[${Object.keys(jm).join(',')}]\nformValues keys=[${Object.keys(jm.formValues || {}).join(',')}]\nfv.title=${JSON.stringify(jm.formValues?.title)}\nfv.price=${JSON.stringify(jm.formValues?.price)}\nbase-card=${JSON.stringify(jm['base-card'] ?? null).slice(0, 400)}\nsale-card=${JSON.stringify(jm['sale-card'] ?? null).slice(0, 400)}`
        : `无 Json.models；hasJson=${dump?.hasJson} JsonErr=${dump?.JsonErr}`
      console.log(`[dsagent-taobao-publish] 诊断 dump 完成：\n${summary}`)
      return {
        ok: true,
        shopKey,
        finalUrl: page.url(),
        text: `诊断模式：已 dump window.Json/Json2 结构到 dev/.ui-shots/taobao-json-dump.json（未提交）。\n${summary}`,
      }
    }

    // ── 3. 上传主图（发布页内直传）──────────────────────────
    //   URL 模式（COS/外链）跳过 DOM 上传：图片 URL 已随 replay 注入 mainImagesGroup。
    if (useUrlImages) {
      console.log(`[dsagent-taobao-publish] 主图：URL 模式（replay 注入 mainImagesGroup×${imageUrls.length}），跳过 DOM 上传`)
    } else {
      const up = await uploadImages(page, images)
      console.log(`[dsagent-taobao-publish] 主图上传：${up.note}`)
    }

    // ── 3.4 上传详情图（复刻觅千手预上传：页内直传详情编辑器，框架收 URL 进 wirelessDesc）──
    //   URL 模式跳过 DOM 上传：详情图 URL 已随 replay 注入 wirelessDesc/descRepublicOfSell。
    if (detailImageUrls.length) {
      console.log(`[dsagent-taobao-publish] 详情图：URL 模式（replay 注入 wirelessDesc×${detailImageUrls.length}），跳过 DOM 上传`)
    } else if (detailImages.length) {
      const dup = await uploadDetailImages(page, detailImages)
      console.log(`[dsagent-taobao-publish] 详情图上传：${dup.note}`)
    }

    // ── 3.5 表单就绪后补解析 catId（g5）───────────────────────
    // 用户手动选类目时，1.6 那次解析可能发生在用户还没选完 → URL 里还没有 catId。
    // 表单就绪 = 类目已定，此处再解析一次兜底。
    if (!publishCatId) {
      const m = String(page.url()).match(/catId=(\d+)/i)
      if (m) {
        publishCatId = m[1]
        console.log(`[dsagent-taobao-publish] 发布页 catId=${publishCatId}（表单就绪后解析）`)
      }
    }

    // ── 4. 自动填通用字段 ──────────────────────────────────
    // ★ replayMode：先回读页面内 hook 结果。命中（框架 state 已被 merge）则跳过
    //   标题/价格/库存/货号/SKU 的 DOM 逐格填写——字段已由 Json 重放写入并随框架渲染。
    //   未命中（页面非 sell 结构 / 框架没走 Json 赋值）自动降级回 DOM 链路。
    let replayApplied = false
    if (replayMode) {
      const replayRes: any = await page.evaluate(() => (window as any).__kddsReplayResult || null).catch(() => null)
      if (replayRes && replayRes.applied) {
        replayApplied = true
        console.log(`[dsagent-taobao-publish] replayMode 命中：merge 字段=${(replayRes.mergedFields || []).join(',')}`
          + `（${replayRes.hookSource || ''}）`)
      } else {
        console.log(`[dsagent-taobao-publish] replayMode 未命中（${replayRes?.reason || '框架未触发 Json 赋值'}），降级 DOM 填写。`)
      }
      // 结构诊断：打印 set 前后的真实字段路径，定位「渲染源 vs merge 目标」
      if (replayRes) {
        console.log(`[dsagent-taobao-publish] [diag] beforeStruct=${JSON.stringify(replayRes.beforeStruct || null)}`)
        console.log(`[dsagent-taobao-publish] [diag] afterStruct.compKeys=${JSON.stringify(replayRes.afterStruct?.compKeys || [])}`)
        console.log(`[dsagent-taobao-publish] [diag] syncedComponents=${JSON.stringify(replayRes.syncedComponents || [])}`)
      }
    }

    // ── 4.0 图片渲染验收（逆向预上传 + replay 的最终验收点）──────
    //   merge 命中 ≠ 页面渲染出图。这里直接数 DOM：
    //   主图区 img 数 / 详情区 img 数，与 formValues 里的数量做对照。
    //   主图没渲染出来 → 图片链路算失败，明确记进 uploadNotes，不让用户以为发出去有图。
    if (useUrlImages) {
      // ★ 详情图：走觅千手同一条路 —— 塞给页面自己的上传器（不直接写 state）。
      //   实测：把 desc/descType/descRepublicOfSell 全写进 state 后，编辑器 DOM 仍不出图，
      //   因为详情编辑器与主图一样「只在挂载时读一次值」。
      let detailInjected = false
      if (detailImageUrls.length) {
        // ★ 传原始本地路径（detailImages），详情编辑器要 File，原生 uploadFile 走本地文件最稳；
        //   detailImageUrls 只用于喂 replay 兜底（DataTransfer 分支）。
        const dj = await injectDetailImages(page, detailImages, detailImageUrls)
        console.log(`[dsagent-taobao-publish] 详情图注入：${dj.note}`)
        if (dj.ok) {
          detailInjected = true
          uploadNotes.push(`✓ ${dj.note}`)
        } else {
          uploadNotes.push(`⚠ ${dj.note}（需人工补详情图）`)
        }
      }
      // 主图是异步 CDN 加载 + 框架分帧渲染，给一点时间
      await sleep(2500)
      const rendered = await verifyImagesRendered(page)
      console.log(`[dsagent-taobao-publish] 图片渲染验收：主图区 img=${rendered.mainCount}`
        + `（state 记录 ${rendered.formMainCount}），详情区 img=${rendered.descCount}`
        + `（state 记录 ${rendered.formDescCount}）`)
      if (rendered.mainSrcs.length) {
        console.log(`[dsagent-taobao-publish] 主图前几张：${rendered.mainSrcs.slice(0, 3).join(' | ')}`)
      }
      const expectMain = imageUrls.length
      if (rendered.mainCount > 0) {
        uploadNotes.push(`✓ 主图已渲染到页面（${rendered.mainCount} 张${expectMain ? ` / 期望 ${expectMain}` : ''}）`)
      } else {
        // ★ 诊断实验（真实发布页实测用）：验证 simplyImages 组件是否响应 props 变化。
        //   结论会打到日志，供判断「是结构不对」还是「组件只在首次渲染读值」。
        const exp = await page.evaluate(() => {
          const out: any = {}
          const cnt = () => document.querySelectorAll('.sell-component-simply-images img').length
          const txt = () => ((document.querySelector('.sell-component-simply-images') as HTMLElement | null)?.innerText || '')
            .replace(/\s+/g, ' ').slice(0, 100)
          out.before = { img: cnt(), text: txt() }
          const c = (window as any).Json?.components?.mainImagesGroup
          const v0 = c?.props?.value?.images || []
          const urls = v0.slice(0, 2).map((x: any) => (typeof x === 'string' ? x : x.url))
          out.urlCount = urls.length
          // ① 替换引用
          if (c && urls.length) {
            c.props = c.props || {}
            c.props.value = { images: urls.map((u: string) => ({ url: u, pix: '800x800' })) }
          }
          out.afterReplace = { img: cnt(), text: txt() }
          return out
        }).catch((e: any) => ({ err: String(e) }))
        await sleep(2000)
        const afterExp = await page.evaluate(() => ({
          img: document.querySelectorAll('.sell-component-simply-images img').length,
          text: ((document.querySelector('.sell-component-simply-images') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
        })).catch(() => null)
        console.log('[dsagent-taobao-publish] [实验] simplyImages 渲染响应：'
          + `replace 前=${JSON.stringify((exp as any).before)}，`
          + `replace 后=${JSON.stringify((exp as any).afterReplace)}，`
          + `2s 后=${JSON.stringify(afterExp)}`)

        // ★ 自动修复：主图渲染为空最常见的原因是「images 元素形态不对」——
        //   发布页的 simplyImages 组件期望元素带 URL 字段（对象），纯 URL 字符串会被
        //   渲染成空占位框（页面文案仍显示「上传图片」×N）。
        //   这里做一次「字符串 → 对象」的原地修正 + 触发重渲染，再复验一次。
        console.log('[dsagent-taobao-publish] 主图未渲染，尝试修正 images 元素形态为对象后重试')
        const fixed = await page.evaluate(() => {
          const c = (window as any).Json?.components?.mainImagesGroup
          const fv = (window as any).Json?.models?.formValues
          const norm = (arr: any[]) => arr.map((x: any) => {
            if (x && typeof x === 'object') return x
            const url = String(x || '')
            const m = url.match(/-(\d+)x(\d+)\./)
            return { url, pix: m ? `${m[1]}x${m[2]}` : '800x800' }
          })
          let n = 0
          const cur = c?.props?.value?.images
          if (Array.isArray(cur) && cur.length) {
            c.props.value = { images: norm(cur) }
            n++
          }
          const cur2 = fv?.mainImagesGroup?.images
          if (Array.isArray(cur2) && cur2.length) {
            fv.mainImagesGroup = { images: norm(cur2) }
            n++
          }
          return n
        }).catch(() => 0) as number
        await sleep(2500)
        const again = await verifyImagesRendered(page)
        console.log(`[dsagent-taobao-publish] 形态修正 ${fixed} 处后复验：主图区 img=${again.mainCount}`)
        if (again.mainCount > 0) {
          uploadNotes.push(`✓ 主图已渲染（${again.mainCount} 张，已自动修正 images 元素形态为对象）`)
        } else {
          uploadNotes.push('✗ 主图未渲染到页面（state 已 merge 但 DOM 无 img）—— 图片链路未生效，'
            + '需在窗口内人工上传主图，或关掉 imageSpaceUpload 走 DOM 上传重试')
          console.log('[dsagent-taobao-publish] ⚠ 主图未渲染：replay 的 mainImagesGroup 未被框架采纳为渲染源')
        }
      }
      if (detailImageUrls.length) {
        // 详情图走页面上传器注入（detailInjected=true 时已在上面记过 ✓，避免重复）
        if (rendered.descCount > 0) {
          if (!detailInjected) uploadNotes.push(`✓ 详情图已渲染（${rendered.descCount} 张）`)
        } else if (detailInjected) {
          // 投递成功但还没渲染出来：上传可能仍在进行，交人工确认，不重复报警
          uploadNotes.push(`⚠ 详情图已投递但尚未渲染（上传可能仍在进行，请在窗口内确认）`)
        } else {
          uploadNotes.push('✗ 详情图未渲染到编辑器 —— 需人工补详情图，'
            + '或关掉 imageSpaceUpload 走 DOM 上传重试')
          console.log('[dsagent-taobao-publish] ⚠ 详情图未渲染：上传器注入未成功')
        }
      }
    }

    const filled: string[] = []
    const missed: string[] = []

    if (replayApplied) {
      filled.push(`标题=${title}（Json 重放）`)
      if (price) filled.push(`一口价=${price}（Json 重放）`)
      if (stock) filled.push(`库存=${stock}（Json 重放）`)
      if (itemNo) filled.push(`货号=${itemNo}（Json 重放）`)
    } else {
      const tHit = await fillField(page, /商品标题|宝贝标题|请输入标题|标题/, title, ['宝贝标题', '商品标题'])
      if (tHit) filled.push(`标题=${title}`); else missed.push('标题')

      if (price) {
        const pHit = await fillField(page, /一口价|价格|售价/, price, ['一口价'])
        if (pHit) filled.push(`一口价=${price}`); else missed.push('一口价')
      }
      if (stock) {
        const sHit = await fillField(page, /库存|数量/, stock, ['总库存', '库存'])
        if (sHit) filled.push(`库存=${stock}`); else missed.push('库存')
      }
      if (itemNo) {
        const iHit = await fillField(page, /货号/, itemNo, ['货号', '商家编码'])
        if (iHit) filled.push(`货号=${itemNo}`); else missed.push('货号')
      }
    }

    // ── 4.5 类目属性 ──
    // ★ 复刻上架助手 6.33：先点「一键采纳推荐值」让平台 AI 填属性（等价于 MTOP wireless.ai.publish.render），
    //   再用显式值/档案/模型逐项补全未被推荐覆盖的必填项。
    const adopted = await adoptRecommendations(page)
    if (adopted) filled.push('一键采纳推荐值')
    const attrs = await fillCategoryAttrs(page, {
      title, model: attrModel, explicit: attributes,
      // 用户声明的「型号」文本（填「型号」这一必填文本属性用；与 model 句柄是两回事）
      modelText: model,
      catId: publishCatId, platform: channelKey,
      // 用户显式声明的品牌（见 fillCategoryAttrs 的品牌例外说明）
      brand,
    })
    filled.push(...attrs.filled)
    missed.push(...attrs.missed)

    // ── 4.6 物流服务「提取方式」勾选「使用物流配送」+ 选运费模板（优先回放类目档案）──
    const ex = await fillExtractWay(page, attrs.profile?.freightTemplate)
    if (ex.ok) filled.push(`提取方式=使用物流配送+运费模板${ex.template ? `（${ex.template}）` : ''}`)
    else missed.push('提取方式')

    // ── 4.7 多规格（销售属性）填写：规格值 + SKU 表价格/数量/编码 ──
    //   ★ replay 命中 ≠ 页面渲染出规格。实测（2026-10）：replay merge 了 sku/saleProp/
    //     customSaleProp，页面提交时仍报「销售信息 >> 销售属性 必填项未填」，
    //     因为销售属性输入区同样只在挂载时读表单 state，后 merge 的值不产生 DOM 控件。
    //     所以这里必须**回读页面真实状态**：没有规格值就补跑 fillSkus（DOM 键入 + Tab）。
    if (skus.length) {
      const skuRendered = await page.evaluate(() => {
        const box = document.getElementById('struct-saleProp') as HTMLElement | null
        const skuTable = document.getElementById('struct-sku') as HTMLElement | null
        // ① 真实有效标志：SKU 表可见且行数 > 0
        let rows = 0
        if (skuTable && skuTable.offsetParent !== null) {
          rows = skuTable.querySelectorAll('tr.sku-table-row, tbody tr').length
        }
        // ② 规格值输入框里真的有值（不是占位符）
        let inputVals = 0
        if (box) {
          for (const inp of Array.from(box.querySelectorAll('input')) as HTMLInputElement[]) {
            const v = (inp.value || '').trim()
            if (v && !/^(请选择|请输入|主色|颜色分类|规格值)/.test(v)) inputVals++
          }
        }
        // ③ 已选规格值标签（排除占位/提示类容器，仅统计带值文本的标签）
        let tags = 0
        if (box) {
          for (const el of Array.from(box.querySelectorAll('[class*="tag"], [class*="label-item"], [class*="value-item"]'))) {
            const t = ((el as HTMLElement).innerText || '').trim()
            if (t && t.length <= 20 && !/请|添加|选择|规格/.test(t)) tags++
          }
        }
        return { rows, inputVals, tags, boxPresent: !!box }
      }).catch(() => ({ rows: 0, inputVals: 0, tags: 0, boxPresent: false }))

      // ★ 三路都为空才判定「未渲染」。
      //   注意：replay 默认**不再 merge** sku/saleProp/customSaleProp（会破坏属性区），
      //   所以这里基本总是走 DOM 填写——这正是期望行为（DOM 键入 + Tab 是唯一稳的路）。
      const rendered = skuRendered.rows > 0
      console.log(`[dsagent-taobao-publish] 销售属性页面状态：rows=${skuRendered.rows} `
        + `inputVals=${skuRendered.inputVals} tags=${skuRendered.tags} → ${rendered ? '已渲染' : '未渲染，需补填'}`)

      if (!rendered) {
        const skuRes = await fillSkus(page, skus)
        filled.push(...skuRes.filled.map(s => `SKU ${s}`))
        missed.push(...skuRes.missed)
      } else {
        filled.push(`SKU ×${skus.length}${replayApplied ? '（Json 重放）' : ''}`)
      }
    }

    console.log(`[dsagent-taobao-publish] 已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`)
    await sleep(1500)

    // ── 4.9 提交体拦改（复刻觅千手 transformRequestBody 思路）──────────
    //   思路来源（用户提出，2026-10）：先拿到真实的 commitBody，再按它的结构拼装数据。
    //   落地做法更稳：**在同一次提交里拦截并增量改写** —— 页面已经把
    //   catPath / stuffStatus / guaranteeService / 各 card / skyLightRule 等
    //   「我们不会填的几十个字段」都准备好了，我们只覆盖自己掌握的字段。
    //
    //   这一步是整套链路的关键补齐：
    //     · 商品属性（catProp）—— 页面属性区渲染不全时的兜底，直接对齐后端契约
    //     · 销售属性（saleProp）—— 绕过「SKU 表未生成」的 DOM 依赖
    //     · 主图 / 详情 —— 保底写入，确保提交体里一定带图
    //     · 提取方式（tbExtractWay）—— 运费模板同理
    const overrideFields: Record<string, unknown> = {}
    if (title) overrideFields.title = title
    if (price) overrideFields.price = Number(price)
    if (stock) overrideFields.quantity = Number(stock)
    if (itemNo) overrideFields.outerId = itemNo
    if (imageUrls.length) {
      overrideFields.mainImagesGroup = { images: imageUrls.map(u => ({ url: u, pix: '800x800' })) }
    }
    // 类目属性：显式值 → 后端 catProp 结构（p-XXXX → {value,text}）
    //   这里用「属性名 → 属性 id」映射；id 先从页面读，读到就写。
    const catPropOverride = await buildCatPropOverride(page, attributes || [])
    if (catPropOverride && Object.keys(catPropOverride).length) {
      overrideFields.catProp = catPropOverride
    }
    // 销售属性：直接把规格值写进 saleProp（照觅千手：克隆源商品的 saleProp 结构，
    //   键必须是真实 pid，形如 `p-122216343`；值是该维度的已选规格项）。
    if (skus.length) {
      const saleProp = await buildSalePropOverride(page, skus)
      if (saleProp && Object.keys(saleProp).length) {
        overrideFields.saleProp = saleProp
        console.log(`[dsagent-taobao-publish] 提交体 saleProp 覆盖：${Object.keys(saleProp).join(',')}`)
      }
      // SKU 行也一并给，价格/库存/编码走这里，不依赖页面 SKU 表
      overrideFields.sku = skus.map(s => ({
        props: [{ name: s.name }],
        price: s.price || price || '',
        quantity: s.stock || stock || '0',
        outerId: s.outerId || '',
      }))
      overrideFields.customSaleProp = [{ items: skus.map(s => ({ text: s.name })) }]
    }
    // 详情图：写进 descRepublicOfSell.descPageCommitParam.templateContent
    if (detailImageUrls.length) {
      const html = detailImageUrls.map(u => `<img src="${u}"/>`).join('')
      overrideFields.descRepublicOfSell = {
        descPageCommitParam: {
          opt: 0, clientType: 1, bizSource: 'sell', newItem: true, changed: true,
          params: 'params', maxHeight: 100000, templateContent: html,
        },
      }
      overrideFields.desc = html
      overrideFields.wirelessDesc = detailImageUrls.map(u => ({ type: 'img', url: u, pix: '790x1088' }))
    }

    let patcher: { wait: () => Promise<CommitPatchResult>; dispose: () => Promise<void> } | null = null
    if (Object.keys(overrideFields).length) {
      try {
        patcher = await installCommitPatcher(page, { fields: overrideFields })
        console.log(`[dsagent-taobao-publish] 已挂载提交体拦改，覆盖字段：${Object.keys(overrideFields).join(',')}`)
      } catch (e) {
        console.log(`[dsagent-taobao-publish] 提交体拦改挂载失败（不阻塞发布）：${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ── 5. 点提交 ─────────────────────────────────────────
    const clicked = await clickSubmit(page)
    console.log(`[dsagent-taobao-publish] 提交按钮点击：${clicked ? '已点击' : '未点到（可能仍需补全必填项）'}`)

    // 等拦改结果（最多 60s，不阻塞后续结果判定）
    if (patcher) {
      const pr = await patcher.wait().catch(() => null)
      if (pr) {
        if (pr.patched) {
          console.log(`[dsagent-taobao-publish] 提交体已改写：${pr.patchedFields.join(',')}`
            + `（${pr.beforeLen} → ${pr.afterLen} 字节）`)
          uploadNotes.push(`✓ 提交体拦改生效（覆盖 ${pr.patchedFields.length} 个字段：`
            + `${pr.patchedFields.slice(0, 8).join('、')}${pr.patchedFields.length > 8 ? '…' : ''}）`)
        } else {
          console.log(`[dsagent-taobao-publish] 提交体未改写：${pr.reason || '未知'}（url=${pr.url || '-'}）`)
        }
      }
      await patcher.dispose().catch(() => {})
    }

    // ── 6. 判定结果（含用户手动补全后自行提交的情形）─────────
    let finalUrl = page.url()
    let bodyText = ''
    let successId = ''
    let success = false
    let errText = ''
    let errPanel = ''
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(2000)
      finalUrl = page.url()

      // ★★ URL 判定放在最前（先于风控/文案/面板三路诊断）：
      //   淘宝发布成功的落地页是 `sell/v2/success.htm?primaryId=<商品ID>&catId=...&isEdit=false`。
      //   真机实测（2026-10-28）该页既无 #success-container、正文也无「发布成功」字样，
      //   且残留的校验提示会被 readSubmitErrors 当成硬拦因 —— 三者叠加导致
      //   「商品已发布却 180s 空转报未检测到成功标志」的假阴性（连踩两次）。
      //   URL 命中 success.htm 是平台自己的路由事实，比任何文案都可靠，直接判成功。
      if (/\/sell\/v\d*\/?success\.htm/i.test(String(finalUrl || ''))) {
        success = true
        successId = String(finalUrl).match(/primaryId=(\d+)/i)?.[1] || ''
        console.log(`[dsagent-taobao-publish] 发布成功（URL 判定）：success.htm，商品ID=${successId || '(未取到)'}`)
        break
      }

      const risk = await detectRisk(page)
      if (risk.hit) {
        return {
          ok: false,
          failureKind: 'risk_control',
          shopKey,
          finalUrl,
          verifyUrl: risk.verifyUrl,
          text: `提交时命中安全风控（baxia 滑块 / 访问被拒绝）。\n`
            + (risk.verifyUrl ? `验证入口：${risk.verifyUrl}\n` : '')
            + '请调用 dsagent_risk_verify（platform=taobao'
            + (risk.verifyUrl ? `，verifyUrl=${risk.verifyUrl}` : '')
            + '）完成滑块验证后，在浏览器窗口内重新提交。',
        }
      }

      try {
        const probe = await page.evaluate(() => {
          const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
          if (document.querySelector('#success-container')) {
            const m = txt.match(/商品ID[:：]\s*(\d+)/)
            return { kind: 'success', id: m ? m[1] : '' }
          }
          const m2 = txt.match(/商品ID[:：]\s*(\d+)/)
          if (m2) return { kind: 'success', id: m2[1] }
          if (/发布成功|上架成功|提交成功|已提交成功/.test(txt)) return { kind: 'success', id: '' }
          const err = txt.match(/发布失败[^。]{0,80}|提交失败[^。]{0,80}|请输入商品标题[^。]{0,40}|标题不能超过[^。]{0,30}|请输入价格[^。]{0,40}|请输入库存[^。]{0,40}|库存不能为空|图片格式不正确[^。]{0,40}|请完善必填信息[^。]{0,40}|类目属性[^。]{0,40}未填/)
          if (err) return { kind: 'error', msg: err[0] }
          return { kind: '', id: '' }
        }) as { kind: string; id?: string; msg?: string }
        bodyText = ''
        if (probe.kind === 'success') { success = true; successId = probe.id || ''; break }
        // 兜底词表命中不立即中断：真实拦因以「商品填写建议」面板为准（见下方 readSubmitErrors）
        if (probe.kind === 'error') { errText = probe.msg || '' }
      } catch { /* 页面跳转中，下一轮再取 */ }

      // ★ 诊断：读 toast + 字段级红字 +「商品填写建议」面板（三路精准诊断）
      try {
        const diag = await readSubmitErrors(page)
        if (diag.panel) errPanel = diag.panel
        if (diag.hard) {
          console.log(`[dsagent-taobao-publish] 提交被拦：${diag.hard}`)
          errText = diag.hard
          break  // 硬拦因命中，不必继续等
        }
      } catch { /* 诊断失败不影响主流程 */ }
    }

    if (errPanel) console.log(`[dsagent-taobao-publish] 填写建议面板：${errPanel}`)

    if (success) {
      succeeded = true
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }

      // ── 类目档案自动保存（g5 铁律 2+3）：发布成功 → 本次实际生效值全量写回 ──
      // ★ 必须在页面跳转后立即保存吗？不用——快照在填写期间已收集（attrs.confirmed 等）。
      // ★ save 的合并语义即「自动修复」：patch 覆盖旧同名键（过期值被实际生效值修复）、
      //   schemaNames 清单外的旧属性清除（类目改版）、schema 内未生效的旧属性保留（用户手写）。
      // ★ 写失败只 warn 不影响发布结果（对齐 attr-cache 纪律）。
      let profileSaved = ''
      if (publishCatId) {
        try {
          const saved = await profileStore.save(channelKey, publishCatId, publishCategoryName, {
            attributes: attrs.confirmed,
            schemaNames: attrs.schemaNames,
            schemaFp: attrs.schemaFp,
            freightTemplate: ex.template,
          })
          if (saved) {
            profileSaved = saved.file || ''
            console.log(`[dsagent-taobao-publish] 类目档案已保存：${profileSaved}（属性 ${Object.keys(saved.attributes).length} 项）`)
          }
        } catch (e) {
          console.warn('[dsagent-taobao-publish] 类目档案保存失败（不影响发布）:',
            e instanceof Error ? e.message : String(e))
        }
      }

      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `${channel.label}商品发布已提交成功。\n`
          + `账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${title}\n`
          + (successId ? `商品ID：${successId}\n` : '')
          + (uploadNotes.length ? `图片：${uploadNotes.join('\n      ')}\n` : '')
          + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
          + (missed.length ? `未自动填写（需人工确认）：${missed.join('、')}\n` : '')
          + (profileSaved ? `类目档案已更新：~/.dsh/publish-profiles/${profileSaved}（下次发布同类目直接复用）\n` : '')
          + `当前页面：${finalUrl}\n`
          + '注意：平台仍可能对商品做审核，最终状态请在千牛/卖家中心的「出售中的宝贝」确认。',
      }
    }

    if (errText) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl,
        text: `发布失败：${errText}\n`
          + (errPanel ? `★ 填写建议面板：${errPanel}\n` : '')
          + (uploadNotes.length ? `★ 图片链路：${uploadNotes.join('；')}\n` : '')
          + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : '')
          + '请在浏览器窗口内补全必填项（尤其是**类目属性**与商品详情）后手动点击「提交宝贝信息」。',
      }
    }

    // ★ 诊断：把页面可见文本 + 截图落盘，供定位「为何 180s 内未发布成功」
    let pageText = ''
    try {
      pageText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200))
    } catch { /* 忽略 */ }
    let shotPath = ''
    try {
      const shotDir = join(process.cwd(), 'dev', '.ui-shots')
      await mkdir(shotDir, { recursive: true })
      shotPath = join(shotDir, `taobao-fail-${Date.now()}.png`)
      await page.screenshot({ path: shotPath })
      console.log(`[dsagent-taobao-publish] 失败截屏：${shotPath}`)
    } catch { /* 忽略 */ }

    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl,
      text: `提交后 ${PUBLISH_TIMEOUT_MS / 1000}s 内未检测到成功标志（当前 URL：${finalUrl}）。\n`
        + (uploadNotes.length ? `图片链路：${uploadNotes.join('；')}\n` : '')
        + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
        + (missed.length ? `★ 未能自动填写：${missed.join('、')}\n` : '')
        + (shotPath ? `失败截屏：${shotPath}\n` : '')
        + (pageText ? `页面文本：${pageText}\n` : '')
        + '请打开浏览器窗口查看具体提示：\n'
        + '  · 若页面仍有红色校验提示（类目属性、详情、发货设置等），补全后手动点「提交宝贝信息」；\n'
        + '  · 若出现滑块/安全验证，请人工完成；\n'
        + '  · 处理完成后若已发布成功，可在千牛「出售中的宝贝」核对结果。',
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `${channel.label}发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser && attached) {
      // 窗口是复用的，只断开调试连接，保持用户窗口原样
      try { browser.disconnect() } catch { /* 忽略 */ }
    } else if (browser && succeeded) {
      try { await browser.close() } catch { /* 忽略 */ }
    } else if (browser) {
      console.log('[dsagent-taobao-publish] 未发布成功，浏览器窗口保持打开，供人工补全字段 / 处理验证后手动提交。')
    }
  }
}
