/**
 * xhs-sign.mjs —— 小红书 x-s / x-t / x-s-common 签名（纯 Node，零依赖）
 * ══════════════════════════════════════════════════════════════════
 * 逐行移植自 skills/xiaohongshu-crawl/scripts/xhs_sign.py（594 行）——
 * 后者从开源项目 Cloxl/xhshow（MIT）移植，已在真机跑通 34 次。
 *
 * 这是**主链路**：纯 HTTP + 自算签名，不起浏览器、不占 Profile、不受页面改版影响。
 * 页面内代签名（xhs-browser.mjs 的 PAGE_HOOK）只是**兜底** —— 签名算法被平台
 * 改版打断时，才退回让页面自己算。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须与 Python 版逐字节一致
 * ══════════════════════════════════════════════════════════════════
 *   · x-s 是 144 字节 payload 的 XOR 流，错一个字节 → 平台直接 461
 *   · 自定义 Base64 换表、CRC32 的 JS 有符号语义、ARC4 的 S 盒、b1 的
 *     quote→%XX 解析，任一处差一位签名就废
 *   · POST 的 body 必须与签名用的 content_string **字节一致** ——
 *     所以 signHeaders 返回 bodyStr，调用方必须原样发送，不能另行 JSON.stringify
 *
 * 对照验证：scripts/verify-xhs-sign.mjs 会拿本模块与 xhs_sign.py 的出参逐字段比对。
 */

import { createHash, randomBytes, randomInt } from 'node:crypto'

/* ── 随机源（可注���，用于与 Python 版做逐字节对照）─────────
 *
 * 生产环境用 crypto 的随机；验证脚本设 XHS_SIGN_DETERMINISTIC=<seed>
 * 时切到线性同余序列，与 Python 侧的 FixedRandom 完全对齐 ——
 * 否则签名里含随机 seed，两边永远不可能逐字节相同。
 */
const DET_SEED = process.env.XHS_SIGN_DETERMINISTIC ? Number(process.env.XHS_SIGN_DETERMINISTIC) : null
/** 时钟（可注入）：确定性对照时钉死，避免两个进程取到不同的毫秒 */
const FIXED_NOW = process.env.XHS_SIGN_FIXED_NOW ? Number(process.env.XHS_SIGN_FIXED_NOW) : null
const NOW = () => (FIXED_NOW === null ? Date.now() : FIXED_NOW)
let _detState = DET_SEED === null ? 0 : DET_SEED % 2147483648

const RND = (() => {
  if (DET_SEED === null) {
    return {
      next: () => 0,
      random: () => Math.random(),
      randint: (a, b) => randomInt(a, b + 1),
      bytes: (n) => randomBytes(n),
    }
  }
  // 线性同余（数值与 Python FixedRandom 一致：A=12345, C=12345, M=2^31）
  const next = () => {
    _detState = (12345 * _detState + 12345) % 2147483648
    return _detState
  }
  return {
    next,
    random: () => next() / 2147483648,
    randint: (a, b) => a + next() % (b - a + 1),
    bytes: (n) => Buffer.from(Array.from({ length: n }, () => (next() >> 7) % 256)),
  }
})()

/**
 * 仅测试用：把确定性随机源重置到初始种子。
 *
 * 没有这个函数时，Node 侧随机序列是**模块级单例**，一条进程只能跑一个用例；
 * 而 Python 侧每个用例都会 `FixedRandom(SEED)` 重置 —— 两边序列一错位，
 * 从第二个用例起签名就全对不上（表现为「第一个 PASS、后面全 FAIL」）。
 *
 * 非确定性模式（生产）下是空操作。
 */
export function __resetRandomForTest() {
  if (DET_SEED !== null)
    _detState = DET_SEED % 2147483648
}

/* ── 常量（与 xhs_sign.py 逐字一致）───────────────────────── */
const STANDARD_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CUSTOM_BASE64_ALPHABET = 'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5'
const X3_BASE64_ALPHABET = 'MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G'

