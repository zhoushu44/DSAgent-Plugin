/**
 * 抓拼多多发布的真实提交体（复刻 dev/probe-commit-body.mjs 的淘宝版思路）。
 *
 * 用户思路：**先提交一次拿到真实 commitBody，再照它的结构拼装数据**。
 * 这是解决「页面只建出 1 行 SKU，改包无法匹配」的正解 ——
 * 拿到含 30 行 skus 的真实样本，就知道每个元素长什么样、该怎么拼。
 *
 * 做法：
 *   1. 走正常链路进到发布表单页
 *   2. 尽力填必填项（标题/价格/库存/规格），让页面把 SKU 行建出来
 *   3. 点「提交并上架」
 *   4. CDP 拦下 goodsCommit/action/edit 的请求体，完整落盘
 *
 * 不修改任何数据，只观察。抓到的 body 就是平台自己生成的，结构 100% 权威。
 *
 * 用法：
 *   node dev/probe-pdd-commit-body.mjs --shop=<shopKey> --hold=60
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
if (!SHOP) { console.error('没有可用的 pdd_mms 账号，用 --shop= 指定'); process.exit(2) }
const acc = store.get(SHOP)
if (!acc) { console.error('账号不存在:', SHOP); process.exit(2) }

const OUT_DIR = join(PLUGIN, 'dev', '.ui-shots')
mkdirSync(OUT_DIR, { recursive: true })

const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: profileDir('pdd_mms', SHOP),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
})
const page = (await browser.pages())[0] || (await browser.newPage())

// 拦所有 POST
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const posts = []
cdp.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  const u = e.request.url
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(u)) return
  posts.push({
    id: e.requestId, url: u,
    hasPost: !!e.request.hasPostData,
    ct: (e.request.headers || {})['Content-Type'] || '',
    antiContent: ((e.request.headers || {})['Anti-Content'] || '').slice(0, 60),
  })
})

console.log('打开商品列表…')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(10000)
if (/\/login/i.test(page.url())) { console.error('登录态失效'); process.exit(3) }
console.log('页面:', await page.title())

// 点「发布新商品」
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

// 等类目页
let cp = null
for (let i = 0; i < 20; i++) {
  await sleep(1500)
  cp = (await browser.pages()).find(x => /\/goods\/category/.test(x.url()))
  if (cp) break
}
if (!cp) { console.error('类目页未出现'); process.exit(4) }
await cp.bringToFront(); await sleep(3500)
console.log('类目页就绪')

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
console.log('已选类目:', picked)
await sleep(900)
await cp.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确认发布该类商品')
  if (b && !b.disabled) b.click()
})

// 等表单页
let sp = null
for (let i = 0; i < 25; i++) {
  await sleep(1500)
  sp = (await browser.pages()).find(x => /\/goods\/goods_add\//.test(x.url()))
  if (sp) break
}
if (!sp) { console.error('表单页未出现'); process.exit(5) }
await sp.bringToFront()
console.log('表单页:', sp.url().slice(0, 110))

// 表单页也要挂 CDP（新标签页）
const cdp2 = await sp.target().createCDPSession()
await cdp2.send('Network.enable')
const posts2 = []
cdp2.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  const u = e.request.url
  if (/\.(css|js|png|jpg|jpeg|webp|gif|woff2?|svg)/i.test(u)) return
  posts2.push({
    id: e.requestId, url: u,
    hasPost: !!e.request.hasPostData,
    ct: (e.request.headers || {})['Content-Type'] || '',
  })
})

await sleep(13000)
console.log('等表单渲染完成')

// ── 填必要项，让页面把 SKU 行建出来 ──
const setVal = async (sel, val) => {
  return await sp.evaluate((s, v) => {
    const el = document.querySelector(s)
    if (!el) return false
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    el.focus()
    if (d?.set) d.set.call(el, v); else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, sel, val).catch(() => false)
}

console.log('\n填标题…')
const titleOk = await setVal('#goods_name input[data-testid="beast-core-input-htmlInput"]',
  '抓包测试儿童摇粒绒家居服套装')
console.log('  标题:', titleOk)

console.log('上传 1 张主图（浏览器原生，确保页面状态正常）…')
const mi = await sp.$('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
if (mi) {
  await mi.uploadFile(join(PLUGIN, 'skills', 'pdd-link-matrix', 'assets', 'src', 'main_06.jpg'))
  await sleep(15000)
  console.log('  主图区计数:', await sp.evaluate(() => {
    const inp = document.querySelector('input[data-tracking-click-viewid="carousel_img_localfile_upload"]')
    let box = inp
    for (let i = 0; i < 10 && box?.parentElement; i++) {
      box = box.parentElement
      const m = (box.innerText || '').replace(/\s+/g, ' ').match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
      if (m) return `${m[1]}/${m[2]}`
    }
    return '未知'
  }).catch(() => '?'))
}

console.log('\n加规格类型（颜色）…')
// 点「添加规格类型」
await sp.evaluate(() => {
  const b = [...document.querySelectorAll('button, div, span')].find(x =>
    /添加规格类型|添加规格/.test((x.innerText || '').trim()) && (x.innerText || '').trim().length < 12)
  if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
})
await sleep(2500)
console.log('  规格入口已点')

// 打印当前 SKU 表状态
const skuState = await sp.evaluate(() => {
  const tables = [...document.querySelectorAll('table')].map((t, i) => ({
    i,
    rows: t.querySelectorAll('tr').length,
    heads: [...t.querySelectorAll('th')].map(th => (th.innerText || '').trim()),
    firstRowText: (t.querySelector('tr')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
  }))
  return {
    tables,
    bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').match(/规格与库存[^。]{0,120}/)?.[0] || '',
  }
})
console.log('  SKU 表:', JSON.stringify(skuState.tables))
console.log('  附近文案:', skuState.bodyText)

const hold = Number(argOf('hold') || 0)
if (hold) {
  console.log(`\n★ 保持 ${hold}s —— 你可以在这个窗口里手动建好规格、填好价格/库存`)
  await sleep(hold * 1000)
}

// ── 点提交 ──
console.log('\n点「提交并上架」…')
const clicked = await sp.evaluate(() => {
  const b = document.querySelector('button#bottomSubmitBtnId')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return 'by-id' }
  const t = [...document.querySelectorAll('button')].find(x =>
    /提交并上架|提交|发布/.test(x.innerText || '') && !x.disabled
    && !/取消|返回|存草稿/.test(x.innerText || ''))
  if (t) { t.scrollIntoView({ block: 'center' }); t.click(); return 'by-text:' + (t.innerText || '').trim() }
  return 'not-found'
})
console.log('提交按钮:', clicked)
await sleep(15000)

// ── 取所有 POST 体 ──
const allPosts = [...posts, ...posts2]
const bodies = []
for (const p of allPosts) {
  const cdpRef = posts.includes(p) ? cdp : cdp2
  try {
    const pd = await cdpRef.send('Network.getRequestPostData', { requestId: p.id })
    const data = pd.postData || ''
    if (data.length < 50) continue
    bodies.push({ url: p.url, len: data.length, ct: p.ct, body: data })
  } catch { /* 已释放 */ }
}

