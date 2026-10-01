/**
 * 拼多多数据采集 — host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP（dev/probe-pdd-*.mjs 已实测排除）：
 *   拼多多 H5 业务接口（/proxy/api/**）要求 `anti_content` 签名参数，
 *   该值由页面 JS 在运行时生成，Cookie 注入式纯 HTTP 请求恒被拒：
 *     - /proxy/api/search              → 54001（anti_content 校验失败）
 *     - /proxy/api/... recommend / top → 403 error_code=40003
 *
 * 取数分两路（缺一不可，dev/probe-pdd-search4x.mjs 实测）：
 *   ① XHR 拦截 —— 首页推荐流（feed）的商品来自 /proxy/api/api/alexa/cells/hub/v3，
 *      由页面自身发出，自带 anti_content 签名，host 侧只收响应体。
 *   ② SSR 内联解析 —— 搜索页（search_result.html）**首屏不发搜索 XHR**，
 *      商品直接内联在 window.rawData.stores.store.data.ssrListData.list 里。
 *      只等 XHR 会永远空手而归（这是本模块早期的真 bug）。
 *
 * ★ 平台侧限制（实测，非本模块可修）：搜索接口对该账号返回 error_code=40002
 *   （「系统繁忙」，429/200 均见）且为**持久限流**（冷却 240s 零请求后仍空）。
 *   此时 SSR 里 isNoResultList=true、hasError=true，页面显示「系统繁忙 请稍后再试」。
 *   同一账号的 feed / user/me / search_hotquery 均 200 → 是搜索接口被限，非账号封禁。
 *   故 search 模式必须把 SSR 状态如实回报给模型，并引导改用 mode=feed。
 *
 * ★ 前提：匿名浏览器访问拼多多商品页/搜索页一律强制跳登录页，
 *   因此本技能要求凭证库中已存在 pdd 账号（否则返回 not_bound 引导扫码登录）。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'

const H5_BASE = 'https://mobile.yangkeduo.com'
const CRAWL_WAIT_MS = 30_000
/** 单次采集返回的商品上限，避免把超大响应灌给模型 */
const MAX_GOODS = 100
/** 拦截到的响应体上限（防止超大 JSON 拖垮内存） */
const MAX_BODY_CHARS = 400_000
/** 移动端 UA：目标站点是 H5 站，桌面 UA 更容易被风控 */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

export interface PddCrawlOptions {
  /** 搜索关键词（mode=search 时必填） */
  keyword?: string
  /** 商品 ID（mode=goods 时必填） */
  goodsId?: string
  /** 采集模式：search（关键词搜索）/ goods（单品详情）/ feed（首页推荐流） */
  mode?: string
  /** 返回条数上限（字符串，默认 20，最大 100） */
  limit?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
}

export interface PddGoodsItem {
  goodsId: string
  goodsName: string
  price: string
  sales: string
  mallId: string
  mallName: string
  thumbUrl: string
  linkUrl: string
}

