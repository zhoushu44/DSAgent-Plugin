/**
 * 拼多多上架「模式2」—— 请求劫持改包引擎（复刻觅千手 6.0.32 `sw_goods_commit` + `m_042_8087`）。
 *
 * 与模式1（`pdd-publish.ts` UI 自动化）的根本差异：
 *   模式1 用 UI 逐格填价格/库存表（fillPriceTable），填表慢且锚点脆；
 *   模式2 不自己构造提交请求 —— 等商家在后台点「提交」→ CDP 拦下原生请求
 *   → 只替换图片/SKU 价格/运费字段 → 以**页面身份**（credentials:"include" +
 *   Anti-Content 头）重放。类目/属性/标题/SKU 结构由页面正常生成，不碰。
 *
 * 架构坍缩（MV3 扩展 → puppeteer 单进程）：
 *   - DNR block + webRequest 双层 → `page.setRequestInterception(true)` 一次拦
 *   - postMessage 双 world 桥    → `page.evaluate` 直调（主 world，无 localStorage 回传）
 *   - chrome.cookies.getAll       → `page.evaluate(document.cookie)`
 *   - safe.koudai89.com 云端兜底  → gateway-proxy（本项目网关已带完整指纹头）
 *   - sleep(2000)/先摘 DNR 等时序补偿 → CDP 下 request.continue() 本身就不发原包，可省
 *
 * 移植蓝本与变量映射详见 docs/pdd-publish-mode2/BLUEPRINT.md（§4 四步流水线、
 * §6 Anti-Content、§9.2 施工清单）；evidence/ 目录 44 份为代码级证据。
 * ★ 改包失败绝不发原始包（willUseRawBody:false 铁律，sw_webrequest_tail.js @64650）。
 */
import type { ProductData } from './services/product-schema.js'

/* ───────────────────────── 页面结构类型（pdd-publish.ts 里 page 为 any，此处收紧） ───────────────────────── */

/**
 * 极简 puppeteer Page 结构类型 —— 只声明模式2 用到的方法。
 * pdd-publish.ts 动态 import puppeteer-core 后 page 为 any，不导出类型；
 * 此处按结构收窄，m1（evaluate 注入）与 m3（请求拦截）共用。
 */
export interface Page {
  /** 主 world 直调：字符串源码（ANTI_*_SRC）或函数；可带参数（page.evaluate(fn, ...args) 语义） */
  evaluate<T = any>(source: string | ((...args: any[]) => T), ...args: any[]): Promise<T>
  url(): string
  reload(opts?: { waitUntil?: string }): Promise<unknown>
  setRequestInterception(enabled: boolean): Promise<void>
  on(event: string, handler: (req: Request) => void): void
}

/** 极简 puppeteer HTTPRequest 结构类型（m3 拦截器用） */
export interface Request {
  url(): string
  method(): string
  postData(): string | undefined
  resourceType(): string
  /** 放行原请求（改包成功路径不用；仅在非 edit 请求时直接 continue） */
  continue(opts?: { url?: string; method?: string; postData?: string; headers?: Record<string, string> }): Promise<void>
  abort(errorCode?: string): Promise<void>
  respond(opts: { status: number; headers?: Record<string, string>; body?: string }): Promise<void>
}

/* ───────────────────────── 常量表（BLUEPRINT §2，照抄） ───────────────────────── */

/** 页面变换流水线超时 */
export const PDD_TRANSFORM_TIMEOUT_MS = 30_000
/** 页面 fetch 重放超时 */
export const PDD_PAGE_SEND_TIMEOUT_MS = 30_000
/** 商家后台 origin */
export const PDD_MMS_ORIGIN = 'https://mms.pinduoduo.com'
/** 拦截目标：goodsCommit/action/edit（编辑提交接口，含新建走 edit 通道） */
export const PDD_EDIT_URL_FILTER = 'mms.pinduoduo.com/glide/mms/goodsCommit/action/edit'
/** 追加条件：不必等 2s、不必摘 DNR（CDP continue 不发原包） */
export const PDD_HIJACK_WAIT_MS = 120_000

export const PDD_ERROR_CODE = {
  TRANSFORM_TIMEOUT: 'PDD_TRANSFORM_TIMEOUT',
  TRANSFORM_ERROR: 'PDD_TRANSFORM_ERROR',
  REQUEST_BODY_EMPTY: 'PDD_REQUEST_BODY_EMPTY',
  SEND_NETWORK: 'PDD_SEND_NETWORK',
  PROXY_FALLBACK_FAIL: 'PDD_PROXY_FALLBACK_FAIL',
  API_BIZ: 'PDD_API_BIZ',
  UNKNOWN: 'PDD_UNKNOWN',
} as const

/** 规格值白名单长度上限（m_042_8087 @268836：PDD_SPEC_MAX_JS_LEN=40） */
const PDD_SPEC_MAX_JS_LEN = 40
/** 商家编码加权长度上限（@268836：PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN=100） */
const PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN = 100

/* ───────────────────────── 类型定义 ───────────────────────── */

/** 提交包里的单条 SKU（PDD goodsCommit edit 请求体形态，证据 8087_fillSkuPriceData_def） */
export interface CommitSku {
  spec?: unknown[]
  multi_price?: number
  multi_price_in_yuan?: string
  price?: number
  price_in_yuan?: string
  quantity?: number
  quantity_delta?: number
  is_onsale?: number
  /** SKU 搜索图/规格图回填（_applyPddSkuThumbUrlToCommitSku，主循环每 SKU 无条件清空后按映射回填） */
  thumb_url?: string
  thumb_url_file_id?: string
  [k: string]: unknown
}

/** goodsDetail —— 觅千手商品数据（采集产物 + movingConfig 组合） */
export interface GoodsDetail {
  gallery?: unknown[]
  floor_list?: unknown[]
  preview_url?: string
  video_upload?: {
    id?: string | number
    url?: string
    check_comment?: string
    extra_info?: { height?: number; width?: number; video_cover_url?: string }
    [k: string]: unknown
  }
  price_detail?: Record<string, unknown>
  sku_price?: Record<string, unknown>
  sku_key?: Record<string, string[]>
  sku_key_list?: string[]
  sku_sort?: string[]
  sku_stock?: Record<string, unknown>
  sku_img?: Record<string, unknown>
  movingConfig?: MovingConfig
  inventory?: string | number
  stock_mode?: number
  goods_id?: string | number
  productId?: string | number
  productCode_radio?: string | number
  goods_url?: string
  productUrl?: string
  base_attr?: Record<string, string>
  pdd_published_spec_by_sku_id?: Record<string, string[]>
  [k: string]: unknown
}

/** 搬家配置（fillSkuPriceData 里的 s / fillShippingConfig 里的 r） */
export interface MovingConfig {
  pdd_single_buy_rule_type?: number
  pdd_single_buy_percent?: number
  pdd_single_buy_fixed_yuan?: number
  template?: string | number
  selectTime?: string | number
  sku_multi_discount?: number
  stock_mode?: number
  inventory?: string | number
  productCode_radio?: string | number
  [k: string]: unknown
}

/** 改包前后快照（_pddSummarizeEditBody） */
export interface EditBodySummary {
  type1: number
  type2: number
  skus: number
  skusPriced: number
  is_draft?: unknown
  goods_id?: unknown
  goods_commit_id?: unknown
}

/** 劫持结果（sw_finish_success_failure 62294 的形态） */
export interface HijackOutcome {
  success: boolean
  errorCode?: string
  status?: number
  error_msg?: string
  [k: string]: unknown
}

/* ───────────────────────── 基础工具（纯函数） ───────────────────────── */

/** 数字串解析：parseFloat + Number.isFinite（computePddSingleBuyYuan 里的 y() 混淆等价物） */
function toNum(v: unknown): number {
  const n = Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * 分/元互转（m_042_8087 @266607 原文移植）。
 * 返回 [分(number), 元(string)]，元串用「整数部分.两位小数」形态。
 */
export function priceToFenAndYuan(v: unknown): [number, string] {
  const fen = Math.round(100 * Number.parseFloat(String(v ?? '')))
  let yuan: string
  if (fen < 10) {
    yuan = `0.0${fen}`
  } else {
    const s = String(fen)
    const int = s.slice(0, -2) || '0'
    const dec = s.slice(-2)
    yuan = String(Number.parseFloat(`${int}.${dec}`))
  }
  return [fen, yuan]
}

/** 单买价公式（m_042_8087 @66698；rule_type=2 → 固定加价，否则按百分比） */
export function computePddSingleBuyYuan(
  price: unknown,
  cfg: Pick<MovingConfig, 'pdd_single_buy_rule_type' | 'pdd_single_buy_percent' | 'pdd_single_buy_fixed_yuan'>,
): number {
  const p = Number.parseFloat(String(price ?? ''))
  if (!Number.isFinite(p)) return 0
  const ruleType = toNum(cfg?.pdd_single_buy_rule_type)
  if (ruleType === 2) {
    const fixed = Number.parseFloat(String(cfg?.pdd_single_buy_fixed_yuan))
    const f = Number.isFinite(fixed) ? fixed : 1
    return Math.max(0, p + f)
  }
  const pct = Number.parseFloat(String(cfg?.pdd_single_buy_percent))
  const s = (Number.isFinite(pct) ? pct : 20) / 100
  return Math.max(0, p * (1 + s))
}

/** 市场参考价（@67053：market_price = 单买价max + 1 元；团队价参数 t 实际被逗号表达式丢弃） */
export function applyPddMarketReferencePrice(
  commitBody: { market_price?: number; market_price_in_yuan?: string },
  maxTeamYuan: number,
  maxSingleYuan: number,
): void {
  if (!commitBody || typeof commitBody !== 'object') return
  const single = Number.parseFloat(String(maxSingleYuan))
  if (!Number.isFinite(single) || single <= 0) return
  const market = single + 1
  const [fen, yuan] = priceToFenAndYuan(market)
  commitBody.market_price = fen
  commitBody.market_price_in_yuan = yuan
}

/** 取价（fillShippingConfig_def @265416：对象取 .price / 数字直取 / 字符串 parseFloat） */
export function extractPrice(v: unknown): number {
  if (typeof v === 'object' && v !== null && (v as any).price !== undefined) {
    return Number.parseFloat(String((v as any).price))
  }
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number.parseFloat(v)
  return 0
}

/* ───────────────────────── 规格名清洗族（纯函数） ───────────────────────── */

/** 规格白名单清洗（@120747：只保留中文/字母/数字/白名单符号，× ╳ ＊ → *） */
export function sanitizePddSpecWhitelist(v: unknown): string {
  if (v == null) return ''
  let t = String(v).replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s【】.()\\/\-*+）（#%':]/g, '')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/×|╳/g, '*').replace(/\uFF0A/g, '*')
  return t
}

/** 平台式截断（@120993：先按 40 字截，再按「末位数字 + 后续首个非空字符」规则收缩） */
export function truncatePddSpecLikePlatform(v: unknown, limit = PDD_SPEC_MAX_JS_LEN): string {
  if (!v) return ''
  const s = String(v)
  if (s.length <= limit) return s
  let head = s.slice(0, limit)
  const m = head.match(/^(.*) (\d)$/)
  if (m && s.length > limit) {
    const base = m[1]
    const lastDigit = m[2]
    let nextCh = ''
    for (let i = limit; i < s.length; i++) {
      if (s[i] !== ' ') { nextCh = s[i]; break }
    }
    head = '4' === lastDigit && nextCh && /[A-Za-z]/.test(nextCh)
      ? base + lastDigit + '6'
      : nextCh ? (base + lastDigit + nextCh).slice(0, limit) : base + lastDigit
    return head.slice(0, limit)
  }
  return head.trimEnd().slice(0, limit)
}

/** 规格值标准化（@121362：whitelist 清洗 + 平台式截断） */
export function canonicalizePddSpecValue(v: unknown): string {
  const t = sanitizePddSpecWhitelist(v)
  return t ? truncatePddSpecLikePlatform(t, PDD_SPEC_MAX_JS_LEN) : ''
}

/** cleanSpecName（@260854） */
export function cleanSpecName(v: unknown): string {
  if (!v) return ''
  const t = String(v).trim()
  const r = sanitizePddSpecWhitelist(t)
  return r ? (r.length <= PDD_SPEC_MAX_JS_LEN ? r : canonicalizePddSpecValue(r)) : ''
}

/** cleanSkuMatchKey（@124351） */
export function cleanSkuMatchKey(v: unknown): string {
  let e = v as string
  if (!(e && typeof e === 'string')) e = e == null ? '' : String(e)
  const t = e.trim()
  return t.length <= PDD_SPEC_MAX_JS_LEN ? sanitizePddSpecWhitelist(t) : canonicalizePddSpecValue(t)
}

/** 模糊匹配（@263468：互为包含） */
export function fuzzyMatch(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  return String(a).includes(String(b)) || String(b).includes(String(a))
}

/** 维度匹配（buildStablePriceDetailForFill_def @124570） */
export function dimMatchSkuToSpec(skuDim: unknown, specText: unknown): boolean {
  const a = String(skuDim ?? '')
  const b = String(specText ?? '')
  if (!a || !b) return false
  if (a === b) return true
  const ka = cleanSkuMatchKey(a)
  const kb = cleanSkuMatchKey(b)
  if (!ka || !kb) return false
  return ka === kb || fuzzyMatch(ka, kb) || fuzzyMatch(a, b)
}

/* ───────────────────────── 价格记录归一（纯函数） ───────────────────────── */

/** 价格记录归一（@137965） */
export function normalizeSkuPriceRecord(v: unknown): { price?: unknown; [k: string]: unknown } | null {
  if (v == null || v === '') return null
  if (typeof v === 'object' && (v as any).price !== undefined) return v as any
  if (typeof v === 'number' || typeof v === 'string') return { price: v }
  return null
}

/** 是否价格叶子（@138217 里内联） */
export function isSkuPriceLeaf(v: unknown): boolean {
  return !!v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'price')
}

/** 唯一嵌套叶子提取（@140001） */
export function pickSingleNestedPriceLeaf(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  if (isSkuPriceLeaf(v)) return v as any
  const leaves = Object.values(v as any).filter(e => isSkuPriceLeaf(e))
  return leaves.length === 1 ? (leaves[0] as any) : null
}

/**
 * SKU 的规格文本收集（@138217 七键序）。
 *
 * ★ 2026-10-21 实测修正：真实提交体（页面 DOM 建的规格行）的 spec 元素同时带
 *   `spec_name`（=维度名，如「颜色分类」）和 `spec_value`（=规格值，如「格蕾灰」）。
 *   原键序 spec_name 优先 → 收集到的是维度名 → 与 sku_key 的规格值全不匹配 →
 *   fillSkuPriceData 匹配链全落空（skusPricedDelta=0，引擎按铁律拒绝发包）。
 *   故改为 spec_value 优先：值语义才是匹配键，维度名只在缺值时才兜底。
 */
export function collectSpecTextsFromPddSku(sku: CommitSku | any): string[] {
  const specs = sku && Array.isArray(sku.spec) ? sku.spec : []
  const out: string[] = []
  for (const it of specs) {
    if (!it || typeof it !== 'object') continue
    const picked = ['spec_value', 'value', 'name', 'text', 'label', 'alias', 'spec_name']
      .map(k => (it as any)[k])
      .find(v => v != null && String(v).trim() !== '')
    if (picked != null) out.push(String(picked).trim())
  }
  return out
}

