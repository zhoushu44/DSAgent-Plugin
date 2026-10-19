const fs=require('fs');
const cp=require('child_process');
const pat=new RegExp(process.argv[2],'i');
const files=process.argv.slice(3);
const list=files.length?files:cp.execSync('git ls-files',{encoding:'utf8'}).split('\n').filter(Boolean);
let n=0;
for(const f of list){
  let s; try{s=fs.readFileSync(f,'utf8')}catch(e){continue}
  if(s.indexOf(String.fromCharCode(0))>=0)continue;
  const lines=s.split('\n');
  for(let i=0;i<lines.length;i++){
    if(pat.test(lines[i])){ console.log(f+':'+(i+1)+': '+lines[i].trim().slice(0,200)); n++; }
  }
  if(n>400)break;
}
console.log('--- matches: '+n);
