/**
 * 本地凭证库 —— 账号连接器持久化存储。
 *
 * 移植自本项目 app/backend/account/store.py 的 CredentialStore。
 *
 * 数据落在插件 config 目录下的 `dsagent-accounts.json`，结构：
 *
 *   {
 *     "accounts": {
 *       "taobao_2218891961201": {
 *         "shop_key": "taobao_2218891961201",
 *         "platform": "taobao",
 *         "account_id": "2218891961201",
 *         "display_label": "tb957985228335",
 *         "cookies": { "unb": "2218891961201", "cookie2": "..." },
 *         "cookie_str": "unb=...; cookie2=...",
 *         "tb_token": "xxx",
 *         "csrf_id": "",
 *         "status": "valid",
 *         "bound_agent_ids": ["default"],
 *         "account_meta": { "display_nick": "tb957985228335" },
 *         "created_at": "...",
 *         "last_checked_at": "..."
 *       }
 *     }
 *   }
 *
 * 三条约束（与本项目一致）：
 *   1. cookies / cookie_str 只在本模块出现，出网关一律剥掉
 *   2. 写盘用临时文件 + 原子替换，避免半截 JSON
 *   3. 读写都加进程内锁——host 半区可能并发调用
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { AccountChoice } from './types.js'

// ── 类型定义 ──────────────────────────────────────────────

export type AccountStatus = 'valid' | 'expired' | 'invalid' | 'pending'

/** 鉴权方式：Cookie 扫码 vs API Key（AppID + Secret） */
export type AuthType = 'cookie' | 'apikey'

export interface StoredAccount {
  shop_key: string
  platform: string
  credential_platform: string
  account_id: string
  display_label: string
  /** 鉴权方式，默认 'cookie'（旧数据无此字段时视为 cookie） */
  auth_type?: AuthType
  /** API Key 账号的 AppID */
  app_id?: string
  /** API Key 账号的 AppSecret（不出网关，仅本模块可见） */
  app_secret?: string
  cookies: Record<string, string>
  cookie_str: string
  tb_token: string
  csrf_id: string
  login_point_id: string
  status: AccountStatus
  session_hint: string
  bound_agent_ids: string[]
  account_meta: Record<string, any>
  created_at: string
  last_checked_at: string
  /**
   * 远端登录态探测的**连续失败计数**（规范 §5.0 / FIX-LOG #57）。
   * 单次失败不足以判定账号失效（可能只是网络抖动或单域风控），
   * 连续失败达阈值后才落 `expired`；任一次探测成功即清零。
   */
  session_fail_count?: number
}

interface VaultData {
  accounts: Record<string, StoredAccount>
}

// ── 常量表（抄 gateway.md 的实测表）────────────────────────

const SHOP_KEY_RE = /^[a-z_]+_[A-Za-z0-9_-]+$/

/**
 * 远端登录态探测的连续失败阈值（规范 §5.0 / FIX-LOG #57）。
 * 单次 403 / 未登录响应可能只是网络抖动或单域风控，
 * 连续 3 次失败才判定账号整体失效，避免误标后静默降级到劣质账号。
 */
const SESSION_FAIL_THRESHOLD = 3

/** 远端探测结果：与 gateway-proxy 的 SessionProbeResult 同构（此处独立声明避免循环依赖） */
type SessionProbeResult = 'valid' | 'expired' | 'unknown'

/** 平台 -> 判定登录成功的关键 Cookie */
const KEY_COOKIES: Record<string, string[]> = {
  taobao: ['unb'],
  tmall: ['unb'],
  // 生意参谋系只认 `unb`（淘宝 SSO 登录 Cookie）为「已登录」判据。
  // `cookie2` 是生意参谋**子域会话票据**：只有拿到生意参谋权限后访问该域才会下发。
  // 旧配置要求 ['unb','cookie2'] 全部存在 → 用户明明已扫码登录淘宝成功，
  // 却因为拿不到 cookie2 被永远判为「登录超时」，浏览器白等 120s 后关窗（FIX-LOG #66）。
  // 无权限的正确表达是「已登录但无权限」，由 browser-login.ts 登录后预检单独报出，
  // 而不是伪装成「没登录」。
  sycm: ['unb'],
  alimama: ['unb'],
  dmp: ['unb'],
  sycm_insight: ['unb'],
  jd: ['pt_key'],
  // 拼多多：H5 站（mobile.yangkeduo.com）登录后下发 `PDDAccessToken`（会话票据）+ `pdd_user_id`，
  // **不下发 `PASS_ID`**（那是 PC 站字段，H5 登录流程里永远取不到）。
  // 匿名访客只拿到 pdd_vds / api_uid / _nano_fp / webp / njrpl / dilx 六个，无 PDDAccessToken，
  // 故它是能区分「已登录」与「匿名」的有效判据（实测 FIX：扫码成功后 total=10 且含 PDDAccessToken）。
  pdd: ['PDDAccessToken'],
  // 拼多多商家后台（mms.pinduoduo.com）：与上面 pdd（买家 H5）是**两套完全独立的登录态**。
  // 商家后台登录成功后下发 `PASS_ID` 会话票据（实测确认）。
  // ★ `api_uid` 是匿名首访即下发的稳定值，绝不能进本数组（登录判定用 some，FIX-LOG #56）。
  pdd_mms: ['PASS_ID'],
  douyin: ['sessionid'],
  // 小红书：web_session 是「必要非充分」条件 —— 匿名访客的页面 JS 也会写入它，
  // 故它只能用于「Cookie 结构完整性」检查，绝不能单独作为登录成功判据。
  // 登录成功判据由 browser-login.ts 的 SSR 实证（"user":{"loggedIn":true}）承担（FIX-LOG #63）。
  xhs: ['web_session'],
  bilibili: ['SESSDATA'],
  // 快手：`did` 是**设备 ID**，匿名访客打开 www.kuaishou.com 就会下发 ——
  // 旧配置只写 `['did']`，于是匿名访问被直接判为「登录成功」，8s 内关窗并存入一个假账号
  // （实测复现：全新 Profile + 未扫码 → ok:true + shopKey `kuaishou_web_79d1e224…`，FIX-LOG #71）。
  // 改为只认 `kuaishou.web.cp.api_st`（登录后才下发的会话票据）—— 取自原项目 platforms.json
  // 的声明 `"key_cookies": ["did", "kuaishou.web.cp.api_st"]`，移植时漏掉了后一个。
  // ★ 登录判定用 `some`（FIX-LOG #66），所以本数组**只能放登录后才存在的字段**；
  //   `did` 不能留在这里，但仍保留在 ACCOUNT_ID_FROM：它是**稳定**的设备标识，适合当 account_id；
  //   会话票据会随重新登录轮换，拿它当 account_id 会让每次重登都新建一条记录（同 sycm cookie2 的坑）。
  kuaishou: ['kuaishou.web.cp.api_st'],
  wechat_mp: ['slave_sid'],
  xianyu: ['unb'],
  wechat_store: [],
  zhihu: ['z_c0'],
}