/* ───────────────────────── 库存（纯函数） ───────────────────────── */

/** 库存模式（getPddStockMode_def @61970） */
export function getPddStockMode(detail: GoodsDetail): 1 | 2 {
  if (!detail || typeof detail !== 'object') return 1
  const mc = detail.movingConfig || {}
  return Number((mc as MovingConfig).stock_mode ?? detail.stock_mode ?? 1) === 2 ? 2 : 1
}

/** 自定义库存（@61970） */
export function getPddCustomInventory(detail: GoodsDetail): number {
  if (!detail || typeof detail !== 'object') return 0
  const mc = (detail.movingConfig || {}) as MovingConfig
  const v = mc.inventory ?? detail.inventory
  if (v == null || v === '') return 0
  const n = parseInt(String(v), 10)
  return isNaN(n) ? 0 : n
}

/** 库存：priceData 里的 stock/quantity/inventory 三键（_peekStockFromPriceData @61970） */
export function peekStockFromPriceData(priceData: unknown): number | null {
  if (!priceData || typeof priceData !== 'object') return null
  for (const k of ['stock', 'quantity', 'inventory'] as const) {
    const v = (priceData as any)[k]
    if (v === undefined || v === null || v === '') continue
    const n = parseInt(String(v), 10)
    if (!isNaN(n)) return n
  }
  return null
}

/** 显式库存读取（fillShippingConfig_def @265416） */
function readExplicitStockNumber(v: unknown): number | null {
  if (!v || typeof v !== 'object') return null
  for (const k of ['stock', 'quantity', 'inventory'] as const) {
    const x = (v as any)[k]
    if (x === undefined || x === null || x === '') continue
    const n = parseInt(String(x), 10)
    if (!isNaN(n)) return n
  }
  return null
}

/** 行库存提取（@63056：显式三键 → 缺省值） */
export function extractStock(priceData: unknown, fallback: number): number {
  const n = readExplicitStockNumber(priceData)
  return n != null ? n : fallback
}

/** 提交 SKU 的库存落位（@265416：delete quantity → quantity_delta → is_onsale） */
export function applyResolvedStockToCommitSku(sku: CommitSku, stock: unknown): { quantity: number; isOnsale: number; statusText: string } {
  const n = parseInt(String(stock), 10)
  const q = !isNaN(n) && n > 0 ? n : 0
  const onsale = q > 0 ? 1 : 0
  delete (sku as any).quantity
  sku.quantity_delta = q
  sku.is_onsale = onsale
  return { quantity: q, isOnsale: onsale, statusText: onsale === 1 ? '上架' : '下架' }
}

/** 行库存决策（@63056） */
export function resolveSkuStockForFill(
  detail: GoodsDetail,
  priceData: unknown,
  defaultStock: number,
): number {
  const mode = getPddStockMode(detail)
  if (mode === 2) {
    const custom = getPddCustomInventory(detail)
    peekStockFromPriceData(priceData) // 证据里只读不用于返回（logPddSkuStockDecision 用）
    return custom
  }
  return extractStock(priceData, defaultStock)
}

/* ───────────────────────── 价格表构建与匹配（纯函数） ───────────────────────── */

/** sku 键序（@140195：sku_key_list 优先；无 list 时全数字保持原序，否则 zh-Hans-CN localeCompare 排序） */
export function getOrderedSkuKeyIdsWithPrice(detail: GoodsDetail): string[] {
  const skuKey = detail.sku_key || {}
  const skuPrice = detail.sku_price || {}
  let ids = detail.sku_key_list?.length ? detail.sku_key_list.slice() : Object.keys(skuKey)
  if (!detail.sku_key_list?.length) {
    const allNumeric = ids.every(e => /^-?\d+$/.test(String(e)))
    if (!allNumeric) {
      ids = ids.slice().sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'))
    }
  }
  return ids.filter(e => skuKey[e] != null && !!normalizeSkuPriceRecord(skuPrice[e]))
}

/** 行码占位判定（@140195：全部 spec 文本为 1~12 位纯数字） */
export function specTextsLookLikeRowCodePlaceholders(texts: string[]): boolean {
  const t = (texts || []).map(e => String(e || '').trim()).filter(Boolean)
  return t.length !== 0 && t.every(e => /^[0-9]{1,12}$/.test(e))
}

/** 稳定价格表（buildStablePriceDetailForFill_def @124570） */
export function buildStablePriceDetailForFill(detail: GoodsDetail): Record<string, any> | null {
  const skuSort = detail.sku_sort || []
  const skuKey = detail.sku_key || {}
  const skuPrice = detail.sku_price || {}
  let dims = skuSort.length
  const firstId = Object.keys(skuKey)[0]
  const firstVal = firstId ? skuKey[firstId] : null
  if ((dims <= 0 || dims > 2) && Array.isArray(firstVal) && firstVal.length) {
    dims = firstVal.length >= 2 ? 2 : 1
  }
  if (dims <= 0 || dims > 2) return null
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  const table: Record<string, any> = {}
  if (dims === 1) {
    for (const id of ids) {
      const row = skuKey[id]
      if (!Array.isArray(row) || row.length < 1) continue
      const price = skuPrice[id]
      if (price === undefined || price === null) continue
      const spec = String(row[0] || '').trim()
      if (!spec) continue
      table[spec] = typeof price === 'object' && price !== null ? price : { price }
    }
    return Object.keys(table).length ? table : null
  }
  for (const id of ids) {
    const row = skuKey[id]
    if (!Array.isArray(row) || row.length < 2) continue
    const price = skuPrice[id]
    if (price === undefined || price === null) continue
    const d1 = String(row[0] || '').trim()
    const d2 = String(row[1] || '').trim()
    if (!d1 || !d2) continue
    const leaf = typeof price === 'object' && price !== null ? price : { price }
    if (!table[d1]) table[d1] = {}
    table[d1][d2] = leaf
  }
  return Object.keys(table).length ? table : null
}

/** 空表判定（@124570） */
export function isEmptyPriceDetailTable(table: unknown): boolean {
  if (!table || typeof table !== 'object') return true
  for (const k of Object.keys(table as any)) {
    const v = (table as any)[k]
    if (v && typeof v === 'object') {
      if ((v as any).price !== undefined) return false
      for (const k2 of Object.keys(v)) {
        const leaf = (v as any)[k2]
        if (leaf && typeof leaf === 'object' && (leaf as any).price !== undefined) return false
      }
    }
  }
  return true
}

/** 已发布规格精确匹配（findPriceDataByPublishedSpec，transformRequestBody_def @130） */
export function findPriceDataByPublishedSpec(detail: GoodsDetail, specTexts: string[]): any | null {
  const wanted = (specTexts || []).map(e => String(e || '').trim()).filter(Boolean)
  if (!wanted.length) return null
  const skuKey = detail.sku_key || {}
  const skuPrice = detail.sku_price || {}
  const published = detail.pdd_published_spec_by_sku_id || {}
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  for (const id of ids) {
    const pub = published[id]
    const key = skuKey[id]
    const row = Array.isArray(pub) && pub.length ? pub : Array.isArray(key) ? key : []
    if (!row.length) continue
    let allMatch = true
    for (let i = 0; i < wanted.length; i++) {
      const w = wanted[i]
      const cell = row[i] != null ? String(row[i]).trim() : ''
      const wn = sanitizePddSpecWhitelist(w)
      if (cell !== w && cell !== wn && sanitizePddSpecWhitelist(cell) !== wn) {
        allMatch = false
        break
      }
    }
    if (allMatch) {
      const rec = normalizeSkuPriceRecord(skuPrice[id])
      if (rec) return rec
    }
  }
  return null
}

/** 合并单规格匹配（@138522：四种分隔符拼接 + 双维匹配） */
export function findTwoDimPriceByCombinedSingleSpec(detail: GoodsDetail, specText: string): any | null {
  if (!specText || typeof specText !== 'string') return null
  const r = specText.trim()
  if (!r) return null
  const skuPrice = detail.sku_price || {}
  const skuKey = detail.sku_key || {}
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  const key = cleanSkuMatchKey(r)
  for (const id of ids) {
    const row = skuKey[id]
    if (!Array.isArray(row) || row.length < 2) continue
    const d1 = String(row[0] || '').trim()
    const d2 = String(row[1] || '').trim()
    if (!d1 || !d2) continue
    const combos = [
      cleanSkuMatchKey(`${d1} ${d2}`),
      cleanSkuMatchKey(`${d1}/${d2}`),
      cleanSkuMatchKey(`${d1}；${d2}`),
      cleanSkuMatchKey(`${d1},${d2}`),
    ].filter(Boolean)
    if (combos.some(c => c && c === key)) return normalizeSkuPriceRecord(skuPrice[id])
    if (dimMatchSkuToSpec(d1, r) && dimMatchSkuToSpec(d2, r)) return normalizeSkuPriceRecord(skuPrice[id])
  }
  return null
}

/** 首维序数匹配（@139256） */
export function findTwoDimPriceByFirstDimOrdinal(
  detail: GoodsDetail,
  specText: string,
  ctx: { perSpec1: Map<string, number> },
): any | null {
  if (!specText || typeof specText !== 'string' || !ctx?.perSpec1) return null
  const skuKey = detail.sku_key || {}
  const skuPrice = detail.sku_price || {}
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  const order = new Map<string, number>()
  ids.forEach((e, i) => order.set(e, i))
  const key = cleanSkuMatchKey(specText)
  const exact: string[] = []
  const fuzzy: string[] = []
  for (const id of ids) {
    const row = skuKey[id]
    if (!Array.isArray(row) || row.length < 2) continue
    const d1 = cleanSkuMatchKey(row[0])
    if (key && d1 && d1 === key) exact.push(id)
    else if (dimMatchSkuToSpec(row[0], specText)) fuzzy.push(id)
  }
  const pool = exact.length ? exact : fuzzy
  if (!pool.length) return null
  pool.sort((a, b) => (order.get(a) || 0) - (order.get(b) || 0))
  if (pool.length === 1) return normalizeSkuPriceRecord(skuPrice[pool[0]])
  const d = key || cleanSkuMatchKey(specText)
  const used = ctx.perSpec1.get(d) || 0
  ctx.perSpec1.set(d, used + 1)
  return used < pool.length ? normalizeSkuPriceRecord(skuPrice[pool[used]]) : null
}

/** 无序矩阵匹配（@124570：正反双向） */
export function findTwoDimPriceFromSkuMatrixUnordered(detail: GoodsDetail, specTexts: string[]): any | null {
  const skuPrice = detail.sku_price || {}
  const skuKey = detail.sku_key || {}
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  const d1 = specTexts[0] || ''
  const d2 = specTexts[1] || ''
  if (!d1 || !d2) return null
  for (const id of ids) {
    const row = skuKey[id]
    if (!Array.isArray(row) || row.length < 2) continue
    const a = row[0]
    const b = row[1]
    const forward = dimMatchSkuToSpec(a, d1) && dimMatchSkuToSpec(b, d2)
    const reverse = dimMatchSkuToSpec(a, d2) && dimMatchSkuToSpec(b, d1)
    if (!forward && !reverse) continue
    const price = skuPrice[id]
    if (price !== undefined && price !== null) {
      return typeof price === 'object' && price !== null ? price : { price }
    }
  }
  return null
}

/** 模糊价格叶子（@140721） */
export function fuzzyMatchPriceDetailLeafOnly(
  table: Record<string, any>,
  spec1: string,
  spec2: string,
): any | null {
  if (!table || typeof table !== 'object') return null
  for (const k of Object.keys(table)) {
    const kn = cleanSpecName(k)
    if (!(kn === spec2 || kn === spec1 || k.includes(spec1) || spec1.includes(k)
      || kn.includes(spec2) || spec2.includes(kn))) continue
    const v = table[k]
    if (isSkuPriceLeaf(v)) return v
    const leaf = pickSingleNestedPriceLeaf(v)
    if (leaf) return leaf
  }
  return null
}

/** 模糊键匹配（@264181） */
export function fuzzyMatchKey(keys: string[], spec1: string, spec2: string): string | null {
  if (keys.includes(spec1)) return spec1
  if (keys.includes(spec2)) return spec2
  for (const k of keys) {
    const kn = cleanSpecName(k)
    if (kn === spec2 || kn === spec1) return k
  }
  for (const k of keys) {
    const kn = cleanSpecName(k)
    if (k.includes(spec1) || spec1.includes(k) || kn.includes(spec2) || spec2.includes(kn)) return k
  }
  return null
}

/** 多键交叉模糊匹配（@263532） */
export function findPriceDataForSkuFuzzy(
  table: Record<string, any>,
  raw1: string,
  raw2: string,
  clean1: string,
  clean2: string,
  skuSort: string[] = [],
): any | null {
  // 原版：if(s.length<=1||!r) —— s=skuSort.length<=1（一维表）或 r=raw2 为空 → leaf 分支
  if (skuSort.length <= 1 || !raw2) {
    let v = table[raw1]
    if (isSkuPriceLeaf(v)) return v
    let leaf = pickSingleNestedPriceLeaf(v)
    if (leaf) return leaf
    v = table[clean1] // 原版查 e[i]（clean1），非 raw2
    if (isSkuPriceLeaf(v)) return v
    leaf = pickSingleNestedPriceLeaf(v)
    return leaf || fuzzyMatchPriceDetailLeafOnly(table, raw1, clean1)
  }
  // 原版顺序：e[t]/e[i]/e[r]/e[n] 四块（raw1/clean1/raw2/clean2 前缀），各查两个键
  if (table[raw1] && typeof table[raw1] === 'object') {
    if (table[raw1][raw2]) return table[raw1][raw2]
    if (table[raw1][clean2]) return table[raw1][clean2]
  }
  if (table[clean1] && typeof table[clean1] === 'object') {
    if (table[clean1][raw2]) return table[clean1][raw2]
    if (table[clean1][clean2]) return table[clean1][clean2]
  }
  if (table[raw2] && typeof table[raw2] === 'object') {
    if (table[raw2][raw1]) return table[raw2][raw1]
    if (table[raw2][clean1]) return table[raw2][clean1]
  }
  if (table[clean2] && typeof table[clean2] === 'object') {
    if (table[clean2][raw1]) return table[clean2][raw1]
    if (table[clean2][clean1]) return table[clean2][clean1]
  }
  // 原版：fuzzyMatchKey(keys, t, i) —— 外层第 2/3 参是 raw1/clean1
  const k1 = fuzzyMatchKey(Object.keys(table), raw1, clean1)
  if (k1 && table[k1] && typeof table[k1] === 'object') {
    const k2 = fuzzyMatchKey(Object.keys(table[k1]), raw2, clean2)
    if (k2) return table[k1][k2]
  }
  return null
}

