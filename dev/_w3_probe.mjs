import fs from 'node:fs'
const dirs = fs.readdirSync('skills').filter((d) => d.endsWith('-publish-mqs'))
for (const d of dirs) {
  const t = fs.readFileSync('skills/' + d + '/SKILL.md', 'utf8')
  const tools = [...new Set(t.match(/dsagent_[a-z0-9_]+/g) || [])]
  const cfg = [...new Set(t.match(/publish-config\/[A-Za-z0-9_.-]+/g) || [])]
  const dom = [...new Set(t.match(/[a-z0-9-]+\.(?:com|cn|net)/g) || [])]
  console.log('=====', d, 'len', t.length)
  console.log(' tools:', tools.join(','))
  console.log(' cfg:', cfg.join(','))
  console.log(' dom:', dom.join(','))
}
