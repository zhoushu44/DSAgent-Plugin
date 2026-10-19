import fs from 'node:fs';
const GM = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js', 'utf8');
console.log('--- region 392250..393400 ---');
console.log(GM.slice(392250, 393400));
for (const n of ['hosts:[', 'pathIncludes', 'pinduoduo:{hosts', 'douyin:{hosts']) {
  let i = -1; const out = [];
  while ((i = GM.indexOf(n, i + 1)) !== -1 && out.length < 6) out.push(i);
  console.log(n, '=>', out.join(', '));
}
