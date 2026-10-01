/**
 * 闲鱼数据分析 — host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP：
 *   闲鱼账号类 MTOP 接口（mtop.idle.web.*）除 Cookie 外还要求页面 JS 运行时生成的
 *   `sign` 签名（md5(token & t & appkey & data)），且必须携带真实的 goofish 会话票据。
 *   实测（dev/_xianyu_real_pages.json / dev/_xianyu_publish_page.json）：
 *     - 注入凭证库 Cookie 后访问 goofish 首页 / 个人页 / 发布页，三页均显示「登录」
 *     - mtop.idle.web.user.page.nav / mtop.idle.web.xyh.item.list 等
 *       一律返回 FAIL_SYS_SESSION_EXPIRED::Session过期
 *   根因：goofish 的会话票据是 havana_lgc2_77（站点后缀 77，来自登录 iframe 的 stie=77），
 *   而淘宝 SSO 派生只能拿到 havana_lgc2_0，两者不通用。
 *
 * 结论：唯一可行路线 = 让页面自己发请求，host 侧拦截响应体取数。
 *   页面自身请求自带 sign 与完整会话，无需逆向签名算法。
 *
 * ★ 前提：凭证库中的 xianyu 账号必须是**在 https://www.goofish.com/login 用闲鱼 APP
 *   扫码登录**得到的（只有这条路能拿到 havana_lgc2_77）。淘宝 SSO 派生的闲鱼账号
 *   在 goofish 域下恒为未登录态，本工具会返回 token_expired 引导用户重新扫码。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'

const PERSONAL_URL = 'https://www.goofish.com/personal'
const CRAWL_WAIT_MS = 30_000
/** 单次返回的商品上限，避免把超大响应灌给模型 */
const MAX_ITEMS = 100
/** 拦截到的响应体上限（防止超大 JSON 拖垮内存） */
const MAX_BODY_CHARS = 400_000

/**
 * 关注的账号类接口（其余接口的响应体直接丢弃，不占内存）。
 * 实测（dev/_xianyu_final_dom.json）：个人页实际只发出 item.list / user.page.head / user.page.nav 三个，
 * 早期假设的 user.page.account 从未观测到，故不再列入。
 */
const WATCHED_APIS = [
  'mtop.idle.web.xyh.item.list',
  'mtop.idle.web.user.page.head',
  'mtop.idle.web.user.page.nav',
]

export interface XianyuAnalyticsOptions {
  /** 分析模式：overview（经营概览 + 商品排行，默认）/ items（仅商品明细） */
  mode?: string
  /** 商品条数上限（字符串，默认 50，最大 100） */
  limit?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
}

export interface XianyuItemStat {
  itemId: string
  title: string
  price: string
  soldPrice: string
  status: string
  /** 浏览/曝光数（接口字段名随版本变化，取值见 normalizeItem） */
  browseCnt: string
  /** 「想要」人数 */
  wantCnt: string
  /** 收藏数 */
  collectCnt: string
  city: string
  picUrl: string
  linkUrl: string
}

