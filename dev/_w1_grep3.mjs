import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const pats = process.argv.slice(2);
const skip = new Set(['node_modules', '.git', '.swarm5', 'dist', 'out']);
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|ts|mjs|cjs|js|json|yml|yaml|txt)$/i.test(e.name)) out.push(p);
  }
}
const files = [];
walk(root, files);
const hits = new Map();
for (const f of files) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lines = t.split(/\r?\n/);
  for (const pat of pats) {
    lines.forEach((l, i) => {
      if (l.includes(pat)) {
        const key = path.relative(root, f);
        if (!hits.has(key)) hits.set(key, []);
        if (hits.get(key).length < 12) hits.get(key).push((i + 1) + ': ' + l.slice(0, 220));
      }
    });
  }
}
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('=== ' + k + ' (' + v.length + ')');
  for (const l of v) console.log('  ' + l);
}
