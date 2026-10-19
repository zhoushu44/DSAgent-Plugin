import fs from 'node:fs';
const [file, from, to] = process.argv.slice(2);
const t = fs.readFileSync(file, 'utf8');
const lines = t.split(/\r?\n/);
const a = Math.max(0, (Number(from) || 1) - 1);
const b = to ? Number(to) : lines.length;
console.log(lines.slice(a, b).join('\n'));
