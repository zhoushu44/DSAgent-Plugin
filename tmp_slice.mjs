import fs from 'node:fs'
const args = process.argv.slice(2)
const lines = fs.readFileSync(args[0], 'utf8').split('\n')
console.log(lines.slice(Number(args[1]), Number(args[2])).join('\n'))
