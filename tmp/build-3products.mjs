/**
 * build-3products.mjs — 按类目模板生成 3 个商品 JSON
 */
import fs from 'node:fs'
import path from 'node:path'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const OUT = P + '/artifacts/taobao-3cats'

// 读抓取数据 + 模板
const scraped = JSON.parse(fs.readFileSync(P + '/tmp/scraped6.json', 'utf8'))
const TP = P + '/artifacts/pdd-templates'
const tplOf = (dirName) => JSON.parse(fs.readFileSync(path.join(TP, dirName, 'template.json'), 'utf8'))

const tplKnife = tplOf('标准件_零部件_工业耗材_机床配附件_刀柄_刀杆-22896')
const tplShirt = tplOf('女装_女士精品_衬衫_衬衫-8466')
const tplOrange = tplOf('水产肉类_新鲜蔬果_熟食_新鲜水果_桔子_蜜桔-26228')

const listImgs = (key) => {
  const dir = path.join(OUT, key)
  return fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => path.join(dir, f))
}

// ═══════════════════════════════════════════════
// 1. 刀柄（catId 22896，3 属性：品牌/产地/材质，无规格）
// ═══════════════════════════════════════════════
const knifeImgs = listImgs('tmall_knife')
const knife = {
  title: '数控刀柄BT40高精度ER32动平衡CNC加工中心BT30刀柄',
  catId: 22896,
  images: knifeImgs.slice(0, 5),
  detailImages: knifeImgs.slice(0, 6),
  price: '78.17',
  stock: '500',
  itemNo: 'KNIFE-BT40-001',
  specs: [],
  skus: [
    { specs: {}, price: '88.87', multiPrice: '78.17', stock: '500', itemNo: 'KNIFE-BT40-001', thumb: knifeImgs[0] },
  ],
  attributes: {
    '品牌': '无品牌/无注册商标',
    '产地': '中国大陆',
    '材质': '合金钢',
  },
}

// ═══════════════════════════════════════════════
// 2. 蕾丝衬衫（catId 8466，15 属性，2 维：颜色分类/尺码）
// ═══════════════════════════════════════════════
const shirtImgs = listImgs('tb_shirt')
const shirtColors = ['米白色']
const shirtSizes = ['S', 'M', 'L']
const shirtSkus = []
for (const c of shirtColors) {
  for (const sz of shirtSizes) {
    shirtSkus.push({
      specs: { '颜色分类': c, '尺码': sz },
      price: '82.63',
      multiPrice: '70.23',
      stock: '200',
      itemNo: `SHIRT-${c}-${sz}`,
      thumb: shirtImgs[0],
    })
  }
}
const shirt = {
  title: '设计感蕾丝拼接假两件衬衫女高级感轻奢减龄洋气衬衣',
  catId: 8466,
  images: shirtImgs.slice(0, 5),
  detailImages: shirtImgs.slice(0, 6),
  price: '70.23',
  stock: '600',
  itemNo: 'SHIRT-LACE-001',
  specs: [
    { name: '颜色分类', values: shirtColors.map(v => ({ value: v })) },
    { name: '尺码', values: shirtSizes.map(v => ({ value: v })) },
  ],
  skus: shirtSkus,
  attributes: {
    '品牌': '无品牌/无注册商标',
    '面料俗称': '雪纺',
    '主风格': '甜美',
    '服装款式细节': '蕾丝',
    '服装版型': '宽松型',
    '衣长': '常规款',
    '袖长': '长袖',
    '衣门襟': '套头',
    '领型': '圆领',
    '适用年龄': '18-24周岁',
    '是否加绒': '不加绒',
    '上市时节': '2026年春季',
    '袖型': '常规袖',
  },
}

// ═══════════════════════════════════════════════
// 3. 涌泉蜜桔（catId 26228，6 属性，无规格）
// ═══════════════════════════════════════════════
const orangeImgs = listImgs('tb_orange')
const orange = {
  title: '临海涌泉蜜桔当季新鲜水果台州黄岩无核蜜橘整箱10斤',
  catId: 26228,
  images: orangeImgs.slice(0, 5),
  detailImages: orangeImgs.slice(0, 6),
  price: '98',
  stock: '300',
  itemNo: 'ORANGE-10JIN-001',
  specs: [],
  skus: [
    { specs: {}, price: '108', multiPrice: '98', stock: '300', itemNo: 'ORANGE-10JIN-001', thumb: orangeImgs[0] },
  ],
  attributes: {
    '品牌': '无品牌/无注册商标',
    '产地': '浙江省',
    '外包装方式': '箱装',
    '适用场景': '家庭食用',
    '是否为有机食品': '否',
  },
}

const all = { knife, shirt, orange }
for (const [k, v] of Object.entries(all)) {
  const f = path.join(OUT, `${k}.json`)
  fs.writeFileSync(f, JSON.stringify(v, null, 2), 'utf8')
  console.log(`✅ ${k}.json`)
  console.log(`   标题: ${v.title} (${[...v.title].length} 字)`)
  console.log(`   类目: ${v.catId}  主图: ${v.images.length}  详情: ${v.detailImages.length}`)
  console.log(`   规格: ${v.specs.map(s => s.name + '×' + s.values.length).join(' × ') || '无'}  SKU: ${v.skus.length}`)
  console.log(`   属性: ${Object.keys(v.attributes).length} 个`)
  console.log('')
}
