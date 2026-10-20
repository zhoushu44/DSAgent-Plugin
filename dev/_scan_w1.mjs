import fs from 'node:fs';
import path from 'node:path';
const kw = ['觅千手','goods_manager','偏移','坐标','矩阵','矩阵'];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (f === '.git' || f === 'node_modules' || f === '.commit-verify-SSKUuZ') continue;
    const p = path.join(d, f);
    let s;
    try { s = fs.statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else if (/\.(md|ts|mjs|json|yml)$/.test(f)) {
      const t = fs.readFileSync(p, 'utf8');
      const hits = kw.filter((k) => t.includes(k));
      if (hits.length) console.log(p, hits.join(','));
    }
  }
}
walk('.');
