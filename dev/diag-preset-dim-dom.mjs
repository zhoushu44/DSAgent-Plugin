/**
 * 只读诊断：童装/儿童睡衣 catId=205133764345 发布页「预置多维规格行」DOM
 *
 * 目的：dump 三个预置维度行（颜色分类 / 参考分类 / 规格类型1）的
 *   行容器选择器、标题元素与文本、输入框 placeholder、checkbox 容器、行内按钮文本，
 *   并确认「添加规格类型」按钮是否真的不存在（含隐藏元素 / 视口外元素）。
 *
 * 全程只读：不填表、不点任何按钮、不提交。
 * 账号：默认 pdd_mms_d105b9eff40aa53674b4da4091f76a4a（valid），可用 PDD_SHOP_KEY 覆盖。
 *
 * 用法：node dev/diag-preset-dim-dom.mjs [outJson]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP_KEY = process.env.PDD_SHOP_KEY || 'pdd_mms_d105b9eff40aa53674b4da4091f76a4a'
const PROFILE = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${SHOP_KEY}`
const CAT_ID = '205133764345'
const URL = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${CAT_ID}`
const OUT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-dom.json'
const SHOT_DIR = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts'
const sleep = ms => new Promise(r => setTimeout(r, ms))

for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch { /* ignore */ }
}

