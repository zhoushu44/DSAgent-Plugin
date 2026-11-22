/**
 * taobao-sign.mjs —— 淘宝 mtop 签名（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么有它
 * ══════════════════════════════════════════════════════════════════
 * 淘宝技能原本全部走 Host 网关（platform_client.mtop_jsonp），有三个硬伤：
 *   ① 网关对大响应（商品详情 ~300KB）转发超时 → SKU 阶段必失败
 *   ② 无法控制重试节奏，风控冷却只能干等
 *   ③ 每个 Python 技能各写一套 MtopCaller，知识不沉淀
 *
 * 实测结论（2026-11-18）：mtop 只要 Cookie 里的 `_m_h5_tk`，
 * **纯 Node md5 自签就能直接打通**，无需浏览器、无需网关。
 *
 * ══════════════════════════════════════════════════════════════════
 * 签名算法（阿里 mtop 通用，与 gateway-proxy.ts 逐字一致）
 * ══════════════════════════════════════════════════════════════════
 *   token = _m_h5_tk.split('_')[0]
 *   sign  = md5(token + "&" + t + "&" + appKey + "&" + data)
 *   t     = 毫秒时间戳
 *   data  = 请求体 JSON 字符串（必须与发送的完全一致）
 *   appKey = 12574478
 *
 * ══════════════════════════════════════════════════════════════════
 * ★ Cookie 合并规则（吸收自 gateway-proxy `tokenRefreshed`，FIX-LOG #48/#50）
 * ══════════════════════════════════════════════════════════════════
 *   1. 风控/错误响应**默认不合并** —— 淘宝风控会下发**空 `_m_h5_tk`**，
 *      覆盖会直接冲掉登录态。
 *   2. 但**风控验证凭证必须落库**（x5sec / _x5sec / x5sectag）：
 *      用户过完滑块平台把它下发在 RGV587 响应里，不落库则后续请求永远带不上，
 *      「完成验证」这半个动作白做。
 *   3. `x5secdata` **不是**通过凭证，它是「验证挑战串」（punish URL 里那个），
 *      当通过凭证会导致冷却被误解除（FIX-LOG #50）。
 */
import crypto from 'node:crypto'

export const MTOP_APP_KEY = '12574478'

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

/** 风控「验证通过」凭证的 Cookie 名（小写比较）。x5secdata 不在此列。 */
export const RISK_PASS_COOKIE_NAMES = new Set(['x5sec', '_x5sec', 'x5sectag'])

export function isRiskPassCookie(name) {
  return RISK_PASS_COOKIE_NAMES.has(String(name || '').toLowerCase())
}

/** 从 Cookie 罐里取签名 token
 *
 * ★ `_m_h5_tk` 有两种真实形态（都遇到过）：
 *   ① `3ccb9fb405f77d2819a01c210fe26332_1794999999999`  ← 带过期时间后缀（官方常规）
 *   ② `3ccb9fb405f77d2819a01c210fe263`                  ← **不带下划线**（凭证库常见）
 *
 *   早期只写 `split('_')[0]`，遇到 ② 会返回整串 → 签名错 → 服务端报
 *   `FAIL_SYS_TOKEN_EMPTY::令牌为空`，且因为「没下发新 token」被误归因为
 *   `token_expired`（需重登），把用户导向错误动作。这里必须兼容两种。
 */
export function tokenOf(jar) {
  const raw = jar?._m_h5_tk
  if (!raw) return ''
  const str = String(raw)
  const idx = str.indexOf('_')
  return idx === -1 ? str : str.slice(0, idx)
}

export function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex')
}

/** mtop 签名 */
export function signMtop({ token, t, data, appKey = MTOP_APP_KEY }) {
  return md5(`${token}&${t}&${appKey}&${data}`)
}

/**
 * 解析 Set-Cookie 头为字典
 * @returns {Record<string,string>}
 */
export function parseSetCookies(setCookies) {
  const jar = {}
  for (const raw of setCookies || []) {
    const part = String(raw).split(';')[0]
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!name) continue
    jar[name] = value
  }
  return jar
}

/**
 * ★ 按官方规则合并 Set-Cookie 到本地 jar
 *
 * 合并规则（官方注释 + 实测补充）：
 *   ① 成功响应          → 全合并
 *   ② 错误响应          → **不合并**（风控会用空值/假值冲掉登录态）
 *   ③ Token 过期响应    → **必须合并 `_m_h5_tk`**（这是 token 引导的唯一途径）
 *   ④ 风控验证凭证      → 必须合并（x5sec / _x5sec / x5sectag）
 *
 * ★ ③ 是实测补充的关键例外：`FAIL_SYS_TOKEN_EXOIRED` 的响应**同时下发新 token**，
 *   若不合并，「清 token → 重试」永远拿到空 token → 死循环报令牌为空。
 *
 * @param {Response} res
 * @param {Record<string,string>} jar   会被就地修改
 * @param {boolean} isErrorResp         本次响应是否为错误（非 SUCCESS）
 * @param {boolean} isTokenResp         本次是否为 token 过期/为空类响应（允许合并 _m_h5_tk）
 * @returns {{merged:Record<string,string>, tokenRefreshed:boolean, riskPassReceived:boolean}}
 */
export function absorbMtopCookies(res, jar, isErrorResp = false, isTokenResp = false) {
  let setCookies = []
  try {
    setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
  } catch { /* 老 Node 无此 API */ }

  const incoming = parseSetCookies(setCookies)
  const merged = {}
  let riskPassReceived = false

  for (const [name, value] of Object.entries(incoming)) {
    // 空值处理：`_m_h5_tk` 空值是「清 token」信号，必须清掉本地值；
    // 其它 Cookie 空值直接忽略（风控会用空值冲掉登录态，见官方注释）。
    if (!value) {
      if (name === '_m_h5_tk') delete jar[name]
      continue
    }
    const isRiskPass = isRiskPassCookie(name)
    const isTokenCookie = name === '_m_h5_tk' || name === '_m_h5_tk_enc'
    // 错误响应默认不合并；但 token 引导、验证凭证必须落库
    const allow = !isErrorResp || isRiskPass || (isTokenResp && isTokenCookie)
    if (allow) merged[name] = value
    if (isRiskPass) riskPassReceived = true
  }

  for (const [k, v] of Object.entries(merged)) jar[k] = v

  return {
    merged,
    tokenRefreshed: !!merged._m_h5_tk,
    riskPassReceived,
  }
}

export function cookieHeader(jar) {
  return Object.entries(jar || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}
