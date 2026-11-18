/**
 * batch-offscreen.mjs — 屏幕外窗口模式批量上架
 *
 * 用法：node batch-offscreen.mjs --from 1 --to 10
 *
 * 特点：
 *   · 窗口在 -32000,-32000（屏幕外），不打扰用户
 *   · 每套独立 Chrome 进程（避免状态污染）
 *   · 套间间隔 8 秒
 *   · 结果写 results-offscreen.json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)
const STEPS = P + '/skills/pdd-publish-http/steps'
const load = f => import(pathToFileURL(path.join(STEPS, f)).href)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = P + '/artifacts/pajama-20sets'

// ── 参数 ──
const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const FROM = Number(argOf('from', 1))
const TO = Number(argOf('to', 10))
const GAP = Number(argOf('gap', 8)) * 1000

const sleep = ms => new Promise(r => setTimeout(r, ms))
const T0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a)

// ── 账号 ──
const s = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = s.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status === 'valid')[0] || all.filter(x => ckOf(x) > 0)[0]
const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', acc.shop_key)

// ── 文件清单 ──
const files = fs.readdirSync(DIR)
  .filter(x => x.endsWith('.json') && !x.startsWith('_') && !x.startsWith('results'))
  .sort()

console.log(`=== 批量上架 ${FROM}~${TO}（共 ${TO - FROM + 1} 套）===`)
console.log('=== 账号:', acc.shop_key)
console.log('=== 模式: 屏幕外窗口 (-32000,-32000)')
console.log('')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

async function runOne(file) {
  const prod = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  const t0 = Date.now()
  const r = { file, title: prod.title, ok: false, goodsId: 0, seconds: 0, error: '' }
  let proc = null
  let browser = null

  try {
    // 清锁
    for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
      try { fs.rmSync(path.join(PROFILE, n), { force: true, recursive: true }) } catch { }
    }

    const port = await freePort()
    proc = spawn(CHROME, [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-32000,-32000',          // ★ 屏幕外
      '--window-size=1440,900',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-blink-features=AutomationControlled',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    // 等端口
    let ready = false
    for (let i = 0; i < 200; i++) {
      await sleep(100)
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
        if (resp.ok) { ready = true; break }
      } catch { }
    }
    if (!ready) throw new Error('Chrome 端口未就绪')

    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
    const pages = await browser.pages()
    let p = pages[0] || await browser.newPage()

    // 1 发布页
    await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => { })
    await sleep(4000)
    await p.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 20000 }).catch(() => { })
    const hasBtn = await p.evaluate(() => !!document.querySelector('button[data-tracking-viewid="new_product_releasing"]'))
    if (!hasBtn) throw new Error('无发布按钮（登录失效？）')

    const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 25000 }).catch(() => null)
    await p.evaluate(() => { const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]'); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })
    const tg = await tp
    if (tg) { const np = await tg.page(); if (np) p = np }
    if (!/goods\/category/.test(p.url())) throw new Error('打不开类目页')

    // 2 主图
    await sleep(1200)
    await p.waitForSelector('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]', { timeout: 25000 }).catch(() => { })
    await sleep(700)
    const fi = await p.$('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]')
    if (fi) for (const f of prod.images) { await fi.uploadFile(f).catch(() => { }); await sleep(1100) }

    // 3 标题
    await p.waitForSelector('input[placeholder*="商品标题组成"]', { timeout: 20000 }).catch(() => { })
    await p.evaluate((t) => {
      const i = document.querySelector('input[placeholder*="商品标题组成"]'); if (!i) return
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      i.focus(); if (set) set.call(i, t); else i.value = t
      i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); document.body.click()
    }, prod.title)

    // 4 类目
    await p.waitForSelector('#selectedCateId, [data-tracking-viewid="choose_cate"], #bottomSubmitBtnId', { timeout: 25000 }).catch(() => { })
    const m4 = await load('step4.mjs')
    await m4.ensureCategory(p, { catId: prod.catId, log: () => { } })
    let moved = false
    for (let k = 0; k < 6 && !moved; k++) {
      const ok = await p.evaluate(() => { const el = document.getElementById('bottomSubmitBtnId'); if (!el || el.disabled) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true }).catch(() => false)
      if (!ok) { await sleep(1200); continue }
      for (let i = 0; i < 70; i++) { const ps = await browser.pages(); const h = ps.find(x => /goods_add\/index/.test(x.url())); if (h) { p = h; moved = true; break } await sleep(200) }
    }
    if (!moved) throw new Error('没进第2步（标题过长？）')

    await p.waitForSelector('#newSpec, #sku', { timeout: 25000 }).catch(() => { })
    await sleep(2200)

    // 6 属性
    const m6 = await load('step6.mjs')
    await m6.default(p, { values: prod.attributes || {}, catId: prod.catId, log: () => { } })

    // 6b 详情图
    const m6b = await load('step6b.mjs')
    await m6b.default(p, { files: prod.detailImages || [] })

    // 11 规格
    const m11 = await load('step11.mjs')
    const r11 = await m11.step11_fillSpecs(p, { specs: prod.specs, catId: prod.catId, log: () => { } })
    if (!r11.ok) throw new Error('规格失败: ' + (r11.error || ''))

    // 12 价格库存
    const thumbs = (prod.skus || []).map((sk, i) => sk.thumb || (prod.images || [])[i % (prod.images || []).length])
    const m12 = await load('step12.mjs')
    const r12 = await m12.default(p, { rows: prod.skus.map(x => ({ quantity: x.stock, multiPrice: x.multiPrice, price: x.price, skuSn: x.itemNo })), thumbs, verify: true })
    if (!r12.ok) throw new Error('价格失败')

    // 13-15
    const m13 = await load('step13.mjs'); await m13.default(p).catch(() => { })
    const m14 = await load('step14.mjs'); await m14.default(p).catch(() => { })
    const m15 = await load('step15.mjs'); await m15.default(p, { shipTime: prod.shipTime }).catch(() => { })

    // 16 提交
    const m16 = await load('step16.mjs')
    const r16 = await m16.default(p, { timeoutMs: 180000 })
    if (!r16.ok) throw new Error(r16.error || '提交失败')

    r.ok = true
    r.goodsId = r16.goodsId
    r.url = r16.url
  } catch (e) {
    r.error = String(e.message || e).slice(0, 150)
  } finally {
    r.seconds = Math.round((Date.now() - t0) / 1000)
    try { if (browser) await browser.disconnect() } catch { }
    try { if (proc) proc.kill() } catch { }
    await sleep(2500)
  }
  return r
}

// ── 主循环 ──
const results = []
const slice = files.slice(FROM - 1, TO)
log(`准备跑 ${slice.length} 套`)

for (let i = 0; i < slice.length; i++) {
  const f = slice[i]
  log(`▶ [${FROM + i}/${files.length}] ${f.replace('.json', '')}`)
  const r = await runOne(f)
  results.push(r)
  if (r.ok) log(`✅ ${r.seconds}s  goodsId=${r.goodsId}`)
  else log(`❌ ${r.seconds}s  ${r.error}`)

  // 落盘
  fs.writeFileSync(path.join(DIR, 'results-offscreen.json'), JSON.stringify(results, null, 2), 'utf8')

  if (i < slice.length - 1) { log(`   等 ${GAP / 1000}s`); await sleep(GAP) }
}

// ── 汇总 ──
const ok = results.filter(r => r.ok)
console.log('')
console.log('='.repeat(60))
console.log('  汇总')
console.log('='.repeat(60))
console.log(`  通过 ${ok.length}/${results.length}   总耗时 ${((Date.now() - T0) / 60000).toFixed(1)} 分钟`)
console.log('')
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${String(r.seconds).padStart(3)}s  ${r.file.replace('.json', '').padEnd(20)} ${r.ok ? 'goodsId=' + r.goodsId : r.error}`)
}
console.log('')
console.log('  结果已写入 artifacts/pajama-20sets/results-offscreen.json')
