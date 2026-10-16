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
import { type AttrModelHandle } from './pdd-publish.js'
import { loadPublishConfig, anchorSpec, configString, configTimeout, type PublishConfig } from './services/publish-config-loader.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile, registerProfilePort, registeredPortFor, verifyPortOwnership, sleep, UI_STEP_DELAY_MS } from './browser-login.js'
import { schemaFingerprint } from './services/attr-cache.js'
import { createCategoryProfileStore, type CategoryProfile, type CategoryProfileStore } from './services/category-profile.js'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

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
    `主图（${images.length} 张）：`,
    ...images.map(p => `  - ${p}`),
    `多规格（SKU）：${(opts.skus || []).length ? `${(opts.skus || []).length} 项` : '（未填，单 SKU）'}`,
    ...((opts.skus || []).map(s => `  - ${s.name}｜价格=${s.price || '继承一口价'}｜库存=${s.stock || '0'}${s.outerId ? `｜编码=${s.outerId}` : ''}`)),
    '',
    '★ 本工具自动填：主图 / 标题 / 一口价 / 库存 / 货号，以及**类目属性**（用文本模型从页面真实',
    '  候选中挑值：如「充值方式 / 模型或平台 / 软件类型」）和物流服务的「提取方式」（勾「使用物流配送」）。',
    '  传了 skus 会自动加销售属性值并回填 SKU 表价格/数量/编码。',
    '  品牌不自动填（授权风险，由 brand 参数在选类目页填）。商品详情、发货与售后等仍需人工补全。',
    '  另外：发布第一步需要**选类目**；传了 categoryKeyword 会自动搜索并按与标题的相关性挑最匹配类目，',
    '  若该类目把「品牌/型号」列为必填属性（如「AI软件订阅/Token充值」），会用 brand/model 参数自动填上。',
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正打开浏览器提交。',
    '注意：发布是不可撤销的真实操作（L2）。',
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

    // ★ 退化路径 B：主页面直接找 input[type=file]（新版发布页不走素材弹层）
    if (!fileInput) {
      console.log('[dsagent-taobao-publish] 素材弹层内未找到 input[type=file]，尝试主页面直接上传…')
      // 关闭弹层（如有）
      await page.evaluate(() => {
        const close = document.querySelector('[class*=close], .next-dialog-close, button[aria-label*=close]') as HTMLElement | null
        if (close) close.click()
      }).catch(() => {})
      await sleep(500)
      // 找主图区的上传按钮并点击，然后等 input[type=file] 出现
      const clicked = await page.evaluate(() => {
        const area = document.querySelector('#struct-mainImagesGroup') as HTMLElement | null
        if (!area) return false
        // 找含「上传图片」文本的按钮
        const btns = Array.from(area.querySelectorAll('button, [role=button], a, div')) as HTMLElement[]
        const target = btns.find(el => {
          const t = (el.innerText || el.textContent || '').trim()
          return /上传图片|本地上传|点击上传/.test(t) && el.offsetParent !== null && el.children.length <= 3
        })
        if (target) { (target as HTMLElement).click(); return true }
        // 退化：直接点击虚线占位区
        const dashed = area.querySelector('[class*=dashed], .image-empty') as HTMLElement
        if (dashed) { (dashed as HTMLElement).click(); return true }
        return false
      }).catch(() => false) as boolean
      if (clicked) {
        for (let i = 0; i < 10; i++) {
          await sleep(800)
          fileInput = await page.$('input[type=file]').catch(() => null)
          if (fileInput) break
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
  return await page.evaluate(() => {
    const out: { id: string; name: string; required: boolean; filled: boolean; kind: string; maxlength: number; hint: string; value: string }[] = []
    const root = document.getElementById('struct-catProp')
    if (!root) return out
    const items = Array.from(root.querySelectorAll('[id^="struct-p-"]')) as HTMLElement[]
    for (const it of items) {
      const field = document.getElementById('sell-field-' + it.id.replace(/^struct-/, ''))
      if (!field) continue
      const labelEl = field.querySelector('.sell-component-info-wrapper-label') as HTMLElement | null
      const name = (labelEl?.innerText || '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      if (!name) continue
      const required = !!field.querySelector('.sell-component-info-wrapper-required')
      const ac = field.querySelector('.next-select-auto-complete') as HTMLElement | null
      const trg = field.querySelector('.next-select-trigger') as HTMLElement | null
      const inp = field.querySelector('input, textarea') as HTMLInputElement | null
      const kind = ac ? 'combobox' : (trg ? 'select' : 'text')
      const val = (inp?.value || '').trim()
      const shown = ((field.querySelector('.next-select-values') as HTMLElement | null)?.innerText || '').trim()
      // 类目规则：从 DOM 读 maxlength（文本/combobox 输入框）+ 校验提示（字段下方红色文案）
      const ml = inp ? (Number(inp.getAttribute('maxlength')) || (inp.maxLength > 0 ? inp.maxLength : 0)) : 0
      const hintEl = field.querySelector('.sell-component-info-wrapper-explain, .next-form-item-help, [class*="error"], [class*="help"]') as HTMLElement | null
      const hint = (hintEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      // ★ 页面已有值：输入框 value 优先，select 组件用展示文本（.next-select-values），
      //   过滤「请选择」类占位符。filled=true 时非空——档案快照直接用这个。
      const placeholder = /^(请选择|请输入|请填写|—|-)$/
      const curVal = val || (placeholder.test(shown) ? '' : shown)
      out.push({ id: it.id, name, required, filled: !!(val || shown), kind, maxlength: ml, hint, value: curVal })
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
    const field = document.getElementById('sell-field-' + sid.replace(/^struct-/, ''))
    if (!field) return false
    const trigger = (field.querySelector('.next-select-auto-complete')
      || field.querySelector('.next-select-trigger')
      || field.querySelector('input')) as HTMLElement | null
    if (!trigger) return false
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

/** 点选后回读属性项，确认值确实落到了控件上（选中值可能写在 input.value 或 .next-select-values 文本里） */
async function verifyPropValue(page: any, id: string, value: string): Promise<boolean> {
  return await page.evaluate((sid: string, v: string) => {
    const field = document.getElementById('sell-field-' + sid.replace(/^struct-/, ''))
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
  },
): Promise<{ filled: string[]; missed: string[]; confirmed: Record<string, string>; schemaNames: string[]; schemaFp: string; profile: CategoryProfile | null }> {
  const filled: string[] = []
  const missed: string[] = []
  /** 本次确认生效的属性值（档案落盘 patch；含页面预填值，见函数尾部） */
  const confirmedAttrs: Record<string, string> = {}
  /** 档案/日志用的平台键（'taobao'/'tmall'，档案按渠道分开存） */
  const PLATFORM = ctx.platform || 'taobao'
  const explicitMap = new Map((ctx.explicit || []).map(a => [a.name, a.value]))
  const all = await readCatPropItems(page)
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
  const todo = all.filter(i => i.name && !i.filled && !ATTR_SKIP_RE.test(i.name) && i.kind !== 'text')
  if (all.length) {
    console.log(`[dsagent-taobao-publish] 类目属性共 ${all.length} 项，待填 ${todo.length} 项`
      + `${todo.length ? `：${todo.map(i => i.name).join('、')}` : ''}`)
  }

  for (const it of todo) {
    const opened = await openPropDropdown(page, it.id)
    if (!opened) { missed.push(`${it.name}（未能展开下拉）`); continue }
    await waitForPropPanel(page, ATTR_DROPDOWN_WAIT_MS)
    const options = await readPropOptions(page)
    if (!options.length) {
      await closePropDropdown(page)
      missed.push(`${it.name}（下拉未读到选项）`)
      continue
    }

    let pick: { value: string; hesitated: boolean; candidates: number } | null = null
    let source = ''

    // ── ① 显式值优先（精确匹配页面真实候选）──
    const explicitVal = explicitMap.get(it.name)
    if (explicitVal && options.includes(explicitVal)) {
      pick = { value: explicitVal, hesitated: false, candidates: options.length }
      source = '显式'
    }

    // ── ② 类目档案（g5）：平台+catId 档案里上次生效的值，仍在当前候选里就直接用 ──
    //    ★ 命中即验证：不在候选 → 降级走 ③模型（新值生效后随成功写回 = 自动修复）。
    if (!pick && profile) {
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

    if (!pick) {
      await closePropDropdown(page)
      console.log(`[dsagent-taobao-publish] 属性「${it.name}」候选：${options.join(' / ')}`)
      missed.push(`${it.name}（候选 ${options.length} 项，未选到值）`)
      continue
    }
    const ok = await clickPropOption(page, pick.value)
    await sleep(400)
    const confirmed = ok && await verifyPropValue(page, it.id, pick.value)
    await closePropDropdown(page)
    if (confirmed) {
      filled.push(`${it.name}=${pick.value}（${source}）`)
      confirmedAttrs[it.name] = pick.value
    } else {
      missed.push(`${it.name}（点选「${pick.value}」${ok ? '后未确认到值' : '失败'}）`)
    }
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
  const checked = await page.evaluate(() => {
    const box = document.getElementById('struct-tbExtractWay') as HTMLElement | null
    if (!box) return false
    const inp = box.querySelector('input[type="checkbox"][value="2"]') as HTMLInputElement | null
    if (!inp) return false
    if (inp.checked) return true
    const label = inp.closest('label') as HTMLElement | null
    ;(label || inp).click()
    return true
  }).catch(() => false) as boolean
  if (!checked) return { ok: false }
  await sleep(600)

  // ① 展开运费模板下拉（next 组件必须用 JS 原生 click）
  const opened = await page.evaluate(() => {
    const box = document.getElementById('struct-tbExtractWay') as HTMLElement | null
    const trigger = box?.querySelector('.next-select-trigger') as HTMLElement | null
    if (!trigger) return false
    trigger.click()
    return true
  }).catch(() => false) as boolean
  if (!opened) {
    // 没有模板下拉（少数类目不需要），勾选即算完成
    return { ok: true }
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
  const confirmed = await page.evaluate(() => {
    const box = document.getElementById('struct-tbExtractWay') as HTMLElement | null
    if (!box) return false
    const inp = box.querySelector('input[type="checkbox"][value="2"]') as HTMLInputElement | null
    const val = (box.querySelector('.next-select-values')?.textContent || '').trim()
    return !!inp?.checked && !!val
  }).catch(() => false) as boolean
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
  const inputPos = await page.evaluate((re: string, propId: string) => {
    const rx = new RegExp(re)
    const box = document.getElementById('struct-saleProp') as HTMLElement | null
    const scope = (box?.querySelector(`#struct-p-${propId}`) as HTMLElement | null) || box
    if (!scope) return null
    const inputs = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[]
    const hit = inputs.find(i => rx.test(i.placeholder || ''))
      || inputs.find(i => i.type !== 'checkbox' && i.type !== 'radio')
    if (!hit) return null
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, SALE_PROP_PLACEHOLDER_RE.source, SALE_PROP_ID).catch(() => null) as { x: number; y: number } | null

  if (!inputPos) {
    missed.push('多规格（未找到销售属性输入框 #struct-saleProp）')
    return { filled, missed }
  }

  // ── ② 逐个规格值键入 + Tab ──
  for (const sku of wanted) {
    await page.mouse.move(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(200)
    await page.mouse.click(inputPos.x, inputPos.y).catch(() => { /* 忽略 */ })
    await sleep(300)
    await page.keyboard.type(sku.name, { delay: 60 }).catch(() => { /* 忽略 */ })
    await sleep(300)
    // ★ Tab = onBlur，唯一能提交到 React state 的方式
    await page.keyboard.press('Tab').catch(() => { /* 忽略 */ })
    await sleep(1200)
  }

  // ── ③ 回读已生成的 SKU 行 ──
  const rows = await page.evaluate((propId: string) => {
    const box = document.getElementById('struct-sku') as HTMLElement | null
    if (!box) return []
    return Array.from(box.querySelectorAll('tr.sku-table-row')).map((tr, idx) => {
      const td = (suffix: string) => tr.querySelector(`td[id$="${suffix}"]`) as HTMLElement | null
      const colorTd = td(`-p-${propId}`)
      const priceInp = td('-skuPrice')?.querySelector('input') as HTMLInputElement | null
      const stockInp = td('-skuStock')?.querySelector('input') as HTMLInputElement | null
      const outerInp = td('-skuOuterId')?.querySelector('input') as HTMLInputElement | null
      return {
        idx,
        color: (colorTd?.innerText || colorTd?.textContent || '').trim(),
        price: priceInp?.value || '',
        stock: stockInp?.value || '',
        outerId: outerInp?.value || '',
      }
    })
  }, SALE_PROP_ID).catch(() => []) as Array<{ idx: number; color: string; price: string; stock: string; outerId: string }>

  if (!rows.length) {
    missed.push('多规格（规格值已输入但 SKU 表未生成）')
    return { filled, missed }
  }

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
  return await page.evaluate((sel1: string, sel2: string, textReSrc: string) => {
    const primary = (document.querySelector(sel1)
      || document.querySelector(sel2)) as HTMLButtonElement | null
    if (primary && !primary.disabled) { primary.click(); return true }
    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const re = new RegExp(textReSrc)
    const hit = btns.find(b =>
      re.test((b.innerText || '').trim())
      && !b.disabled && b.offsetParent !== null)
    if (!hit) return false
    hit.click()
    return true
  }, SUBMIT_BTN_SEL1, SUBMIT_BTN_SEL2, SUBMIT_TEXT_RE_SRC).catch(() => false) as boolean
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
  const skus = (Array.isArray(opts.skus) ? opts.skus : [])
    .map(s => ({
      name: String(s?.name || '').trim(),
      price: String(s?.price ?? '').trim(),
      stock: String(s?.stock ?? '').trim(),
      outerId: String(s?.outerId ?? '').trim(),
    }))
    .filter(s => s.name)

  if (!images.length) {
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
  if (opts.confirm !== true) {
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
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

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
    const entryUrl = channel.categoryUrl || channel.url
    console.log(`[dsagent-taobao-publish] 打开${channel.label}发布入口：${entryUrl}`)
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(4000)

    // ── 1.5 选类目：传了 categoryKeyword 自动选（候选按与标题相关性降序），否则等用户手动选 ──
    // 选完类目会**新开标签页** sell/v2/publish.htm?catId=...，需把 page 切到新页继续。
    const onCategoryPage = /category\.htm/i.test(page.url())
      || await page.evaluate(() =>
        !!document.querySelector('input[placeholder*="类目关键词"]')).catch(() => false)
    if (onCategoryPage) {
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

    // ── 3. 上传主图（发布页内直传）──────────────────────────
    const up = await uploadImages(page, images)
    console.log(`[dsagent-taobao-publish] 主图上传：${up.note}`)

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
    const filled: string[] = []
    const missed: string[] = []

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

    // ── 4.5 类目属性 ──
    // ★ 复刻上架助手 6.33：先点「一键采纳推荐值」让平台 AI 填属性（等价于 MTOP wireless.ai.publish.render），
    //   再用显式值/档案/模型逐项补全未被推荐覆盖的必填项。
    const adopted = await adoptRecommendations(page)
    if (adopted) filled.push('一键采纳推荐值')
    const attrs = await fillCategoryAttrs(page, {
      title, model: attrModel, explicit: attributes,
      catId: publishCatId, platform: channelKey,
    })
    filled.push(...attrs.filled)
    missed.push(...attrs.missed)

    // ── 4.6 物流服务「提取方式」勾选「使用物流配送」+ 选运费模板（优先回放类目档案）──
    const ex = await fillExtractWay(page, attrs.profile?.freightTemplate)
    if (ex.ok) filled.push(`提取方式=使用物流配送+运费模板${ex.template ? `（${ex.template}）` : ''}`)
    else missed.push('提取方式')

    // ── 4.7 多规格（销售属性）填写：规格值 + SKU 表价格/数量/编码 ──
    if (skus.length) {
      const skuRes = await fillSkus(page, skus)
      filled.push(...skuRes.filled.map(s => `SKU ${s}`))
      missed.push(...skuRes.missed)
    }

    console.log(`[dsagent-taobao-publish] 已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`)
    await sleep(1500)

    // ── 5. 点提交 ─────────────────────────────────────────
    const clicked = await clickSubmit(page)
    console.log(`[dsagent-taobao-publish] 提交按钮点击：${clicked ? '已点击' : '未点到（可能仍需补全必填项）'}`)

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
