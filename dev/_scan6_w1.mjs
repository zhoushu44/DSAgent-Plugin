import fs from 'node:fs';
import path from 'node:path';
const root = 'src';
const re = /(?:name|toolName)\s*:\s*['"]([a-zA-Z0-9_]+)['"]/g;
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (f.endsWith('.ts')) {
      const t = fs.readFileSync(p, 'utf8');
      const hits = new Set();
      let m;
      while ((m = re.exec(t))) if (m[1].startsWith('dsagent_')) hits.add(m[1]);
      if (hits.size) console.log(p, [...hits].join(' '));
    }
  }
}
walk(root);
