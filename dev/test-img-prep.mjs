import { prepareImages, checkImageSizes } from 'file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/img-prep.mjs'
import * as fs from 'node:fs'
import * as path from 'node:path'

const AI = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama/out/wf/1/ai'
const files = fs.readdirSync(AI).filter(f => f.includes('20261031')).map(f => path.join(AI, f))

console.log('=== 处理前 ===')
const before = checkImageSizes(files, 3 * 1024 * 1024)
console.log(`  总计 ${before.total} 张，超限 ${before.overCount} 张`)
before.items.filter(x => x.over).forEach(x => console.log(`    ${path.basename(x.file)}: ${(x.size/1024/1024).toFixed(2)}MB`))

console.log('\n=== 开始压缩 ===')
const t0 = Date.now()
const r = await prepareImages(files, {
  maxBytes: 3 * 1024 * 1024,
  outDir: path.join(AI, '.publish-ready'),
  log: console.log,
})
const cost = Date.now() - t0

console.log('\n=== 处理后 ===')
const after = checkImageSizes(r.files, 3 * 1024 * 1024)
console.log(`  总计 ${after.total} 张，超限 ${after.overCount} 张`)
console.log(`  压缩 ${r.stats.compressed} 张，失败 ${r.stats.failed} 张，耗时 ${cost}ms`)

console.log('\n=== 明细 ===')
for (const d of r.detail) {
  const name = path.basename(d.src)
  if (d.strategy === 'passthrough') {
    console.log(`  ${name}: ${(d.from/1024/1024).toFixed(2)}MB（原样）`)
  } else if (d.ok) {
    const pct = Math.round((1 - d.bytes / d.from) * 100)
    console.log(`  ${name}: ${(d.from/1024/1024).toFixed(2)}MB → ${(d.bytes/1024/1024).toFixed(2)}MB（-${pct}%，${d.strategy}）`)
  } else {
    console.log(`  ${name}: ❌ ${d.err}`)
  }
}
