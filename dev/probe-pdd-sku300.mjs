/**
 * 全自动建 30 行 SKU（5 色 × 6 码），然后点提交抓真实 commitBody。
 *
 * ★ 页面真实结构（2026-10-20 探测确认，与旧代码假设完全不同）：
 *   「规格与库存」里**预置了「颜色分类」行**（不需要点「添加规格类型」），
 *   颜色值直接在该行的输入框里填；
 *   尺码走「参考分类 / 全部尺码表 / 身高」的 **chips 勾选**（48~175 全在列表里），
 *   勾选后自动生成 SKU 行。
 *
 * 这才是新版流程 —— 旧代码去点「添加规格类型」会弹到顶部搜索框，永远失败。
 *
 * 用法：node dev/probe-pdd-sku300.mjs --shop=<shopKey> [--submit=1] [--keep=1]
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argOf = (n) => {
  const h = process.argv.find(a => a.startsWith(`--${n}=`))
  return h ? h.slice(n.length + 3) : undefined
}
const has = (n) => process.argv.includes(`--${n}`)

const PLUGIN = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { CredentialStore } = await import(`file:///${PLUGIN}/lib/services/credential-store.js`)
const { findChromePath, profileDir } = await import(`file:///${PLUGIN}/lib/browser-login.js`)

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const SHOP = argOf('shop')
  || store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.status === 'valid')[0]?.shop_key
const OUT = join(PLUGIN, 'dev', '.ui-shots')
mkdirSync(OUT, { recursive: true })

const COLORS = ['格蕾灰', '奶油黄', '银河蓝', '迷雾紫', '星光粉']
const SIZES = ['110', '120', '130', '140', '150', '160']   // chips 上标的是纯数字

const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: profileDir('pdd_mms', SHOP),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
})
const page = (await browser.pages())[0] || (await browser.newPage())
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const posts = []
cdp.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(e.request.url)) return
  posts.push({ id: e.requestId, url: e.request.url })
})

console.log('打开商品列表…')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(10000)
if (/\/login/i.test(page.url())) { console.error('登录态失效'); process.exit(3) }

await page.evaluate(() => {
  const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
  const all = [...document.querySelectorAll('button, a, div, span')].filter(el => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    if ((el.innerText || '').trim() !== '发布新商品') return false
    return !el.closest(NAV)
  })
  const inner = all.filter(e => !all.some(o => o !== e && e.contains(o)))
  const el = inner.find(e => e.tagName === 'BUTTON') || inner[inner.length - 1]
  el?.click()
})
let cp = null
for (let i = 0; i < 20; i++) { await sleep(1500); cp = (await browser.pages()).find(x => /\/goods\/category/.test(x.url())); if (cp) break }
if (!cp) { console.error('类目页未出现'); process.exit(4) }
await cp.bringToFront(); await sleep(3500)

const inp = await cp.$('input[placeholder*="搜索分类"]')
await inp.click({ clickCount: 3 }).catch(() => {})
await cp.keyboard.press('Backspace').catch(() => {})
await cp.keyboard.type('儿童睡衣', { delay: 100 })
await sleep(3800)
const picked = await cp.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const items = [...document.querySelectorAll('li')].filter(el => {
    if (!vis(el)) return false
    if (!/SPP_searchItem|searchItem/i.test(String(el.className || ''))) return false
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    return !!t && t.length <= 120 && !/没有合适的类目|立即反馈/.test(t)
  })
  if (!items.length) return ''
  const CORE = ['童装', '儿童', '婴儿', '亲子', '家居服', '睡衣', '套装']
  const FATAL = ['内衣裤袜', '女士', '男士', '成人']
  let best = items[0], bs = -Infinity
  for (const el of items) {
    const t = (el.innerText || '').trim()
    let s = 0
    for (const c of CORE) if (t.includes(c)) s += 6
    for (const f of FATAL) if (t.includes(f)) s -= 100
    s -= t.length * 0.05
    if (s > bs) { bs = s; best = el }
  }
  best.click()
  return (best.innerText || '').trim()
})
console.log('类目:', picked)
await sleep(900)
await cp.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确认发布该类商品')
  if (b && !b.disabled) b.click()
})

let sp = null
for (let i = 0; i < 25; i++) { await sleep(1500); sp = (await browser.pages()).find(x => /\/goods\/goods_add\//.test(x.url())); if (sp) break }
if (!sp) { console.error('表单页未出现'); process.exit(5) }
await sp.bringToFront()
const cdp2 = await sp.target().createCDPSession()
await cdp2.send('Network.enable')
const posts2 = []
cdp2.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(e.request.url)) return
  posts2.push({ id: e.requestId, url: e.request.url })
})
await sleep(14000)
console.log('表单页就绪')

// ── 填标题 ──
await sp.evaluate(() => {
  const el = document.querySelector('#goods_name input[data-testid="beast-core-input-htmlInput"]')
  if (!el) return
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  el.focus()
  if (d?.set) d.set.call(el, '全自动测试儿童摇粒绒家居服套装30色码')
  else el.value = '全自动测试儿童摇粒绒家居服套装30色码'
  for (const ev of ['input', 'change', 'blur']) el.dispatchEvent(new Event(ev, { bubbles: true }))
}).catch(() => {})
console.log('标题已填')

// ── 主图 1 张 ──
const mi = await sp.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
if (mi) {
  await mi.uploadFile(join(PLUGIN, 'skills', 'pdd-link-matrix', 'assets', 'src', 'main_06.jpg'))
  await sleep(16000)
  console.log('主图已上传')
}

// ══════════ 第 1 维：颜色分类 ══════════
console.log('\n===== 建颜色（颜色分类行）=====')

// 先定位「颜色分类」输入框
const colorInputInfo = await sp.evaluate(() => {
  // 找含「颜色分类」文本的容器，取其中的 input
  for (const box of document.querySelectorAll('div, section')) {
    const t = (box.innerText || '').replace(/\s+/g, ' ')
    if (!t.includes('颜色分类')) continue
    if (t.length > 4000) continue
    const inputs = [...box.querySelectorAll('input')].filter(i => i.offsetParent !== null)
    if (inputs.length) {
      return {
        found: true,
        count: inputs.length,
        samples: inputs.slice(0, 6).map(i => ({
          ph: i.placeholder || '',
          cls: String(i.className || '').slice(0, 50),
          type: i.type,
        })),
      }
    }
  }
  return { found: false }
})
console.log('颜色输入框:', JSON.stringify(colorInputInfo))

if (!colorInputInfo.found) {
  console.log('✗ 未找到颜色分类输入框，退出')
  await sleep(3000); await browser.close(); process.exit(6)
}

// 在「颜色分类」容器里逐值输入
for (let ci = 0; ci < COLORS.length; ci++) {
  const c = COLORS[ci]
  const ok = await sp.evaluate((val, idx) => {
    // 找到颜色分类容器
    let container = null
    for (const box of document.querySelectorAll('div, section')) {
      const t = (box.innerText || '').replace(/\s+/g, ' ')
      if (!t.includes('颜色分类') || t.length > 4000) continue
      if (box.querySelector('input')) { container = box; break }
    }
    if (!container) return 'no-container'

    // 优先找 placeholder 含「颜色」或空的可见 input
    const inputs = [...container.querySelectorAll('input')].filter(i => i.offsetParent !== null && i.type !== 'file')
    const target = inputs.find(i => /颜色/.test(i.placeholder || ''))
      || inputs.find(i => !i.value)
      || inputs[0]
    if (!target) return 'no-input'

    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    target.focus()
    if (d?.set) d.set.call(target, val); else target.value = val
    for (const ev of ['input', 'change']) target.dispatchEvent(new Event(ev, { bubbles: true }))

    // 触发回车确认（多数 beast-core tag input 用 Enter 提交标签）
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
    return 'ok'
  }, c, ci).catch(e => 'err:' + e.message)

  await sleep(600)
  // 若 JS 回车不生效，用真实键盘再补一次
  if (ok === 'ok') {
    try { await sp.keyboard.press('Enter') } catch { /* 忽略 */ }
    await sleep(500)
  }
  console.log(`  颜色 ${ci + 1}/${COLORS.length} ${c}: ${ok}`)
}

