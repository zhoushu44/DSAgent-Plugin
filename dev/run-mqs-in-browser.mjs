#!/usr/bin/env node
/**
 * 把觅千手完整模块注入到拼多多发布页，直接调用原代码的 startFill。
 *
 * 这是真正的复刻：不是我们模仿，是把原模块加载进浏览器，让平台自己跑自己的代码。
 *
 * 用法：node dev/run-mqs-in-browser.mjs --shop=<shopKey> --data=<productJson>
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

console.log(`账号: ${SHOP}`)
console.log(`商品数据: ${DATA_FILE}`)

// ── 读商品数据 ──
const product = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
console.log(`商品: ${product.title}`)
console.log(`规格: ${product.specs?.map(d => `${d.name}(${d.values.length})`).join(' × ')}`)
console.log(`SKU: ${product.skus?.length} 行`)

// ── 收集所有 webpack 模块 ──
const modules = {}
for (const f of readdirSync(MOD_DIR).filter(f => f.startsWith('m_') && f.endsWith('.js'))) {
  const m = f.match(/^m_\d+_(\d+)\.js$/)
  if (!m) continue
  modules[m[1]] = readFileSync(join(MOD_DIR, f), 'utf8')
}
console.log(`已收集 ${Object.keys(modules).length} 个模块`)

// ── 浏览器 ──
const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: profileDir('pdd_mms', SHOP),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1500,950'],
  defaultViewport: { width: 1500, height: 950 },
  // startFill 会跑完整流程（上传/填表/提交），默认 180s 不够
  protocolTimeout: 600_000,
})
const page = (await browser.pages())[0] || (await browser.newPage())

console.log('打开商品列表…')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))
if (/\/login/i.test(page.url())) { console.error('登录态失效'); process.exit(3) }
console.log('登录态正常')

// ── 把模块和运行时注入页面 ──
console.log('注入 webpack 模块到页面…')
await page.evaluate((mods) => {
  const moduleCache = {}
  const w = window

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
                Object.defineProperty(exports, key, {
                  enumerable: true, get: definition[key],
                })
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

  w.__webpack_require__ = createRequire()
  w.__MQS_MODULES_LOADED__ = Object.keys(mods).length
}, modules)

console.log('模块已注入:', await page.evaluate(() => window.__MQS_MODULES_LOADED__))

// ── 加载发布类 ──
console.log('加载发布类…')
const clsInfo = await page.evaluate(() => {
  const req = window.__webpack_require__
  const main = req('8087')
  const S = main.A || main.default || main
  window.__MQS_PUBLISHER__ = S
  return {
    hasClass: typeof S === 'function',
    hasGetOrCreate: typeof S?.getOrCreate === 'function',
    hasStartFill: typeof S?.prototype?.startFill === 'function',
    methodCount: S?.prototype ? Object.getOwnPropertyNames(S.prototype).length : 0,
  }
})
console.log('发布类:', JSON.stringify(clsInfo))

if (!clsInfo.hasStartFill) {
  console.error('发布类没有 startFill，无法继续')
  await browser.close()
  process.exit(4)
}

// ── 构造 detailData（觅千手的商品数据格式）──
// 这是关键：把我们的统一商品数据转成觅千手期望的格式
console.log('\n构造 detailData…')
const detailData = await page.evaluate((p) => {
  // 觅千手的 detailData 结构（从代码反推）
  const skuSort = p.specs?.map(d => d.name) || []
  const skuKey = {}
  const skuImg = {}
  const skuPrice = {}

  // 建 sku_key：维度名 → 值数组
  p.specs?.forEach((d, i) => {
    skuKey[d.name] = d.values.map(v => v.value)
  })

  // 建 sku_price：每个 SKU 的价格/库存
  p.skus?.forEach((s, i) => {
    const key = `${i + 1}`
    skuPrice[key] = {
      price: s.price || p.price || '0',
      stock: s.stock || p.stock || '1000',
    }
  })

  // 建 sku_img：颜色 → 图片 URL（模式2 已由 HTTP 上传好）
  const colorDim = p.specs?.find(d => /颜色/.test(d.name))
  if (colorDim) {
    colorDim.values.forEach(v => {
      if (v.image && /^https?:/.test(v.image)) {
        skuImg[v.value] = v.image
      }
    })
  }

  return {
    // 基本信息
    goods_name: p.title,
    title: p.title,
    price: p.price,
    inventory: p.stock,

    // SKU 结构
    sku_sort: skuSort,
    sku_key: skuKey,
    sku_price: skuPrice,
    sku_img: skuImg,

    // 图片（CDN URL，已由模式2 预上传）
    main_img: p.images || [],
    detail_img: p.detailImages || [],
    gallery: [
      ...(p.images || []).map(u => ({ url: u, type: 1 })),
      ...(p.detailImages || []).map(u => ({ url: u, type: 2 })),
    ],

    // 搬运配置
    movingConfig: {
      inventory: p.stock || '1000',
      pdd_single_buy_rule_type: 1,
      pdd_single_buy_percent: 20,
      selectTime: 'today',
    },

    // 商品属性
    attrs: p.attributes || [],

    // 平台标记
    platform: 'pinduoduo',
    goods_id: '',
    productId: Date.now().toString(),
  }
}, product)

console.log('detailData 键数:', Object.keys(detailData).length)
console.log('  sku_sort:', detailData.sku_sort)
console.log('  sku_key 键:', Object.keys(detailData.sku_key))
console.log('  sku_price 键数:', Object.keys(detailData.sku_price).length)
console.log('  sku_img 键:', Object.keys(detailData.sku_img))
console.log('  gallery:', detailData.gallery.length, '张')

// ── 调 startFill ──
// ★ 必须先导航到发布表单页（startFill 内部会等「商品详情」出现）
console.log('\n===== 先进到发布表单页 =====')

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
  await new Promise(r => setTimeout(r, 1500))
  cp = (await browser.pages()).find(x => /\/goods\/category/.test(x.url()))
  if (cp) break
}
if (!cp) { console.error('类目页未出现'); process.exit(4) }
await cp.bringToFront()
await new Promise(r => setTimeout(r, 3500))
console.log('类目页就绪')

// 选类目（儿童睡衣）
const inp = await cp.$('input[placeholder*="搜索分类"]')
if (inp) {
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
  console.log('已选类目:', picked)
  await new Promise(r => setTimeout(r, 900))
  await cp.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '确认发布该类商品')
    if (b && !b.disabled) b.click()
  })
}

// 等表单页
let sp = null
for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 1500))
  sp = (await browser.pages()).find(x => /\/goods\/goods_add\//.test(x.url()))
  if (sp) break
}
if (!sp) { console.error('表单页未出现'); process.exit(5) }
await sp.bringToFront()
console.log('表单页就绪:', sp.url().slice(0, 100))

// 等表单完全渲染（「商品详情」出现）
console.log('等待表单渲染…')
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 2000))
  const ready = await sp.evaluate(() =>
    document.body.innerText.includes('商品详情') && document.body.innerText.includes('商品轮播图')
  ).catch(() => false)
  if (ready) break
}
console.log('表单已渲染')

// 把模块注入到**表单页**（不是商品列表页）
console.log('注入模块到表单页…')
await sp.evaluate((mods) => {
  const moduleCache = {}
  const w = window

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

  w.__webpack_require__ = createRequire()
  w.__MQS_MODULES_LOADED__ = Object.keys(mods).length
}, modules)

console.log('模块已注入表单页:', await sp.evaluate(() => window.__MQS_MODULES_LOADED__))

// 加载发布类到表单页
const clsInfo2 = await sp.evaluate(() => {
  const req = window.__webpack_require__
  const main = req('8087')
  const S = main.A || main.default || main
  window.__MQS_PUBLISHER__ = S
  return {
    hasClass: typeof S === 'function',
    hasGetOrCreate: typeof S?.getOrCreate === 'function',
    hasStartFill: typeof S?.prototype?.startFill === 'function',
    methodCount: S?.prototype ? Object.getOwnPropertyNames(S.prototype).length : 0,
  }
})
console.log('发布类:', JSON.stringify(clsInfo2))

console.log('\n===== 调用 startFill =====')
const result = await sp.evaluate(async (dd) => {
  const S = window.__MQS_PUBLISHER__
  const inst = S.getOrCreate ? S.getOrCreate() : new S()
  window.__MQS_INSTANCE__ = inst

  const logs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => { logs.push(a.join(' ')); origLog.apply(console, a) }
  console.error = (...a) => { logs.push('ERR ' + a.join(' ')); origErr.apply(console, a) }

  try {
    const r = await inst.startFill(dd, {})
    return { ok: true, result: r, logs: logs.slice(-30) }
  } catch (e) {
    return { ok: false, error: e.message, stack: e.stack?.slice(0, 800), logs: logs.slice(-30) }
  }
}, detailData)

console.log('\n===== 结果 =====')
console.log('ok:', result.ok)
if (result.error) console.log('错误:', result.error)
if (result.stack) console.log('堆栈:', result.stack)
console.log('\n=== 内部日志（最后 30 条）===')
for (const l of result.logs || []) console.log('  ' + l)

console.log('\n保持窗口打开 60 秒供检查…')
await new Promise(r => setTimeout(r, 60000))
await browser.close()
