import fs from 'node:fs';
const p = process.argv[2];
const from = Number(process.argv[3] || 0);
const len = Number(process.argv[4] || 8000);
const s = fs.readFileSync(p, 'utf8');
console.log('LEN=' + s.length);
console.log(s.slice(from, from + len));