/** 多维 SKU 匹配（@261934） */
export function findPriceDataForMultiDimensionalSku(
  skuPrice: Record<string, any>,
  skuKey: Record<string, string[]>,
  specTexts: string[],
): { priceData: any; matchedKey: string } | null {
  const clean = specTexts.map(e => cleanSpecName(e))
  for (const [id, row] of Object.entries(skuKey)) {
    if (!Array.isArray(row) || row.length !== specTexts.length) continue
    let all = true
    for (let i = 0; i < row.length; i++) {
      const cellRaw = row[i]
      const cellClean = cleanSpecName(cellRaw)
      const want = specTexts[i]
      const wantClean = clean[i]
      const ok = cellRaw === want || cellClean === want
        || cellRaw === wantClean || cellClean === wantClean
        || fuzzyMatch(cellRaw, want) || fuzzyMatch(cellClean, wantClean)
      if (!ok) { all = false; break }
    }
    if (all) {
      return { priceData: skuPrice[id], matchedKey: id }
    }
  }
  return null
}

/** 单 SKU 兜底（@261640：有价格记录的键恰为 1 个时） */
export function resolveSingleSkuPriceFallback(detail: GoodsDetail): { priceData: any; skuId: string } | null {
  const skuKey = detail.sku_key || {}
  const skuPrice = detail.sku_price || {}
  const ids = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  const priced = ids.filter(e => normalizeSkuPriceRecord(skuPrice[e]))
  if (priced.length !== 1) return null
  const id = priced[0]
  const rec = normalizeSkuPriceRecord(skuPrice[id])
  return rec ? { priceData: rec, skuId: id } : null
}

/* ───────────────────────── 商家编码（纯函数） ───────────────────────── */

/** 中英文加权长度（@114693） */
function getChineseEnglishLength(v: unknown): number {
  if (v == null) return 0
  const s = String(v)
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 127 ? 2 : 1
  return n
}

/** 加权截断（@114693：返回 {value, rawWeighted, cutWeighted, truncated}） */
function truncateByChineseEnglishLength(v: unknown, limit = PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN): { value: string; rawWeighted: number; cutWeighted: number; truncated: boolean } {
  const max = Math.max(0, Number(limit) || 0)
  const s = v == null ? '' : String(v)
  const rawLen = getChineseEnglishLength(s)
  if (!s || rawLen <= max) return { value: s, rawWeighted: rawLen, cutWeighted: rawLen, truncated: false }
  let cut = s
  const stepCap = s.length + 2
  let steps = 0
  while (getChineseEnglishLength(cut) > max && cut.length > 0 && steps < stepCap) {
    cut = cut.slice(0, -1)
    steps++
  }
  const cutLen = getChineseEnglishLength(cut)
  if (cutLen > max) throw new Error(`weighted truncate failed: cutWeighted=${cutLen} still > limit=${max}, steps=${steps}`)
  return { value: cut, rawWeighted: rawLen, cutWeighted: cutLen, truncated: true }
}

/** 商家编码安全生成（resolveSafePddOutGoodsSn_def @115234） */
export function resolveSafePddOutGoodsSn(detail: GoodsDetail, mc: MovingConfig): string {
  const radio = String(mc?.productCode_radio != null && mc.productCode_radio !== ''
    ? mc.productCode_radio
    : detail?.productCode_radio ?? '1')
  const goodsId = String(detail?.goods_id || detail?.productId || '').trim()
  let value = ''
  if (radio === '2') value = String(detail?.goods_id || detail?.productId || '').trim()
  else if (radio === '3') value = String(detail?.base_attr?.['货号'] || '').trim()
  else if (radio === '4') value = String(detail?.goods_url || detail?.productUrl || '').trim()
  else return ''
  if (!value) return ''
  try {
    const t = truncateByChineseEnglishLength(value, PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN)
    if (!t.value) {
      if (goodsId) {
        return truncateByChineseEnglishLength(goodsId, PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN).value
      }
      return ''
    }
    return t.value
  } catch {
    if (goodsId) {
      try {
        return truncateByChineseEnglishLength(goodsId, PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN).value
      } catch { return '' }
    }
    return ''
  }
}

/* ───────────────────────── 无规格填价（纯函数） ───────────────────────── */

/** 无规格价格记录（@65276：price_detail.default → sku_price.default → price） */
export function resolveNoSpecPriceRecord(detail: GoodsDetail): any | null {
  if (!detail) return null
  const pd = detail.price_detail?.default
  if (pd != null) return typeof pd === 'object' ? { ...(pd as any) } : { price: pd }
  const sp = detail.sku_price?.default
  if (sp != null) return typeof sp === 'object' ? { ...(sp as any) } : { price: sp }
  if (detail.price != null && detail.price !== '') return { price: detail.price }
  return null
}

/** 无规格库存（@64619） */
export function resolveNoSpecStock(detail: GoodsDetail): number {
  if (!detail) return 999
  const mc = (detail.movingConfig || {}) as MovingConfig
  const mode = Number(mc.stock_mode ?? detail.stock_mode ?? 1)
  if (mode === 2) {
    const inv = mc.inventory ?? detail.inventory
    if (inv != null && inv !== '') {
      const n = parseInt(String(inv), 10)
      if (!isNaN(n)) return n
    }
    return 0
  }
  const skuStock = detail.sku_stock || {}
  const d = skuStock.default
  if (d != null) {
    if (typeof d === 'object') {
      const v = (d as any).stock ?? (d as any).quantity ?? (d as any).inventory
      if (v != null && v !== '') {
        const n = parseInt(String(v), 10)
        if (!isNaN(n)) return n
      }
    } else {
      const n = parseInt(String(d), 10)
      if (!isNaN(n)) return n
    }
  }
  const sp = detail.sku_price?.default
  if (sp && typeof sp === 'object') {
    const v = (sp as any).stock ?? (sp as any).quantity ?? (sp as any).inventory
    if (v != null && v !== '') {
      const n = parseInt(String(v), 10)
      if (!isNaN(n)) return n
    }
  }
  return 999
}

/** 无规格 SKU 填价（fillNoSpecSkuPriceDataInRequest_def @65538） */
export function fillNoSpecSkuPriceDataInRequest(
  commitBody: any,
  detail: GoodsDetail,
  skus: CommitSku[],
  singleBuyCfg: MovingConfig,
): void {
  const rec = resolveNoSpecPriceRecord(detail)
  if (!rec) return
  const stockMode = getPddStockMode(detail)
  const noSpecStock = resolveNoSpecStock(detail)
  const merged = { ...rec }
  if (stockMode === 2) merged.stock = noSpecStock
  else if (merged.stock == null || merged.stock === '') merged.stock = noSpecStock
  let maxTeam = 0
  let maxSingle = 0
  let filled = 0
  for (const sku of skus) {
    if (sku.spec && sku.spec.length > 0) continue
    const team = extractPrice(merged)
    const [teamFen, teamYuan] = priceToFenAndYuan(team)
    const single = computePddSingleBuyYuan(team, singleBuyCfg)
    const [singleFen, singleYuan] = priceToFenAndYuan(single)
    sku.multi_price = teamFen
    sku.multi_price_in_yuan = teamYuan
    sku.price = singleFen
    sku.price_in_yuan = singleYuan
    const stock = resolveSkuStockForFill(detail, merged, noSpecStock)
    applyResolvedStockToCommitSku(sku, stock)
    maxTeam = Math.max(maxTeam, team)
    maxSingle = Math.max(maxSingle, single)
    filled++
  }
  if (filled === 0 && skus.length > 0) {
    const sku = skus[0]
    const team = extractPrice(merged)
    const [teamFen, teamYuan] = priceToFenAndYuan(team)
    const single = computePddSingleBuyYuan(team, singleBuyCfg)
    const [singleFen, singleYuan] = priceToFenAndYuan(single)
    sku.multi_price = teamFen
    sku.multi_price_in_yuan = teamYuan
    sku.price = singleFen
    sku.price_in_yuan = singleYuan
    const stock = resolveSkuStockForFill(detail, merged, noSpecStock)
    applyResolvedStockToCommitSku(sku, stock)
    maxTeam = Math.max(maxTeam, team)
    maxSingle = Math.max(maxSingle, single)
  }
  applyPddMarketReferencePrice(commitBody, maxTeam, maxSingle)
}

/* ───────────────────────── 四步流水线（transformRequestBody 纯函数移植） ───────────────────────── */

/** 第 1 步：图片/视频整组替换（transformRequestBody_def @18） */
export function fillImageData(commitBody: any, detail: GoodsDetail): void {
  if (!detail) return
  if (detail.gallery && detail.gallery.length > 0) {
    commitBody.gallery = detail.gallery
  }
  if (detail.floor_list && detail.floor_list.length > 0) commitBody.decorationDetail = detail.floor_list
  if (detail.preview_url) commitBody.decorationPreview = detail.preview_url
  if (detail.video_upload && detail.video_upload.check_comment === '通过') {
    const v = detail.video_upload
    const carousel = [v]
    const gallery = commitBody.gallery || []
    const videoItem = {
      file_id: v.id,
      height: v?.extra_info?.height,
      type: 6,
      url: v?.extra_info?.video_cover_url,
      video_url: v.url,
      width: v?.extra_info?.width,
    }
    gallery.push(videoItem)
    commitBody.gallery = gallery
    commitBody.carousel_video = carousel
  }
}

/* ───────────────────────── SKU 图 thumb 链（m_042_8087 原文移植） ─────────────────────────
 * _applyPddSkuThumbUrlToCommitSku 全链：主循环每 SKU 无条件调用（@260226 调用点），
 * 开头无条件清空 thumb_url/thumb_url_file_id，命中搜索图映射则回填。
 * 纯函数，仅依赖 cleanSkuMatchKey/cleanSpecName/canonicalizePddSpecValue 底座。
 */

/** 尺码值判定（_isPddLikelySizeSpecValue） */
function isPddLikelySizeSpecValue(v: unknown): boolean {
  const t = String(v ?? '').trim()
  if (!t) return false
  if (/^\d+(\.\d+)?\s*(cm|CM|厘米|码)?$/i.test(t)) return true
  return /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|均码|均|FREE|Free)$/i.test(t)
}

/** 尺码 token 归一（_normalizePddSizeSpecToken） */
function normalizePddSizeSpecToken(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, '').replace(/(cm|厘米)$/i, '').toUpperCase()
}

/** 尺码前导码提取（_extractPddLeadingSizeCodeForThumb） */
function extractPddLeadingSizeCodeForThumb(v: unknown): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  const m1 = t.match(/^(XXS|XXXL|XXL|XS|XL|3XL|4XL|2XL|S|M|L|均码|均|FREE)(?![A-Za-z])/i)
  if (m1) return normalizePddSizeSpecToken(m1[1])
  const m2 = t.match(/^(\d+(?:\.\d+)?)(?:\s*(cm|CM|厘米|码))?(?![0-9])/i)
  return m2 ? normalizePddSizeSpecToken(`${m2[1]}${m2[2] || ''}`) : ''
}

/** 尺码值匹配（_matchPddSizeSpecValueForThumb） */
function matchPddSizeSpecValueForThumb(a: unknown, b: unknown): boolean {
  const r = String(a ?? '').trim()
  const i = String(b ?? '').trim()
  if (!r || !i) return false
  if (r === i) return true
  const kr = cleanSkuMatchKey(r)
  const ki = cleanSkuMatchKey(i)
  if (kr && ki && kr === ki) return true
  const nr = normalizePddSizeSpecToken(r)
  const ni = normalizePddSizeSpecToken(i)
  if (nr && ni && nr === ni) return true
  const lr = isPddLikelySizeSpecValue(r)
  const li = isPddLikelySizeSpecValue(i)
  if (!lr && !li) return false
  const cr = extractPddLeadingSizeCodeForThumb(r)
  const ci = extractPddLeadingSizeCodeForThumb(i)
  return !(!cr || !ci || cr !== ci)
}

/** 颜色类规格名判定（isColorLikeSpecTypeName） */
function isColorLikeSpecTypeName(v: unknown): boolean {
  return !!v && /颜色|色号|分类|款式|花色/.test(String(v))
}

/** 尺码维度判定（_isPddThumbSizeDimension） */
function isPddThumbSizeDimension(dimName: unknown, v1: unknown, v2: unknown): boolean {
  const i = String(dimName ?? '')
  if (/尺码|尺寸|身高|裤长|衣长|鞋码|码数|size/i.test(i)) return true
  return !isColorLikeSpecTypeName(i) && (isPddLikelySizeSpecValue(v1) || isPddLikelySizeSpecValue(v2))
}

/** 可用 skuId 判定（_isPddUsableSkuId） */
function isPddUsableSkuId(v: unknown): boolean {
  return v != null && String(v).trim() !== '' && String(v) !== '0'
}

/** skuList 行查找（_findPddSkuListRowByKeyPathOrSkuId） */
function findPddSkuListRowByKeyPathOrSkuId(
  skuList: unknown,
  keyPathOrSkuId: unknown,
  opts: { logTag?: string } = {},
): { row: any; via: string } {
  const list = Array.isArray(skuList) ? skuList : []
  const n = keyPathOrSkuId != null ? String(keyPathOrSkuId).trim() : ''
  if (!n) return { row: null, via: 'none' }
  for (let o = 0; o < list.length; o++) {
    const e = list[o]
    if (e && (e.keyPath != null && String(e.keyPath) === n)) return { row: e, via: 'keyPath' }
  }
  for (let o = 0; o < list.length; o++) {
    const e = list[o]
    if (e && isPddUsableSkuId(e.skuId) && String(e.skuId) === n) return { row: e, via: 'skuId' }
  }
  return { row: null, via: 'none' }
}

/** 规格行匹配打分（_scorePddThumbSpecRowMatch） */
function scorePddThumbSpecRowMatch(
  input: string[],
  row: string[],
  skuSort: string[],
): { ok: boolean; score: number; usedInclude: boolean; detail: string } | null {
  if (!input?.length || !row?.length || input.length !== row.length) return null
  let score = 0
  let usedInclude = false
  const parts: string[] = []
  for (let o = 0; o < input.length; o++) {
    const a = String(input[o] ?? '').trim()
    const l = String(row[o] ?? '').trim()
    if (!a || !l) return null
    const dimName = Array.isArray(skuSort) ? String(skuSort[o] || '') : ''
    if (isPddThumbSizeDimension(dimName, a, l)) {
      if (!matchPddSizeSpecValueForThumb(a, l)) return null
      const shortLong = (isPddLikelySizeSpecValue(a) && !isPddLikelySizeSpecValue(l))
        || (!isPddLikelySizeSpecValue(a) && isPddLikelySizeSpecValue(l))
      score += 5e4
      parts.push(shortLong ? `size[${o}]=short_long` : `size[${o}]=ok`)
      continue
    }
    if (matchPddSpecValueStrictForThumb(a, l)) {
      score += 1e5 + l.length
      parts.push(`strict[${o}]`)
      continue
    }
    const ka = cleanSkuMatchKey(a) || cleanSpecName(a) || a
    const kl = cleanSkuMatchKey(l) || cleanSpecName(l) || l
    if (a.includes(l) || ka.includes(kl)) {
      score += 1e3 + l.length
      usedInclude = true
      parts.push(`fwd[${o}] len=${l.length}`)
    } else {
      if (!l.includes(a) && !kl.includes(ka)) return null
      score += 500 - Math.min(l.length, 499)
      usedInclude = true
      parts.push(`rev[${o}] len=${l.length}`)
    }
  }
  return { ok: true, score, usedInclude, detail: parts.join(',') }
}

