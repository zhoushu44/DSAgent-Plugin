/**
 * 全自动建 30 行 SKU + 抓真实 commitBody。
 *
 * 目标：不依赖人工操作，把「颜色×尺码」两维规格在页面上真正建出来，
 * 让拼多多自己生成 30 行 skus[]，然后点提交并拦下真实 goodsCommit 请求体。
 *
 * 探索式实现：每一步都先 dump 页面真实结构（按钮文案 / 面板 / chips / 表格行数），
 * 再按结构决策，避免硬编码猜选择器。
 *
 * 用法：node dev/probe-pdd-sku-auto.mjs --shop=<shopKey> [--keep=1]
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const PLUGIN = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { CredentialStore } = await import(`file:///${PLUGIN}/lib/services/credential-store.js`)
const { findChromePath, profileDir } = await import(`file:///${PLUGIN}/lib/browser-login.js`)

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const SHOP = argOf('shop')
  || store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.status === 'valid')[0]?.shop_key
if (!SHOP) { console.error('无可用 pdd_mms 账号'); process.exit(2) }

const OUT = join(PLUGIN, 'dev', '.ui-shots')
mkdirSync(OUT, { recursive: true })

const COLORS = ['格蕾灰', '奶油黄', '银河蓝', '迷雾紫', '星光粉']
const SIZES = ['110cm', '120cm', '130cm', '140cm', '150cm', '160cm']

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
  const u = e.request.url
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(u)) return
  posts.push({ id: e.requestId, url: u })
})

console.log('打开商品列表…')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(10000)
if (/\/login/i.test(page.url())) { console.error('登录态失效'); process.exit(3) }

// 进类目页
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

// 选类目
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
  const u = e.request.url
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(u)) return
  posts2.push({ id: e.requestId, url: u })
})

await sleep(14000)
console.log('表单页就绪:', sp.url().slice(0, 100))

// ── 填标题 ──
const setVal = (sel, val) => sp.evaluate((s, v) => {
  const el = document.querySelector(s)
  if (!el) return false
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  el.focus()
  if (d?.set) d.set.call(el, v); else el.value = v
  for (const ev of ['input', 'change', 'blur']) el.dispatchEvent(new Event(ev, { bubbles: true }))
  return true
}, sel, val).catch(() => false)

await setVal('#goods_name input[data-testid="beast-core-input-htmlInput"]', '抓包测试儿童摇粒绒家居服套装')
console.log('标题已填')

// ── 上传 1 张主图（保证页面状态正常）──
const mi = await sp.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
if (mi) {
  await mi.uploadFile(join(PLUGIN, 'skills', 'pdd-link-matrix', 'assets', 'src', 'main_06.jpg'))
  await sleep(16000)
  const cnt = await sp.evaluate(() => {
    const inp = document.querySelector('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
    let box = inp
    for (let i = 0; i < 10 && box?.parentElement; i++) {
      box = box.parentElement
      const m = (box.innerText || '').replace(/\s+/g, ' ').match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
      if (m) return `${m[1]}/${m[2]}`
    }
    return '未知'
  }).catch(() => '?')
  console.log('主图计数:', cnt)
}

// ── 详细 dump「规格与库存」区域结构 ──
console.log('\n===== 规格区结构 dump =====')
const specArea = await sp.evaluate(() => {
  const out = { buttons: [], rows: 0, heads: [], texts: [] }
  // 找规格区块
  const keys = ['规格与库存', '添加规格类型', '规格类型', '颜色分类']
  for (const el of document.querySelectorAll('div, section')) {
    const t = (el.innerText || '').trim()
    if (!t || t.length > 3000) continue
    if (t.startsWith('规格与库存') || t.includes('添加规格类型')) {
      // 收集该块内所有按钮
      for (const b of el.querySelectorAll('button, [role=button], div[class*="btn"], span[class*="btn"]')) {
        const bt = (b.innerText || '').trim()
        if (bt && bt.length < 20) out.buttons.push(bt)
      }
      break
    }
  }
  out.buttons = [...new Set(out.buttons)]
  // 表格
  const tables = [...document.querySelectorAll('table')]
  for (const t of tables) {
    const rows = t.querySelectorAll('tr').length
    const heads = [...t.querySelectorAll('th')].map(x => (x.innerText || '').trim()).filter(Boolean)
    if (rows > 0 || heads.length) {
      out.rows = Math.max(out.rows, rows)
      if (heads.length) out.heads = heads
    }
  }
  // 页面里与规格相关的文案
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = body.match(/规格与库存[\s\S]{0,300}/)
  if (m) out.texts.push(m[0].slice(0, 300))
  return out
})
console.log('  按钮:', JSON.stringify(specArea.buttons))
console.log('  表格最大行数:', specArea.rows)
console.log('  表头:', JSON.stringify(specArea.heads))
console.log('  文案:', specArea.texts[0] || '(无)')

// ── 点「添加规格类型」──
console.log('\n点「添加规格类型」…')
const addClicked = await sp.evaluate(() => {
  const cands = [...document.querySelectorAll('button, div, span, a')].filter(el => {
    const t = (el.innerText || '').trim()
    if (!/^添加规格类型$|^添加规格$|^添加规格项$/.test(t)) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
  const el = cands[cands.length - 1]
  if (!el) return ''
  el.scrollIntoView({ block: 'center' })
  for (const ev of ['mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
  }
  return (el.innerText || '').trim()
})
console.log('  点击结果:', addClicked || '未找到')
await sleep(3000)

// ── dump 点击后出现的选择面板 ──
console.log('\n===== 规格类型选择面板 =====')
const panel = await sp.evaluate(() => {
  const out = { panels: [], options: [] }
  // 找所有可见弹层
  for (const el of document.querySelectorAll('div[class*="dropdown"], div[class*="Dropdown"], div[class*="popover"], div[class*="Popover"], div[class*="modal"], div[class*="Modal"], div[class*="panel"]')) {
    if (el.offsetParent === null) continue
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    if (!t || t.length > 800) continue
    out.panels.push({ cls: String(el.className || '').slice(0, 60), text: t.slice(0, 200) })
  }
  out.panels = out.panels.slice(0, 6)
  // 面板里的可点项
  for (const el of document.querySelectorAll('li, [role=option], div[class*="item"], span[class*="item"]')) {
    if (el.offsetParent === null) continue
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    if (!t || t.length > 30) continue
    out.options.push(t)
  }
  out.options = [...new Set(out.options)].slice(0, 40)
  return out
})
console.log('  弹层:', JSON.stringify(panel.panels.slice(0, 3)))
console.log('  可选项:', JSON.stringify(panel.options.slice(0, 25)))

const keep = argOf('keep') === '1'
if (keep) {
  console.log('\n★ --keep=1：保持窗口 120s 供检查')
  await sleep(120000)
}

writeFileSync(join(OUT, 'pdd-sku-probe.json'),
  JSON.stringify({ specArea, panel, url: sp.url() }, null, 2))
console.log('\n已写 dev/.ui-shots/pdd-sku-probe.json')
console.log('（本脚本只做结构探测，未提交。看到 dump 后再决定怎么建 30 行）')
await sleep(3000)
await browser.close()
