import fs from 'node:fs'
const lines = fs.readFileSync('dev/verify-mqs-skills.mjs', 'utf8').split('\n')
console.log('LINES', lines.length)
console.log(lines.slice(195).join('\n'))
