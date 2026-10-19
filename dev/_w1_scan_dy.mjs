import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const re = new RegExp(process.argv[3], 'i');
for (const f of fs.readdirSync(root)) {
  const p = path.join(root, f);
  let st;
  try { st = fs.statSync(p); } catch { continue; }
  if (!st.isFile()) continue;
  let t = '';
  try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
  const lines = t.split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => { if (re.test(l)) hits.push((i + 1) + '| ' + l.slice(0, 500)); });
  if (!hits.length) continue;
  console.log('#### ' + f + ' hits=' + hits.length);
  for (const h of hits) console.log(h);
}
