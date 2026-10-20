import fs from 'node:fs';
const ORIG = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');
let idx = 0, n = 0;
while ((idx = ORIG.indexOf('_pddSummarizeEditBody', idx)) !== -1) {
  console.log(`\n=== 命中 ${++n} @${idx} ===`);
  console.log(ORIG.slice(Math.max(0, idx - 120), idx + 160).replace(/\n/g, '\\n'));
  idx += 22;
}
