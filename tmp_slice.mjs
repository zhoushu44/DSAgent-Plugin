import fs from 'fs';
const p = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js';
const t = fs.readFileSync(p, 'utf8');
const start = Number(process.argv[2] || 0);
const len = Number(process.argv[3] || 3000);
const out = process.argv[4] || 'tmp_slice_out.txt';
fs.writeFileSync(out, t.slice(start, start + len), 'utf8');
console.log('wrote', out, 'len', Math.min(len, t.length - start));
