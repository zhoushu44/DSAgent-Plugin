import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2]
const re = new RegExp(process.argv[3], 'i')
const exts = new Set(['.md', '.ts', '.mjs', '.js', '.json', '.yml', '.yaml', '.txt', '.ps1', '.py'])
const skip = new Set(['.git', 'node_modules', '.dsagent', 'dist', 'lib'])
const out = []
function walk(dir) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (skip.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (exts.has(path.extname(e.name).toLowerCase())) {
      let s
      try { s = fs.readFileSync(p, 'utf8') } catch { continue }
      const lines = s.split('\n')
      lines.forEach((l, i) => { if (re.test(l)) out.push(p.replace(root, '.') + ':' + (i + 1) + ': ' + l.trim().slice(0, 220)) })
    }
  }
}
walk(root)
console.log(out.length + ' hits')
for (const o of out.slice(0, 120)) console.log(o)
