import fs from 'node:fs'
const re = new RegExp(process.argv[3], 'i')
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
let n = 0
lines.forEach((l, i) => { if (re.test(l)) { console.log(i + 1 + ': ' + l); n++ } })
console.log('--- ' + n + ' hits')
