const fs=require('fs');
const f=process.argv[2];const n=parseInt(process.argv[3]||'2000',10);
const t=fs.readFileSync(f,'utf8');
console.log('LEN',t.length);
console.log(t.slice(0,n));
