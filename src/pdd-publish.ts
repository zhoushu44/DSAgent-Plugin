/**
 * 拼多多 商家后台 商品发布 — host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP：
 *   1. 发布的核心动作是**图片文件上传（multipart 二进制）**，而网关 handleProxy
 *      只支持字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
 *   2. 商家后台发布页的类目、属性与提交接口都要求页面 JS 运行时生成的签名
 *      与真实会话票据（PASS_ID），纯 HTTP 复刻不可行。
 *   3. 开放平台的 pdd.goods.add 只对**已审核通过的自研应用**开放，
 *      普通店铺拿不到资质，因此只能驱动商家后台网页版发布页。
 *
 * ★★ 发布的正确入口是**两步式**，不能直接敲表单 URL（真实实测结论）：
 *   直接 goto /goods/goods_add/index 会得到一个「空壳页」——#goods-category 为空、
 *   底部按钮永远是「加载中」且 disabled、发布表单自身的初始化接口一个都不发。
 *   原因是该页需要 type=add&from=category&version=predictCate&id=<类目id>&goods_id=<商品id>
 *   这组上下文参数，而它们由平台在「发布新商品」入口处即时生成。
 *
 *   因此本工具严格按真实链路走四段：
 *     段 1  打开商品列表 /goods/goods_list → 点右上角「发布新商品」（会**新开标签页**）
 *     段 2  第一步（主图 + 标题）页 /goods/category?id=…&goods_id=…&type=add
 *           → 上传主图 → 填标题 → 点「下一步, 完善商品信息」
 *     段 3  第二步（完整表单）页 /goods/goods_add/index?type=add&from=category&version=predictCate&id=…
 *           → 此时表单才真正初始化，类目由平台按 id 自动带出（「修改分类」可改）
 *     段 4  填通用字段 → 点「提交并上架」→ 轮询结果
 *
 * 页面与控件锚点来源：**本机真机实测**（非推测、非影刀旧选择器）。
 * ★ 注意：影刀（ShadowBot）工程 xbot_robot/selectorsV2.xml 里的锚点已**全部过时**，
 *   实测已证伪，切勿再参考：
 *     - 类目搜索框 input[placeholder="请输入关键词搜索分类"] —— 真实流程中该框不存在
 *     - 类目面板 .cate-container-v2 —— 实为 .category_v4_cateContainerV4__2jyMc（v4）
 *     - 提交按钮 button#submit_button —— 不存在
 *   实测有效的锚点：
 *     - 列表入口按钮： 文本恰为「发布新商品」的最内层可见元素
 *     - 第一步主图：   input[data-tracking-click-viewid="local_upload"]（visible，accept 图片）
 *     - 第一步标题：   #goods_name input[data-testid="beast-core-input-htmlInput"]
 *     - 第一步下一步： button#bottomSubmitBtnId（innerText「下一步, 完善商品信息」）
 *     - 第二步标题：   input[data-tracking-click-viewid="title_input_area"]
 *     - 第二步主图：   input[data-tracking-click-viewid="carousel_img_localfile_upload"]
 *     - 第二步提交：   文本恰为「提交并上架」的可见 button
 *     - 提交成功：     div[data-testid="beast-core-toast"] / 「查看商品详情」
 *     - 风控滑块：     div#slide-captcha-dialog / .captcha-wrapper__slider /
 *                      div.slide-handlebar / #slide-button
 *
 * ★ 与淘宝发布的根本差异：拼多多发布页**没有 iframe**（淘宝主图走 sucai-selector-ng
 *   素材选择器 iframe），所有控件都在主文档里，直接操作即可。
 * ★ 另一处差异：拼多多的滑块风控是**页内内联**的（不是淘宝那种 baxia iframe 拦截页），
 *   因此不能交给 dsagent_risk_verify 另开窗口处理 —— 本工具改为在**已打开的可见窗口内**
 *   等待用户完成拼图后自动继续（见 waitSliderCleared）。
 *
 * ★ 字段策略（与用户确认）：**类目走平台自动 + 通用字段自动填 + 其余人工兜底**
 *   自动：类目（平台按入口 id 智能推荐，如「餐饮具 > 杯子/水杯/水壶 > 马克杯」）、
 *         主图、标题、参考价、库存、货号、商品属性（用文本模型从**页面真实下拉选项**里选，
 *         见 fillAttributes；品牌因涉及品牌授权，不自动填）
 *   人工兜底：商品详情、发货/售后设置、SKU —— 由用户在可见浏览器窗口内补全；
 *             若提交被校验拦住，工具会把「商品填写建议」面板里的真实拦因读回来
 *             （见 readSubmitErrors），并继续等待、识别用户手动提交的结果。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

/** 商品列表入口 —— 发布的**唯一正确起点**（从列表点「发布新商品」才会带上完整上下文参数） */
const PDD_GOODS_LIST_URL = 'https://mms.pinduoduo.com/goods/goods_list'

/** 账号连接页展示的平台 id（凭证库 platform 字段取值） */
const PLATFORM = 'pdd_mms'

/** 第一步（主图 + 标题）页 URL 特征 */
const STEP1_URL_RE = /\/goods\/category\?/
/**
 * 第二步（完整表单）页 URL 特征。
 * ★ 真机实测实际 URL：
 *   /goods/goods_add/index?type=add&from=category&version=predictCate&id=<类目id>
 *     &goods_id=<商品id>&sourcePage=goodsList
 *   参数会随入口变化（另有 sourcePage=goodsList 等），故**只认路径前缀**，
 *   不写死 `index?`（写死会在参数形态变化时寻址失败，卡在第一步）。
 */
const STEP2_URL_RE = /\/goods\/goods_add\//

/** 第一步就绪标志（标题容器 或 底部「下一步」按钮出现） */
const STEP1_READY_SELECTOR = '#goods_name, button#bottomSubmitBtnId'
/** 第二步就绪标志（标题输入框 或 类目展示区出现） */
const STEP2_READY_SELECTOR = 'input[data-tracking-click-viewid="title_input_area"], #goods-category'

/** 第一步主图 file input（真机实测锚点，可见） */
const STEP1_IMAGE_INPUT = 'input[data-tracking-click-viewid="local_upload"]'
/** 第一步标题输入框（真机实测锚点） */
const STEP1_TITLE_INPUT = '#goods_name input[data-testid="beast-core-input-htmlInput"]'
/** 第一步「下一步, 完善商品信息」按钮（真机实测锚点） */
const STEP1_NEXT_BTN = 'button#bottomSubmitBtnId'
/** 第二步主图 file input（真机实测锚点；通常继承第一步已传图片，仅作兜底） */
const STEP2_IMAGE_INPUT = 'input[data-tracking-click-viewid="carousel_img_localfile_upload"]'
/** 第二步「商品详情」图片 file input（真机实测锚点；离屏隐藏 input，直接投递即可） */
const STEP2_DETAIL_INPUT = 'input[data-tracking-click-viewid="detail_img_localfile_upload"]'
/** 详情图张数上限（页面计数「已上传 N/50张」） */
const MAX_DETAIL_IMAGES = 50
/** SKU 规格类型：SKU 带预览图 → 用视觉规格「颜色」（真机实测候选里第一项是噪声「官方 客服 1」） */
const SKU_SPEC_TYPE = '颜色'

/** 等商品列表就绪（同时处理滑块与登录失效） */
const LIST_WAIT_MS = 60_000
/** 等表单就绪（中间可能夹着用户手动补全） */
const FORM_WAIT_MS = 150_000
/** 点提交后等结果（含用户手动补全字段后自行提交的时间） */
const PUBLISH_TIMEOUT_MS = 180_000
/** 图片上传等待 */
const UPLOAD_WAIT_MS = 90_000
/** 命中内联滑块后，等用户在窗口内完成拼图的时长 */
const SLIDER_WAIT_MS = 120_000
/** 单张主图上限：商家后台主图要求 ≤ 3MB */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
/** 主图张数上限（拼多多主轮播图最多 10 张，超出以页面提示为准） */
const MAX_IMAGES = 10
/** 标题长度上限（placeholder 标注「最多输入30个汉字（60个字符）」） */
const MAX_TITLE_LEN = 60
/** 库存默认值：调用方未指定时按 1000 填（真机实测库存是平台提交硬性必填，留空必被拦） */
const DEFAULT_STOCK = '1000'

/**
 * 「商品属性」自动选值所用的文本模型（OpenAI 兼容 /chat/completions）。
 *
 * ★ 为什么不是 https://api.typesafe.ai/v1/systemone + jev-latest：
 *   那是 jev-ultrafast 的**浏览器决策模型**（输入「页面元素表」，只回一个元素 id），
 *   不是通用对话模型 —— 实测直接请求返回
 *   400 {"detail":{"error_type":"api_usage_error","message":"Invalid request."}}。
 *   「填属性」要的是「从给定选项里挑一个」，用同一套内置配置里的文本模型即可
 *   （实测：model=deepseek-v4-flash 返回 {"材质种类":"陶瓷"}）。三项均可被环境变量覆盖。
 */
const ATTR_MODEL_BASE_URL = process.env.PDD_TEXT_MODEL_BASE_URL || ''
const ATTR_MODEL_API_KEY = process.env.PDD_TEXT_MODEL_API_KEY || ''
const ATTR_MODEL = process.env.PDD_TEXT_MODEL || 'deepseek-v4-flash'
/** 单次属性选值请求超时：模型不可用要快速跳过，不能拖垮发布流程 */
const ATTR_MODEL_TIMEOUT_MS = 20_000
/** 展开下拉 / 选值后的等待（beast-core Select 有展开动画与异步选项） */
const ATTR_DROPDOWN_WAIT_MS = 800
/** 不自动填的属性：品牌涉及品牌授权，选错有侵权风险，一律留给人工 */
const ATTR_SKIP_RE = /^品牌$/

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '拼多多发布'

/** 一个 SKU（规格值）的输入：规格值名 + 预览图 + 价格 */
export interface PddSkuInput {
  /** 规格值名（如「白色」）。每个值会成为 SKU 表的一行 */
  name: string
  /** 该规格值的「*预览图」绝对路径（必填：预览图列是平台提交必填项，缺了必被拦） */
  image?: string
  /** 该规格值的拼单价（元，字符串数字） */
  price?: string
  /** 该规格值的库存（件，字符串数字，选填）。★ 不填回落到 stock / DEFAULT_STOCK */
  stock?: string
}

