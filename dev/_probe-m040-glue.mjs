import fs from 'node:fs';
const M040 = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_040_6169.js', 'utf8');
for (const name of ['isSkuSearchImageUploadEnabled', '_coerceMovingConfigBool', 'sku_search_img_upload_switch', 'upload_sku_search_image']) {
  let idx = 0, n = 0;
  console.log(`\n########## ${name} ##########`);
  while ((idx = M040.indexOf(name, idx)) !== -1) {
    console.log(`--- 命中 ${++n} @${idx} ---`);
    console.log(M040.slice(Math.max(0, idx - 150), idx + 250).replace(/\n/g, '\\n'));
    idx += name.length;
    if (n >= 4) { console.log('...(截断)'); break; }
  }
  if (n === 0) console.log('(无)');
}
