const fs=require('fs'),p=require('path');
const re=/1688|SuggestDock|词表|publish-mqs/i;
function walk(d,out){for(const f of fs.readdirSync(d)){if(f==='.git'||f==='node_modules')continue;const fp=p.join(d,f);const s=fs.statSync(fp);if(s.isDirectory())walk(fp,out);else if(/\.(md|ts|tsx|json|yml|mjs|cjs)$/.test(f))out.push(fp);}return out;}
const files=walk(process.argv[2]||'.',[]);
for(const f of files){const t=fs.readFileSync(f,'utf8');const lines=t.split(/\r?\n/);lines.forEach((l,i)=>{if(re.test(l))console.log(f+':'+(i+1)+': '+l.trim().slice(0,220));});}
