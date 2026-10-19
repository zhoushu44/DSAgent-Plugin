import fs from 'node:fs';
import path from 'node:path';
const roots = ['C:/Users/Administrator/AppData/Local/Temp/mqs-swarm', 'C:/Users/Administrator/mqs-swarm-docs-result'];
const skip = new Set(['.git', 'node_modules']);
function walk(d, out) {
  let ents = [];
  try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (skip.has(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const re = /(haohuo\.jinritemai|school\.jinritemai|fxg\.jd\.com|shop\.jd\.com|sale\.jd\.com|1688\.com|work\.1688|sell\.taobao|myseller\.taobao|tmall\.com|douyin|jinritemai|jingdong|1688|taobao|pinduoduo)/gi;
const tally = {};
for (const r of roots) {
  const files = walk(r, []);
  console.log('#### ROOT ' + r + ' files=' + files.length);
  for (const f of files) {
    let t = '';
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const m = t.match(re);
    if (!m) continue;
    const uniq = {};
    for (const x of m) { const k = x.toLowerCase(); uniq[k] = (uniq[k] || 0) + 1; tally[k] = (tally[k] || 0) + 1; }
    console.log('  ' + f.replace(/\\/g, '/').replace(r + '/', '') + '  ' + JSON.stringify(uniq));
  }
}
console.log('#### TALLY ' + JSON.stringify(tally));
