#!/usr/bin/env node
/**
 * 分步调用觅千手的发布函数（不调 startFill 黑盒，逐步骤调用）。
 *
 * 用法：node dev/run-mqs-steps.mjs --shop=<shopKey> --data=<productJson>
 */
import puppeteer from 'puppeteer-core'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const argOf = (n) => {
  const h = process.argv.find(a => a.startsWith(`--${n}=`))
  return h ? h.slice(n.length + 3) : undefined
}

const PLUGIN = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const MOD_DIR = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules'
const { CredentialStore } = await import(`file:///${PLUGIN}/lib/services/credential-store.js`)
const { findChromePath, profileDir } = await import(`file:///${PLUGIN}/lib/browser-login.js`)

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const SHOP = argOf('shop')
  || store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.status === 'valid')[0]?.shop_key
const DATA_FILE = argOf('data') || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/product-mode2.json'

const product = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
console.log(`商品: ${product.title}`)

// 收集模块
const modules = {}
for (const f of readdirSync(MOD_DIR).filter(f => f.startsWith('m_') && f.endsWith('.js'))) {
  const m = f.match(/^m_\d+_(\d+)\.js$/)
  if (m) modules[m[1]] = readFileSync(join(MOD_DIR, f), 'utf8')
}
console.log(`模块: ${Object.keys(modules).length} 个`)

const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: profileDir('pdd_mms', SHOP),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
  protocolTimeout: 600_000,   // fillSkuOnPage 建 30 行 SKU 很慢，给 10 分钟
})
const page = (await browser.pages())[0] || (await browser.newPage())

console.log('打开商品列表…')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))
if (/\/login/i.test(page.url())) { console.error('登录失效'); process.exit(3) }

// 进表单页
console.log('进表单页…')
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
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1500))
  cp = (await browser.pages()).find(x => /\/goods\/category/.test(x.url()))
  if (cp) break
}
if (!cp) { console.error('类目页未出现'); process.exit(4) }
await cp.bringToFront(); await new Promise(r => setTimeout(r, 3500))
const inp = await cp.$('input[placeholder*="搜索分类"]')
await inp.click({ clickCount: 3 }).catch(() => {})
await cp.keyboard.press('Backspace').catch(() => {})
await cp.keyboard.type('儿童睡衣', { delay: 100 })
await new Promise(r => setTimeout(r, 3800))
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
await new Promise(r => setTimeout(r, 900))
await cp.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确认发布该类商品')
  if (b && !b.disabled) b.click()
})
let sp = null
for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 1500))
  sp = (await browser.pages()).find(x => /\/goods\/goods_add\//.test(x.url()))
  if (sp) break
}
if (!sp) { console.error('表单页未出现'); process.exit(5) }
await sp.bringToFront()
console.log('表单页:', sp.url().slice(0, 100))

// 等表单渲染
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 2000))
  const ready = await sp.evaluate(() =>
    document.body.innerText.includes('商品详情') && document.body.innerText.includes('商品轮播图')
  ).catch(() => false)
  if (ready) break
}
console.log('表单已渲染')

// ★ 清掉状态污染：觅千手会读 localStorage.goodsDetail 的 fill_price_complete，
//   如果之前跑过（哪怕失败），它会认为「已填过价」而拒绝再填，报「拼多多数据解析异常」。
await sp.evaluate(() => {
  try {
    localStorage.removeItem('goodsDetail')
    localStorage.removeItem('kdds_pdd_requestBody')
    localStorage.removeItem('kdds_debug_goodsDetail')
    localStorage.removeItem('pdd_move_detailData')
    sessionStorage.clear()
  } catch { /* 忽略 */ }
})
console.log('已清 localStorage 状态')

