/**
 * PDD anti-content 生成器（纯 Node，无需浏览器）
 *
 * 来源：逆向 shenbi（神笔）background.js 模块 16 `get_antiString`
 * 实测：2026-10-23 用新鲜 Cookie 纯 Node 请求成功拿到
 *   · queryMallFlowData          → uv 746 / pv 1149 / 粉丝 1112
 *   · queryGoodsPageOverviewForMms → 今日 1222.63 元 / 46 单 / 636 访客
 *   · queryFinalCredentialNew    → 爱绿森 / mallId 844492650 / 14KB
 *
 * ══════════════════════════════════════════════════════════════════
 * 算法（官方原始 JS，变量名还原）
 * ══════════════════════════════════════════════════════════════════
 *
 *   // 21 位随机串
 *   module.exports = function(e) {
 *     e = e || 21;
 *     for (var n = ""; 0 < e--;)
 *       n += "_~varfunctio0125634789bdegjhklmpqswxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"[64 * Math.random() | 0];
 *     return n
 *   }
 *
 *   function N() {
 *     var e = Date.now(),
 *         i = String(e).slice(0, 10),              // 10 位时间戳（秒）
 *         c = 21位随机串(),                        // c
 *         s = (i + "_" + c).split("")
 *               .reduce((a, ch) => a + ch.charCodeAt(0), 0) % 1000,   // 字符码累加 % 1000
 *         h = String(s).padStart(3, "0");          // 3 位补零校验和
 *     return btoa(i + h).replace(/=/g, "") + "_" + c
 *   }
 *
 * 输出格式：Base64(10位秒级时间戳 + 3位校验和) + "_" + 21位随机串
 * 固定长度：40 字符
 *
 * ══════════════════════════════════════════════════════════════════
 * 实测样例
 * ══════════════════════════════════════════════════════════════════
 *   MTc5Mjc2NTY5NjM4OQ_XBJ29pHHh8DvVKbNkuDzD
 *   └─────┬─────┘└┬┘└──────────┬──────────┘
 *    Base64(1792765696 + 389)  _   21位随机串
 */

/** 字符池（64 个，注意顺序不能改） */
const POOL = '_~varfunctio0125634789bdegjhklmpqswxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 生成长度 n 的随机串（默认 21） */
export function randomString(n = 21) {
  let s = ''
  for (let i = 0; i < n; i++) s += POOL[(Math.random() * POOL.length) | 0]
  return s
}

/**
 * 生成 anti-content
 * @param {number} [ts] 时间戳（毫秒）。默认 Date.now()
 * @returns {string} 40 字符签名
 */
export function getAntiString(ts = Date.now()) {
  const i = String(ts).slice(0, 10)         // 10 位秒级时间戳
  const c = randomString(21)                // 21 位随机
  let sum = 0
  for (const ch of (i + '_' + c)) sum += ch.charCodeAt(0)
  const h = String(sum % 1000).padStart(3, '0')
  return Buffer.from(i + h).toString('base64').replace(/=/g, '') + '_' + c
}

/**
 * 解析 anti-content（调试用）
 */
export function parseAntiString(s) {
  const idx = s.indexOf('_')
  if (idx < 0) return null
  const b64 = s.slice(0, idx)
  const rand = s.slice(idx + 1)
  let decoded = ''
  try { decoded = Buffer.from(b64, 'base64').toString() } catch { return null }
  if (decoded.length !== 13) return null
  const ts = decoded.slice(0, 10)
  const checksum = decoded.slice(10, 13)
  let sum = 0
  for (const ch of (ts + '_' + rand)) sum += ch.charCodeAt(0)
  return {
    timestamp: ts,
    checksum,
    checksumValid: String(sum % 1000).padStart(3, '0') === checksum,
    random: rand,
    randomLen: rand.length,
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  console.log('anti-content 生成器自检\n')
  for (let i = 0; i < 3; i++) {
    const a = getAntiString()
    console.log(`  ${a}  (${a.length} 字符)`)
    console.log(`    解析: ${JSON.stringify(parseAntiString(a))}`)
  }
}
