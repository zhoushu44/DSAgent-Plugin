import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const r = c.result || {}
console.log('result 顶层:', Object.keys(r).slice(0, 25).join(', '))
console.log('result 大小:', JSON.stringify(r).length)

// 逐层找 title / subject
function walk(obj, depth = 0, path = '') {
  if (depth > 4 || !obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k
    if (typeof v === 'string' && /title|subject/i.test(k) && v.length > 5) {
      console.log(`  ${p} = ${v.slice(0, 60)}`)
    }
    if (Array.isArray(v) && v.length && /sku|image|img|prop/i.test(k)) {
      console.log(`  ${p} = Array(${v.length})`)
    }
    if (typeof v === 'object' && v !== null && depth < 3) {
      walk(v, depth + 1, p)
    }
  }
}
console.log('\n=== 找标题 ===')
walk(r)

console.log('\n=== result 前 800 字符 ===')
console.log(JSON.stringify(r).slice(0, 800))
