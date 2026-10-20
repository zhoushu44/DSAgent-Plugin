import fs from 'node:fs'
const parts = ['dev/_w3_a.mjs', 'dev/_w3_b.mjs', 'dev/_w3_c.mjs']
const out = parts.map((p) => fs.readFileSync(p, 'utf8')).join('\n')
fs.writeFileSync('dev/verify-mqs-tools.mjs', out, 'utf8')
console.log('bytes', out.length, 'lines', out.split('\n').length)
