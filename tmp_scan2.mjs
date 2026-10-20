import fs from 'node:fs'
const files = process.argv.slice(2)
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const urls = new Set()
  const re = /https?:\/\/[^'"`\s)<>]+/g
  let m
  while ((m = re.exec(s))) urls.add(m[0])
  console.log('=== ' + f)
  for (const u of urls) console.log('  ' + u)
}
