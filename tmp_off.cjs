const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
console.log('LEN',GM.length);
const names=['mms.pinduoduo.com','wares-jdm.jd.com','ark.xiaohongshu.com','fxg.jinritemai.com','goods_manager_product_','goods_manager_publish_','pinduoduo:{hosts','douyin:{hosts','jd:{hosts','xiaohongshu:{hosts'];
for(const n of names){const a=[];let i=-1;while((i=GM.indexOf(n,i+1))!==-1&&a.length<8)a.push(i);console.log(n,'=>',a.join(','));}
const p=GM.indexOf('pinduoduo:{hosts');
console.log('');
console.log('[PDD CTX]');
console.log(GM.slice(p-60,p+420));
const j=GM.indexOf('wares-jdm.jd.com');
console.log('');
console.log('[JD CTX]');
console.log(GM.slice(j-500,j+400));
const g=GM.indexOf('goods_manager_product_');
console.log('');
console.log('[IDB CTX]');
console.log(GM.slice(g-400,g+400));
