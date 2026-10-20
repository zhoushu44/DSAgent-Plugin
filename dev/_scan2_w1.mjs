import fs from 'node:fs';
const [file, ...pats] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
lines.forEach((l, i) => {
  if (pats.some((p) => l.includes(p))) console.log(`${i + 1}: ${l.trim().slice(0, 300)}`);
});
