/**
 * 直接拉发布页 JS bundle，grep 类目相关逻辑。
 * 目的：确认网页版是否内置「类目选择器」，以及哪些类目被标记为网页不可发。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

mkdirSync('dev/.ui-shots', { recursive: true })

const BASE = 'https://g.alicdn.com/idle-pc/xy-site/0.0.178/js'
const CANDIDATES = [
  `${BASE}/p_publish-index.js`,
  `${BASE}/p_publish.js`,
  `${BASE}/main.js`,
  `${BASE}/index.js`,
]

const KEYWORDS = [
  '其他服务', 'DeepSeek服务', '网页版暂不支持', '扫码去APP', 'newPublishChoice',
  '选择分类', 'channelCatId', 'isUserClick', 'skillSellerTransfer',
]

const results = {}
for (const url of CANDIDATES) {
  try {
    const r = await fetch(url)
    if (!r.ok) { console.log(`${url} → HTTP ${r.status}`); continue }
    const txt = await r.text()
    console.log(`\n=== ${url} (${txt.length} bytes) ===`)
    for (const k of KEYWORDS) {
      const i = txt.indexOf(k)
      if (i !== -1) {
        console.log(`  [命中] ${k}`)
        if (!results[k]) results[k] = []
        results[k].push({ url, ctx: txt.slice(Math.max(0, i - 300), i + 300) })
      }
    }
    writeFileSync(`dev/.ui-shots/bundle-${url.split('/').pop()}`, txt, 'utf-8')
  } catch (e) {
    console.log(`${url} → ${String(e).slice(0, 100)}`)
  }
}

// 也拉一下页面 HTML 里声明的所有 js
try {
  const r = await fetch('https://www.goofish.com/publish')
  const html = await r.text()
  const srcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1])
  console.log('\n=== 页面声明的 JS ===')
  for (const s of [...new Set(srcs)]) console.log(' ', s)
  writeFileSync('dev/.ui-shots/publish-html.html', html, 'utf-8')
  // grep 类目词
  for (const k of KEYWORDS) {
    if (html.includes(k)) console.log(`  [HTML 命中] ${k}`)
  }
} catch (e) { console.log('HTML 拉取失败:', String(e).slice(0, 100)) }

console.log('\n=== 命中汇总 ===')
console.log(JSON.stringify(Object.keys(results)))
writeFileSync('dev/.ui-shots/bundle-scan-node.json', JSON.stringify(results, null, 2), 'utf-8')
for (const [k, v] of Object.entries(results)) {
  console.log(`\n--- ${k} ---`)
  console.log(v[0].ctx.slice(0, 500))
}
