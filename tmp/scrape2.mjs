/**
 * scrape2.mjs — 连现有浏览器抓 3 个商品
 * ★ 不改发布代码，只抓数据
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
    const hasTaobao = ps.some(x => { try { return /taobao|tmall/.test(x.url()) } catch { return false } })
    if (hasTaobao) { browser = b; break }
    await b.disconnect()
  } catch { }
}
if (!browser) { console.log('❌ 没找到淘宝窗口，请确认浏览器还开着'); process.exit(0) }

const ps = await browser.pages()
const p = ps.find(x => { try { return /taobao|tmall/.test(x.url()) } catch { return false } })
await p.bringToFront()
const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log('当前页:', p.url().slice(0, 100))

// 检查登录态
const logged = await p.evaluate(() => !/login\.taobao\.com/.test(location.href)).catch(() => false)
console.log('已登录:', logged)

const URLS = [
  { key: 'tmall_knife', url: 'https://detail.tmall.com/item.htm?id=819241838637', name: '高精度刀柄' },
  { key: 'tb_shirt', url: 'https://e.tb.cn/h.jlFsvkfncX2RV7m?tk=HTdw646k1Gr', name: '蕾丝拼接衬衫' },
  { key: 'tb_orange', url: 'https://e.tb.cn/h.jlFG3W8UfWqhLYJ?tk=Pmv5646kTs6', name: '涌泉蜜桔' },
]

const out2 = {}

for (const U of URLS) {
  console.log(`\n=== ${U.name} ===`)
  try {
    await p.goto(U.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => console.log('  goto:', e.message.slice(0, 60)))
    await sleep(7000)

    const realUrl = p.url()
    console.log('  URL:', realUrl.slice(0, 110))

    if (/login\.taobao\.com/.test(realUrl)) {
      console.log('  ❌ 还是登录页')
      out2[U.key] = { name: U.name, error: 'need_login' }
      continue
    }

    const d = await p.evaluate(() => {
      const t = s => String(s || '').replace(/\s+/g, ' ').trim()

      // 标题：多个候选
      const titleCands = [
        'h1[class*="ItemHeader"]',
        'h1[class*="mainTitle"]',
        '[class*="Title--title"]',
        '[class*="ItemTitle"]',
        'h1',
        '[class*="tb-main-title"]',
      ]
      let title = ''
      for (const sel of titleCands) {
        const el = document.querySelector(sel)
        const x = t(el?.innerText)
        if (x && x.length > 4) { title = x; break }
      }
      // 兜底：document.title
      if (!title) title = t(document.title).replace(/[-|].*(淘宝|天猫|Tmall).*$/, '').trim()

      // 图片：商品主图区
      const imgs = []
      const addImg = (src) => {
        if (!src || !/alicdn|tbcdn|taobaocdn/.test(src)) return
        const clean = src.split('_')[0].replace(/^\/\//, 'https://')
        if (clean.length < 20) return
        if (!imgs.includes(clean)) imgs.push(clean)
      }
      // 优先主图缩略图区
      for (const sel of ['[class*="PicGallery"] img', '[class*="Thumbnail"] img', '[class*="PicGallery--"] img', '[class*="mainPic"] img', '#J_UlThumb img']) {
        for (const img of document.querySelectorAll(sel)) addImg(img.src || img.getAttribute('data-src'))
      }
      // 兜底：所有大图
      if (imgs.length < 3) {
        for (const img of document.querySelectorAll('img')) {
          const w = img.naturalWidth || img.width || 0
          if (w >= 400) addImg(img.src || img.getAttribute('data-src'))
        }
      }

      // 价格
      let price = ''
      for (const sel of ['[class*="Price--priceText"]', '[class*="priceText"]', '.tm-price', '.tb-rmb-num', '[class*="Price"] [class*="text"]']) {
        const x = t(document.querySelector(sel)?.innerText)
        if (/\d/.test(x)) { price = x; break }
      }

      // SKU
      const skuGroups = []
      const seen = new Set()
      for (const dl of document.querySelectorAll('dl, [class*="SkuContent"], [class*="skuWrapper"], [class*="SkuPanel"]')) {
        const label = t(dl.querySelector('dt, [class*="SkuTitle"], [class*="skuTitle"], [class*="Title"]')?.innerText)
        if (!label || label.length > 20 || seen.has(label)) continue
        const vals = [...dl.querySelectorAll('dd [class*="valueItem"], dd li, dd a, [class*="SkuValue"] [class*="item"], [class*="valueItem"]')]
          .map(e => t(e.innerText)).filter(x => x && x.length < 30)
        const uniq = [...new Set(vals)]
        if (uniq.length >= 2) { skuGroups.push({ label, values: uniq.slice(0, 25) }); seen.add(label) }
      }

      return {
        title,
        titleLen: title.length,
        images: imgs.slice(0, 8),
        imageCount: imgs.length,
        price,
        skuGroups,
        bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      }
    })

    console.log('  标题:', d.title, `(${d.titleLen}字)`)
    console.log('  图片:', d.imageCount, '张')
    d.images.slice(0, 3).forEach(x => console.log('    ', x.slice(0, 110)))
    console.log('  价格:', d.price)
    console.log('  SKU:', JSON.stringify(d.skuGroups).slice(0, 300))
    if (!d.title) console.log('  页面:', d.bodyHead)

    out2[U.key] = { name: U.name, url: realUrl, ...d }
  } catch (e) {
    console.log('  ❌', e.message.slice(0, 100))
    out2[U.key] = { name: U.name, error: e.message.slice(0, 100) }
  }
}

fs.writeFileSync(P + '/tmp/scraped.json', JSON.stringify(out2, null, 2), 'utf8')
console.log('\n=== 写入 tmp/scraped.json ===')
await browser.disconnect()

