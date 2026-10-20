import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const srcDir = path.join(root, 'src');
const names = new Set();
const domains = new Set();
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const files = walk(srcDir, []);
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/name:\s*'(dsagent_[a-z0-9_]+)'/g)) names.add(m[1]);
  for (const m of s.matchAll(/name:\s*"(dsagent_[a-z0-9_]+)"/g)) names.add(m[1]);
  for (const m of s.matchAll(/[a-z0-9-]+\.(?:tmall|taobao|jd|jinritemai|douyin|1688|pinduoduo|yangkeduo|goofish|xianyu|xiaohongshu|zhihu|bilibili)\.com/g)) domains.add(m[0]);
}
console.log('TOOLS ' + [...names].sort().join(' '));
console.log('DOMAINS ' + [...domains].sort().join(' '));
