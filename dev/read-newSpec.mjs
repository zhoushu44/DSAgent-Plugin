import { execSync } from 'node:child_process'
const src = execSync('git show e3f3697:skills/pdd-publish-http/scripts/vision-fill.mjs', {
  cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
})
const lines = src.split('\n')
const i = lines.findIndex(l => l.includes('自定义输入框 + checkbox'))
console.log(`起点 L${i + 1}`)
console.log(lines.slice(i - 6, i + 90).join('\n'))
