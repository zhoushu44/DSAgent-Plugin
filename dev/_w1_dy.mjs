import fs from 'node:fs';
import path from 'node:path';
const root = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/docs';
const re = /douyin|jinritemai|抖店|抖音/i;
const files = fs.readdirSync(root);
console.log('files=' + files.length);
for (const f of files) {
  const p = path.join(root, f);
  const st = fs.statSync(p);
  if (!st.isFile()) { console.log('skip dir ' + f); continue; }
  const t = fs.readFileSync(p, 'utf8');
  const lines = t.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i + 1);
  console.log('  ' + f + ' size=' + t.length + ' hits=' + hits.length + ' lines=' + hits.slice(0, 40).join(','));
}
