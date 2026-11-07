import fs from 'node:fs';
// 用图片空间的 3 张图（已有 URL，不需上传）
const prod={
  title:'双层中空纸杯一次性咖啡杯加厚防烫热饮杯',
  category:'纸杯', price:'29.9', stock:'400',
  imageUrls:[
    'https://img.pddpic.com/mms-goods-image/2026-06-25/fd613076-652c-448d-9bff-852a832b4dbe.jpeg.a.jpeg',
    'https://img.pddpic.com/mms-goods-image/2026-06-25/9123bf5b-65e0-48f2-97d2-3a030957c6f2.jpeg.a.jpeg',
    'https://img.pddpic.com/garner-api-open/2026-05-31/4daba38f47b88e5418a188f4635d8787.png',
  ],
  specs:[{name:'款式',values:[{value:'雪域哑光'},{value:'复古墨绿'}]},{name:'容量',values:[{value:'14oz'},{value:'16oz'}]}],
  skus:[
    {specs:{款式:'雪域哑光',容量:'14oz'},price:'19.9',stock:'100',itemNo:'M1'},
    {specs:{款式:'雪域哑光',容量:'16oz'},price:'21.9',stock:'100',itemNo:'M2'},
    {specs:{款式:'复古墨绿',容量:'14oz'},price:'20.9',stock:'100',itemNo:'M3'},
    {specs:{款式:'复古墨绿',容量:'16oz'},price:'22.9',stock:'100',itemNo:'M4'},
  ],
};
fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/pdd_js_analysis/products/batch/space-img.json',JSON.stringify(prod,null,2));
console.log('已生成 space-img.json | 3张图片空间图 |', prod.skus.length,'SKU');