const HEX_KEY = '71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a5'
  + '1a499d23b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344'
  + 'f39139bf4faf22a3eef120b79258145b2feb5193b6478669961298e79bedca64'
  + '6e1a693a926154a5a7a1bd1cf0dedb742f917a747a1e388b234f2277516db711'
  + '6035439730fa61e9822a0eca7bff72d8'

const VERSION_BYTES = [121, 104, 96, 41]
const PAYLOAD_LENGTH = 144
const A1_LENGTH = 52
const APP_ID_LENGTH = 10
const MD5_XOR_LENGTH = 8
const A3_PREFIX = [2, 97, 51, 16]
const TIMESTAMP_LE_LENGTH = 8

const SEQUENCE_VALUE_MIN = 15
const SEQUENCE_VALUE_MAX = 50
const WINDOW_PROPS_LENGTH_MIN = 1000
const WINDOW_PROPS_LENGTH_MAX = 1200
const ENV_FINGERPRINT_TIME_OFFSET_MIN = 10
const ENV_FINGERPRINT_TIME_OFFSET_MAX = 50

const ENV_TABLE = [115, 248, 83, 102, 103, 201, 181, 131, 99, 94, 4, 68, 250, 132, 21]
const ENV_CHECKS_DEFAULT = [0, 1, 18, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0]

const HASH_IV = [1831565813, 461845907, 2246822507, 3266489909]
const MAX_32BIT = 0xFFFFFFFF

/** x-s 外层 JSON（字段顺序即序列化顺序，勿改） */
const SIGNATURE_DATA_TEMPLATE = {
  x0: '4.3.5',
  x1: 'xhs-pc-web',
  x2: 'Windows',
  x3: '',
  x4: 'object',
}

const X3_PREFIX = 'mns0301_'
const XYS_PREFIX = 'XYS_'
const B1_SECRET_KEY = 'xhswebmplfbt'

/** x-s-common 结构（字段顺序即序列化顺序，勿改） */
const SIGNATURE_XSCOMMON_TEMPLATE = {
  s0: 5,
  s1: '',
  x0: '1',
  x1: '4.3.5',
  x2: 'Windows',
  x3: 'xhs-pc-web',
  x4: '4.86.0',
  x5: '',
  x6: '',
  x7: '',
  x8: '',
  x9: -596800761,
  x10: 0,
  x11: 'normal',
}

const PUBLIC_USERAGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'

const _BASE36_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'

const GPU_VENDORS = [
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x000010DE) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x0000250F) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
]

const SCREEN_RESOLUTIONS = {
  resolutions: ['1366;768', '1600;900', '1920;1080', '2560;1440', '3840;2160', '7680;4320'],
  weights: [0.25, 0.15, 0.35, 0.15, 0.08, 0.02],
}
const COLOR_DEPTH_OPTIONS = { values: [16, 24, 30, 32], weights: [0.05, 0.6, 0.05, 0.3] }
const DEVICE_MEMORY_OPTIONS = { values: [1, 2, 4, 8, 12, 16], weights: [0.10, 0.25, 0.4, 0.2, 0.03, 0.01] }
const CORE_OPTIONS = { values: [2, 4, 6, 8, 12, 16, 24, 32], weights: [0.1, 0.4, 0.2, 0.15, 0.08, 0.04, 0.02, 0.01] }
const BROWSER_PLUGINS = 'PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF'
const CANVAS_HASH = '742cc32c'
const VOICE_HASH_OPTIONS = '10311144241322244122'
const FONTS = 'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", '
  + '-apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif, '
  + 'BlinkMacSystemFont, "Helvetica Neue", Arial, "PingFang SC", "PingFang TC", "PingFang HK", '
  + '"Microsoft Yahei", "Microsoft JhengHei"'

/* ── Cookie 解析 ─────────────────────────────────────────── */
export function parseCookieStr(cookieStr) {
  const out = {}
  for (const part of String(cookieStr || '').split(';')) {
    const s = part.trim()
    if (!s || !s.includes('='))
      continue
    const i = s.indexOf('=')
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim()
  }
  return out
}

/* ── 自定义 Base64 ───────────────────────────────────────── */
function translateAlphabet(stdB64, alphabet) {
  let out = ''
  for (const ch of stdB64) {
    const idx = STANDARD_BASE64_ALPHABET.indexOf(ch)
    out += idx >= 0 ? alphabet[idx] : ch
  }
  return out
}

