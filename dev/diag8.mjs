import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish8.txt'
const lines = fs.readFileSync(f, 'utf8').split('\n')

console.log('=== 第 1 个商品完整日志（前 45 行）===')
console.log(lines.filter(l => l.trim()).slice(0, 45).map(l => l.slice(0, 130)).join('\n'))

console.log('\n=== 所有「Protocol error」上下文 ===')
const idx = lines.findIndex(l => /Protocol error/.test(l))
if (idx > 0) {
  console.log(lines.slice(Math.max(0, idx - 8), idx + 3).map(l => l.slice(0, 130)).join('\n'))
}
