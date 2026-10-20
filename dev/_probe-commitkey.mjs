// dump _resolvePddSkuIdKeyForCommitSku 定义全文（确认它是否被流水线用到）
import fs from 'node:fs';
const src = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');
const name = '_resolvePddSkuIdKeyForCommitSku';
let idx = 0;
while ((idx = src.indexOf(name, idx)) !== -1) {
  const prev = idx > 0 ? src[idx - 1] : '';
  const next = src[idx + name.length] || '';
  const ctx = src.slice(Math.max(0, idx - 80), idx + name.length + 80);
  console.log(`@${idx} prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`);
  console.log('ctx:', JSON.stringify(ctx));
  idx += name.length;
}
