import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const hits = []
function walk(d) {
  let ents = []
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = path.join(d, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!/\.(md|txt|ts|js|mjs|cjs|json|yml|ps1)$/i.test(e.name)) continue
    let t = ''
    try { t = fs.readFileSync(p, 'utf8') } catch { continue }
    const mqs = (t.match(/觅千手/g) || []).length
    const mqs2 = (t.match(/mqs/gi) || []).length
    if (mqs || mqs2) hits.push({ p: path.relative(ROOT, p), mqs, mqs2, size: t.length })
  }
}
walk(ROOT)
hits.sort((a, b) => b.mqs - a.mqs || b.mqs2 - a.mqs2)
for (const h of hits) console.log(h.mqs + '\t' + h.mqs2 + '\t' + h.size + '\t' + h.p)
console.log('total files with hits:', hits.length)
