import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/attr-template-direct.mjs'
const s = fs.readFileSync(f, 'utf8')

// 找 requiredTotal 的所有引用
const lines = s.split('\n')
lines.forEach((l, i) => {
  if (l.includes('requiredTotal')) console.log(`L${i + 1}: ${l.trim().slice(0, 110)}`)
})
