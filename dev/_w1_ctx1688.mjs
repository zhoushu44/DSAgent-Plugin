import fs from 'node:fs';
const files = process.argv.slice(2);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  let i = -1;
  while ((i = t.indexOf('1688', i + 1)) >= 0) {
    console.log('=== ' + f + ' @' + i + ' ===');
    console.log(t.slice(Math.max(0, i - 350), i + 350));
    console.log();
  }
}
