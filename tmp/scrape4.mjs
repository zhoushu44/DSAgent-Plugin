/**
 * scrape4.mjs — 价格用正则从正文提取
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
  { key: 'tmall_knife', url: 'https://detail.tmall.com/item.htm?id=819241838637', name: '刀柄' },
  { key: 'tb_shirt', url: 'https://e.tb.cn/h.jlFsvkfncX2RV7m?tk=HTdw646k1Gr', name: '蕾丝衬衫' },
  { key: 'tb_orange', url: 'https://e.tb.cn/h.jlFG3W8UfWqhLYJ?tk=Pmv5646kTs6', name: '涌泉蜜桔' },
]

const res = {}

for (const U of URLS) {
  console.log(`\n=== ${U.name} ===`)
  await p.goto(U.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => { })
  await sleep(7000)

  const d = await p.evaluate(() => {
    const t = s => String(s || '').replace(/\s+/g, ' ').trim()

    // 标题
    let title = ''
    for (const sel of ['h1[class*="ItemHeader--mainTitle"]', '[class*="ItemTitle--mainTitle"]', '[class*="mainTitle"]', 'h1']) {
      for (const el of document.querySelectorAll(sel)) {
        const x = t(el.innerText)
        if (x.length >= 6 && !/用户评价|评价\d|月销|已售|收藏/.test(x)) { title = x; break }
      }
      if (title) break
    }
    if (!title) title = t(document.title).replace(/[-—|]\s*(淘宝网|天猫|Tmall\.com).*$/i, '').trim()

    // ★ 价格：正则从正文提
    const body = document.body.innerText || ''
    let price = ''
    // 优先：店铺优惠后 ￥XX.XX
    let m = body.match(/优惠后\s*[￥¥]\s*([\d,]+\.?\d*)/) ||
            body.match(/券后\s*[￥¥]\s*([\d,]+\.?\d*)/) ||
            body.match(/[￥¥]\s*([\d,]+\.?\d*)\s*起/) ||
            body.match(/[￥¥]\s*([\d,]+\.?\d*)/)
    if (m) price = m[1].replace(/,/g, '')
    // 优惠前价
    let orig = ''
    m = body.match(/优惠前\s*[￥¥]\s*([\d,]+\.?\d*)/)
    if (m) orig = m[1].replace(/,/g, '')

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

    // SKU：找规格区块
    const skuGroups = []
    const seen = new Set()
    for (const dl of document.querySelectorAll('dl, [class*="SkuContent"], [class*="skuWrapper"], [class*="SkuPanel"]')) {
      let label = ''
      for (const lsel of ['dt', '[class*="SkuTitle"]', '[class*="skuTitle"]']) {
        const x = t(dl.querySelector(lsel)?.innerText)
        if (x && x.length <= 12) { label = x; break }
      }
      if (!label || seen.has(label)) continue
      let vals = [...dl.querySelectorAll('dd [class*="valueItem"], dd li, dd a, [class*="valueItem"]')]
        .map(e => t(e.innerText)).filter(x => x && x.length < 25 && !/^(请选择|更多|展开|收起)$/.test(x))
      // 去掉「百人购买」之类的尾巴
      vals = [...new Set(vals.map(v => v.replace(/\s*\d+人购买.*$/, '').replace(/\s*\d+人加购.*$/, '').trim()))].filter(Boolean)
      if (vals.length >= 2) { skuGroups.push({ label, values: vals.slice(0, 25) }); seen.add(label) }
    }

    return { title, titleLen: [...title].length, price, origPrice: orig, images: imgs.slice(0, 8), imageCount: imgs.length, skuGroups }
  })

  console.log('  标题:', d.title)
  console.log('  价格:', d.price, d.origPrice ? `(原价 ${d.origPrice})` : '')
  console.log('  图片:', d.imageCount, '张')
  console.log('  SKU:', JSON.stringify(d.skuGroups))

  res[U.key] = { name: U.name, url: p.url(), ...d }
}

fs.writeFileSync(P + '/tmp/scraped4.json', JSON.stringify(res, null, 2), 'utf8')
console.log('\n=== 写入 tmp/scraped4.json ===')
await browser.disconnect()
