import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/vision-fill.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')
console.log('总行数:', lines.length)
console.log('')
console.log('=== 关键锚点 ===')
lines.forEach((l, i) => {
  if (/export async function|^async function|const isRowStyle|#newSpec|建维度.*两次都失败|查视觉缓存/.test(l)) {
    console.log(`L${i + 1}: ${l.trim().slice(0, 90)}`)
  }
})
