/**
 * 拼多多 captcha_collect Node 侧生成器
 *
 * 依据：拼多多官方风控 SDK（觅千手 source/safe/AesApp.js，2026-10-22 逆向）
 *
 * 链路（与 SDK 完全一致）：
 *   captcha_collect = AES-128-CBC.encrypt(
 *     Base64_binary( JSON(10 个采集器数据) ),
 *     Utf8(aes_key), iv: Utf8(aes_iv)
 *   ).toString('base64')
 *
 * 默认密钥（从 SDK 提取）：
 *   A = "bN3%cH2$H1@*jCo$"    aes_key（16 字符）
 *   W = "gl3-w^dN)3#h6E1%"    aes_iv（16 字符）
 *
 * ★ 实测状态（2026-10-22）：
 *   - vc_pre_ck_b：Node 侧调用成功（拿到 salt）           ✅
 *   - obtain_captcha：返回 code=3000（内容校验失败）       ⚠️
 *   - 错误码：4001=参数错 / 1004=密钥错 / 3000=内容不真实 / 0=成功
 *
 *   code=3000 是**业务风控**（服务端校验采集器数据真实性），
 *   不是密码学问题。要突破需让 hl/ua/时间等「真实」——
 *   这正是我们「借浏览器」策略的原因。
 *
 * 用途：
 *   ① 理解 captcha_collect 结构（调试/分析）
 *   ② 生成「结构正确」的样本供服务端行为分析
 *   ③ 与页面真实 captcha_collect 对比，定位服务端校验点
 */
import crypto from 'node:crypto'

/** 默认 aes_key（SDK 变量 A） */
export const DEFAULT_AES_KEY = 'bN3%cH2$H1@*jCo$'
/** 默认 aes_iv（SDK 变量 W） */
export const DEFAULT_AES_IV = 'gl3-w^dN)3#h6E1%'

/**
 * SDK 的 $ 函数：服务端返回 9 位 salt → 协商密钥
 *
 * 结构：salt[0] = 类型（a/b/c/d），salt[1:] = 8 位
 *   - a/c：直接拼接  t[s] = 默认密钥前8 + salt[1:]
 *   - b/d：按索引重排 t[s] = 默认密钥前8 + (salt[5:] 按 salt[1:5] 索引重排) + salt[5:]
 *
 * @param salt 9 位字符串
 * @returns { aes_key, aes_iv }
 */
export function negotiateAesKey(salt, defKey = DEFAULT_AES_KEY, defIv = DEFAULT_AES_IV) {
  const t = { aes_key: defKey, aes_iv: defIv }
  if (!salt || salt.length !== 9) return t
  const n = salt.slice(0, 1)          // 类型 a/b/c/d
  const r = salt.slice(1)             // 后 8 位
  const o = r.slice(0, 4)             // 前 4 位：索引
  const a = r.slice(4)                // 后 4 位：数据
  const i = a.split('')               // SDK: var i = a.split("")
  const c = (['a', 'b'].includes(n) ? defKey : defIv).slice(0, 8)
  const s = ['a', 'b'].includes(n) ? 'aes_key' : 'aes_iv'
  switch (n) {
    case 'a':
    case 'c':
      t[s] = c + r
      break
    case 'b':
    case 'd': {
      let u = ''
      for (let l = 0; l < 4; l++) {
        const idx = Number(o[l])
        u += Number.isFinite(idx) ? (i[idx] ?? '') : ''
      }
      t[s] = c + u + a
      break
    }
  }
  return t
}

/**
 * 生成 captcha_collect
 *
 * @param collectors 采集器数据（SDK 的 10 个字段，见下）
 * @param key aes_key（默认 DEFAULT_AES_KEY）
 * @param iv  aes_iv（默认 DEFAULT_AES_IV）
 * @returns Base64 字符串（实测 10 字段约 512 字符）
 */
export function makeCaptchaCollect(collectors, key = DEFAULT_AES_KEY, iv = DEFAULT_AES_IV) {
  if (Buffer.from(key, 'utf8').length !== 16) throw new Error(`aes_key 必须 16 字节（AES-128），当前 ${Buffer.from(key, 'utf8').length}`)
  if (Buffer.from(iv, 'utf8').length !== 16) throw new Error(`aes_iv 必须 16 字节，当前 ${Buffer.from(iv, 'utf8').length}`)
  const json = JSON.stringify(collectors)
  // SDK 的 d()：Base64.encode(e, { to: 'binary' })
  //   → 先标准 base64，再把结果按 Latin1 当字节流（CryptoJS WordArray 语义）
  const b64Std = Buffer.from(json, 'utf8').toString('base64')
  const b64Latin1 = Buffer.from(b64Std, 'latin1')
  // SDK 的 l()：CryptoJS.AES.encrypt(plain, Utf8.parse(key), { iv: Utf8.parse(iv) }).toString()
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  return Buffer.concat([cipher.update(b64Latin1), cipher.final()]).toString('base64')
}

/**
 * 解密 captcha_collect（验证/分析用）
 * @returns { b64Latin1, json }
 */
