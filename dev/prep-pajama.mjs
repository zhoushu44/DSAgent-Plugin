import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama/out'
const DST = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama_run'

if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true, force: true })
fs.mkdirSync(DST, { recursive: true })

const SRCS = [
  'chain/chain-01',
  'chain/chain-01/pick/packs/1084259271627',
  'chain/chain-01/pick/packs/892895885121',
  'wf/1/ai',
  'wf/2/ai',
  'wf/3/ai',
]

let n = 0
for (const s of SRCS) {
  try {
    const srcDir = path.join(BASE, s)
    const pj = path.join(srcDir, 'product.json')
    if (!fs.existsSync(pj)) { console.log(`  跳过 ${s}（无 product.json）`); continue }

    const p = JSON.parse(fs.readFileSync(pj, 'utf8'))
    n++
    const name = `item-${String(n).padStart(3, '0')}-pajama`
    const dstDir = path.join(DST, name)
    fs.mkdirSync(dstDir, { recursive: true })
    fs.cpSync(srcDir, dstDir, { recursive: true })
    p.category = '儿童睡衣'
    fs.writeFileSync(path.join(dstDir, 'product.json'), JSON.stringify(p, null, 2), 'utf8')

    const localImgs = (p.images || []).filter(i => !i.startsWith('http') && fs.existsSync(i)).length
    console.log(`  ✅ ${name} ← ${s}`)
    console.log(`     ${(p.title || '').slice(0, 32)} | SKU ${(p.skus || []).length} | 属性 ${(p.attributes || []).length} | 图 ${(p.images || []).length}（本地 ${localImgs}）`)
  } catch (e) {
    console.log(`  ❌ ${s}: ${String(e.message).slice(0, 100)}`)
  }
}
console.log(`\n共 ${n} 个睡衣商品 → ${DST}`)
