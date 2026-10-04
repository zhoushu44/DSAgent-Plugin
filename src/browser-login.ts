/**
 * 浏览器登录核心逻辑 — 供 host 工具和 browser 半区 HTTP 路由共用。
 *
 * 动态导入 puppeteer-core，连接本机 Chrome，导航到登录页，轮询关键 Cookie。
 */
import { CredentialStore, keyCookies, credentialPlatform, isRiskPassCookie } from './services/credential-store.js'
import { clearRiskCooldown, probePlatformPermission, invalidateGatewayCache } from './gateway-proxy.js'
import * as authOp from './services/auth-operation.js'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * 活跃浏览器实例。
 *
 * 登录窗口额外记录 `page` / `userDataDir` / `platform` / `freshLogin`：
 * 登录超时后窗口**不关闭**（FIX-LOG #66），下次调用同一平台登录时可复用这个窗口继续等待，
 * 不必重新启动浏览器、也不会撞上 Chrome 的 userDataDir 独占锁。
 */
interface ActiveBrowserHandle {
  close: () => Promise<void>
  browser?: any
  page?: any
  userDataDir?: string
  platform?: string
  freshLogin?: boolean
}

/** 活跃浏览器实例 */
let activeBrowser: ActiveBrowserHandle | null = null

/**
 * 关闭当前活跃浏览器，并释放它占用的 Profile 锁。
 *
 * 所有关闭路径统一走这里，避免「关了浏览器却漏放锁」导致该平台后续任务全部被拒。
 */
async function closeActiveBrowser(): Promise<void> {
  const current = activeBrowser
  if (!current) return
  try { await current.close() } catch { /* 忽略 */ }
  activeBrowser = null
  if (current.userDataDir) releaseProfile(current.userDataDir)
}

/**
 * 正在被占用的浏览器 Profile 目录（key = 绝对路径，value = 占用者描述）。
 *
 * Chrome 的 userDataDir 是独占锁：同一目录二次 puppeteer.launch 必报
 * "Failed to launch the browser process!"（FIX-LOG #50）。
 *
 * ★ 锁必须按【目录】划分，而不是按【模块】划分：
 *   风控验证（riskVerify）、闲鱼发布（xianyu-publish）、闲鱼数据分析（xianyu-analytics）
 *   对同一个闲鱼账号都会落到同一个账号目录（accounts/{shopKey}），若各自持有模块级
 *   busy 标志，则彼此完全看不见，第二个启动的必然撞锁失败。
 *   故统一收口到本模块（profileDir 的所有者），
 *   让所有使用同一目录的调用方共享同一把锁。
 *
 * 用法：tryAcquireProfile(dir, 占用者描述) 成功后，必须在 finally 中 releaseProfile(dir)。
 * releaseProfile 幂等，可安全重复调用。
 */
/**
 * Profile 占用表：**引用计数**（吸收 Accio 的 borrower Map 语义）。
 *
 * 改造前是一个 `Map<dir, owner>` 的布尔锁：同一目录被重复占用时第二次直接失败，
 * 而重复释放会把锁**提前**解开 —— 若同一逻辑操作（如登录成功后收编目录：
 * 先 release 旧目录、再 acquire 新目录）中途被中断，锁状态就可能与实际不符。
 *
 * 改为引用计数后：
 *   - 相同 owner 重复 acquire → 计数 +1（幂等，不误报「被占用」）
 *   - 不同 owner acquire     → 仍然失败（Chrome 的 userDataDir 是独占锁，这个不可放宽）
 *   - release               → 计数 -1，**归零才真正释放**
 *
 * Accio 的 borrower 机制允许多个消费者共享同一个浏览器实例；本插件因 Chrome
 * 独占锁的限制无法共享**进程**，但「多消费者计数、最后一个才释放」这个语义是
 * 完全适用的，且能避免重复 release 提前解锁导致的串号风险。
 */
interface ProfileHold {
  /** 占用者描述（最近一次 acquire 的名字，用于提示文案） */
  owner: string
  /** 引用计数：归零才真正释放 */
  count: number
  /** 所有占用者（Accio 的 borrowers Map 对应物），便于排障 */
  borrowers: Set<string>
}

const busyProfiles = new Map<string, ProfileHold>()

/**
 * 尝试占用 Profile 目录。
 *
 * @returns true = 占用成功（含同 owner 重复占用的幂等情形）；
 *          false = 已被**其他**占用者持有，调用方应给出可读提示
 */
export function tryAcquireProfile(dir: string, owner: string): boolean {
  const held = busyProfiles.get(dir)
  if (held) {
    // 同一占用者重复 acquire：计数 +1，视为成功（避免自我阻塞）
    if (held.owner === owner) {
      held.count += 1
      held.borrowers.add(owner)
      return true
    }
    // 不同占用者：Chrome 的 userDataDir 独占，必须拒绝
    return false
  }
  busyProfiles.set(dir, { owner, count: 1, borrowers: new Set([owner]) })
  return true
}

/** 释放 Profile 目录占用（**引用计数归零才真正释放**；幂等，可安全重复调用） */
export function releaseProfile(dir: string): void {
  const held = busyProfiles.get(dir)
  if (!held) return
  held.count -= 1
  if (held.count <= 0) busyProfiles.delete(dir)
}

/** 查询 Profile 目录当前的占用者描述（用于提示文案） */
export function profileOwner(dir: string): string | undefined {
  return busyProfiles.get(dir)?.owner
}

/** 查询某目录的全部占用者（Accio borrower Map 的对应物，用于排障与清理决策） */
export function profileBorrowers(dir: string): string[] {
  const held = busyProfiles.get(dir)
  return held ? [...held.borrowers] : []
}

/** 该目录是否正被占用（任意引用计数 > 0） */
export function isProfileBusy(dir: string): boolean {
  return busyProfiles.has(dir)
}

/**
 * 记录「本 Profile 目录当前对应的 CDP 调试端口」，用于端口归属校验。
 *
 * 背景（吸收 Accio 的 `ChromePortOwnershipError`）：
 * `taobao-publish` 会读 `userDataDir/DevToolsActivePort` 拿到端口后直接
 * `puppeteer.connect({ browserURL: 'http://127.0.0.1:<port>' })` 以复用已开窗口。
 * 但那个文件**可能是陈旧的**（上次崩溃残留、目录被复制过），
 * 于是端口可能属于**另一个 Profile 的浏览器** —— 连上去会在错误的浏览器里操作，
 * 后果是「在别的账号的窗口里点了发布」，属于最危险的一类串号事故。
 *
 * 这里记录“目录 → 端口”的归属，配合 `verifyPortOwnership()` 在 connect 前校验。
 */
const profilePorts = new Map<string, number>()

/** 登记某 Profile 的 CDP 端口（启动浏览器后调用） */
export function registerProfilePort(dir: string, port: number): void {
  if (!dir || !Number.isInteger(port) || port <= 0) return
  profilePorts.set(dir, port)
}

/** 查询某目录登记的端口（无记录返回 undefined） */
export function registeredPortFor(dir: string): number | undefined {
  return profilePorts.get(dir)
}

/**
 * 校验「这个端口是否确实属于这个 Profile 目录」。
 *
 * 规则（从严，避免串号）：
 *   1. 该目录**没有**登记过端口 —— 可能是上次运行留下的进程（重启后内存表为空），
 *      此时无法证明归属。返回 `'unknown'`，由调用方决定是否仍要复用
 *      （当前策略：允许复用，因为「用户要求不要反复开关浏览器」是明确诉求，
 *        且 connect 前还会走 Profile 文件锁；但把结果记进日志便于排查串号）。
 *   2. 该目录登记过端口，且与待连端口**一致** —— `'match'`，可安全复用。
 *   3. 该目录登记过端口，但**不一致** —— `'mismatch'`，说明端口来自别的 Profile，
 *      **必须拒绝复用**，否则会在别的账号窗口里操作。
 */
export type PortOwnership = 'match' | 'unknown' | 'mismatch'

export function verifyPortOwnership(dir: string, port: number): PortOwnership {
  const registered = profilePorts.get(dir)
  if (registered === undefined) return 'unknown'
  return registered === port ? 'match' : 'mismatch'
}

/** 释放某目录的端口登记（关闭浏览器后调用） */
export function unregisterProfilePort(dir: string): void {
  profilePorts.delete(dir)
}

/**
 * 清理 Chrome 遗留的 Profile 锁文件。
 *
 * 上一次验证的浏览器被强杀 / 崩溃时，userDataDir 里的 SingletonLock 等会残留，
 * 导致下次 puppeteer.launch 直接失败。启动前清一遍 + 失败后清一遍重试。
 */
