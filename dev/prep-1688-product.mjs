#!/usr/bin/env node
/**
 * 1688 素材包 product.json → 拼多多上架格式
 *
 * 用法：
 *   node dev/prep-1688-product.mjs --ai-dir <AI生图目录> [--stamp 20261031] [--factor 2]
 *
 * 解决三个问题：
 *   ① from-pack 生成的文件名带时间戳，product.json 可能仍指向旧批次
 *   ② 1688 原始 skus[] 是 {sku_id,color,size,price,stock}，不是 {specs,price,stock}
 *   ③ 颜色值带厂家前缀（WJP-珊瑚绒睡衣））、尺码带单位（140cm）
 *
 * 输出：<ai-dir>/product-pdd.json
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const AI_DIR = arg('ai-dir', '')
const STAMP = arg('stamp', new Date().toISOString().slice(0, 10).replace(/-/g, ''))
const FACTOR = parseFloat(arg('factor', '2'))
const STOCK = arg('stock', '100')

if (!AI_DIR || !fs.existsSync(AI_DIR)) {
  console.error('用法: node prep-1688-product.mjs --ai-dir <目录> [--stamp YYYYMMDD] [--factor 2]')
  process.exit(1)
}

const p = JSON.parse(fs.readFileSync(path.join(AI_DIR, 'product.json'), 'utf8'))

// ① 按时间戳挑本次生成的文件
const files = fs.readdirSync(AI_DIR).filter(f => f.includes(STAMP))
const mains = files.filter(f => f.startsWith('main_')).sort()
const details = files.filter(f => f.startsWith('detail_')).sort((a, b) => {
  const na = parseInt((a.match(/detail_(\d+)/) || [])[1] || '0')
  const nb = parseInt((b.match(/detail_(\d+)/) || [])[1] || '0')
  return na - nb
})

if (!mains.length) {
  console.error(`❌ 目录里没有 ${STAMP} 的主图，检查 --stamp`)
  process.exit(1)
}
console.log(`本次主图 ${mains.length} 张 / 详情图 ${details.length} 张`)

p.images = mains.map(f => path.join(AI_DIR, f))
p.detailImages = details.map(f => path.join(AI_DIR, f))

// ② 规格名规范化
const SPEC_ALIAS = { '参考分类': '尺码', '尺码表': '尺码', '分类': '尺码' }
const cleanVal = v => String(v)
  .replace(/^WJP[-－][^）)]*[）)]/, '')   // 去厂家前缀
  .replace(/^WJP-/, '')
  .replace(/(\d+)\s*cm$/i, '$1')          // 去尺码单位
  .trim()

const specMap = {}
for (const s of p.specs || []) {
  const newName = SPEC_ALIAS[s.name] || s.name
  specMap[s.name] = newName
  s.name = newName
  s.values = (s.values || []).map(v => {
    const val = cleanVal(typeof v === 'object' ? v.value : v)
    const out = { value: val }
    if (v && typeof v === 'object' && v.image) out.image = v.image
    return out
  })
}

// ③ SKU 转换
p.skus = (p.skus || []).map(sku => {
  const specs = {}
  for (const [k, v] of Object.entries(sku.specs || {})) {
    specs[specMap[k] || k] = cleanVal(v)
  }
  const raw = parseFloat(sku.price) || 0
  return {
    specs,
    price: String(Math.round(raw * FACTOR * 100) / 100),
    stock: STOCK,
    itemNo: sku.itemNo || sku.sku_id || '',
  }
})

// ④ 颜色规格值挂预览图
for (const s of p.specs) {
  if (/颜色|色/.test(s.name)) {
    s.values = s.values.map((v, i) => ({ ...v, image: p.images[i % p.images.length] }))
  }
}

// ⑤ 属性清洗
p.attributes = (p.attributes || [])
  .filter(a => a && a.name && a.value && String(a.name).length <= 20)
  .map(a => ({ name: String(a.name).trim(), value: String(a.value).trim() }))
p.stock = STOCK

const out = path.join(AI_DIR, 'product-pdd.json')
fs.writeFileSync(out, JSON.stringify(p, null, 2), 'utf8')

console.log('\n=== 转换结果 ===')
console.log('标题:', p.title)
console.log('参考价:', p.price)
console.log('规格:', p.specs.map(s => `${s.name}(${s.values.length})`).join(' × '))
console.log('SKU:', p.skus.length, '行')
if (p.skus[0]) console.log('  首个:', JSON.stringify(p.skus[0]))
console.log('属性:', p.attributes.length, '条')
console.log('主图:', p.images.length, '| 详情图:', p.detailImages.length)
console.log('\n已写出:', out)