export interface PddCrawlResult {
  ok: boolean
  text: string
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  mode?: string
  count?: number
  goods?: PddGoodsItem[]
  /** 实际命中的接口地址，便于排查「接口变了/没发请求」 */
  sourceUrls?: string[]
}

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '拼多多采集'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: PddCrawlResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'pdd' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到拼多多账号。拼多多页面在未登录时会强制跳转登录页，无法采集。'
          + '请引导用户打开「账号连接」页面添加拼多多账号（扫码登录）后再重试。',
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
          `拼多多平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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

/** 价格归一：拼多多接口价格多为「分」的整数，统一转成元 */
function normalizePrice(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string' && v.includes('.')) return v
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return (n / 100).toFixed(2)
}

/** 单条商品字段归一（兼容接口的 snake_case / camelCase 两套命名） */
function normalizeGoods(raw: Record<string, any>): PddGoodsItem {
  const goodsId = String(raw.goods_id ?? raw.goodsId ?? raw.goods_id_str ?? '')
  // 价格字段实测来源（首页推荐流 /proxy/api/api/alexa/cells/hub/v3，单位一律为「分」）：
  //   group.price=381（拼团价，页面展示价）/ normal_price=481（单买价）/ market_price=1806（市场价）
  // 详情页（/api/caterham/query/goods_detail_with_tags）另有 min_group_price / min_normal_price。
  const price = normalizePrice(
    raw.price
      ?? raw.min_group_price
      ?? raw.group_price
      ?? raw.min_on_sale_group_price
      ?? raw.group?.price
      ?? raw.min_normal_price
      ?? raw.normal_price
      ?? raw.market_price
      ?? raw.price_str,
  )
  const sales = String(
    raw.sales_tip ?? raw.salesTip ?? raw.sales ?? raw.cnt ?? raw.sold_quantity ?? raw.soldQuantity ?? '',
  )
  return {
    goodsId,
    goodsName: String(raw.goods_name ?? raw.goodsName ?? raw.short_name ?? raw.title ?? ''),
    price,
    sales,
    mallId: String(raw.mall_id ?? raw.mallId ?? ''),
    mallName: String(raw.mall_name ?? raw.mallName ?? ''),
    thumbUrl: String(raw.thumb_url ?? raw.thumbUrl ?? raw.hd_thumb_url ?? raw.image_url ?? ''),
    linkUrl: goodsId ? `${H5_BASE}/goods.html?goods_id=${goodsId}` : '',
  }
}

/** 递归找出 JSON 里所有「商品对象」（含 goods_id / goods_name 字段的对象） */
function extractGoods(node: unknown, out: PddGoodsItem[], depth = 0): void {
  if (node == null || depth > 8 || out.length >= MAX_GOODS) return
  if (Array.isArray(node)) {
    for (const item of node) {
      if (out.length >= MAX_GOODS) return
      extractGoods(item, out, depth + 1)
    }
    return
  }
  if (typeof node === 'object') {
    const rec = node as Record<string, any>
    // ★ 商品对象必须在这里判、不能只判「数组元素」：
    //   search 接口商品在 items[] 里（数组元素），但首页推荐流在 goods_list[].data 里（对象的属性值），
    //   只判数组元素会整批漏掉推荐流。
    if ('goods_id' in rec || 'goodsId' in rec || 'goods_name' in rec || 'goodsName' in rec) {
      const g = normalizeGoods(rec)
      if (g.goodsId || g.goodsName) out.push(g)
      return
    }
    for (const v of Object.values(rec)) extractGoods(v, out, depth + 1)
  }
}

/** 从拦截到的响应体里解析商品（JSON 直解；失败则不解析，不抛错） */
function parseGoods(body: string, out: PddGoodsItem[]): void {
  const text = body.trim()
  if (!text || (text[0] !== '{' && text[0] !== '[')) return
  try {
    extractGoods(JSON.parse(text), out)
  } catch { /* 非 JSON 或截断，忽略 */ }
}

/** 去重（同一商品可能在多个接口里出现） */
function dedupe(items: PddGoodsItem[]): PddGoodsItem[] {
  const seen = new Set<string>()
  const out: PddGoodsItem[] = []
  for (const it of items) {
    const key = it.goodsId || it.goodsName
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/** 搜索页 SSR 状态（首屏商品内联在 window.rawData，而非 XHR） */
interface SsrState {
  searchKey: string
  isNoResultList: boolean
  hasError: boolean
  isRisk: boolean
  listLen: number
}

/**
 * 读取搜索页 SSR 状态，并把内联商品并入 out。
 *
 * ★ 为什么必须单独读 SSR：search_result.html 首屏**不发**搜索 XHR，
 *   商品数据直接内联在 window.rawData.stores.store.data.ssrListData.list。
 *   只监听 /proxy/api/ 响应会永远拿不到搜索结果（本模块早期的真 bug）。
 *
 * 返回 null 表示页面没有 SSR 数据（例如被重定向到登录页）。
 */
async function readSearchSsr(page: any, out: PddGoodsItem[]): Promise<SsrState | null> {
  try {
    const raw = await page.evaluate(() => {
      const w = window as any
      const d = w.rawData?.stores?.store?.data
      if (!d) return null
      const s = d.ssrListData || {}
      const list = Array.isArray(s.list) ? s.list : []
      return {
        searchKey: String(s.searchKey || ''),
        isNoResultList: s.isNoResultList === true,
        hasError: s.hasError === true,
        isRisk: s.isRisk === true,
        listLen: list.length,
        list,
        expansionList: Array.isArray(s.expansionList) ? s.expansionList : [],
      }
    })
    if (!raw) return null
    // SSR 条目结构与 XHR 一致（含 goods_id / goods_name），复用同一提取器
    extractGoods(raw.list, out)
    extractGoods(raw.expansionList, out)
    return {
      searchKey: raw.searchKey,
      isNoResultList: raw.isNoResultList,
      hasError: raw.hasError,
      isRisk: raw.isRisk,
      listLen: raw.listLen,
    }
  } catch {
    return null
  }
}

/**
 * 拼多多采集主流程。
 *
 * 纯读操作（无副作用），因此不需要 confirm 门禁。
 */
export async function pddCrawl(
  store: CredentialStore,
  opts: PddCrawlOptions,
): Promise<PddCrawlResult> {
  // ── 入参校验 ────────────────────────────────────────────
  // 三态模式：feed（首页推荐流，实测唯一稳定可用）/ goods（单品详情）/ search（关键词搜索）
  // 未显式传 mode 时按入参推断：有 goodsId → goods；有关键词 → search；都没有 → feed。
  const keyword = String(opts.keyword || '').trim()
  const goodsId = String(opts.goodsId || '').trim()
  const modeRaw = String(opts.mode || '').trim()
  const mode = modeRaw === 'goods' || modeRaw === 'feed' || modeRaw === 'search'
    ? modeRaw
    : goodsId ? 'goods' : keyword ? 'search' : 'feed'
  const limitRaw = Number.parseInt(String(opts.limit ?? '20'), 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), MAX_GOODS)

  if (mode === 'search' && !keyword) {
    return { ok: false, failureKind: 'api_error', text: '缺少 keyword（搜索关键词）。mode=search 时必填。' }
  }
  if (mode === 'goods' && !goodsId) {
    return { ok: false, failureKind: 'api_error', text: '缺少 goodsId（商品 ID）。mode=goods 时必填。' }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!
  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   按目录加锁才能拦住「采集与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
  //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
  const dir = profileDir('pdd', shopKey)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `拼多多的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  // feed 模式指向首页（推荐流接口 /proxy/api/api/alexa/cells/hub/v3 由首页自身发出）
  const targetUrl = mode === 'goods'
    ? `${H5_BASE}/goods.html?goods_id=${encodeURIComponent(goodsId)}`
    : mode === 'feed'
      ? `${H5_BASE}/`
      : `${H5_BASE}/search_result.html?search_key=${encodeURIComponent(keyword)}`

  let browser: any = null
  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行采集。' }
    }

    const launchOpts = {
      // 可见窗口：拼多多风控较严，出现滑块/安全验证时用户可人工处理
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-pdd-crawl] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
    await page.setUserAgent(MOBILE_UA)
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入拼多多域 Cookie（H5 站登录态在 .yangkeduo.com）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.yangkeduo.com', path: '/' }))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-pdd-crawl] 已注入 ${cookieList.length} 个 yangkeduo.com Cookie（账号 ${shopKey}）`)

    // ── 拦截页面自身的业务接口响应 ──────────────────────────
    // 页面请求自带 anti_content 签名，host 侧只负责把响应体收下来。
    const goods: PddGoodsItem[] = []
    const sourceUrls: string[] = []
    let riskHint = ''
    /** 业务接口返回的 error_code（用于把「系统繁忙」等平台侧限制讲清楚） */
    const bizCodes = new Set<number>()
    page.on('response', async (res: any) => {
      try {
        const url = String(res.url())
        if (!/\/proxy\/api\//.test(url)) return
        const status = res.status()
        const body = await res.text()
        if (sourceUrls.length < 20) sourceUrls.push(`${status} ${url.split('?')[0]}`)
        // 平台侧业务错误码优先于 HTTP 状态码：拼多多限流时常见 200/429 + error_code=40002
        try {
          const ec = JSON.parse(body)?.error_code
          if (typeof ec === 'number' && ec !== 0) bizCodes.add(ec)
        } catch { /* 非 JSON，忽略 */ }
        if (status >= 400) {
          if (status === 403 || status === 429) riskHint = `接口返回 HTTP ${status}`
          return
        }
        if (body && body.length <= MAX_BODY_CHARS) parseGoods(body, goods)
      } catch { /* 响应体读取失败（跳转/被中断），忽略 */ }
    })

    console.log(`[dsagent-pdd-crawl] 打开页面：${targetUrl}`)
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
    const landedUrl = page.url()
    if (/login\.html|login\?/i.test(landedUrl)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: `拼多多登录态已失效（页面被重定向到 ${landedUrl}）。请到「账号连接」页面重新登录拼多多后重试。`,
      }
    }

    // ── 等数据回流 ────────────────────────────────────────
    // search 模式首屏商品内联在 SSR（不发 XHR），必须先读一次 SSR 再滚动；
    // feed 模式商品来自 XHR，滚动触发分页。
    // 连续 2 轮无新增即认为已到底，提前结束。
    let ssrState = mode === 'search' ? await readSearchSsr(page, goods) : null
    const deadline = Date.now() + CRAWL_WAIT_MS
    let stagnant = 0
    let lastCount = 0
    while (Date.now() < deadline && goods.length < limit && stagnant < 2) {
      await new Promise(r => setTimeout(r, 2000))
      if (mode === 'search' || mode === 'feed') {
        try {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        } catch { /* 页面跳转中，忽略 */ }
      }
      // 搜索页可能异步补齐 SSR / 用户点「刷新」后重渲染，滚动期间再读几次
      if (mode === 'search' && goods.length < limit) {
        ssrState = (await readSearchSsr(page, goods)) ?? ssrState
      }
      if (goods.length === lastCount) stagnant += 1
      else { stagnant = 0; lastCount = goods.length }
    }

    const items = dedupe(goods).slice(0, limit)

    if (!items.length) {
      // ★ search / goods 接口被平台限流（实测 error_code=40002「系统繁忙」）：
      //   搜索页 SSR 里 isNoResultList=true 且 hasError=true，页面显示「系统繁忙 请稍后再试」；
      //   goods 详情接口同样 429 + 40002。这是平台侧持久限流，
      //   同一账号的 feed / user/me / search_hotquery 仍 200（非账号封禁），本地无法绕过。
      //   40002 是跨模式可靠信号；SSR 状态仅 search 模式可得。
      const throttled = bizCodes.has(40002)
        || (mode === 'search'
          && (ssrState?.hasError === true || (ssrState?.isNoResultList === true && riskHint !== '')))
      const codeHint = bizCodes.size ? `业务错误码：${[...bizCodes].join(', ')}。` : ''
      const hint = throttled
        ? `拼多多接口返回「系统繁忙」（error_code=40002），该账号的${mode === 'goods' ? '商品详情' : '搜索'}接口当前被平台限流。`
        : riskHint
          ? `${riskHint}。`
          : '页面可能仍停留在登录页、被风控拦截，或页面结构已变更。'
      // search / goods 接口实测有账号级持久频控（页面自身请求也被限），feed 稳定可用 → 明确给出回退建议
      const fallback = mode === 'feed'
        ? '若已登录仍无数据，可能是平台接口调整，请把上面的接口清单反馈给用户。'
        : '该账号的 search / goods 接口正处于平台频控中（页面自身请求也返回「系统繁忙」）。'
          + '请改用 mode=feed（首页推荐流，实测稳定可用）取商品数据，或等待平台解除限流后重试。'
      return {
        ok: false,
        failureKind: throttled ? 'risk_control' : 'parse_error',
        shopKey,
        mode,
        sourceUrls,
        text: `未从拼多多页面采集到商品数据。${hint}${codeHint}\n`
          + `当前页面：${page.url()}\n`
          + (ssrState ? `搜索页 SSR：关键词「${ssrState.searchKey}」、内联商品 ${ssrState.listLen} 条`
            + `、isNoResultList=${ssrState.isNoResultList}、hasError=${ssrState.hasError}\n` : '')
          + (sourceUrls.length ? `已拦截接口：\n${sourceUrls.map(u => `  - ${u}`).join('\n')}` : '未拦截到任何 /proxy/api/ 接口。')
          + (throttled
            ? '\n建议：' + fallback
            : '\n建议：打开浏览器窗口确认是否出现滑块/安全验证，人工完成后重试；' + fallback),
      }
    }

    // 取到数据说明登录态确实有效，顺带订正可能被误标的状态
    try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }

    const lines = items.map((it, i) => {
      const meta = [it.price ? `¥${it.price}` : '', it.sales ? `销量 ${it.sales}` : '',
        it.mallName ? `店铺 ${it.mallName}` : ''].filter(Boolean).join(' | ')
      return `${i + 1}. ${it.goodsName || '（无标题）'}\n   商品ID：${it.goodsId}${meta ? `\n   ${meta}` : ''}\n   链接：${it.linkUrl}`
    })

    return {
      ok: true,
      shopKey,
      mode,
      count: items.length,
      goods: items,
      sourceUrls,
      text: [
        `拼多多${mode === 'goods' ? '商品详情' : mode === 'feed' ? '首页推荐流' : `关键词「${keyword}」搜索结果`}采集完成，共 ${items.length} 条。`,
        `账号：${account.display_label || account.account_id}（${shopKey}）`,
        '',
        ...lines,
      ].join('\n'),
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `拼多多采集失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
