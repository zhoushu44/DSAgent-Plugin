/**
 * 只读诊断（增量版）：等页面异步渲染到位，按时间点快照规格区结构
 * 目的：确认「预置 3 个维度行」是否只是渲染更晚；以及「添加规格类型」按钮的完整文本形态。
 * 全程只读。
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP_KEY = process.env.PDD_SHOP_KEY || 'pdd_mms_d105b9eff40aa53674b4da4091f76a4a'
const PROFILE = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${SHOP_KEY}`
const URL = 'https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205133764345'
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) { try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {} }

const out = { shopKey: SHOP_KEY, url: URL, timeline: [], snapshots: [], addBtnTexts: [], catInfo: '', errors: [] }
let browser
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: PROFILE, defaultViewport: null,
    args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized','--window-size=1600,1000'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
  })
  const p = await (await browser.pages())[0] || await browser.newPage()
  await p.setViewport({ width: 1600, height: 1000 })
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const snap = async (label) => {
    const s = await p.evaluate(() => {
      const box = document.querySelector('#goods-spec-sku')
      const norm = t => (t || '').replace(/\s+/g, ' ').trim()
      const btnTexts = [...document.querySelectorAll('#goods-spec-sku button')].map(b => ({ text: norm(b.innerText), cls: (b.className || '').slice(0, 60) })).slice(0, 12)
      const rows = box ? [...box.querySelectorAll('.property-container-v2, .goods-spec-row')] : []
      return {
        url: location.href,
        hasSpecRoot: !!box,
        pcCount: box ? box.querySelectorAll('.property-container-v2').length : 0,
        rowCount: rows.length,
        specText: box ? norm(box.innerText).slice(0, 220) : '',
        btnTexts,
        // 类目面包屑 / 标题
        crumb: norm(document.querySelector('[class*="crumb"], [class*="category-path"], [class*="catPath"]')?.innerText || '').slice(0, 160),
        pageTitle: document.title,
        loadingMask: !!document.querySelector('[class*="loading"], [class*="spin"]'),
      }
    }).catch(e => ({ err: String(e.message) }))
    out.snapshots.push({ at: Date.now(), label, ...s })
    console.log(`[${label}] pc=${s.pcCount} rows=${s.rowCount} btns=${JSON.stringify((s.btnTexts||[]).map(b=>b.text).slice(0,6))}`)
  }

  await sleep(2000); await snap('t+2s')
  await sleep(4000); await snap('t+6s')
  await sleep(6000); await snap('t+12s')
  await sleep(8000); await snap('t+20s')
  await sleep(10000); await snap('t+30s')

  // 全页 scan 添加规格类型按钮（含所有文本变体）
  out.addBtnTexts = await p.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, '')
    return [...document.querySelectorAll('button, [role="button"], a, div, span')]
      .filter(e => norm(e.innerText).includes('添加规格'))
      .map(e => {
        const r = e.getBoundingClientRect()
        return { tag: e.tagName, text: norm(e.innerText).slice(0, 30), cls: (e.className || '').slice(0, 70), w: Math.round(r.width), h: Math.round(r.height), disabled: e.disabled ?? '', aria: e.getAttribute('aria-disabled') || '' }
      })
      .filter(x => x.w > 4)
      .slice(0, 20)
  })

  out.catInfo = await p.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    const txt = norm(document.body.innerText)
    const m = txt.match(/类目[：:]\s*([^\n|]{2,60})/)
    const sel = [...document.querySelectorAll('[class*="cat"], [class*="category"]')].map(e => norm(e.innerText)).filter(t => t && t.length < 80).slice(0, 10)
    return { matched: m ? m[1] : '', candidates: sel }
  }).catch(e => ({ err: String(e.message) }))

  await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-timeline.png' }).catch(() => {})
} catch (e) {
  out.errors.push(String(e && e.stack || e))
} finally {
  try { if (browser) await browser.close() } catch {}
  fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-timeline.json', JSON.stringify(out, null, 2), 'utf8')
  console.log('written preset-dim-timeline.json')
}