/**
 * 平台 -> 从哪个 Cookie 取 account_id。
 *
 * ★ 生意参谋系（sycm/alimama/dmp/sycm_insight）必须用 `unb` 而不是 `cookie2`：
 * `cookie2` 是子域会话票据，**拿到生意参谋权限后才会下发**。若以它为 account_id 来源，
 * 无权限账号会退路取 `unb`（`sycm_<unb>`），等用户补上权限后 cookie2 出现 → account_id 变化
 * → 同一家店在凭证库里变成两条记录。`unb` 是淘宝 SSO 身份，与 taobao 账号同源且恒定（FIX-LOG #66）。
 */
const ACCOUNT_ID_FROM: Record<string, string> = {
  taobao: 'unb',
  tmall: 'unb',
  xianyu: 'unb',
  sycm: 'unb',
  alimama: 'unb',
  dmp: 'unb',
  sycm_insight: 'unb',
  jd: 'pt_key',
  pdd: 'pdd_user_id',
  // 商家后台登录后只有 `PASS_ID` 可作 account_id：实测值为
  // `1-<88位票据>_<mallId>_<userId>`（本机实测：`…_501074883_185500643`）。
  // 值里含 `/` 等 shop_key 非法字符 → deriveAccountId 会退化成 md5 前 32 位。
  // 商家真正稳定的身份是载荷尾部的 mall_id（店铺 ID），但它只存在于 PASS_ID /
  // `windows_app_shop_token_23` 的**载荷内部**，Cookie 层没有独立的数字店铺 ID
  // （实测 22 个 Cookie，唯一的纯数字项是 `x-visit-time` 时间戳），
  // 而本文件只支持「整条 Cookie 值」作 account_id，故只能取 PASS_ID。
  // 代价（已知）：重新登录若轮换 PASS_ID，会新建一条账号记录（同 FIX-LOG #66 的坑）。
  pdd_mms: 'PASS_ID',
  douyin: 'sessionid',
  xhs: 'web_session',
  bilibili: 'SESSDATA',
  // 快手 account_id 刻意用 `did`：它是稳定的设备标识（而登录票据会轮换，见 KEY_COOKIES.kuaishou 注释）。
  // 它**不是**登录判据 —— 匿名访客也有 `did`，登录与否由 `kuaishou.web.cp.api_st` 决定。
  kuaishou: 'did',
  wechat_mp: 'slave_sid',
  wechat_store: 'uuid',
  zhihu: 'z_c0',
}

/**
 * 平台 -> 真实用户 ID Cookie（优先级高于 ACCOUNT_ID_FROM）。
 *
 * 部分平台的关键 Cookie 是长会话票据（B站 SESSDATA 222 字符、知乎 z_c0 187 字符），
 * 直接截断取前 64 字符会得到无意义的元数据前缀。这些平台同时下发了纯数字用户 ID，
 * 优先用它作为 account_id。
 */
const ACCOUNT_ID_UID: Record<string, string> = {
  bilibili: 'DedeUserID',
}

/**
 * 凭证层复用：生意参谋系（sycm/万相台/达摩盘/天猫洞察）与闲鱼都复用淘宝登录态。
 *
 * ★ 必须**扁平化**写 `→ taobao`，不能照抄原项目 platforms.json 的
 * `alimama/dmp/sycm_insight → sycm`：credentialPlatform() 是**一级查找、不递归**，
 * 写成 alimama→sycm 后 credentialPlatform('alimama') 只返回 'sycm'，
 * 永远解析不到 'taobao'，生意参谋系技能会找不到任何账号（表现为「未绑定」）。
 *
 * 语义：阿里系同一套 SSO 登录态。**登录淘宝后生意参谋/万相台/达摩盘即自动可用**，
 * 账号连接页不再提供「生意参谋」独立登录入口。
 *
 * ★ 闲鱼的特殊性：凭证平台同样是 taobao（身份同源，account_id 都取 `unb`），
 * 但闲鱼 mtop 网关不认 `.taobao.com` 域 Cookie（会返回 `FAIL_BIZ_LOGIN_SITE_ILLEGAL::登录站点非法`），
 * 必须由 `refreshXianyuCookies()` 让 goofish.com 下发自己的域 Cookie（`_m_h5_tk` / `isg` / `cna`）。
 * 因此闲鱼的 `xianyu_{unb}` 凭证行**必须独立存在**，只是由淘宝登录自动派生 + UI 隐藏
 * （见 `ensureXianyuFromTaobao` / `SHARED_LOGIN_PLATFORM`）。
 */
const CREDENTIAL_PLATFORM: Record<string, string> = {
  sycm: 'taobao',
  alimama: 'taobao',
  dmp: 'taobao',
  sycm_insight: 'taobao',
  xianyu: 'taobao',
}

/** 平台别名归一化（前端用 xiaohongshu/pinduoduo，后端用 xhs/pdd） */
const PLATFORM_ALIASES: Record<string, string> = {
  xiaohongshu: 'xhs',
  pinduoduo: 'pdd',
  jd: 'jd',
}

// ── 辅助函数 ──────────────────────────────────────────────

/** 业务平台别名归一化（xiaohongshu→xhs、pinduoduo→pdd），不做凭证层映射 */
export function normalizePlatform(platform: string): string {
  return PLATFORM_ALIASES[platform] ?? platform
}