/** 严格规格值匹配（_matchPddSpecValueStrictForThumb） */
function matchPddSpecValueStrictForThumb(a: unknown, b: unknown): boolean {
  const r = String(a ?? '').trim()
  const i = String(b ?? '').trim()
  if (!r || !i) return false
  if (r === i) return true
  const kr = cleanSkuMatchKey(r)
  const ki = cleanSkuMatchKey(i)
  if (kr && ki && kr === ki) return true
  const cr = cleanSpecName(r)
  const ci = cleanSpecName(i)
  return !(!cr || !ci || cr !== ci)
}

/** 最优规格候选（_pickBestPddSpecCandidateForThumb） */
function pickBestPddSpecCandidateForThumb(
  input: unknown,
  candidates: unknown,
  _opts: { logTag?: string } = {},
): { value: string; level: string; score: number } | null {
  const i = String(input ?? '').trim()
  if (!i) return null
  const arr: string[] = []
  const seen = new Set<string>()
  for (const u of (candidates as unknown[]) || []) {
    const e = String(u ?? '').trim()
    if (e && !seen.has(e)) { seen.add(e); arr.push(e) }
  }
  if (!arr.length) return null
  if (isPddLikelySizeSpecValue(i)) {
    const hits = arr.filter(e => matchPddSizeSpecValueForThumb(i, e))
    if (hits.length === 1) {
      const t = !isPddLikelySizeSpecValue(hits[0])
      return { value: hits[0], level: t ? 'size_short_long' : 'size', score: 1e9 + hits[0].length }
    }
    return null
  }
  const strict = arr.filter(e => matchPddSpecValueStrictForThumb(i, e))
  if (strict.length === 1) return { value: strict[0], level: 'strict', score: 1e9 + strict[0].length }
  if (strict.length > 1) return null
  const ki = cleanSkuMatchKey(i) || cleanSpecName(i) || i
  const fwd: { value: string; len: number }[] = []
  for (const u of arr) {
    const k = cleanSkuMatchKey(u) || cleanSpecName(u) || u
    if (k && ((i.includes(u) || ki.includes(k)))) fwd.push({ value: u, len: u.length })
  }
  if (fwd.length) {
    fwd.sort((a, b) => b.len - a.len)
    const top = fwd[0].len
    const ties = fwd.filter(t => t.len === top)
    return ties.length === 1 ? { value: ties[0].value, level: 'include_forward', score: 1e6 + top } : null
  }
  const rev: { value: string; len: number }[] = []
  for (const u of arr) {
    const k = cleanSkuMatchKey(u) || cleanSpecName(u) || u
    if (k && ((u.includes(i) || k.includes(ki)))) rev.push({ value: u, len: u.length })
  }
  if (rev.length) {
    rev.sort((a, b) => a.len - b.len)
    const top = rev[0].len
    const ties = rev.filter(t => t.len === top)
    return ties.length === 1 ? { value: ties[0].value, level: 'include_reverse', score: 1e5 - top } : null
  }
  return null
}

/** 唯一最优打分 id（_pickUniqueBestThumbScoredId） */
function pickUniqueBestThumbScoredId(
  entries: { id: string; score: number; usedInclude?: boolean }[],
  _logTag: string,
): string | null {
  if (!entries?.length) return null
  const strict = entries.filter(e => !e.usedInclude)
  const pool = strict.length ? strict : entries
  pool.sort((a, b) => b.score - a.score)
  const top = pool[0].score
  const ties = pool.filter(e => e.score === top)
  return ties.length === 1 ? String(ties[0].id) : null
}

/** 规格图维度索引（_resolvePddSpecImageDimIndex；结果缓存到 detail._pdd_spec_image_dim_index） */
function resolvePddSpecImageDimIndex(detail: any): number {
  const skuSort = detail.sku_sort || []
  // ★ 觅千手原文用 detail.sku_img；我们的组装层（buildGoodsDetailFromProduct +
  //   pdd-publish 段1.5 预上传回填）用的是 detail.upload_spec_img_map
  //   （key=规格值名 → {url, id}）。两者取并集，否则 dimIdx 恒为 -1，
  //   SKU 预览图（thumb_url）永远填不上。
  const skuImg = { ...(detail.sku_img || {}), ...(detail.upload_spec_img_map || {}) }
  const skuKey = detail.sku_key || {}
  const imgKeys = Object.keys(skuImg).filter(e => (skuImg as any)[e])
  if (!imgKeys.length || !skuSort.length) { detail._pdd_spec_image_dim_index = -1; return -1 }
  const preferRe = /颜色|色号|款式|图案|规格/
  let best = -1
  let bestScore = 0
  let bestPrefer = false
  for (let u = 0; u < skuSort.length; u++) {
    const values = new Set<string>()
    const keyIds = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
    for (const k of keyIds) {
      const row = (skuKey as any)[k]
      if (!Array.isArray(row) || row[u] == null) continue
      const n = String(row[u]).trim()
      if (n) { values.add(n); values.add(cleanSpecName(n)) }
    }
    let hit = 0
    for (const e of imgKeys) {
      const t = cleanSpecName(e)
      const i = String(e).trim()
      let matched = false
      for (const v of values) {
        if (v && (v === i || v === t || v.includes(t) || t.includes(v) || i.includes(v) || v.includes(i))) { matched = true; break }
      }
      if (matched) hit++
    }
    const dimName = String(skuSort[u] || '')
    const prefer = preferRe.test(dimName)
    const take = hit > bestScore
      || (hit === bestScore && hit > 0 && prefer && !bestPrefer)
      || (hit === bestScore && hit > 0 && prefer === bestPrefer && best > u)
    if (take) { bestScore = hit; best = u; bestPrefer = prefer }
  }
  if (bestScore <= 0) best = -1
  detail._pdd_spec_image_dim_index = best
  return best
}

/** keyPath→skuId 桥接（_bridgePddSearchSkuIdFromKeyPath） */
function bridgePddSearchSkuIdFromKeyPath(detail: any, keyPath: unknown): string | null {
  if (keyPath == null || String(keyPath).trim() === '') return null
  const r = String(keyPath)
  const direct = (detail.sku_stock?.[r] as any)?.skuId
  if (isPddUsableSkuId(direct)) return String(direct)
  const list = Array.isArray(detail.skuList) ? detail.skuList : []
  const hit = findPddSkuListRowByKeyPathOrSkuId(list, r)
  if (hit.row && isPddUsableSkuId(hit.row.skuId)) return String(hit.row.skuId)
  return null
}

/** skuList 侧 skuId 解析（_resolvePddSearchSkuIdFromSkuListForThumb） */
function resolvePddSearchSkuIdFromSkuListForThumb(detail: any, specTexts: string[]): string | null {
  const input = (specTexts || []).map(e => String(e || '').trim()).filter(Boolean)
  if (!input.length) return null
  const list = Array.isArray(detail.skuList) ? detail.skuList : []
  const skuSort = detail.sku_sort || []
  const scored: { id: string; score: number; usedInclude?: boolean }[] = []
  for (const row of list) {
    const e = row?.skuId
    if (e == null || String(e).trim() === '' || String(e) === '0') continue
    const pairs = row.specMapping && typeof row.specMapping === 'object'
      ? Object.entries(row.specMapping).map(([k, v]) => [String(k || ''), String(v || '').trim()])
      : []
    const values = pairs.map(([, v]) => v).filter(Boolean)
    if (input.length !== 1) {
      if (input.length >= 2 && values.length >= 2) {
        let best: { score: number; usedInclude: boolean } | null = null
        for (let a = 0; a < values.length; a++) {
          for (let b = 0; b < values.length; b++) {
            if (a === b) continue
            const pair = [values[a], values[b]]
            const dims = [(pairs[a] as any)?.[0] || skuSort[0] || '', (pairs[b] as any)?.[0] || skuSort[1] || '']
            const c = scorePddThumbSpecRowMatch(input.slice(0, 2), pair, dims)
            if (c?.ok && (!best || c.score > best.score)) best = c
          }
        }
        if (best) scored.push({ id: String(e), score: best.score, usedInclude: best.usedInclude })
      }
    } else {
      const cands = [...values]
      if (row.skuName) cands.push(String(row.skuName).trim())
      const hit = pickBestPddSpecCandidateForThumb(input[0], cands, {})
      if (hit?.value) scored.push({ id: String(e), score: hit.score, usedInclude: hit.level !== 'strict', detail: `1d:${hit.level}` } as any)
    }
  }
  return pickUniqueBestThumbScoredId(scored as any, '')
}

/** keyPath 侧解析（_resolvePddSkuKeyPathForThumb） */
function resolvePddSkuKeyPathForThumb(detail: any, specTexts: string[]): string | null {
  const input = (specTexts || []).map(e => String(e || '').trim()).filter(Boolean)
  if (!input.length) return null
  const skuKey = detail.sku_key || {}
  const published = detail.pdd_published_spec_by_sku_id || {}
  const skuSort = detail.sku_sort || []
  const keyIds = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  if (!keyIds.length) return null
  const scored: { id: string; score: number; usedInclude?: boolean }[] = []
  for (const u of keyIds) {
    const pub = (published as any)[u]
    const key = (skuKey as any)[u]
    const row = Array.isArray(pub) && pub.length ? pub : Array.isArray(key) ? key : []
    if (!row.length) continue
    let a = scorePddThumbSpecRowMatch(input, row as string[], skuSort)
    if (!a && input.length === 2 && row.length === 2) {
      a = scorePddThumbSpecRowMatch(input, [row[1], row[0]], [skuSort[1], skuSort[0]])
    }
    if (a?.ok) scored.push({ id: String(u), score: a.score, usedInclude: a.usedInclude, detail: a.detail } as any)
  }
  if (!scored.length && input.length === 1) {
    const combined: string[] = []
    for (const r of keyIds) {
      const t = (skuKey as any)[r]
      if (Array.isArray(t)) {
        if (t.length === 1) combined.push(String(t[0] || '').trim())
        else if (t.length >= 2) {
          const d1 = String(t[0] || '').trim()
          const d2 = String(t[1] || '').trim()
          if (d1 && d2) combined.push(`${d1} ${d2}`, `${d1}/${d2}`, `${d1}；${d2}`)
        }
      }
    }
    const hit = pickBestPddSpecCandidateForThumb(input[0], combined, {})
    if (hit?.value) {
      for (const r of keyIds) {
        const e = (skuKey as any)[r]
        if (Array.isArray(e)) {
          if (e.length === 1 && matchPddSpecValueStrictForThumb(e[0], hit.value)) return String(r)
          if (e.length >= 2) {
            const combos = [`${e[0]} ${e[1]}`, `${e[0]}/${e[1]}`, `${e[0]}；${e[1]}`]
            if (combos.some(c => matchPddSpecValueStrictForThumb(c, hit.value))) return String(r)
          }
        }
      }
    }
  }
  const picked = pickUniqueBestThumbScoredId(scored as any, '')
  return picked
}

/** skuIdKey 总解析（_resolvePddSkuIdKeyForThumb） */
function resolvePddSkuIdKeyForThumb(
  detail: any,
  specTexts: string[],
): { skuIdKey: string | null; keyPath: string | null; missReason: string; matchVia: string } {
  const keyPath = resolvePddSkuKeyPathForThumb(detail, specTexts)
  if (keyPath) {
    const skuId = bridgePddSearchSkuIdFromKeyPath(detail, keyPath)
    if (skuId) return { skuIdKey: skuId, keyPath, missReason: '', matchVia: 'keyPath' }
    return { skuIdKey: null, keyPath, missReason: `keyPath=${keyPath} 无 skuId 桥接`, matchVia: 'keyPath_no_bridge' }
  }
  const fromList = resolvePddSearchSkuIdFromSkuListForThumb(detail, specTexts)
  if (fromList) return { skuIdKey: fromList, keyPath: null, missReason: '', matchVia: 'skuList' }
  return { skuIdKey: null, keyPath: null, missReason: '规格未匹配到 sku_key/skuList（thumb 安全匹配）', matchVia: 'none' }
}

/** spec 图映射回填（_resolvePddSpecThumbFromUploadMap） */
function resolvePddSpecThumbFromUploadMap(detail: any, specTexts: string[]): { url: string; id?: string; file_id?: string } | null {
  resolvePddSpecImageDimIndex(detail)
  const dimIdx = detail._pdd_spec_image_dim_index
  if (dimIdx < 0 || !specTexts?.length) return null
  const uploadSpecMap = detail.upload_spec_img_map || {}
  const skuKey = detail.sku_key || {}
  const skuSort = detail.sku_sort || []
  const values = new Set<string>()
  const keyIds = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
  for (const y of keyIds) {
    const row = (skuKey as any)[y]
    if (!Array.isArray(row) || row[dimIdx] == null) continue
    const t = String(row[dimIdx]).trim()
    if (t) { values.add(t); values.add(cleanSpecName(t)); values.add(canonicalizePddSpecValue(t)) }
  }
  const dimName = skuSort[dimIdx]
  const specDef = (detail.specList || []).find((e: any) => e.name === dimName)
  if (specDef?.values) {
    for (const y of specDef.values) {
      const e = y?.name != null ? y.name : y
      if (e == null || String(e).trim() === '') continue
      const t = String(e).trim()
      values.add(t)
      values.add(cleanSpecName(t))
    }
  }
  const all = [...values].filter(Boolean)
  const dimVal = dimIdx >= 0 && dimIdx < specTexts.length ? String(specTexts[dimIdx] || '').trim() : ''
  const ordered = dimVal
    ? [dimVal, ...specTexts.map(e => String(e || '').trim()).filter(e => e && e !== dimVal)]
    : specTexts.map(e => String(e || '').trim()).filter(Boolean)
  let matched: string | null = null
  for (const y of ordered) {
    const hit = pickBestPddSpecCandidateForThumb(y, all, {})
    if (hit?.value) {
      matched = y
      if (!(uploadSpecMap as any)[matched] && !(uploadSpecMap as any)[cleanSpecName(matched)] && (uploadSpecMap as any)[hit.value]) {
        matched = hit.value
      }
      break
    }
  }
  if (!matched) return null
  const g = cleanSpecName(matched)
  let rec: any = (uploadSpecMap as any)[matched] || (uploadSpecMap as any)[g] || null
  if (!rec?.url) {
    const keys = Object.keys(uploadSpecMap)
    const hit = pickBestPddSpecCandidateForThumb(matched, keys, {})
    if (hit?.value) rec = (uploadSpecMap as any)[hit.value] || null
  }
  return rec?.url ? rec : null
}

/** 搜索图上传开关（isSkuSearchImageUploadEnabled @6169） */
function isSkuSearchImageUploadEnabled(detail: any, _opts: { allowTmallLegacy?: boolean } = {}): boolean {
  const mc = detail?.movingConfig && typeof detail.movingConfig === 'object' ? detail.movingConfig : {}
  let v = mc.sku_search_img_upload_switch ?? detail.sku_search_img_upload_switch
    ?? mc.upload_sku_search_image ?? detail.upload_sku_search_image
  return coerceMovingConfigBool(v)
}

/** 配置布尔强制转换（_coerceMovingConfigBool） */
function coerceMovingConfigBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

