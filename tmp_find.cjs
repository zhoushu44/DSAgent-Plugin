const fs=require('fs');
const path=require('path');
const roots=[
 'C:/Users/Administrator/AppData/Local/Temp',
 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm',
 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
 'E:/360MoveData/Users/Administrator/Desktop',
];
for(const r of roots){
  try{ console.log('DIR',r,'=>',fs.readdirSync(r).filter(n=>/mqs|gm|swarm|pdd/i.test(n)).join(', ')) }catch(e){ console.log('ERR',r,e.code) }
}
function walk(d,depth){
  if(depth>4) return;
  let ents; try{ ents=fs.readdirSync(d,{withFileTypes:true}) }catch{ return }
  for(const e of ents){
    if(e.name==='node_modules'||e.name==='.git') continue;
    const p=path.join(d,e.name);
    if(e.isDirectory()){ if(/mqs|swarm/i.test(e.name)) console.log('HITDIR',p); walk(p,depth+1); }
    else if(/_gm\.js$/.test(e.name)) console.log('HITFILE',p,fs.statSync(p).size);
  }
}
walk('C:/Users/Administrator/AppData/Local/Temp',0);
walk('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',0);