// 注入模块
await sp.evaluate((mods) => {
  const moduleCache = {}
  function createRequire() {
    function requireFn(moduleId) {
      const id = String(moduleId)
      if (moduleCache[id]) return moduleCache[id].exports
      const factory = mods[id]
      if (!factory) { console.warn('模块未找到:', id); return {} }
      const module = { exports: {} }
      moduleCache[id] = module
      const localRequire = Object.assign(
        function (subId) { return requireFn(subId) },
        {
          d: (exports, definition) => {
            for (const key in definition) {
              if (!Object.prototype.hasOwnProperty.call(exports, key)) {
                Object.defineProperty(exports, key, { enumerable: true, get: definition[key] })
              }
            }
          },
          n: (mod) => {
            const getter = mod && mod.__esModule ? () => mod.default : () => mod
            localRequire.d(getter, { a: getter })
            return getter
          },
          o: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
          r: (exports) => {
            if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
              Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
            }
            Object.defineProperty(exports, '__esModule', { value: true })
          },
        }
      )
      try {
        const fn = eval(`(${factory})`)
        fn(module, module.exports, localRequire)
      } catch (err) {
        console.warn(`模块 ${id} 执行失败:`, err.message)
        delete moduleCache[id]
        return {}
      }
      return module.exports
    }
    return requireFn
  }
  window.__webpack_require__ = createRequire()
}, modules)

// 加载发布类
const cls = await sp.evaluate(() => {
  const req = window.__webpack_require__
  const main = req('8087')
  const S = main.A || main.default || main
  window.__MQS__ = S
  return { ok: typeof S === 'function' && typeof S?.prototype?.fillTitleAndAttributes === 'function' }
})
console.log('发布类就绪:', cls.ok)

// 构造 detailData
const detailData = await sp.evaluate((p) => {
  const skuSort = p.specs?.map(d => d.name) || []
  const skuKey = {}
  const skuPrice = {}
  p.specs?.forEach(d => { skuKey[d.name] = d.values.map(v => v.value) })
  p.skus?.forEach((s, i) => { skuPrice[`${i + 1}`] = { price: s.price || p.price, stock: s.stock || p.stock } })
  const skuImg = {}
  p.specs?.find(d => /颜色/.test(d.name))?.values.forEach(v => { if (v.image) skuImg[v.value] = v.image })
  return {
    goods_name: p.title, title: p.title, price: p.price, inventory: p.stock,
    sku_sort: skuSort, sku_key: skuKey, sku_price: skuPrice, sku_img: skuImg,
    main_img: p.images || [], detail_img: p.detailImages || [],
    gallery: [...(p.images || []).map(u => ({ url: u, type: 1 })), ...(p.detailImages || []).map(u => ({ url: u, type: 2 }))],
    movingConfig: { inventory: p.stock || '1000', pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20, selectTime: 'today' },
    attrs: p.attributes || [],
    platform: 'pinduoduo', goods_id: '', productId: Date.now().toString(),
  }
}, product)
console.log('detailData 就绪')

// ═══ 分步调用 ═══
console.log('\n═══ 步骤 1：填标题和属性 ═══')
const step1 = await sp.evaluate(async (dd) => {
  const S = window.__MQS__
  const inst = S.getOrCreate ? S.getOrCreate() : new S()
  try {
    const r = await inst.fillTitleAndAttributes(dd)
    return { ok: true, result: r }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}, detailData)
console.log('结果:', JSON.stringify(step1))

console.log('\n═══ 步骤 2：填 SKU 规格 ═══')
const step2 = await sp.evaluate(async (dd) => {
  const S = window.__MQS__
  const inst = S.getOrCreate ? S.getOrCreate() : new S()
  try {
    const r = await inst.fillSkuOnPage(dd)
    return { ok: true, result: r }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}, detailData)
console.log('结果:', JSON.stringify(step2))

console.log('\n═══ 步骤 3：填价格表 ═══')
const step3 = await sp.evaluate(async (dd) => {
  const S = window.__MQS__
  const inst = S.getOrCreate ? S.getOrCreate() : new S()
  try {
    const r = await inst.fillPriceTable(dd, dd.sku_price, dd.sku_img || {})
    return { ok: true, result: r }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}, detailData)
console.log('结果:', JSON.stringify(step3))

// 截图看结果
await sp.screenshot({ path: join(PLUGIN, 'dev', '.ui-shots', 'mqs-steps-result.png'), fullPage: false })
console.log('\n截图: dev/.ui-shots/mqs-steps-result.png')

console.log('\n保持 30s 供检查…')
await new Promise(r => setTimeout(r, 30000))
await browser.close()
