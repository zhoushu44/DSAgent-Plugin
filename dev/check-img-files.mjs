import * as fs from 'node:fs'
import * as path from 'node:path'

const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const p = JSON.parse(fs.readFileSync(`${d}/product.json`, 'utf8'))
const imgDir = path.join(d, 'img')

console.log('=== product.json 里的图片路径 ===')
const all = [...(p.images || []), ...(p.detailImages || [])]
console.log(`总数: ${all.length}`)
for (const f of all.slice(0, 5)) console.log(' ', f)

console.log('\n=== img 目录 ===')
const files = fs.readdirSync(imgDir)
console.log(`文件数: ${files.length}`)
for (const f of files) {
  const sz = fs.statSync(path.join(imgDir, f)).size
  console.log(`  ${f}  ${(sz / 1024).toFixed(1)} KB`)
}

console.log('\n=== 检查重复路径 ===')
const seen = new Map()
for (const f of all) {
  seen.set(f, (seen.get(f) || 0) + 1)
}
const dups = [...seen.entries()].filter(([, c]) => c > 1)
console.log(`重复路径: ${dups.length}`)
for (const [f, c] of dups.slice(0, 5)) console.log(`  ${c}x  ${f}`)
