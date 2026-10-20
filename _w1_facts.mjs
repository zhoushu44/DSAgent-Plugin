import fs from 'node:fs';
const GM='C:\\Users\\Administrator\\AppData\\Local\\Temp\\mqs-swarm\\scripts\\_gm.js';
const t=fs.readFileSync(GM,'utf8');
const needles=[
 'i={taobao:"淘宝"',
 'pinduoduo:{hosts:',
 'taobao:{hosts:',
 'tmall:{hosts:',
 'douyin:{hosts:',
 'jd:{hosts:',
 'xiaohongshu:{hosts:',
 'kuaishou:{hosts:',
 'weidian:{hosts:',
 '1688:{hosts:',
 'xianyu:{hosts:',
 'pathIncludes:',
 'asyncOpt.htm',
 'ai/category.htm',
 'transformRequestBody(',
 'fillImageData(',
 'fillSkuPriceData(',
 'fillShippingConfig(',
 'applyPddElecGoodsAttributes(',
 'buildStablePriceDetailForFill',
 'goods_manager/js/index.js',
 'getFreightTemplate',
 'sizeTemplateMap',
];
for(const n of needles){
  let i=t.indexOf(n),c=0;const hits=[];
  while(i>=0&&c<6){hits.push(i);i=t.indexOf(n,i+1);c++;}
  console.log(n+' => '+(hits.length?hits.join(', '):'(none)'));
}
console.log('TOTAL_LEN='+t.length);
