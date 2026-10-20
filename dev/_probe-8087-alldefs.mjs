// 临时探测：修正版全方法定义扫描（正则限定紧邻 name( 的形态：name( 参数配平后紧跟 {）
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

const defRe = /[_A-Za-z$][_A-Za-z0-9$]*\(/g
let m
const found = new Map()
while ((m = defRe.exec(s)) !== null) {
  const name = m[0].slice(0, -1)
  if (name.length < 3) continue
  if (found.has(name)) continue
  const i = m.index
  const prev = s[i - 1] || ''
  if (prev === '.' || /[_A-Za-z0-9$]/.test(prev)) continue
  const pEnd = balance(s, i + name.length, '(', ')')
  if (pEnd < 0) continue
  let j = pEnd + 1
  while (j < s.length && /\s/.test(s[j])) j++
  if (s[j] !== '{') continue
  const bEnd = balance(s, j, '{', '}')
  if (bEnd < 0) continue
  found.set(name, bEnd + 1 - i)
}
const arr = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log(arr.map(([n, l]) => `${n}:${l}`).join('\n'))
console.log('TOTAL', found.size)