const t0 = Date.now()
const report = {
  meta: {
    shopKey: SHOP_KEY,
    catId: CAT_ID,
    targetUrl: URL,
    startedAt: new Date().toISOString(),
    readOnly: true,
    node: process.version,
  },
  steps: [],
  page: {},
  containers: [],
  titleProbes: [],
  addSpecButtonProbe: {},
  newSpec: {},
  skuTable: {},
  htmlExcerpt: '',
  errors: [],
}
const step = (m, extra) => { report.steps.push({ t: Date.now() - t0, msg: m, ...(extra || {}) }); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}${extra ? ' ' + JSON.stringify(extra) : ''}`) }

let browser = null
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    userDataDir: PROFILE,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized', '--window-position=0,0', '--window-size=1600,1000'],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 600000,
  })
  step('浏览器已启动', { profile: PROFILE })

  const p = await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })

  step('goto ' + URL)
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 等等看是否被踢到登录页
  await sleep(3000)
  report.page.urlAfterNav = p.url()
  report.page.titleAfterNav = await p.title().catch(() => '')
  report.page.loginRedirect = /\/login/i.test(report.page.urlAfterNav)
  report.page.needLoginText = await p.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300)
    return /扫码登录|账号登录|请登录|登录后/.test(t) ? t.slice(0, 160) : ''
  }).catch(() => '')
  step('导航完成', { url: report.page.urlAfterNav, loginRedirect: report.page.loginRedirect })

  // 等规格区出现（最多 90s）
  let ready = false
  for (let i = 0; i < 180; i++) {
    ready = await p.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)
    if (ready) break
    await sleep(500)
  }
  step('规格区就绪', { ready, waitedMs: Date.now() - t0 })
  report.page.specRootReady = ready
  if (!ready) {
    report.page.bodyTextExcerpt = await p.evaluate(() => (document.body?.innerText || '').replace(/\n+/g, ' | ').slice(0, 1200)).catch(() => '')
    await p.screenshot({ path: path.join(SHOT_DIR, 'preset-dim-dom-no-spec.png'), fullPage: false }).catch(() => {})
    throw new Error('页面未渲染出 #goods-spec-sku（可能被类目权限或登录拦截）')
  }
  await sleep(2500)

  // 置前 + 滚动到规格区（只读）
  await p.bringToFront().catch(() => {})
  await p.evaluate(() => { document.querySelector('#goods-spec-sku')?.scrollIntoView({ block: 'start' }) }).catch(() => {})
  await sleep(1200)

  /* ─────────── ① 规格区容器结构 ─────────── */
  report.page = {
    ...report.page,
    ...(await p.evaluate(() => {
      const box = document.querySelector('#goods-spec-sku')
      const kids = [...box.children].map((c, i) => ({
        i, tag: c.tagName, id: c.id || '', cls: c.className || '',
        childCount: c.children.length,
        textHead: (c.innerText || '').replace(/\s+/g, ' ').slice(0, 60),
      }))
      const all = [...box.querySelectorAll('*')]
      const classCounter = {}
      for (const el of all) {
        const cn = typeof el.className === 'string' ? el.className : ''
        for (const c of cn.split(/\s+/).filter(Boolean)) classCounter[c] = (classCounter[c] || 0) + 1
      }
      const topClasses = Object.entries(classCounter).sort((a, b) => b[1] - a[1]).slice(0, 60)
      return {
        hasGoodsSpecSku: true,
        hasNewSpec: !!document.querySelector('#newSpec'),
        propertyContainerV2Count: box.querySelectorAll('.property-container-v2').length,
        goodsSpecRowCount: box.querySelectorAll('.goods-spec-row').length,
        directChildren: kids,
        topClasses,
        specRootText: (box.innerText || '').replace(/\s+/g, ' | ').slice(0, 1500),
        specRootRect: (() => { const r = box.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
      }
    })),
  }

  /* ─────────── ② 逐行 dump ─────────── */
  report.containers = await p.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    const rows = [...box.querySelectorAll('.property-container-v2, .goods-spec-row')]
    const vis = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), visible: r.width > 0 && r.height > 0 } }
    return rows.map((c, idx) => {
      const inputs = [...c.querySelectorAll('input')].map(inp => {
        const v = vis(inp)
        return {
          ph: inp.placeholder || '(无)', type: inp.type || 'text', value: (inp.value || '').slice(0, 30),
          ...v, cls: inp.className || '', name: inp.name || '', readonly: !!inp.readOnly, disabled: !!inp.disabled,
          parentCls: inp.parentElement?.className || '',
        }
      }).filter(x => x.visible || x.ph !== '(无)')

      // 标题候选：逐个探测
      const probe = sel => {
        const el = c.querySelector(sel)
        return el ? { sel, tag: el.tagName, cls: el.className || '', text: (el.textContent || '').trim().slice(0, 40) } : null
      }
      const titleCandidates = {
        propertyNameTitle: probe('.property-name-title'),
        goodsSpecTitle: probe('.goods-spec-title'),
        titleAny: probe('[class*="title"]'),
        label: probe('label'),
        firstSpan: probe(':scope > span'),
        legend: probe('legend'),
        dataTitle: (() => { const el = c.querySelector('[data-title]'); return el ? { sel: '[data-title]', text: el.getAttribute('data-title') } : null })(),
      }
      // 行首纯文本（去掉 input 值的影响不好做，取 innerText 前 40 字）
      const textNodes = []
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const s = (n.nodeValue || '').replace(/\s+/g, ' ').trim()
        if (!s) continue
        const host = n.parentElement
        if (!host || host.tagName === 'INPUT' || host.tagName === 'TEXTAREA') continue
        const r = host.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        textNodes.push({ text: s.slice(0, 40), tag: host.tagName, cls: host.className || '', y: Math.round(r.y), x: Math.round(r.x) })
        if (textNodes.length >= 12) break
      }

      const checkboxes = [...c.querySelectorAll('.package-item-container')]
      const cbInfo = checkboxes.map(el => ({
        cls: el.className || '',
        text: (el.querySelector('.check-wrapper')?.textContent || el.textContent || '').trim().slice(0, 12),
        checked: el.classList.contains('checked') || !!el.querySelector('.check-wrapper.checked') || !!el.querySelector('input[type=checkbox]:checked'),
      }))

      // 行内可点元素文本
      const btns = [...c.querySelectorAll('button, a, span, div, i')]
        .map(e => {
          const t = (e.innerText || '').trim()
          if (!t || t.length > 24 || t.includes('\n')) return null
          const r = e.getBoundingClientRect()
          if (r.width < 10 || r.height < 8) return null
          return { tag: e.tagName, text: t, cls: (e.className || '').slice(0, 60) }
        })
        .filter(Boolean)
      const btnTexts = [...new Set(btns.map(b => b.text))].slice(0, 20)

      const r = vis(c)
      return {
        idx: idx + 1,
        tag: c.tagName,
        cls: c.className || '',
        id: c.id || '',
        outerTag: c.outerHTML.slice(0, 260),
        rect: r,
        titleCandidates,
        textNodes,
        inputs,
        checkboxCount: checkboxes.length,
        checkboxSample: cbInfo.slice(0, 6),
        checkboxValueSpan: (() => {
          // 48..175 数字网格：看数字挂在哪个元素
          const nums = [...c.querySelectorAll('*')].filter(el => /^\d{2,3}$/.test((el.textContent || '').trim()) && el.children.length === 0)
          return nums.slice(0, 4).map(el => ({ tag: el.tagName, cls: (el.className || '').slice(0, 50), text: el.textContent.trim(), parentCls: (el.parentElement?.className || '').slice(0, 50) }))
        })(),
        buttons: btnTexts,
        innerTextHead: (c.innerText || '').replace(/\s+/g, ' | ').slice(0, 260),
      }
    })
  })

  /* ─────────── ③ 标题元素专项探针（全页扫，看这几个 class 到底命中什么） ─────────── */
  report.titleProbes = await p.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    const sels = ['.property-name-title', '[class*="sizeStandardWrapper_title"]', '[class*="property-name"]', '[class*="propertyName"]', '.goods-spec-title', '[class*="spec-title"]']
    return sels.map(sel => ({
      sel,
      count: box.querySelectorAll(sel).length,
      samples: [...box.querySelectorAll(sel)].slice(0, 6).map(el => ({
        tag: el.tagName, cls: (el.className || '').slice(0, 80), text: (el.textContent || '').trim().slice(0, 30),
        parentCls: (el.parentElement?.className || '').slice(0, 60),
      })),
    }))
  })

  /* ─────────── ④ 「添加规格类型」按钮全页探针（含隐藏/视口外） ─────────── */
  report.addSpecButtonProbe = await p.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, '')
    const cands = [...document.querySelectorAll('button, a, span, div, p, li')].filter(e => {
      const t = norm(e.innerText)
      return t && t.length <= 24 && /添加规格|添加自定义规格|新增规格|添加规格类型|创建规格/.test(t)
    })
    const mapped = cands.map(e => {
      const r = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      return {
        tag: e.tagName, text: norm(e.innerText), cls: (e.className || '').slice(0, 80),
        w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        inSpecRoot: !!e.closest('#goods-spec-sku'), inNewSpec: !!e.closest('#newSpec'),
        disabled: e.getAttribute('aria-disabled') || e.getAttribute('disabled') || '',
      }
    })
    // 去重（父子重复）
    const uniq = []
    for (const m of mapped) {
      if (!uniq.some(u => u.text === m.text && Math.abs(u.y - m.y) < 2 && u.tag === m.tag)) uniq.push(m)
    }
    return {
      exactAddSpecType: uniq.filter(m => m.text === '添加规格类型'),
      anyAddSpec: uniq.slice(0, 20),
      totalCandidates: cands.length,
      specRootHasOnlyPresetRows: document.querySelectorAll('#goods-spec-sku .property-container-v2').length,
    }
  })

  /* ─────────── ⑤ #newSpec 结构（自定义输入框 + checkbox） ─────────── */
  report.newSpec = await p.evaluate(() => {
    const root = document.querySelector('#newSpec')
    if (!root) return { exists: false }
    const inputs = [...root.querySelectorAll('input')].map(i => {
      const r = i.getBoundingClientRect()
      return { ph: i.placeholder || '(无)', value: (i.value || '').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), cls: (i.className || '').slice(0, 60) }
    })
    return {
      exists: true,
      outerTag: root.outerHTML.slice(0, 200),
      inputCount: inputs.length,
      inputs: inputs.slice(0, 15),
      checkboxCount: root.querySelectorAll('.package-item-container').length,
      innerTextHead: (root.innerText || '').replace(/\s+/g, ' | ').slice(0, 500),
    }
  })

  /* ─────────── ⑥ SKU 表结构（行数 / 表头 / 每行预览图与编码列） ─────────── */
  report.skuTable = await p.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, '')
    // 找 SKU 表：含「规格编码」表头 的表格
    const tables = [...document.querySelectorAll('table')]
    const t = tables.find(tb => /规格编码/.test(tb.innerText || ''))
    const info = { tableFound: !!t, tableCount: tables.length }
    if (!t) {
      // 兜底：找 .goods-sku-table / [class*=sku] 里带行的
      const alt = document.querySelector('[class*="sku-table"], [class*="skuTable"]')
      info.altFound = !!alt
      info.altText = (alt?.innerText || '').replace(/\s+/g, ' | ').slice(0, 400)
      return info
    }
    const headText = norm(t.querySelector('thead')?.innerText || '')
    const bodyRows = [...t.querySelectorAll('tbody tr')]
    info.tableClass = (t.className || '').slice(0, 80)
    info.headText = headText.slice(0, 200)
    info.rowCount = bodyRows.length
    info.rows = bodyRows.slice(0, 14).map((tr, i) => {
      const tds = [...tr.querySelectorAll('td')]
      return {
        i: i + 1,
        tdCount: tds.length,
        text: norm(tr.innerText).slice(0, 120),
        hasThumb: !!tr.querySelector('img, [class*="thumb"], [class*="preview"]'),
        inputCount: tr.querySelectorAll('input').length,
        placeholderList: [...new Set([...tr.querySelectorAll('input')].map(x => x.placeholder || '(无)'))].slice(0, 6),
      }
    })
    return info
  })

  /* ─────────── ⑦ 规格区 HTML 摘录（便于离线比对 class 名） ─────────── */
  report.htmlExcerpt = await p.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    return box ? box.outerHTML.slice(0, 60000) : ''
  })

  // 截图（只读）
  const el = await p.$('#goods-spec-sku')
  if (el) {
    await el.screenshot({ path: path.join(SHOT_DIR, 'preset-dim-dom-spec-area.png') }).catch(e => report.errors.push('spec screenshot: ' + e.message))
  }
  await p.screenshot({ path: path.join(SHOT_DIR, 'preset-dim-dom-full.png') }).catch(e => report.errors.push('full screenshot: ' + e.message))
  step('dump 完成', { containers: report.containers.length })
} catch (e) {
  report.errors.push(String(e && e.stack || e))
  step('ERROR ' + String(e && e.message || e))
} finally {
  try { if (browser) await browser.close() } catch { /* ignore */ }
  report.meta.finishedAt = new Date().toISOString()
  report.meta.durationSec = Math.round((Date.now() - t0) / 1000)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log('written: ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)')
}