/** 生效 SKU 图模式（_getEffectivePddSkuImageMode） */
function getEffectivePddSkuImageMode(detail: any): number {
  const mc = detail?.movingConfig || {}
  const raw = (mc as any).sku_image_mode ?? detail?.sku_image_mode ?? 1
  const n = Number(raw)
  return Number.isFinite(n) ? n : 1
}

export interface PddSkuThumbResult {
  ok: boolean
  skuIdKey?: string
  thumbUrl?: string
  matchVia?: string
  missReason?: string
}

/** 主入口：SKU 搜索图回填到 commit sku（_applyPddSkuThumbUrlToCommitSku @235568） */
export function applyPddSkuThumbUrlToCommitSku(
  detail: GoodsDetail,
  sku: CommitSku,
  specTexts: string[],
): PddSkuThumbResult {
  const searchEnabled = isSkuSearchImageUploadEnabled(detail)
  const mode = getEffectivePddSkuImageMode(detail)
  sku.thumb_url = ''
  sku.thumb_url_file_id = ''
  if (!searchEnabled && mode === 4) return { ok: false, missReason: 'mode4_no_search' }
  if (searchEnabled) {
    const r = resolvePddSkuIdKeyForThumb(detail, specTexts)
    const { skuIdKey, missReason, matchVia } = r
    const rec = skuIdKey ? (detail as any).upload_search_img_map?.[skuIdKey] : null
    if (rec?.url) {
      sku.thumb_url = rec.url
      sku.thumb_url_file_id = rec.id || rec.file_id || ''
      return { ok: true, skuIdKey: skuIdKey ?? undefined, thumbUrl: rec.url, matchVia }
    }
    if (skuIdKey) return { ok: false, skuIdKey, matchVia, missReason: 'map_miss' }
    return { ok: false, missReason: missReason || 'no_skuId', matchVia }
  }
  if (mode === 1) {
    const rec = resolvePddSpecThumbFromUploadMap(detail, specTexts)
    if (rec?.url) {
      sku.thumb_url = rec.url
      sku.thumb_url_file_id = rec.id || rec.file_id || ''
      return { ok: true, thumbUrl: rec.url, matchVia: 'spec_map' }
    }
    return { ok: false, missReason: 'spec_map_miss', matchVia: 'spec_map' }
  }
  return { ok: false, missReason: `no_strategy_mode_${mode}` }
}

/** 第 2 步：SKU 价格/库存（fillSkuPriceData_def @257371 完整移植） */
export function fillSkuPriceData(commitBody: any, detail: GoodsDetail): void {
  const skus = commitBody.skus
  const priceDetail = detail.price_detail
  const skuSort = detail.sku_sort || []
  const mc = (detail.movingConfig || {}) as MovingConfig
  const singleBuyCfg = {
    pdd_single_buy_rule_type: mc.pdd_single_buy_rule_type ?? (detail as any).pdd_single_buy_rule_type,
    pdd_single_buy_percent: mc.pdd_single_buy_percent ?? (detail as any).pdd_single_buy_percent,
    pdd_single_buy_fixed_yuan: mc.pdd_single_buy_fixed_yuan ?? (detail as any).pdd_single_buy_fixed_yuan,
  }
  const skuPrice = detail.sku_price || {}
  const skuKey = detail.sku_key || {}
  const isMultiDim = skuSort.length > 2
  const stableTable = !isMultiDim && Object.keys(skuKey).length > 0 ? buildStablePriceDetailForFill(detail) : null
  let table: Record<string, any> | null = null
  if (!isMultiDim) {
    if (stableTable && !isEmptyPriceDetailTable(stableTable)) table = stableTable
    else if (priceDetail && !isEmptyPriceDetailTable(priceDetail)) table = priceDetail
  }
  const stockMode = getPddStockMode(detail)
  let defaultStock: number
  if (stockMode === 2) {
    defaultStock = getPddCustomInventory(detail)
  } else {
    const inv = mc.inventory != null && mc.inventory !== '' ? mc.inventory : detail.inventory
    if (inv != null && inv !== '') {
      const n = parseInt(String(inv), 10)
      defaultStock = isNaN(n) ? 999 : n
    } else defaultStock = 999
  }
  if (!skus) return
  commitBody.out_goods_sn = resolveSafePddOutGoodsSn(detail, mc)
  if (skuSort.length === 0) {
    fillNoSpecSkuPriceDataInRequest(commitBody, detail, skus, singleBuyCfg)
    return
  }
  if (isMultiDim && Object.keys(skuPrice).length === 0) return
  const hasBoth = !isMultiDim && Object.keys(skuPrice).length > 0 && Object.keys(skuKey).length > 0
  if (!isMultiDim && !table && !hasBoth) return
  const singleFallback = resolveSingleSkuPriceFallback(detail)
  /**
   * ★ 行数重建（模式2 精简化核心）：
   *   跳过 DOM 建规格后，页面原生 body 只有 1 行空壳 SKU（spec 为空串/空数组），
   *   fillSkuPriceData 的匹配循环只会跳过它 —— 改包后仍是 1 行。
   *   这里在匹配前按 detail.sku_key 把 skus 数组重建成 N 行，
   *   每行带上 sku_sort 维度序的 spec（spec_value + spec_name + parent_id）。
   *   spec_id 由 detail.spec_id_map（外部规格池）提供；缺的留 0 由平台解析。
   */
  const expectedRows0 = Object.keys(skuKey).length
  const validSpecRows0 = skus.filter((s: any) => Array.isArray(s.spec) && s.spec.length > 0).length
  if (expectedRows0 > 0 && validSpecRows0 < expectedRows0) {
    const specIds = detail.spec_id_map || {}
    const dimNames0: string[] = skuSort
    const rebuilt0: any[] = []
    const keyIds0: string[] = detail.sku_key_list?.length ? detail.sku_key_list : Object.keys(skuKey)
    for (const kid of keyIds0) {
      const row = (skuKey as any)[kid]
      if (!Array.isArray(row)) continue
      const spec: any[] = []
      for (let d = 0; d < dimNames0.length; d++) {
        const val = row[d] != null ? String(row[d]).trim() : ''
        if (!val) continue
        let idRec = (specIds as any)[val] || {}
        if (!idRec.spec_id) {
          const stripCm = (s: unknown) => String(s || '').replace(/(cm|厘米)$/i, '').trim()
          const hit = Object.entries(specIds).find(([k]) => stripCm(k) === stripCm(val))
          if (hit) idRec = hit[1]
        }
        spec.push({
          spec_id: idRec.spec_id || 0,
          spec_value: val,
          parent_id: idRec.parent_id || 0,
          spec_name: dimNames0[d],
          note: null,
        })
      }
      if (!spec.length) continue
      rebuilt0.push({
        id: 0, limit_quantity: 0, out_sku_sn: '', is_onsale: 1,
        multi_price_in_yuan: '0', price_in_yuan: '0', multi_price: 0, price: 0,
        quantity_delta: 0, thumb_url: '', weight: 0, spec,
        oversea_sku: {}, sku_srv_templates: '', shipment_limit_second_list: [], sku69_code: '',
      })
    }
    if (rebuilt0.length > validSpecRows0) {
      commitBody.skus = rebuilt0
      skus.length = 0
      skus.push(...rebuilt0)
    }
  }
  const withSpec = skus.filter((s: any) => s.spec && s.spec.length > 0)
  const allRowCode = withSpec.length > 0
    && withSpec.every((s: any) => specTextsLookLikeRowCodePlaceholders(collectSpecTextsFromPddSku(s)))
  const orderedKeys = !isMultiDim && hasBoth ? getOrderedSkuKeyIdsWithPrice(detail) : []
  const rowCodeMode = !isMultiDim && hasBoth && allRowCode && orderedKeys.length > 0 && orderedKeys.length === withSpec.length
  let cursor = 0
  const ordinalCtx = { perSpec1: new Map<string, number>() }
  let maxTeam = 0
  let maxSingle = 0
  for (const sku of skus) {
    if (!sku.spec || sku.spec.length === 0) continue
    const texts = collectSpecTextsFromPddSku(sku)
    const raw1 = texts[0] || ''
    const raw2 = texts[1] || ''
    const clean1 = cleanSpecName(raw1)
    const clean2 = cleanSpecName(raw2)
    let priceData: any = null
    if (isMultiDim) {
      const hit = findPriceDataForMultiDimensionalSku(skuPrice, skuKey, texts)
      if (hit) priceData = hit.priceData
    } else if (rowCodeMode) {
      const id = orderedKeys[cursor++]
      priceData = normalizeSkuPriceRecord(skuPrice[id])
    } else {
      const firstId = Object.keys(skuKey)[0]
      const firstRow = firstId ? skuKey[firstId] : null
      const firstRowIs2Dim = Array.isArray(firstRow) && firstRow.length >= 2
      const combinedMode = texts.filter(Boolean).length === 1 && firstRowIs2Dim
      if (combinedMode && texts[0]) {
        priceData = findTwoDimPriceByCombinedSingleSpec(detail, texts[0])
      }
      if (!priceData && combinedMode && texts[0]) {
        priceData = findTwoDimPriceByFirstDimOrdinal(detail, texts[0], ordinalCtx)
      }
      priceData = priceData || findPriceDataByPublishedSpec(detail, texts)
      priceData = priceData || findPriceDataForSkuFuzzy(table || {}, raw1, raw2, clean1, clean2, skuSort)
      if (!priceData && hasBoth && texts.filter(Boolean).length >= 2 && firstRowIs2Dim) {
        priceData = findTwoDimPriceFromSkuMatrixUnordered(detail, texts)
      }
      if (!priceData && singleFallback) priceData = singleFallback.priceData
    }
    if (priceData) {
      const teamYuan = extractPrice(priceData)
      const [teamFen, teamYuanStr] = priceToFenAndYuan(teamYuan)
      const singleYuan = computePddSingleBuyYuan(teamYuan, singleBuyCfg)
      const [singleFen, singleYuanStr] = priceToFenAndYuan(singleYuan)
      sku.multi_price = teamFen
      sku.multi_price_in_yuan = teamYuanStr
      sku.price = singleFen
      sku.price_in_yuan = singleYuanStr
      const stock = resolveSkuStockForFill(detail, priceData, defaultStock)
      applyResolvedStockToCommitSku(sku, stock)
      maxTeam = Math.max(maxTeam, teamYuan)
      maxSingle = Math.max(maxSingle, singleYuan)
    } else {
      // 未匹配：清零 + 下架（证据 x.is_onsale=0 行）
      sku.is_onsale = 0
      delete (sku as any).quantity
      sku.quantity_delta = 0
      sku.multi_price = 0
      sku.multi_price_in_yuan = '0'
      sku.price = 0
      sku.price_in_yuan = '0'
    }
    // SKU 搜索图/规格图回填（原版 @114 调用点：if/else 之后、每 SKU 无条件）
    applyPddSkuThumbUrlToCommitSku(detail, sku, texts)
  }
  applyPddMarketReferencePrice(commitBody, maxTeam, maxSingle)
}

/** 第 3 步：运费/发货/两件折扣（fillShippingConfig_def @265416） */
export function fillShippingConfig(commitBody: any, detail: GoodsDetail): void {
  const mc = (detail.movingConfig || {}) as MovingConfig
  if (mc.template) {
    commitBody.cost_template_id = mc.template
    commitBody.is_default_template_id = 1
  }
  if (mc.selectTime) {
    const t = mc.selectTime
    let sec = 86400
    if (t === 'today' || t === '1' || t === '24h' || t === '2') sec = 86400
    else if (t === '48h' || t === '3') sec = 172800
    commitBody.shipment_limit_second = sec
  }
  const discountRaw = (detail as any)?.sku_multi_discount ?? mc?.sku_multi_discount
  let discount = typeof discountRaw === 'number' && !isNaN(discountRaw) ? discountRaw : 9.9
  if (discount < 5 || discount > 9.9) discount = 9.9
  commitBody.two_pieces_discount = Math.round(10 * discount)
}

/** 第 4 步：电子发货属性（applyPddElecGoodsAttributes_def @255100） */
export function applyPddElecGoodsAttributes(commitBody: any): void {
  const timeType = 3
  const daysTime = 15
  if (!commitBody || typeof commitBody !== 'object') return
  if (!Object.prototype.hasOwnProperty.call(commitBody, 'elec_goods_attributes')) return
  const attrs = (commitBody as any).elec_goods_attributes
  if (attrs == null) return
  if (typeof attrs !== 'object' || Array.isArray(attrs)) return
  attrs.time_type = timeType
  attrs.days_time = daysTime
}

/** 快照（_pddSummarizeEditBody，8087_summarizeEditBody_def @165410） */
export function summarizeEditBody(commitBody: any): EditBodySummary | { empty: true } {
  if (!commitBody || typeof commitBody !== 'object') return { empty: true }
  const gallery = Array.isArray(commitBody.gallery) ? commitBody.gallery : []
  const skus = Array.isArray(commitBody.skus) ? commitBody.skus : []
  let priced = 0
  for (let i = 0; i < skus.length; i++) {
    const s = skus[i] || {}
    if (Number((s as any).multi_price) > 0 || Number((s as any).price) > 0) priced++
  }
  return {
    type1: gallery.filter((e: any) => e && e.type === 1).length,
    type2: gallery.filter((e: any) => e && e.type === 2).length,
    skus: skus.length,
    skusPriced: priced,
    is_draft: commitBody.is_draft,
    goods_id: commitBody.goods_id,
    goods_commit_id: commitBody.goods_commit_id,
  }
}

/**
 * 四步流水线总入口（transformRequestBody_def @255805）。
 * ★ 纯函数：无 DOM / 无 localStorage，可在 Node 单测里直接跑（evidence 做 golden case）。
 */
export function transformRequestBody(commitBody: any, detail: GoodsDetail): any {
  const before = summarizeEditBody(commitBody)
  fillImageData(commitBody, detail)
  fillSkuPriceData(commitBody, detail)
  fillShippingConfig(commitBody, detail)
  applyPddElecGoodsAttributes(commitBody)
  const after = summarizeEditBody(commitBody)
  return {
    commitBody,
    before,
    after,
    skusPricedDelta: ((after as any).skusPriced || 0) - ((before as any).skusPriced || 0),
    // ★ 2026-10-21：行数增量（模式2 精简化后页面原生 body 只有 1 行空壳，
    //   改包替换成 N 行矩阵时 skusPricedDelta=0 但 skusCountDelta>0）。
    skusCountDelta: ((after as any).skus || 0) - ((before as any).skus || 0),
    type1Delta: ((after as any).type1 || 0) - ((before as any).type1 || 0),
  }
}

/* ───────────────────────── m4：goodsDetail 组装层（ProductData → GoodsDetail） ───────────────────────── */

