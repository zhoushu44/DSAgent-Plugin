/**
 * 统计 200 批量的真实结果
 * 关键：区分「真成功」「重复铺货拒绝」「技术失败」
 */
import * as fs from 'node:fs'

const LOG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch200_v7.txt'
const lines = fs.readFileSync(LOG, 'utf8').split('\n')

// 每个商品的段落
const segs = []
let cur = null
for (const l of lines) {
  const m = l.match(/^\[[\d:]+\] \[(\d+)\/200\] (.*)/)
  if (m) {
    if (cur) segs.push(cur)
    cur = { n: +m[1], name: m[2].trim(), lines: [l] }
  } else if (cur) {
    cur.lines.push(l)
  }
}
if (cur) segs.push(cur)

console.log(`总商品段: ${segs.length}`)

// 分类
const realOk = []      // 拿到 goodsId 且是新 ID
const dupReject = []   // 错误（0）但没新 ID
const techFail = []    // 有明确错误
const goodsIds = new Set()

for (const s of segs) {
  const text = s.lines.join('\n')
  const ids = [...text.matchAll(/goods_id=(\d+)/g)].map(m => m[1])
  ids.forEach(i => goodsIds.add(i))
  const hasErr0 = /错误（0）/.test(text)
  const hasRealErr = /错误（[1-9]\d*）/.test(text)
  const hasTechFail = /❌ 失败/.test(text)

  if (hasTechFail) techFail.push(s.name)
  else if (ids.length && !hasErr0) realOk.push({ name: s.name, id: ids[0] })
  else if (hasErr0) dupReject.push(s.name)
  else if (ids.length) realOk.push({ name: s.name, id: ids[0] })
}

console.log(`\n=== 分类结果 ===`)
console.log(`真实成功（有新 goodsId）: ${realOk.length}`)
console.log(`错误(0)（重复铺货拒绝）: ${dupReject.length}`)
console.log(`技术失败: ${techFail.length}`)
console.log(`\n唯一 goodsId 数: ${goodsIds.size}`)

// 按类目统计
const byCat = {}
for (const r of realOk) {
  const cat = r.name.split('-').pop()
  byCat[cat] = (byCat[cat] || 0) + 1
}
console.log(`\n成功商品类目分布:`)
console.log(Object.entries(byCat).map(([k, v]) => `  ${k}: ${v}`).join('\n'))

// 时间统计
const times = []
for (const l of lines) {
  const m = l.match(/^\[(\d{2}):(\d{2}):(\d{2})\] \[\d+\/200\]/)
  if (m) times.push(+m[1] * 3600 + +m[2] * 60 + +m[3])
}
if (times.length >= 2) {
  const total = times[times.length - 1] - times[0]
  console.log(`\n总耗时: ${Math.round(total / 3600)} 小时 ${Math.round((total % 3600) / 60)} 分钟`)
  console.log(`平均: ${Math.round(total / (times.length - 1))} 秒/个`)
}
