import fs from 'node:fs';
const t=fs.readFileSync('C:\\Users\\Administrator\\AppData\\Local\\Temp\\mqs-swarm\\scripts\\_gm.js','utf8');
const offs=JSON.parse(process.argv[2]);
for(const o of offs){
  console.log('@'+o+' ['+t.slice(o,o+110).replace(/\n/g,'\\n')+']');
}
