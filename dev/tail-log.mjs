import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20_publish2.txt'
const lines = fs.readFileSync(f, 'utf8').split('\n')
console.log('=== 最后 20 行 ===')
console.log(lines.filter(l => l.trim()).slice(-20).map(l => l.slice(0, 135)).join('\n'))
