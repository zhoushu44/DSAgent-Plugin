import fs from 'node:fs';
const cands = [
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm',
  'C:/Users/Administrator/AppData/Local/Temp/mqs-rea',
  'C:/Users/Administrator/mqs-swarm-docs-result',
  'E:/360MoveData/Users/Administrator/Desktop/觅千手',
];
for (const c of cands) {
  let ok = false;
  let n = 0;
  try { ok = fs.existsSync(c); if (ok) n = fs.readdirSync(c).length; } catch {}
  console.log((ok ? 'YES ' : 'NO  ') + c + (ok ? '  entries=' + n : ''));
}
