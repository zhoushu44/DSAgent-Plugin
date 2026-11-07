import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
console.log('顶层字段:', Object.keys(c).join(', '))
console.log('\n大小:', Object.keys(c).map(k => {
  const v = c[k]
  const sz = typeof v === 'string' ? v.length : JSON.stringify(v || {}).length
  return `  ${k}: ${sz}`
}).join('\n'))

// 看有没有 SKU / 图片信息
for (const k of ['skus', 'sku', 'images', 'imgs', 'attributes', 'props', 'detail']) {
  if (c[k]) console.log(`\n${k} 存在:`, JSON.stringify(c[k]).slice(0, 400))
}
