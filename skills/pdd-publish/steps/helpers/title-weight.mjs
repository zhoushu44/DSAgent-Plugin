/**
 * title-weight.mjs — 拼多多标题长度计算（汉字=2字符，英文数字=1字符）
 *
 * 平台规则原文：「商品标题最多填写30个汉字（60个字符）」
 * 即：汉字按 2 个字符计，ASCII 按 1 个字符计，总字符数 ≤ 60
 */

/** 算一个字符占多少「字符位」 */
function charWeight(ch) {
  const code = ch.codePointAt(0)
  // ASCII 可打印字符 → 1
  if (code >= 0x20 && code <= 0x7e) return 1
  // 中文标点/全角符号 → 2
  // 其余（汉字、假名、韩文、全角）→ 2
  return 2
}

/** 标题总字符数（平台口径） */
export function titleWeight(str) {
  let n = 0
  for (const ch of String(str || '')) n += charWeight(ch)
  return n
}

/**
 * 按平台口径截断到 maxWeight
 * @param {string} str
 * @param {number} maxWeight 默认 60
 * @returns {{ text: string, weight: number, cut: boolean, removed: string }}
 */
export function cutTitle(str, maxWeight = 60) {
  const s = String(str || '')
  let n = 0
  let i = 0
  for (const ch of s) {
    const w = charWeight(ch)
    if (n + w > maxWeight) break
    n += w
    i += ch.length
  }
  const text = s.slice(0, i)
  return {
    text,
    weight: n,
    cut: i < s.length,
    removed: s.slice(i),
  }
}

/** 汉字个数 */
export function hanCount(str) {
  return (String(str || '').match(/[\u4e00-\u9fa5]/g) || []).length
}

export default { titleWeight, cutTitle, hanCount }
