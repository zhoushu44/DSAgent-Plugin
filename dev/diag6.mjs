import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish6.txt'
const lines = fs.readFileSync(f, 'utf8').split('\n')
// 找最后一个商品段
const marks = []
lines.forEach((l, i) => {
  const m = l.match(/^\[[\d:]+\] \[(\d+)\/20\] (.+)/)
  if (m) marks.push({ i, n: +m[1], name: m[2].trim() })
})
console.log('=== 商品进度 ===')
for (const m of marks) console.log(`  [${m.n}/20] ${m.name}`)

if (marks.length) {
  const last = marks[marks.length - 1]
  console.log(`\n=== 第 ${last.n} 个（${last.name}）===`)
  console.log(lines.slice(last.i).filter(l => l.trim()).slice(-22).map(l => l.slice(0, 125)).join('\n'))
}