/** 标准 Base64 后按 CUSTOM_BASE64_ALPHABET 换表（x-s 外层 / b1 用） */
export function encodeCustom(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  return translateAlphabet(buf.toString('base64'), CUSTOM_BASE64_ALPHABET)
}

/** 标准 Base64 后按 X3_BASE64_ALPHABET 换表（x3 用） */
export function encodeX3(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  return translateAlphabet(buf.toString('base64'), X3_BASE64_ALPHABET)
}

/* ── 位运算 / 哈希 ───────────────────────────────────────── */
function intToLeBytes(val, length = 4) {
  const arr = []
  let v = val
  for (let i = 0; i < length; i++) {
    arr.push(v & 0xFF)
    v = Math.floor(v / 256)
  }
  return arr
}

function rotateLeft(val, n) {
  return (((val << n) | (val >>> (32 - n))) >>> 0)
}

/** a3 字段：输入字节数须为 8 的倍数，输出 16 字节 */
function customHashV2(inputBytes) {
  let s0 = HASH_IV[0]
  let s1 = HASH_IV[1]
  let s2 = HASH_IV[2]
  let s3 = HASH_IV[3]
  const length = inputBytes.length

  s0 = (s0 ^ length) >>> 0
  s1 = (s1 ^ (length << 8)) >>> 0
  s2 = (s2 ^ (length << 16)) >>> 0
  s3 = (s3 ^ (length << 24)) >>> 0

  const rounds = Math.floor(length / 8)
  for (let i = 0; i < rounds; i++) {
    const b = i * 8
    const v0 = (inputBytes[b] | (inputBytes[b + 1] << 8)
      | (inputBytes[b + 2] << 16) | (inputBytes[b + 3] << 24)) >>> 0
    const v1 = (inputBytes[b + 4] | (inputBytes[b + 5] << 8)
      | (inputBytes[b + 6] << 16) | (inputBytes[b + 7] << 24)) >>> 0

    s0 = rotateLeft((((s0 + v0) >>> 0) ^ s2) >>> 0, 7)
    s1 = rotateLeft((((v0 ^ s1) >>> 0) + s3) >>> 0, 11)
    s2 = rotateLeft((((s2 + v1) >>> 0) ^ s0) >>> 0, 13)
    s3 = rotateLeft((((s3 ^ v1) >>> 0) + s1) >>> 0, 17)
  }

  const t0 = (s0 ^ length) >>> 0
  const t1 = (s1 ^ t0) >>> 0
  const t2 = ((s2 + t1) >>> 0)
  const t3 = (s3 ^ t2) >>> 0

  const n0 = ((rotateLeft(t0, 9) + rotateLeft(t2, 17)) >>> 0)
  const n1 = ((rotateLeft(t1, 13) ^ rotateLeft(t3, 19)) >>> 0)
  const n2 = ((rotateLeft(t2, 17) + n0) >>> 0)
  const n3 = ((rotateLeft(t3, 19) ^ n1) >>> 0)

  const out = []
  for (const s of [n0, n1, n2, n3])
    out.push(...intToLeBytes(s, 4))
  return out
}

/** 144 字节 payload 与 HEX_KEY 逐字节 XOR */
function xorTransformArray(source) {
  const key = Buffer.from(HEX_KEY, 'hex')
  const out = Buffer.alloc(source.length)
  for (let i = 0; i < source.length; i++) {
    out[i] = i < key.length ? (source[i] ^ key[i]) & 0xFF : source[i] & 0xFF
  }
  return out
}