/** 业务平台 -> 凭证平台。生意参谋系（sycm/万相台/达摩盘/天猫洞察）与闲鱼都落在 taobao 上。 */
export function credentialPlatform(platform: string): string {
  return CREDENTIAL_PLATFORM[normalizePlatform(platform)] ?? normalizePlatform(platform)
}

/**
 * **不可独立登录**的平台 -> 应去登录的平台（单一真源，UI 与 host 半区共用）。
 *
 * 这些平台在凭证层复用淘宝登录态，账号连接页不设入口（FIX-LOG #67）。
 *
 * ★ 闲鱼也在表内（FIX-LOG #70）：它的凭证行由 `ensureXianyuFromTaobao()` 在
 * **淘宝登录成功后自动派生**并刷新 goofish 域 Cookie，用户不需要（也无法）单独登录闲鱼。
 * 与生意参谋系的唯一区别是闲鱼仍保留独立凭证行（goofish 域 Cookie 必须落在自己的条目上），
 * 只是该行在账号页被隐藏（见 `ui/account-page.ts` 的 `HIDDEN_ROW_PLATFORMS`）。
 *
 * 用途：堵住「存量这类账号 → 账号页『重新登录』」与「模型直接调 dsagent_browser_login」
 * 两条残留入口 —— 少了这道守卫，闲鱼/生意参谋登录窗会重新被拉起来。
 */
const SHARED_LOGIN_PLATFORM: Record<string, string> = {
  tmall: 'taobao',
  xianyu: 'taobao',
  sycm: 'taobao',
  alimama: 'taobao',
  dmp: 'taobao',
  sycm_insight: 'taobao',
}

/**
 * 该平台是否可独立登录。
 *
 * 返回空串 = 可独立登录；返回平台名 = 不可独立登录，应改为登录该平台（如 `sycm` → `'taobao'`）。
 */
export function loginOwnerPlatform(platform: string): string {
  return SHARED_LOGIN_PLATFORM[normalizePlatform(platform)] ?? ''
}

export function keyCookies(platform: string): string[] {
  return [...(KEY_COOKIES[credentialPlatform(platform)] ?? [])]
}

/**
 * 取某业务平台的候选账号集（host 预检与网关**共用同一份**，避免两端选号漂移）。
 *
 * 分三层逐级放宽，**前一层有结果就不再放宽**：
 *   ① 请求平台自身的账号   —— 如 sycm 的历史账号、xianyu 的闲鱼账号
 *   ② 凭证所有者平台的账号 —— 如 sycm 请求取 taobao 账号（淘宝登录后生意参谋即可用）
 *   ③ 凭证层的派生账号     —— 如闲鱼账号（credential_platform 同为 taobao）
 *
 * ★ 第 ③ 层必须晚于第 ② 层：闲鱼账号与淘宝账号同 `unb`（同一店铺），
 * 若一并进入候选池，四级链第 ④ 级会因「多个可用账号」误报 need_account_choice，
 * 用户每次跑生意参谋技能都要被问一遍「用哪个账号」。
 *
 * `allowDegrade: false` 时只返回第 ① 层（闲鱼/天猫请求不允许降级：域名与 Cookie 域不同）。
 * 不做状态过滤：全是 expired/invalid 时仍需返回候选，由下游报 token_expired 引导重登。
 */
export function accountsForPlatform<T extends { platform: string; credential_platform: string }>(
  list: T[],
  platform: string,
  opts: { allowDegrade?: boolean } = {},
): T[] {
  const own = list.filter(a => a.platform === platform)
  if (own.length || opts.allowDegrade === false) return own
  const cred = credentialPlatform(platform)
  const owner = cred === platform ? [] : list.filter(a => a.platform === cred)
  if (owner.length) return owner
  return list.filter(a => a.credential_platform === cred)
}

/**
 * 风控「验证通过」凭证的 Cookie 名。
 *
 * 用户在平台验证页过完滑块后，平台下发 `x5sec`（白名单凭证）。该凭证必须落库并回传平台，
 * 否则风控永不解除 —— 原项目连这个入口都没有（FIX-LOG #48）。
 *
 * 注意：`x5secdata` **不在此列**。它是风控下发的「验证挑战串」（出现在 punish URL 的 query 里，
 * 同时也会作为 Cookie 下发），代表「平台要求你验证」，而不是「你已经验证通过」。
 * 把它当通过凭证会导致两个错误（FIX-LOG #50）：
 *   1. RGV587 错误响应本身携带 x5secdata → 被误判为「验证已通过」→ 60s 风控冷却被立刻解除，节流形同虚设
 *   2. riskVerify 轮询一进 punish 页就能读到 x5secdata → 立刻「成功」返回，根本没等用户过滑块
 */
export const RISK_PASS_COOKIE_NAMES = new Set(['x5sec', '_x5sec', 'x5sectag'])

/** 该 Cookie 是否属于「风控验证通过」凭证 */
export function isRiskPassCookie(name: string): boolean {
  return RISK_PASS_COOKIE_NAMES.has(name.toLowerCase())
}

/** 把 `a=1; b=2` 解析成 dict。容忍换行、末尾分号、Set-Cookie 残渣。 */
export function parseCookieStr(cookieStr: string): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const chunk of (cookieStr || '').split(/[;\n\r]+/)) {
    const trimmed = chunk.trim()
    if (!trimmed || !trimmed.includes('=')) continue
    const eqIdx = trimmed.indexOf('=')
    const name = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'].includes(lower)) continue
    jar[name] = value
  }
  return jar
}

