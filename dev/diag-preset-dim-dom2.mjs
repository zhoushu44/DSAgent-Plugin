/**
 * 只读诊断（正确入口版）：走「商品列表 → 发布新商品 → 搜索类目 → 确认发布该类商品」进入表单页，
 * 而不是 catId 直达（直达页不会绑定类目，规格区为空壳，只有「添加规格类型(0/2)」）。
 *
 * 进入表单页后只做 dump：三个预置维度行的容器/标题/placeholder/checkbox/按钮，
 * 「添加规格类型」按钮真实文本与状态，SKU 表结构。
 *
 * 全程不填表、不提交。
 * 用法：node dev/diag-preset-dim-dom2.mjs [outJson] [categoryKeyword]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP_KEY = process.env.PDD_SHOP_KEY || 'pdd_mms_d105b9eff40aa53674b4da4091f76a4a'
const PROFILE = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${SHOP_KEY}`
const KW = process.argv[3] || process.env.PDD_CATEGORY || '儿童睡衣'
const OUT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-dom.json'
const SHOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts'
const sleep = ms => new Promise(r => setTimeout(r, ms))

for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch { /* ignore */ }
}

const t0 = Date.now()
const rep = { meta: { shopKey: SHOP_KEY, categoryKeyword: KW, startedAt: new Date().toISOString(), readOnly: true }, steps: [], catPage: {}, form: {}, containers: [], titleProbes: [], addSpecProbe: {}, newSpec: {}, skuTable: {}, htmlExcerpt: '', errors: [] }
const step = (m, x) => { rep.steps.push({ sec: +((Date.now() - t0) / 1000).toFixed(1), msg: m, ...(x || {}) }); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}${x ? ' ' + JSON.stringify(x) : ''}`) }

let browser = null
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: PROFILE, defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized', '--window-position=0,0', '--window-size=1600,1000'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 900000,
  })
  const p = await (await browser.pages())[0] || await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })

  step('goto goods_list')
  await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(3000)

  // 点「发布新商品」
  let pt = null
  for (let w = 0; w < 20; w++) {
    await sleep(500)
    pt = await p.evaluate(() => {
      const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
      const els = [...document.querySelectorAll('button, a, div, span')].filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
      const el = els.find(e => e.tagName === 'BUTTON') || els[els.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.y < 0) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }).catch(() => null)
    if (pt) break
  }
  if (!pt) throw new Error('找不到「发布新商品」按钮')
  await p.mouse.click(pt.x, pt.y)
  step('点击发布新商品', pt)
  await sleep(2500)

  // 找类目页（可能新开 tab）
  let catPage = p
  for (let i = 0; i < 30; i++) {
    const pages = await browser.pages()
    const hit = pages.find(x => /goods\/(category|goods_add)/.test(String(x.url() || '')))
    if (hit) { catPage = hit; break }
    await sleep(500)
  }
  await catPage.bringToFront().catch(() => {})
  rep.catPage.url = catPage.url()
  step('类目页', { url: rep.catPage.url })

  // 搜索框
  const hasSearch = await catPage.evaluate(() => !!document.querySelector('input[placeholder*="搜索分类"]')).catch(() => false)
  rep.catPage.hasSearch = hasSearch
  if (hasSearch) {
    const sp = await catPage.evaluate(() => { const e = document.querySelector('input[placeholder*="搜索分类"]'); const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })
    await catPage.mouse.click(sp.x, sp.y)
    await sleep(400)
    await catPage.keyboard.down('Control'); await catPage.keyboard.press('KeyA'); await catPage.keyboard.up('Control')
    await catPage.keyboard.press('Backspace')
    await sleep(200)
    await catPage.keyboard.type(KW, { delay: 110 })
    step('已输入类目关键词', { KW })
    // 等结果稳定
    let prev = -1, stable = 0
    for (let w = 0; w < 25; w++) {
      await sleep(600)
      const c = await catPage.evaluate(() => [...document.querySelectorAll('li')].filter(el => /searchItem/i.test(el.className || '')).length).catch(() => 0)
      if (c > 0 && c === prev) { if (++stable >= 2) break } else stable = 0
      prev = c
    }
    rep.catPage.resultCount = prev
    rep.catPage.results = await catPage.evaluate(() => [...document.querySelectorAll('li')].filter(el => /searchItem/i.test(el.className || '')).slice(0, 10).map(li => ({ text: (li.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90), cls: (li.className || '').slice(0, 60) }))).catch(() => [])
    step('类目搜索结果', { count: prev, first: rep.catPage.results[0]?.text })

    // 找「儿童睡衣」那条（优先精确包含关键词）
    const picked = await catPage.evaluate(kw => {
      const items = [...document.querySelectorAll('li')].filter(el => /searchItem/i.test(el.className || ''))
      const norm = t => (t || '').replace(/\s+/g, ' ').trim()
      let target = items.find(li => norm(li.innerText).includes(kw)) || items[0]
      if (!target) return null
      const txt = norm(target.innerText)
      target.click()
      return txt
    }, KW).catch(() => null)
    rep.catPage.picked = picked
    step('点选类目', { picked })
    await sleep(2500)
  }

  // 点「确认发布该类商品」
  const cp = await catPage.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a, div, span')].map(e => { const r = e.getBoundingClientRect(); return { tx: (e.innerText || '').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) } }).filter(o => /确认发布该类商品/.test(o.tx) && o.w > 30)
    return btns[btns.length - 1] || null
  }).catch(() => null)
  rep.catPage.confirmBtn = cp
  if (cp) { await catPage.mouse.click(cp.x, cp.y); step('点确认发布该类商品') }
  else step('⚠ 未找到确认按钮，可能已在表单页')

  // 等表单页
  let form = catPage
  for (let i = 0; i < 40; i++) {
    await sleep(700)
    const pages = await browser.pages()
    const hit = pages.find(x => /goods_add\/index/.test(String(x.url() || '')))
    if (hit) { form = hit; break }
    if (/goods_add\/index/.test(String(catPage.url() || ''))) { form = catPage; break }
  }
  await form.bringToFront().catch(() => {})
  step('表单页', { url: form.url() })

  // 等规格区 + 维度行出现
  let ready = false
  for (let i = 0; i < 90; i++) {
    await sleep(1000)
    ready = await form.evaluate(() => {
      const box = document.querySelector('#goods-spec-sku')
      if (!box) return false
      const rows = box.querySelectorAll('.property-container-v2, .goods-spec-row').length
      const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"]')
      return hasTitle && rows > 0
    }).catch(() => false)
    if (ready) break
  }
  rep.form.url = form.url()
  rep.form.ready = ready
  step('规格行就绪', { ready })
  await sleep(2000)
  await form.evaluate(() => { document.querySelector('#goods-spec-sku')?.scrollIntoView({ block: 'start' }) }).catch(() => {})
  await sleep(1200)

  /* ─── 页面基本状态（类目是否真的绑定） ─── */
  rep.form.basic = await form.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    return {
      url: location.href,
      categoryBlock: norm(document.querySelector('#goods-category, .goods-category')?.innerText || '').slice(0, 200),
      hasCatName: norm(document.body.innerText).includes('儿童睡衣'),
      hasSpecRoot: !!document.querySelector('#goods-spec-sku'),
      hasNewSpec: !!document.querySelector('#newSpec'),
    }
  })

  /* ─── 逐行 dump ─── */
  rep.containers = await form.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    const rows = [...box.querySelectorAll('.property-container-v2, .goods-spec-row')]
    const vis = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } }
    const pathOf = el => { // 生成短路径便于代码里稳定定位
      const parts = []
      let cur = el, depth = 0
      while (cur && cur !== box && depth < 6) {
        let s = cur.tagName.toLowerCase()
        if (cur.id) s += '#' + cur.id
        const cls = (typeof cur.className === 'string' ? cur.className : '').split(/\s+/).filter(c => c && !/_\d+-\d+-\d+$/.test(c)).slice(0, 2)
        if (cls.length) s += '.' + cls.join('.')
        parts.unshift(s)
        cur = cur.parentElement; depth++
      }
      return parts.join(' > ')
    }
    return rows.map((c, idx) => {
      const titleProbe = ['.property-name-title', '[class*="property-name"]', '[class*="propertyName"]', '.goods-spec-title', '[class*="spec-title"]', 'label', '[class*="title"]']
        .map(sel => { const el = c.querySelector(sel); return el ? { sel, tag: el.tagName, cls: (el.className || '').slice(0, 70), text: (el.textContent || '').trim().slice(0, 30) } : null })
        .filter(Boolean)

      // 行首文本块（按 y 排序，取最靠左上的文本节点宿主）
      const texts = []
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT)
      let n
      while ((n = w.nextNode())) {
        const s = (n.nodeValue || '').replace(/\s+/g, ' ').trim()
        if (!s) continue
        const host = n.parentElement
        if (!host || /^(INPUT|TEXTAREA|SCRIPT|STYLE)$/.test(host.tagName)) continue
        const r = host.getBoundingClientRect()
        if (r.width < 3 || r.height < 3) continue
        texts.push({ text: s.slice(0, 36), tag: host.tagName, cls: (host.className || '').slice(0, 64), x: Math.round(r.x), y: Math.round(r.y), fs: getComputedStyle(host).fontSize })
      }
      texts.sort((a, b) => a.y - b.y || a.x - b.x)

      const inputs = [...c.querySelectorAll('input')].map(i => {
        const r = i.getBoundingClientRect()
        return { ph: i.placeholder || '(无)', type: i.type || 'text', value: (i.value || '').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), cls: (i.className || '').slice(0, 60), readonly: !!i.readOnly }
      }).filter(x => x.w > 15)

      const cbs = [...c.querySelectorAll('.package-item-container')]
      return {
        idx: idx + 1,
        tag: c.tagName,
        cls: c.className || '',
        id: c.id || '',
        domPath: pathOf(c),
        rect: vis(c),
        titleProbe,
        firstTexts: texts.slice(0, 8),
        inputs,
        checkboxCount: cbs.length,
        checkboxSample: cbs.slice(0, 5).map(el => ({ cls: (el.className || '').slice(0, 50), text: (el.querySelector('.check-wrapper')?.textContent || el.textContent || '').trim().slice(0, 10) })),
        // 数字值挂在哪个元素（48..175 网格）
        numericCells: (() => {
          const out = []
          for (const el of c.querySelectorAll('*')) {
            if (el.children.length) continue
            const t = (el.textContent || '').trim()
            if (!/^\d{2,3}$/.test(t)) continue
            const r = el.getBoundingClientRect()
            if (r.width < 5) continue
            out.push({ tag: el.tagName, cls: (el.className || '').slice(0, 50), text: t, parentCls: (el.parentElement?.className || '').slice(0, 60) })
            if (out.length >= 4) break
          }
          return out
        })(),
        buttons: [...new Set([...c.querySelectorAll('button, a, span, div')].map(e => (e.innerText || '').trim()).filter(t => t && t.length <= 20 && !t.includes('\n')))].slice(0, 10),
        innerTextHead: (c.innerText || '').replace(/\s+/g, ' | ').slice(0, 300),
        outerHtmlHead: c.outerHTML.slice(0, 400),
      }
    })
  })

  /* ─── 「添加规格类型」按钮全页探针 ─── */
  rep.addSpecProbe = await form.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, '')
    const all = [...document.querySelectorAll('button, [role="button"], a, div, span')]
      .filter(e => norm(e.innerText).includes('添加规格'))
      .map(e => {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
        return { tag: e.tagName, text: norm(e.innerText).slice(0, 40), cls: (e.className || '').slice(0, 70), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), disabled: e.disabled ?? '', aria: e.getAttribute('aria-disabled') || '', display: cs.display, inSpec: !!e.closest('#goods-spec-sku'), parentCls: (e.parentElement?.className || '').slice(0, 60) }
      })
    return {
      exact: all.filter(x => x.text === '添加规格类型'),
      startsWith: all.filter(x => /^添加规格类型/.test(x.text)).slice(0, 8),
      total: all.length,
      sample: all.slice(0, 12),
    }
  })

  /* ─── #newSpec ─── */
  rep.newSpec = await form.evaluate(() => {
    const root = document.querySelector('#newSpec')
    if (!root) return { exists: false }
    const inputs = [...root.querySelectorAll('input')].map(i => { const r = i.getBoundingClientRect(); return { ph: i.placeholder || '(无)', value: (i.value || '').slice(0, 20), w: Math.round(r.width) } }).filter(x => x.w > 10)
    return { exists: true, cls: (root.className || '').slice(0, 60), inputCount: inputs.length, inputs: inputs.slice(0, 12), checkboxCount: root.querySelectorAll('.package-item-container').length, innerTextHead: (root.innerText || '').replace(/\s+/g, ' | ').slice(0, 400) }
  })

  /* ─── SKU 表：行数、表头、每行是否有预览图列 ─── */
  rep.skuTable = await form.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, '')
    const t = [...document.querySelectorAll('table')].find(tb => /规格编码/.test(tb.innerText || ''))
    if (!t) return { found: false }
    const bodyRows = [...t.querySelectorAll('tbody tr')]
    const headCells = [...t.querySelectorAll('thead th, thead td')].map(c => norm(c.innerText)).filter(Boolean)
    return {
      found: true, cls: (t.className || '').slice(0, 60),
      headCells,
      rowCount: bodyRows.length,
      rows: bodyRows.slice(0, 12).map((tr, i) => {
        const tds = [...tr.querySelectorAll('td')]
        return {
          i: i + 1, tdCount: tds.length,
          texts: tds.map(td => norm(td.innerText).slice(0, 14)),
          inputCount: tr.querySelectorAll('input').length,
          hasThumb: !!tr.querySelector('img, [class*="thumb"], [class*="preview"], [class*="upload"]'),
          placeholders: [...new Set([...tr.querySelectorAll('input')].map(x => x.placeholder || '(无)'))].slice(0, 5),
        }
      }),
    }
  })

  /* ─── HTML 摘录 ─── */
  rep.htmlExcerpt = await form.evaluate(() => (document.querySelector('#goods-spec-sku')?.outerHTML || '').slice(0, 80000))

  const el = await form.$('#goods-spec-sku')
  if (el) await el.screenshot({ path: path.join(SHOT, 'preset-dim-dom-spec-area.png') }).catch(e => rep.errors.push('shot: ' + e.message))
  await form.screenshot({ path: path.join(SHOT, 'preset-dim-dom-full.png') }).catch(e => rep.errors.push('shot2: ' + e.message))
  step('dump 完成', { containers: rep.containers.length, skuRows: rep.skuTable?.rowCount })
} catch (e) {
  rep.errors.push(String(e?.stack || e))
  step('ERROR ' + String(e?.message || e))
} finally {
  try { if (browser) await browser.close() } catch { /* ignore */ }
  rep.meta.finishedAt = new Date().toISOString()
  rep.meta.durationSec = Math.round((Date.now() - t0) / 1000)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(rep, null, 2), 'utf8')
  console.log('written: ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)')
}
