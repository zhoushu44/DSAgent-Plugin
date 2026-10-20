// 临时探测：_applyPddSkuValueReplaceByDim 全文 + sku spec 值替换调用点
import fs from 'node:fs'
const s = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8')
function skipStr(src, k) { const q = src[k]; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } return k }
function balance(src, from, open, close) {
  let d = 0, k = from
  while (k < src.length) {
    const c = src[k]
    if (c === '"' || c === "'" || c === '`') { k = skipStr(src, k) }
    else if (c === '/' && src[k + 1] === '/') { while (k < src.length && src[k] !== '\n') k++ }
    else if (c === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k); if (e < 0) return -1; k = e + 1 }
    else if (c === open) d++
    else if (c === close) { d--; if (d === 0) return k }
    k++
  }
  return -1
}
function extract(name) {
  let from = 0
  for (;;) {
    const i = s.indexOf(name, from)
    if (i < 0) return null
    from = i + name.length
    const prev = s[i - 1] || ''
    if (prev === '.' || /[_A-Za-z0-9$]/.test(prev)) continue
    if (s[i + name.length] !== '(') continue
    const pEnd = balance(s, i + name.length, '(', ')')
    if (pEnd < 0) continue
    let j = pEnd + 1
    while (j < s.length && /\s/.test(s[j])) j++
    if (s[j] !== '{') continue
    const bEnd = balance(s, j, '{', '}')
    if (bEnd < 0) continue
    return s.slice(i, bEnd + 1)
  }
}
console.log('=== _applyPddSkuValueReplaceByDim ===')
console.log(extract('_applyPddSkuValueReplaceByDim'))

// 找调用点
let from = 0
while (true) {
  const i = s.indexOf('this._applyPddSkuValueReplaceByDim(', from)
  if (i < 0) break
  from = i + 1
  console.log(`--- call @${i}:`, s.slice(i - 260, i + 200))
}
