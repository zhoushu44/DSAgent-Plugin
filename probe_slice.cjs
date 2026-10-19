const fs=require('fs');
const [file,a,b]=process.argv.slice(2);
const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
const s=Math.max(1,parseInt(a,10)), e=parseInt(b,10);
for(let i=s;i<=e&&i<=lines.length;i++)console.log(i+': '+lines[i-1]);
