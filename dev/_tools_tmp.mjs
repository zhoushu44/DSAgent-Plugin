import fs from 'node:fs';
for (const f of ['src/tools-publish.ts','src/tools-platform.ts','src/index.ts','src/tools-skill.ts']) {
  const t = fs.readFileSync(f,'utf8');
  const m = [...t.matchAll(/name:\s*'([a-zA-Z0-9_]+)'/g)].map(x=>x[1]);
  console.log(f + ': ' + m.join(', '));
}
