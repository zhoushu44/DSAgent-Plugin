/**
 * 会话保活（P0-3，QIWork 定时续期 / 比特浏览器「定期活跃」模式）
 *
 * Cookie 登录态有服务端滑动过期：闲置 2~4 周不访问就静默失效。
 * 巡检（probe）只是「读」，不产生访问行为，续不了期 ——
 * 必须每 2~6h 用真实浏览器环境**轻访问**一次平台首页，触发服务端滑动续期，
 * 并把新下发的 Cookie（含轮换后的会话票据）回写凭证库。
 *
 * ★ 为什么必须复用账号专属 Profile（`profileDir(platform, shopKey)`）：
 *   比特浏览器经验 —— 账号保持的关键是「同一台设备定期回来」，而不是「访问」本身。
 *   用全新环境访问 = 陌生设备登录，反而是风控信号。账号 Profile 里已有
 *   localStorage / 指纹缓存 / 历史 Cookie，平台看到的是老设备。
 *
 * ★ 单飞 + 冷却（P1-2，Accio singleflight 模式，本模块内建）：
 *   - inflight Map：同一账号的保活并发调用共享同一个 Promise（巡检与手动触发撞车时）；
 *   - 失败后 60s 冷却：浏览器启动失败 / 超时大概率是环境性的（Chrome 占用、网络断），
 *     立刻重试只会再失败一次，白拉一次浏览器进程。
 *
 * 挂载：index.ts 巡检 effect 每 2h 调 runKeepaliveSweep，每个账号按
 * account_meta.last_keepalive_at 决定是否到期（错开周期，非每轮全量）。
 */

import { CredentialStore, keyCookies } from './credential-store.js'
import {
  profileDir,
  tryAcquireProfile,
  releaseProfile,
  findChromePath,
  envOf,
  applyAccountEnv,
  observeEgressIp,
} from '../browser-login.js'

/** 保活周期：48h 无轻访问即到期（报告建议 2~6h 上限，此处取宽周期，
 *  因每轮巡检 2h 扫一次，实际生效周期在 48~50h；对滑动过期 2~4 周的平台足够，
 *  且不会过于频繁地在用户机器上拉起 headless 浏览器） */
const KEEPALIVE_INTERVAL_MS = 48 * 60 * 60 * 1000

/** 保活失败后的冷却时长（P1-2：环境性失败立刻重试无意义） */
const KEEPALIVE_FAIL_COOLDOWN_MS = 60 * 1000

/** 单账号保活总超时：轻访问不该超过这个时长，超过按失败处理（锁由 finally 保证释放） */
const KEEPALIVE_TIMEOUT_MS = 90 * 1000

/** 轻访问后等待页面/服务端下发新 Cookie 的时间 */
const SETTLE_WAIT_MS = 3000

/**
 * 平台 → 轻访问目标 URL（只做「登录态可见」的首页访问，不点任何按钮、不进交易链路）。
 * 目标选择原则：已登录用户访问时服务端会校验并滑动续期会话的入口页。
 */
const KEEPALIVE_URLS: Record<string, string> = {
  taobao: 'https://www.taobao.com/',
  tmall: 'https://www.tmall.com/',
  xianyu: 'https://www.goofish.com/',
  sycm: 'https://sycm.taobao.com/',
  alimama: 'https://pub.alimama.com/',
  dmp: 'https://dmp.taobao.com/',
  sycm_insight: 'https://sycm.taobao.com/',
  jd: 'https://www.jd.com/',
  pdd: 'https://mobile.yangkeduo.com/',
  pdd_mms: 'https://mms.pinduoduo.com/',
  douyin: 'https://www.douyin.com/',
  xhs: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/',
  kuaishou: 'https://www.kuaishou.com/',
  wechat_mp: 'https://mp.weixin.qq.com/',
  zhihu: 'https://www.zhihu.com/',
}

