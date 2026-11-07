import { execSync } from 'node:child_process'
import * as fs from 'node:fs'

const CUR = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/vision-fill.mjs'
const OLD = execSync('git show e3f3697:skills/pdd-publish-http/scripts/vision-fill.mjs', {
  cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin', encoding: 'utf8', maxBuffer: 10e6,
})

const extract = (src) => {
  const i = src.indexOf("// ★★ 2026-10-30 用户指出：规格区若是「自定义输入框 + checkbox」结构")
  if (i < 0) return null
  const j = src.indexOf('// ② 查视觉缓存', i)
  return src.slice(i, j > 0 ? j : i + 1400)
}

const a = extract(fs.readFileSync(CUR, 'utf8'))
const b = extract(OLD)
console.log('当前版本有这段:', !!a)
console.log('e3f3697 有这段:', !!b)
if (a && b) {
  const norm = s => s.replace(/\s+/g, ' ').trim()
  console.log('内容一致:', norm(a) === norm(b))
  if (norm(a) !== norm(b)) {
    console.log('\n--- 当前版本 ---')
    console.log(norm(a).slice(0, 700))
    console.log('\n--- e3f3697 ---')
    console.log(norm(b).slice(0, 700))
  }
}
