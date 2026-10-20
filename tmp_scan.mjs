import fs from 'node:fs'
const files = process.argv.slice(2)
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const lines = s.split('\n')
  console.log('=== ' + f + ' lines=' + lines.length)
  lines.forEach((l, i) => {
    if (/channel|tmall|jd\.com|douyin|1688|sell\.|item\.upload/i.test(l)) console.log((i + 1) + ': ' + l.trim().slice(0, 200))
  })
}