export interface XianyuAnalyticsResult {
  ok: boolean
  text: string
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  mode?: string
  count?: number
  items?: XianyuItemStat[]
  /** 账号概况（粉丝/关注/获赞等，取不到则为空对象） */
  profile?: Record<string, string>
  /** 实际命中的接口地址，便于排查「接口变了/没发请求」 */
  sourceUrls?: string[]
}

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '闲鱼数据分析'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: XianyuAnalyticsResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'xianyu' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到闲鱼账号。闲鱼个人页与账号数据接口在未登录时不可用，无法分析。'
          + '请引导用户打开「账号连接」页面添加闲鱼账号，'
          + '★ 必须用闲鱼 APP 扫描 https://www.goofish.com/login 的二维码（淘宝 SSO 派生的登录态在 goofish 域无效）。',
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
          `闲鱼平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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

/** 取第一个有值的字段（闲鱼接口字段名跨版本不一致，统一多候选兜底） */
function pick(raw: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

/**
 * 商品字段在真实响应里分散在多层容器中（实测 dev/_xianyu_final_dom.json）：
 *   data.cardList[].cardData              → id / title / itemStatus / auctionType
 *   data.cardList[].cardData.detailParams → itemId / title / soldPrice / picUrl
 *   data.cardList[].cardData.priceInfo    → price / preText
 *   data.cardList[].cardData.picInfo      → picUrl / width / height
 * ★ 外层还多包了一层 {cardData:{...}}，若只下钻固定键名会漏掉 priceInfo.price 等，
 *   导致 price / picUrl 恒为空（历史缺陷）。故改为**递归下钻所有对象值**（限深度），
 *   顶层键优先（先到先得），避免深层噪声覆盖真实字段。
 */
function flattenItem(raw: Record<string, any>, depth = 0, out: Record<string, any> = {}): Record<string, any> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw) || depth > 3) return out
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || v === '') continue
    if (!(k in out)) out[k] = v
  }
  for (const v of Object.values(raw)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenItem(v as Record<string, any>, depth + 1, out)
  }
  return out
}

/** 商品对象的判据：既有 ID 类字段，又有标题/价格/图片类字段（避免把纯标签对象误当商品） */
function isItemRecord(f: Record<string, any>): boolean {
  const hasId = ['itemId', 'item_id', 'id', 'uniqueCode'].some(k => f[k] != null && f[k] !== '')
  if (!hasId) return false
  return ['title', 'itemTitle', 'soldPrice', 'price', 'picUrl'].some(k => f[k] != null && f[k] !== '')
}

/** 单条商品字段归一（兼容接口的 snake_case / camelCase 两套命名） */
function normalizeItem(raw: Record<string, any>): XianyuItemStat {
  const f = flattenItem(raw)
  const itemId = pick(f, ['itemId', 'item_id', 'id', 'uniqueCode'])
  // ★ 实测：网页版个人页接口**不返回**浏览/曝光计数，「想要」数只以标签文案形式出现
  //   （itemLabelDataVO / trackParams 里的 "5人想要"），故从标签文案里正则抽取。
  const labelText = JSON.stringify(raw)
  const wantFromLabel = (labelText.match(/(\d+)\s*人想要/) || [])[1] || ''
  return {
    itemId,
    title: pick(f, ['title', 'itemTitle', 'item_title', 'name']),
    price: pick(f, ['price', 'soldPrice', 'firstPrice', 'priceText', 'currentPrice']),
    soldPrice: pick(f, ['soldPrice', 'firstPrice']),
    status: pick(f, ['itemStatus', 'status', 'itemStatusText', 'statusText']),
    browseCnt: pick(f, ['browseCnt', 'browseCount', 'pv', 'pvCnt', 'viewCnt', 'exposureCnt', 'showCnt']),
    wantCnt: pick(f, ['wantCnt', 'wantCount', 'wantNum', 'collectWantCnt']) || wantFromLabel,
    collectCnt: pick(f, ['collectCnt', 'collectCount', 'favorCnt', 'favoriteCnt']),
    city: pick(f, ['city', 'area', 'location', 'cityName']),
    picUrl: pick(f, ['picUrl', 'pic_url', 'imageUrl', 'mainPic', 'coverUrl']),
    linkUrl: itemId ? `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}` : '',
  }
}

/**
 * 递归找出 JSON 里所有「商品对象」。
 * ★ 判定必须对**任意对象节点**生效，不能只在数组元素上判定：
 *   真实响应是 data.cardList[].cardData（对象套对象），商品字段在 cardData 与其 detailParams 里，
 *   若只判定数组元素则一条都匹配不到（历史缺陷）。
 * 命中即取用并停止下钻，避免同一条商品被内外两层重复计入。
 */
function extractItems(node: unknown, out: XianyuItemStat[], depth = 0): void {
  if (node == null || depth > 8 || out.length >= MAX_ITEMS) return
  if (Array.isArray(node)) {
    for (const item of node) {
      if (out.length >= MAX_ITEMS) return
      extractItems(item, out, depth + 1)
    }
    return
  }
  if (typeof node === 'object') {
    const rec = node as Record<string, any>
    if (isItemRecord(flattenItem(rec))) {
      const it = normalizeItem(rec)
      if (it.itemId || it.title) {
        out.push(it)
        return
      }
    }
    for (const v of Object.values(rec)) extractItems(v, out, depth + 1)
  }
}

/** 从 MTOP 响应体里解析 data 段（响应形如 `mtopjsonp1({...})` 或纯 JSON） */
function parseMtopBody(body: string): Record<string, any> | null {
  const text = body.trim()
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, any>
  } catch {
    return null
  }
}

/** 去重（同一商品可能在多个接口里出现） */
function dedupe(items: XianyuItemStat[]): XianyuItemStat[] {
  const seen = new Set<string>()
  const out: XianyuItemStat[] = []
  for (const it of items) {
    const key = it.itemId || it.title
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

/** 把 MTOP 响应体里的 ret 判据抽出来，用于区分「会话过期」与「正常返回」 */
function retOf(json: Record<string, any> | null): string {
  const ret = json?.ret
  if (Array.isArray(ret) && ret.length) return String(ret[0])
  if (typeof ret === 'string') return ret
  return ''
}

/**
 * 闲鱼数据分析主流程。
 *
 * 纯读操作（无副作用），因此不需要 confirm 门禁。
 */
export async function xianyuAnalytics(
  store: CredentialStore,
  opts: XianyuAnalyticsOptions,
): Promise<XianyuAnalyticsResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const mode = String(opts.mode || 'overview').trim() === 'items' ? 'items' : 'overview'
  const limitRaw = Number.parseInt(String(opts.limit ?? '50'), 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), MAX_ITEMS)

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!
  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 发布 / 风控验证共享。
  //   只有按目录加锁才能拦住「发布与数据分析同时启动」这类跨模块撞锁。
  const dir = profileDir('xianyu', shopKey)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `闲鱼的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  let browser: any = null
  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行分析。' }
    }

    const launchOpts = {
      // 可见窗口：闲鱼风控较严，出现滑块/安全验证时用户可人工处理
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-xianyu-analytics] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入闲鱼域 Cookie。★ 必须同时写 .goofish.com 与 .taobao.com：
    // 闲鱼登录态在 goofish 域，但 SSO 相关票据（_tb_token_ / cookie2 / unb）写在 taobao 域。
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => ([
        { name, value: String(value), domain: '.goofish.com', path: '/' },
        { name, value: String(value), domain: '.taobao.com', path: '/' },
      ]))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-xianyu-analytics] 已注入 ${cookieList.length} 个 Cookie（账号 ${shopKey}）`)

    // ── 拦截页面自身的账号类接口响应 ────────────────────────
    // 页面请求自带 sign 签名，host 侧只负责把响应体收下来。
    const items: XianyuItemStat[] = []
    const sourceUrls: string[] = []
    const rawBodies: Record<string, string> = {}
    let sessionExpired = false
    let riskHint = ''
    page.on('response', async (res: any) => {
      try {
        const url = String(res.url())
        const m = url.match(/\/h5\/(mtop\.[A-Za-z0-9._]+)\//)
        if (!m) return
        const api = m[1]
        if (!WATCHED_APIS.includes(api)) return
        const status = res.status()
        const body = await res.text()
        if (sourceUrls.length < 20) sourceUrls.push(`${status} ${api}`)
        if (status >= 400) {
          if (status === 403 || status === 429) riskHint = `接口返回 HTTP ${status}，可能触发风控`
          return
        }
        if (!body || body.length > MAX_BODY_CHARS) return
        const json = parseMtopBody(body)
        const ret = retOf(json)
        if (/FAIL_SYS_SESSION_EXPIRED|FAIL_SYS_TOKEN_EXPIRED|FAIL_SYS_TOKEN_EXOIRED|FAIL_BIZ_LOGIN/i.test(ret)) {
          sessionExpired = true
          return
        }
        if (api === 'mtop.idle.web.xyh.item.list' && json) extractItems(json, items)
        else rawBodies[api] = body
      } catch { /* 响应体读取失败（跳转/被中断），忽略 */ }
    })

    console.log(`[dsagent-xianyu-analytics] 打开个人页：${PERSONAL_URL}`)
    await page.goto(PERSONAL_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // ── 登录态判定 ─────────────────────────────────────────
    // 闲鱼未登录时不会跳转登录页（原地渲染「登录」按钮），因此不能只看 URL，
    // 必须结合「接口是否返回 Session 过期」+「页面是否出现登录字样」两个信号。
    const waitDeadline = Date.now() + CRAWL_WAIT_MS
    let stagnant = 0
    let lastCount = 0
    while (Date.now() < waitDeadline && items.length < limit && stagnant < 2) {
      await new Promise(r => setTimeout(r, 2000))
      if (items.length === lastCount) stagnant += 1
      else { stagnant = 0; lastCount = items.length }
    }

    let loginWord = false
    try {
      loginWord = await page.evaluate(() => /立即登录|登录后可以/.test(document.body?.innerText || ''))
    } catch { /* 页面跳转中，忽略 */ }

    if (sessionExpired || (loginWord && !items.length)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        sourceUrls,
        text: '闲鱼登录态在 goofish 域下无效（账号数据接口返回 Session 过期，页面仍显示「登录」）。\n'
          + '★ 常见原因：该账号是**淘宝 SSO 派生**的闲鱼账号，只持有 havana_lgc2_0 票据，'
          + '而 goofish 域需要 havana_lgc2_77（站点后缀 77），两者不通用。\n'
          + '请到「账号连接」页面删除该闲鱼账号后重新添加，'
          + '★ 必须用**闲鱼 APP 扫描** https://www.goofish.com/login 的二维码完成登录，不要走淘宝 SSO。\n'
          + (sourceUrls.length ? `已拦截接口：\n${sourceUrls.map(u => `  - ${u}`).join('\n')}` : '未拦截到任何账号类接口。'),
      }
    }

    const list = dedupe(items).slice(0, limit)

    if (!list.length) {
      const hint = riskHint
        ? `${riskHint}。`
        : '页面可能被风控拦截、接口未发出，或页面结构已变更。'
      return {
        ok: false,
        failureKind: 'parse_error',
        shopKey,
        sourceUrls,
        text: `未从闲鱼个人页拦截到商品数据。${hint}\n`
          + `当前页面：${page.url()}\n`
          + (sourceUrls.length ? `已拦截接口：\n${sourceUrls.map(u => `  - ${u}`).join('\n')}` : '未拦截到任何账号类接口。')
          + '\n建议：打开浏览器窗口确认账号是否已登录、是否出现滑块/安全验证；'
          + '若已登录仍无数据，可能是平台接口调整，请反馈该信息。',
      }
    }

    // 取到数据说明登录态确实有效，顺带订正可能被误标的状态
    try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }

    // ── 账号概况（head / nav 接口，取到多少算多少）──────────
    // ★ 实测（dev/_xianyu_final_dom.json）：真实数据不在 data 一级键，而在 data.module 里：
    //   page.nav  → data.module.base  = {displayName, soldCount, purchaseCount, followers, following, collectionCount}
    //   page.head → data.module.base  = {displayName, ipLocation, avatar, ylzTags}
    //               data.module.social = {followStatus, followers, following}
    //               data.module.tabs   = {item:{number,name}, rate:{number,name}}
    //   因此必须下钻两层，只读一级键会恒为空（历史缺陷）。
    const profile: Record<string, string> = {}
    const put = (label: string, v: unknown) => {
      if (v == null || v === '' || typeof v === 'object') return
      if (!(label in profile)) profile[label] = String(v)
    }
    for (const api of ['mtop.idle.web.user.page.nav', 'mtop.idle.web.user.page.head']) {
      const body = rawBodies[api]
      if (!body) continue
      const data = parseMtopBody(body)?.data as Record<string, any> | undefined
      if (!data || typeof data !== 'object') continue
      const mod = (data.module && typeof data.module === 'object') ? data.module as Record<string, any> : {}
      const base = (mod.base && typeof mod.base === 'object') ? mod.base as Record<string, any> : {}
      const social = (mod.social && typeof mod.social === 'object') ? mod.social as Record<string, any> : {}
      const tabs = (mod.tabs && typeof mod.tabs === 'object') ? mod.tabs as Record<string, any> : {}
      put('昵称', base.displayName)
      put('IP归属地', base.ipLocation)
      put('已卖出', base.soldCount)
      put('已买到', base.purchaseCount)
      put('收藏数', base.collectionCount)
      put('粉丝数', base.followers ?? social.followers)
      put('关注数', base.following ?? social.following)
      for (const key of ['item', 'rate'] as const) {
        const t = tabs[key]
        if (t && typeof t === 'object') put(`${(t as any).name || key}数`, (t as any).number)
      }
      // 兜底：data 一级仍是标量时也收下（接口若换版式仍能取到一部分）
      for (const [k, v] of Object.entries(data)) {
        if (v == null || typeof v === 'object') continue
        put(k, v)
      }
    }

    // ── 排行：按浏览数降序取 TOP，另挑出零浏览的滞销品 ──
    const toNum = (s: string) => {
      const n = Number.parseFloat(String(s).replace(/[^\d.]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const ranked = [...list].sort((a, b) => toNum(b.browseCnt) - toNum(a.browseCnt))
    const hot = ranked.filter(it => toNum(it.browseCnt) > 0).slice(0, 5)
    const cold = list.filter(it => toNum(it.browseCnt) === 0 && toNum(it.wantCnt) === 0).slice(0, 5)

    const fmtItem = (it: XianyuItemStat, i: number) => {
      const meta = [
        it.price ? `¥${it.price}` : '',
        it.browseCnt ? `浏览 ${it.browseCnt}` : '',
        it.wantCnt ? `想要 ${it.wantCnt}` : '',
        it.collectCnt ? `收藏 ${it.collectCnt}` : '',
        it.status ? `状态 ${it.status}` : '',
      ].filter(Boolean).join(' | ')
      return `${i + 1}. ${it.title || '（无标题）'}\n   商品ID：${it.itemId}${meta ? `\n   ${meta}` : ''}\n   链接：${it.linkUrl}`
    }

    const sections: string[] = [
      `闲鱼${mode === 'items' ? '商品明细' : '经营数据分析'}完成，共 ${list.length} 条商品。`,
      `账号：${account.display_label || account.account_id}（${shopKey}）`,
    ]

    if (mode === 'overview' && Object.keys(profile).length) {
      const profLines = Object.entries(profile).slice(0, 12).map(([k, v]) => `  - ${k}：${v}`)
      sections.push('', '【账号概况】', ...profLines)
    }

    if (mode === 'overview' && hot.length) {
      sections.push('', '【爆款 TOP（按浏览数）】', ...hot.map(fmtItem))
    }

    if (mode === 'overview' && cold.length) {
      sections.push('', '【疑似滞销（零浏览零想要）】', ...cold.map(fmtItem))
    }

    if (mode === 'items') {
      sections.push('', ...list.map(fmtItem))
    } else if (!hot.length && !cold.length) {
      sections.push('', ...list.map(fmtItem))
    }

    return {
      ok: true,
      shopKey,
      mode,
      count: list.length,
      items: list,
      profile,
      sourceUrls,
      text: sections.join('\n'),
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `闲鱼数据分析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
