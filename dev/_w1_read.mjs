import fs from 'node:fs';
const [file, start, count] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const s = Number(start || 0);
const n = Number(count || 60);
lines.slice(s, s + n).forEach((l, i) => console.log((s + i + 1) + '| ' + l));
console.log('TOTAL_LINES=' + lines.length);
