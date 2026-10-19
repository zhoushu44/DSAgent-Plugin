const fs=require('fs');
const p='C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_remote-config.json';
const cfg=JSON.parse(fs.readFileSync(p,'utf8'));
console.log('keys',Object.keys(cfg));
const mods=cfg.modules||[];
console.log('moduleCount',mods.length);
for(const m of mods){
  console.log(JSON.stringify({name:m.name,label:m.label,title:m.title,scripts:m.remoteScripts,url:m.url,hosts:m.hosts},null,0));
}
