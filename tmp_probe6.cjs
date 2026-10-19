const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function show(l,a,b){console.log('===== '+l);console.log(GM.slice(a,b));console.log('');}
// platform-specific branches
const re=/"?(pinduoduo|taobao|tmall|douyin|jd|xiaohongshu|1688|kuaishou|weidian|xianyu)"?\s*(===|==|:)/g;
let m,cnt={};
while((m=re.exec(GM))){cnt[m[1]]=(cnt[m[1]]||0)+1;}
console.log('platform literal usage counts',JSON.stringify(cnt));
for(const p of ['case"pinduoduo"','=== "pinduoduo"','"pinduoduo"===','platformKey','platform:','getPlatform']){const a=[];let i=-1;while((i=GM.indexOf(p,i+1))!==-1&&a.length<6)a.push(i);console.log(p,'=>',a.join(','));}
show('engine step list',22100,22700);
