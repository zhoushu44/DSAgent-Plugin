const fs=require('fs'),p=require('path');
function walk(d,out){for(const f of fs.readdirSync(d)){if(f==='.git'||f==='node_modules')continue;const fp=p.join(d,f);const s=fs.statSync(fp);if(s.isDirectory())walk(fp,out);else if(/\.(md|ts|json|yml|mjs|cjs)$/.test(f))out.push(fp);}return out;}
const files=walk('.',[]);
for(const f of files){const t=fs.readFileSync(f,'utf8');const lines=t.split(/\r?\n/);lines.forEach((l,i)=>{if(/1688|觅千手|mqs/i.test(l))console.log(f+':'+(i+1)+': '+l.trim().slice(0,200));});}
