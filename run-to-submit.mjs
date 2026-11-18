/**
 * run-to-submit.mjs — 跑到「提交前」停下，等用户手动点提交
 *
 * 用法：node run-to-submit.mjs <商品JSON>
 * ★ 不关闭浏览器
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)
const { launchStealth } = await import(pathToFileURL(P + '/skills/_shared/pdd-launch.mjs').href)
const STEPS = P + '/skills/pdd-publish-http/steps'
const load = f => import(pathToFileURL(path.join(STEPS, f)).href)

const args = process.argv.slice(2)
const pf = args[0]
if (!pf) { console.log('用法：node run-to-submit.mjs <商品JSON>'); process.exit(1) }

const s = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = s.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status === 'valid')[0] || all.filter(x => ckOf(x) > 0)[0]
const sleep = ms => new Promise(r => setTimeout(r, ms))
const t0 = Date.now()
const log = (...a) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const prod = JSON.parse(fs.readFileSync(pf, 'utf8'))
console.log('=== 上架:', prod.title)
console.log('=== 账号:', acc.shop_key)

const ls = await launchStealth(acc.shop_key, puppeteer)
const browser = ls.browser
let p = ls.page
await sleep(600)
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(4000)
await p.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 20000 }).catch(() => { })
const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 25000 }).catch(() => null)
await p.evaluate(() => { const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })
const tg = await tp
if (tg) { const np = await tg.page(); if (np) { await np.bringToFront(); p = np } }
log('1 发布页')

await sleep(1500)
await p.waitForSelector('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]', { timeout: 25000 }).catch(() => { })
await sleep(800)
const fi = await p.$('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]')
if (fi) {
  for (const f of prod.images) { await fi.uploadFile(f).catch(() => { }); await sleep(1500) }
}
log('2 主图', prod.images.length, '张')

await p.waitForSelector('input[placeholder*="商品标题组成"]', { timeout: 20000 }).catch(() => { })
await p.evaluate((t) => {
  const i = document.querySelector('input[placeholder*="商品标题组成"]'); if (!i) return
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  i.focus(); if (set) set.call(i, t); else i.value = t
  i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); document.body.click()
}, prod.title)
log('3 标题:', prod.title)

await p.waitForSelector('#selectedCateId, [data-tracking-viewid="choose_cate"], #bottomSubmitBtnId', { timeout: 25000 }).catch(() => { })
const m4 = await load('step4.mjs')
await m4.ensureCategory(p, { catId: prod.catId, log: x => log('  ' + x) })
let moved = false
for (let k = 0; k < 6 && !moved; k++) {
  const ok = await p.evaluate(() => { const el = document.getElementById('bottomSubmitBtnId'); if (!el || el.disabled) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true }).catch(() => false)
  if (!ok) { await sleep(1200); continue }
  for (let i = 0; i < 70; i++) { const ps = await browser.pages(); const h = ps.find(x => /goods_add\/index/.test(x.url())); if (h) { p = h; await p.bringToFront(); moved = true; break } await sleep(200) }
}
log('4 第2步', moved ? '✅' : '❌')
if (!moved) { console.log('\n★★ 卡在类目页，窗口保留 ★★'); setInterval(() => { }, 60000) }

await p.waitForSelector('#newSpec, #sku', { timeout: 25000 }).catch(() => { })
await sleep(2500)

const m6 = await load('step6.mjs')
const r6 = await m6.default(p, { values: prod.attributes || {}, catId: prod.catId, log: x => log('  ' + x) })
log('6 属性', r6.ok ? '✅' : '❌ ' + (r6.errors || []).join(','))

const m6b = await load('step6b.mjs')
const r6b = await m6b.default(p, { files: prod.detailImages || [] })
log('6b 详情图', r6b.ok ? '✅ ' + r6b.count : '❌')

const m11 = await load('step11.mjs')
const r11 = await m11.step11_fillSpecs(p, { specs: prod.specs, catId: prod.catId, log: x => log('  ' + x) })
log('11 规格', r11.ok ? '✅' : '❌ ' + (r11.error || ''))

const m12 = await load('step12.mjs')
const thumbs = (prod.skus || []).map((s, i) => s.thumb || (prod.images || [])[i % (prod.images || []).length])
const r12 = await m12.default(p, { rows: prod.skus.map(x => ({ quantity: x.stock, multiPrice: x.multiPrice, price: x.price, skuSn: x.itemNo })), thumbs, verify: true })
log('12 价格', r12.ok ? '✅ ' + r12.filled + ' 行' : '❌ ' + (r12.errors || []).join(','))

const m13 = await load('step13.mjs'); await m13.default(p).catch(() => { })
log('13 ✅')
const m14 = await load('step14.mjs'); await m14.default(p).catch(() => { })
log('14 ✅')
const m15 = await load('step15.mjs'); await m15.default(p, { shipTime: prod.shipTime }).catch(() => { })
log('15 ✅')

// 检查错误面板
const errPanel = await p.evaluate(() => {
  const t = document.body.innerText || ''
  const m = t.match(/错误（\d+）[\s\S]{0,300}/)
  return m ? m[0].replace(/\s+/g, ' ').slice(0, 300) : ''
})
if (errPanel) log('⚠ 页面报错:', errPanel)
else log('✅ 无错误面板')

// 滚到提交按钮
await p.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /提交并上架/.test(x.innerText || ''))
  if (b) b.scrollIntoView({ block: 'center' })
})

console.log('\n' + '='.repeat(56))
console.log('  ★★ 已填完，停在提交前 ★★')
console.log('='.repeat(56))
console.log('  标题:', prod.title)
console.log('  图片:', prod.images.length, '主图 +', (prod.detailImages || []).length, '详情图')
console.log('  规格:', prod.specs.map(s => s.name + '×' + s.values.length).join(' × '))
console.log('  SKU:', prod.skus.length, '行')
console.log('')
console.log('  请你在页面上点「提交并上架」')
console.log('  点完告诉我结果，我看后台')
console.log('')
console.log('★ 浏览器不关')
setInterval(() => { }, 60000)
