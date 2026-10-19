import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const pats = ['觅千手', 'mqs', 'MQS', 'goods_manager', 'v5.61', 'publish-mqs'];
const skip = new Set(['node_modules', '.git', '.swarm5', 'dist', 'out', 'worktrees']);
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
  lines.forEach((l, i) => {
    for (const pat of pats) {
      if (l.includes(pat)) {
        const key = path.relative(root, f);
        if (!hits.has(key)) hits.set(key, []);
        if (hits.get(key).length < 8) hits.get(key).push((i + 1) + ': ' + l.slice(0, 200));
        break;
      }
    }
  });
}
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log('=== ' + k + ' (' + v.length + ')');
  for (const l of v) console.log('  ' + l);
}
