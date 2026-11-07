import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const dj = c.result.data.Root?.fields?.dataJson
if (!dj) { console.log('无 dataJson'); process.exit(0) }

console.log('dataJson 顶层:', Object.keys(dj).join(', '))
console.log('')

if (dj.skuModel) {
  console.log('skuModel:', Object.keys(dj.skuModel).join(', '))
  console.log('  skuProps 维度数:', (dj.skuModel.skuProps || []).length)
  for (const sp of (dj.skuModel.skuProps || [])) {
    console.log(`    ${sp.prop}: ${(sp.value || []).length} 个值`)
  }
}
if (dj.skuInfos) {
  console.log('skuInfos 数:', (dj.skuInfos || []).length)
  console.log('  第 1 个:', JSON.stringify(dj.skuInfos[0]).slice(0, 300))
}

// 找属性
for (const k of Object.keys(dj)) {
  if (/attr|prop|param/i.test(k)) {
    console.log(`\n${k}:`, JSON.stringify(dj[k]).slice(0, 400))
  }
}
