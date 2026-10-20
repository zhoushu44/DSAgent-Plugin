import fs from 'node:fs';
const f = process.argv[2];
const pats = process.argv.slice(3);
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
lines.forEach((l, i) => {
  if (pats.some((p) => l.includes(p))) console.log(`${i + 1}: ${l.trim().slice(0, 400)}`);
});