/**
 * m4：把统一商品数据（ProductData，product-schema.ts）组装成引擎吃的 GoodsDetail。
 *
 * 七条映射规则（BLUEPRINT §8 字段映射总表，引擎消费模式逐一验证）：
 *   1. specs（≤2 维）→ sku_sort（维度名数组）
 *   2. skus → sku_key（顺序 id '1','2',… → 规格值数组，按 sku_sort 维度序取值）
 *            + sku_key_list + sku_price（id → {price, stock}；行缺项回落顶层 price/stock）
 *      ≤2 维时引擎 buildStablePriceDetailForFill 会自动生成稳定价格表，故无需另产 price_detail
 *   3. 无规格（specs/skus 皆空）→ price_detail.default = {price, stock}
 *      （引擎 resolveNoSpecPriceRecord 三级兜底的首键）
 *   4. product.stock → movingConfig.inventory（引擎 defaultStock 链 parseInt，缺省 999）
 *   5. itemNo → base_attr['货号'] + movingConfig.productCode_radio = 3
 *      （引擎 resolveSafePddOutGoodsSn radio='3' 取 base_attr['货号']；radio 缺省 '1' 返回空）
 *   6. extra.costTemplate 纯数字串 → movingConfig.template（模板 ID 直传，引擎
 *      fillShippingConfig 写 cost_template_id + is_default_template_id=1）；模板名（非数字）
 *      不设 template，交由模式1 UI 流程（pdd-publish 段 4-c fillShippingAndFreight，mode2 下仍执行）
 *      选模板后原生 body 携带真实 ID。
 *      extra.deliveryTime（1/2/3）→ movingConfig.selectTime（'today'/'24h'/'48h'，
 *      对齐 fillShippingConfig 的 86400/172800 映射）
 *   7. images → gallery（[{type:1, img_url}] 整组替换），detailImages 追加 {type:2, img_url}
 *
 * ★ 纯函数：无页面访问、无运行时依赖（ProductData 只出现在类型注解位，esbuild 擦除）；
 *   落在差分测试 eval 区段尾缝隙内，可被同一标记段提取 + eval 机制覆盖。
 */
export function buildGoodsDetailFromProduct(
  product: ProductData,
  extra?: { costTemplate?: string; deliveryTime?: number; specIds?: Record<string, { spec_id: number; parent_id: number }> },
): GoodsDetail {
  const p = product || ({} as ProductData)
  const dims = Array.isArray(p.specs) ? p.specs.filter(d => d && d.name && Array.isArray(d.values) && d.values.length > 0) : []
  const skuRows = Array.isArray(p.skus) ? p.skus.filter(s => s && s.specs && typeof s.specs === 'object') : []
  const hasSkuStructure = dims.length > 0 && skuRows.length > 0
  const detail: GoodsDetail = {}
  const mc: MovingConfig = {}

  // ── 规则 7：图片映射（gallery type1=主图 / type2=详情图，引擎 fillImageData 整组替换）──
  // 只放行 http(s) 绝对 URL：本地文件路径（如 e:\...\main_06.jpg）进 gallery 会
  // 整组覆盖掉页面上传后回填的拼多多 CDN url，提交报「图片url不能为空」。
  // 模式2 的图片来源以页面 UI 上传为准，非 http(s) 一律不进 detail.gallery。
  const isRemoteImg = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v)
  /**
   * gallery 元素字段照抄觅千手原文（m_042_8087 uploadAllImages 末尾）：
   *     u.push({ url: t.url, type: 1, file_id: t.id })   // 主图
   *     d.push({ url: t.url, type: 2, file_id: null })   // 详情图
   *
   * ★★ 字段必须是 `url` 不是 `img_url` —— 平台读 `gallery[].url`，
   *   写 `img_url` 会报「图片url不能为空」（实测踩过）。
   * ★ file_id 也要带上：queryFileDetail 返回的 id；主图必填，详情图可为 null。
   */
  const gallery: Array<{ url: string; type: number; file_id?: number | null }> = []
  for (const img of Array.isArray(p.images) ? p.images : []) {
    if (isRemoteImg(img)) gallery.push({ url: img, type: 1 })
  }
  for (const img of Array.isArray(p.detailImages) ? p.detailImages : []) {
    if (isRemoteImg(img)) gallery.push({ url: img, type: 2, file_id: null })
  }
  if (gallery.length > 0) detail.gallery = gallery
  // ★ 2026-10-21：标题入 detail —— 改包时强制写 goods_name/goods_desc，
  //   不依赖 DOM fillTitle 是否被 React 受理（实测偶发不被受理）。
  if (p.title != null && String(p.title).trim() !== '') detail.title = String(p.title).trim()

  // ── 规则 4：默认库存 → movingConfig.inventory ──
  if (p.stock != null && String(p.stock).trim() !== '') mc.inventory = String(p.stock)
  // 单买价缺省：拼单价 +20%（BLUEPRINT §10「觅千手调优过的风控安全值」；引擎
  // computePddSingleBuyYuan 在 rule_type≠2 且 percent 缺省时也按 20 算，此处显式写出
  // 防原生 body 里的 movingConfig 带了别的值覆盖引擎缺省）
  mc.pdd_single_buy_rule_type = 1
  mc.pdd_single_buy_percent = 20

  // ── 规则 5：货号 → base_attr['货号'] + productCode_radio=3 ──
  if (p.itemNo != null && String(p.itemNo).trim() !== '') {
    detail.base_attr = { ...(detail.base_attr || {}), '货号': String(p.itemNo) }
    mc.productCode_radio = 3
  }

  // ── 规则 6：运费模板 ID / 发货时效 ──
  const tpl = extra?.costTemplate != null ? String(extra.costTemplate).trim() : ''
  if (tpl && /^-?\d+$/.test(tpl)) mc.template = tpl
  const dt = extra?.deliveryTime
  if (dt === 1) mc.selectTime = 'today'
  else if (dt === 2) mc.selectTime = '24h'
  else if (dt === 3) mc.selectTime = '48h'

  // ── 规则 1/2/3：规格结构 ──
  // ★ 外部规格池（店铺历史商品采集的 规格值→spec_id 映射）灌入。
  //   pdd-publish 段1.5 之后可把 pool 塞进 extra.specIds；行数重建时用它写 spec_id。
  if (extra?.specIds && typeof extra.specIds === 'object') {
    detail.spec_id_map = extra.specIds
  }
  if (hasSkuStructure) {
    // 规则 1：维度名数组（sku_sort）
    detail.sku_sort = dims.map(d => String(d.name))

    // 规则 2：每行 SKU → 顺序 id 的 sku_key / sku_key_list / sku_price
    const skuKey: Record<string, string[]> = {}
    const skuKeyList: string[] = []
    const skuPrice: Record<string, { price?: string | number; stock?: string | number }> = {}
    let id = 0
    for (const row of skuRows) {
      id++
      const key = String(id)
      // 按 sku_sort 维度序取该行规格值（缺维度 → 空串占位，保持行对齐）
      const values = dims.map(d => {
        const v = row.specs?.[d.name]
        return v != null && String(v).trim() !== '' ? String(v).trim() : ''
      })
      // 该行至少要有一个维度值才算有效组合
      if (!values.some(v => v !== '')) { id--; continue }
      const price = row.price != null && String(row.price).trim() !== '' ? String(row.price) : (p.price != null ? String(p.price) : undefined)
      const stock = row.stock != null && String(row.stock).trim() !== '' ? String(row.stock) : (p.stock != null ? String(p.stock) : undefined)
      skuKey[key] = values
      skuKeyList.push(key)
      const rec: { price?: string | number; stock?: string | number } = {}
      if (price !== undefined) rec.price = price
      if (stock !== undefined) rec.stock = stock
      if (Object.keys(rec).length > 0) skuPrice[key] = rec
    }
    if (id > 0) {
      detail.sku_key = skuKey
      detail.sku_key_list = skuKeyList
      if (Object.keys(skuPrice).length > 0) detail.sku_price = skuPrice
    } else {
      // 全部行无效 → 按无规格处理（回落规则 3）
      delete detail.sku_sort
    }
  }

  // 规则 3：无规格 → price_detail.default（引擎 resolveNoSpecPriceRecord 首键）
  if (!hasSkuStructure || !detail.sku_key) {
    const defaultPrice = p.price != null && String(p.price).trim() !== '' ? String(p.price) : null
    if (defaultPrice != null) {
      const rec: { price: string; stock?: string } = { price: defaultPrice }
      if (p.stock != null && String(p.stock).trim() !== '') rec.stock = String(p.stock)
      detail.price_detail = { default: rec }
    }
  }

  // m5 增量验证的预期值：组装层知道该商品应定价多少条 SKU（有规格=有效行数，无规格=1）。
  // setupHijack 改包后若 after.skusPriced < expected_skus_priced → 判定丢行，拒绝发包。
  const expectedPriced = detail.sku_key ? Object.keys(detail.sku_key).length : (detail.price_detail ? 1 : 0)
  if (expectedPriced > 0) (detail as any).expected_skus_priced = expectedPriced

  if (Object.keys(mc).length > 0) detail.movingConfig = mc
  return detail
}

/* ───────────────────────── m1：Anti-Content 生成器（page.evaluate 版） ───────────────────────── */

/**
 * 在发布表单页主 world 里完成觅千手 m_062_8174 的破解注入（坍缩版）：
 *   等 webpackJsonp（50ms × 100 次）→ findWebpackRequire（chunk[3] 为 function）
 *   → fallback __webpack_require__ → fallback 模拟 require（直接执行 chunk[1]['fbeZ']）
 *   → window.sj = webpackRequire → window.getAntiContent 挂全局。
 *
 * ★ 与扩展版差异：puppeteer page.evaluate 直跑主 world，无需 script 标签 + localStorage
 *   双 world 回传（m_062_8174 里 a()/l()/c() 三层桥全部省掉）。
 * ★ 模块 id 'fbeZ' 失效时按 updateServerTime/messagePack 特征遍历 chunk[1] 重定位。
 */
const ANTI_INJECT_SRC = `(function() {
  function findWebpackRequire() {
    if (window.webpackJsonp && window.webpackJsonp.length > 0) {
      for (let i = 0; i < window.webpackJsonp.length; i++) {
        const chunk = window.webpackJsonp[i]
        if (chunk && chunk.length >= 4 && typeof chunk[3] === 'function') return chunk[3]
      }
    }
    return null
  }
  function makeFallbackRequire() {
    return function(moduleId) {
      if (moduleId === 'fbeZ' && window.webpackJsonp) {
        for (let i = 0; i < window.webpackJsonp.length; i++) {
          const chunk = window.webpackJsonp[i]
          if (chunk && chunk[1] && chunk[1]['fbeZ']) {
            const module = { exports: {} }
            chunk[1]['fbeZ'](module, module.exports, function() { return {} })
            return module.exports.default || module.exports
          }
        }
      }
      return null
    }
  }
  // 模块 id 失效兜底：按构造器特征（updateServerTime + messagePack）遍历所有 chunk 模块
  function reLocateAntiModule(webpackRequire) {
    if (!window.webpackJsonp) return null
    for (let i = 0; i < window.webpackJsonp.length; i++) {
      const chunk = window.webpackJsonp[i]
      if (!chunk || !chunk[1]) continue
      for (const id of Object.keys(chunk[1])) {
        try {
          const module = { exports: {} }
          chunk[1][id](module, module.exports, function() { return {} })
          const exp = module.exports.default || module.exports
          const candidate = typeof exp === 'function' ? exp
            : (exp && typeof exp === 'object' && typeof exp.default === 'function') ? exp.default : null
          if (!candidate) continue
          const proto = candidate.prototype || {}
          if (typeof proto.updateServerTime === 'function' && typeof proto.messagePack === 'function') return candidate
        } catch (e) { /* 模块依赖不全，跳过 */ }
      }
    }
    return null
  }
  function initPDDAntiContent() {
    let webpackRequire = findWebpackRequire()
    if (!webpackRequire) {
      if (typeof __webpack_require__ !== 'undefined') webpackRequire = __webpack_require__
      else webpackRequire = makeFallbackRequire()
    }
    window.sj = webpackRequire
    function getAntiContent() {
      let anti = null
      try { anti = window.sj('fbeZ') } catch (e) { anti = null }
      if (typeof anti !== 'function') {
        anti = reLocateAntiModule(webpackRequire)
        if (!anti) throw new Error('sj("fbeZ") 没有返回构造函数，特征重定位也失败')
      }
      const res = new anti()
      // ★ 2026-10-22：用校准后的服务器时间，不用本地时间。
      //   依据：拼多多官方风控 SDK（觅千手 source/safe/AesApp.js）的 mmsCMT.timeBaseline
      //   机制——本地 Date.now() 与服务端有偏差（实测 168ms），Anti-Content 的
      //   updateServerTime 必须传校准值，否则服务端校验时间戳会判异常。
      //   window.__PDD_SERVER_TIME_OFFSET__ 由 ensureServerTimeOffset() 预先算好。
      const offset = window.__PDD_SERVER_TIME_OFFSET__ || 0
      res.updateServerTime(new Date().getTime() + offset)
      return res.messagePack()
    }
    window.getAntiContent = getAntiContent
    window.__PDD_ANTICONTENT_INJECTED__ = true
    window.__PDD_INJECT_TIME__ = Date.now()
  }
  initPDDAntiContent()
  return {
    injected: !!window.getAntiContent,
    hasWebpackJsonp: !!(window.webpackJsonp && window.webpackJsonp.length),
  }
})()`

/**
 * ★ 2026-10-22 服务器时间校准（对齐拼多多官方 SDK 的 mmsCMT.timeBaseline）。
 *
 * 官方 SDK 行为：
 *   1. GET https://api.pinduoduo.com/api/server/_stm → { server_time }
 *   2. window.mmsCMT.timeBaseline = { serverTime, localTime }
 *   3. 之后「服务器时间」= Date.now() - localTime + serverTime
 *
 * 我们用「偏移量」更简单：offset = serverTime - localTime，
 * 之后校准时间 = Date.now() + offset。
 *
 * @returns 注入页面的脚本（把 offset 写到 window.__PDD_SERVER_TIME_OFFSET__）
 */
export const PDD_SERVER_TIME_OFFSET_SRC = `(async function() {
  if (typeof window.__PDD_SERVER_TIME_OFFSET__ === 'number') return window.__PDD_SERVER_TIME_OFFSET__
  window.__PDD_SERVER_TIME_OFFSET__ = 0
  try {
    var localBefore = Date.now()
    var resp = await fetch('https://api.pinduoduo.com/api/server/_stm', { credentials: 'include' })
    var j = await resp.json()
    var localAfter = Date.now()
    var st = j && j.server_time
    if (typeof st === 'number' && st > 0) {
      // 取请求中点时刻，抵消网络延迟
      var localMid = Math.floor((localBefore + localAfter) / 2)
      window.__PDD_SERVER_TIME_OFFSET__ = st - localMid
      window.__PDD_TIME_BASELINE__ = { serverTime: st, localTime: localMid }
    }
  } catch (e) {
    // 兜底 1：iOS Safari 场景（官方 SDK 的做法）——用响应头 Date
    try {
      var r2 = await fetch(location.href, { method: 'HEAD', credentials: 'include' })
      var d = r2.headers.get('Date')
      if (d) {
        var st2 = new Date(d).getTime()
        if (st2 > 0) window.__PDD_SERVER_TIME_OFFSET__ = st2 - Date.now()
      }
    } catch (e2) { /* 保持 0 */ }
  }
  return window.__PDD_SERVER_TIME_OFFSET__
})()`

/** 等 webpackJsonp 就绪再注入（waitForWebpack 50ms × 100） */
const ANTI_WAIT_SRC = `(function() {
  return new Promise((resolve) => {
    let retries = 0
    function check() {
      if (window.webpackJsonp && window.webpackJsonp.length > 0) { resolve(true); return }
      retries++
      if (retries >= 100) { resolve(false); return }
      setTimeout(check, 50)
    }
    check()
  })
})()`

