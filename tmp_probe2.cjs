const fs=require('fs');
const crypto=require('crypto');
const paths=['C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/.swarm/integration/scripts/_gm.js'];
for(const p of paths){const b=fs.readFileSync(p);console.log(p,'bytes='+b.length,'chars='+b.toString('utf8').length,'sha256='+crypto.createHash('sha256').update(b).digest('hex').slice(0,16));}
const GM=fs.readFileSync(paths[0],'utf8');
function first(n){return GM.indexOf(n)}
const anchors=[
 'taobao:"淘宝"','pinduoduo:{hosts','douyin:{hosts','jd:{hosts','xiaohongshu:{hosts','kuaishou:{hosts','weidian:{hosts','1688:{hosts','xianyu:{hosts','mms.pinduoduo.com','mobile.yangkeduo.com','fxg.jinritemai.com','wares-jdm.jd.com','ark.xiaohongshu.com','s.kwaixiaodian.com','store.weixin.qq.com','offer-new.1688.com','goofish.com','pathIncludes:["/publish"]',
 'r.endsWith("."+i)','pathIncludes','transformRequestBody(e,t){','this.fillImageData(e,t)','this.fillSkuPriceData(e,t)','this.fillShippingConfig(e,t)','this.applyPddElecGoodsAttributes(e)','fillImageData(e,t){','fillSkuPriceData(e,t){','fillShippingConfig(e,t){','applyPddElecGoodsAttributes(e){',
 'buildStablePriceDetailForFill','getPddStockMode','fillNoSpecSkuPriceDataInRequest','findPriceDataForMultiDimensionalSku','getOrderedSkuKeyIdsWithPrice','resolveSafePddOutGoodsSn','summarizeEditBody','_pddSummarizeEditBody',
 'goods_manager_product_','cdnHost','pdd_transform_request','kdds_pdd_requestBody','cost_template_id','is_default_template_id','shipment_limit_second','two_pieces_discount','out_goods_sn','price_detail','stock_mode'];
for(const a of anchors){const f=first(a);let c=0,i=-1;while((i=GM.indexOf(a,i+1))!==-1)c++;console.log(JSON.stringify(a),'first='+f,'count='+c);}
console.log('');
console.log('[judges 393700..394200]');
console.log(GM.slice(393700,394200));
