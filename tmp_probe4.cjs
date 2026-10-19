const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function modIdAt(off){const m=GM.lastIndexOf('function(e,t,r){',off);const seg=GM.slice(Math.max(0,m-24),m);return {at:m,head:seg};}
for(const off of [392304,392447,912769,914335,781534,718934,722502,922380,358913,329503,664431]){
  const r=modIdAt(off);console.log('off='+off,'moduleHead='+JSON.stringify(r.head));
}
console.log('');
const kws=['publishGoods','publish_goods','startPublish','openPublish','tb_publish','pddPublish','onPublishClick','batchPublish','publishQueue','goods_manager/js/index.js','_publisher','dataSource','fetchGoodsDetail','collectGoods'];
for(const k of kws){const a=[];let i=-1;while((i=GM.indexOf(k,i+1))!==-1&&a.length<5)a.push(i);console.log(k,'=>',a.join(','));}
console.log('');
console.log('[module 5656 region start]');
const mi=GM.indexOf('5656:function');
console.log('5656 module at',mi);
console.log(GM.slice(mi,mi+600));
