import fs from 'node:fs'
const f = process.argv[2]
const t = fs.readFileSync(f, 'utf8')
const lines = t.split(/\r?\n/)
if (process.argv[3] === 'heads') {
  lines.forEach((l, i) => { if (l.startsWith('#')) console.log(i + 1 + ': ' + l) })
} else {
  const from = Number(process.argv[3] || 1)
  const to = Number(process.argv[4] || lines.length)
  console.log(lines.slice(from - 1, to).join('\n'))
}