/** 构造 144 字节 payload（mns0301 版本） */
function buildPayloadArray(hexParameter, hexMd5Path, a1Value, appIdentifier = 'xhs-pc-web',
  stringParam = '', timestamp = null) {
  const ts = timestamp === null ? NOW() / 1000 : timestamp
  const seed = RND.randint(0, MAX_32BIT)
  const seedByte = seed & 0xFF

  const payload = [...VERSION_BYTES]
  payload.push(...intToLeBytes(seed, 4))

  const tsBytes = intToLeBytes(Math.floor(ts * 1000), TIMESTAMP_LE_LENGTH)
  payload.push(...tsBytes)

  const timeOffset = RND.randint(ENV_FINGERPRINT_TIME_OFFSET_MIN, ENV_FINGERPRINT_TIME_OFFSET_MAX)
  payload.push(...intToLeBytes(Math.floor((ts - timeOffset) * 1000), TIMESTAMP_LE_LENGTH))
  payload.push(...intToLeBytes(RND.randint(SEQUENCE_VALUE_MIN, SEQUENCE_VALUE_MAX), 4))
  payload.push(...intToLeBytes(RND.randint(WINDOW_PROPS_LENGTH_MIN, WINDOW_PROPS_LENGTH_MAX), 4))
  payload.push(...intToLeBytes(Buffer.byteLength(stringParam, 'utf8'), 4))

  const md5Bytes = Buffer.from(hexParameter, 'hex')
  for (let i = 0; i < MD5_XOR_LENGTH; i++)
    payload.push((md5Bytes[i] ^ seedByte) & 0xFF)

  // a1：Python 是 encode 后 [:52].ljust(52, b"\x00")，长度字节写 **ljust 后的长度**（恒 52）
  const a1Raw = Buffer.from(String(a1Value), 'utf8').subarray(0, A1_LENGTH)
  const a1Padded = Buffer.alloc(A1_LENGTH, 0)
  a1Raw.copy(a1Padded, 0)
  payload.push(A1_LENGTH)
  payload.push(...a1Padded)

  const appRaw = Buffer.from(String(appIdentifier), 'utf8').subarray(0, APP_ID_LENGTH)
  const appPadded = Buffer.alloc(APP_ID_LENGTH, 0)
  appRaw.copy(appPadded, 0)
  payload.push(APP_ID_LENGTH)
  payload.push(...appPadded)

  const part11 = [1, (seedByte ^ ENV_TABLE[0]) & 0xFF]
  for (let i = 1; i < 15; i++)
    part11.push((ENV_TABLE[i] ^ ENV_CHECKS_DEFAULT[i]) & 0xFF)
  payload.push(...part11)

  const md5PathBytes = []
  for (let i = 0; i < 32; i += 2)
    md5PathBytes.push(parseInt(hexMd5Path.slice(i, i + 2), 16))
  const hashOut = customHashV2([...tsBytes, ...md5PathBytes])
  payload.push(...A3_PREFIX)
  for (const b of hashOut)
    payload.push((b ^ seedByte) & 0xFF)

  return payload
}

/* ── x-s ─────────────────────────────────────────────────── */
/**
 * 取 URL 的 path 部分（去掉 host / query / fragment）。
 *
 * ★ 必须同时接受**绝对 URL** 和**纯路径**：Python 的 urlparse 对
 *   `/api/sns/web/v1/note` 一样能拿 path，而 `new URL()` 会抛
 *   "Invalid URL"。调用方（发布 / 采集）两种都会传，这里要兼容。
 */
export function extractUri(url) {
  const s = String(url || '').trim()
  if (!s)
    throw new Error('无法从 URL 提取 URI: (空)')

  // 绝对 URL：带 scheme
  if (/^https?:\/\//i.test(s)) {
    let path
    try {
      path = new URL(s).pathname
    } catch {
      throw new Error(`无法从 URL 提取 URI: ${url}`)
    }
    if (!path || path === '/')
      throw new Error(`无法从 URL 提取 URI: ${url}`)
    return path
  }

  // 纯路径 / 相对：截掉 query 与 fragment，与 urlparse().path 一致
  const path = s.split('#')[0].split('?')[0]
  if (!path || path === '/')
    throw new Error(`无法从 URL 提取 URI: ${url}`)
  return path
}

