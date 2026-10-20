// 临时探测：确认 m_042_8087.js 内各方法定义名（无 _ 前缀形态）是否存在
import fs from 'node:fs'

const s = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8')

function skipStr(src, k) {
  const q = src[k]; k++
  while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++ }
  return k
}
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
function findDef(name) {
  let from = 0
  for (;;) {
    const i = s.indexOf(name, from)
    if (i < 0) return null
    from = i + name.length
    const prev = s[i - 1] || ''
    const next = s[i + name.length] || ''
    if (prev === '.' || /[A-Za-z0-9_$]/.test(prev)) continue
    if (next !== '(') continue
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

const names = [
  'fillImageData', 'fillSkuPriceData', 'fillShippingConfig',
  'applyPddElecGoodsAttributes', 'transformRequestBody', 'summarizeEditBody',
  'fillNoSpecSkuPriceDataInRequest',
]
for (const n of names) {
  const r = findDef(n)
  console.log('===', n, r ? 'len=' + r.length + ' :: ' + r.slice(0, 90) : 'MISS')
}
