import fs from 'node:fs';
const p='E:/360MoveData/Users/Administrator/Desktop/童装/pdd_js_analysis/products/batch/final-2.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
delete j.images;
fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/pdd_js_analysis/products/batch/noimg.json',JSON.stringify(j,null,2));
console.log('已生成无图版本:',j.title,j.skus.length,'SKU');
