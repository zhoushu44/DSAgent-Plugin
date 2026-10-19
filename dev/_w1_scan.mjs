import fs from 'node:fs'
const files = process.argv.slice(2)
const needle = process.env.NEEDLE || 'mqs'
for (const f of files) {
  let t
  try { t = fs.readFileSync(f, 'utf8') } catch { continue }
  const lines = t.split('\n')
  lines.forEach((l, i) => { if (l.toLowerCase().includes(needle.toLowerCase())) console.log(f + ':' + (i + 1) + ': ' + l.slice(0, 220)) })
}
