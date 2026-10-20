import fs from 'node:fs';
import path from 'node:path';
const needles = ['5.61','觅千手','goods_manager','mqs'];
const skip = new Set(['node_modules','.git','.dsagent','.swarm6']);
function walk(d, depth){
  if(depth>6)return;
  let ents=[];
  try{ents=fs.readdirSync(d,{withFileTypes:true});}catch(e){return;}
  for(const e of ents){
    if(skip.has(e.name))continue;
    const p=path.join(d,e.name);
    if(e.isDirectory()){walk(p,depth+1);continue;}
    if(!/\.(ts|json|md|mjs|cjs|js|txt|yml|yaml|ps1)$/.test(e.name))continue;
    let t='';
    try{t=fs.readFileSync(p,'utf8');}catch(e){continue;}
    for(const n of needles){
      let i=t.indexOf(n);
      let c=0;
      const hits=[];
      while(i>=0 && c<5){hits.push(i);i=t.indexOf(n,i+1);c++;}
      if(hits.length)console.log(p+'\t'+n+'\t'+hits.join(',')+'\tlen='+t.length);
    }
  }
}
walk('.',0);
