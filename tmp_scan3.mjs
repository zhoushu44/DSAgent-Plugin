import fs from 'node:fs'
const files = process.argv.slice(2)
const re = /(偏移|v5\.6|觅千手|八平台|字符|offset|mqs)/i
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const lines = s.split('\n')
  const hits = []
  lines.forEach((l, i) => { if (re.test(l)) hits.push((i + 1) + ': ' + l.trim().slice(0, 220)) })
  console.log('=== ' + f + ' (' + lines.length + ' lines, ' + hits.length + ' hits)')
  for (const h of hits) console.log(h)
}