/** Cookie 域：按平台归一化到登录态所在域（提取 Cookie 时指定，避免漏跨域票据） */
const COOKIE_DOMAINS: Record<string, string[]> = {
  xianyu: ['goofish.com', 'taobao.com'],
  // 阿里系 SSO：票据在 .taobao.com 域，业务域只下発部分
  sycm: ['taobao.com', 'sycm.taobao.com'],
  alimama: ['taobao.com', 'alimama.com'],
  dmp: ['taobao.com', 'dmp.taobao.com'],
  sycm_insight: ['taobao.com', 'sycm.taobao.com'],
  tmall: ['taobao.com', 'tmall.com'],
  pdd_mms: ['pinduoduo.com'],
}

/** 单飞表：shopKey → 进行中的保活 Promise（并发调用共享同一实例） */
const inflight = new Map<string, Promise<{ ok: boolean; skipped?: string; error?: string }>>()

/** 冷却表：shopKey → 失败冷却截止时间戳 */
const cooldownUntil = new Map<string, number>()

export interface KeepaliveResult {
  ok: boolean
  /** 跳过原因（未到期 / 冷却中 / 无 Profile / 无 URL / 锁被占） */
  skipped?: string
  error?: string
}

/**
 * 对单个账号执行一次会话保活（单飞：并发调用共享同一 Promise）。
 *
 * 流程（「注 Cookie → 轻访问 → 提取回写」三段式，同 refreshXianyuCookies）：
 *   1. 到期检查（last_keepalive_at 不足周期则 skip）+ 冷却检查
 *   2. 账号 Profile 占锁（tryAcquireProfile）—— 与登录/发布/风控验证互斥
 *   3. headless 启动 Chrome（复用账号专属 userDataDir = 老设备身份）
 *   4. 注入库内 Cookie（Profile 里可能没有最新票据）→ 轻访问平台首页
 *   5. page.cookies() 全量提取（含 HttpOnly）→ 非空值合并回 store.setCookies
 *   6. store.markKeepaliveAt 记录时间戳
 */
export function keepaliveAccount(store: CredentialStore, shopKey: string): Promise<KeepaliveResult> {
  const existing = inflight.get(shopKey)
  if (existing) return existing

  const task = (async (): Promise<KeepaliveResult> => {
    // 冷却检查（失败后 60s 内不重试）
    const cooldown = cooldownUntil.get(shopKey) ?? 0
    if (Date.now() < cooldown) {
      return { ok: false, skipped: `冷却中（${Math.ceil((cooldown - Date.now()) / 1000)}s 后可重试）` }
    }

    const account = store.get(shopKey)
    if (!account) return { ok: false, skipped: '账号不存在' }
    if (account.auth_type === 'apikey') return { ok: false, skipped: 'API Key 账号无会话可保活' }

    // 到期检查：account_meta.last_keepalive_at 距今不足周期则跳过
    const lastRaw = account.account_meta?.last_keepalive_at
    const lastMs = lastRaw ? Date.parse(String(lastRaw)) : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < KEEPALIVE_INTERVAL_MS) {
      return { ok: false, skipped: '未到期' }
    }

    // 状态检查：已确认需重登的账号保活无意义（先让用户重登）
    if (account.status === 'reauth_required' || account.status === 'invalid') {
      return { ok: false, skipped: `账号状态 ${account.status}，需重新登录` }
    }

    const platform = account.platform
    const url = KEEPALIVE_URLS[platform]
    if (!url) return { ok: false, skipped: `平台 ${platform} 暂不支持保活` }

    // Cookie 注入判据：库内关键 Cookie 必须存在（没有登录态，访问只是匿名浏览）
    const needed = keyCookies(platform)
    const jar = account.cookies || {}
    if (needed.length && !needed.some(k => jar[k])) {
      return { ok: false, skipped: '库内无关键 Cookie，无可注入的登录态' }
    }

    // ★ 账号 Profile 占锁：与登录 / 发布 / 风控验证 / 数据分析互斥（Chrome 独占锁）
    const dir = profileDir(platform, shopKey)
    const owner = `keepalive:${shopKey}`
    if (!tryAcquireProfile(dir, owner)) {
      return { ok: false, skipped: `Profile 正被占用（${owner} 拿锁失败）` }
    }

    try {
      const result = await keepaliveVisit(store, shopKey, platform, dir, url, jar, account)
      if (!result.ok) {
        cooldownUntil.set(shopKey, Date.now() + KEEPALIVE_FAIL_COOLDOWN_MS)
      } else {
        cooldownUntil.delete(shopKey)
      }
      return result
    } finally {
      releaseProfile(dir)
    }
  })().finally(() => {
    inflight.delete(shopKey)
  })

  inflight.set(shopKey, task)
  return task
}

