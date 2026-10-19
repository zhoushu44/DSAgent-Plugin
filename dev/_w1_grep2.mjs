import fs from 'node:fs';
const file = process.argv[2];
const re = new RegExp(process.argv[3], 'g');
const t = fs.readFileSync(file, 'utf8');
let m;
let n = 0;
while ((m = re.exec(t)) && n < 60) {
  const s = Math.max(0, m.index - 120);
  console.log('@' + m.index + ' ... ' + t.slice(s, m.index + 200).replace(/\r?\n/g, ' '));
  console.log('---');
  n++;
}
console.log('total matches shown=' + n);
