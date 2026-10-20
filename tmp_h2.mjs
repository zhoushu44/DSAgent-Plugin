import fs from 'node:fs'
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8')
  console.log('=== ' + f)
  s.split('\n').forEach((l, i) => { if (/^#{1,3} /.test(l)) console.log((i + 1) + ': ' + l) })
}
