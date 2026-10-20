import fs from 'node:fs'
const t = fs.readFileSync('skills/jd-publish-mqs/SKILL.md', 'utf8')
console.log(t)
console.log('########## SRC DOMAIN EVIDENCE')
const files = fs.readdirSync('src').filter((f) => f.endsWith('.ts'))
for (const f of files) {
  const s = fs.readFileSync('src/' + f, 'utf8')
  const dom = [...new Set(s.match(/[a-z0-9-]+\.(?:com|cn|net)/g) || [])]
  if (dom.length) console.log(f, '->', dom.join(','))
}