/** 生成 Anti-Content 字符串（m_062_8174 c() 的坍缩版：直接调 window.getAntiContent） */
const ANTI_GET_SRC = `(function() {
  if (typeof window.getAntiContent !== 'function') return { ok: false, error: 'getAntiContent 函数不存在' }
  try {
    const s = window.getAntiContent()
    return (typeof s === 'string' && s.length > 0) ? { ok: true, data: s } : { ok: false, error: 'Anti-Content 生成失败或为空' }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
})()`

/**
 * m1：在表单页注入并生成 Anti-Content。
 * 幂等：已注入（__PDD_ANTICONTENT_INJECTED__）时跳过注入直接取。
 */
export async function ensureAntiContent(page: Page): Promise<{ ok: boolean; error?: string }> {
  // ★ 2026-10-22：先校准服务器时间（对齐官方 SDK 的 mmsCMT.timeBaseline）
  await page.evaluate(PDD_SERVER_TIME_OFFSET_SRC).catch(() => 0)
  const has = await page.evaluate(() =>
    (typeof (window as { getAntiContent?: unknown }).getAntiContent === 'function')).catch(() => false)
  if (has) return { ok: true }
  const webpackReady = await page.evaluate(ANTI_WAIT_SRC).catch(() => false)
  if (!webpackReady) {
    return { ok: false, error: 'webpackJsonp 加载超时（5s 内未出现 chunk）' }
  }
  const injected = await page.evaluate(ANTI_INJECT_SRC).catch((e: unknown) => ({
    injected: false,
    hasWebpackJsonp: false,
    error: e instanceof Error ? e.message : String(e),
  }))
  if (!injected?.injected) {
    return { ok: false, error: `Anti-Content 注入失败：${(injected as any)?.error || 'initPDDAntiContent 未挂上 getAntiContent'}` }
  }
  return { ok: true }
}

/** m1：生成一条 Anti-Content 字符串（注入后调用；失效可 force 重注） */
export async function getAntiContent(page: Page, opts?: { force?: boolean }): Promise<{ ok: boolean; data?: string; error?: string }> {
  if (opts?.force) {
    await page.evaluate(() => {
      window.__PDD_ANTICONTENT_INJECTED__ = false
      ;(window as any).getAntiContent = undefined
    }).catch(() => { /* 忽略 */ })
  }
  const ready = await ensureAntiContent(page)
  if (!ready.ok) return { ok: false, error: ready.error }
  const res = await page.evaluate(ANTI_GET_SRC).catch((e: unknown) => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  }))
  if (!res?.ok) return { ok: false, error: res?.error || 'Anti-Content 生成失败' }
  return { ok: true, data: res.data as string }
}

/** page.evaluate 里声明的全局（TS 声明合并用，运行时由注入脚本挂上） */
declare global {
  interface Window {
    webpackJsonp?: unknown[]
    sj?: (id: string) => unknown
    getAntiContent?: () => string
    __PDD_ANTICONTENT_INJECTED__?: boolean
    __PDD_INJECT_TIME__?: number
    __webpack_require__?: (id: string) => unknown
  }
}

/* ───────────────────────── m3：CDP 请求拦截器（DNR+webRequest 的坍缩版） ───────────────────────── */

/** 拦截器运行状态（每个 page 一份；对应 MV3 的 hijackFlags + processingTabIds） */
export interface HijackState {
  /** 是否需要劫持下一次 edit 提交（对应 needHijack；置 false 即放行正常提交） */
  needHijack: boolean
  /** 置 flag 时间戳（TTL 5 分钟，超时自动放行 —— 蓝本 §10「避免永远挡提交」） */
  timestamp: number
  goodsDetail: GoodsDetail | null
  /** 防重入：正在处理中（对应 processingTabIds） */
  processing: boolean
}

/** 劫持 flag TTL（蓝本 §2：PDD_HIJACK_FLAG_TTL_MS = 300_000） */
export const PDD_HIJACK_FLAG_TTL_MS = 300_000

/**
 * 页面内 fetch 重放（§5.1 `_pddPageSendModifiedEdit` 的 page.evaluate 版）。
 * ★ credentials:"include" 以页面身份带 cookie —— 模式2 的主通道。
 * 返回形态逐字对齐证据：{success,status?,result?,error_msg?,errorCode?,networkError?,authOrEnvError?,isBizFailure?}
 */
/**
 * ★ 2026-10-21 修复：必须用**真函数**传给 page.evaluate。
 *   原实现是字符串 IIFE —— puppeteer 把字符串当「函数体」包装成
 *   Function(...args, body) 调用，IIFE 的形参名丢失，函数内 urlStr/bodyObj/anti
 *   全为 undefined → fetch(undefined) → 返回 {} → 上层拿到空对象误判失败。
 */
const PAGE_SEND_SRC = async (urlStr: string, bodyObj: unknown, anti: string): Promise<HijackOutcome> => {
  try {
    const resp = await fetch(urlStr, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Anti-Content': anti || '' },
      body: JSON.stringify(bodyObj),
      credentials: 'include',
    })
    const text = await resp.text()
    if (!text || !String(text).trim()) {
      return { success: false, networkError: true, authOrEnvError: true, status: resp.status, error: '空 body', errorCode: 'PDD_SEND_NETWORK', via: 'page' }
    }
    let json: unknown = null
    try { json = JSON.parse(text) } catch (e) {
      return { success: false, networkError: true, authOrEnvError: true, status: resp.status, error: '非 JSON: ' + ((e as Error)?.message || String(e)), errorCode: 'PDD_SEND_NETWORK', via: 'page' }
    }
    if (resp.status === 401 || resp.status === 403) {
      const j = json as { error_msg?: string; errorMsg?: string } | null
      return { success: false, networkError: true, authOrEnvError: true, status: resp.status, error_msg: (j && (j.error_msg || j.errorMsg)) || '', result: json, errorCode: 'PDD_SEND_NETWORK', via: 'page' }
    }
    const j = json as { success?: boolean; error_msg?: string; errorMsg?: string } | null
    if (j && j.success === true) {
      return { success: true, status: resp.status, result: json, via: 'page' }
    }
    const errMsg = (j && (j.error_msg || j.errorMsg)) || '业务失败'
    return { success: false, isBizFailure: true, status: resp.status, error_msg: errMsg, result: json, errorCode: 'PDD_API_BIZ', via: 'page' }
  } catch (e) {
    return { success: false, networkError: true, authOrEnvError: true, error: (e as Error)?.message || String(e), errorCode: 'PDD_SEND_NETWORK', via: 'page' }
  }
}

/** 带超时的 Promise 包装（对应 transformRequestBodyWithTimeout / sendPagePddEditRequest 的 30s 预算） */
function withTimeout<T>(p: Promise<T>, ms: number, code: string, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(
      new Error(`${label} 超时（${ms}ms）`),
      { errorCode: code },
    )), ms)
    p.then(v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) })
  })
}

/** 兜底判定（§3.3 shouldUseProxyFallback，@61112 照抄） */
export function shouldUseProxyFallback(r: any): boolean {
  if (!r || r.success) return false
  if (r.networkError || r.authOrEnvError) return true
  const s = Number(r.status)
  return s === 401 || s === 403 || s >= 500
    || r.errorCode === PDD_ERROR_CODE.SEND_NETWORK
    || r.errorCode === PDD_ERROR_CODE.PROXY_FALLBACK_FAIL
    || (!r.isBizFailure && r.errorCode !== PDD_ERROR_CODE.API_BIZ)
}

/** 劫持失败负载（buildAbnormalFailPayload 形态） */
function buildAbnormalFailPayload(errorCode: string, detailMessage: string): HijackOutcome {
  return { success: false, errorCode, detailMessage, userMessage: '劫持改包失败（未发送原始请求）' }
}

/** 把错误对象转成 errorCode + message（webrequest_tail @64650 的 catch 分支语义） */
function pickTransformError(e: unknown): { code: string; message: string } {
  const err = e as { errorCode?: string; message?: string } | null
  const code = err?.errorCode
    || (String(err?.message || '').includes('超时') ? PDD_ERROR_CODE.TRANSFORM_TIMEOUT : PDD_ERROR_CODE.TRANSFORM_ERROR)
  return { code, message: err?.message || String(e) }
}

/** URL 是否为提交接口（蓝本 §10：前缀宽松匹配 goodsCommit/action/，后缀 edit） */
export function isPddEditRequestUrl(url: string): boolean {
  return typeof url === 'string' && url.includes('mms.pinduoduo.com/glide/mms/goodsCommit/action/edit')
}

/**
 * m3：给 page 挂拦截器 + 置劫持 flag。
 *
 * 蓝本对应关系（MV3 → CDP 坍缩，BLUEPRINT §3 末段）：
 *   - DNR block + webRequest 双层 → setRequestInterception(true) 一次拦，无「先摘 block 再放行」两段式
 *   - hijackFlags[tabId]          → 返回的 HijackState 对象（进程内持有）
 *   - chrome.tabs.reload          → page.reload()
 *   - sleep(2000)/sleep(300) 时序补偿 → 不需要（CDP continue/abort 本身原子）
 *
 * 用法：
 *   const hijack = await setupHijack(page, goodsDetail)
 *   // ... 商家在页面里点「提交」→ onEditRequest 自动拦下改包重放
 *   const outcome = await waitHijackOutcome(hijack, PDD_HIJACK_WAIT_MS)
 *   await teardownHijack(page, hijack)   // 无论成败都要摘
 *
 * ★ 铁律（willUseRawBody:false，sw_webrequest_tail @64650）：
 *   改包失败 ⇒ abort 原请求，绝不放行原始 body —— 页面价格上架比不上架更危险。
 *   兜底代发（gateway-proxy）在 m6 接入，接在 onProxyFallback 钩子上。
 */
export interface HijackController {
  state: HijackState
  /** 等待劫持结果（成功/失败/超时 resolve，永不 reject） */
  outcome: Promise<HijackOutcome>
  /** 主动结束（清理 listener 语义由 state 标志承担；puppeteer page 无 off，摘拦截靠 setRequestInterception(false)） */
  finish: (outcome: HijackOutcome) => void
}

