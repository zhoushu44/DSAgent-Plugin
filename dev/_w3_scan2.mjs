import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), 'skills');
const ids = fs.readdirSync(dir).filter((n) => n.endsWith('-publish-mqs'));
for (const id of ids) {
  const f = path.join(dir, id, 'SKILL.md');
  const s = fs.readFileSync(f, 'utf8');
  const tools = new Set();
  for (const m of s.matchAll(/dsagent_[a-z0-9_]+/g)) tools.add(m[0]);
  const doms = new Set();
  for (const m of s.matchAll(/[a-z0-9-]+\.(?:tmall|taobao|jd|jinritemai|douyin|1688|pinduoduo|yangkeduo|goofish|xianyu)\.com/g)) doms.add(m[0]);
  const cfgs = new Set();
  for (const m of s.matchAll(/publish-config\/[a-z0-9-]+\.json/g)) cfgs.add(m[0]);
  console.log('=== ' + id);
  console.log('  tools: ' + [...tools].join(' '));
  console.log('  doms : ' + [...doms].join(' '));
  console.log('  cfgs : ' + [...cfgs].join(' '));
}