export function clearProfileLocks(dir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try { rmSync(join(dir, name), { force: true }) } catch { /* 不存在或正被占用 */ }
  }
}

/**
 * 获取多域名 Cookie（阿里系 SSO 关键修复）。
 *
 * Puppeteer 的 page.cookies() 不传域名时只返回当前页面域的 Cookie。
 * 阿里系 SSO 登录后，unb 等 Cookie 写在 .taobao.com 域，
 * 而闲鱼登录后 Cookie 写在 .goofish.com 域。
 * 必须指定所有相关域名才能拿到完整 Cookie 集。
 */
async function getAllDomainCookies(page: any, platform: string): Promise<{ name: string; value: string }[]> {
  const credPlatform = credentialPlatform(platform)
  const domainMap: Record<string, string[]> = {
    taobao: ['https://.taobao.com', 'https://.tmall.com'],
    tmall: ['https://.taobao.com', 'https://.tmall.com'],
    xianyu: ['https://.taobao.com', 'https://.goofish.com'],
    sycm: ['https://.taobao.com'],
    alimama: ['https://.taobao.com'],
    dmp: ['https://.taobao.com'],
    sycm_insight: ['https://.taobao.com'],
    // 拼多多：登录票据（PDDAccessToken / pdd_user_id）写在 `mobile.yangkeduo.com` 域，
    // 不传域名时 `page.cookies()` 只能取到当前页域，容易漏；显式列全相关域。
    pdd: ['https://mobile.yangkeduo.com', 'https://.yangkeduo.com', 'https://.pinduoduo.com'],
    // 拼多多商家后台：登录票据 PASS_ID 写在 mms.pinduoduo.com / .pinduoduo.com 域，
    // 与买家 H5（mobile.yangkeduo.com）不共享，必须显式列全。
    pdd_mms: ['https://mms.pinduoduo.com', 'https://.pinduoduo.com'],
  }
  const domains = domainMap[credPlatform] || domainMap[platform] || []
  if (domains.length > 0) {
    // Puppeteer 支持传入多个 URL 来获取对应域的 Cookie
    return await page.cookies(...domains)
  }
  return await page.cookies()
}

/**
 * 小红书登录态实证（浏览器内同域 fetch SSR HTML）。
 *
 * 为什么不能用 Cookie 判据：实测 headful 浏览器访问 /explore 时，页面 JS 会为
 * **匿名访客**写入 `web_session`（2s 内即出现；同一 URL 在 headless 下 10s 都不出现），
 * 因此 `KEY_COOKIES.xhs = ['web_session']` 对「已登录」与「匿名」毫无区分度 ——
 * 轮询第 1 轮（2s）就判「登录成功」→ 立即关窗 → 用户根本没机会扫码（FIX-LOG #63）。
 *
 * 小红书 /api/sns/** 需要 jsvmp 签名（无签名恒 HTTP 406），不能直接调；
 * 但首页 SSR HTML 里内联了 `"user":{"loggedIn":true|false,...}`，同域 fetch 即可读到，
 * 无需签名、不经过 host 网关（不吃账号节流），是可靠的实证判据。
 */