await sleep(2000)

// 检查颜色标签是否出现
const colorTags = await sp.evaluate(() => {
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = body.match(/颜色分类[\s\S]{0,200}/)
  return { text: m ? m[0].slice(0, 200) : '', }
})
console.log('颜色区现状:', colorTags.text)

// ══════════ 第 2 维：尺码 chips（参考分类）══════════
console.log('\n===== 勾选尺码 chips =====')
for (const s of SIZES) {
  const r = await sp.evaluate((size) => {
    // chips 在「全部尺码表 / 身高」区，文本为纯数字
    const cands = [...document.querySelectorAll('label, span, div, button')].filter(el => {
      if (el.offsetParent === null) return false
      const t = (el.innerText || '').trim()
      if (t !== size) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 10 && rect.height > 10 && rect.width < 120
    })
    if (!cands.length) return 'not-found'
    // 取最内层
    const inner = cands.filter(e => !cands.some(o => o !== e && e.contains(o)))
    const el = inner[0]
    if (!el) return 'no-inner'
    el.scrollIntoView({ block: 'center' })
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return 'clicked'
  }, s).catch(e => 'err:' + e.message)
  console.log(`  尺码 ${s}: ${r}`)
  await sleep(700)
}

await sleep(2500)

// ══════════ 现状 dump ══════════
const state = await sp.evaluate(() => {
  const tables = [...document.querySelectorAll('table')].map(t => ({
    rows: t.querySelectorAll('tr').length,
    heads: [...t.querySelectorAll('th')].map(x => (x.innerText || '').trim()).filter(Boolean),
  }))
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return {
    tables,
    maxRows: Math.max(0, ...tables.map(t => t.rows)),
    skuText: (body.match(/价格及库存[\s\S]{0,400}/) || [''])[0].slice(0, 400),
  }
})
console.log('\n===== 建规格后状态 =====')
console.log('  表格:', JSON.stringify(state.tables))
console.log('  最大行数:', state.maxRows, '（期望 30）')
console.log('  文案:', state.skuText.slice(0, 260))