function buildContentString(method, uri, payload = null) {
  const p = payload || {}
  if (String(method).toUpperCase() === 'POST')
    return uri + JSON.stringify(p)

  const keys = Object.keys(p)
  if (!keys.length)
    return uri

  const params = keys.map((key) => {
    const value = p[key]
    let valueStr
    if (Array.isArray(value))
      valueStr = value.map(String).join(',')
    else if (value !== null && value !== undefined)
      valueStr = String(value)
    else valueStr = ''
    // Python: urllib.parse.quote(value_str, safe=',')
    return `${key}=${encodeURIComponent(valueStr).replace(/%2C/g, ',')
      .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`
  })
  return `${uri}?${params.join('&')}`
}

export function signXs(method, url, a1Value, xsecAppid = 'xhs-pc-web', payload = null, timestamp = null) {
  const uri = extractUri(url)
  const contentString = buildContentString(method, uri, payload)
  const dValue = createHash('md5').update(contentString, 'utf8').digest('hex')
  const mValue = String(method).toUpperCase() === 'GET'
    ? dValue
    : createHash('md5').update(uri, 'utf8').digest('hex')

  const payloadArray = buildPayloadArray(dValue, mValue, a1Value, xsecAppid, contentString, timestamp)
  const xorResult = xorTransformArray(payloadArray)
  const x3Signature = encodeX3(xorResult.subarray(0, PAYLOAD_LENGTH))

  const signatureData = { ...SIGNATURE_DATA_TEMPLATE }
  signatureData.x3 = X3_PREFIX + x3Signature
  return XYS_PREFIX + encodeCustom(JSON.stringify(signatureData))
}

/* ── x-s-common（ARC4 + CRC32 + b1 指纹）─────────────────── */
function arc4(keyBuf, dataBuf) {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBuf[i % keyBuf.length]) & 0xFF
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  const out = Buffer.alloc(dataBuf.length)
  let i = 0
  j = 0
  for (let k = 0; k < dataBuf.length; k++) {
    i = (i + 1) & 0xFF
    j = (j + s[i]) & 0xFF
    const t = s[i]; s[i] = s[j]; s[j] = t
    out[k] = dataBuf[k] ^ s[(s[i] + s[j]) & 0xFF]
  }
  return out
}

let _crc32Table = null
function crc32JsInt(data) {
  if (!_crc32Table) {
    const tbl = new Array(256).fill(0)
    for (let d = 0; d < 256; d++) {
      let r = d
      for (let k = 0; k < 8; k++)
        r = (r & 1) ? (((r >>> 1) ^ 0xEDB88320) >>> 0) : (r >>> 1)
      tbl[d] = r >>> 0
    }
    _crc32Table = tbl
  }
  // Python 侧对 bytes 逐字节；这里对 latin1 字符串逐字节
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1')
  let c = MAX_32BIT
  for (const b of buf)
    c = ((_crc32Table[((c & 0xFF) ^ b) & 0xFF] ^ (c >>> 8)) >>> 0)

  const u = (((MAX_32BIT ^ c) ^ 0xEDB88320) >>> 0)
  return (u & 0x80000000) ? u - 0x100000000 : u
}

function weightedChoice(options, weights) {
  let r = RND.random()
  for (let i = 0; i < options.length; i++) {
    r -= weights[i]
    if (r <= 0)
      return String(options[i])
  }
  return String(options[options.length - 1])
}

function getScreenConfig() {
  const [w, h] = weightedChoice(SCREEN_RESOLUTIONS.resolutions, SCREEN_RESOLUTIONS.weights).split(';').map(Number)
  if (RND.random() < 0.5) {
    const dw = Number(weightedChoice([0, 30, 60, 80], [0.1, 0.4, 0.3, 0.2]))
    return { width: w, height: h, availWidth: w - dw, availHeight: h }
  }
  const dh = Number(weightedChoice([30, 60, 80, 100], [0.2, 0.5, 0.2, 0.1]))
  return { width: w, height: h, availWidth: w, availHeight: h - dh }
}

function generateWebglHash() {
  return createHash('md5').update(RND.bytes(32)).digest('hex')
}

