import fs from 'node:fs'
const GM = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js', 'utf8')
for (const n of ['mms.pinduoduo.com', 'wares-jdm.jd.com', 'ark.xiaohongshu.com', 'fxg.jinritemai.com', 's.kwaixiaodian.com', 'store.weixin.qq.com', 'goods_manager_product_', 'goods_manager_publish_', 'goofish.com']) {
  console.log(n, '=>', GM.indexOf(n))
}
const i = GM.indexOf('mms.pinduoduo.com')
console.log('\nCTX:')
console.log(GM.slice(i - 220, i + 320))
const j = GM.indexOf('goods_manager_product_')
console.log('\nIDB CTX:')
console.log(GM.slice(j - 140, j + 240))