export function toCookieStr(jar: Record<string, string>): string {
  return Object.entries(jar)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/** 从关键 Cookie 推出 account_id（即 shop_key 的后半段）。 */
export function deriveAccountId(platform: string, jar: Record<string, string>): string {
  const credPlatform = credentialPlatform(platform)
  // 优先用真实用户 ID Cookie（如 B站 DedeUserID），避免截断长会话票据
  const uidSource = ACCOUNT_ID_UID[credPlatform] ?? ''
  if (uidSource && jar[uidSource]) {
    const uid = String(jar[uidSource]).trim()
    if (uid && SHOP_KEY_RE.test(`${platform}_${uid}`)) return uid
  }
  const source = ACCOUNT_ID_FROM[credPlatform] ?? ''
  let raw = ''
  if (source && jar[source]) {
    raw = String(jar[source])
  } else {
    // 退路：用关键 Cookie 里第一个有值的
    for (const name of keyCookies(platform)) {
      if (jar[name]) {
        raw = String(jar[name])
        break
      }
    }
  }
  if (!raw) return ''
  // 如果 account_id 值含 shop_key 不允许的字符（如知乎 z_c0 含 | :、B站 SESSDATA 含 % , *），
  // 取整个值的 MD5 前 32 位作为 account_id（截断后再哈希会丢信息，且不同票据可能撞前缀）
  if (!SHOP_KEY_RE.test(`${platform}_${raw}`)) {
    return crypto.createHash('md5').update(raw).digest('hex').slice(0, 32)
  }
  return raw.slice(0, 64)
}

export function makeShopKey(platform: string, accountId: string): string {
  const key = `${platform}_${accountId}`
  return SHOP_KEY_RE.test(key) ? key : ''
}

/** 昵称类 Cookie：登录后这些 Cookie 里存放的是平台真实昵称 */
const NICK_COOKIES = ['_nk_', 'tracknick', 'lgc', 'dnk', 'lid', 'nick', 'nickname', 'display_name', 'uname', 'uid_tt', 'sid_tt', 'nickname_tt']

/** 昵称前缀表：无真实昵称时用「前缀 + account_id」，避免只显示一串数字（渲染层与脚本共用同一份） */
export const PLATFORM_PREFIX: Record<string, string> = {
  taobao: 'tb',
  tmall: 'tb',
  xianyu: 'xy',
  jd: 'jd',
  pdd: 'pdd',
  pdd_mms: 'pddmms',
  douyin: 'dy',
  xhs: 'xhs',
  xiaohongshu: 'xhs',
  bilibili: 'bili',
  kuaishou: 'ks',
  wechat_mp: 'wx',
  wechat_store: 'wx',
  zhihu: 'zh',
}

/**
 * 判断 label 是否为「伪昵称」——即并非来自平台真实昵称的占位串。
 *
 * 只有 Cookie 真实昵称 / 平台 API 返回的 name 才算真实昵称。以下三类必须视为「无昵称」：
 *   1. 等于 account_id（凭证库默认把无昵称账号的 display_label 写成 account_id）
 *   2. 等于「平台前缀 + account_id」（渲染层兜底形态，如 dycdcf4d…）
 *   3. 含 Cookie 原始值残留字符（| : % , * =），如 z_c0 / SESSDATA 被截断后的串
 *
 * 不做此判定时，第 2、3 类会被当成「已存的真实昵称」直接展示，页面出现乱码昵称。
 */
export function isPseudoNick(label: string | undefined, platform: string, accountId: string): boolean {
  const v = String(label ?? '').trim()
  if (!v) return true
  if (accountId && v === accountId) return true
  const prefix = PLATFORM_PREFIX[platform] || platform
  if (accountId && v === `${prefix}${accountId}`) return true
  return /[|%:*=,]/.test(v)
}

/**
 * 解析展示昵称。
 * 淘宝登录后 `_nk_` / `tracknick` / `lgc` 就是真实昵称（如 tb957985228335），
 * 优先级：Cookie 中的真实昵称 → 已存的真实昵称（排除伪昵称）→ account_id。
 */
export function resolveDisplayNick(
  label: string | undefined,
  cookies: Record<string, string> | undefined,
  accountId: string,
  platform = '',
): string {
  const jar = cookies || {}
  for (const key of NICK_COOKIES) {
    const v = String(jar[key] || '').trim()
    if (v && v !== accountId && !isPseudoNick(v, platform, accountId)) return v
  }
  if (label && !isPseudoNick(label, platform, accountId)) return label
  return accountId
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ── 四级账号选择链（host / browser 半区共用，纯函数无副作用）────────────

/**
 * 未绑定任何会话时，「平台默认」账号的归属智能体 ID。
 * 与 DSH 宿主内部调用的占位 agent id 保持一致。
 */
export const DEFAULT_AGENT_ID = 'default'

/**
 * 账号优先级排序：valid > pending > expired > 其他；
 * 同状态时 Cookie 更全的排前面。
 *
 * 账号库里可能存在手动导入的半残账号（只有个别 Cookie），
 * 若按顺序取会选中它，导致请求被平台判为未登录。
 */
export function sortAccountsByPreference<T extends { status: string; cookies?: Record<string, string> }>(list: T[]): T[] {
  const order: Record<string, number> = { valid: 0, pending: 1, expired: 2 }
  const cookieCount = (a: T) => Object.keys(a.cookies || {}).length
  return [...list].sort((a, b) => {
    const byStatus = (order[a.status] ?? 3) - (order[b.status] ?? 3)
    if (byStatus !== 0) return byStatus
    return cookieCount(b) - cookieCount(a)
  })
}

/** 把账号转成给模型看的候选（绝不含 Cookie） */
export function toAccountChoice(a: StoredAccount): AccountChoice {
  return {
    shopKey: a.shop_key,
    platformId: a.platform,
    accountId: a.account_id,
    nickname: resolveDisplayNick(a.display_label, a.cookies, a.account_id, a.platform),
    status: a.status,
  }
}

export interface AccountResolution {
  /** 唯一确定时给出选中账号 */
  account: StoredAccount | null
  /** 需要用户选择时给出候选（account 为 null 且 choices 非空） */
  choices: AccountChoice[]
  /** 命中的层级：1 显式 shopKey / 2 会话绑定 / 3 平台默认 / 4 自动兜底；0 = 无候选 */
  level: number
}

/** 可用账号：valid / pending。expired / invalid 不可用（发请求必失败）。 */
export function isUsableAccount(a: { status: string }): boolean {
  return a.status === 'valid' || a.status === 'pending'
}

/** 候选唯一则选中，多个则交给模型问用户 */
function pickUnique(list: StoredAccount[], level: number): AccountResolution | null {
  if (!list.length) return null
  if (list.length === 1) return { account: list[0], choices: [], level }
  return { account: null, choices: sortAccountsByPreference(list).map(toAccountChoice), level }
}

/**
 * 「淘宝派生」的闲鱼账号（FIX-LOG #73）。
 *
 * 闲鱼凭证行由淘宝登录自动派生（`ensureXianyuFromTaobao`），其身份与同号淘宝账号一致
 * （同 `unb`）。判定依据：该行是闲鱼行，且库里存在 `unb` 相同的淘宝账号。
 * 独立登录的闲鱼账号（无同号淘宝账号）不算派生号。
 */
export function isTaobaoDerivedXianyu(
  a: { platform: string; cookies?: Record<string, string> },
  list: { platform: string; cookies?: Record<string, string> }[],
): boolean {
  if (normalizePlatform(a.platform) !== 'xianyu') return false
  const unb = String(a.cookies?.['unb'] ?? '').trim()
  if (!unb) return false
  return list.some(
    t =>
      normalizePlatform(t.platform) === 'taobao' && String(t.cookies?.['unb'] ?? '').trim() === unb,
  )
}

/**
 * 账号选择链（唯一决策点，网关与 host 预检共用）：
 *
 *   ① 显式 shopKey（模型按用户选择回传）
 *   ② 当前会话绑定（bound_agent_ids 含 agentId）
 *   ③ 平台默认绑定（bound_agent_ids 含 'default'）
 *   ④ 派生闲鱼优先（闲鱼候选里存在淘宝派生号时，直接选中它）
 *   ⑤ 自动排序兜底
 *
 * ★ 第 ⑤ 级若有多个「可用账号」（valid/pending），**不静默选择**，返回候选列表让模型问用户。
 * 静默选错号的代价会放大到所有使用该平台的技能，且症状隐蔽（不报错，只是空数据）。
 *
 * ★ 第 ④ 级是「淘宝的为主」诉求的落点（FIX-LOG #73）：
 *   闲鱼唯一正确入口是登录淘宝（FIX-LOG #70），淘宝登录自动派生同号闲鱼行。
 *   只要库里存在这样的派生行，它就是用户要用的那个闲鱼身份 —— 淘宝登录成功，闲鱼就该能用，
 *   不该因为库里另有历史遗留的独立闲鱼号而反复弹窗让用户选。
 *   判定只看 `platform` 与 `unb`，不看 shop_key，故漂移行也逃不掉（身份仍可识别）。
 *   多个派生行时按 sortAccountsByPreference 取第一个（valid 优先、Cookie 更全优先）。
 *
 * ★ 第 ③ 级（平台默认绑定）只在该绑定账号**可用**时生效：
 *   实测事故 —— `taobao_2216797908875` 带 `default` 绑定且被标 `expired`，而库里另有
 *   2 个 valid 淘宝账号 + 2 个 valid 闲鱼账号（闲鱼凭证层复用 taobao，候选集含淘宝账号）。
 *   第 ③ 级「命中即用」把这个过期号选中 → `sessionHint=expired` → 所有淘宝/闲鱼技能
 *   一律返回 token_expired，用户「明明有账号却怎么都不行」，且模型只会反复引导重新登录。
 *   平台默认绑定只是**兜底**，不该被一个过期号长期占位，故绑定号全部不可用时落到第 ⑤ 级
 *   交给用户确认；库里确实一个可用账号都没有时，才沿用原绑定报 token_expired 引导重登。
 *
 *   第 ② 级（会话绑定）**刻意**不做这个降级：它是用户对该会话的显式指定，
 *   静默换到别的账号（可能是别家店铺）比报过期更危险（见 §5.0 教训），报过期让用户重登该号。
 */
export function resolveAccountForRequest(
  candidates: StoredAccount[],
  opts: { shopKey?: string; agentId?: string; allAccounts?: StoredAccount[] } = {},
): AccountResolution {
  if (!candidates.length) return { account: null, choices: [], level: 0 }

  // ① 显式指定 shopKey（最高优先级，模型按用户选择回传）
  const wantShopKey = String(opts.shopKey || '').trim()
  if (wantShopKey) {
    const hit = candidates.find(a => a.shop_key === wantShopKey)
    if (hit) return { account: hit, choices: [], level: 1 }
  }

  const agentId = String(opts.agentId || '').trim()

  // ② 当前会话绑定（契约：每个 agent 在每个平台最多绑一个账号）
  if (agentId && agentId !== DEFAULT_AGENT_ID) {
    const picked = pickUnique(candidates.filter(a => (a.bound_agent_ids || []).includes(agentId)), 2)
    if (picked) return picked
  }

  // ③ 平台默认绑定：可用优先；绑定号全不可用且库里另有可用账号时，本级不生效（落到第 ④ 级）
  const defaultBound = candidates.filter(a => (a.bound_agent_ids || []).includes(DEFAULT_AGENT_ID))
  if (defaultBound.length) {
    const usableBound = defaultBound.filter(isUsableAccount)
    const picked3 = usableBound.length
      ? pickUnique(usableBound, 3)
      : (candidates.some(isUsableAccount) ? null : pickUnique(defaultBound, 3))
    if (picked3) return picked3
  }

  // ④ 派生闲鱼优先：只要存在「淘宝派生」的闲鱼账号，就选它（淘宝的为主）
  //
  // 闲鱼的唯一正确入口是登录淘宝（FIX-LOG #70），派生出的闲鱼行身份与同号淘宝账号一致。
  // 库里只要有这样的派生行，它就是用户要用的闲鱼身份；另有独立登录的闲鱼号（历史遗留）也不该
  // 每次都弹窗让用户二选一 —— 用户明确要求「账号淘宝的为主」。
  //
  // ★ 判定必须用 `opts.allAccounts`（全库），**不能**用 candidates：闲鱼请求 `allowDegrade=false`，
  //   candidates 里只有闲鱼行，永远找不到作为派生证据的淘宝行，本级会静默失效。
  const derivationScope = opts.allAccounts ?? candidates
  const derivedXianyu = candidates
    .filter(isUsableAccount)
    .filter(a => isTaobaoDerivedXianyu(a, derivationScope))
  if (derivedXianyu.length) {
    return { account: sortAccountsByPreference(derivedXianyu)[0], choices: [], level: 4 }
  }

  // ⑤ 自动排序兜底：多个可用账号时不静默选择
  const usable = candidates.filter(isUsableAccount)
  if (usable.length === 1) return { account: usable[0], choices: [], level: 4 }
  if (usable.length > 1) {
    return { account: null, choices: sortAccountsByPreference(usable).map(toAccountChoice), level: 4 }
  }
  // 无可用账号（全是 expired/invalid）：交给下游报 token_expired 引导重登
  return { account: sortAccountsByPreference(candidates)[0], choices: [], level: 4 }
}

// ── CredentialStore 类 ─────────────────────────────────────

export class CredentialStore {
  private filePath: string
  private cache: VaultData | null = null
  /** 上次缓存对应文件的 mtime；read() 时比对以感知外部写入（跨实例/跨半区） */
  private cacheMtimeMs = 0
  private lock: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  // ── 底层读写 ─────────────────────────────

  private read(): VaultData {
    // FIX：缓存失效检查 —— host/web 两个半区各持一个实例 + 页面写盘后，
    // 仅凭内存缓存会把新添加的账号永久屏蔽（本次故障根因）。
    // 每次读前 stat 一次（微秒级），文件 mtime 变化则重读磁盘。
    let mtimeMs = 0
    try {
      if (fs.existsSync(this.filePath)) mtimeMs = fs.statSync(this.filePath).mtimeMs
    } catch { /* stat 失败按 0 处理 → 触发重读 */ }
    if (this.cache !== null && mtimeMs === this.cacheMtimeMs) return this.cache
    let data: VaultData = { accounts: {} }
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        if (raw && typeof raw === 'object' && raw.accounts && typeof raw.accounts === 'object') {
          data = raw as VaultData
        }
      }
    } catch {
      // 文件损坏不致命：当作空库，但把坏文件留档避免静默丢数据
      try {
        if (fs.existsSync(this.filePath)) {
          const corruptPath = this.filePath.replace(/\.json$/, '.corrupt.json')
          fs.copyFileSync(this.filePath, corruptPath)
        }
      } catch {
        // 忽略备份失败
      }
    }
    this.cache = data
    this.cacheMtimeMs = mtimeMs
    this.migrateIllegalKeys(data)
    this.migrateDriftedKeys(data)
    return data
  }

  /**
   * 自愈迁移：历史数据可能因旧版 deriveAccountId 放宽了字符集而写入非法 shop_key
   * （如 `zhihu_2|1:0|...`、`bilibili_aff3aeb0%2C...`），这些 key 违反 SHOP_KEY_RE，
   * 会导致后续 get/setBindings/delete 全部按 key 精确匹配失败。
   *
   * 处理方式：按当前规则重新推导 account_id 并改名，Cookie / 绑定关系 / 元数据原样保留。
   * 无法推导（缺关键 Cookie）时保留原样，不丢数据。
   */
  private migrateIllegalKeys(data: VaultData): void {
    const accounts = data.accounts
    let changed = false
    for (const oldKey of Object.keys(accounts)) {
      if (SHOP_KEY_RE.test(oldKey)) continue
      const acc = accounts[oldKey]
      if (!acc || !acc.platform) continue
      const newAccountId = deriveAccountId(acc.platform, acc.cookies || {})
      if (!newAccountId) continue
      const newKey = makeShopKey(acc.platform, newAccountId)
      if (!newKey || newKey === oldKey) continue
      // 目标 key 已存在时不能覆盖，保留原条目
      if (accounts[newKey]) continue
      const moved: StoredAccount = {
        ...acc,
        shop_key: newKey,
        account_id: newAccountId,
        display_label: resolveDisplayNick(acc.display_label, acc.cookies, newAccountId, acc.platform),
      }
      if (moved.account_meta) {
        moved.account_meta = { ...moved.account_meta, display_nick: moved.display_label }
      }
      delete accounts[oldKey]
      accounts[newKey] = moved
      changed = true
    }
    if (changed) {
      try {
        this.write(data)
      } catch {
        // 迁移失败不阻断读取，内存中已改名
      }
    }
  }

  /**
   * 自愈迁移：shop_key 合法但「名不副实」的漂移行（FIX-LOG #72）。
   *
   * `SHOP_KEY_RE` 只校验语法，管不住语义。阿里系账号的 account_id 取自 `unb`，
   * 一旦历史代码把 A 身份的 Cookie 合并进 B 身份的条目（`setCookies` 不重算 shop_key），
   * 就会出现 `xianyu_2216797908875` 里装着 `unb=2218891961201` 的行 —— key 语法合法，
   * `migrateIllegalKeys` 不会碰它，但它会让 `ensureXianyuFromTaobao` 的「已有闲鱼行」
   * 分支永远命中错 key，正确身份的闲鱼账号永远派生不出来（表现为「淘宝登录了但闲鱼仍不可用」）。
   *
   * 处理方式：按当前规则从 Cookie 重新推导 account_id，与 key 后缀不符时改名为正确 key。
   * 目标 key 已存在时**保留已有条目**并丢弃漂移条目（漂移条目本身是错误合并的产物）。
   */
  private migrateDriftedKeys(data: VaultData): void {
    const accounts = data.accounts
    let changed = false
    for (const oldKey of Object.keys(accounts)) {
      if (!SHOP_KEY_RE.test(oldKey)) continue
      const acc = accounts[oldKey]
      if (!acc || !acc.platform) continue
      const realAccountId = deriveAccountId(acc.platform, acc.cookies || {})
      if (!realAccountId || realAccountId === acc.account_id) continue
      const newKey = makeShopKey(acc.platform, realAccountId)
      if (!newKey || newKey === oldKey) continue
      // 目标 key 已存在：漂移条目是错误合并的残留，直接删除，不用它覆盖正确条目。
      if (accounts[newKey]) {
        delete accounts[oldKey]
        changed = true
        continue
      }
      const moved: StoredAccount = {
        ...acc,
        shop_key: newKey,
        account_id: realAccountId,
        display_label: resolveDisplayNick(acc.display_label, acc.cookies, realAccountId, acc.platform),
      }
      if (moved.account_meta) {
        moved.account_meta = { ...moved.account_meta, display_nick: moved.display_label }
      }
      delete accounts[oldKey]
      accounts[newKey] = moved
      changed = true
    }
    if (changed) {
      try {
        this.write(data)
      } catch {
        // 迁移失败不阻断读取，内存中已改名
      }
    }
  }

  private write(data: VaultData): void {
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    const payload = JSON.stringify(data, null, 2)
    const tmpName = `.${path.basename(this.filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`
    const tmpPath = path.join(dir, tmpName)
    try {
      fs.writeFileSync(tmpPath, payload, 'utf-8')
      fs.renameSync(tmpPath, this.filePath)
    } catch (err) {
      try { fs.unlinkSync(tmpPath) } catch { /* 忽略 */ }
      throw err
    }
    this.cache = data
    try { this.cacheMtimeMs = fs.statSync(this.filePath).mtimeMs } catch { this.cacheMtimeMs = 0 }
  }

  /** 串行化所有写操作，避免并发竞争 */
  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const prev = this.lock
    let resolve!: () => void
    this.lock = new Promise<void>(r => { resolve = r })
    await prev
    try {
      return await fn()
    } finally {
      resolve()
    }
  }

  // ── 查询 ─────────────────────────────────

  listAccounts(): StoredAccount[] {
    const accounts = this.read().accounts
    // 归一化 credential_platform：历史数据/外部写入可能是未归一化的平台名
    // （如 xiaohongshu 应为 xhs），不修会让网关的降级匹配（a.credential_platform === credPlatform）失效
    const result = Object.values(accounts).map(a => ({
      ...(JSON.parse(JSON.stringify(a)) as StoredAccount),
      credential_platform: credentialPlatform(a.platform),
    }))
    result.sort((a, b) => {
      const pa = a.platform || ''
      const pb = b.platform || ''
      if (pa !== pb) return pa < pb ? -1 : 1
      return (a.shop_key || '') < (b.shop_key || '') ? -1 : 1
    })
    return result
  }

  get(shopKey: string): StoredAccount | null {
    const item = this.read().accounts[shopKey]
    return item ? JSON.parse(JSON.stringify(item)) : null
  }

  findByPlatform(platform: string, agentId?: string): StoredAccount | null {
    const target = credentialPlatform(platform)
    const candidates = this.listAccounts().filter(
      item => credentialPlatform(item.platform) === target,
    )
    if (!candidates.length) return null
    let filtered = candidates
    if (agentId !== undefined) {
      filtered = candidates.filter(
        item => (item.bound_agent_ids || []).includes(agentId),
      )
      if (!filtered.length) return null
    }
    // 优先返回有效账号；同平台多条有效账号时取 Cookie 最全的一条。
    // 账号库可能出现手动导入的半残账号（只有个别 Cookie），
    // 按顺序取会选中它，导致请求被平台判为未登录。
    const cookieCount = (item: StoredAccount) => Object.keys(item.cookies || {}).length
    const validOnes = filtered.filter(item => item.status === 'valid')
    if (validOnes.length) {
      return validOnes.reduce((a, b) => (cookieCount(b) > cookieCount(a) ? b : a))
    }
    return filtered[0]
  }

  // ── 写入 ─────────────────────────────────

  async save(
    platform: string,
    jar: Record<string, string>,
    opts?: {
      accountMeta?: Record<string, any>
      replaceShopKey?: string
      displayLabel?: string
    },
  ): Promise<StoredAccount> {
    return this.withLock(() => {
      const accountId = deriveAccountId(platform, jar)
      if (!accountId) {
        const kc = keyCookies(platform)
        throw new Error(
          `无法从 Cookie 中识别账号 ID（${platform} 需要 ${kc.length ? kc.join(' / ') : '任一关键 Cookie'}）。请确认已登录成功后再保存。`,
        )
      }
      const shopKey = makeShopKey(platform, accountId)
      if (!shopKey) {
        throw new Error(`生成的 shop_key 不合法：${platform}_${accountId}`)
      }

      const data = this.read()
      const accounts = data.accounts

      // 重新登录：把旧的替换掉，绑定关系继承
      let previous: StoredAccount | undefined
      if (opts?.replaceShopKey) {
        previous = accounts[opts.replaceShopKey]
        delete accounts[opts.replaceShopKey]
      }
      const existing = accounts[shopKey] || previous || ({} as Partial<StoredAccount>)
      const bound = [...(existing.bound_agent_ids || [])]

      const tbToken = jar['_tb_token_'] || ''
      const csrf = jar['_csrf'] || jar['alimama_csrf_id'] || ''
      const loginPointId = jar['alimama_login_point_id'] || ''
      const record: StoredAccount = {
        shop_key: shopKey,
        platform,
        credential_platform: credentialPlatform(platform),
        account_id: accountId,
        display_label: opts?.displayLabel || resolveDisplayNick(existing.display_label, jar, accountId, platform),
        cookies: { ...jar },
        cookie_str: toCookieStr(jar),
        tb_token: tbToken,
        csrf_id: csrf,
        login_point_id: loginPointId,
        status: 'valid',
        session_hint: 'ok',
        bound_agent_ids: bound,
        account_meta: { ...(opts?.accountMeta || existing.account_meta || {}) },
        created_at: existing.created_at || now(),
        last_checked_at: now(),
      }
      if (!record.account_meta.display_nick) {
        record.account_meta.display_nick = record.display_label
      }
      accounts[shopKey] = record
      this.write(data)
      return { ...record }
    })
  }

  /**
   * 保存 API Key 凭证（AppID + AppSecret）。
   * 用于公众号等不支持 Cookie 扫码、只支持开发者凭证的平台。
   * account_id 直接用 AppID，display_label 也用 AppID。
   */
  async saveApiKey(
    platform: string,
    appId: string,
    appSecret: string,
  ): Promise<StoredAccount> {
    return this.withLock(() => {
      const accountId = appId.trim()
      if (!accountId) throw new Error('AppID 不能为空')
      const shopKey = makeShopKey(platform, accountId)
      if (!shopKey) throw new Error(`生成的 shop_key 不合法：${platform}_${accountId}`)

      const data = this.read()
      const accounts = data.accounts
      const existing = accounts[shopKey] || ({} as Partial<StoredAccount>)
      const bound = [...(existing.bound_agent_ids || [])]

      const record: StoredAccount = {
        shop_key: shopKey,
        platform,
        credential_platform: credentialPlatform(platform),
        account_id: accountId,
        display_label: accountId,
        auth_type: 'apikey',
        app_id: accountId,
        app_secret: appSecret.trim(),
        cookies: {},
        cookie_str: '',
        tb_token: '',
        csrf_id: '',
        login_point_id: '',
        status: 'valid',
        session_hint: 'ok',
        bound_agent_ids: bound,
        account_meta: { ...(existing.account_meta || {}), display_nick: accountId },
        created_at: existing.created_at || now(),
        last_checked_at: now(),
      }
      accounts[shopKey] = record
      this.write(data)
      return { ...record }
    })
  }

  async delete(platform: string, accountId: string): Promise<boolean> {
    return this.deleteByShopKey(`${platform}_${accountId}`)
  }

  /** 按凭证库主键删除 —— shopKey 本身即主键，无需再拆平台名（平台名可能含下划线） */
  async deleteByShopKey(shopKey: string): Promise<boolean> {
    return this.withLock(() => {
      const data = this.read()
      const accounts = data.accounts
      if (accounts[shopKey]) {
        delete accounts[shopKey]
        this.write(data)
        return true
      }
      return false
    })
  }

  async setBindings(shopKey: string, agentIds: string[]): Promise<StoredAccount | null> {
    return this.withLock(() => {
      const data = this.read()
      const item = data.accounts[shopKey]
      if (!item) return null
      item.bound_agent_ids = agentIds.filter(a => String(a).trim())
      this.write(data)
      return { ...item }
    })
  }

  async setStatus(shopKey: string, status: AccountStatus, checked = true): Promise<void> {
    await this.withLock(() => {
      const data = this.read()
      const item = data.accounts[shopKey]
      if (!item) return
      item.status = status
      const hintMap: Record<string, string> = {
        valid: 'ok',
        pending: 'none',
        expired: 'expired',
        invalid: 'expired',
      }
      item.session_hint = hintMap[status] || 'expired'
      if (checked) {
        item.last_checked_at = now()
      }
      this.write(data)
    })
  }

  /**
   * 记录一次远端登录态探测结果，并按**连续失败计数**决定是否落 `expired`（规范 §5.0）。
   *
   * - `valid`：探测成功 → 计数清零，同时把状态拉回 `valid`（覆盖历史误标）
   * - `expired`：计数 +1；未达阈值只记数不落库（避免网络抖动误标），
   *   达到阈值才 `setStatus(expired)`；`last_checked_at` 每次都刷新留痕
   * - `unknown`：无法判定 → 计数保持不变，不动状态
   *
   * @returns 本次判定后的实际状态与计数，供调用方决定是否提示用户
   */
  async recordSessionProbe(
    shopKey: string,
    result: SessionProbeResult,
    threshold = SESSION_FAIL_THRESHOLD,
  ): Promise<{ status: AccountStatus; failCount: number; flipped: boolean }> {
    return this.withLock(() => {
      const data = this.read()
      const item = data.accounts[shopKey]
      if (!item) return { status: 'pending' as AccountStatus, failCount: 0, flipped: false }

      const prevCount = item.session_fail_count || 0
      let failCount = prevCount
      let flipped = false

      if (result === 'valid') {
        failCount = 0
        if (item.status !== 'valid') {
          item.status = 'valid'
          item.session_hint = 'ok'
          flipped = true
        }
        item.last_checked_at = now()
      } else if (result === 'expired') {
        failCount = prevCount + 1
        // 达到阈值才落库：单次失败只记数，符合 §5.0「不得由单次失败触发」
        if (failCount >= threshold && item.status !== 'expired') {
          item.status = 'expired'
          item.session_hint = 'expired'
          flipped = true
        }
        item.last_checked_at = now()
      }
      // unknown：计数与状态均保持不变，避免「无法判定」被当成失败累积

      item.session_fail_count = failCount
      this.write(data)
      return { status: item.status, failCount, flipped }
    })
  }

  /** 回写阿里妈妈 checkAccess 探测到的 csrfId / loginPointId */
  async setAlimamaTokens(shopKey: string, csrfId: string, loginPointId: string): Promise<void> {
    await this.withLock(() => {
      const data = this.read()
      const item = data.accounts[shopKey]
      if (!item) return
      if (csrfId) item.csrf_id = csrfId
      if (loginPointId) item.login_point_id = loginPointId
      this.write(data)
    })
  }

  /** keepalive 续期回写 */
  async setCookies(shopKey: string, jar: Record<string, string>): Promise<void> {
    await this.withLock(() => {
      const data = this.read()
      const item = data.accounts[shopKey]
      if (!item) return
      // 空值不得覆盖已有非空值（goofish 会下发 unb= 空串，直接覆盖会把登录态冲掉）
      const patch: Record<string, string> = {}
      for (const [k, v] of Object.entries(jar)) {
        if (v === '' || v == null) {
          if (item.cookies[k]) continue
        }
        patch[k] = v
      }
      item.cookies = { ...item.cookies, ...patch }
      item.cookie_str = toCookieStr(item.cookies)
      item.tb_token = patch['_tb_token_'] || item.tb_token
      if (patch['_csrf'] || patch['alimama_csrf_id']) {
        item.csrf_id = patch['_csrf'] || patch['alimama_csrf_id']
      }
      if (patch['alimama_login_point_id']) {
        item.login_point_id = patch['alimama_login_point_id']
      }
      this.write(data)
    })
  }

  bindingsForAgent(agentId: string): StoredAccount[] {
    return this.listAccounts().filter(
      item => (item.bound_agent_ids || []).includes(agentId),
    )
  }

  agentIds(): string[] {
    const found = new Set<string>()
    for (const item of this.listAccounts()) {
      for (const id of item.bound_agent_ids || []) {
        found.add(id)
      }
    }
    return [...found].sort()
  }

  /** 强制重新从磁盘读取（外部修改文件后调用） */
  reload(): void {
    this.cache = null
    this.cacheMtimeMs = 0
  }
}