export function decodeCaptchaCollect(cc, key = DEFAULT_AES_KEY, iv = DEFAULT_AES_IV) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
  const dec = Buffer.concat([decipher.update(Buffer.from(cc, 'base64')), decipher.final()])
  const b64Latin1 = dec.toString('latin1')
  const json = Buffer.from(b64Latin1, 'base64').toString('utf8')
  return { b64Latin1, json }
}

/**
 * 构造标准采集器数据（10 个字段，严格按 SDK 的 getPrepareToken）
 *
 * SDK 顺序：[S, C, E, T, P, R, I, A, M, j]
 *   S={KEY:'v',data:'a'}     版本
 *   C={KEY:'ts',data:''}     服务器时间（init 时从 vc_pre_ck_b 响应的 server_time 赋值）
 *   E={KEY:'t0'}             Date.now()
 *   _={KEY:'t1'}             Date.now()
 *   O={KEY:'t2'}             Date.now()
 *   T={KEY:'tp',data:1}      类型
 *   P={KEY:'ua'}             navigator.userAgent
 *   R={KEY:'rf'}             document.referrer
 *   I={KEY:'hl'}             15 项反自动化检测
 *   A={KEY:'sc'}             screen {w,h}
 *   （另有两个不在 getPrepareToken 里：j={KEY:'pf'} 平台、M={KEY:'md'} 探测）
 *
 * @param env { serverTime, ua, referrer, platform, screen, hl }
 */
export function buildCollectors(env = {}) {
  const now = Date.now()
  return {
    v: 'a',
    ts: env.serverTime ?? now,
    t0: now,
    t1: now,
    t2: now,
    tp: 1,
    ua: env.ua ?? '',
    rf: env.referrer ?? '',
    pf: env.platform ?? 1,
    hl: env.hl ?? '000000000000000',
    sc: env.screen ?? { w: 1920, h: 1080 },
    md: env.md ?? 0,
  }
}

/**
 * 在浏览器页面里采集真实的 hl（15 项反自动化检测）
 * 直接复用 SDK 的检测逻辑——把本函数传给 page.evaluate() 用。
 */
export const COLLECT_HL_IN_PAGE = `function() {
  var e = []
  e[0]  = (window.innerWidth < 1 || window.innerHeight < 1) ? 1 : 0
  e[1]  = (typeof window.callPhantom !== 'undefined' || typeof window._phantom !== 'undefined') ? 1 : 0
  e[2]  = typeof window.Buffer === 'undefined' ? 0 : 1
  e[3]  = typeof window.emit === 'undefined' ? 0 : 1
  e[4]  = typeof window.spawn === 'undefined' ? 0 : 1
  e[5]  = navigator.webdriver === true ? 1 : 0
  e[6]  = (typeof window.domAutomation === 'undefined' && typeof window.domAutomationController === 'undefined') ? 0 : 1
  try {
    var v7 = 0
    var s1 = Function.prototype.toString.toString().replace(/bind/g, '')
    var s2 = Error.toString()
    if (s1 !== s2) v7 = 1
    e[7] = v7
  } catch (t) { e[7] = 1 }
  e[8]  = (navigator.plugins && navigator.plugins.length === 0) ? 1 : 0
  e[9]  = navigator.languages === '' ? 1 : 0
  e[10] = (window.renderer === 'Brian Paul' && window.renderer === 'Mesa OffScreen') ? 1 : 0
  e[11] = (window.devicePixelRatio && window.devicePixelRatio.hairline) ? 0 : 1
  e[12] = typeof window.ontouchundefined === 'undefined' ? 1 : 0
  e[13] = 'x5sec' in navigator ? 1 : 0
  e[14] = navigator.hasOwnProperty('x5sec') ? 1 : 0
  return e.join('')
}`

// ── CLI 自测 ──
if (process.argv.includes('--selftest')) {
  console.log('=== 1. 密钥协商 ===')
  for (const s of ['a12345678', 'b12345678', 'c12345678', 'd12345678', 'short']) {
    const r = negotiateAesKey(s)
    console.log(`  "${s}" → key="${r.aes_key}" iv="${r.aes_iv}"`)
  }

  console.log('\n=== 2. captcha_collect 生成 + 解密自洽 ===')
  const sample = buildCollectors({ serverTime: 1792683214312, ua: 'Mozilla/5.0 test', hl: '000000010001100' })
  const cc = makeCaptchaCollect(sample)
  const back = decodeCaptchaCollect(cc)
  console.log('  JSON 长度:', JSON.stringify(sample).length)
  console.log('  captcha_collect 长度:', cc.length)
  console.log('  纯 Base64:', /^[A-Za-z0-9+/=]+$/.test(cc) ? '✅' : '❌')
  console.log('  解密自洽:', back.json === JSON.stringify(sample) ? '✅ 完全一致' : '❌')

  console.log('\n=== 3. 不同数据不同输出 ===')
  const cc2 = makeCaptchaCollect(buildCollectors({ serverTime: 1792689999999 }))
  console.log('  ts 变化 → 输出不同:', cc !== cc2 ? '✅' : '❌')
}
