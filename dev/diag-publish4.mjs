import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish4.txt'
const lines = fs.readFileSync(f, 'utf8').split('\n')

// 找每个商品的段落，看卡在哪
const marks = []
lines.forEach((l, i) => {
  const m = l.match(/^\[[\d:]+\] \[(\d+)\/20\] (.+)/)
  if (m) marks.push({ i, n: +m[1], name: m[2].trim() })
})

console.log('=== 商品列表 ===')
for (const m of marks) console.log(`  [${m.n}/20] ${m.name}`)

// 最后一个商品的详情
if (marks.length) {
  const last = marks[marks.length - 1]
  console.log(`\n=== 第 ${last.n} 个（${last.name}）关键日志 ===`)
  const seg = lines.slice(last.i)
  const keys = seg.filter(l => /段2|选中类目|点了确认|类目|属性区|必填|遮罩|提交|错误/.test(l))
  console.log(keys.slice(0, 20).map(l => l.slice(0, 125)).join('\n'))
}
