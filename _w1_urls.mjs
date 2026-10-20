import fs from 'node:fs';
import path from 'node:path';
const roots = ['src','publish-config','skills','dev','scripts'];
const out = [];
function walk(d){
  let ents=[];
  try{ents=fs.readdirSync(d,{withFileTypes:true});}catch(e){return;}
  for(const e of ents){
    if(e.name==='node_modules'||e.name==='.git'||e.name==='.dsagent')continue;
    const p=path.join(d,e.name);
    if(e.isDirectory()){walk(p);continue;}
    if(!/\.(ts|json|md|mjs|cjs|js)$/.test(e.name))continue;
    const t=fs.readFileSync(p,'utf8');
    const m=t.match(/https?:\/\/[^\s"'\]<>)]+/g);
    if(m){for(const u of m)out.push(p+'\t'+u);}
  }
}
for(const r of roots)walk(r);
const seen=new Set();
for(const line of out){if(seen.has(line))continue;seen.add(line);console.log(line);}
