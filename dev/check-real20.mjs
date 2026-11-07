import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish.txt'
if (!fs.existsSync(f)) { console.log('日志未生成'); process.exit(0) }
const lines = fs.readFileSync(f, 'utf8').split('\n')
const done = lines.filter(l => /\[\d+\/20\]/.test(l)).length
const ok = lines.filter(l => /✅ 上架成功|✅ 商品已创建/.test(l)).length
const fail = lines.filter(l => /❌ 失败/.test(l)).length
console.log(`进度: ${done}/20 | 成功: ${ok} | 失败: ${fail}`)
const st = fs.statSync(f)
const age = Math.round((Date.now() - st.mtime.getTime()) / 1000)
console.log(`最后写入: ${age}s 前`)
console.log('\n=== 结果 ===')
console.log(lines.filter(l => /✅ 上架成功|✅ 商品已创建|❌ 失败/.test(l)).map(l => l.replace(/^\[[\d:]+\]\s*/, '')).join('\n'))
console.log('\n=== 最后 15 行 ===')
console.log(lines.filter(l => l.trim()).slice(-15).map(l => l.slice(0, 120)).join('\n'))
