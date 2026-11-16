/**
 * publish_in_current.mjs — 接入**当前已打开**的 Chrome 窗口，完整走一遍上架流程
 * 绝不重启/关闭浏览器；只通过 CDP 操作已有页面
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const loadStep = f => import(pathToFileURL(path.join(__dirname, f)).href)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[pub]', ...a)

const argv = process.argv.slice(2)
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : '' }
const product = JSON.parse(fs.readFileSync(argOf('product-file'), 'utf8'))
const doSubmit = argv.includes('--submit')

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)

// ── 连接已有 Chrome（扫端口找 CDP）
let browser = null, page = null
const raw = execSync('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort"', { encoding: 'utf8' })
const ports = [...new Set(raw.split(/\s+/).filter(Boolean).map(Number))].filter(p => p > 1000)
for (const pt of ports) {
  try {
    const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(900) })
    const j = await r.json()
    if (!/Chrome/i.test(j.Browser || '')) continue
    const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
    const pages = await b.pages()
    const hit = pages.find(x => /mms\.pinduoduo\.com/.test(x.url()) && !/\/login/.test(x.url()))
    if (hit) { browser = b; page = hit; log('连接端口:', pt); break }
    await b.disconnect()
  } catch { }
}
if (!page) {
  log('❌ 未找到已登录的拼多多窗口。请确认窗口开着且已登录。')
  const ps = execSync('powershell -NoProfile -Command "Get-Process chrome | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object -ExpandProperty MainWindowTitle"', { encoding: 'utf8' }).trim()
  log('当前 Chrome 窗口:', ps || '(无)')
  process.exit(2)
}
await page.bringToFront()
log('当前页面:', page.url().slice(0, 90))

// ── 若不在发布页，导航过去（同一标签，不新开）
if (!/goods\/category|goods_add/.test(page.url())) {
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { })
  await sleep(5000)
  await page.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 30000 }).catch(() => { })
  const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 30000 }).catch(() => null)
  await page.evaluate(() => {
    const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]')
    if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
  })
  const tg = await tp
  const np = tg ? await tg.page().catch(() => null) : null
  if (np) { await np.bringToFront(); page = np }
  await sleep(3500)
  log('已进发布页:', page.url().slice(0, 80))
}

// ── 第1步：主图 + 标题（若还没填）
const titleNow = await page.evaluate(() => document.querySelector('input[placeholder*="商品标题组成"]')?.value || '').catch(() => '')
if (!titleNow) {
  const s2 = await loadStep('step2.mjs')
  const r2 = await s2.step2_uploadMainImages(page, { files: product.images }).catch(e => ({ ok: false, errors: [e.message] }))
  log('① 主图:', r2.ok ? `✅ ${r2.uploaded.length || r2.uploaded || 5} 张` : '⚠ ' + JSON.stringify(r2.errors || r2).slice(0, 120))
  await sleep(1500)
  const s3 = await loadStep('step3.mjs')
  await s3.step3_fillTitle(page, { title: product.title })
  log('② 标题: ✅')
  await sleep(2500)
} else {
  log('① 主图/标题已填，跳过')
}

// ── 类目：读 checked 卡片
const cat = await page.evaluate(() => {
  const c = document.querySelector('[data-tracking-viewid="choose_cate"][class*="cateItemCard_checked"]')
  if (!c) return { found: false }
  const m = (c.getAttribute('data-tracking-params') || '').match(/choosen_cate=(\d+)/)
  return { found: true, text: (c.innerText || '').replace(/\s+/g, ' ').trim(), catId: m ? +m[1] : 0 }
})
log('③ 当前类目:', JSON.stringify(cat))

const onStep1 = await page.evaluate(() => !!document.getElementById('bottomSubmitBtnId')).catch(() => false)
if (onStep1) {
  if (cat.catId !== 15021) {
    log('③ 类目不对 → 调用 step4.ensureCategory 自动选类目（4 步流程）')
    const m4 = await loadStep('step4.mjs')
    const r4 = await m4.ensureCategory(page, { catId: 15021, forceManual: true, log: x => log('   ' + x) })
    log('③ 选类目结果:', JSON.stringify(r4).slice(0, 200))
    if (!r4.ok) { log('❌ 类目选择失败：' + (r4.error || '')); process.exit(3) }
    await sleep(2000)
  }
  log('③ 类目正确 → 点「下一步」')
  await page.evaluate(() => { const b = document.getElementById('bottomSubmitBtnId'); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })
  for (let i = 0; i < 90; i++) {
    const ps = await browser.pages()
    const f = ps.find(x => /goods_add\/index/.test(x.url()))
    if (f) { page = f; await page.bringToFront(); break }
    await sleep(400)
  }
  await sleep(3000)
  log('④ 已进第2步')
}

// ── 第2步：属性 / 详情图 / 规格 / 价格 / 参考价 / 发货
const s6 = await loadStep('step6.mjs')
const r6 = await s6.default(page, { values: product.attributes, catId: 15021 })
log('⑤ 属性:', r6.ok ? '✅' : '⚠ ' + JSON.stringify(r6.errors || []).slice(0, 120))

const s6b = await loadStep('step6b.mjs')
const r6b = await s6b.default(page, { files: product.detailImages }).catch(e => ({ ok: false, errors: [e.message] }))
log('⑥ 详情图:', r6b.ok ? `✅ ${r6b.count} 张` : '⚠ ' + JSON.stringify(r6b.errors || []).slice(0, 100))

const s11 = await loadStep('step11.mjs')
const r11 = await s11.default(page, { specs: product.specs, catId: 15021 })
log('⑦ 规格:', r11.ok ? `✅ ${r11.actualRows} 行` : '❌ ' + (r11.error || ''))

const s12 = await loadStep('step12.mjs')
const rows = product.skus.map(s => ({ quantity: s.stock, multiPrice: s.multiPrice, price: s.price, skuSn: s.itemNo }))
const r12 = await s12.default(page, { rows })
log('⑧ 价格库存:', r12.ok ? `✅ ${r12.filled} 行` : '❌ ' + JSON.stringify(r12.errors || []).slice(0, 120))

const s13 = await loadStep('step13.mjs')
const r13 = await s13.default(page, {}).catch(e => ({ ok: false, error: e.message }))
log('⑨ 参考价:', r13.ok ? '✅' : '⚠ ' + (r13.error || ''))

const s15 = await loadStep('step15.mjs')
const r15 = await s15.default(page, {}).catch(e => ({ ok: false, error: e.message }))
log('⑩ 发货时间:', r15.ok ? '✅' : '⚠ ' + (r15.error || ''))

if (!doSubmit) {
  log('')
  log('=== 已填到提交前，浏览器保持打开 ===')
  log('确认无误后加 --submit 再跑一次，或直接告诉我提交')
  process.exit(0)
}

const s16 = await loadStep('step16.mjs')
const r16 = await s16.default(page, {})
log('⑪ 提交:', r16.ok ? `✅ goodsId=${r16.goodsId}` : '❌ ' + (r16.error || ''))
await sleep(3000)
await page.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/睡衣20款/publish_final.png' }).catch(() => { })
process.exit(0)