if (has('keep')) { console.log('\n★ 保持 90s'); await sleep(90000) }

// ══════════ 提交并抓包 ══════════
if (has('submit')) {
  console.log('\n点「提交并上架」…')
  const clicked = await sp.evaluate(() => {
    const b = document.querySelector('button#bottomSubmitBtnId')
    if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return 'by-id' }
    const t = [...document.querySelectorAll('button')].find(x =>
      (x.innerText || '').trim() === '提交并上架' && !x.disabled)
    if (t) { t.scrollIntoView({ block: 'center' }); t.click(); return 'by-text' }
    return 'not-found'
  })
  console.log('  提交按钮:', clicked)
  await sleep(18000)

  const all = [...posts, ...posts2]
  const bodies = []
  for (const p of all) {
    const ref = posts.includes(p) ? cdp : cdp2
    try {
      const pd = await ref.send('Network.getRequestPostData', { requestId: p.id })
      const d = pd.postData || ''
      if (d.length > 50) bodies.push({ url: p.url, len: d.length, body: d })
    } catch { /* 忽略 */ }
  }
  writeFileSync(join(OUT, 'pdd-commit-bodies.json'), JSON.stringify(bodies, null, 2))
  console.log(`\n抓到 ${bodies.length} 个 POST 体`)

  const commits = bodies.filter(b => /goodsCommit/i.test(b.url))
  for (const c of commits) {
    const f = join(OUT, `pdd-goodscommit-${Date.now()}.json`)
    writeFileSync(f, c.body, 'utf8')
    let p = null
    try { p = JSON.parse(c.body) } catch { /* 忽略 */ }
    console.log(`\n★ goodsCommit 落盘: ${f}`)
    if (p) {
      console.log(`  skus: ${(p.skus || []).length}`)
      console.log(`  gallery: ${(p.gallery || []).length}`)
      console.log(`  skus[0]: ${JSON.stringify((p.skus || [])[0]).slice(0, 700)}`)
    }
  }
}

await sleep(4000)
await browser.close()
