import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort()

console.log(`=== ${dirs.length} 个商品 ===\n`)

let totalSku = 0, totalAttr = 0, noSku = [], noAttr = []

for (const d of dirs) {
  const f = path.join(ROOT, d, 'product.json')
  if (!fs.existsSync(f)) { console.log(`  [无] ${d}`); continue }
  try {
    const p = JSON.parse(fs.readFileSync(f, 'utf8'))
    const sku = (p.skus || []).length
    const attr = (p.attributes || []).length
    const img = (p.images || []).length + (p.detailImages || []).length
    totalSku += sku
    totalAttr += attr
    if (!sku) noSku.push(d)
    if (!attr) noAttr.push(d)
    const dims = (p.specs || []).map(s => `${s.name}(${s.values?.length || 0})`).join(' x ') || '无维度'
    console.log(`  ${d.slice(0, 26).padEnd(28)} 图${String(img).padStart(3)} ${dims.padEnd(18)} SKU${String(sku).padStart(3)} 属性${String(attr).padStart(3)}  ${(p.title || '').slice(0, 22)}`)
  } catch (e) {
    console.log(`  [解析失败] ${d}`)
  }
}

console.log(`\n总计: SKU ${totalSku} | 属性 ${totalAttr}`)
console.log(`缺 SKU: ${noSku.length ? noSku.join(', ') : '无'}`)
console.log(`缺属性: ${noAttr.length ? noAttr.join(', ') : '无'}`)
