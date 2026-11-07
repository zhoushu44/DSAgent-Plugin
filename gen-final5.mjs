import fs from 'node:fs';
const TITLE='双层中空纸杯一次性咖啡杯加厚防烫热饮杯';
const shapes=[
 {s:[{n:'款式',v:['雪域哑光','复古墨绿']}]},
 {s:[{n:'款式',v:['雪域哑光','复古墨绿']},{n:'容量',v:['14oz','16oz']}]},
 {s:[{n:'款式',v:['雪域哑光','复古墨绿']},{n:'容量',v:['12oz','14oz','16oz']}]},
 {s:[{n:'款式',v:['雪域哑光']}]},
 {s:[{n:'款式',v:['雪域哑光','复古墨绿','黑金几何']},{n:'容量',v:['14oz','16oz']}]},
];
for(let i=0;i<5;i++){
  const sh=shapes[i];
  const skus=[];let k=1;
  if(sh.s.length===1){ sh.s[0].v.forEach((v,j)=>skus.push({specs:{[sh.s[0].n]:v},price:String(19.9+j),stock:'100',itemNo:`F${i+1}-${j+1}`})); }
  else { for(const v1 of sh.s[0].v) for(const v2 of sh.s[1].v){ skus.push({specs:{[sh.s[0].n]:v1,[sh.s[1].n]:v2},price:String(19.9+k),stock:'100',itemNo:`F${i+1}-${k}`}); k++; } }
  const maxP=Math.max(...skus.map(s=>Number(s.price)));
  const prod={title:TITLE,category:'纸杯',price:String(maxP+5),stock:'500',
    images:['E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D1_雪域哑光·双层中空_1024.png','E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D2_复古墨绿·印章咖啡豆_1024.png','E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D3_黑金几何·冰美式_1024.png','E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D4_菱格压纹·轻奢商务_1024.png','E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D5_中式青花·缠枝莲_1024.png'],
    specs:sh.s.map(x=>({name:x.n,values:x.v.map(v=>({value:v}))})),skus};
  fs.writeFileSync(`E:/360MoveData/Users/Administrator/Desktop/童装/pdd_js_analysis/products/batch/final-${i+1}.json`,JSON.stringify(prod,null,2));
  console.log(`final-${i+1}: ${sh.s.map(x=>x.n+'('+x.v.length+')').join('×')} = ${skus.length} SKU`);
}
