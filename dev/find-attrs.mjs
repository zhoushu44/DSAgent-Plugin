import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const data = c.result.data

// 找所有含 attr/prop 的字段值（不限模块）
const hits = []
function walk(obj, path, depth) {
  if (depth > 8 || !obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = `${path}.${k}`
    if (/attr|prop/i.test(k) && v && typeof v === 'object') {
      const s = JSON.stringify(v)
      if (s.length > 50 && s.length < 60000) hits.push({ p, len: s.length, preview: s.slice(0, 200) })
    }
    if (typeof v === 'object' && v !== null && depth < 7) walk(v, p, depth + 1)
  }
}
walk(data, 'data', 0)

console.log(`找到 ${hits.length} 个 attr/prop 字段:\n`)
for (const h of hits.slice(0, 12)) {
  console.log(`${h.p} (${h.len})`)
  console.log(`  ${h.preview}\n`)
}
