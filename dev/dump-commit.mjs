import { readFileSync } from 'node:fs'
const o = JSON.parse(readFileSync('dev/.ui-shots/real-commit.json', 'utf8'))
console.log('=== 全部非空字段 ===')
for (const [k, v] of Object.entries(o)) {
  const s = JSON.stringify(v)
  if (s === '{}' || s === '[]' || s === 'null' || s === '""' || s === '0') continue
  console.log(k, '=>', s.slice(0, 200))
}