writeFileSync(join(OUT_DIR, 'pdd-commit-bodies.json'), JSON.stringify(bodies, null, 2))
console.log('\n===== POST 请求体 =====')
for (const b of bodies) {
  console.log(`--- ${b.url}  (${b.len} bytes) ---`)
  console.log(b.body.slice(0, 500))
  console.log()
}
console.log(`共 ${bodies.length} 个，已写入 dev/.ui-shots/pdd-commit-bodies.json`)

// 特别提取 goodsCommit 的那条
const commit = bodies.filter(b => /goodsCommit/i.test(b.url))
if (commit.length) {
  for (const c of commit) {
    const f = join(OUT_DIR, `pdd-goodscommit-${Date.now()}.json`)
    writeFileSync(f, c.body, 'utf8')
    let parsed = null
    try { parsed = JSON.parse(c.body) } catch { /* 忽略 */ }
    console.log(`\n★ goodsCommit 已单独落盘: ${f}`)
    if (parsed) {
      console.log(`  skus 数量: ${(parsed.skus || []).length}`)
      console.log(`  skus[0]: ${JSON.stringify((parsed.skus || [])[0]).slice(0, 600)}`)
      console.log(`  gallery: ${(parsed.gallery || []).length}`)
      console.log(`  goods_id: ${parsed.goods_id}`)
    }
  }
}

await sleep(5000)
await browser.close()
