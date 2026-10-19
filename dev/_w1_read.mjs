import fs from 'node:fs';
const f = process.argv[2];
const t = fs.readFileSync(f, 'utf8').split('\n');
const from = Number(process.argv[3] || 0);
const to = Number(process.argv[4] || t.length);
console.log(t.slice(from, to).map((l, i) => (from + i + 1) + ': ' + l).join('\n'));
