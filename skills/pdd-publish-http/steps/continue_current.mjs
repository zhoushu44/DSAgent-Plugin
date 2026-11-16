/**
 * continue_current.mjs — 连接**当前已打开**的发布页，继续走完剩余步骤
 * 不启动新浏览器、不关闭窗口
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const loadStep = f => import(pathToFileURL(path.join(__dirname, f)).href)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[cont]', ...a)

const argv = process.argv.slice(2)
const argOf = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : '' }
const product = JSON.parse(fs.readFileSync(argOf('product-file'), 'utf8'))

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)

// 扫描端口，连接已有 Chrome
let browser = null, page = null
const raw = execSync('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort"', { encoding: 'utf8' })
const ports = [...new Set(raw.split(/\s+/).filter(Boolean).map(Number))].filter(p => p > 1000)
for (const pt of ports) {
  try {
    const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(800) })
    const j = await r.json()
    if (!/Chrome/i.test(j.Browser || '')) continue
    const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
    const pages = await b.pages()
    const hit = pages.find(x => /mms\.pinduoduo\.com/.test(x.url()) && !/\/login/.test(x.url()))
    if (hit) { browser = b; page = hit; break }
    await b.disconnect()
  } catch { }
}
if (!page) { log('❌ 没找到已登录的发布页，请先打开'); process.exit(2) }
await page.bringToFront()
log('已连接:', page.url().slice(0, 80))

// ① 确认类目：看 checked 卡片
const catState = await page.evaluate(() => {
  const card = document.querySelector('[data-tracking-viewid="choose_cate"][class*="cateItemCard_checked"]')
  if (!card) return { found: false }
  const p = card.getAttribute('data-tracking-params') || ''
  const m = p.match(/choosen_cate=(\d+)/)
  return { found: true, text: (card.innerText || '').replace(/\s+/g, ' ').trim(), catId: m ? Number(m[1]) : 0 }
})
log('当前类目:', JSON.stringify(catState))

// 如果在第1步（有下一步按钮），点下一步
const onStep1 = await page.evaluate(() => !!document.getElementById('bottomSubmitBtnId'))
if (onStep1) {
  if (catState.catId !== 15021) {
    log('⚠ 类目还不是 15021，请先在窗口里选好童装类目')
    process.exit(3)
  }
  log('① 类目正确（15021），点「下一步」')
  await page.evaluate(() => {
    const b = document.getElementById('bottomSubmitBtnId')
    if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
  })
  // 等进第2步
  for (let i = 0; i < 90; i++) {
    const ps = await browser.pages()
    const f = ps.find(x => /goods_add\/index/.test(x.url()))
    if (f) { page = f; await page.bringToFront(); break }
    await sleep(400)
  }
  log('② 已进第2步:', page.url().slice(0, 80))
  await sleep(3000)
}

// ② 属性
const s6 = await loadStep('step6.mjs')
const r6 = await s6.default(page, { values: product.attributes, catId: 15021 })
log('③ 属性:', JSON.stringify(r6).slice(0, 200))

// ③ 详情图
const s6b = await loadStep('step6b.mjs')
const r6b = await s6b.default(page, { files: product.detailImages })
log('④ 详情图:', JSON.stringify(r6b).slice(0, 150))

// ④ 规格
const s11 = await loadStep('step11.mjs')
const r11 = await s11.default(page, { specs: product.specs, catId: 15021 })
log('⑤ 规格:', JSON.stringify(r11).slice(0, 200))

// ⑤ 价格库存
const s12 = await loadStep('step12.mjs')
const rows = product.skus.map(s => ({ quantity: s.stock, multiPrice: s.multiPrice, price: s.price, skuSn: s.itemNo }))
const r12 = await s12.default(page, { rows })
log('⑥ 价格库存:', JSON.stringify(r12).slice(0, 200))

// ⑥ 参考价
const s13 = await loadStep('step13.mjs')
const r13 = await s13.default(page, {}).catch(e => ({ ok: false, error: e.message }))
log('⑦ 参考价:', JSON.stringify(r13).slice(0, 150))

// ⑦ 发货时间
const s15 = await loadStep('step15.mjs')
const r15 = await s15.default(page, {}).catch(e => ({ ok: false, error: e.message }))
log('⑧ 发货时间:', JSON.stringify(r15).slice(0, 150))

log('')
log('=== 已填完，停在提交前 ===')
log('窗口保持，你确认无误后告诉我，我再点「提交并上架」')
await new Promise(r => setTimeout(r, 60 * 60 * 1000))
process.exit(0)
