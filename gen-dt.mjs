import fs from 'node:fs';
const prod={
  title:'隔音板隔音棉卧室墙面吸音毛毡自粘墙贴加厚阻尼降噪门贴',
  category:'隔音棉', price:'39.9', stock:'400',
  specs:[{name:'款式',values:[{value:'纯白隔音款'},{value:'月光灰款'}]},{name:'尺寸',values:[{value:'30*60cm单片装'},{value:'30*60cm十片装'}]}],
  skus:[
    {specs:{款式:'纯白隔音款',尺寸:'30*60cm单片装'},price:'12.9',stock:'100',itemNo:'T1'},
    {specs:{款式:'纯白隔音款',尺寸:'30*60cm十片装'},price:'99.9',stock:'100',itemNo:'T2'},
    {specs:{款式:'月光灰款',尺寸:'30*60cm单片装'},price:'13.9',stock:'100',itemNo:'T3'},
    {specs:{款式:'月光灰款',尺寸:'30*60cm十片装'},price:'109.9',stock:'100',itemNo:'T4'},
  ],
};
fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/pdd_js_analysis/products/batch/dt-test.json',JSON.stringify(prod,null,2));
console.log('已生成 dt-test.json |', prod.skus.length, 'SKU（无主图，用源商品图）');
