import fs from 'node:fs';
const f = process.argv[2];
const t = fs.readFileSync(f, 'utf8');
console.log('len', t.length);
console.log(JSON.stringify(t.slice(0, 600)));