/**
 * 轻访问 + Cookie 提取回写（不带锁逻辑，由 keepaliveAccount 保证串行）。
 */
async function keepaliveVisit(
  store: CredentialStore,
  shopKey: string,
  platform: string,
  userDataDir: string,
  url: string,
  jar: Record<string, string>,
  account: { account_meta?: Record<string, any> },
): Promise<KeepaliveResult> {
  const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as {
    launch: (opts: any) => Promise<any>
  }
  const chromePath = findChromePath()
  if (!chromePath) return { ok: false, error: '未找到 Chrome 或 Edge 浏览器' }

  const browser = await withTimeout(
    puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      userDataDir,
      // CDP 单命令超时：损坏的 Profile 会让 CDP 握手永久挂起
      protocolTimeout: 30_000,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
      ],
    }),
    KEEPALIVE_TIMEOUT_MS,
  )

  try {
    const page = await browser.newPage()
    // P1-3：保活也按账号绑定的 env 设置 viewport / 时区（无 env 时回退默认）
    await applyAccountEnv(page, envOf(account))
    // 反自动化检测（同 refreshXianyuCookies）
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 1) 注入库内登录态（Profile 中可能没有最新票据；缺失会导致服务端视为匿名访问）。
    //    每项至少带 domain 或 url，否则 puppeteer 报 "At least one of the url and domain needs to be specified"。
    const fallbackDomain = cookieDomainFor(platform) ?? cookieDomainFromUrl(url)
    const cookieList = Object.entries(jar)
      .filter(([, v]) => v != null && v !== '')
      .map(([name, value]) => {
        const item: Record<string, string> = { name, value: String(value), path: '/' }
        if (fallbackDomain) item.domain = fallbackDomain
        return item
      })
    if (cookieList.length > 0) {
      await page.setCookie(...cookieList)
    }

    // 2) 轻访问：domcontentloaded 即可 —— 服务端会话校验发生在请求握手阶段，
    //    不需要等 JS 渲染完（networkidle 等待久且易被轮询接口卡超时）。
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // 3) 停留片刻：让页面内的 SSO 跳转 / 票据轮换请求完成，再取 Cookie
    await new Promise(r => setTimeout(r, SETTLE_WAIT_MS))

    // 4) 提取 Cookie（含 HttpOnly；按平台指定域，避免漏跨域票据）
    const domains = COOKIE_DOMAINS[platform] ?? [new URL(url).hostname.replace(/^www\./, '')]
    const urls = domains.map(d => `https://${d}`)
    const extracted = await page.cookies(...urls)
    const fresh: Record<string, string> = {}
    for (const c of extracted) {
      if (c.value != null && c.value !== '') fresh[c.name] = c.value
    }

    // 5) 回写（setCookies 内建「空值不覆盖非空值」保护，这里只传非空值）
    if (Object.keys(fresh).length > 0) {
      await store.setCookies(shopKey, fresh)
    }
    await store.markKeepaliveAt(shopKey)
    // P1-3：保活时顺便观测出口 IP（进程级节流，不会每轮都打外网）
    await observeEgressIp(store, shopKey)

    // 关键 Cookie 仍在 = 登录态活着（被平台踢下线则关键 Cookie 会被清掉/轮换失败）
    const stillLoggedIn = neededCookiesPresent(fresh, platform) || neededCookiesPresent(jar, platform)
    console.log(
      `[dsagent-keepalive] ${shopKey} 轻访问完成：提取 ${Object.keys(fresh).length} 个 Cookie，` +
      `登录态=${stillLoggedIn ? '存活' : '疑似失效'}`,
    )

    return { ok: true }
  } finally {
    // close 也限时：Chrome 卡死（弹系统对话框 / 崩溃半截）时 close() 可能永不 resolve，
    // Profile 锁会跟着永久持有 —— 限时后放弃优雅关闭，进程由随后的强制兜底处理。
    try {
      await withTimeout(browser.close(), 10_000)
    } catch {
      try { await browser.process()?.kill() } catch { /* 已退出 */ }
    }
  }
}

