/**
 * 深挖 bundle：类目属性（propertyId -10000）的选择机制，
 * 以及「网页版暂不支持」这句提示来自哪里（客户端 or 服务端）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const txt = readFileSync('dev/.ui-shots/bundle-p_publish-index.js', 'utf-8')

function ctx(key, before = 400, after = 400, limit = 6) {
  const out = []
  let i = 0
  while ((i = txt.indexOf(key, i)) !== -1 && out.length < limit) {
    out.push(txt.slice(Math.max(0, i - before), i + after))
    i += key.length
  }
  return out
}

const SEARCHES = [
  '暂不支持', '扫码', 'APP扫码', '继续发布', '不支持发布',
  '-10000', 'categoryPredictResult', 'catName', 'channelCatId',
  'property.recommend', 'property.search', 'publishScene',
  '支持网页', 'webPublish', 'supportWeb', 'publishWeb',
]

const res = {}
for (const k of SEARCHES) {
  const c = ctx(k, 350, 350, 4)
  res[k] = c
  console.log(`\n${'='.repeat(70)}\n### ${k}  (命中 ${c.length})\n${'='.repeat(70)}`)
  c.forEach((s, n) => console.log(`\n[${n}] ...${s}...`))
}

// 找所有中文字符串常量（可能含类目提示语）
const zhStrings = [...txt.matchAll(/["'`]([\u4e00-\u9fa5][\u4e00-\u9fa5\w\s，。、：；！？（）\-]{2,40})["'`]/g)]
  .map(m => m[1])
const uniqZh = [...new Set(zhStrings)]
console.log(`\n\n${'='.repeat(70)}\n### bundle 内中文常量（${uniqZh.length} 条），筛选含「分类/类目/发布/网页/APP」\n${'='.repeat(70)}`)
const interesting = uniqZh.filter(s => /分类|类目|发布|网页|APP|支持|扫码|选择/.test(s))
interesting.forEach(s => console.log('  ', s))

writeFileSync('dev/.ui-shots/bundle-zh-strings.json', JSON.stringify({ res, uniqZh, interesting }, null, 2), 'utf-8')
