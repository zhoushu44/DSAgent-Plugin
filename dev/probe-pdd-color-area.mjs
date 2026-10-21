/**
 * 精确探测「颜色分类」区域的 DOM，找到正确的输入方式。
 *
 * 上一步的教训：按 innerText 含「颜色分类」找容器不可靠（会命中外层大容器，66 个 input）。
 * 本脚本改为：
 *   1. 找到「颜色分类」这段文字所在的**最小元素**
 *   2. 向上取到最近的「有 input 的兄弟容器」
 *   3. dump 该容器的完整结构（tag/class/placeholder/innerHTML 摘要）
 *   4. 同时 dump「尺码」区结构，对比两者差异
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
const PLUGIN = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { CredentialStore } = await import(`file:///${PLUGIN}/lib/services/credential-store.js`)
const { findChromePath, profileDir } = await import(`file:///${PLUGIN}/lib/browser-login.js`)
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const SHOP = argOf('shop')

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(),
  userDataDir: profileDir('pdd_mms', SHOP),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
})
const page = (await browser.pages())[0] || (await browser.newPage())

console.log('打开商品列表 → 类目 → 表单…')
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
await cp.bringToFront(); await sleep(3500)
const inp = await cp.$('input[placeholder*="搜索分类"]')
await inp.click({ clickCount: 3 }).catch(() => {})
await cp.keyboard.press('Backspace').catch(() => {})
await cp.keyboard.type('儿童睡衣', { delay: 100 })
await sleep(3800)
await cp.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const items = [...document.querySelectorAll('li')].filter(el => {
    if (!vis(el)) return false
    if (!/SPP_searchItem|searchItem/i.test(String(el.className || ''))) return false
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim()
    return !!t && t.length <= 120 && !/没有合适的类目|立即反馈/.test(t)
  })
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
  best?.click()
})
await sleep(900)
await cp.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确认发布该类商品')
  if (b && !b.disabled) b.click()
})
let sp = null
for (let i = 0; i < 25; i++) { await sleep(1500); sp = (await browser.pages()).find(x => /\/goods\/goods_add\//.test(x.url())); if (sp) break }
await sp.bringToFront()
await sleep(14000)
console.log('表单页就绪')

// ══════════ 精确 dump 颜色分类区 ══════════
const dump = await sp.evaluate(() => {
  const out = { found: null, byText: [], candidates: [] }

  // 1) 找「颜色分类」这段文字的最小元素
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const hits = []
  let n
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim()
    if (t === '颜色分类' || (t.includes('颜色分类') && t.length < 20)) {
      hits.push(n.parentElement)
    }
  }
  out.byText = hits.slice(0, 5).map(el => ({
    tag: el.tagName,
    cls: String(el.className || '').slice(0, 60),
    parentCls: String(el.parentElement?.className || '').slice(0, 60),
  }))

  if (!hits.length) return out
  // 2) 从文字元素向上找 3 层，看每层是否含 input
  let cur = hits[0]
  for (let lvl = 0; lvl < 6 && cur; lvl++) {
    const inputs = [...cur.querySelectorAll('input')].filter(i => i.type !== 'file')
    const tags = [...cur.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="chip"], [class*="Chip"]')]
    const btns = [...cur.querySelectorAll('button')]
    out.candidates.push({
      lvl,
      tag: cur.tagName,
      cls: String(cur.className || '').slice(0, 80),
      textLen: (cur.innerText || '').length,
      inputCount: inputs.length,
      inputSamples: inputs.slice(0, 5).map(i => ({
        ph: i.placeholder || '',
        cls: String(i.className || '').slice(0, 60),
        val: i.value || '',
        ro: i.readOnly,
      })),
      tagCount: tags.length,
      btnTexts: btns.map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 8),
      // 该层 innerHTML 摘要（只取前 600 字符，看结构）
      htmlHead: (cur.innerHTML || '').replace(/\s+/g, ' ').slice(0, 600),
    })
    cur = cur.parentElement
  }

  // 3) 也 dump 尺码区作对比（那里成功了）
  const sizeHits = []
  const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let m
  while ((m = w2.nextNode())) {
    const t = (m.textContent || '').trim()
    if (t === '参考分类' || t === '全部尺码表') sizeHits.push(m.parentElement)
  }
  out.sizeArea = sizeHits.slice(0, 3).map(el => ({
    tag: el.tagName,
    cls: String(el.className || '').slice(0, 60),
    nearHtml: (el.parentElement?.innerHTML || '').replace(/\s+/g, ' ').slice(0, 500),
  }))

  return out
})

mkdirSync(join(PLUGIN, 'dev', '.ui-shots'), { recursive: true })
writeFileSync(join(PLUGIN, 'dev', '.ui-shots', 'pdd-color-area.json'), JSON.stringify(dump, null, 2))

console.log('\n===== 「颜色分类」文字位置 =====')
console.log(JSON.stringify(dump.byText, null, 2))
console.log('\n===== 向上逐层结构 =====')
for (const c of dump.candidates || []) {
  console.log(`\n[lvl ${c.lvl}] ${c.tag} .${c.cls}  textLen=${c.textLen} inputs=${c.inputCount} tags=${c.tagCount}`)
  if (c.inputSamples?.length) console.log('  inputs:', JSON.stringify(c.inputSamples))
  if (c.btnTexts?.length) console.log('  btns:', JSON.stringify(c.btnTexts))
  if (c.lvl <= 3) console.log('  html:', c.htmlHead?.slice(0, 400))
}
console.log('\n===== 尺码区（成功的那个）=====')
for (const s of dump.sizeArea || []) {
  console.log(`\n${s.tag} .${s.cls}`)
  console.log('  ', s.nearHtml?.slice(0, 400))
}

console.log('\n已写 dev/.ui-shots/pdd-color-area.json')
await sleep(3000)
await browser.close()
