/**
 * scrape3.mjs — 修正标题/SKU 抓取
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)

const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
  "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"], { encoding: 'utf8' })
const ports = out.split(/\s+/).map(Number).filter(Boolean)

let browser = null
for (const pt of ports) {
  try {
    const r = await fetch('http://127.0.0.1:' + pt + '/json/version', { signal: AbortSignal.timeout(250) })
    const j = await r.json()
    if (!j.Browser || !/Chrome/i.test(j.Browser)) continue
    const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
    const ps = await b.pages()
    if (ps.some(x => { try { return /taobao|tmall/.test(x.url()) } catch { return false } })) { browser = b; break }
    await b.disconnect()
  } catch { }
}
if (!browser) { console.log('❌ 无淘宝窗口'); process.exit(0) }

const ps = await browser.pages()
const p = ps.find(x => { try { return /taobao|tmall/.test(x.url()) } catch { return false } })
await p.bringToFront()
const sleep = ms => new Promise(r => setTimeout(r, ms))

const URLS = [
  { key: 'tmall_knife', url: 'https://detail.tmall.com/item.htm?id=819241838637', name: '高精度刀柄' },
  { key: 'tb_shirt', url: 'https://item.taobao.com/item.htm?id=' + (await (async () => { return '0' })()), name: '蕾丝拼接衬衫', short: 'https://e.tb.cn/h.jlFsvkfncX2RV7m?tk=HTdw646k1Gr' },
  { key: 'tb_orange', url: 'https://item.taobao.com/item.htm?id=0', name: '涌泉蜜桔', short: 'https://e.tb.cn/h.jlFG3W8UfWqhLYJ?tk=Pmv5646kTs6' },
]

const res = {}

for (const U of URLS) {
  console.log(`\n=== ${U.name} ===`)
  const target = U.short || U.url
  await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { })
  await sleep(7000)

  const d = await p.evaluate(() => {
    const t = s => String(s || '').replace(/\s+/g, ' ').trim()

    // ★ 标题：天猫是 h1[class*="ItemHeader--mainTitle"]，淘宝是 [class*="ItemTitle--mainTitle"]
    let title = ''
    const titleSels = [
      'h1[class*="ItemHeader--mainTitle"]',
      '[class*="ItemHeader--mainTitle"]',
      '[class*="ItemTitle--mainTitle"]',
      '[class*="mainTitle"]',
      'h1[class*="title"]',
      '.tb-main-title',
      '#J_Title .tb-main-title',
      'h1',
    ]
    for (const sel of titleSels) {
      for (const el of document.querySelectorAll(sel)) {
        const x = t(el.innerText)
        if (x.length >= 6 && !/用户评价|评价\d|月销|已售|收藏/.test(x)) { title = x; break }
      }
      if (title) break
    }

    // ★ 兜底：document.title（去掉平台后缀）
    if (!title) {
      title = t(document.title)
        .replace(/[-—|]\s*(淘宝网|天猫|Tmall\.com|taobao\.com).*$/i, '')
        .replace(/^(淘宝网|天猫)\s*[-—|]\s*/, '')
        .trim()
    }

    // 图片
    const imgs = []
    const addImg = s => {
      if (!s || !/alicdn|tbcdn|taobaocdn/.test(s)) return
      const clean = s.split('_')[0].replace(/^\/\//, 'https://')
      if (clean.length < 20) return
      if (!imgs.includes(clean)) imgs.push(clean)
    }
    for (const sel of ['[class*="PicGallery"] img', '[class*="Thumbnail"] img', '[class*="mainPic"] img', '#J_UlThumb img', '[class*="PicGallery--"] img']) {
      for (const img of document.querySelectorAll(sel)) addImg(img.src || img.getAttribute('data-src'))
    }
    if (imgs.length < 3) {
      for (const img of document.querySelectorAll('img')) {
        const w = img.naturalWidth || img.width || 0
        if (w >= 400) addImg(img.src || img.getAttribute('data-src'))
      }
    }

    // 价格
    let price = ''
    for (const sel of ['[class*="Price--priceText"]', '[class*="priceText"]', '.tm-price', '.tb-rmb-num', '[class*="Price"] em', '[class*="price"] em']) {
      const x = t(document.querySelector(sel)?.innerText)
      if (/\d/.test(x)) { price = x.replace(/[^\d.]/g, ''); break }
    }

    // SKU
    const skuGroups = []
    const seen = new Set()
    for (const dl of document.querySelectorAll('dl, [class*="SkuContent"], [class*="skuWrapper"], [class*="SkuPanel"], [class*="SkuContent--"]')) {
      let label = ''
      for (const lsel of ['dt', '[class*="SkuTitle"]', '[class*="skuTitle"]', '[class*="Title"]']) {
        const x = t(dl.querySelector(lsel)?.innerText)
        if (x && x.length <= 12) { label = x; break }
      }
      if (!label || seen.has(label)) continue
      let vals = [...dl.querySelectorAll('dd [class*="valueItem"], dd li, dd a, [class*="SkuValue"] [class*="item"], [class*="valueItem"], [class*="SkuContent--valueItem"]')]
        .map(e => t(e.innerText)).filter(x => x && x.length < 25)
      vals = [...new Set(vals)].filter(x => !/^(请选择|更多|展开|收起)$/.test(x))
      if (vals.length >= 2) { skuGroups.push({ label, values: vals.slice(0, 25) }); seen.add(label) }
    }

    return {
      title,
      titleLen: [...title].length,
      images: imgs.slice(0, 8),
      imageCount: imgs.length,
      price,
      skuGroups,
      h1s: [...document.querySelectorAll('h1')].map(e => t(e.innerText).slice(0, 40)).filter(Boolean).slice(0, 3),
      docTitle: t(document.title).slice(0, 80),
      url: location.href.slice(0, 90),
    }
  })

  console.log('  标题:', d.title, `(${d.titleLen}字)`)
  console.log('  docTitle:', d.docTitle)
  if (d.h1s.length) console.log('  h1:', JSON.stringify(d.h1s))
  console.log('  图片:', d.imageCount, '张')
  console.log('  价格:', d.price)
  console.log('  SKU:', JSON.stringify(d.skuGroups).slice(0, 250))

  res[U.key] = { name: U.name, ...d }
}

fs.writeFileSync(P + '/tmp/scraped3.json', JSON.stringify(res, null, 2), 'utf8')
console.log('\n=== 写入 tmp/scraped3.json ===')
await browser.disconnect()
