import fs from 'node:fs'
for (const f of ['PUBLISH-MATRIX.md', 'PUBLISH-SPEC.md', 'CONTENT-PUBLISH-MATRIX.md', 'SKILL-CHECKLIST.md', 'REQUIREMENTS.md']) {
  if (!fs.existsSync(f)) { console.log('MISSING ' + f); continue }
  console.log('===== ' + f)
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (/^#{1,3} /.test(line)) console.log(line)
  }
}