function generateFingerprint(cookies, userAgent) {
  const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  const sc = getScreenConfig()
  const isIncognito = weightedChoice(['true', 'false'], [0.95, 0.05])
  const [vendor, renderer] = GPU_VENDORS[RND.randint(0, GPU_VENDORS.length - 1)].split('|')
  const x78y = RND.randint(2350, 2450)

  return {
    x1: userAgent,
    x2: 'false',
    x3: 'zh-CN',
    x4: weightedChoice(COLOR_DEPTH_OPTIONS.values, COLOR_DEPTH_OPTIONS.weights),
    x5: weightedChoice(DEVICE_MEMORY_OPTIONS.values, DEVICE_MEMORY_OPTIONS.weights),
    x6: '24',
    x7: `${vendor},${renderer}`,
    x8: weightedChoice(CORE_OPTIONS.values, CORE_OPTIONS.weights),
    x9: `${sc.width};${sc.height}`,
    x10: `${sc.availWidth};${sc.availHeight}`,
    x11: '-480',
    x12: 'Asia/Shanghai',
    x13: isIncognito,
    x14: isIncognito,
    x15: isIncognito,
    x16: 'false',
    x17: 'false',
    x18: 'un',
    x19: 'Win32',
    x20: '',
    x21: BROWSER_PLUGINS,
    x22: generateWebglHash(),
    x23: 'false',
    x24: 'false',
    x25: 'false',
    x26: 'false',
    x27: 'false',
    x28: '0,false,false',
    x29: '4,7,8',
    x30: 'swf object not loaded',
    x31: '124.04347527516074',
    x33: '0',
    x34: '0',
    x35: '0',
    x36: String(RND.randint(1, 20)),
    x37: '0|0|0|0|0|0|0|0|0|1|0|0|0|0|0|0|0|0|1|0|0|0|0|0',
    x38: '0|0|1|0|1|0|0|0|0|0|1|0|1|0|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0',
    x39: 0,
    x40: '0',
    x41: '0',
    x42: '3.4.4',
    x43: CANVAS_HASH,
    x44: String(NOW()),
    x45: '__SEC_CAV__1-1-1-1-1|__SEC_WSA__|',
    x46: 'false',
    x47: '1|0|0|0|0|0',
    x48: '',
    x49: '{list:[],type:}',
    x50: '',
    x51: '',
    x52: '',
    x53: createHash('md5').update(RND.bytes(32)).digest('hex'),
    x54: VOICE_HASH_OPTIONS,
    x55: '380,380,360,400,380,400,420,380,400,400,360,360,440,420',
    x56: `${vendor}|${renderer}|${generateWebglHash()}|35`,
    x57: cookieString,
    x58: '180',
    x59: '2',
    x60: '63',
    x61: '1291',
    x62: '2047',
    x63: '0',
    x64: '0',
    x65: '0',
    x66: { referer: '', location: 'https://www.xiaohongshu.com/explore', frame: 0 },
    x67: '1|0',
    x68: '0',
    x69: '326|1292|30',
    x70: ['location'],
    x71: 'true',
    x72: 'complete',
    x73: '1191',
    x74: '0|0|0',
    x75: 'Google Inc.',
    x76: 'true',
    x77: '1|1|1|1|1|1|1|1|1|1',
    x78: {
      x: 0, y: x78y, left: 0, right: 290.828125,
      bottom: x78y + 18, height: 18, top: x78y, width: 290.828125, font: FONTS,
    },
    x79: '144|599565058866',
    x80: '1|[object FileSystemDirectoryHandle]',
    x82: '_0x17a2|_0x1954',
  }
}

/** b1 指纹：ARC4 加密后 URL 编码，再按自定义 Base64 输出 */
const _B1_FIELDS = ['x33', 'x34', 'x35', 'x36', 'x37', 'x38', 'x39', 'x42', 'x43',
  'x44', 'x45', 'x46', 'x48', 'x49', 'x50', 'x51', 'x52', 'x82']

