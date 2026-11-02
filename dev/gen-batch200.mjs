/**
 * 生成 200 个商品测试数据
 * 用 5 个不同类目的真实商品作为模板，每个变体改标题+重新分配图片（避免完全相同）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'

const SRC = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/multicat'
const DST = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch200'

// 5 个不同类目
const CATS = [
  { key: 'cup',    name: '纸杯',   base: '一次性纸杯咖啡杯加厚双层奶茶杯家用办公水杯' },
  { key: 'towel',  name: '毛巾',   base: '纯棉毛巾家用洗脸巾加厚吸水速干柔软' },
  { key: 'pillow', name: '抱枕',   base: '抱枕靠垫沙发客厅办公室午睡枕床头靠背' },
  { key: 'bottle', name: '水杯',   base: '便携水杯大容量运动健身水壶户外旅行' },
  { key: 'box',    name: '收纳盒', base: '桌面收纳盒办公文具整理盒多功能储物' },
]

// 标题后缀（不超过 30 汉字总长）
const SUFFIXES = [
  'A款', 'B款', 'C款', 'D款', 'E款', 'F款', 'G款', 'H款',
  '经典', '简约', '时尚', '实用', '新款', '热销', '精选', '优选',
]

if (fs.existsSync(DST)) fs.rmSync(DST, { recursive: true, force: true })
fs.mkdirSync(DST, { recursive: true })

let idx = 0
const problems = []

for (let i = 0; i < 200; i++) {
  const cat = CATS[i % CATS.length]
  const srcFile = path.join(SRC, cat.key, 'product.json')
  if (!fs.existsSync(srcFile)) {
    problems.push(`缺少 ${cat.key}`)
    continue
  }
  const src = JSON.parse(fs.readFileSync(srcFile, 'utf8'))

  idx++
  const dirName = `item-${String(idx).padStart(3, '0')}-${cat.key}`
  const d = path.join(DST, dirName)
  fs.mkdirSync(d, { recursive: true })

  const p = JSON.parse(JSON.stringify(src))

  // 标题：基础（去掉固定部分）+ 变体后缀
  const suffix = SUFFIXES[i % SUFFIXES.length]
  const num = Math.floor(i / SUFFIXES.length) + 1
  let title = `${cat.base}${suffix}${num}`
  // 保证不超 30 汉字
  const hanzi = (title.match(/[\u4e00-\u9fa5]/g) || []).length
  if (hanzi > 30) {
    // 截断到 28 汉字
    let cnt = 0
    let cut = ''
    for (const ch of title) {
      if (/[\u4e00-\u9fa5]/.test(ch)) cnt++
      if (cnt > 28) break
      cut += ch
    }
    title = cut
  }
  p.title = title

  // 图片重新分配（轮转，让每个商品的图不完全相同）
  if (p.images && p.images.length > 1) {
    const n = i % p.images.length
    p.images = [...p.images.slice(n), ...p.images.slice(0, n)]
  }
  if (p.detailImages && p.detailImages.length > 1) {
    const n = (i * 3) % p.detailImages.length
    p.detailImages = [...p.detailImages.slice(n), ...p.detailImages.slice(0, n)]
  }

  // SKU 价格微调（避免完全相同）
  if (p.skus) {
    p.skus = p.skus.map(s => ({
      ...s,
      price: String((parseFloat(s.price) * (1 + (i % 5) * 0.01)).toFixed(2)),
    }))
  }

  fs.writeFileSync(path.join(d, 'product.json'), JSON.stringify(p, null, 2))
}

console.log(`已生成 ${idx} 个商品 → ${DST}`)
if (problems.length) console.log('问题:', problems.join(', '))

// 校验
let maxHanzi = 0
let minHanzi = 999
const cats = {}
for (const dir of fs.readdirSync(DST)) {
  const p = JSON.parse(fs.readFileSync(path.join(DST, dir, 'product.json'), 'utf8'))
  const h = (p.title.match(/[\u4e00-\u9fa5]/g) || []).length
  maxHanzi = Math.max(maxHanzi, h)
  minHanzi = Math.min(minHanzi, h)
  const k = dir.split('-').pop()
  cats[k] = (cats[k] || 0) + 1
}
console.log(`标题汉字数: ${minHanzi}~${maxHanzi}（上限 30）${maxHanzi <= 30 ? '✅' : '❌'}`)
console.log('各类目数量:', JSON.stringify(cats))
console.log('示例标题:', JSON.parse(fs.readFileSync(path.join(DST, 'item-001-cup', 'product.json'), 'utf8')).title)
