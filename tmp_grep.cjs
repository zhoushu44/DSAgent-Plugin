const fs=require('fs');const path=require('path');
const terms=(process.argv[2]||'mqs').split(',');
const roots=process.argv.slice(3);
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;}
let files=[];for(const r of roots){try{const st=fs.statSync(r);if(st.isDirectory())walk(r,files);else files.push(r);}catch(e){}}
for(const f of files){let t;try{t=fs.readFileSync(f,'utf8')}catch(e){continue}
const lines=t.split(/\r?\n/);const hits=[];lines.forEach((l,i)=>{if(terms.some(x=>x&&l.toLowerCase().includes(x.toLowerCase())))hits.push([i+1,l]);});
if(hits.length){console.log('== '+f+' ('+hits.length+')');for(const [i,l] of hits.slice(0,8))console.log('  '+i+': '+l.slice(0,200));}}