export interface PddPublishOptions {
  /** 本地图片绝对路径列表（至少 1 张，最多 10 张） */
  images: string[]
  /** 商品标题（必填，≤ 60 字符） */
  title: string
  /** 类目关键词或完整路径（选填，如「纸杯」或「餐饮具 > 一次性餐桌用品 > 纸杯」）。
   *  ★ 实测：类目由平台按发布入口的 id 智能推荐自动带出，本工具不自动选类目；
   *    该参数仅作提示（如需改类目，用户可在第二步页面点「修改分类」） */
  category?: string
  /** 商品参考价（元，字符串数字，选填） */
  price?: string
  /** 库存（件，字符串数字，选填）。★ 不填按 DEFAULT_STOCK（1000）填 */
  stock?: string
  /** 货号 / 商家编码（选填）。★ 默认不填（不传即不写该列） */
  itemNo?: string
  /** 详情页图片绝对路径列表（选填，最多 50 张；单张 ≤3MB，规则同主图） */
  detailImages?: string[]
  /**
   * SKU 多规格（选填）。提供后自动执行：
   *   添加规格类型「颜色」→ 逐个填规格值 → 逐行填价格/库存 → 逐行投递预览图。
   * ★ 单买价一律按「该行拼单价 + 1」自动算（平台硬规则：单买价 ≥ 拼单价+1）。
   */
  skus?: PddSkuInput[]
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface PddPublishResult {
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
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 给一段填表操作套「卡死看门狗」：超过 budgetMs 仍未返回就**截图 + 打印页面文案**，
 * 用于定位到底被什么挡住（弹层 / 滑块 / 报错 toast）。
 *
 * 背景（真机实测）：某次 run 在第二步填价处静默卡死 9 分钟无输出，事后无任何现场证据，
 * 只能靠猜。puppeteer 单次 click 默认空等 30s 超时，几格叠加就是分钟级黑洞，
 * 因此这里既加超时看门狗，也把各次 click 的超时压到 5s（见 fillPriceTable）。
 *
 * 注意：看门狗只做诊断，**不中断**正在跑的 fn（无法安全打断 puppeteer 调用链），
 * 真正的兜底是各处各自的短超时。
 */
async function withStallWatch<T>(page: any, label: string, budgetMs: number, fn: () => Promise<T>): Promise<T> {
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    void (async () => {
      try {
        const png = await page.screenshot({ fullPage: false }).catch(() => null)
        if (png) {
          writeFileSync(`.tmp-stall-${label}.png`, png)
          console.log(`[dsagent-pdd-publish] ★「${label}」已卡住 ${Math.round(budgetMs / 1000)}s，截图：.tmp-stall-${label}.png`)
        }
        const txt = await page.evaluate(() =>
          ((document.body as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))
          .catch(() => '')
        console.log(`[dsagent-pdd-publish] ★「${label}」卡住时页面文案：${txt}`)
      } catch { /* 仅诊断，失败无所谓 */ }
    })()
  }, budgetMs)
  try {
    return await fn()
  } finally {
    clearTimeout(timer)
    if (fired) console.log(`[dsagent-pdd-publish] 「${label}」最终已返回（看门狗已触发过）`)
  }
}

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 *
 * ★ 候选集只取 `platform === 'pdd_mms'`（拼多多商家后台），**不做凭证层降级**：
 *   买家 H5（platform `pdd`）与商家后台是两套完全独立的登录态，
 *   拿 H5 的 Cookie 去 mms.pinduoduo.com 必然登录失败，降级只会把用户引向错的账号。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: PddPublishResult } {
  const candidates = store.listAccounts()
    .filter(a => a.status !== 'invalid')
    .filter(a => a.platform === PLATFORM)

  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到拼多多商家后台账号。请引导用户打开「账号连接」页面添加**拼多多商家后台**账号'
          + '（登录 mms.pinduoduo.com，可用拼多多 App 扫码或账号密码）；'
          + '注意它与「拼多多」（买家 H5）是两套独立登录态，买家账号不能用于发布商品。',
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
          `拼多多商家后台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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
function buildPreview(account: StoredAccount, opts: PddPublishOptions, images: string[]): string {
  const detailImages = opts.detailImages || []
  const skus = opts.skus || []
  /** 单买价一律按「拼单价 + 1」自动算（平台硬规则：单买价 ≥ 拼单价+1） */
  const singleOf = (p?: string): string => {
    const n = Number((p || '').trim())
    if (!p || !Number.isFinite(n) || n <= 0) return '（未填）'
    return String(Math.round((n + 1) * 100) / 100)
  }
  return [
    '【发布预览 · 需用户确认】',
    '渠道：拼多多（商家后台 mms.pinduoduo.com）',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `标题：${opts.title}`,
    `类目：${(opts.category || '').trim() ? `${(opts.category || '').trim()}（提示词；实际类目由平台按发布入口自动推荐）` : '平台按发布入口自动推荐'}`,
    `商品参考价：${(opts.price || '').trim() || '（未填，留待页面人工填写）'}`,
    `库存：${(opts.stock || '').trim() || '（未填，留待页面人工填写）'}`,
    `货号：${(opts.itemNo || '').trim() || '（未填）'}`,
    `主图（${images.length} 张）：`,
    ...images.map(p => `  - ${p}`),
    `详情图（${detailImages.length} 张）：${detailImages.length ? '' : '（未提供，跳过）'}`,
    ...detailImages.map(p => `  - ${p}`),
    `SKU 多规格（${skus.length} 个规格值）：`,
    ...skus.map(s =>
      `  - ${s.name}：拼单价 ${(s.price || '').trim() || '（未填）'}`
      + ` / 单买价 ${singleOf(s.price)}`
      + ` / 库存 ${(s.stock || '').trim() || (opts.stock || '').trim() || DEFAULT_STOCK}`
      + ` / 预览图 ${(s.image || '').trim() || '★ 未提供（平台必填，会被拦）'}`),
    '',
    '★ 本工具自动填「类目 / 主图 / 标题 / 商品参考价 / 库存 / 货号 / 商品详情图 / SKU 规格（含预览图与价格）」，',
    '  并尽力自动选「商品属性」（品牌除外）。',
    '  发货与售后设置、运费模板、商品资质等**不会**被自动填写，',
    '  需要在弹出的浏览器窗口内人工补全后提交（这与拼多多后台的必填项策略一致）。',
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正打开浏览器提交。',
    '注意：发布是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/**
 * 登录态判定：商家后台未登录时会跳到 mms.pinduoduo.com/login，
 * 或原地渲染扫码/账号密码登录入口。
 */
async function isLoggedOut(page: any): Promise<boolean> {
  try {
    const url = String(page.url() || '')
    if (/mms\.pinduoduo\.com\/login|passport\.pinduoduo\.com/i.test(url)) return true
    return await page.evaluate(() =>
      /扫码登录|账号密码登录|立即注册|登录后查看/.test((document.body?.innerText || '').slice(0, 1500)))
  } catch {
    return false
  }
}

/**
 * 风控判定：商家后台的**页内内联滑块**。
 *
 * 影刀实测的锚点：div#slide-captcha-dialog.captcha-wrapper.captcha-wrapper__slider
 * → div.slide-handlebar（innerText「请向右滑块完成拼图」），外加 #slide-button 拖动块。
 * 它不在 iframe 里，因此没有可透传的 verifyUrl。
 */
async function detectRisk(page: any): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const node = document.querySelector(
        '#slide-captcha-dialog, .captcha-wrapper__slider, .slide-handlebar, #slide-button, .slide-button-wrapper',
      )
      if (node) return true
      return /请向右滑块完成拼图|请按住滑块|拖动滑块|请完成安全验证/.test((document.body?.innerText || '').slice(0, 4000))
    }).catch(() => false) as boolean
  } catch {
    return false
  }
}

/** 等用户在可见窗口内把滑块拼完（滑块消失即视为通过） */
async function waitSliderCleared(page: any, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await sleep(2000)
    if (!(await detectRisk(page))) return true
  }
  return false
}

/** 在给定 scope 内找可用的文件上传控件 */
async function findFileInput(scope: any): Promise<any | null> {
  try {
    const handles = await scope.$$('input[type=file]')
    for (const h of handles) {
      const disabled = await h.evaluate((el: any) => !!el.disabled).catch(() => true)
      if (!disabled) return h
    }
    return null
  } catch {
    return null
  }
}

/** 页面等待/守卫的统一失败返回 */
type GuardFail = { ok: false; kind: 'risk_control' | 'token_expired' | 'timeout'; text: string }

/**
 * 页面守卫：每轮等待前先检查「页内内联滑块」与「登录失效」。
 * 命中滑块则在**已打开的可见窗口内**等用户拖完 —— 拼多多的滑块是页内内联的，
 * 无法像淘宝那样交给 dsagent_risk_verify 另开窗口处理。
 */
async function guardPage(page: any): Promise<{ ok: true } | GuardFail> {
  if (await detectRisk(page)) {
    console.log('[dsagent-pdd-publish] 命中内联滑块，等待用户在窗口内完成拼图...')
    if (!(await waitSliderCleared(page, SLIDER_WAIT_MS))) {
      return {
        ok: false,
        kind: 'risk_control',
        text: '拼多多后台弹出了「请向右滑块完成拼图」安全验证，等待 '
          + `${SLIDER_WAIT_MS / 1000}s 仍未通过。\n`
          + '请重试本工具，并在弹出的浏览器窗口内**手动拖动滑块完成拼图**；通过后本工具会自动继续。\n'
          + '（该滑块是页内内联的，无法由 dsagent_risk_verify 另开窗口处理。）',
      }
    }
    console.log('[dsagent-pdd-publish] 滑块已通过，继续流程。')
  }
  if (await isLoggedOut(page)) {
    return {
      ok: false,
      kind: 'token_expired',
      text: '拼多多商家后台登录态已失效（页面要求登录）。\n'
        + '请到「账号连接」页面重新登录**拼多多商家后台**账号（mms.pinduoduo.com）。\n'
        + '注意：这与「拼多多」（买家 H5）是两套独立登录态，重登买家账号无效。',
    }
  }
  return { ok: true }
}

/** 轮询等待某个条件成立，每轮先过 guardPage（滑块 / 登录失效优先中断） */
async function waitFor(
  page: any,
  probe: (p: any) => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<{ ok: true } | GuardFail> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const g = await guardPage(page)
    if (!g.ok) return g
    if (await probe(page).catch(() => false)) return { ok: true }
    await sleep(2000)
  }
  return {
    ok: false,
    kind: 'timeout',
    text: `等待「${label}」超过 ${Math.round(timeoutMs / 1000)}s 仍未出现。`,
  }
}

/** 把守卫失败统一转成工具返回（登录失效时顺带订正账号状态） */
async function guardFailResult(
  fail: GuardFail,
  store: CredentialStore,
  shopKey: string,
  finalUrl: string,
): Promise<PddPublishResult> {
  if (fail.kind === 'token_expired') {
    try { await store.setStatus(shopKey, 'expired') } catch { /* 忽略 */ }
  }
  return { ok: false, failureKind: fail.kind, shopKey, finalUrl, text: fail.text }
}

/** 跨标签页轮询等待 URL 匹配的页面（点「发布新商品」会新开标签页，不能只盯当前页） */
async function waitForPage(browser: any, re: RegExp, timeoutMs: number): Promise<any | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await browser.pages()
    const hit = pages.find((p: any) => re.test(String(p.url() || '')))
    if (hit) return hit
    await sleep(1000)
  }
  return null
}

/** 轮询等待按钮变为可点（图片/标题写入后底部按钮会由 disabled 转为可点） */
async function waitEnabled(page: any, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLButtonElement | null
      return !!el && !el.disabled && el.offsetParent !== null
    }, selector).catch(() => false) as boolean
    if (ok) return true
    await sleep(1500)
  }
  return false
}

/**
 * 段 1：在商品列表页点「发布新商品」。
 *
 * ★ 真机实测：列表页上文本恰为「发布新商品」的元素共 8 个 —— 其中 4 个在**左侧导航栏**
 *   （`nav/aside` 内），点了只会跳到 `?msfrom=mms_sidenav` 那个**没有上下文参数**的
 *   /goods/category 页，导致「下一步」永远走不到第二步表单。真正的入口是工具栏里那个
 *   `button.BTN_primary`（不在导航区内）。因此这里必须**先排除导航区**，再取最内层可点元素。
 */
async function clickPublishEntry(listPage: any): Promise<boolean> {
  return await listPage.evaluate(() => {
    const NAV_SEL = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const all = (Array.from(document.querySelectorAll('button, a, div, span')) as HTMLElement[])
      .filter(el => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        if ((el.innerText || '').trim() !== '发布新商品') return false
        return !el.closest(NAV_SEL)   // ★ 排除左侧导航栏里的同名项
      })
    if (!all.length) return false
    // 优先用真正的 button（工具栏按钮就是 BUTTON）；否则取最内层元素
    const innermost = all.filter(e => !all.some(o => o !== e && e.contains(o)))
    const el = innermost.find(e => e.tagName === 'BUTTON') || innermost[innermost.length - 1]
    if (!el) return false
    el.click()
    return true
  }).catch(() => false) as boolean
}

/**
 * 对**已打标记**的元素派发真实鼠标点击（取不到坐标时退回 DOM click 兜底）。
 *
 * ★ 为什么必须用 CDP 真实鼠标：真机实测 `element.click()` 派发的是 untrusted 事件，
 *   拼多多的 React 处理器会忽略它（「下一步」「添加规格类型」上都复现过）。
 */
async function realClickMarked(page: any, selector: string): Promise<boolean> {
  const h = await page.$(selector).catch(() => null)
  const rect = h ? await h.boundingBox().catch(() => null) : null
  if (rect) {
    const ok = await page.mouse
      .click(rect.x + rect.width / 2, rect.y + rect.height / 2)
      .then(() => true).catch(() => false)
    if (ok) return true
  }
  return await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return false
    el.click()
    return true
  }, selector).catch(() => false) as boolean
}

/**
 * 按文案找到最内层可点元素，打标记后用**真实鼠标**点它。
 * 用于没有稳定锚点、只能靠文案定位的按钮（如「添加规格类型」）。
 * 返回点中的元素描述；未命中返回 `''`。
 */
async function clickByTextReal(page: any, textReSrc: string): Promise<string> {
  const marked = await page.evaluate((src: string) => {
    const re = new RegExp(src)
    const vis = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const els = (Array.from(document.querySelectorAll('button,[role=button],a,span,div')) as HTMLElement[])
      .filter(el => {
        if (!vis(el)) return false
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
        return t.length > 0 && t.length <= 20 && re.test(t)
      })
    if (!els.length) return ''
    // 只取最内层（剔除「自身命中、但后代也命中」的容器），优先 BUTTON
    const inner = els.filter(e => !els.some(o => o !== e && e.contains(o)))
    const el = inner.find(e => e.tagName === 'BUTTON') || inner[inner.length - 1]
    document.querySelectorAll('[data-pdd-txt]').forEach(e => e.removeAttribute('data-pdd-txt'))
    el.setAttribute('data-pdd-txt', '1')
    el.scrollIntoView({ block: 'center' })
    return `${el.tagName} | ${(el.innerText || '').trim().slice(0, 40)}`
  }, textReSrc).catch(() => '')

  if (!marked) return ''
  await sleep(350)   // 等 scrollIntoView 落定后再取坐标
  const ok = await realClickMarked(page, '[data-pdd-txt="1"]')
  return ok ? marked : ''
}

/**
 * 段 2 收尾：点第一步底部的「下一步, 完善商品信息」。
 *
 * ★ 必须用 CDP 真实鼠标点击（`page.mouse.click` 坐标）：
 *   真机实测 `element.click()` 派发的是 untrusted 事件，拼多多的 React 处理器会忽略它
 *   （同类现象在「批量设置」上也复现过）。这里先打标记 + 滚到视口中央取坐标，
 *   再派发真实鼠标点击；取不到坐标时退回 `element.click()` 兜底。
 */
async function clickNextStep(page: any): Promise<boolean> {
  const box = await page.evaluate(() => {
    const primary = document.querySelector('button#bottomSubmitBtnId') as HTMLButtonElement | null
    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const hit = (primary && !primary.disabled && primary.offsetParent !== null)
      ? primary
      : btns.find(b => /^下一步/.test((b.innerText || '').trim()) && !b.disabled && b.offsetParent !== null)
    if (!hit) return null
    document.querySelectorAll('[data-pdd-next]').forEach(e => e.removeAttribute('data-pdd-next'))
    hit.setAttribute('data-pdd-next', '1')
    hit.scrollIntoView({ block: 'center' })
    return 'marked'
  }).catch(() => null)

  if (box) {
    // 滚动后坐标需要重新取（scrollIntoView 有动画）
    await sleep(350)
    if (await realClickMarked(page, '[data-pdd-next="1"]')) return true
  }

  // 兜底：untrusted 点击（部分浏览器/页面状态仍会生效）
  return await page.evaluate(() => {
    const el = document.querySelector('[data-pdd-next="1"]') as HTMLButtonElement | null
    if (!el) return false
    el.click()
    return true
  }).catch(() => false) as boolean
}

/**
 * 点掉第一步「下一步」后弹出的**真实性承诺**确认弹窗。
 *
 * ★ 真机实测（dev/probe-pdd-step2.mjs 的 acceptPromiseModal）：弹窗文案含
 *   「检验检测报告/检验鉴定证书真实性承诺」，必须先勾选「我已阅读并同意」（自绘复选框），
 *   再点「同意」，否则页面停在原地（底部按钮看着可点，其实被浮层盖住）。
 * ★ 但它**并非每次出现**，所以本函数「找到就处理、找不到就静默返回 false」，主流程不得依赖它。
 */
async function dismissPromiseModal(page: any): Promise<boolean> {
  const marked = await page.evaluate(() => {
    const vis = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return r.width > 60 && r.height > 40
    }
    const MODAL_SEL = '[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],'
      + '[class*="popup"],[class*="Popup"],[class*="confirm"],[class*="Confirm"],[role=dialog]'
    const modals = (Array.from(document.querySelectorAll(MODAL_SEL)) as HTMLElement[]).filter(vis)
    for (const m of modals) {
      const t = (m.innerText || '').replace(/\s+/g, ' ')
      if (!/真实性承诺|检验检测报告|检验鉴定证书|承诺/.test(t)) continue

      // ① 勾选「我已阅读并同意」（拼多多是自绘复选框，得顺着文案往上找 [class*=heckbox] 祖先）
      document.querySelectorAll('[data-pdd-agree]').forEach(e => e.removeAttribute('data-pdd-agree'))
      const line = (Array.from(m.querySelectorAll('div,label,span')) as HTMLElement[])
        .find(el => /我已阅读并同意/.test(el.innerText || '') && (el.innerText || '').length <= 80)
      const wrap = line?.closest('[class*="heckbox"], [class*="Checkbox"], [class*="CK_"]')
        || line?.parentElement
        || m.querySelector('input[type=checkbox]')
      const box = wrap as HTMLElement | null
      if (box) box.setAttribute('data-pdd-agree', '1')

      // ② 主按钮（「同意」优先，其次通用确认文案）
      const btns = (Array.from(m.querySelectorAll('button,[role=button],a')) as HTMLElement[]).filter(vis)
      const btn = btns.find(b => /^同\s*意$/.test((b.innerText || '').trim()))
        || btns.find(b => /^(确认|确定|我承诺|我知道了|已阅读并同意)$/.test((b.innerText || '').trim()))
      if (btn) btn.setAttribute('data-pdd-promise', '1')

      return { hasCheck: !!box, hasBtn: !!btn, text: t.slice(0, 120) }
    }
    return null
  }).catch(() => null) as { hasCheck: boolean; hasBtn: boolean; text: string } | null

  if (!marked) return false

  if (marked.hasCheck) {
    await realClickMarked(page, '[data-pdd-agree="1"]')
    await sleep(800)
    const checked = await page.evaluate(() => {
      const el = document.querySelector('[data-pdd-agree="1"]')
      const inp = el && (el.tagName === 'INPUT' ? el : el.querySelector('input[type=checkbox]'))
      return inp ? !!(inp as HTMLInputElement).checked : null
    }).catch(() => null)
    // 真实鼠标没勾上时，退回 DOM click（真机实测有出现）
    if (checked === false) {
      await page.evaluate(() => {
        const el = document.querySelector('[data-pdd-agree="1"]')
        const inp = el && (el.tagName === 'INPUT' ? el : el.querySelector('input[type=checkbox]'))
        ;((inp || el) as HTMLElement | null)?.click()
      }).catch(() => { /* 忽略 */ })
      await sleep(600)
    }
  }

  if (!marked.hasBtn) return false
  await sleep(400)
  const ok = await realClickMarked(page, '[data-pdd-promise="1"]')
  await sleep(1200)
  console.log(`[dsagent-pdd-publish] 承诺弹窗已处理：${marked.text}`)
  return ok
}

/**
 * 上传主图。
 *
 * 拼多多发布页**没有 iframe**，主图 file input 就在主文档里、且是**可见**的，
 * 直接用真机实测锚点拿句柄 uploadFile 即可（不需要先点「本地上传」开弹窗）。
 * 锚点落空时兜底取页面上首个可用的 input[type=file]。
 */
async function uploadImages(
  page: any,
  images: string[],
  preferredSelector: string,
  scopeLabel: string,
): Promise<{ ok: boolean; note: string }> {
  let input: any = await page.$(preferredSelector).catch(() => null)
  let label = scopeLabel

  if (!input) {
    input = await findFileInput(page)
    if (input) label = `${scopeLabel}（兜底：页面首个可用 file input）`
  }

  if (!input) {
    return {
      ok: false,
      note: `未找到主图上传控件（${preferredSelector}）。请在浏览器窗口内人工上传主图。`,
    }
  }

  console.log(`[dsagent-pdd-publish] 在「${label}」上传 ${images.length} 张主图`)
  await input.uploadFile(...images)

  // ★ 真机实测：图片上传完成后，主图区会显示计数「(N/10)」。
  //   必须以「计数达到目标张数」为完成信号 —— 只等固定秒数就点「下一步」，
  //   图片尚未登记完成时会被平台校验拦下，页面停在第一步不跳转。
  //   ★ 计数长时间停在 (0/10)：多半是 file input 句柄在页面重渲染后失效
  //     （React 换掉了节点，往脱离文档的节点塞文件毫无效果），
  //     所以**重新取一次句柄再传一遍**，比干等 90s 有用得多。
  const deadline = Date.now() + UPLOAD_WAIT_MS
  const startedAt = Date.now()
  let counted = -1
  let failed = false
  let retried = false
  while (Date.now() < deadline) {
    await sleep(2000)
    const st = await page.evaluate(() => {
      const txt = document.body?.innerText || ''
      const m = txt.match(/\(\s*(\d+)\s*\/\s*10\s*\)/)
      return {
        count: m ? Number(m[1]) : -1,
        fail: /上传失败|图片格式不正确|文件过大|超过大小限制|不支持的文件/.test(txt),
      }
    }).catch(() => ({ count: -1, fail: false })) as { count: number; fail: boolean }
    if (st.fail) { failed = true; break }
    if (st.count >= 0) counted = st.count
    if (counted >= images.length) break
    // 页面上始终没有计数（形态变更）时，给 15s 宽限后按「大概率已传完」继续
    if (counted < 0 && Date.now() - startedAt > 15_000) break
    // 计数明确为 0：重取句柄重传一次
    if (counted === 0 && !retried && Date.now() - startedAt > 12_000) {
      retried = true
      console.log(`[dsagent-pdd-publish] 「${label}」计数仍是 (0/10)，重新获取上传控件并重传一次`)
      const again = (await page.$(preferredSelector).catch(() => null)) || (await findFileInput(page))
      if (again) await again.uploadFile(...images).catch(() => { /* 忽略：仍以下面的计数判定为准 */ })
    }
  }

  if (failed) {
    return { ok: false, note: '图片上传被页面判为失败（格式或大小不符）。请在浏览器窗口内人工处理主图。' }
  }
  if (counted >= 0 && counted < images.length) {
    return {
      ok: false,
      note: `主图仅上传成功 ${counted}/${images.length} 张（等待 ${UPLOAD_WAIT_MS / 1000}s 超时）。`
        + '请在浏览器窗口内人工补齐主图后重试。',
    }
  }

  return { ok: true, note: `已通过「${label}」上传 ${counted >= 0 ? counted : images.length} 张主图` }
}

/**
 * 上传「商品详情」图片。
 *
 * ★ 真机实测锚点：`input[data-tracking-click-viewid="detail_img_localfile_upload"]`
 *   —— 与主图同款**离屏隐藏 input**，直接 `uploadFile` 投递即可（不需要点「本地上传」开弹窗）。
 * ★ 投递前先点掉引导气泡「热区图片组件上线了」（会遮挡且可能误触），点不到就跳过。
 * ★ 完成信号 = 页面出现「已上传 N/M张」计数。
 */
async function uploadDetailImages(page: any, files: string[]): Promise<{ ok: boolean; note: string }> {
  if (!files.length) return { ok: true, note: '（未提供详情图，跳过）' }

  // 引导气泡只出现一次，点掉即可；找不到属正常情况
  const bubble = await clickByTextReal(page, '^\\s*知道了\\s*$')
  if (bubble) {
    console.log(`[dsagent-pdd-publish] 已点掉详情区引导气泡：${bubble}`)
    await sleep(800)
  }

  const input = await page.$(STEP2_DETAIL_INPUT).catch(() => null)
  if (!input) {
    return {
      ok: false,
      note: `未找到详情图上传控件（${STEP2_DETAIL_INPUT}）。请在浏览器窗口内人工上传详情图。`,
    }
  }

  console.log(`[dsagent-pdd-publish] 详情图区上传 ${files.length} 张`)
  await input.uploadFile(...files)

  // 回读「已上传 N/M张」计数（M 通常是 50）
  const deadline = Date.now() + UPLOAD_WAIT_MS
  let counted = -1
  let failed = false
  while (Date.now() < deadline) {
    await sleep(2000)
    const st = await page.evaluate(() => {
      const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const m = txt.match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
      return {
        count: m ? Number(m[1]) : -1,
        fail: /图片格式不正确|文件过大|超过大小限制|不支持的文件/.test(txt),
      }
    }).catch(() => ({ count: -1, fail: false })) as { count: number; fail: boolean }
    if (st.fail) { failed = true; break }
    if (st.count >= 0) counted = st.count
    if (counted >= files.length) break
  }

  if (failed) {
    return { ok: false, note: '详情图上传被页面判为失败（格式或大小不符）。请在浏览器窗口内人工处理。' }
  }
  if (counted >= 0 && counted < files.length) {
    return {
      ok: false,
      note: `详情图仅上传成功 ${counted}/${files.length} 张（等待 ${UPLOAD_WAIT_MS / 1000}s 超时）。`
        + '请在浏览器窗口内人工补齐后重试。',
    }
  }
  return { ok: true, note: `已上传 ${counted >= 0 ? counted : files.length} 张详情图` }
}

/**
 * 填「规格与库存」区的多规格 SKU（规格类型 → 逐个规格值 → 每行预览图）。
 *
 * ★ 落码依据（真机实测 dev/probe-pdd-step2.mjs + dev/.ui-shots/probe-run10.log / probe-sku-img-uploaded.png）：
 *   1. 点「添加规格类型(1/2)」**不是弹窗**，而是内联出一行：
 *      `[规格类型 1 下拉] [☐ 添加图片]  删除规格类型`。
 *   2. 规格类型候选 32 项，**首项是噪声**「官方 客服 1」→ 必须按文案精确选「颜色」（SKU_SPEC_TYPE），
 *      兜底也不能取第 1 项。
 *   3. 「请输入规格名称」placeholder 会被已提交的 chip 复用 → 新值输入框 =
 *      `.goods-spec` 内**可见的、最后一个**该 placeholder 的 input。
 *   4. ★★ 规格值的**唯一提交动作是失焦（blur，真实鼠标点空白处）** —— 只按 Enter 不提交（第 6 轮已证；
 *      第 10 轮进一步确认「Enter 非必需」）。提交成功的判据 = 该规格值以 chip 形式出现在规格区
 *      （SKU 表头同时出现「颜色」列，表格随提交整体重构）。
 *   5. ★★ SKU 预览图**不用开「图片空间」弹窗**：每行「*预览图」单元格里本就藏着一个**离屏**
 *      `input[type=file]`（真机 rect x/y = -999），直接 `uploadFile` 投递即可。
 *      ★ 必须**逐行当场重新定位** —— 上传后该行会整体重渲染，先批量打标记会全部失效。
 *   6. 「*预览图」列只有在勾了「添加图片」这个**自绘复选框**后才出现 → 有图时必须先勾。
 *
 * 失败不抛出：未完成项写进 missed，交由主流程汇总（浏览器保持打开，用户可人工补全）。
 * 每个规格值最多重试 3 次，预览图最多重试 2 次（避免无限空转）。
 */
async function fillSkuSpec(
  page: any,
  skus: PddSkuInput[],
): Promise<{ filled: string[]; missed: string[] }> {
  const filled: string[] = []
  const missed: string[] = []
  if (!skus.length) return { filled, missed }

  // ── ① 添加规格类型（内联出行，非弹窗）──────────────────────
  const added = await clickByTextReal(page, '^\\s*添加规格类型')
  if (!added) return { filled: [], missed: ['SKU 规格（未找到「添加规格类型」入口）'] }
  await sleep(3000)

  // ── ② 打开「规格类型」下拉并选「颜色」──────────────────────
  const trigger = await page.evaluate(() => {
    const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const box = document.querySelector('.goods-spec') as HTMLElement | null
    if (!box) return ''
    document.querySelectorAll('[data-pdd-specpick]').forEach(e => e.removeAttribute('data-pdd-specpick'))
    const cands = (Array.from(box.querySelectorAll(
      '[class*="ST_selectValueSingle"],input[placeholder*="规格类型"],[class*="select"]',
    )) as HTMLElement[]).filter(vis)
    const el = cands[0]
    if (!el) return ''
    el.setAttribute('data-pdd-specpick', '1')
    el.scrollIntoView({ block: 'center' })
    return `${el.tagName}.${String(el.className || '').slice(0, 50)}`
  }).catch(() => '') as string
  if (!trigger) return { filled, missed: ['SKU 规格（未找到「规格类型」下拉，请人工选择）'] }
  await sleep(350)
  await realClickMarked(page, '[data-pdd-specpick="1"]')
  await sleep(1800)

  const opts = await page.evaluate(() => {
    const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    document.querySelectorAll('[data-pdd-specopt]').forEach(e => e.removeAttribute('data-pdd-specopt'))
    const els = (Array.from(document.querySelectorAll(
      '[class*="option"],[class*="Option"],[role=option],[class*="dropdown"] li,li[class*="item"],[class*="menuItem"]',
    )) as HTMLElement[]).filter(vis)
    const out: string[] = []
    for (const e of els) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 20) continue
      e.setAttribute('data-pdd-specopt', String(out.length))
      out.push(t)
    }
    return out.slice(0, 60)
  }).catch(() => [] as string[]) as string[]

  if (!opts.length) return { filled, missed: ['SKU 规格（规格类型下拉无候选项，请人工选择）'] }
  const hit = opts.findIndex(t => t.includes(SKU_SPEC_TYPE))
  // ★ 候选首项是噪声（「官方 客服 1」），兜底一律取第 2 项而不是第 1 项
  const optIdx = hit >= 0 ? hit : (opts.length > 1 ? 1 : 0)
  await realClickMarked(page, `[data-pdd-specopt="${optIdx}"]`)
  console.log(`[dsagent-pdd-publish] SKU 规格类型已选：${opts[optIdx]}（候选 ${opts.length} 项）`)
  await sleep(2500)

  const wantImg = skus.some(s => String(s.image || '').trim())

  // ── ③ 勾「添加图片」（自绘复选框；不勾就没有「*预览图」列）────
  if (wantImg) {
    const flag = await page.evaluate(() => {
      const box = document.querySelector('.goods-spec')
      if (!box) return ''
      document.querySelectorAll('[data-pdd-imgflag]').forEach(e => e.removeAttribute('data-pdd-imgflag'))
      const span = (Array.from(box.querySelectorAll('*')) as HTMLElement[])
        .find(el => /^\s*添加图片\s*$/.test((el.innerText || '').trim()))
      if (!span) return ''
      let t: HTMLElement | null = span
      for (let i = 0; i < 6 && t; i++) {
        if (/heckbox|Checkbox|CK_/i.test(String(t.className || ''))) break
        t = t.parentElement
      }
      if (!t || t === document.body) t = span.parentElement || span
      t.setAttribute('data-pdd-imgflag', '1')
      return `${t.tagName}.${String(t.className || '').slice(0, 60)}`
    }).catch(() => '') as string
    if (flag) {
      await realClickMarked(page, '[data-pdd-imgflag="1"]')
      await sleep(2000)
      console.log(`[dsagent-pdd-publish] 已勾选「添加图片」：${flag}`)
    } else {
      missed.push('SKU 预览图（未找到「添加图片」勾选项）')
    }
  }

  /** 读规格区状态：规格区可见文案（含已提交 chip 名）+ SKU 表头 + SKU 行数 */
  const specState = (): Promise<{ boxText: string; thead: string[]; rows: number } | null> =>
    page.evaluate(() => {
      const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const box = document.querySelector('.goods-spec') as HTMLElement | null
      const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
        .find(t => vis(t) && /拼单价/.test((t as HTMLElement).innerText || ''))
      return {
        // ★ 仅用于日志排查：已提交的规格值 chip 名**不会**出现在 innerText 里，故不能作为提交判据
        boxText: (box?.innerText || '').replace(/\s+/g, ' '),
        thead: tb
          ? (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[]).map(t => (t.innerText || '').replace(/\s+/g, ''))
          : [],
        rows: tb ? tb.querySelectorAll('tbody tr').length : 0,
      }
    }).catch(() => null)

  /** 定位并聚焦「新值输入框」（可见的最后一个「请输入规格名称」input） */
  const focusAddInput = async (): Promise<boolean> => {
    const ok = await page.evaluate(() => {
      const box = document.querySelector('.goods-spec')
      if (!box) return false
      document.querySelectorAll('[data-pdd-addinput]').forEach(e => e.removeAttribute('data-pdd-addinput'))
      const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const inps = (Array.from(box.querySelectorAll('input')) as HTMLInputElement[])
        .filter(i => /规格名称/.test(i.placeholder || '') && vis(i))
      const last = inps[inps.length - 1]
      if (!last) return false
      last.setAttribute('data-pdd-addinput', '1')
      return true
    }).catch(() => false) as boolean
    if (!ok) return false
    const h = await page.$('[data-pdd-addinput="1"]').catch(() => null)
    if (!h) return false
    // select() 让重试时的键入**覆盖**残留值（禁用 Control+A：真机实测会残留原值）
    await h.evaluate((el: any) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select?.() })
      .catch(() => { /* 忽略 */ })
    await sleep(250)
    return true
  }

  /** 真实鼠标点「2 规格与库存 / 商品规格」标题附近空白处 → 规格值输入框失焦（= 提交动作） */
  const blurNeutral = async (): Promise<boolean> => {
    const pt = await page.evaluate(() => {
      const el = (Array.from(document.querySelectorAll('div,span,h1,h2,h3')) as HTMLElement[])
        .find(e => /^\s*(2\s*规格与库存|商品规格)\s*$/.test((e.innerText || '').trim()))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + r.height / 2) }
    }).catch(() => null) as { x: number; y: number } | null
    if (!pt) return false
    await page.mouse.click(pt.x, pt.y).catch(() => { /* 忽略 */ })
    await sleep(1000)
    return true
  }

  // ── ④ 逐个规格值：type → blur 提交（每值最多 3 次）──────────
  const valueDone: string[] = []
  for (let i = 0; i < skus.length; i++) {
    const v = String(skus[i].name || '').trim()
    if (!v) { missed.push(`SKU 第${i + 1}项（规格值为空）`); continue }
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (!(await focusAddInput())) { await sleep(1200); continue }
      await page.keyboard.type(v, { delay: 70 }).catch(() => { /* 忽略 */ })
      await sleep(400)
      await blurNeutral()
      const st = await specState()
      // ★ 真机实测：已提交的规格值 chip 名**不会**出现在 .goods-spec 的 innerText 里（原判据会误报）。
      //   可靠信号 = SKU 表头随提交重构出现「颜色」列，且 tbody 行数达到已提交规格值个数。
      ok = !!st && st.thead.some(h => /颜色/.test(h)) && st.rows >= i + 1
      if (!ok) {
        console.log(`[dsagent-pdd-publish] SKU 规格值「${v}」第 ${attempt + 1} 次未提交成功`
          + `（规格区文案=${st?.boxText?.slice(0, 80) || ''}；表头=${JSON.stringify(st?.thead || [])}）`)
      }
    }
    if (ok) valueDone.push(v)
    else missed.push(`SKU 规格值「${v}」（3 次未提交成功，请人工补填）`)
  }
  if (valueDone.length) filled.push(`SKU 规格值=${valueDone.join('/')}`)

  // ── ⑤ 逐行投递「*预览图」（各行离屏 file input；必须当场重新定位）──
  if (wantImg) {
    for (let i = 0; i < skus.length; i++) {
      const v = String(skus[i].name || '').trim()
      const file = String(skus[i].image || '').trim()
      if (!file) { missed.push(`SKU 预览图「${v}」（未提供图片路径）`); continue }
      let ok = false
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        const marked = await page.evaluate((ri: number) => {
          const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
          const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
            .find(t => vis(t) && /预览图/.test((t as HTMLElement).innerText || ''))
          if (!tb) return false
          const heads = (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[])
            .map(t => (t.innerText || '').replace(/\s+/g, ''))
          const col = heads.findIndex(h => /预览图/.test(h))
          if (col < 0) return false
          const inp = tb.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[col]
            ?.querySelector('input[type=file]') as HTMLInputElement | null
          if (!inp) return false
          document.querySelectorAll('[data-pdd-skuimg]').forEach(e => e.removeAttribute('data-pdd-skuimg'))
          inp.setAttribute('data-pdd-skuimg', '1')
          return true
        }, i).catch(() => false) as boolean
        if (!marked) break
        const h = await page.$('[data-pdd-skuimg="1"]').catch(() => null)
        if (!h) break
        await h.uploadFile(file).catch(() => { /* 忽略 */ })
        await sleep(2500)
        // ★ 缩略图是 CSS background-image（不是 <img>），回读必须同时抓 backgroundImage，
        //   只查 <img> 会把已上传的图误判为失败（第 10 轮实测误报）。
        ok = await page.evaluate((ri: number) => {
          const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
          const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
            .find(t => vis(t) && /预览图/.test((t as HTMLElement).innerText || ''))
          if (!tb) return false
          const heads = (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[])
            .map(t => (t.innerText || '').replace(/\s+/g, ''))
          const col = heads.findIndex(h => /预览图/.test(h))
          const td = tb.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[col]
          if (!td) return false
          if (td.querySelector('img')) return true
          return (Array.from(td.querySelectorAll('*')) as HTMLElement[])
            .some(e => /url\(/.test(getComputedStyle(e).backgroundImage || ''))
        }, i).catch(() => false) as boolean
      }
      if (ok) filled.push(`SKU 预览图「${v}」`)
      else missed.push(`SKU 预览图「${v}」（上传未确认成功，请人工核对）`)
    }
  }

  console.log(`[dsagent-pdd-publish] SKU 规格处理完成：已填 ${filled.join('、') || '（无）'}；`
    + `未完成 ${missed.join('、') || '（无）'}`)
  return { filled, missed }
}

/**
 * 按关键词定位并填入输入框（input 或 textarea）。
 *
 * 两轮匹配：先只看直接属性（placeholder / name / aria-label），命中不了再看祖先链文本。
 * 祖先链只取 4 层且截断，避免「整个页面 innerText」把所有框都命中。
 * 写入用原生 setter + input/change/blur 事件，React 受控组件才能接收。
 */
async function fillField(page: any, keywords: RegExp, value: string): Promise<string | null> {
  return await page.evaluate((kwSrc: string, kwFlags: string, v: string) => {
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
    let hit = visible.find(el => re.test(direct(el)))
    if (!hit) hit = visible.find(el => re.test(chain(el)))
    if (!hit) return null
    const proto = hit instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(hit, v); else hit.value = v
    hit.dispatchEvent(new Event('input', { bubbles: true }))
    hit.dispatchEvent(new Event('change', { bubbles: true }))
    hit.dispatchEvent(new Event('blur', { bubbles: true }))
    return (hit.placeholder || hit.name || 'input')
  }, keywords.source, keywords.flags, value).catch(() => null) as string | null
}

/**
 * 填商品标题。
 *
 * 真机实测锚点（两步式各有一个标题框）：
 *   · 第一步（类目页）：#goods_name 内 input[data-testid="beast-core-input-htmlInput"]
 *   · 第二步（表单页）：input[data-tracking-click-viewid="title_input_area"]
 * 两者 placeholder 都是「商品标题组成：商品描述+规格，最多输入30个汉字（60个字符）」。
 * 页面上的输入框极多（属性、SKU、价格…），先用锚点精确命中，落空再退回通用关键词匹配。
 */
async function fillTitle(page: any, value: string): Promise<boolean> {
  const hit = await page.evaluate((v: string) => {
    const scoped = document.querySelector(
      '#goods_name input[data-testid="beast-core-input-htmlInput"], '
      + 'input[data-tracking-click-viewid="title_input_area"]',
    ) as HTMLInputElement | null
    const byPlaceholder = Array.from(document.querySelectorAll('input')).find(i =>
      /商品标题组成|最多输入30个汉字/.test((i as HTMLInputElement).placeholder || '')) as HTMLInputElement | undefined
    const el = scoped || byPlaceholder
    if (!el || el.disabled || el.readOnly || el.offsetParent === null) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, value).catch(() => false) as boolean
  if (hit) return true
  return !!(await fillField(page, /商品标题|请输入标题|标题/, value))
}

/**
 * 填「价格及库存」SKU 表格。
 *
 * ★ 为什么不能复用 fillField：该表 5 个输入框的 placeholder **全是「请输入」**，
 *   name / aria-label 也为空，按关键词匹配必然全部落空（真机实测）。
 *
 * 真机实测 DOM（第二步表单页）：
 *   div.goods-sku-row#sku > div[data-e2e-id="e2e-sku-table"] > table
 *     thead th 依次为：库存 / 拼单价(元) / 单买价(元) / 规格编码 / 商品编码 / 状态
 *     tbody tr 的 td 与表头**列序一一对应**，每格内含一个 input
 * 因此改为「读表头 → 建列序映射 → 按列索引写入」，与 placeholder 无关。
 *
 * 注：拼单价 / 单买价 / 库存 是提交硬性必填；规格编码 / 商品编码为选填。
 *
 * ★ 必须用「真实键盘输入」而不是直接 set value（真机实测教训）：
 *   早先的实现是 `nativeSetter.call(el, v)` + dispatch input/change/blur，
 *   DOM 上看着值已写入、日志也报「已填」，但 React 内部 state 仍是空 ——
 *   提交时平台报「拼单价必须大于0」，商品卡在第二步上不了架。
 *   改为 click → 全选 → Backspace → type → Tab（都由 CDP 派发真实事件，
 *   走浏览器输入管线），React 的 onChange/onBlur 才会正常触发。
 */
async function fillPriceTable(
  page: any,
  vals: {
    price?: string
    stock?: string
    itemNo?: string
    /** 逐行覆盖值（多 SKU 时每个规格值一个价格/库存）；下标与 SKU 行号对应，缺项回落到顶层值 */
    rows?: { price?: string; stock?: string }[]
  },
): Promise<{ filled: string[]; missed: string[] }> {
  const price = (vals.price || '').trim()
  const stock = (vals.stock || '').trim()
  const itemNo = (vals.itemNo || '').trim()
  const rowOverrides = vals.rows || []

  // ★ 平台硬规则（真机实测拦因「单买价至少比拼单价高1元」）：
  //   单买价必须 ≥ 拼单价 + 1。此前两列同值，提交必被拦在第二步。
  const singleOf = (p: string): string => {
    const n = Number(p)
    if (!p || !Number.isFinite(n) || n <= 0) return p
    return String(Math.round((n + 1) * 100) / 100)
  }

  /** 定位 SKU 表（表头文字含「拼单价」）+ 读表头列名 + SKU 行数 */
  const readTable = (): Promise<{ heads: string[]; rows: number } | null> =>
    page.evaluate(() => {
      const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
        .find(t => vis(t) && /拼单价/.test((t as HTMLElement).innerText || ''))
      if (!tb) return null
      const heads = (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[])
        .map(th => (th.innerText || '').replace(/\s+/g, ''))
      return { heads, rows: tb.querySelectorAll('tbody tr').length }
    }).catch(() => null)

  /**
   * 单格填写：**每格当场按表头 regex 重新定位**，再滚到视口中央、JS `focus()`、逐键键入。
   *
   * ★★ 关键教训（真机第 6 轮实测）：**不能先批量给所有格子打标记再逐格填** ——
   *   填完第一格后表格会因 React 重渲染整体换掉节点，后面几格上的标记全部失效
   *   （该轮只写进了库存，拼单价/单买价全空）。故改为逐格即时定位。
   * ★ 清空不能用 Control+A：真机实测残留原值（`0` 被写成 `01000`）→ 用 `select()` + Backspace。
   */
  const fillCell = async (ri: number, headReSrc: string, val: string): Promise<string | null> => {
    const ci = await page.evaluate((ri: number, src: string) => {
      const re = new RegExp(src)
      const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      document.querySelectorAll('[data-pdd-fill]').forEach(e => e.removeAttribute('data-pdd-fill'))
      const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
        .find(t => vis(t) && /拼单价/.test((t as HTMLElement).innerText || ''))
      if (!tb) return -1
      const heads = (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[])
        .map(th => (th.innerText || '').replace(/\s+/g, ''))
      const col = heads.findIndex(h => re.test(h))
      if (col < 0) return -1
      const inp = tb.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[col]
        ?.querySelector('input:not([type=file])') as HTMLInputElement | null
      if (!inp || inp.disabled || inp.readOnly) return -1
      inp.setAttribute('data-pdd-fill', '1')
      inp.scrollIntoView({ block: 'center' })
      return col
    }, ri, headReSrc).catch(() => -1)
    if (ci < 0) return null

    await sleep(400)   // 等 scrollIntoView 落定
    const h = await page.$('[data-pdd-fill="1"]').catch(() => null)
    if (!h) return null
    await h.evaluate((el: any) => { el.focus(); el.select?.() }).catch(() => { /* 忽略 */ })
    await sleep(150)
    await page.keyboard.press('Backspace').catch(() => { /* 忽略 */ })
    await sleep(120)
    await h.type(val, { delay: 50 }).catch(() => { /* 忽略 */ })
    await sleep(250)
    const got = await h.evaluate((el: any) => String(el.value ?? '')).catch(() => null)
    await page.keyboard.press('Tab').catch(() => { /* 忽略 */ })
    await sleep(300)
    return got
  }

  /** 回读某格当前值（同样当场按表头重新定位，避免读到被 React 换掉的旧节点） */
  const readCell = (ri: number, headReSrc: string): Promise<string | null> =>
    page.evaluate((ri: number, src: string) => {
      const re = new RegExp(src)
      const vis = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const tb = (Array.from(document.querySelectorAll('table')) as HTMLTableElement[])
        .find(t => vis(t) && /拼单价/.test((t as HTMLElement).innerText || ''))
      if (!tb) return null
      const heads = (Array.from(tb.querySelectorAll('thead th')) as HTMLElement[])
        .map(th => (th.innerText || '').replace(/\s+/g, ''))
      const ci = heads.findIndex(h => re.test(h))
      if (ci < 0) return null
      const inp = tb.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[ci]
        ?.querySelector('input:not([type=file])') as HTMLInputElement | null
      return inp ? String(inp.value ?? '') : null
    }, ri, headReSrc).catch(() => null)

  const info = await readTable()
  if (!info) return { filled: [], missed: ['价格及库存表（未定位到表头含「拼单价」的表）'] }

  const sameValue = (a: string, b: string): boolean => {
    const na = Number(a)
    const nb = Number(b)
    if (a && b && Number.isFinite(na) && Number.isFinite(nb)) return na === nb
    return a.trim() === b.trim()
  }

  const rowCount = Math.max(1, info.rows)

  /** 第 ri 行要填的任务（多 SKU 时按行覆盖；库存/拼单价/单买价，单买价 = 该行拼单价 + 1） */
  const jobsFor = (ri: number): { key: string; re: string; val: string }[] => {
    const o = rowOverrides[ri] || {}
    // ★ 逐行覆盖值可能是空串（调用方只填了价格没填库存），必须用 || 回落，
    //   写成 `o.price ?? price` 会把空串当有效值 → 该行整列被跳过。
    const p = (o.price ?? '').trim() || price
    const s = (o.stock ?? '').trim() || stock
    const list: { key: string; re: string; val: string }[] = []
    if (s) list.push({ key: 'stock', re: '库存', val: s })
    if (p) {
      list.push({ key: 'group', re: '拼单价', val: p })
      list.push({ key: 'single', re: '单买价', val: singleOf(p) })
    }
    if (itemNo) {
      list.push({ key: 'spec', re: '规格编码', val: itemNo })
      list.push({ key: 'goods', re: '商品编码', val: itemNo })
    }
    return list
  }

  const done = new Set<string>()
  const tableDeadline = Date.now() + 90_000   // 整表总预算，防止个别格子把流程拖成分钟级黑洞
  const allDone = () => {
    for (let ri = 0; ri < rowCount; ri++) {
      for (const j of jobsFor(ri)) if (!done.has(`${j.key}:${ri}`)) return false
    }
    return true
  }
  for (let pass = 0; pass < 3 && !allDone() && Date.now() < tableDeadline; pass++) {
    for (let ri = 0; ri < rowCount; ri++) {
      for (const j of jobsFor(ri)) {
        const key = `${j.key}:${ri}`
        if (done.has(key) || Date.now() > tableDeadline) continue
        if (!info.heads.some(h => new RegExp(j.re).test(h))) continue   // 页面上没有该列
        const got = await fillCell(ri, j.re, j.val)
        if (got === null) continue
        const back = await readCell(ri, j.re)
        if (back !== null && sameValue(back, j.val)) done.add(key)
      }
    }
  }

  // 汇总：多行（多 SKU）时逐行报，单行时不加「第 N 行」前缀以保持原有文案
  const filled: string[] = []
  const missed: string[] = []
  const rowTag = (ri: number) => (rowCount > 1 ? `第${ri + 1}行` : '')
  for (let ri = 0; ri < rowCount; ri++) {
    const o = rowOverrides[ri] || {}
    const p = (o.price ?? '').trim() || price
    const s = (o.stock ?? '').trim() || stock
    const tag = rowTag(ri)
    if (s) {
      if (done.has(`stock:${ri}`)) filled.push(`${tag}库存=${s}`)
      else missed.push(`${tag}库存`)
    }
    if (p) {
      const hit: string[] = []
      if (done.has(`group:${ri}`)) hit.push(`拼单价=${p}`)
      if (done.has(`single:${ri}`)) hit.push(`单买价=${singleOf(p)}`)
      if (hit.length) filled.push(`${tag}${hit.join('、')}`)
      else missed.push(`${tag}拼单价/单买价`)
    }
    if (itemNo) {
      if (done.has(`spec:${ri}`) || done.has(`goods:${ri}`)) filled.push(`${tag}规格/商品编码=${itemNo}`)
      else missed.push(`${tag}规格/商品编码`)
    }
  }
  return { filled, missed }
}

/**
 * 商品属性区的一项（真机实测 DOM 结构）：
 *   div.goods-propertys
 *     └ div.property-item
 *         └ div.property-list#property-list-<n>
 *             └ div[data-testid="beast-core-form-item"][id="basic.propertys.<n>.value"]
 *                 ├ label.Form_itemLabelContent_5-188-0   ← 属性名（可能带「重要」标签）
 *                 └ div[data-testid="beast-core-select"]
 *                     └ input[data-testid="beast-core-select-htmlInput"]
 *                         placeholder=「请选择」（纯下拉）/「请输入品牌名称搜索」（搜索下拉）
 * 注意：商品资质（#service.qualification_id_list）在 .goods-propertys **之外**，本函数不涉及。
 */
interface PddAttrItem {
  /** form-item 的 id，如 basic.propertys.2.value */
  id: string
  /** 属性名（已去掉「重要」/「*」） */
  name: string
  /** 当前是否已有值（多选属性选完后 input.value 仍为空，故仅用于「跳过已填」的初判） */
  filled: boolean
  /** 值控件 placeholder，用于识别搜索型下拉 */
  placeholder: string
}

/** 读商品属性区的全部属性项 */
async function readAttrItems(page: any): Promise<PddAttrItem[]> {
  return await page.evaluate(() => {
    const out: { id: string; name: string; filled: boolean; placeholder: string }[] = []
    const items = Array.from(document.querySelectorAll('.goods-propertys .property-item')) as HTMLElement[]
    for (const it of items) {
      const fi = it.querySelector('[id^="basic.propertys."]') as HTMLElement | null
      if (!fi) continue
      const inp = fi.querySelector('input[data-testid="beast-core-select-htmlInput"]') as HTMLInputElement | null
      if (!inp) continue
      const name = ((fi.querySelector('label') as HTMLElement | null)?.innerText || '')
        .replace(/重要/g, '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      out.push({ id: fi.id, name, filled: !!(inp.value || '').trim(), placeholder: inp.placeholder || '' })
    }
    return out
  }).catch(() => []) as PddAttrItem[]
}

/** 展开某个属性的下拉面板（beast-core Select 靠 header 上的 mousedown/click 展开） */
async function openAttrDropdown(page: any, id: string): Promise<boolean> {
  return await page.evaluate((fid: string) => {
    const fi = document.getElementById(fid)
    if (!fi) return false
    const head = (fi.querySelector('[data-testid="beast-core-select-header"]')
      || fi.querySelector('input[data-testid="beast-core-select-htmlInput"]')) as HTMLElement | null
    if (!head) return false
    try { (fi.querySelector('input') as HTMLInputElement | null)?.focus() } catch { /* 忽略 */ }
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return true
  }, id).catch(() => false) as boolean
}

/**
 * 读「当前已展开」的下拉面板里的真实选项。
 * ★ 面板挂在 body 级 portal 上（`.ST_dropdownPanel_5-188-0` / `.ST_dropdownMain_5-188-0`，
 *   选项是其内的 `li.ST_item_5-188-0`），与触发它的 select 在 DOM 上不相邻，
 *   因此只能按「可见面板」取，取**文档中最后一个可见面板**（即最近展开的那个）。
 * ★ 只读真实选项，绝不凭空造值 —— 后续交给模型也只能从这批文本里挑。
 */
async function readOpenOptions(page: any): Promise<string[]> {
  return await page.evaluate(() => {
    const panels = (Array.from(
      document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]'),
    ) as HTMLElement[]).filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out: string[] = []
    const seen = new Set<string>()
    const nodes = Array.from(panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')) as HTMLElement[]
    for (const n of nodes) {
      if (n.offsetParent === null) continue
      const t = (n.innerText || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 40 || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => []) as string[]
}

/**
 * 在已展开的下拉面板里点中文本完全匹配的选项。
 * ★ 与价格输入框同一课：合成 MouseEvent 不一定被 React 认下，
 *   所以先打标记、再用 CDP 派发**真实鼠标点击**（见 fillPriceTable 的注释）。
 */
async function clickOpenOption(page: any, text: string): Promise<boolean> {
  const found = await page.evaluate((t: string) => {
    const panels = (Array.from(
      document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]'),
    ) as HTMLElement[]).filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return false
    for (const e of Array.from(document.querySelectorAll('[data-pdd-opt]'))) {
      e.removeAttribute('data-pdd-opt')
    }
    const nodes = Array.from(panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')) as HTMLElement[]
    const hit = nodes.find(n => n.offsetParent !== null
      && (n.innerText || '').replace(/\s+/g, ' ').trim() === t)
    if (!hit) return false
    hit.setAttribute('data-pdd-opt', '1')
    return true
  }, text).catch(() => false) as boolean
  if (!found) return false

  const el = await page.$('[data-pdd-opt="1"]').catch(() => null)
  if (!el) return false
  try { await el.click(); return true } catch { return false }
}

/**
 * 点选后回读属性项，确认值确实落到了控件上。
 * ★ 不能只看 innerText：beast-core 的单选下拉会把选中值写进 `input.value`
 *   （此时 innerText 仍是空的），只看 innerText 会误报「未确认到值」（真机实测踩过）。
 */
async function verifyAttrValue(page: any, id: string, value: string): Promise<boolean> {
  return await page.evaluate((fid: string, v: string) => {
    const fi = document.getElementById(fid)
    if (!fi) return false
    const norm = (s: string) => (s || '').replace(/\s+/g, '')
    const want = norm(v)
    if (norm(fi.innerText).includes(want)) return true
    for (const el of Array.from(fi.querySelectorAll('input, textarea'))) {
      const val = (el as HTMLInputElement).value || ''
      if (norm(val).includes(want)) return true
    }
    return false
  }, id, value).catch(() => false) as boolean
}

/** 收起下拉面板：多选属性（如「适用场景」）选完面板不会自动关，需点属性 label 触发外部点击关闭 */
async function closeAttrDropdown(page: any, id: string): Promise<void> {
  await page.evaluate((fid: string) => {
    const fi = document.getElementById(fid)
    const label = (fi?.querySelector('label') || document.body) as HTMLElement
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      label.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
  }, id).catch(() => { /* 忽略 */ })
}

/**
 * 让文本模型从**页面真实选项**里为某属性挑一个值。
 * ★ 安全边界：只接受「原样命中候选值」的返回 —— 模型改写、编造或返回 null 一律当作放弃，
 *   宁可标「未自动填」也不许它自由发挥（属性填错会导致商品被下架或流量损失）。
 */
async function pickAttrValue(
  attrName: string,
  options: string[],
  ctx: { title: string },
): Promise<string | null> {
  if (!options.length) return null
  const sys = '你是电商商品发布助手。根据商品标题，从「候选值」中为该属性挑选最合适的一个。\n'
    + '硬性规则：① 只能原样返回候选值中的一个，不得改写、不得创造新值；\n'
    + '② 只要有一个候选值与商品标题明显契合就必须选它（多选属性也只需选最契合的一个）；\n'
    + '③ 只有候选值全部明显不相关时才返回 null。\n'
    + '只输出 JSON，形如 {"value":"候选值原文"} 或 {"value":null}，不要输出任何解释。'
  const user = `商品标题：${ctx.title}\n属性名：${attrName}\n候选值：${options.join(' / ')}`
  try {
    const resp = await fetch(`${ATTR_MODEL_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ATTR_MODEL_API_KEY}` },
      body: JSON.stringify({
        model: ATTR_MODEL,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(ATTR_MODEL_TIMEOUT_MS),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] }
    const raw = data?.choices?.[0]?.message?.content || ''
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonText) return null
    const v = (JSON.parse(jsonText) as { value?: unknown })?.value
    const picked = typeof v === 'string' ? v.trim() : ''
    return picked && options.includes(picked) ? picked : null
  } catch {
    return null
  }
}

/**
 * 自动填「商品属性」区：逐个属性「展开下拉 → 读真实选项 → 模型选值 → 点中」。
 * ★ 属性无 `*`（属建议/重要项），填失败不阻断发布，只记入 missed 回报。
 * ★ 品牌跳过（品牌授权风险）。
 */
async function fillAttributes(
  page: any,
  ctx: { title: string },
): Promise<{ filled: string[]; missed: string[] }> {
  const filled: string[] = []
  const missed: string[] = []
  const all = await readAttrItems(page)
  const todo = all.filter(i => i.name && !i.filled && !ATTR_SKIP_RE.test(i.name))
  if (all.length) {
    console.log(`[dsagent-pdd-publish] 商品属性共 ${all.length} 项，待填 ${todo.length} 项`
      + `${todo.length ? `：${todo.map(i => i.name).join('、')}` : ''}`)
  }

  for (const it of todo) {
    const isSearch = /搜索/.test(it.placeholder)
    await openAttrDropdown(page, it.id)
    await sleep(ATTR_DROPDOWN_WAIT_MS)
    const options = await readOpenOptions(page)
    if (!options.length) {
      await closeAttrDropdown(page, it.id)
      missed.push(isSearch ? `${it.name}（需输入关键词搜索，未自动选）` : `${it.name}（下拉未读到选项）`)
      continue
    }
    const picked = await pickAttrValue(it.name, options, ctx)
    if (!picked) {
      await closeAttrDropdown(page, it.id)
      console.log(`[dsagent-pdd-publish] 属性「${it.name}」候选：${options.join(' / ')}`)
      missed.push(`${it.name}（候选 ${options.length} 项，模型未选）`)
      continue
    }
    const ok = await clickOpenOption(page, picked)
    await sleep(400)
    const confirmed = ok && await verifyAttrValue(page, it.id, picked)
    await closeAttrDropdown(page, it.id)
    if (confirmed) filled.push(`${it.name}=${picked}`)
    else missed.push(`${it.name}（点选「${picked}」${ok ? '后未确认到值' : '失败'}）`)
  }
  return { filled, missed }
}

/**
 * 读「提交后被拦」的真实原因。
 *
 * ★ 为什么必须专门读（真机实测教训）：提交被拦时页面**不弹 toast**，拦因只在两处：
 *     ① 右侧固定区「商品填写建议」面板（`.goods-optimization-container`）——
 *        头部 `.optimize-header`，两个 tab「错误（N）」「建议」；
 *        错误 tab 的 `.TAB_content_*` 为空时是「暂无错误内容」；
 *        建议 tab 里是 `.optimize-item_container_*`（模块名 + 文案），如「商品属性 / 填写属性，获取流量」；
 *     ② 各字段下方的红色校验文案（`[class*="Form_itemError"]`）。
 *   旧的「拿 document.body.innerText 去正则匹配关键词」一个都没命中，180s 空转后
 *   只能报「未检测到成功标志」，对定位毫无帮助。
 *
 * 返回 hard = 硬拦因（有它就不必再等）；panel = 面板全文（诊断用，仅建议项时也保留）。
 */
async function readSubmitErrors(page: any): Promise<{ hard: string; panel: string }> {
  return await page.evaluate(() => {
    const hard: string[] = []

    // ① toast（排除成功文案）
    const toast = document.querySelector('div[data-testid="beast-core-toast"]') as HTMLElement | null
    const toastTxt = (toast?.innerText || '').replace(/\s+/g, ' ').trim()
    if (toastTxt && !/提交成功|发布成功/.test(toastTxt)) hard.push(`页面提示：${toastTxt}`)

    // ② 字段级红色校验文案
    for (const e of Array.from(document.querySelectorAll('[class*="Form_itemError"]')) as HTMLElement[]) {
      if (e.offsetParent === null) continue
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
      if (t && t.length <= 60) hard.push(t)
    }

    // ③「商品填写建议」面板
    let panel = ''
    const opt = document.querySelector('[class*="goods-optimization-container"]') as HTMLElement | null
    if (opt) {
      const labels = Array.from(opt.querySelectorAll('[class*="common_tabLabel"]')) as HTMLElement[]
      const errTab = labels.find(l => /错误/.test(l.innerText || ''))
      const errCount = Number((errTab?.innerText || '').match(/(\d+)/)?.[1] || 0)
      const errTxt = ((opt.querySelector('[class*="TAB_content"]') as HTMLElement | null)?.textContent || '')
        .replace(/\s+/g, ' ').trim()
      const advice = (Array.from(opt.querySelectorAll('[class*="optimize-item_container"]')) as HTMLElement[])
        .map(a => (a.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      if (errCount > 0 && errTxt && !/暂无错误内容/.test(errTxt)) hard.push(`错误（${errCount}）：${errTxt}`)
      const title = (opt.querySelector('[class*="optimize-header"]') as HTMLElement | null)?.innerText || ''
      panel = [title.replace(/\s+/g, ' ').trim(), `错误（${errCount}）`, ...advice].filter(Boolean).join(' | ')
    }

    return { hard: Array.from(new Set(hard)).join('；'), panel }
  }).catch(() => ({ hard: '', panel: '' })) as { hard: string; panel: string }
}

/**
 * 点「提交并上架」。
 * 真机实测：第二步表单页底部的按钮 innerText 恰为「提交并上架」。
 * ★ 影刀记录的 button#submit_button 已不存在，不再作为优先锚点。
 */
async function clickSubmit(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const hit = btns.find(b =>
      /^(提交并上架|提交|确认提交|发布)$/.test((b.innerText || '').trim())
      && !b.disabled && b.offsetParent !== null)
    if (!hit) return false
    hit.click()
    return true
  }).catch(() => false) as boolean
}

/**
 * 拼多多商家后台商品发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function pddPublish(
  store: CredentialStore,
  opts: PddPublishOptions,
): Promise<PddPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const title = String(opts.title || '').trim()
  const category = String(opts.category ?? '').trim()
  const price = String(opts.price ?? '').trim()
  const stock = String(opts.stock ?? '').trim() || DEFAULT_STOCK
  const itemNo = String(opts.itemNo ?? '').trim()
  const images = (Array.isArray(opts.images) ? opts.images : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES)

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
          text: `图片超过单张上限 3MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）。`
            + '拼多多主图要求 ≤ 3MB，请压缩后重试。',
        }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取图片文件：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (!title) {
    return { ok: false, failureKind: 'api_error', text: '缺少 title（商品标题）。拼多多要求标题必填。' }
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
      return { ok: false, failureKind: 'api_error', text: `商品参考价不合法：${price}。请填正数（元，1 亿元以内）。` }
    }
  }
  if (stock) {
    const n = Number(stock)
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
      return { ok: false, failureKind: 'api_error', text: `库存不合法：${stock}。请填非负整数。` }
    }
  }

  // 详情图：与主图同规则（存在性 + 单张 ≤3MB），张数按页面上限截断
  const detailImages = (Array.isArray(opts.detailImages) ? opts.detailImages : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, MAX_DETAIL_IMAGES)
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
        return {
          ok: false,
          failureKind: 'api_error',
          text: `详情图超过单张上限 3MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）。请压缩后重试。`,
        }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取详情图文件：${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // SKU 多规格：规格值名必填；预览图「宽高比 1:1、宽高 >480px、单张 <3MB、仅 JPG/PNG」
  //（宽高比与分辨率无法在本地稳妥校验，交由平台驳回；此处只校验存在性与大小）
  const skus: PddSkuInput[] = (Array.isArray(opts.skus) ? opts.skus : []).map(s => ({
    name: String(s?.name ?? '').trim(),
    image: String(s?.image ?? '').trim(),
    price: String(s?.price ?? '').trim(),
    stock: String(s?.stock ?? '').trim(),
  }))
  for (const s of skus) {
    if (!s.name) {
      return { ok: false, failureKind: 'api_error', text: 'skus 里存在规格值为空的项（每项必须有 name，如「白色」）。' }
    }
    if (s.price) {
      const n = Number(s.price)
      if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
        return {
          ok: false,
          failureKind: 'api_error',
          text: `SKU「${s.name}」拼单价不合法：${s.price}。请填正数（元，1 亿元以内）。`,
        }
      }
    }
    if (s.stock) {
      const n = Number(s.stock)
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
        return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」库存不合法：${s.stock}。请填非负整数。` }
      }
    }
    if (s.image) {
      if (!existsSync(s.image)) {
        return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」预览图不存在：${s.image}` }
      }
      try {
        const st = statSync(s.image)
        if (!st.isFile() || st.size === 0) {
          return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」预览图不可用（非文件或大小为 0）：${s.image}` }
        }
        if (st.size > MAX_IMAGE_BYTES) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `SKU「${s.name}」预览图超过单张上限 3MB：${s.image}（${(st.size / 1024 / 1024).toFixed(2)}MB）。`,
          }
        }
      } catch (e) {
        return {
          ok: false,
          failureKind: 'api_error',
          text: `无法读取 SKU「${s.name}」预览图：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  }
  if (skus.length > 20) {
    return { ok: false, failureKind: 'api_error', text: `SKU 规格值最多 20 个（当前 ${skus.length} 个）。` }
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
      text: buildPreview(account, { ...opts, title, category, stock, itemNo }, images),
    }
  }

  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   必须用**账号专属**目录（带 shopKey）：这样发布用的 Chrome 环境与登录、风控验证
  //   是同一套设备身份，平台不会把发布请求当成陌生设备（profileDir 文档的既定契约）。
  const dir = profileDir(PLATFORM, shopKey)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `拼多多商家后台的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  let browser: any = null

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' }
    }

    const launchOpts = {
      // 可见窗口：发布是真实副作用操作，且类目属性等字段需人工补全，必须让用户看得见
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-pdd-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入拼多多域 Cookie（商家后台登录票据 PASS_ID 写在 .pinduoduo.com 域）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => ([
        { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
        { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
      ]))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-pdd-publish] 已注入 ${cookieList.length} 个 Cookie（账号 ${shopKey}）`)

    // ── 段 1：打开商品列表 → 点「发布新商品」（唯一正确入口）────
    //   ★ 不能直接 goto /goods/goods_add/index：该 URL 需要 type=add&from=category
    //     &version=predictCate&id=<类目id>&goods_id=<商品id> 这组上下文参数，
    //     它们由平台在「发布新商品」入口处即时生成。直接敲表单 URL 只会得到空壳页。
    console.log(`[dsagent-pdd-publish] 段 1 打开商品列表：${PDD_GOODS_LIST_URL}`)
    await page.goto(PDD_GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await sleep(4000)

    const listReady = await waitFor(
      page,
      p => p.evaluate(() =>
        /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')),
      LIST_WAIT_MS,
      '商品列表页',
    )
    if (!listReady.ok) return guardFailResult(listReady, store, shopKey, page.url())

    const entryClicked = await clickPublishEntry(page)
    if (!entryClicked) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: page.url(),
        text: '未能在商品列表页找到「发布新商品」入口（页面结构可能已变更）。\n'
          + '请打开浏览器窗口手动点击「发布新商品」，或稍后重试本工具。',
      }
    }
    console.log('[dsagent-pdd-publish] 已点击「发布新商品」，等待第一步页面...')

    // ── 段 2：第一步（主图 + 标题）页 /goods/category ────────
    const step1 = await waitForPage(browser, STEP1_URL_RE, 60_000)
    if (!step1) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: page.url(),
        text: '点击「发布新商品」后 60s 内未出现第一步页面（/goods/category）。\n'
          + '请打开浏览器窗口确认是否弹出了新标签页；若被浏览器拦截弹窗，请允许后重试。',
      }
    }
    await step1.bringToFront().catch(() => { /* 忽略 */ })
    await step1.setViewport({ width: 1440, height: 900 }).catch(() => { /* 忽略 */ })

    const step1Ready = await waitFor(
      step1,
      p => p.evaluate((sel: string) => !!document.querySelector(sel), STEP1_READY_SELECTOR),
      FORM_WAIT_MS,
      '第一步（主图 + 标题）页',
    )
    if (!step1Ready.ok) return guardFailResult(step1Ready, store, shopKey, step1.url())

    const up = await uploadImages(step1, images, STEP1_IMAGE_INPUT, '第一步主图区')
    console.log(`[dsagent-pdd-publish] 主图上传：${up.note}`)

    const tHit1 = await fillTitle(step1, title)
    if (!tHit1) console.log('[dsagent-pdd-publish] 第一步标题未能自动写入，需在窗口内人工填写')

    // 主图 + 标题写入后，底部「下一步」才会由 disabled 转为可点
    const nextEnabled = await waitEnabled(step1, STEP1_NEXT_BTN, 60_000)
    const nextClicked = nextEnabled && await clickNextStep(step1)
    console.log(`[dsagent-pdd-publish] 第一步「下一步」：${nextClicked ? '已点击' : '未能点击'}`)
    if (!nextClicked) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: step1.url(),
        text: '第一步（主图 + 标题）未通过：「下一步, 完善商品信息」按钮不可点。\n'
          + `主图上传：${up.note}\n`
          + (tHit1 ? `标题已写入：${title}\n` : '★ 标题未能自动写入，请在窗口内手动填写。\n')
          + '请在浏览器窗口内补齐主图与标题后手动点「下一步」，或修正后重试本工具。',
      }
    }

    // ★ 点「下一步」后**偶尔**会弹「发布承诺」确认弹窗（并非每次），不点掉不会跳第二步。
    //   轮询几次点掉；未出现则静默跳过（最多空等约 3.5s，不阻塞主流程）。
    for (let i = 0; i < 5; i++) {
      await sleep(700)
      if (await dismissPromiseModal(step1)) {
        console.log('[dsagent-pdd-publish] 已点掉「发布承诺」确认弹窗')
        break
      }
    }

    // ── 段 3：第二步（完整表单）页 /goods/goods_add/index ────
    let step2 = await waitForPage(browser, STEP2_URL_RE, 25_000)
    if (!step2) {
      // 首次点「下一步」偶尔会被吞（图片登记/校验的时序问题）：
      // 打印第一步页当前文案（含校验 toast）便于排查，然后补点一次。
      const step1Text = await step1.evaluate(() =>
        (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '')
      console.log(`[dsagent-pdd-publish] 未等到第二步页；第一步页当前文案：${step1Text}`)
      console.log('[dsagent-pdd-publish] 补点一次「下一步」...')
      await clickNextStep(step1)
      step2 = await waitForPage(browser, STEP2_URL_RE, 65_000)
    }
    if (!step2) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: step1.url(),
        text: '点「下一步」后 90s 内未跳到第二步发布表单页（/goods/goods_add/index）。\n'
          + '请打开浏览器窗口查看是否被校验拦住（主图/标题不合规），处理后重试本工具。',
      }
    }
    await step2.bringToFront().catch(() => { /* 忽略 */ })
    await step2.setViewport({ width: 1440, height: 900 }).catch(() => { /* 忽略 */ })

    const step2Ready = await waitFor(
      step2,
      p => p.evaluate((sel: string) => !!document.querySelector(sel), STEP2_READY_SELECTOR),
      FORM_WAIT_MS,
      '第二步发布表单',
    )
    if (!step2Ready.ok) return guardFailResult(step2Ready, store, shopKey, step2.url())

    // 第二步主图通常继承第一步已上传的图片；若为空则兜底再传一次
    const step2HasImage = await step2.evaluate(() =>
      /\([1-9]\d*\s*\/\s*10\)/.test(document.body?.innerText || '')).catch(() => false) as boolean
    if (!step2HasImage) {
      const up2 = await uploadImages(step2, images, STEP2_IMAGE_INPUT, '第二步主图区')
      console.log(`[dsagent-pdd-publish] 第二步主图兜底上传：${up2.note}`)
    }

    // 类目由平台按入口 id 智能推荐自动带出（页面上呈现为「商品分类 … 修改分类」）
    const cateText = await step2.evaluate(() => {
      const el = document.querySelector('#goods-category') as HTMLElement | null
      return (el?.innerText || '').replace(/\s+/g, ' ').trim()
    }).catch(() => '') as string
    if (cateText) console.log(`[dsagent-pdd-publish] 平台自动带出类目：${cateText}`)

    // ── 段 4：填通用字段 ───────────────────────────────────
    const filled: string[] = []
    const missed: string[] = []

    if (cateText) filled.push('类目（平台自动推荐）'); else missed.push('类目')

    const tHit = await fillTitle(step2, title)
    if (tHit) filled.push(`标题=${title}`); else missed.push('标题')

    if (category) {
      console.log('[dsagent-pdd-publish] 已提供 category 关键词，但类目由平台按入口自动推荐；'
        + '如需改类目请在窗口内点「修改分类」。')
    }

    if (price) {
      const pHit = await fillField(step2, /商品参考价|参考价|应大于商品最大单买价/, price)
      if (pHit) filled.push(`参考价=${price}`); else missed.push('参考价')
    }

    // 商品详情图：离屏隐藏 input 直接投递（投递前先点掉引导气泡「知道了」）
    const detail = await uploadDetailImages(step2, detailImages)
    if (detail.ok) filled.push(`详情图（${detail.note}）`); else missed.push(`详情图（${detail.note}）`)
    console.log(`[dsagent-pdd-publish] 详情图：${detail.note}`)
    await sleep(1000)

    // SKU 多规格：必须先建规格（决定 SKU 行数），再填价格/库存，最后投递每行预览图。
    // ★ 顺序不可颠倒 —— fillPriceTable 按 SKU 表的行号逐行填，行由规格值产生。
    if (skus.length) {
      const spec = await withStallWatch(
        step2, '第二步-SKU 规格', 180_000, () => fillSkuSpec(step2, skus),
      )
      filled.push(...spec.filled)
      missed.push(...spec.missed)
      await sleep(1500)
    }

    // 价格及库存 SKU 表：placeholder 全是「请输入」，必须按表头列序定位（见 fillPriceTable）
    // ★ 套看门狗：该表曾静默卡死 9 分钟（弹层遮挡 → click 空等），卡住时自动截图留证。
    const sku = await withStallWatch(
      step2, '第二步-价格及库存', 150_000,
      () => fillPriceTable(step2, {
        price, stock, itemNo,
        // 逐行覆盖：第 i 行对应第 i 个规格值；缺项自动回落到顶层 price / stock
        rows: skus.map(s => ({ price: s.price, stock: s.stock })),
      }),
    )
    filled.push(...sku.filled)
    missed.push(...sku.missed)
    console.log(`[dsagent-pdd-publish] 通用字段已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`)
    await sleep(1500)

    // ── 段 4-b：填「商品属性」（建议项，失败不阻断发布）──
    // 属性值由文本模型从**页面真实下拉选项**里选（见 fillAttributes）。
    try {
      const attrs = await withStallWatch(
        step2, '第二步-商品属性', 150_000, () => fillAttributes(step2, { title }),
      )
      filled.push(...attrs.filled)
      missed.push(...attrs.missed)
    } catch (e) {
      missed.push(`商品属性（自动填充异常：${(e as Error).message}）`)
    }
    console.log(`[dsagent-pdd-publish] 属性后累计已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`)

    // ── 段 4 收尾：点提交 ─────────────────────────────────
    const clicked = await clickSubmit(step2)
    console.log(`[dsagent-pdd-publish] 提交按钮点击：${clicked ? '已点击' : '未点到（可能仍需补全必填项）'}`)

    // ── 判定结果（含用户手动补全后自行提交的情形）─────────
    let finalUrl = step2.url()
    let success = false
    let successId = ''
    let errText = ''
    let errPanel = ''
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(2000)
      finalUrl = step2.url()

      if (await detectRisk(step2)) {
        console.log('[dsagent-pdd-publish] 提交时命中内联滑块，等待用户在窗口内完成拼图...')
        if (!(await waitSliderCleared(step2, SLIDER_WAIT_MS))) {
          return {
            ok: false,
            failureKind: 'risk_control',
            shopKey,
            finalUrl,
            text: '提交时命中「请向右滑块完成拼图」安全验证，等待 '
              + `${SLIDER_WAIT_MS / 1000}s 仍未通过。\n`
              + '请重试本工具，在浏览器窗口内手动拖动滑块完成拼图后，工具会自动继续提交。\n'
              + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : ''),
          }
        }
        // 滑块通过后重新点一次提交
        console.log('[dsagent-pdd-publish] 滑块已通过，重新提交。')
        await clickSubmit(step2)
        continue
      }

      if (await isLoggedOut(step2)) {
        await store.setStatus(shopKey, 'expired')
        return {
          ok: false,
          failureKind: 'token_expired',
          shopKey,
          finalUrl,
          text: '拼多多商家后台登录态已失效（页面要求登录）。\n'
            + '请到「账号连接」页面重新登录**拼多多商家后台**账号（mms.pinduoduo.com）。',
        }
      }

      try {
        const probe = await step2.evaluate(() => {
          const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
          const idMatch = txt.match(/商品ID[:：]\s*(\d+)/)
          const toast = document.querySelector('div[data-testid="beast-core-toast"]')
          if (toast && /提交成功/.test((toast as HTMLElement).innerText || '')) {
            return { kind: 'success', id: idMatch ? idMatch[1] : '' }
          }
          // 提交成功后页面会出现「查看商品详情」按钮；「商品修改发布中」表示平台已受理
          if (/查看商品详情|商品修改发布中/.test(txt)) {
            return { kind: 'success', id: idMatch ? idMatch[1] : '' }
          }
          const err = txt.match(/提交失败[^。]{0,80}|发布失败[^。]{0,80}|商品标题不能为空|请输入商品标题[^。]{0,40}|标题不能超过[^。]{0,30}|请填写商品参考价|请上传[^。]{0,30}图片|请选择[^。]{0,20}类目|请填写[^。]{0,30}属性/)
          if (err) return { kind: 'error', msg: err[0] }
          return { kind: '', id: '' }
        }) as { kind: string; id?: string; msg?: string }
        if (probe.kind === 'success') { success = true; successId = probe.id || ''; break }
        // 兜底词表命中不立即中断：真实拦因以「商品填写建议」面板为准（见下方 readSubmitErrors）
      } catch { /* 页面跳转中，下一轮再取 */ }

      // ★ 诊断：读「商品填写建议」面板（错误 tab + 建议项）+ 字段级红字 + toast
      try {
        const diag = await readSubmitErrors(step2)
        if (diag.panel) errPanel = diag.panel
        if (diag.hard) {
          console.log(`[dsagent-pdd-publish] 提交被拦：${diag.hard}`)
          if (diag.panel) console.log(`[dsagent-pdd-publish] 填写建议面板：${diag.panel}`)
          errText = diag.hard
          break
        }
      } catch { /* 面板读取失败不影响主循环 */ }
    }
    if (errPanel) console.log(`[dsagent-pdd-publish] 填写建议面板：${errPanel}`)
    if (success) {
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: '拼多多商品发布已提交成功。\n'
          + `账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${title}\n`
          + (successId ? `商品ID：${successId}\n` : '')
          + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
          + (missed.length ? `未自动填写（需人工确认）：${missed.join('、')}\n` : '')
          + `当前页面：${finalUrl}\n`
          + '注意：平台仍会对商品做审核，最终状态请在商家后台「商品管理 → 出售中」确认。',
      }
    }

    if (errText) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl,
        text: `发布失败：${errText}\n`
          + (errPanel ? `填写建议面板：${errPanel}\n` : '')
          + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : '')
          + '请在浏览器窗口内补全必填项（尤其是**类目属性**、商品详情与 SKU）后手动点击「提交并上架」。',
      }
    }

    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl,
      text: `提交后 ${PUBLISH_TIMEOUT_MS / 1000}s 内未检测到成功标志（当前 URL：${finalUrl}）。\n`
        + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
        + (missed.length ? `★ 未能自动填写：${missed.join('、')}\n` : '')
        + (errPanel ? `填写建议面板：${errPanel}\n` : '')
        + '请打开浏览器窗口查看具体提示：\n'
        + '  · 若页面仍有红色校验提示（类目属性、详情、SKU、发货设置等），补全后手动点「提交并上架」；\n'
        + '  · 若出现滑块拼图，请人工完成；\n'
        + '  · 处理完成后若已发布成功，可在商家后台「商品管理 → 出售中」核对结果。',
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `拼多多发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
