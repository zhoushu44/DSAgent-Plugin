import fs from 'node:fs'
import path from 'node:path'

const re = /觅千手|mqs|MQS/
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', '.dsagent'].includes(e.name)) continue
    const f = path.join(d, e.name)
    if (e.isDirectory()) { walk(f); continue }
    if (!/\.(md|ts|mjs|cjs|json|txt)$/.test(e.name)) continue
    let t
    try { t = fs.readFileSync(f, 'utf8') } catch { continue }
    const lines = t.split(/\r?\n/)
    lines.forEach((ln, i) => {
      if (re.test(ln)) console.log(f + ':' + (i + 1) + ': ' + ln.trim().slice(0, 200))
    })
  }
}
walk('.')