async function verifyXhsLoggedIn(page: any): Promise<boolean> {
  try {
    const res = await page.evaluate(async () => {
      try {
        const r = await fetch('https://www.xiaohongshu.com/explore', {
          credentials: 'include',
          headers: { accept: 'text/html,application/xhtml+xml' },
        })
        if (!r.ok) return { ok: false, status: r.status }
        const html = await r.text()
        const normalized = html.replace(/\\"/g, '"')
        const seg = normalized.match(/"user"\s*:\s*\{\s*"loggedIn"\s*:\s*(?:true|false)[\s\S]{0,600}/)
        if (!seg) return { ok: false, status: r.status, reason: '响应缺少 user 字段' }
        return {
          ok: true,
          loggedIn: /"loggedIn"\s*:\s*true/.test(seg[0]),
          guest: /"guest"\s*:\s*true/.test(seg[0]),
        }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    })
    if (!res || res.ok !== true) return false
    return res.loggedIn === true && res.guest !== true
  } catch {
    return false
  }
}

/** 查找本机 Chrome 可执行文件 */
export function findChromePath(): string | undefined {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find(p => p && existsSync(p))
}

/** 浏览器 Profile 根目录 —— 所有 userDataDir 都在此之下 */
function profilesRoot(): string {
  const root = join(homedir(), '.dsh', 'browser-profiles')
  try { mkdirSync(root, { recursive: true }) } catch { /* 已存在 */ }
  return root
}

/**
 * 账号专属 Profile 路径（只算路径，不建目录 —— 供「判存在 / 迁移」使用）。
 *
 * ★ 只认 shopKey、不再叠一层平台名：淘宝与天猫共用同一套登录态（同一个 shop_key），
 *   若路径里再带平台维度，同一账号从两个入口进来就会落到两个环境，设备身份照样分裂。
 */
function accountProfilePath(shopKey: string): string {
  return join(profilesRoot(), 'accounts', shopKey)
}

/**
 * 生成浏览器用户数据目录（Profile 隔离）。
 *
 * 传 shopKey → **账号专属**目录 `browser-profiles/accounts/{shopKey}`：
 * 同一账号无论登录 / 发布 / 采集 / 风控验证，永远复用同一个 Chrome 环境。
 * 环境（Cookie、缓存、localStorage、硬件指纹缓存）稳定不变，平台才会把每次访问
 * 都当作「老设备回来了」—— 这正是指纹浏览器「账号长期保持」的真正来源。
 *
 * 不传 shopKey → 历史【平台级】目录 `browser-profiles/{platform}`：
 * 仅剩「登录前还不知道是哪个账号」的场景（扫码前无法派生 account_id）。
 */
export function profileDir(platform: string, shopKey?: string): string {
  const base = shopKey ? accountProfilePath(shopKey) : join(profilesRoot(), platform)
  try { mkdirSync(base, { recursive: true }) } catch { /* 已存在 */ }
  return base
}

/**
 * 把一次性登录 Profile「收编」为账号专属 Profile（登录成功后调用，返回最终目录）。
 *
 * 新账号扫码前派生不出 account_id，只能用一次性干净目录（freshProfileDir）；
 * 若不收编，该目录会在下一次「添加其他账号」时被当作历史垃圾清掉，
 * 这个账号的设备身份就永远是一次性的 —— 帐号级隔离等于白做。
 *
 * 目标目录已存在时保留既有环境（设备身份更老、平台更认），丢掉本次一次性环境。
 * 迁移失败不影响本次登录结果，下次登录会直接落到账号目录。
 */
function adoptProfileDir(fromDir: string, shopKey: string): string {
  if (!fromDir || !shopKey) return fromDir
  const target = accountProfilePath(shopKey)
  if (fromDir === target) return target
  try {
    if (existsSync(target)) {
      rmSync(fromDir, { recursive: true, force: true })
      return target
    }
    mkdirSync(join(profilesRoot(), 'accounts'), { recursive: true })
    renameSync(fromDir, target)
    console.log(`[dsagent-login] Profile 已收编为账号专属: ${target}`)
    return target
  } catch (err) {
    console.log(`[dsagent-login] Profile 收编失败（不影响登录）: ${err instanceof Error ? err.message : String(err)}`)
    return fromDir
  }
}

/**
 * 删除账号专属 Profile（删除账号时调用，尽力而为）。
 *
 * 为何要删：账号级 Profile 就是「这台设备属于这个号」，账号删了它没有服务对象；
 * 且路径由 shopKey 决定、可确定性重建，同一个号将来重新接入会命中这里的残留 Cookie，
 * 而用户点「删除账号」的预期是干净。
 *
 * ★ 只负责删目录，不碰凭证：调用方必须先删凭证成功再调本函数 ——
 *   Profile 删不掉（如 Chrome 正在跑该账号的任务）不应该牵连账号本身删不掉。
 */
export function removeAccountProfile(shopKey: string): { cleaned: boolean; note?: string } {
  if (!shopKey) return { cleaned: false, note: '缺少 shopKey' }
  const target = accountProfilePath(shopKey)
  // 本来就没有 → 目标状态（无残留）已达成，算清理成功
  if (!existsSync(target)) return { cleaned: true, note: '无本地 Profile' }
  const owner = busyProfiles.get(target)
  if (owner) return { cleaned: false, note: `该账号正在运行任务（${owner}），Profile 未清理` }
  try {
    rmSync(target, { recursive: true, force: true })
    console.log(`[dsagent-login] 账号 Profile 已删除: ${target}`)
    return { cleaned: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`[dsagent-login] 账号 Profile 删除失败: ${msg}`)
    return { cleaned: false, note: msg }
  }
}

/**
 * 「添加其他账号」专用的一次性干净 Profile 目录。
 *
 * 背景（FIX-LOG #51）：扫码前派生不出 account_id，登录窗口只能落到平台级目录，
 * 而平台级目录里可能已经有**另一个账号**的登录态 —— 导航到登录页后第一轮轮询（2s）
 * 就发现关键 Cookie 齐全 → 误判「登录成功」→ 立即关窗，
 * 用户观感是「登录其他账号直接就关闭了」，根本没机会扫码。
 *
 * 因此「添加其他账号」必须使用全新的空 Profile，登录页才会真正弹出扫码界面。
 * 目录名带时间戳保证每次干净；启动前清理同平台的历史一次性目录避免堆积
 * （登录成功的一次性目录会被 adoptProfileDir 收编到账号名下，不会留在这里被清）。
 */
function freshProfileDir(platform: string): string {
  const root = profilesRoot()
  try {
    for (const name of readdirSync(root)) {
      if (name.startsWith(`${platform}-new-`)) {
        try { rmSync(join(root, name), { recursive: true, force: true }) } catch { /* 正被占用，忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
  const dir = join(root, `${platform}-new-${Date.now()}`)
  try { mkdirSync(dir, { recursive: true }) } catch { /* 已存在 */ }
  return dir
}

/**
 * 登录等待基础时长：5 分钟。
 *
 * 原值 120s 对「扫码 + 手机上确认」远远不够：找手机、打开 App、二次确认都可能超过 2 分钟，
 * 结果用户明明登录成功了却被告知「超时」（FIX-LOG #66）。
 */
const LOGIN_TIMEOUT_MS = 300_000

/**
 * 检测到用户操作（鼠标 / 键盘 / 滚动 / 拖动滑块）时，把截止时间顺延到「此刻 + 本值」。
 *
 * 滑块验证期间用户会持续拖动鼠标，若仍按固定倒计时，人还没拖完就被判超时。
 * 只要还在操作就继续等，操作停止后才真正开始倒计时（FIX-LOG #66）。
 */
const LOGIN_ACTIVITY_EXTEND_MS = 90_000

/** 登录等待硬上限：即便用户一直在操作，最多等 15 分钟，避免窗口永挂 */
const LOGIN_MAX_TIMEOUT_MS = 900_000

/**
 * 未完成的登录会话（超时后不关窗，允许用户继续）。
 *
 * 超时不再关窗，而是记住本次使用的 Profile 目录；用户完成扫码后再次调用
 * dsagent_browser_login，会复用同一个 Profile（登录态已写入其中）→ 首轮轮询即命中，
 * 不会丢失用户已经完成的登录进度（FIX-LOG #66）。
 */
let activeLogin: { platform: string; freshLogin: boolean; userDataDir: string } | null = null

export async function doBrowserLogin(
  platform: string,
  loginUrl: string,
  store: CredentialStore,
  opts?: {
    freshLogin?: boolean
    replaceShopKey?: string
    /**
     * 可选的 operation ID（见 services/auth-operation.ts）。
     *
     * 传了就把本次登录的各阶段上报给该 operation，模型可 poll 看进度。
     * **不传则行为与改造前完全一致** —— 这条兼容性是刻意的：登录内核是
     * 经过大量实测调优的路径，新增能力必须是「旁挂」而非「替换」。
     */
    operationId?: string
  },
): Promise<{ ok: boolean; error?: string; text?: string; shopKey?: string; accountId?: string }> {
  const opId = opts?.operationId
  const rep = (phase: authOp.AuthPhase, msg: string, extra?: Parameters<typeof authOp.report>[3]) =>
    authOp.report(opId, phase, msg, extra)

  if (!platform || !loginUrl) {
    rep('failed', '缺少 platform 或 loginUrl', { error: '缺少 platform 或 loginUrl' })
    return { ok: false, error: '缺少 platform 或 loginUrl' }
  }
  const freshLogin = opts?.freshLogin === true
  const replaceShopKey = opts?.replaceShopKey || undefined

  // 上一次登录超时后窗口是「保持打开」的：若平台与模式都一致，复用当时的 Profile
  // （用户可能已经在那个窗口里完成了扫码，登录态就写在这个目录里）。
  const resuming = activeLogin?.platform === platform && activeLogin?.freshLogin === freshLogin

  // ★ 登录窗口同样占用该账号的 Profile 目录，必须与其他使用同目录的工具（发布 / 数据分析 /
  //   风控验证）共享同一把锁，否则会撞上 Chrome 的 userDataDir 独占锁而启动失败。
  let lockedDir: string | null = null

  try {
    // 动态导入 puppeteer-core
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }

    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, error: '未找到 Chrome 或 Edge 浏览器，请先安装 Chrome' }
    }
    console.log(`[dsagent-login] 使用浏览器: ${chromePath}`)

    // 续登：上次超时后窗口保持打开、Profile 里可能已经写入了登录态。
    // 复用当时的目录（而不是新建），用户「重新点一次登录」即可命中，不必重新扫码（FIX-LOG #66）。
    if (resuming && activeLogin) {
      console.log(`[dsagent-login] 检测到上次未完成的登录会话，复用 Profile: ${activeLogin.userDataDir}`)
    }

    if (activeBrowser) {
      await closeActiveBrowser()
    }

    // Profile 隔离：每个账号独立 userDataDir，避免同平台多号 Cookie 串扰。
    // 重新登录（已知 replaceShopKey）→ 直接回到该账号的专属环境（设备身份延续）。
    // 添加其他账号（freshLogin）→ 必须用全新空 Profile，否则会复用已登录态秒判成功。
    // 其余（首次接入某平台，扫码前无法识别账号）→ 平台级目录兜底，登录成功后收编为账号目录。
    // 注意：续登时不能调用 freshProfileDir —— 它启动前会清理同平台历史目录，会把要复用的目录删掉。
    const userDataDir = resuming && activeLogin
      ? activeLogin.userDataDir
      : freshLogin
        ? freshProfileDir(platform)
        : profileDir(platform, replaceShopKey)
    console.log(`[dsagent-login] 使用 Profile 目录: ${userDataDir}${freshLogin ? '（添加其他账号：全新环境）' : ''}`)

    const busyOwner = profileOwner(userDataDir)
    if (!tryAcquireProfile(userDataDir, '登录窗口')) {
      return {
        ok: false,
        error: `平台 ${platform} 的浏览器环境正被「${busyOwner || '其他任务'}」占用，`
          + `请先等待该任务结束（或关闭已弹出的浏览器窗口）后再登录。`,
      }
    }
    lockedDir = userDataDir

    const browser = await puppeteer.launch({
      headless: false,
      executablePath: chromePath,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
      ],
    })

    const page = await browser.newPage()
    // 不覆盖 UA：用本机真实 Chrome 的 UA，才能与内核自动发出的 sec-ch-ua / navigator.userAgentData 保持一致。
    // 硬改 UA 会造成「UA 声称 Chrome/120、Client Hints 暴露真实版本」的自相矛盾，反而是最容易被识别的特征。
    await page.setViewport({ width: 1440, height: 900 })

    // 反自动化检测：隐藏 webdriver 标志
    // 同时埋一个「用户操作计数器」：页面内的点击/按键/滚动/拖动鼠标都会累加，
    // 供轮询判断「用户正在操作」→ 有操作就续时，不把正在扫码的用户误判成超时（FIX-LOG #66）。
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      const w = window as unknown as Record<string, unknown>
      w.__dsaActivity = 0
      const bump = () => { w.__dsaActivity = ((w.__dsaActivity as number) || 0) + 1 }
      for (const ev of ['mousedown', 'mousemove', 'keydown', 'scroll', 'click', 'touchstart']) {
        window.addEventListener(ev, bump, { passive: true, capture: true })
      }
    })

    activeBrowser = {
      close: async () => {
        try { await page.close() } catch { /* 忽略 */ }
        try { await browser.close() } catch { /* 忽略 */ }
      },
      browser,
      page,
      userDataDir,
      platform,
      freshLogin,
    }

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 抖音：主页加载后需要点击"登录"按钮弹出登录窗
    // 使用 page.mouse.click() 在坐标上点击，避免 ElementHandle detached 问题
    if (platform === 'douyin') {
      try {
        await page.waitForSelector('button', { timeout: 10000 })
        // 等待页面完全渲染
        await new Promise(r => setTimeout(r, 1000))
        // 在页面上查找"登录"按钮并获取其坐标
        const buttonInfo = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'))
          for (const b of btns) {
            if (b.textContent?.trim() === '登录') {
              const rect = b.getBoundingClientRect()
              return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            }
          }
          // 备用：.semi-button-primary 类
          const altBtns = Array.from(document.querySelectorAll('.semi-button-primary'))
          for (const b of altBtns) {
            if (b.textContent?.trim() === '登录') {
              const rect = b.getBoundingClientRect()
              return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            }
          }
          return { found: false }
        })
        if (buttonInfo.found) {
          console.log(`[dsagent-login] 抖音登录按钮找到，坐标 (${buttonInfo.x}, ${buttonInfo.y})，点击`)
          await page.mouse.click(buttonInfo.x, buttonInfo.y)
          // 等待登录弹窗出现
          await page.waitForSelector('.douyin_login_new_class', { timeout: 10000 }).catch(() => {})
          await new Promise(r => setTimeout(r, 1000))
        } else {
          console.log(`[dsagent-login] 抖音登录按钮未找到`)
        }
      } catch { /* 忽略 */ }
    }

    const kc = keyCookies(platform)
    const credPlatform = credentialPlatform(platform)
    const pollIntervalMs = 2000
    const startTime = Date.now()

    // 截止时间而非固定总时长：用户每有操作就把 deadline 顺延到「此刻 + LOGIN_ACTIVITY_EXTEND_MS」，
    // 滑块验证期间持续拖动鼠标就不会被判超时；同时用硬上限防止窗口永挂（FIX-LOG #66）。
    let deadline = startTime + LOGIN_TIMEOUT_MS
    const hardDeadline = startTime + LOGIN_MAX_TIMEOUT_MS
    let lastActivity = 0

    // 小红书的关键 Cookie（web_session）对匿名访客也会下发，无区分度，
    // 必须改用浏览器内 SSR 实证判据（见 verifyXhsLoggedIn 注释）。
    const useSsrCheck = credPlatform === 'xhs'

    let loginSuccess = false
    let cookies: { name: string; value: string }[] = []
    // 归因证据：区分「用户压根没登录」/「卡在滑块验证」/「登录了但没权限」
    let sawSlider = false
    let lastUrl = ''

    // 进入等待用户阶段（上报给 operation，模型据此把控制权交还用户）
    rep('waiting_user', '已打开登录页，等待用户完成扫码 / 滑块验证')
    /** 滑块上报只做一次，避免每 2s 刷一条相同的阶段消息 */
    let sliderReported = false

    while (Date.now() < deadline) {
      // ★ 取消感知：模型/用户 cancel 后尽快退出循环，不要空等到超时。
      //   退出前不关窗（与超时一致），让 cancelOperation 的 onCancel 决定怎么处理窗口。
      if (authOp.isCancelled(opId)) {
        rep('cancelled', '已取消登录等待')
        return { ok: false, error: '登录已被取消' }
      }
      await new Promise(r => setTimeout(r, pollIntervalMs))
      try {
        // 阿里系 SSO 关键修复：page.cookies() 必须指定域名，否则拿不到跨域 Cookie
        cookies = await getAllDomainCookies(page, platform)
        const jar: Record<string, string> = {}
        for (const c of cookies) jar[c.name] = c.value

        lastUrl = page.url() || lastUrl

        // 有操作就续时：页面内的操作计数器（见 evaluateOnNewDocument）递增即视为用户在操作
        try {
          const activity: number = await page.evaluate(() => ((window as unknown as Record<string, number>).__dsaActivity || 0))
          if (activity > lastActivity) {
            lastActivity = activity
            const next = Math.min(Date.now() + LOGIN_ACTIVITY_EXTEND_MS, hardDeadline)
            if (next > deadline) deadline = next
          }
        } catch { /* 页面导航中读取失败，忽略 */ }

        // 归因证据采集：滑块验证 / 风控页特征（用于失败时给出准确指引）
        if (!sawSlider) {
          try {
            const bodyText: string = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '')
            const html: string = await page.evaluate(() => document.documentElement?.outerHTML?.slice(0, 3000) || '')
            const probe = `${bodyText} ${html}`
            if (/nc_1_n1z|nc_iconfont|nc-container|nocaptcha|请按住滑块|拖动滑块|slide-to-unlock/i.test(probe)) {
              sawSlider = true
              console.log(`[dsagent-login] 检测到滑块验证元素，判定为「等待人工验证」`)
              // 把「卡在验证」这件事显式上报，模型才能给出「请拖动滑块」而不是「请扫码」
              if (!sliderReported) {
                sliderReported = true
                rep('waiting_user', '检测到平台安全验证（滑块），请在浏览器窗口中手动拖动滑块完成验证', {
                  detail: { sawSlider: true },
                })
              }
            }
          } catch { /* 忽略 */ }
        }

        if (useSsrCheck) {
          // 小红书：Cookie 齐 ≠ 已登录，用 SSR 实证（loggedIn 且非 guest）
          const loggedIn = await verifyXhsLoggedIn(page)
          console.log(`[dsagent-login] poll ${Math.round((Date.now() - startTime) / 1000)}s | total=${cookies.length} | SSR loggedIn=${loggedIn} | url=${page.url()?.slice(0, 80)}`)
          if (loggedIn) {
            console.log(`[dsagent-login] 小红书 SSR 实证已登录，确认成功`)
            loginSuccess = true
            break
          }
          continue
        }

        // 调试：打印关键 Cookie 状态
        const missing = kc.filter(name => !jar[name])
        const found = kc.filter(name => !!jar[name])
        console.log(`[dsagent-login] poll ${Math.round((Date.now() - startTime) / 1000)}s | total=${cookies.length} | found=[${found.join(',')}] | missing=[${missing.join(',')}] | url=${page.url()?.slice(0, 80)}`)

        if (kc.length > 0) {
          // ★ 任一关键 Cookie 出现即视为登录成功（原为 every：要求全部存在）。
          //   阿里系各子域下发的 Cookie 不同，sycm 的 cookie2 只有拿到权限后访问该域才会有；
          //   用 every 会把「已登录但未授权生意参谋」误判成「没登录」（FIX-LOG #66）。
          const anyPresent = kc.some(name => jar[name])
          if (anyPresent) {
            loginSuccess = true
            break
          }
        } else {
          if (cookies.length > 10) {
            loginSuccess = true
            break
          }
        }

        // 额外检测：淘宝/闲鱼登录后会跳转到 my.taobao.com 或 goofish.com
        // 如果页面 URL 已跳转到非 login 页面，再多等 2s 让 Cookie 写完
        const currentUrl = page.url()
        if (kc.includes('unb') && !currentUrl.includes('login.taobao.com') && (currentUrl.includes('taobao.com') || currentUrl.includes('goofish.com'))) {
          console.log(`[dsagent-login] URL 已跳转到 ${currentUrl}，等待 Cookie 写入…`)
          await new Promise(r => setTimeout(r, 2000))
          cookies = await getAllDomainCookies(page, platform)
          const jar2: Record<string, string> = {}
          for (const c of cookies) jar2[c.name] = c.value
          if (jar2['unb']) {
            console.log(`[dsagent-login] unb Cookie 在跳转后找到！`)
            loginSuccess = true
            break
          }
        }

        // 知乎登录成功后会跳转到首页 www.zhihu.com 且 URL 不再包含 /signin
        if (kc.includes('z_c0') && !currentUrl.includes('/signin') && currentUrl.includes('zhihu.com')) {
          console.log(`[dsagent-login] 知乎 URL 已跳转到 ${currentUrl}，等待 Cookie 写入…`)
          await new Promise(r => setTimeout(r, 2000))
          cookies = await page.cookies()
          const jar4: Record<string, string> = {}
          for (const c of cookies) jar4[c.name] = c.value
          if (jar4['z_c0']) {
            console.log(`[dsagent-login] z_c0 Cookie 在跳转后找到！`)
            loginSuccess = true
            break
          }
        }

        // 抖音：登录成功后 sessionid Cookie 会自动写入，无需检测 URL 跳转
        // （因为登录 URL 本身就是 https://www.douyin.com/，登录弹窗关闭后 URL 不变）
      } catch {
        // 页面导航中可能导致 cookies 获取失败，忽略
      }
    }

    if (!loginSuccess) {
      // ★ 超时不再关窗：用户可能正在扫码 / 拖滑块，窗口留着还能继续。
      //   记录本次 Profile 目录，用户重新点一次登录即走 resuming 分支复用（FIX-LOG #66）。
      activeLogin = { platform, freshLogin, userDataDir }
      const waitedSec = Math.round((Date.now() - startTime) / 1000)
      const suffix = '浏览器窗口**保持打开**，你可以继续在窗口内完成扫码/验证，'
        + '完成后再点一次「重新登录」即可（无需重新扫码，登录态已写入该浏览器环境）。'
      // ★ 上报 timed_out 而非 failed：这个阶段**可续推**（窗口还开着、进度没丢），
      //   对应 Accio 的「可 advance 继续」语义。用 failed 会让模型以为必须从头再来。
      rep('timed_out', `等待 ${waitedSec}s 未检测到登录凭证，浏览器窗口保持打开，可继续完成或续推`, {
        detail: { waitedSec, sawSlider, lastUrl },
        error: sawSlider ? '等待超时：疑似卡在滑块验证' : '等待超时：未检测到登录凭证',
      })
      if (sawSlider) {
        return {
          ok: false,
          error: `登录未完成（等待 ${waitedSec}s）：检测到平台弹出**滑块/安全验证**，需要你在浏览器窗口内手动拖动滑块完成验证。${suffix}`,
        }
      }
      return {
        ok: false,
        error: `登录未完成（等待 ${waitedSec}s）：未检测到 ${platform} 的登录凭证（关键 Cookie ${kc.join('/') || '数量阈值'} 未出现）。`
          + `请确认已在弹出的浏览器窗口内完成扫码并确认登录。${suffix}`,
      }
    }

    // 已抓到凭证，进入校验与落库（用户视角：已经扫完码了）
    rep('capturing', '已获取登录凭证，正在校验并保存')

    // 登录成功：清理未完成会话标记（窗口即将关闭，无需保留续登上下文）
    activeLogin = null

    const jar: Record<string, string> = {}
    for (const c of cookies) jar[c.name] = c.value

    try {
      console.log(`[dsagent-login] 登录成功，准备保存凭证...${replaceShopKey ? `（替换旧账号 ${replaceShopKey}，绑定关系继承）` : ''}`)
      const saved = await store.save(platform, jar, { replaceShopKey })
      console.log(`[dsagent-login] 凭证已保存: shopKey=${saved.shop_key}, accountId=${saved.account_id}`)
      // ★ 重新登录后凭证已变 → 立即失效该账号的网关缓存。
      //   凭证指纹虽已参与缓存键（键会自然改变），但显式清理能同时回收
      //   「同一账号在旧身份下留下的条目」占用的内存，避免长期运行堆积。
      const clearedForAccount = invalidateGatewayCache({ shopKey: saved.shop_key })
      if (clearedForAccount > 0) {
        console.log(`[dsagent-login] 已失效该账号的 ${clearedForAccount} 条网关缓存`)
      }
      if (activeBrowser) {
        console.log(`[dsagent-login] 正在关闭浏览器...`)
        await closeActiveBrowser()
        console.log(`[dsagent-login] 浏览器已关闭`)
      }
      // ★ 收编：把本次登录用的环境落到该账号名下的固定目录（一次性目录 → 账号专属目录）。
      //   这样这个账号此后每次登录 / 发布 / 风控验证都回到同一个环境，设备身份得以延续；
      //   锁也要跟着换到新目录，否则 finally 释放的是已经不存在的旧路径。
      const adoptedDir = adoptProfileDir(userDataDir, saved.shop_key)
      if (adoptedDir !== userDataDir && lockedDir) {
        releaseProfile(lockedDir)
        lockedDir = adoptedDir
        tryAcquireProfile(lockedDir, '登录窗口')
      }
      // 登录后立即预检平台权限（生意参谋系）：当场告知「是哪个店 / 有没有权限」，
      // 而不是等用户跑技能时才报 code=-1（FIX-LOG #66）。
      const permissionNote = await probePlatformPermission(store, platform, saved.shop_key)
      // ★ 淘宝登录成功后立即派生/刷新闲鱼登录态（FIX-LOG #70）：
      //   闲鱼复用淘宝 SSO，账号页已无闲鱼入口，这条自动同步是闲鱼唯一的可用通路。
      //   代价是登录流程多等约 10~20s（拉起一次 headless 浏览器取 goofish 域 Cookie）。
      const xianyuNote = platform === 'taobao' ? await syncXianyuAfterTaobaoLogin(store) : ''
      rep('succeeded', `登录成功，账号 ${saved.display_label} 已保存`, {
        result: { shopKey: saved.shop_key, accountId: saved.account_id },
        detail: { permissionNote, xianyuNote },
      })
      return {
        ok: true,
        text: `登录成功！账号 ${saved.display_label}（${saved.shop_key}）已保存到本地凭证库。${permissionNote}${xianyuNote}`,
        shopKey: saved.shop_key,
        accountId: saved.account_id,
      }
    } catch (err) {
      console.log(`[dsagent-login] 保存失败: ${err instanceof Error ? err.message : String(err)}`)
      if (activeBrowser) await closeActiveBrowser()
      const msg = `Cookie 提取成功但存储失败：${err instanceof Error ? err.message : String(err)}`
      rep('failed', msg, { error: msg })
      return { ok: false, error: msg }
    }
  } catch (err) {
    if (activeBrowser) {
      try { await closeActiveBrowser() } catch {}
    }
    const msg = `浏览器启动失败：${err instanceof Error ? err.message : String(err)}`
    rep('failed', msg, { error: msg })
    return { ok: false, error: msg }
  } finally {
    // 登录窗口在成功 / 超时 / 保存失败 / 启动异常各路径都会关闭浏览器，故统一在此释放锁。
    if (lockedDir) releaseProfile(lockedDir)
  }
}

