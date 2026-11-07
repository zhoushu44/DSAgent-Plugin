/**
 * 只读探针：确认 catId=205133764345 表单页是否真的绑定了类目
 * 检查：商品分类区文本 / 是否出现「请选择类目」 / 页面是否含 205133764345 / 规格区骨架
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
const out = { shopKey: SHOP_KEY, probes: [], errors: [] }
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
  const resp = await p.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(e => ({ err: e.message }))
  out.navStatus = resp && resp.status ? resp.status() : String(resp?.err || '?')
  await sleep(8000)
  out.probe = await p.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    const txt = norm(document.body.innerText)
    const catBlock = document.querySelector('[class*="goods-category"], [class*="category-select"], [class*="cat-select"]')
    const firstForm = document.querySelector('.goods-container')
    const rows = [...document.querySelectorAll('#goods-spec-sku .property-container-v2, #goods-spec-sku .goods-spec-row')]
    // 找所有含「类目」的可见块
    const catCands = [...document.querySelectorAll('div,span')]
      .filter(e => e.children.length === 0 && /类目|分类/.test(norm(e.innerText)) && norm(e.innerText).length < 40)
      .slice(0, 8).map(e => ({ text: norm(e.innerText), cls: (e.className || '').slice(0, 50) }))
    return {
      url: location.href,
      hasCatText: txt.includes('儿童睡衣'),
      catTextOccurrences: (txt.match(/儿童睡衣/g) || []).length,
      catIdOnPage: txt.includes('205133764345'),
      needPickCategory: /请选择(商品)?类目|选择类目|请先选择类目/.test(txt),
      catCands,
      catBlockText: catBlock ? norm(catBlock.innerText).slice(0, 200) : '',
      firstFormHead: firstForm ? norm(firstForm.innerText).slice(0, 260) : '',
      rowCount: rows.length,
      rowwise: rows.map(r => ({ cls: (r.className || '').slice(0, 60), text: norm(r.innerText).slice(0, 80) })),
      specButtons: [...document.querySelectorAll('#goods-spec-sku button')].map(b => norm(b.innerText)).slice(0, 10),
      // 「商品分类」这一块的 DOM 结构
      catSectionHtml: (() => {
        const el = [...document.querySelectorAll('*')].find(e => norm(e.innerText).startsWith('商品分类') && e.children.length > 0 && norm(e.innerText).length < 200)
        return el ? el.outerHTML.slice(0, 1200) : ''
      })(),
    }
  })
  await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-cat-probe.png', fullPage: false }).catch(() => {})
} catch (e) { out.errors.push(String(e?.stack || e)) }
finally {
  try { if (browser) await browser.close() } catch {}
  fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-cat-probe.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out, null, 2).slice(0, 4000))
}
