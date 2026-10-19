import fs from 'fs';
const [file, needle, before='3000', after='3000'] = process.argv.slice(2);
const t = fs.readFileSync(file, 'utf8');
const idx = [];
let i = -1;
while ((i = t.indexOf(needle, i + 1)) !== -1) idx.push(i);
console.log('hits:', idx.length);
for (const p of idx.slice(0, 12)) {
  console.log('===== @' + p + ' =====');
  console.log(t.slice(Math.max(0, p - Number(before)), p + Number(after)));
}
