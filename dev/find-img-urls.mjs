import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))

// 找所有图片 URL
const hits = []
function walk(o, p, depth) {
  if (depth > 10 || !o || typeof o !== 'object') return
  for (const [k, v] of Object.entries(o)) {
    const np = `${p}.${k}`
    if (Array.isArray(v) && v.length) {
      const first = v[0]
      if (typeof first === 'string' && /^https?:\/\/.*\.(jpg|jpeg|png)/i.test(first)) {
        hits.push({ path: np, count: v.length, sample: first.slice(0, 90) })
      }
    }
    if (typeof v === 'object' && v !== null && depth < 9) walk(v, np, depth + 1)
  }
}
walk(c.result?.data || {}, 'data', 0)

console.log(`找到 ${hits.length} 个图片数组:\n`)
for (const h of hits.slice(0, 10)) {
  console.log(`${h.path} (${h.count} 张)`)
  console.log(`  ${h.sample}\n`)
}
