const fs=require('fs');
const A='C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js';
const B='C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/.swarm/integration/scripts/_gm.js';
const a=fs.readFileSync(A,'utf8'), b=fs.readFileSync(B,'utf8');
const names=['pinduoduo:{hosts','douyin:{hosts','jd:{hosts','xiaohongshu:{hosts','kuaishou:{hosts','weidian:{hosts','1688:{hosts','xianyu:{hosts','pathIncludes:["/publish"]','r.endsWith("."+i)','transformRequestBody(e,t){','this.fillImageData(e,t)','fillImageData(e,t){','fillSkuPriceData(e,t){','fillShippingConfig(e,t){','applyPddElecGoodsAttributes(e){','buildStablePriceDetailForFill','getPddStockMode','fillNoSpecSkuPriceDataInRequest','goods_manager_product_','cdnHost','pdd_transform_request','mms.pinduoduo.com','wares-jdm.jd.com','ark.xiaohongshu.com','fxg.jinritemai.com','s.kwaixiaodian.com','store.weixin.qq.com','offer-new.1688.com','goofish.com','mobile.yangkeduo.com'];
for(const n of names) console.log(n.padEnd(40), 'A='+a.indexOf(n), 'B='+b.indexOf(n), 'd='+(b.indexOf(n)-a.indexOf(n)));
// find first differing index
let i=0; while(i<Math.min(a.length,b.length)&&a[i]===b[i])i++;
console.log('first diff at',i);
console.log('A ctx:',JSON.stringify(a.slice(i-80,i+120)));
console.log('B ctx:',JSON.stringify(b.slice(i-80,i+120)));
