import fs from 'node:fs'

const roots = [
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm',
  'C:/Users/Administrator/AppData/Local/Temp/mqs-rea',
  'C:/Users/Administrator/mqs-swarm-docs-result',
]
function walk(d, depth) {
  let names
  try { names = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of names) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const p = d + '/' + e.name
    let size = ''
    if (e.isFile()) { try { size = ' (' + fs.statSync(p).size + ')' } catch {} }
    console.log('  '.repeat(depth) + e.name + (e.isDirectory() ? '/' : size))
    if (e.isDirectory() && depth < 2) walk(p, depth + 1)
  }
}
for (const r of roots) { console.log('### ' + r); walk(r, 0) }