function generateB1(fp) {
  const b1Fp = {}
  for (const k of _B1_FIELDS)
    b1Fp[k] = fp[k]

  const b1Json = Buffer.from(JSON.stringify(b1Fp), 'utf8')
  const ciphertext = arc4(Buffer.from(B1_SECRET_KEY, 'utf8'), b1Json).toString('latin1')
  // Python: urllib.parse.quote(ciphertext, safe="!*'()~_-")
  const encodedUrl = encodeURIComponent(ciphertext)
    .replace(/[!'()*~_-]/g, (c) => c) // 这些 safe 字符 encodeURIComponent 本就不编码，保留原样

  // 按 %XX 切块：每块前 2 位是十六进制，其余字符直通
  const b = []
  for (const chunk of encodedUrl.split('%').slice(1)) {
    const chars = [...chunk]
    b.push(parseInt(chars.slice(0, 2).join(''), 16))
    for (const ch of chars.slice(2))
      b.push(ch.charCodeAt(0))
  }
  return encodeCustom(Buffer.from(b))
}

export function signXsCommon(cookieDict, userAgent = PUBLIC_USERAGENT) {
  const a1 = cookieDict.a1
  if (!a1)
    throw new Error('生成 x-s-common 需要 a1 cookie，请重新登录小红书账号')

  const fp = generateFingerprint(cookieDict, userAgent)
  const b1 = generateB1(fp)

  const signStruct = { ...SIGNATURE_XSCOMMON_TEMPLATE }
  signStruct.x5 = a1
  signStruct.x8 = b1
  signStruct.x9 = crc32JsInt(b1)
  // Python: json.dumps(..., ensure_ascii=False) —— 中文（字体名/UA）不转义
  return encodeCustom(JSON.stringify(signStruct))
}

/* ── 时间戳 / ID ─────────────────────────────────────────── */
export function getXt(timestamp = null) {
  const ts = timestamp === null ? Date.now() : timestamp * 1000
  return Math.floor(ts)
}

function intToBase36(value) {
  if (!value)
    return '0'
  let v = BigInt(value)
  let out = ''
  const base = 36n
  while (v > 0n) {
    out = _BASE36_CHARS[Number(v % base)] + out
    v /= base
  }
  return out
}

export function genSearchId() {
  const ms = BigInt(Date.now())
  const rand = BigInt(Math.ceil(0x7FFFFFFE * Math.random()))
  return intToBase36((ms << 64n) + rand)
}

export function genSearchRequestId() {
  return `${Math.ceil(0x7FFFFFFE * Math.random())}-${Date.now()}`
}

export function genB3TraceId() {
  let s = ''
  for (let i = 0; i < 16; i++)
    s += 'abcdef0123456789'[randomInt(0, 16)]
  return s
}

export function genXrayTraceId() {
  const ts = BigInt(Date.now())
  const seq = BigInt(randomInt(0, 8388608))
  const part1 = ((ts << 23n) | seq).toString(16).padStart(16, '0')
  let part2 = ''
  for (let i = 0; i < 16; i++)
    part2 += 'abcdef0123456789'[randomInt(0, 16)]
  return part1 + part2
}

/* ── 对外主入口 ──────────────────────────────────────────── */
/**
 * 生成小红书请求所需的完整签名头。
 *
 * @returns {{headers: object, bodyStr: string|null}}
 *   bodyStr —— POST 时必须用这个字符串作为请求体（与签名用的 content_string 字节一致）；
 *              GET 时为 null。**不能另行 JSON.stringify**，否则签名与体不一致会被拒。
 */
export function signHeaders(method, urlOrUri, cookieStr, opts = {}) {
  const { payload = null, params = null, userAgent = PUBLIC_USERAGENT } = opts
  const cookies = parseCookieStr(cookieStr)
  const a1 = cookies.a1
  if (!a1)
    throw new Error('缺少 a1 cookie，无法生成签名，请在「账号连接」页面重新登录小红书账号')

  const isPost = String(method).toUpperCase() === 'POST'
  const signPayload = isPost ? payload : (params || {})

  const headers = {
    'x-s': signXs(method, urlOrUri, a1, 'xhs-pc-web', signPayload),
    'x-t': String(getXt()),
    'x-b3-traceid': genB3TraceId(),
    'x-xray-traceid': genXrayTraceId(),
  }

  // x-s-common 为辅助头，生成失败不阻断主签名
  try {
    headers['x-s-common'] = signXsCommon(cookies, userAgent)
  } catch { /* 忽略 */ }

  const bodyStr = isPost ? JSON.stringify(payload || {}) : null
  return { headers, bodyStr }
}
