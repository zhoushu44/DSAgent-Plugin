import fs from 'node:fs';
const f = process.argv[2];
const s = fs.readFileSync(f, 'utf8');
const a = Number(process.argv[3] || 0);
const b = Number(process.argv[4] || 4000);
console.log(s.slice(a, b));
