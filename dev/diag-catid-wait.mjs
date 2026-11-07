/**
 * 只读探针：catId 直达页为什么停在空壳（加载遮罩不消失 / 类目未绑定）
 * 只读：不点击、不填表。
 * 记录 console、失败请求、类目/规格相关 API 响应摘要、页面 toast。
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')
const SHOP_KEY = process.env.PDD_SHOP_KEY || 'pdd_mms_d105b9eff40aa53674b4da4091f76a4a'
const PROFILE = `C:/Users/Administrator/.dsh/browser-profiles/accounts/${SHOP_KEY}`
const CAT = process.env.PDD_CAT || '205133764345'
const URL = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${CAT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) { try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {} }
const out = { shopKey: SHOP_KEY, catId: CAT, url: URL, console: [], failed: [], apis: [], toast: '', catBlock: '', loading: [] }
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
  p.on('console', m => { if (out.console.length < 60) out.console.push({ type: m.type(), text: m.text().slice(0, 300) }) })
  p.on('requestfailed', r => { if (out.failed.length < 40) out.failed.push({ url: r.url().slice(0, 180), err: r.failure()?.errorText }) })
  p.on('response', async res => {
    const u = res.url()
    if (!/janus|api|goods|category|spec|property/i.test(u)) return
    if (!/(cat|spec|property|goods_add|goods\/(category|template)|queryGoods)/i.test(u)) return
    if (out.apis.length >= 40) return
    let body = ''
    try { body = (await res.text()).slice(0, 1200) } catch {}
    out.apis.push({ status: res.status(), url: u.slice(0, 220), bodyHead: body })
  })

  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  for (let i = 0; i < 8; i++) {
    await sleep(5000)
    const s = await p.evaluate(() => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim()
      const masks = [...document.querySelectorAll('[class*="loading"],[class*="spin"],[class*="mask"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 100 && getComputedStyle(e).display !== 'none' })
      return {
        t: Date.now(),
        catBlock: norm(document.querySelector('#goods-category, .goods-category')?.innerText || ''),
        pc: document.querySelectorAll('#goods-spec-sku .property-container-v2').length,
        masks: masks.map(m => ({ cls: (m.className || '').slice(0, 60), text: norm(m.innerText).slice(0, 60) })),
        toasts: [...document.querySelectorAll('[class*="toast"],[class*="Toast"],[class*="message"],[class*="Message"],[class*="notification"]')].map(e => norm(e.innerText)).filter(t => t && t.length < 120).slice(0, 6),
        titleInput: !!document.querySelector('input[placeholder*="商品标题组成"]'),
        specText: norm(document.querySelector('#goods-spec-sku')?.innerText || '').slice(0, 160),
      }
    }).catch(e => ({ err: e.message }))
    out.loading.push({ at: i * 5 + 5, ...s })
    console.log(`t+${i * 5 + 5}s pc=${s.pc} titleInput=${s.titleInput} catBlock="${s.catBlock}" toasts=${JSON.stringify(s.toasts)} masks=${(s.masks || []).length}`)
    if (s.pc > 0) break
  }
  out.toast = JSON.stringify(out.loading[out.loading.length - 1]?.toasts || [])
  out.catBlock = out.loading[out.loading.length - 1]?.catBlock || ''
  await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-catid-wait.png' }).catch(() => {})
} catch (e) { out.errors = [String(e?.stack || e)] }
finally {
  try { if (browser) await browser.close() } catch {}
  fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-catid-wait.json', JSON.stringify(out, null, 2), 'utf8')
  console.log('written preset-dim-catid-wait.json')
}
