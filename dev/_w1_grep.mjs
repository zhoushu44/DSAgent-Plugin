import fs from 'node:fs'
const files = ['src/tools-publish.ts', 'src/tools-platform.ts', 'src/tools-skill.ts', 'src/index.ts']
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('MISSING ' + f); continue }
  const t = fs.readFileSync(f, 'utf8')
  const m = t.match(/['\"`]dsagent_[a-z0-9_]+['\"`]/gi) || []
  console.log('== ' + f + ' -> ' + Array.from(new Set(m)).join(' '))
}
