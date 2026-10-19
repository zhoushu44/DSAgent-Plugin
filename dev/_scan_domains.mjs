import fs from 'node:fs'
import path from 'node:path'

const dir = 'docs/pdd-publish-mode2/evidence'
const re = /https?:\/\/[A-Za-z0-9._\-]+[A-Za-z0-9._\-\/]*/g
const byFile = new Map()
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f)
  if (!fs.statSync(p).isFile()) continue
  const t = fs.readFileSync(p, 'utf8')
  const m = t.match(re)
  if (!m) continue
  const set = new Set()
  for (const u of m) {
    try { set.add(new URL(u).host) } catch {}
  }
  if (set.size) byFile.set(f, [...set].sort())
}
for (const [f, hosts] of byFile) console.log(f + ' -> ' + hosts.join(', '))
