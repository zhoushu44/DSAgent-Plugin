import fs from 'node:fs';
import path from 'node:path';
const re = new RegExp(process.argv[2], 'i');
const roots = process.argv.slice(3);
function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); return; }
  if (!/\.(ts|tsx|mjs|cjs|js|json|md)$/.test(p)) return;
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch { return; }
  txt.split(/\r?\n/).forEach((l, i) => { if (re.test(l)) console.log(p + ':' + (i + 1) + ': ' + l.trim().slice(0, 180)); });
}
for (const r of roots) walk(r);
