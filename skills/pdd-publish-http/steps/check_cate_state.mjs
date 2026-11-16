/**
 * check_cate_state.mjs — 点完确认后，dump 所有类目卡片的 checked 状态
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const SHARED = path.join(PLUGIN, 'skills', '_shared')
const loadShared = f => import(pathToFileURL(path.join(SHARED, f)).href)
const loadStep = f => import(pathToFileURL(path.join(__dirname, f)).href)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const argv = process.argv.slice(2)
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : '' }
import fs from 'node:fs'
const product = JSON.parse(fs.readFileSync(argOf('product-file'), 'utf8'))
const shopKey = argOf('account')
const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { launchStealth } = await loadShared('pdd-launch.mjs')
const { browser, page: p0 } = await launchStealth(shopKey, puppeteer)
let p = p0
await p.setViewport({ width: 1600, height: 1000 })

await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 30000 }).catch(() => { })
const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 30000 }).catch(() => null)
await p.evaluate(() => { const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })
const tg = await tp; const np = tg ? await tg.page().catch(() => null) : null
if (np) { await np.bringToFront(); p = np }
await sleep(3000)
const s2 = await loadStep('step2.mjs'); await s2.step2_uploadMainImages(p, { files: product.images })
const s3 = await loadStep('step3.mjs'); await s3.step3_fillTitle(p, { title: product.title })
await sleep(2000)

const dump = () => p.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-tracking-viewid="choose_cate"]')].map(e => ({
    text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    params: (e.getAttribute('data-tracking-params') || '').slice(0, 80),
    cls: String(e.className || ''),
    checked: /cateItemCard_checked/.test(String(e.className || '')),
  }))
  const xp = document.evaluate('//*[@id="selectedCateId"]/div[1]/div[1]', document, null, 9, null).singleNodeValue
  return {
    cards,
    xpText: xp ? (xp.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '(无)',
    xpCls: xp ? String(xp.className || '') : '',
    xpParams: xp ? (xp.getAttribute('data-tracking-params') || '') : '',
  }
})

console.log('=== 初始 ===')
console.log(JSON.stringify(await dump(), null, 2))

// 走用户 4 步
await p.evaluate(() => {
  const b = document.querySelector('button[data-tracking-viewid="manually_select_product_category"]')
  if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
})
await sleep(1500)
const inp = await p.$('input[data-tracking-viewid="key_words_search"]')
await inp.click()
await inp.evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  el.focus(); if (set) set.call(el, v); else el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}, '童装婴儿装亲子装儿童家居服家居服套装')
await sleep(1200)
const bb = await inp.boundingBox()
await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
await sleep(1500)

const liB = await p.evaluate(() => {
  const li = document.querySelector('li[class*="SPP_searchItem"]')
  if (!li) return null
  const r = li.getBoundingClientRect()
  return { x: r.x + 200, y: r.y + r.height / 2, text: li.innerText.trim() }
})
console.log('\n点第一个:', JSON.stringify(liB))
await p.mouse.click(liB.x, liB.y)
await sleep(1500)
console.log('=== 选第一个后 ===')
console.log(JSON.stringify(await dump(), null, 2))

// 点确认
const cb = await p.evaluate(() => {
  const b = document.querySelector('button[data-tracking-click-viewid="cate_confirm"]')
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, params: b.getAttribute('data-tracking-params') }
})
console.log('\n确认按钮:', JSON.stringify(cb))
await p.mouse.click(cb.x, cb.y)
await sleep(3000)
console.log('=== 点确认后 ===')
console.log(JSON.stringify(await dump(), null, 2))

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/睡衣20款/after_confirm.png' }).catch(() => { })
await new Promise(r => setTimeout(r, 15 * 60 * 1000))
process.exit(0)

