import fs from 'node:fs'
const [file, reStr] = process.argv.slice(2)
const re = new RegExp(reStr, 'i')
const t = fs.readFileSync(file, 'utf8')
t.split('\n').forEach((l, i) => { if (re.test(l)) console.log((i + 1) + ': ' + l.trim()) })
