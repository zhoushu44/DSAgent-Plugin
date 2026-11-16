/**
 * run_keep.mjs — 打开发布页→主图→标题→停在类目，窗口保持不关
 * 用法: node run_keep.mjs --product-file <json> --account <shopKey>
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const SHARED = path.join(PLUGIN, 'skills', '_shared')
const loadShared = f => import(pathToFileURL(path.join(SHARED, f)).href)
const loadStep = f => import(pathToFileURL(path.join(__dirname, f)).href)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[run]', ...a)

const argv = process.argv.slice(2)
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : '' }
const product = JSON.parse(fs.readFileSync(argOf('product-file'), 'utf8'))
const shopKey = argOf('account')

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { launchStealth } = await loadShared('pdd-launch.mjs')
const { browser, page: p0 } = await launchStealth(shopKey, puppeteer)
let p = p0
await p.setViewport({ width: 1600, height: 1000 })

// ① 打开发布页
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 30000 }).catch(() => { })
const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 30000 }).catch(() => null)
await p.evaluate(() => { const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })
const tg = await tp
const np = tg ? await tg.page().catch(() => null) : null
if (np) { await np.bringToFront(); p = np }
await sleep(3000)
log('① 发布页:', p.url().slice(0, 70))

// ② 主图
const s2 = await loadStep('step2.mjs')
const r2 = await s2.step2_uploadMainImages(p, { files: product.images })
log('② 主图:', r2.ok ? `✅ ${r2.uploaded} 张` : '❌ ' + (r2.errors || []).join(','))

// ③ 标题
const s3 = await loadStep('step3.mjs')
const r3 = await s3.step3_fillTitle(p, { title: product.title })
log('③ 标题:', r3.after ? '✅' : '❌')

await sleep(2500)

// ④ 现状
const state = await p.evaluate(() => {
  const t = document.body.innerText || ''
  const cards = []
  for (const e of document.querySelectorAll('div')) {
    const r = e.getBoundingClientRect()
    if (r.width < 150 || r.height < 20 || r.height > 60) continue
    if (e.children.length > 3) continue
    const txt = (e.innerText || '').trim()
    if (!txt.includes('>') || txt.length > 70) continue
    cards.push({ text: txt.replace(/\s+/g, ' '), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) })
  }
  const uniq = []
  const seen = new Set()
  for (const c of cards) { if (!seen.has(c.text)) { seen.add(c.text); uniq.push(c) } }
  return { cards: uniq.sort((a, b) => a.x - b.x), url: location.href }
})
log('④ 页面类目卡片:')
state.cards.forEach((c, i) => log(`   ${i + 1}. @(${c.x},${c.y}) w=${c.w}  ${c.text}`))

log('')
log('=== 窗口保持，等待你操作 ===')
log('请在窗口里选好类目，然后告诉我「好了」，我继续走 属性→详情图→规格→SKU→提交')

// 保持窗口，每 5 分钟打印一次当前类目
for (let i = 0; i < 60; i++) {
  await sleep(5 * 60 * 1000)
  const cur = await p.evaluate(() => {
    const t = document.body.innerText || ''
    const m = t.match(/已选分类\s*([^\n]{0,80})/) || t.match(/商品分类\s*([^\n]{0,80})/)
    return m ? m[1].trim() : ''
  }).catch(() => '')
  log(`[${(i + 1) * 5}min] 当前类目: ${cur || '(读不到)'}`)
}
process.exit(0)
