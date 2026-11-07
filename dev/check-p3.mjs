import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/p3.txt'
if (!fs.existsSync(f)) { console.log('日志未生成'); process.exit(0) }
const l = fs.readFileSync(f, 'utf8').split('\n')
const st = fs.statSync(f)
const age = Math.round((Date.now() - st.mtime.getTime()) / 1000)
console.log(`最后写入: ${age}s 前 ${age > 180 ? '⚠ 已停止' : '✅ 运行中'}`)
console.log('')
console.log('=== 关键行 ===')
console.log(l.filter(x => /✅ 上架成功|✅ 商品已创建|❌ 失败|costSeconds|错误（|填写建议|点提交|sku-thumb|规格编码/.test(x)).slice(-18).map(x => x.slice(0, 155)).join('\n'))
