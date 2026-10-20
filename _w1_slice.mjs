import fs from 'node:fs';
const f=process.argv[2], start=Number(process.argv[3]||0), len=Number(process.argv[4]||4000);
const t=fs.readFileSync(f,'utf8');
console.log('LEN='+t.length);
console.log(t.slice(start,start+len));
