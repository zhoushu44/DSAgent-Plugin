const fs=require('fs');
const f=process.argv[2];
const from=Number(process.argv[3]||0), len=Number(process.argv[4]||6000);
const s=fs.readFileSync(f,'utf8');
process.stdout.write(s.slice(from, from+len));
