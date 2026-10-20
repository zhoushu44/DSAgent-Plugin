import fs from 'node:fs';
const GM='C:\\Users\\Administrator\\AppData\\Local\\Temp\\mqs-swarm\\scripts\\_gm.js';
const t=fs.readFileSync(GM,'utf8');
const mode=process.argv[2];
if(mode==='find'){
  const needles=process.argv.slice(3);
  for(const n of needles){
    let i=t.indexOf(n), c=0;
    const hits=[];
    while(i>=0&&c<8){hits.push(i);i=t.indexOf(n,i+1);c++;}
    console.log(JSON.stringify(n)+' -> '+hits.join(', '));
  }
} else if(mode==='at'){
  const offs=process.argv.slice(3).map(Number);
  for(const o of offs) console.log('@'+o+': '+t.slice(o,o+160).replace(/\r?\n/g,'\\n'));
}
