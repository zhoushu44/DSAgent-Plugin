/**
 * run-and-wait-success.mjs — 上架并等待「提交成功」页面出现
 * ★ 不关闭浏览器，把提交后的每一步都记录下来
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

const pf = process.argv[2]
if (!pf) { console.log('用法: node run-and-wait-success.mjs <product.json>'); process.exit(1) }

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
if (fi) for (const f of prod.images) { await fi.uploadFile(f).catch(() => { }); await sleep(1500) }
log('2 主图', prod.images.length)

await p.waitForSelector('input[placeholder*="商品标题组成"]', { timeout: 20000 }).catch(() => { })
await p.evaluate((t) => {
  const i = document.querySelector('input[placeholder*="商品标题组成"]'); if (!i) return
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  i.focus(); if (set) set.call(i, t); else i.value = t
  i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); document.body.click()
}, prod.title)
log('3 标题')

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

await p.waitForSelector('#newSpec, #sku', { timeout: 25000 }).catch(() => { })
await sleep(2500)

const m6 = await load('step6.mjs')
const r6 = await m6.default(p, { values: prod.attributes || {}, catId: prod.catId, log: x => log('  ' + x) })
log('6 属性', r6.ok ? '✅' : '❌')

const m6b = await load('step6b.mjs')
const r6b = await m6b.default(p, { files: prod.detailImages || [] })
log('6b 详情图', r6b.ok ? '✅ ' + r6b.count : '❌')

const m11 = await load('step11.mjs')
const r11 = await m11.step11_fillSpecs(p, { specs: prod.specs, catId: prod.catId, log: x => log('  ' + x) })
log('11 规格', r11.ok ? '✅' : '❌')

const thumbs = (prod.skus || []).map((sk, i) => sk.thumb || (prod.images || [])[i % (prod.images || []).length])
const m12 = await load('step12.mjs')
const r12 = await m12.default(p, { rows: prod.skus.map(x => ({ quantity: x.stock, multiPrice: x.multiPrice, price: x.price, skuSn: x.itemNo })), thumbs, verify: true })
log('12 价格', r12.ok ? '✅ ' + r12.filled + ' 行' : '❌')

const m13 = await load('step13.mjs'); await m13.default(p).catch(() => { })
const m14 = await load('step14.mjs'); await m14.default(p).catch(() => { })
const m15 = await load('step15.mjs'); await m15.default(p, { shipTime: prod.shipTime }).catch(() => { })
log('13-15 ✅')

// ══ 点提交 ══
console.log('\n' + '='.repeat(56))
console.log('  ★ 点「提交并上架」')
console.log('='.repeat(56))

const before = await p.evaluate(() => ({
  url: location.href,
  btnText: document.querySelector('#submit_button')?.innerText?.replace(/\s+/g, '') || '',
  btnDisabled: document.querySelector('#submit_button')?.disabled,
}))
log('提交前:', JSON.stringify(before))

const clicked = await p.evaluate(() => {
  const b = document.querySelector('#submit_button')
  if (!b) return { ok: false, reason: 'no #submit_button' }
  if (b.disabled) return { ok: false, reason: 'disabled' }
  b.scrollIntoView({ block: 'center' })
  b.click()
  return { ok: true }
})
log('点击:', JSON.stringify(clicked))
if (!clicked.ok) { console.log('★ 提交失败，窗口保留'); setInterval(() => { }, 60000) }

// ══ 每 500ms 观察，最多 120 秒 ══
console.log('\n=== 观察页面变化（每 500ms）===')
let lastUrl = before.url
let success = false
for (let i = 0; i < 240; i++) {
  await sleep(500)
  const st = await p.evaluate(() => {
    const t = (document.body.innerText || '')
    return {
      url: location.href.slice(0, 110),
      successTitle: document.querySelector('.success-title')?.innerText?.trim() || '',
      hasSuccessWord: /提交成功|发布成功|上架成功/.test(t),
      hasError: /错误（\d+）/.test(t),
      errCtx: t.match(/错误（\d+）[\s\S]{0,150}/)?.[0]?.replace(/\s+/g, ' ') || '',
      toast: [...document.querySelectorAll('[class*="toast"],[class*="Toast"],[class*="message"]')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3).join(' | '),
      bodyHead: t.replace(/\s+/g, ' ').slice(0, 100),
    }
  }).catch(() => ({ err: 1 }))

  const changed = st.url !== lastUrl
  if (changed || i % 4 === 0 || st.hasSuccessWord || st.successTitle) {
    log(`  ${(i + 1) * 0.5}s  url=${st.url}`)
    if (changed) { log(`     ↑ URL 变了`); lastUrl = st.url }
    if (st.successTitle) log(`     ★ successTitle: ${st.successTitle}`)
    if (st.hasSuccessWord) log(`     ★ 页面有「成功」字`)
    if (st.hasError) log(`     ⚠ 错误: ${st.errCtx.slice(0, 120)}`)
    if (st.toast) log(`     toast: ${st.toast}`)
  }

  if (/goods_add\/success/.test(st.url) || st.successTitle) {
    success = true
    log(`\n★★★ 成功！${(i + 1) * 0.5}s  url=${st.url}`)
    break
  }
  if (st.hasError) {
    log(`\n⚠ 出现错误，停止观察`)
    break
  }
}

if (!success) {
  console.log('\n=== 120 秒内未出现成功页 ===')
  const fin = await p.evaluate(() => ({
    url: location.href,
    bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
  })).catch(() => ({}))
  console.log('最终页面:', JSON.stringify(fin, null, 1))
}

console.log('\n★ 窗口保留')
setInterval(() => { }, 60000)
