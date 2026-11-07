import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/spec-dims.mjs'
const s = fs.readFileSync(f, 'utf8')
console.log('总行数:', s.split('\n').length)
console.log('')
console.log('=== 导出函数 ===')
for (const l of s.split('\n')) {
  if (/^export (function|const|async)/.test(l)) console.log('  ' + l.trim())
}
console.log('')
// scanDims 的实现
const i = s.indexOf('export async function scanDims')
if (i > 0) {
  console.log('=== scanDims 实现 ===')
  console.log(s.slice(i, i + 2200))
}
