const fs=require('fs'),p=require('path');
function walk(d,out){for(const f of fs.readdirSync(d,{withFileTypes:true})){if(f.name==='.git'||f.name==='node_modules')continue;const fp=p.join(d,f.name);if(f.isDirectory())walk(fp,out);else out.push(fp);}return out;}
const files=walk('.',[]);
const re=/mqs|MQS|觅千手/g;
let n=0;
for(const f of files){
  if(!/\.(md|ts|mjs|js|json|yml|py)$/.test(f))continue;
  let c; try{c=fs.readFileSync(f,'utf8');}catch(e){continue;}
  let m;
  while((m=re.exec(c))){
    const s=Math.max(0,m.index-80);
    console.log(f+' >>> '+c.slice(s,m.index+100).replace(/\n/g,' | '));
    if(++n>30)process.exit(0);
  }
}
console.log('total hits',n);