/** Cookie 注入域：按平台给出（阿里系统一 .taobao.com；无映射时从保活 URL 提取域名） */
function cookieDomainFor(platform: string): string | undefined {
  const domains = COOKIE_DOMAINS[platform]
  if (domains?.length) return `.${domains[0]}`
  return undefined
}

/** 从 URL 提取顶级域名作为 cookie domain 回退（确保 setCookie 每项有 domain） */
function cookieDomainFromUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host ? `.${host}` : undefined
  } catch {
    return undefined
  }
}

/** 提取结果中关键 Cookie 是否齐备 */
function neededCookiesPresent(jar: Record<string, string>, platform: string): boolean {
  const needed = keyCookies(platform)
  if (!needed.length) return true
  return needed.some(k => jar[k])
}

/**
 * 保活总超时包装：轻访问卡死（如 Chrome 弹了系统对话框）时不至于永久占锁。
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`保活超时（${ms / 1000}s）`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * 保活扫描（挂载点：index.ts 巡检 effect，每 2h 一次）。
 *
 * - 只挑 cookie 鉴权、状态可用、且 keepalive 已到期的账号；
 * - **逐账号串行**执行（不并行拉 N 个 Chrome：内存 / CPU / 平台风控三重考量）；
 * - 单账号失败不影响后续账号；整体永不抛错（保活是增益行为，不能阻断巡检）。
 */
export async function runKeepaliveSweep(store: CredentialStore): Promise<{ total: number; done: number; failed: number }> {
  let done = 0
  let failed = 0
  let total = 0

  try {
    const accounts = store.listAccounts().filter(a => {
      if (a.auth_type === 'apikey') return false
      if (a.status === 'reauth_required' || a.status === 'invalid' || a.status === 'pending') return false
      if (!KEEPALIVE_URLS[a.platform]) return false
      const lastRaw = a.account_meta?.last_keepalive_at
      const lastMs = lastRaw ? Date.parse(String(lastRaw)) : NaN
      // 从未保活或已过期的才进本轮（keepaliveAccount 内还会再查一次，双保险）
      return !Number.isFinite(lastMs) || Date.now() - lastMs >= KEEPALIVE_INTERVAL_MS
    })

    total = accounts.length
    for (const account of accounts) {
      try {
        const result = await keepaliveAccount(store, account.shop_key)
        if (result.ok) {
          done += 1
        } else if (!result.skipped) {
          failed += 1
          console.warn(`[dsagent-keepalive] ${account.shop_key} 保活失败: ${result.error}`)
        }
      } catch (err) {
        failed += 1
        console.warn(
          `[dsagent-keepalive] ${account.shop_key} 保活异常: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      // 账号间错开 3~8s：避免多账号同秒访问被平台关联识别为批量行为
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000))
    }
  } catch (err) {
    console.warn(`[dsagent-keepalive] 扫描异常（不影响巡检）: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (total > 0) {
    console.log(`[dsagent-keepalive] 本轮保活扫描：候选 ${total}，成功 ${done}，失败 ${failed}`)
  }
  return { total, done, failed }
}
