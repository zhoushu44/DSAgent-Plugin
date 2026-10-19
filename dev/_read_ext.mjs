import fs from 'node:fs'
const p = process.argv[2]
const start = Number(process.argv[3] || 0)
const end = Number(process.argv[4] || 40000)
const t = fs.readFileSync(p, 'utf8')
console.log('LEN', t.length)
console.log(t.slice(start, end))