export function setupHijack(
  page: Page,
  goodsDetail: GoodsDetail,
  opts?: {
    /** 改包后兜底代发钩子（m6 gateway-proxy 接入点；缺省=无兜底，页面重放失败即失败） */
    onProxyFallback?: (ctx: { url: string; body: unknown; antiContent: string; cookie: string }) => Promise<HijackOutcome>
    /** 结构化日志（trace 简化版；对应 pddHijackTrace，不落 localStorage） */
    onTrace?: (step: string, data?: Record<string, unknown>) => void
  },
): HijackController {
  const state: HijackState = {
    needHijack: true,
    timestamp: Date.now(),
    goodsDetail,
    processing: false,
  }
  const trace = opts?.onTrace || (() => { /* 静默 */ })

  let settleOutcome: (o: HijackOutcome) => void
  const outcome = new Promise<HijackOutcome>(resolve => { settleOutcome = resolve })
  let settled = false
  const finish = (o: HijackOutcome) => {
    if (settled) return
    settled = true
    settleOutcome(o)
  }

  const onEditRequest = async (req: Request): Promise<void> => {
    const url = req.url()
    // 非 edit 提交请求：直接放行（拦截器全局开启时其他资源也走这里）
    if (!isPddEditRequestUrl(url)) {
      await req.continue().catch(() => { /* 竞态下已处理，忽略 */ })
      return
    }
    // 未置 flag / TTL 过期：放行（正常提交；对应 onEdit 前两行）
    if (!state.needHijack) {
      trace('flag_off_pass_through', { url: url.slice(0, 160) })
      await req.continue().catch(() => { /* 忽略 */ })
      return
    }
    if (Date.now() - state.timestamp > PDD_HIJACK_FLAG_TTL_MS) {
      trace('flag_expired_pass_through', { ageMs: Date.now() - state.timestamp })
      state.needHijack = false
      await req.continue().catch(() => { /* 忽略 */ })
      return
    }
    // 防重入（对应 processingTabIds）
    if (state.processing) {
      trace('duplicate_abort', {})
      await req.abort('aborted').catch(() => { /* 忽略 */ })
      return
    }
    state.processing = true
    state.needHijack = false

    const detail = state.goodsDetail || {}
    trace('hijack_process_start', {
      url: url.slice(0, 160),
      productId: (detail as any).productId || '',
    })

    try {
      // ── 1. 取 body（空 ⇒ REQUEST_BODY_EMPTY，abort 不放行）──
      const raw = req.postData()
      if (!raw) {
        trace('request_body_empty', {})
        finish(buildAbnormalFailPayload(PDD_ERROR_CODE.REQUEST_BODY_EMPTY, 'request.postData() 为空'))
        await req.abort('aborted').catch(() => { /* 忽略 */ })
        return
      }
      let body: any
      try {
        body = JSON.parse(raw)
      } catch (e) {
        trace('body_json_parse_fail', { message: (e as Error).message })
        finish(buildAbnormalFailPayload(PDD_ERROR_CODE.REQUEST_BODY_EMPTY, 'body JSON 解析失败: ' + (e as Error).message))
        await req.abort('aborted').catch(() => { /* 忽略 */ })
        return
      }
      trace('body_decoded', { rawLen: raw.length, before: summarizeEditBody(body) })

      /**
       * ★ 原始提交体落盘（仅 PDD_MODE2_DUMP=1 时启用）。
       *
       * 用途：研究页面在**不同规格状态下**生成的 commitBody 真实结构 ——
       * 尤其是 `skus[]` 数组的元素形状（spec / spec_value_id / multi_price 等字段名），
       * 以及页面建出 30 行 vs 1 行时该数组的差异。
       * 有了真实样本才能判断「能否按 goodsDetail 拼装完整 skus 数组」这个关键问题。
       *
       * 落盘位置：.dsh/pdd-mode2-body-<时间戳>.json（不写进工作区，避免污染）
       */
      if (process.env.PDD_MODE2_DUMP === '1') {
        try {
          // 本模块是纯函数（无 node 依赖），故此处动态 import，避免影响单测可移植性
          const fsMod = await import('node:fs')
          const pathMod = await import('node:path')
          const osMod = await import('node:os')
          const dir = pathMod.join(osMod.homedir(), '.dsh')
          fsMod.mkdirSync(dir, { recursive: true })
          const f = pathMod.join(dir, `pdd-mode2-body-${Date.now()}.json`)
          fsMod.writeFileSync(f, JSON.stringify(body, null, 2), 'utf8')
          trace('body_dumped', { file: f, bytes: JSON.stringify(body).length, skus: (body?.skus || []).length })
        } catch { /* dump 失败不影响主流程 */ }
      }

      // ── 2. 改包（30s 预算；失败 ⇒ TRANSFORM_*，abort 不放行 —— willUseRawBody:false 铁律）──
      let transformed: { commitBody: any; before: unknown; after: unknown; skusPricedDelta: number; skusCountDelta: number }
      try {
        transformed = await withTimeout(
          Promise.resolve().then(() => transformRequestBody(body, detail as GoodsDetail)),
          PDD_TRANSFORM_TIMEOUT_MS,
          PDD_ERROR_CODE.TRANSFORM_TIMEOUT,
          'transformRequestBody',
        )
        if (!transformed || typeof transformed !== 'object') {
          throw Object.assign(new Error('转换结果无效'), { errorCode: PDD_ERROR_CODE.TRANSFORM_ERROR })
        }
        // ── m5：增量验证（BLUEPRINT §9.2 第 5 项）──
        // 断言 skusPriced 增量 > 0：改包后至少有一条 SKU 被填上价格，否则视为改包无效，
        // 走 catch 的 abort + 失败收口（willUseRawBody:false 铁律 —— 失败不发包）。
        // ★ 2026-10-21 放宽（三种有效形态）：
        //   ① skusPricedDelta>0     —— 改包新填了价（页面空壳 → 有价）
        //   ② skusCountDelta>0      —— 行数增加（1 行空壳 → N 行矩阵）
        //   ③ reachedTarget         —— DOM 兜底已把页面填成目标态，改包是等价
        //      替换（规格矩阵/预览图/gallery 仍由改包注入），delta 全 0 但有效。
        const targetPriced = Number((detail as any).expected_skus_priced || 0)
        const afterPriced2 = Number((transformed.after as any)?.skusPriced || 0)
        const reachedTarget = targetPriced > 0 && afterPriced2 >= targetPriced
        if (!(transformed.skusPricedDelta > 0 || transformed.skusCountDelta > 0 || reachedTarget)) {
          throw Object.assign(
            new Error(`改包增量验证失败：skusPricedDelta=${transformed.skusPricedDelta}、skusCountDelta=${transformed.skusCountDelta}、afterPriced=${afterPriced2}/${targetPriced}（改包后没有任何 SKU 被填上价格）`),
            { errorCode: PDD_ERROR_CODE.TRANSFORM_ERROR },
          )
        }
        // 第二道：改包后被定价 SKU 数不得低于组装层预期（丢行=匹配链断裂，同样拒绝发包）。
        const expectedPriced = Number((detail as any).expected_skus_priced || 0)
        const afterPriced = Number((transformed.after as any)?.skusPriced || 0)
        if (expectedPriced > 0 && afterPriced < expectedPriced) {
          throw Object.assign(
            new Error(`被定价 SKU 数 ${afterPriced} 低于预期 ${expectedPriced}（规格匹配链丢行），拒绝发包`),
            { errorCode: PDD_ERROR_CODE.TRANSFORM_ERROR },
          )
        }
        trace('transform_applied', { after: transformed.after, skusPricedDelta: transformed.skusPricedDelta, skusCountDelta: transformed.skusCountDelta })
      } catch (e) {
        const { code, message } = pickTransformError(e)
        trace('transform_stop_no_send', { code, message, willUseRawBody: false })
        finish(buildAbnormalFailPayload(code, message))
        await req.abort('aborted').catch(() => { /* 忽略 */ })
        return
      }
      const body2 = transformed.commitBody
      // ★ 2026-10-21：标题强制写入（detail.title 优先）。
      //   实测：DOM fillTitle 用原生 setter 有时不被 React 受理（页面报
      //   「请输入商品标题」），导致页面 body 的 goods_name 为空 →
      //   改包 body 也空 → commit/submit 报「商品标题必须填写」。
      //   商品数据是我们自己的，直接写准，不依赖页面状态。
      if ((detail as any).title) {
        body2.goods_name = String((detail as any).title)
        body2.goods_desc = body2.goods_desc || String((detail as any).title)
      }
      trace('body_final', { goods_name: String(body2.goods_name || '').slice(0, 40), skus: (body2.skus || []).length, gallery: (body2.gallery || []).length })

      // ── 3. abort 原请求（CDP：拦下即不达服务器；显式 abort 收口）──
      await req.abort('aborted').catch(() => { /* 可能已被浏览器取消，忽略 */ })

      // ── 4. Anti-Content（m1；goodsDetail.anti_content 优先，否则页面现生成）──
      let anti = String((detail as any).anti_content || '')
      if (!anti) {
        const g = await getAntiContent(page).catch((e: unknown) => ({ ok: false as const, data: '' as string, error: e instanceof Error ? e.message : String(e) }))
        if (!g.ok || !g.data) {
          trace('anti_content_fail', { error: g.error || '生成失败' })
          finish(buildAbnormalFailPayload(PDD_ERROR_CODE.TRANSFORM_ERROR, `Anti-Content 生成失败: ${g.error || '空'}`))
          return
        }
        anti = g.data
      }
      trace('before_page_send', { antiLen: anti.length, after: transformed.after })

      // ── 5. 页面内重放（§5.1 主通道，30s 预算）──
      let result: HijackOutcome | any
      try {
        result = await withTimeout(
          page.evaluate<HijackOutcome>(PAGE_SEND_SRC as never, url, body2, anti),
          PDD_PAGE_SEND_TIMEOUT_MS,
          PDD_ERROR_CODE.SEND_NETWORK,
          'page_send',
        )
      } catch (e) {
        result = {
          success: false, networkError: true, authOrEnvError: true,
          error: (e as Error).message, errorCode: PDD_ERROR_CODE.SEND_NETWORK, via: 'page',
        }
      }

      // ── 6. 兜底判定（§3.3）→ m6 gateway-proxy 钩子 ──
      if (!result?.success && shouldUseProxyFallback(result)) {
        if (opts?.onProxyFallback) {
          trace('proxy_fallback_start', { pageStatus: result?.status, error: result?.error || result?.error_msg || '' })
          let cookie = ''
          try {
            cookie = String(await page.evaluate(() => document.cookie) || '')
          } catch { /* 忽略 */ }
          try {
            result = await opts.onProxyFallback({ url, body: body2, antiContent: anti, cookie })
          } catch (e) {
            result = {
              success: false, isBizFailure: true,
              error: (e as Error).message, errorCode: PDD_ERROR_CODE.PROXY_FALLBACK_FAIL, via: 'proxy',
            }
          }
        } else {
          trace('proxy_fallback_skipped', { reason: 'no_hook' })
        }
      }

      // ── 7. 收尾（§5.3）──
      if (result?.success) {
        // ★ 2026-10-21 突破：goodsCommit/action/edit 只是「暂存」，
        //   真正上架必须再调 /glide/v2/mms/edit/commit/submit。
        //   实证：只调 edit 返回 success 但不落库；edit + submit 才上架
        //   （submit body 仅 6 字段，从服务端会话取 edit 暂存的数据）。
        let submitResult: any = null
        try {
          const submitBody = {
            goods_commit_id: String(body2.goods_commit_id || ''),
            goods_id: body2.goods_id || 0,
            is_onsale: true,
            third_type: 0,
            if_allow_submit_mall_checking: true,
          }
          trace('before_submit', { goods_id: submitBody.goods_id, commit_id: submitBody.goods_commit_id })
          submitResult = await withTimeout(
            page.evaluate<HijackOutcome>(PAGE_SEND_SRC as never, 'https://mms.pinduoduo.com/glide/v2/mms/edit/commit/submit', submitBody, anti),
            PDD_PAGE_SEND_TIMEOUT_MS,
            PDD_ERROR_CODE.SEND_NETWORK,
            'submit',
          )
          trace('submit_result', { ok: !!submitResult?.success, status: submitResult?.status, body: JSON.stringify(submitResult?.result || submitResult).slice(0, 300) })
        } catch (e) {
          trace('submit_error', { error: (e as Error)?.message || String(e) })
        }
        trace('hijack_success', { via: result.via || 'page', status: result.status, submitted: !!submitResult?.success })
        finish({
          success: true,
          status: result.status,
          via: result.via || 'page',
          before: transformed.before,
          after: transformed.after,
          skusPricedDelta: transformed.skusPricedDelta,
          submitted: !!submitResult?.success,
          detailMessage: submitResult?.success
            ? '劫持填价成功 + 已确认上架（commit/submit）'
            : `劫持填价成功（via=${result.via || 'page'}），但确认上架未成功：${submitResult?.error_msg || submitResult?.error || '未知'}`,
        })
      } else {
        const payload: HijackOutcome = result?.isBizFailure
          ? {
            success: false, errorCode: PDD_ERROR_CODE.API_BIZ,
            status: result?.status, error_msg: result?.error_msg || result?.error || '业务失败',
            pddErrorMsg: result?.error_msg || result?.error || '',
            detailMessage: `拼多多业务失败: ${result?.error_msg || result?.error || ''}`,
            via: result?.via,
          }
          : {
            success: false,
            errorCode: result?.errorCode || PDD_ERROR_CODE.UNKNOWN,
            status: result?.status, error_msg: result?.error_msg || result?.error || '',
            detailMessage: `重放失败: ${result?.error_msg || result?.error || result?.errorCode || '未知'}`,
            via: result?.via,
          }
        trace('hijack_fail', { code: payload.errorCode, message: payload.detailMessage })
        finish(payload)
      }
    } catch (e) {
      // 顶层兜底：任何未预期异常 ⇒ abort + 失败收尾，绝不放行原始包
      trace('hijack_unexpected_error', { message: (e as Error).message })
      finish(buildAbnormalFailPayload(PDD_ERROR_CODE.UNKNOWN, (e as Error).message || String(e)))
      await req.abort('aborted').catch(() => { /* 忽略 */ })
    } finally {
      state.processing = false
    }
  }

  // 挂监听（puppeteer 的 page.on('request') handler 同步/异步均可）
  page.on('request', onEditRequest as (req: Request) => void)

  return {
    state,
    outcome,
    finish,
  }
}

/**
 * m3：等待劫持结果（对应页面 _pddHijackWait 120s）。
 * 超时 resolve {success:false, errorCode:PDD_HIJACK_WAIT_TIMEOUT}（永不 reject）。
 */
export const PDD_HIJACK_WAIT_TIMEOUT = 'PDD_HIJACK_WAIT_TIMEOUT'

export async function waitHijackOutcome(ctrl: HijackController, timeoutMs = PDD_HIJACK_WAIT_MS): Promise<HijackOutcome> {
  return await new Promise<HijackOutcome>(resolve => {
    const timer = setTimeout(() => {
      ctrl.finish({
        success: false,
        errorCode: PDD_HIJACK_WAIT_TIMEOUT,
        detailMessage: `等待商家点提交超时（${timeoutMs}ms）`,
      })
    }, timeoutMs)
    ctrl.outcome.then(o => { clearTimeout(timer); resolve(o) })
  })
}

/**
 * m3：摘拦截器（finally 收口；对应 disablePddEditBlock + processingTabIds.delete）。
 * ★ 无论成败都要调；先置 needHijack=false（在途请求直接放行）再关拦截。
 */
export async function teardownHijack(page: Page, ctrl: HijackController): Promise<void> {
  ctrl.state.needHijack = false
  ctrl.state.goodsDetail = null
  await page.setRequestInterception(false).catch(() => { /* 页面可能已关闭 */ })
}

/* ───────────────────────── m6：HTTP 兜底代发（gateway-proxy 语义对齐） ───────────────────────── */

/**
 * 兜底代发的请求上下文（setupHijack 的 onProxyFallback 钩子参数透传）。
 * cookie 来自 page.evaluate(document.cookie) —— 同源页面即可拿全量（蓝本 §9.3）。
 */
export interface PddProxySendContext {
  url: string
  body: unknown
  antiContent: string
  cookie: string
}

/** m6 HTTP 兜底预算（对齐页面重放 30s） */
export const PDD_PROXY_SEND_TIMEOUT_MS = 30_000

/**
 * m6：页面重放失败时的兜底代发（对应觅千手 sendProxyRequestOnce_57433，但不用
 * safe.koudai89.com 第三方云端，改为本项目进程内直发）。
 *
 * - 结果包装语义与 PAGE_SEND_SRC 逐字段对齐（shouldUseProxyFallback / 收尾判定共用一套形态）：
 *   空 body → networkError + authOrEnvError；401/403 → networkError + authOrEnvError + error_msg；
 *   json.success===true → success；其他 → isBizFailure + error_msg；fetch 异常 → networkError。
 * - 指纹头带全（项目「请求头规则」：pdd 无特殊签名头，Anti-Content 在头里）。
 * - 可注入 fetchImpl 便于单测 mock；缺省用 node 原生 fetch（Node 18+）。
 */
export async function sendPddEditViaHttp(
  ctx: PddProxySendContext,
  fetchImpl: typeof fetch = fetch,
): Promise<HijackOutcome> {
  const wrap = (o: Record<string, unknown>): HijackOutcome => ({
    success: false,
    errorCode: PDD_ERROR_CODE.SEND_NETWORK,
    via: 'proxy',
    ...o,
    detailMessage: o.detailMessage as string,
  })

  let resp: Response
  try {
    resp = await withTimeout(
      Promise.resolve(
        fetchImpl(ctx.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Anti-Content': ctx.antiContent || '',
            Cookie: ctx.cookie || '',
            Referer: 'https://mms.pinduoduo.com/',
            Origin: 'https://mms.pinduoduo.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          body: JSON.stringify(ctx.body),
        }),
      ),
      PDD_PROXY_SEND_TIMEOUT_MS,
      PDD_ERROR_CODE.SEND_NETWORK,
      'proxy_send',
    )
  } catch (e) {
    return wrap({
      networkError: true,
      authOrEnvError: true,
      error: (e as Error).message,
      detailMessage: `兜底代发网络异常：${(e as Error).message}`,
    })
  }

  let text = ''
  try {
    text = await resp.text()
  } catch (e) {
    return wrap({
      networkError: true,
      authOrEnvError: true,
      status: resp.status,
      error: (e as Error).message,
      detailMessage: `兜底代发读取响应失败：${(e as Error).message}`,
    })
  }

  if (!text || !text.trim()) {
    return wrap({
      networkError: true,
      authOrEnvError: true,
      status: resp.status,
      error: '空 body',
      detailMessage: `兜底代发返回空 body（HTTP ${resp.status}）`,
    })
  }

  let json: any = null
  try {
    json = JSON.parse(text)
  } catch (e) {
    return wrap({
      networkError: true,
      authOrEnvError: true,
      status: resp.status,
      error: `非 JSON: ${(e as Error).message}`,
      detailMessage: `兜底代发返回非 JSON（HTTP ${resp.status}）`,
    })
  }

  if (resp.status === 401 || resp.status === 403) {
    return wrap({
      networkError: true,
      authOrEnvError: true,
      status: resp.status,
      error_msg: json?.error_msg || json?.errorMsg || '',
      detailMessage: `兜底代发被鉴权拦截（HTTP ${resp.status}）：${json?.error_msg || json?.errorMsg || '登录态失效'}`,
    })
  }

  if (json && json.success === true) {
    return {
      success: true,
      status: resp.status,
      result: json,
      via: 'proxy',
      detailMessage: `兜底代发成功 | via=proxy | HTTP ${resp.status}`,
    }
  }

  const errMsg = json?.error_msg || json?.errorMsg || '业务失败'
  return {
    success: false,
    isBizFailure: true,
    status: resp.status,
    error_msg: errMsg,
    result: json,
    errorCode: PDD_ERROR_CODE.API_BIZ,
    via: 'proxy',
    detailMessage: `兜底代发业务失败：${errMsg}`,
  }
}
