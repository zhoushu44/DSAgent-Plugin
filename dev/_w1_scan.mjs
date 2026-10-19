import fs from 'node:fs';
import path from 'node:path';
const KWS = process.argv.slice(2);
const SKIP = new Set(['.git','node_modules','.dsagent']);
const hits = new Map();
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!/\.(md|json|ts|mjs|cjs|js|txt|yml|py)$/.test(e.name)) continue;
    let s; try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const k of KWS) {
      let i = s.indexOf(k);
      while (i >= 0) {
        const line = s.slice(0, i).split('\n').length;
        if (!hits.has(f)) hits.set(f, []);
        hits.get(f).push(`${k}@L${line}`);
        i = s.indexOf(k, i + 1);
      }
    }
  }
}
walk('.');
for (const [f, v] of hits) console.log(f + ' :: ' + v.slice(0, 8).join(', ') + (v.length > 8 ? ` (+${v.length - 8})` : ''));
