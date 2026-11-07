import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish6.txt'
const lines = fs.readFileSync(f, 'utf8').split('\n')
// 找第 4 个商品段，过滤掉「页面跳转中」看主干
const marks = []
lines.forEach((l, i) => {
  const m = l.match(/^\[[\d:]+\] \[(\d+)\/20\] (.+)/)
  if (m) marks.push({ i, n: +m[1], name: m[2].trim() })
})
const last = marks[marks.length - 1]
const seg = lines.slice(last.i).filter(l => l.trim() && !/页面跳转中/.test(l))
console.log(`第 ${last.n} 个（${last.name}）主干日志：`)
console.log(seg.map(l => l.slice(0, 125)).join('\n'))
