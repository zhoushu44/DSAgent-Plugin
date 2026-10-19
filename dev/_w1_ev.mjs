import fs from 'node:fs';
const files = process.argv.slice(2);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const urls = [...new Set(t.match(/https?:\/\/[A-Za-z0-9._\/:?=&%-]+/g) || [])];
  console.log('### ' + f + ' urls=' + urls.length);
  for (const u of urls) console.log('  ' + u);
}