export async function closeBrowser(): Promise<{ ok: boolean; text?: string }> {
  if (activeBrowser) {
    await closeActiveBrowser()
    activeLogin = null
    return { ok: true, text: '浏览器已关闭' }
  }
  return { ok: true, text: '没有活跃的浏览器实例' }
}

/**
 * 刷新闲鱼域名 Cookie。
 *
 * SSO 复用的淘宝 Cookie 不被闲鱼 mtop 网关识别为合法站点登录
 * （FAIL_BIZ_LOGIN_SITE_ILLEGAL）。需要通过浏览器访问 goofish.com，
 * 利用已有的淘宝 SSO Cookie 完成 SSO 重定向，获取 goofish.com 域名的
 * 完整 Cookie 集（包括 _m_h5_tk、isg、cna 等）。
 *
 * 流程：
 *   1. 用 puppeteer 打开 Chrome（headless）
 *   2. 先设置 taobao.com 域的 Cookie（从凭证库读取）
 *   3. 访问 https://www.goofish.com/，触发 SSO 自动登录
 *   4. 等待页面加载完成，提取 goofish.com 域的所有 Cookie
 *   5. 合并到凭证库中对应闲鱼账号的 Cookie 里
 */
export async function refreshXianyuCookies(
  store: CredentialStore,
  shopKey: string,
  sourceCookies?: Record<string, string>,
): Promise<{ ok: boolean; error?: string }> {
  const account = store.get(shopKey)
  if (!account) {
    return { ok: false, error: `账号 ${shopKey} 不存在` }
  }

  // SSO 依赖 taobao.com 域的 unb。闲鱼账号自身可能被 goofish 下发的空值污染（unb=""），
  // 所以允许调用方显式传入淘宝账号的 Cookie 作为 SSO 来源。
  const accountCookies = account.cookies || {}
  const taobaoCookies = sourceCookies?.['unb'] ? sourceCookies : accountCookies
  if (!taobaoCookies['unb']) {
    return { ok: false, error: 'Cookie 中缺少 unb，无法执行 SSO 重定向' }
  }

  // ★ 身份保护：SSO 来源必须与目标账号同号。
  // 两者 unb 不同说明调用方传进来的是另一个淘宝账号的 Cookie，
  // 合并会把目标账号的登录态整体覆盖成别人的，而 setCookies() 不重算 shop_key，
  // 漂移因此完全静默（shop_key 与实际身份永久不一致，后续请求都在用别人的账号）。
  const ownUnb = String(accountCookies['unb'] ?? '')
  const sourceUnb = String(taobaoCookies['unb'] ?? '')
  if (ownUnb && ownUnb !== sourceUnb) {
    return {
      ok: false,
      error: `SSO 来源身份（unb=${sourceUnb}）与目标账号身份（unb=${ownUnb}）不一致，已拒绝合并以免覆盖登录态`,
    }
  }

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }

    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, error: '未找到 Chrome 或 Edge 浏览器' }
    }
    console.log(`[dsagent-xianyu-refresh] 使用浏览器: ${chromePath}`)

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      userDataDir: profileDir('xianyu-refresh'),
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
      ],
    })

    // 先关闭旧的浏览器实例
    if (activeBrowser) {
      try { await activeBrowser.close() } catch {}
      activeBrowser = null
    }
    // 必须登记为完整句柄（含 close），否则 closeActiveBrowser() 调 current.close() 会抛错。
    // 注意：本函数不占用 Profile 锁，故不填 userDataDir（避免 closeActiveBrowser 误释放他人的锁）。
    activeBrowser = {
      close: async () => {
        try { await browser.close() } catch { /* 忽略 */ }
      },
      browser,
      platform: 'xianyu',
    }

    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })

      // 反自动化检测
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      // 先访问 taobao.com 设置 Cookie 域
      await page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded', timeout: 15000 })

      // 把淘宝 SSO Cookie 设置到 .taobao.com 域
      const cookieList = Object.entries(taobaoCookies).map(([name, value]) => ({
        name,
        value: String(value),
        domain: '.taobao.com',
        path: '/',
      }))
      if (cookieList.length > 0) {
        await page.setCookie(...cookieList)
      }
      console.log(`[dsagent-xianyu-refresh] 已设置 ${cookieList.length} 个 taobao.com Cookie`)

      // 访问 goofish.com，触发 SSO 自动登录重定向
      console.log(`[dsagent-xianyu-refresh] 访问 goofish.com，等待 SSO 重定向...`)
      await page.goto('https://www.goofish.com/', { waitUntil: 'networkidle0', timeout: 30000 })

      // 等待页面稳定
      await new Promise(r => setTimeout(r, 3000))

      // 提取 goofish.com + taobao.com 域的所有 Cookie（指定域名，避免漏取跨域 Cookie）
      const allCookies = await page.cookies('https://.goofish.com', 'https://.taobao.com')
      const goofishJar: Record<string, string> = {}
      for (const c of allCookies) {
        if (c.domain && (c.domain.includes('goofish.com') || c.domain.includes('taobao.com'))) {
          goofishJar[c.name] = c.value
        }
      }

      console.log(`[dsagent-xianyu-refresh] 提取到 ${Object.keys(goofishJar).length} 个 Cookie`)

      // 合并：goofish Cookie 优先，但空值不得覆盖已有非空值
      // （goofish 会下发 unb= 空串，直接覆盖会让闲鱼登录态丢失、后续 SSO 无法复用）
      const goofishNonEmpty = Object.fromEntries(
        Object.entries(goofishJar).filter(([, v]) => v !== '' && v != null),
      )
      const merged: Record<string, string> = { ...accountCookies, ...taobaoCookies, ...goofishNonEmpty }

      // 回写到凭证库
      await store.setCookies(shopKey, merged)
      // 注意：日志只报合并结果，不要单独报 goofish 域 jar ——
      // unb 写在 .taobao.com 域，goofish 域 jar 天然没有 unb，单独打会误报「unb=缺失」。
      console.log(
        `[dsagent-xianyu-refresh] 合并后共 ${Object.keys(merged).length} 个 Cookie，` +
        `_m_h5_tk=${merged['_m_h5_tk'] ? '存在' : '缺失'}, unb=${merged['unb'] ? '存在' : '缺失'}，已保存到 ${shopKey}`,
      )

      return { ok: true }
    } finally {
      await closeActiveBrowser()
    }
  } catch (err) {
    return { ok: false, error: `浏览器启动失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * 已成功同步过闲鱼域 Cookie 的淘宝身份（unb）集合，避免重复拉起浏览器。
 *
 * ★ 必须按「身份」而不是「进程内只做一次」记录（FIX-LOG #70）：
 *   旧实现是一次性布尔标志，插件启动时若凭证库还没有淘宝账号，标志照样被置 true，
 *   用户之后登录淘宝**永远不会再派生闲鱼账号**（只能重启进程）。
 *   改为按 unb 记录后，未同步成功的身份不占位，登录淘宝后立即可派生。
 */
const xianyuSsoSynced = new Set<string>()

/**
 * 阿里系 SSO：闲鱼与淘宝共用登录态（关键 Cookie 都是 unb），不需要用户重复扫码。
 *
 * 账号库里只有淘宝账号时自动派生闲鱼账号；派生的账号只有 `.taobao.com` 域的 Cookie，
 * 直接调闲鱼接口会返回 `FAIL_BIZ_LOGIN_SITE_ILLEGAL::登录站点非法`，
 * 因此必须再走一次 `refreshXianyuCookies` 让 goofish.com 下发自己的域 Cookie。
 *
 * `opts.force`：跳过「已同步」短路，用于淘宝刚登录成功后的立即同步。
 */
export async function ensureXianyuFromTaobao(
  store: CredentialStore,
  opts?: { force?: boolean },
): Promise<void> {
  // 必须精确匹配 platform === 'taobao'：findByPlatform 按「凭证平台」匹配，
  // 闲鱼的凭证平台同为 taobao，会选中闲鱼账号自身（Cookie 最多），SSO 来源就错了。
  const taobaoList = store.listAccounts().filter(a => a.platform === 'taobao')
  const pickTaobao = () => taobaoList
    .slice()
    .sort((x, y) => Object.keys(y.cookies || {}).length - Object.keys(x.cookies || {}).length)
    .find(a => a.status === 'valid') ?? taobaoList[0]

  const xianyuList = store.listAccounts().filter(a => a.platform === 'xianyu' && a.status !== 'invalid')
  // ★ 选中「淘宝派生」的那条闲鱼行，而不是列表里的第一条（FIX-LOG #73）：
  //   闲鱼行可能有多条（含历史遗留的独立登录号，如 xianyu_456148124）。
  //   旧实现取 `find(...)` 的第一条，若第一条恰好是独立闲鱼号（库中无同号淘宝账号），
  //   下面的同号守卫会直接 return，**真正需要刷新的淘宝派生行永远不会被同步**，
  //   表现为「淘宝登录成功、闲鱼却一直 FAIL_BIZ_LOGIN_SITE_ILLEGAL」。
  //   判定同 isTaobaoDerivedXianyu（platform=taobao 且 unb 相同），按身份而非位置选中。
  const xianyuUnb = (a: { cookies?: Record<string, string> }) => String(a.cookies?.['unb'] ?? '')
  const existing = xianyuList.find(a => taobaoList.some(t => xianyuUnb(t) === xianyuUnb(a) && xianyuUnb(a)))
    ?? xianyuList[0]
  if (existing) {
    // ★ 已有闲鱼账号：SSO 来源必须是「同号」的淘宝账号（unb 一致），
    // 否则会用另一个淘宝账号的 Cookie 覆盖本账号登录态（shop_key 与实际身份永久漂移）。
    const ownUnb = String(existing.cookies?.['unb'] ?? '')
    // ★ 漂移行守卫（FIX-LOG #72）：shop_key 后缀必须等于自身 unb，否则该行是历史错误合并的
    // 产物（key 语法合法故 migrateDriftedKeys 之外无人纠正）。此时不能信它的 shop_key，
    // 直接落到下面的「派生」分支，让正确身份的闲鱼行被建出来。
    if (ownUnb && !existing.shop_key.endsWith(`_${ownUnb}`)) {
      console.warn(
        `[dsagent] 阿里系 SSO：闲鱼账号 ${existing.shop_key} 的 shop_key 与身份 (unb=${ownUnb}) 不符，` +
        '按正确身份重新派生',
      )
    } else {
      // 两段式查找：有 unb 时只认 unb 精确匹配（唯一可靠的身份判据，且不得回退到
      // account_id —— 漂移账号的 account_id 与 unb 指向不同身份，回退会命中异号账号，
      // 随后被 refreshXianyuCookies 的身份守卫拒绝，表现为「安全但永不刷新」）；
      // 仅当 unb 缺失时，才按 account_id 兜底。
      const sameIdentity = ownUnb
        ? taobaoList.find(a => a.cookies?.['unb'] === ownUnb)
        : taobaoList.find(a => a.account_id === existing.account_id)
      if (ownUnb && !sameIdentity) {
        console.warn(
          `[dsagent] 阿里系 SSO：闲鱼账号 ${existing.shop_key} (unb=${ownUnb}) 无同号淘宝账号，` +
          '跳过同步以免覆盖登录态',
        )
        return
      }
      const syncKey = ownUnb || existing.shop_key
      if (!opts?.force && xianyuSsoSynced.has(syncKey)) return
      const result = await refreshXianyuCookies(store, existing.shop_key, sameIdentity?.cookies)
      if (result.ok) {
        xianyuSsoSynced.add(syncKey)
        console.log(`[dsagent] 阿里系 SSO：闲鱼域 Cookie 同步完成 (${existing.shop_key})`)
      } else {
        console.warn(`[dsagent] 阿里系 SSO：闲鱼域 Cookie 同步失败 - ${result.error}`)
      }
      return
    }
  }

  // 尚无闲鱼账号：从淘宝账号派生（新 shop_key 由该淘宝 unb 推导，身份天然一致）。
  // ★ 无淘宝账号 / 无 unb 时直接返回且**不占位**，等用户登录淘宝后再派生。
  const taobao = pickTaobao()
  const unb = String(taobao?.cookies?.['unb'] ?? '')
  if (!unb) return
  if (!opts?.force && xianyuSsoSynced.has(unb)) return

  let shopKey: string
  try {
    const saved = await store.save('xianyu', taobao.cookies)
    shopKey = saved.shop_key
    console.log(`[dsagent] 阿里系 SSO：已从淘宝账号派生闲鱼账号 ${shopKey}`)
  } catch (e) {
    console.warn('[dsagent] 派生闲鱼账号失败:', e instanceof Error ? e.message : String(e))
    return
  }

  const result = await refreshXianyuCookies(store, shopKey, taobao.cookies)
  if (result.ok) {
    xianyuSsoSynced.add(unb)
    console.log(`[dsagent] 阿里系 SSO：闲鱼域 Cookie 同步完成 (${shopKey})`)
  } else {
    console.warn(`[dsagent] 阿里系 SSO：闲鱼域 Cookie 同步失败 - ${result.error}`)
  }
}

/**
 * 淘宝登录成功后立即同步闲鱼登录态（FIX-LOG #70）。
 *
 * 账号页已无闲鱼登录入口，本函数是闲鱼登录态唯一的自动通路，故必须在淘宝登录成功当场跑，
 * 而不是等 2h 巡检。失败只提示，不影响「淘宝登录本身已成功」这个事实。
 */
async function syncXianyuAfterTaobaoLogin(store: CredentialStore): Promise<string> {
  await ensureXianyuFromTaobao(store, { force: true })
  const xianyu = store.listAccounts().find(a => a.platform === 'xianyu' && a.status !== 'invalid')
  if (!xianyu) return '\n⚠️ 闲鱼登录态同步未完成：本地暂无可用的闲鱼凭证。'
  return xianyu.cookies?.['_m_h5_tk']
    ? '\n✅ 闲鱼登录态已同步（goofish 域 Cookie 就绪），闲鱼技能可直接使用。'
    : '\n⚠️ 闲鱼登录态同步不完整：goofish 域 Cookie 缺失，闲鱼技能可能报登录失效，请稍后重试。'
}

export interface RiskVerifyResult {
  ok: boolean
  /** 用户是否已通过验证并成功回写凭证 */
  passed?: boolean
  text?: string
  error?: string
  /** 提取到的风控凭证 Cookie 名（只报名字，不报值） */
  cookieNames?: string[]
}

/** 风控验证默认等待时长：4 分钟（用户需手工拖动滑块） */
const RISK_VERIFY_TIMEOUT_MS = 240_000

/**
 * deny 页分支的等待时长：45 秒。
 *
 * deny 页（action=denycdc_forbidden）本身没有滑块，用户无从「完成验证」，
 * 能否拿到 x5sec 完全取决于平台在用户正常浏览首页时是否顺势下发 —— 概率低且不可控。
 * 沿用 240s 只会让用户白等 4 分钟才看到指引（FIX-LOG #50）。
 */
const RISK_VERIFY_DENY_TIMEOUT_MS = 45_000

/**
 * 风控验证助手 —— 补上原项目没有的「完成验证」半个动作。
 *
 * 背景：淘宝命中 RGV587_ERROR 后会返回一个 punish 页链接（verifyUrl），
 * 平台要求用户在该页完成滑块验证；过完后平台下发 x5sec（白名单凭证）。
 * 若这个凭证不落库，后续请求永远带不上，风控永不解除 ——
 * 原项目的处方只有「引导重登」，且完全没有 x5sec 的提取/回写入口（FIX-LOG #47/#48）。
 *
 * 流程：
 *   1. 用 puppeteer 打开可见浏览器（用户要手工拖滑块，不能 headless）
 *   2. 先访问 taobao.com，把账号已有 Cookie 写进 .taobao.com 域（保证验证页认得账号）
 *   3. 导航到 verifyUrl（punish 页）
 *   4. 每 2s 轮询一次 Cookie，直到出现 x5sec 类「验证通过」凭证
 *   5. 合并回写凭证库 + 立即解除该账号的风控冷却，随后脚本重试即可通过
 */
export async function riskVerify(
  store: CredentialStore,
  platform: string,
  verifyUrl: string,
  timeoutMs: number = RISK_VERIFY_TIMEOUT_MS,
  operationId?: string,
): Promise<RiskVerifyResult> {
  const rep = (phase: authOp.AuthPhase, msg: string, extra?: Parameters<typeof authOp.report>[3]) =>
    authOp.report(operationId, phase, msg, extra)

  const account = store.listAccounts()
    .filter(a => a.platform === platform && a.status !== 'invalid')
    .sort((a, b) => Object.keys(b.cookies || {}).length - Object.keys(a.cookies || {}).length)[0]

  if (!account) {
    const msg = `未找到平台 ${platform} 的可用账号，请先在「账号连接」页面完成登录。`
    rep('failed', msg, { error: msg })
    return {
      ok: false,
      passed: false,
      error: msg,
    }
  }

  const target = (verifyUrl || '').trim()
  if (!target) {
    const msg = '缺少风控验证地址。请先执行一次原技能触发风控，插件会自动记录验证入口后再调用本工具。'
    rep('failed', msg, { error: msg })
    return {
      ok: false,
      passed: false,
      error: msg,
    }
  }

  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}

  // 同 Profile 互斥：Chrome 的 userDataDir 独占，二次启动必失败（FIX-LOG #50）。
  // ★ 锁按目录划分，故发布/数据分析工具占用同一目录时这里也能感知到。
  // ★ 用该账号的专属环境：验证页看到的是这个账号平时登录/发布时的同一台「设备」，
  //   换环境验证会被平台当成陌生设备，通过率反而更低。
  const dir = profileDir(platform, shopKey)
  const owner = profileOwner(dir)
  if (!tryAcquireProfile(dir, '风控验证')) {
    return {
      ok: false,
      passed: false,
      error: `平台 ${platform} 的浏览器环境正被「${owner || '其他任务'}」占用。`
        + `请先等待该任务结束（或关闭已弹出的浏览器窗口），再重新调用本工具。`,
    }
  }

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }

    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, passed: false, error: '未找到 Chrome 或 Edge 浏览器' }
    }

    // 复用该平台自己的 Profile，验证页才能认出已有登录态
    const launchOpts = {
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900',
      ],
    }
    // 启动前先清一遍残留锁；仍失败则再清一次重试（上次验证被强杀会留下 SingletonLock）
    clearProfileLocks(dir)
    let browser: any
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-risk-verify] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    if (activeBrowser) {
      try { await activeBrowser.close() } catch {}
      activeBrowser = null
    }
    // 必须登记为完整句柄（含 close），否则 closeActiveBrowser() 调 current.close() 会抛错
    activeBrowser = {
      close: async () => {
        try { await browser.close() } catch { /* 忽略 */ }
      },
      browser,
      userDataDir: dir,
      platform,
    }

    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 900 })
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      // 先把已有 Cookie 写进 .taobao.com 域，验证页才会挂到同一个账号上
      try {
        await page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded', timeout: 20000 })
        const cookieList = Object.entries(accountCookies)
          .filter(([, v]) => v !== '' && v != null)
          .map(([name, value]) => ({ name, value: String(value), domain: '.taobao.com', path: '/' }))
        if (cookieList.length > 0) await page.setCookie(...cookieList)
        console.log(`[dsagent-risk-verify] 已注入 ${cookieList.length} 个 taobao.com Cookie（账号 ${shopKey}）`)
      } catch (e) {
        console.warn('[dsagent-risk-verify] 注入 Cookie 阶段异常:', e instanceof Error ? e.message : String(e))
      }

      // 平台回传的 punish 链接常带 `:443//h5/...` 双斜杠，归一后再导航
      const normalized = target.replace(/(:\d+)\/\//, '$1/')
      console.log('[dsagent-risk-verify] 打开验证页，请在弹出的浏览器窗口完成滑块验证...')
      try {
        await page.goto(normalized, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } catch (e) {
        console.warn('[dsagent-risk-verify] 导航验证页异常:', e instanceof Error ? e.message : String(e))
      }

      // ── 探针 ──────────────────────────────────────────────
      // 验证页「是否真的渲染了滑块」原先不可观测：超时后无法区分
      // 「页面空白 / 跳到登录页 / 滑块已渲染但用户没动」三种情况。
      // 这里落一张截图 + 记录 url/title/DOM 特征，供事后归因。
      //
      // ★关键事实（FIX-LOG #50）：淘宝 RGV587 响应 data.url 里的 punish 链接，
      // 实测 action=denycdc_forbidden 时打开的是「访问被拒绝」静态 deny 页，**根本没有滑块**。
      // 盲目在 deny 页上轮询 240s 只会得到一句无用的超时提示，必须识别出来并给出可执行指引。
      const shotDir = join(homedir(), '.dsh', 'risk-verify-shots')
      try { mkdirSync(shotDir, { recursive: true }) } catch { /* 已存在 */ }
      const shotPath = join(shotDir, `risk-${platform}-${Date.now()}.png`)
      let denyPage = false
      try {
        await new Promise(r => setTimeout(r, 3000))
        await page.screenshot({ path: shotPath })
        const probeUrl = page.url()
        const probeTitle = await page.title().catch(() => '')
        const probeHtml = await page.evaluate(() => (document.documentElement?.outerHTML || '').slice(0, 20000)).catch(() => '')
        const probeBody = await page.evaluate(() => (document.body?.innerText || '').slice(0, 300)).catch(() => '')
        // 滑块特征只认真正的滑块组件；旧正则里的 punish|x5sec 会把 deny 页误判成滑块页
        const hasSlider = /nc_1_n1z|nc_iconfont|nc-container|nocaptcha|请按住滑块|拖动滑块|slide-to-unlock/i.test(probeHtml)
        const isDeny = /访问被拒绝|denycdc_forbidden|denycdc|拒绝访问|account.{0,4}abnormal/i.test(probeTitle + probeHtml + probeBody)
        denyPage = isDeny && !hasSlider
        console.log(`[dsagent-risk-verify][探针] url=${probeUrl}`)
        console.log(`[dsagent-risk-verify][探针] title=${probeTitle}`)
        console.log(`[dsagent-risk-verify][探针] slider=${hasSlider} deny=${denyPage} shot=${shotPath}`)
        console.log(`[dsagent-risk-verify][探针] body=${probeBody.replace(/\s+/g, ' ').slice(0, 200)}`)
      } catch (e) {
        console.warn('[dsagent-risk-verify][探针] 截图失败:', e instanceof Error ? e.message : String(e))
      }

      if (denyPage) {
        // deny 页上没有滑块，等多久都不会出 x5sec。改为把用户带到可用页面：
        // 用户可在该窗口内重新登录 / 正常浏览，平台可能顺势完成安全校验并下发 x5sec。
        console.log('[dsagent-risk-verify] punish 链接打开的是「访问被拒绝」deny 页（无滑块），改导航到 taobao.com 首页')
        try {
          await page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
        } catch (e) {
          console.warn('[dsagent-risk-verify] 导航首页异常:', e instanceof Error ? e.message : String(e))
        }
      }

      // 轮询等待用户过滑块 → 平台下发 x5sec
      // deny 页没有滑块可操作，缩短等待，尽快把可执行指引交给用户
      const effectiveTimeout = denyPage ? RISK_VERIFY_DENY_TIMEOUT_MS : timeoutMs
      const deadline = Date.now() + effectiveTimeout
      let passedJar: Record<string, string> = {}
      let pageClosed = false
      let tick = 0
      rep('waiting_user', denyPage
        ? '验证入口是「访问被拒绝」页（无滑块），已改为在窗口内打开首页，等待平台顺势下发凭证'
        : '验证页已打开，请在浏览器窗口中拖动滑块完成验证', { detail: { denyPage } })
      while (Date.now() < deadline) {
        // ★ 取消感知：与登录一致，cancel 后尽快退出，不空等到超时
        if (authOp.isCancelled(operationId)) {
          rep('cancelled', '已取消风控验证等待')
          return { ok: false, passed: false, error: '风控验证已被取消' }
        }
        await new Promise(r => setTimeout(r, 2000))
        tick++

        // 心跳：每 16s 打一次当前页面地址与 Cookie 数，判断页面是否还活着
        if (tick % 8 === 0) {
          try {
            console.log(`[dsagent-risk-verify][探针] 心跳 ${tick * 2}s url=${page.url()} cookies=${(await page.cookies()).length}`)
          } catch { /* 页面可能已关，下方 cookies() 会抛并走 pageClosed 分支 */ }
        }

        let cookies: { name: string; value: string }[]
        try {
          cookies = await getAllDomainCookies(page, platform)
          // 补上当前页面宿主域的 Cookie：punish 页在 h5api.m.taobao.com 上，
          // 可能下发 host-only 的 x5sec，只查 .taobao.com 域会漏。
          cookies = cookies.concat(await page.cookies())
        } catch {
          // 用户把窗口关了（或浏览器崩溃）→ 立刻结束，别干等到超时
          pageClosed = true
          break
        }

        const nonEmpty: Record<string, string> = {}
        for (const c of cookies) {
          if (c && c.name && c.value !== '' && c.value != null) nonEmpty[c.name] = c.value
        }
        const hit = Object.keys(nonEmpty).filter(n => isRiskPassCookie(n))
        if (hit.length > 0) {
          passedJar = nonEmpty
          console.log(`[dsagent-risk-verify] 检测到验证凭证：${hit.join('、')}`)
          break
        }
      }

      if (pageClosed) {
        const msg = '验证浏览器已被关闭，未检测到验证通过凭证。可重新调用本工具再试一次。'
        rep('failed', msg, { error: msg })
        return {
          ok: false,
          passed: false,
          error: msg,
        }
      }

      const passedNames = Object.keys(passedJar).filter(n => isRiskPassCookie(n))
      if (passedNames.length === 0) {
        const msg = denyPage
          ? `平台返回的验证入口是「访问被拒绝」页（action=denycdc_forbidden），该页不提供滑块，`
            + `无法通过本工具完成验证 —— 说明账号已被平台判定为高风险。`
            + `建议：① 在弹出的浏览器窗口内手动登录淘宝并正常浏览几分钟；`
            + `② 等待一段时间（风控分随时间衰减）后重试技能；`
            + `③ 更换网络出口（切换 WiFi / 热点）后重试。`
          : `等待 ${Math.round(effectiveTimeout / 1000)}s 仍未检测到验证通过凭证（x5sec）。`
            + `请确认已在弹出的浏览器窗口内完成滑块验证，然后重试。`
        // ★ 这类等待超时同样可续推（窗口开着、用户随时可能拖完滑块），
        //   故上报 timed_out 而非 failed，与登录流程的语义保持一致。
        rep('timed_out', msg, {
          error: msg,
          detail: { denyPage, effectiveTimeoutSec: Math.round(effectiveTimeout / 1000) },
        })
        return {
          ok: false,
          passed: false,
          error: msg,
        }
      }

      // 合并回写：非空 Cookie 全量落库（setCookies 语义是空值不覆盖已有值）
      await store.setCookies(shopKey, passedJar)
      // 验证已通过 → 立即解除 60s 风控冷却，下次请求就能带上 x5sec
      clearRiskCooldown(shopKey)

      rep('succeeded', `风控验证已通过，凭证 ${passedNames.join('、')} 已写回账号`, {
        result: { shopKey, cookieNames: passedNames },
      })
      return {
        ok: true,
        passed: true,
        cookieNames: passedNames,
        text: `风控验证已通过。验证凭证（${passedNames.join('、')}）已写回账号 ${shopKey}，`
          + `风控冷却已解除。请重新执行刚才失败的技能，即可正常获取数据。`,
      }
    } finally {
      await closeActiveBrowser()
      releaseProfile(dir)
    }
  } catch (err) {
    releaseProfile(dir)
    const msg = `风控验证失败：${err instanceof Error ? err.message : String(err)}`
    authOp.report(operationId, 'failed', msg, { error: msg })
    return { ok: false, passed: false, error: msg }
  }
}
