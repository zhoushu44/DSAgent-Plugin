#!/usr/bin/env node
/**
 * 查看 200 批量上架进度
 * 用法：node dev/batch-status.mjs [日志文件]
 */
import * as fs from 'node:fs'

const f = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch200_v7.txt'
if (!fs.existsSync(f)) { console.log(`日志不存在: ${f}`); process.exit(0) }

const lines = fs.readFileSync(f, 'utf8').split('\n')
const done = lines.filter(l => /\[\d+\/200\]/.test(l)).length
const ok = lines.filter(l => /✅ 上架成功|✅ 商品已创建/.test(l)).length
const fail = lines.filter(l => /❌ 失败/.test(l)).length
console.log(`进度: ${done}/200 | 成功: ${ok} | 失败: ${fail}`)

const times = []
for (const l of lines) {
  const m = l.match(/^\[(\d{2}):(\d{2}):(\d{2})\] \[\d+\/200\]/)
  if (m) times.push(+m[1] * 3600 + +m[2] * 60 + +m[3])
}
const deltas = []
for (let i = 1; i < times.length; i++) {
  const d = times[i] - times[i - 1]
  if (d > 0 && d < 600) deltas.push(d)
}
if (deltas.length) {
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
  console.log(`平均: ${Math.round(avg)} 秒/个`)
  console.log(`预计剩余: ${Math.round((200 - done) * avg / 60)} 分钟`)
}

// 是否还在跑
const st = fs.statSync(f)
const ageSec = Math.round((Date.now() - st.mtime.getTime()) / 1000)
console.log(`最后写入: ${ageSec}s 前${ageSec > 120 ? ' ⚠ 可能已停止' : ' ✅ 正在运行'}`)

console.log('\n最近结果:')
console.log(lines.filter(l => /✅ 上架成功|✅ 商品已创建|❌ 失败/.test(l)).slice(-5).map(l => l.replace(/^\[[\d:]+\]\s*/, '')).join('\n'))
