/**
 * 只读探针：catId 直达页 全量网络请求日志（不过滤），看表单初始化接口是否被调用/被拒。
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
const out = { shopKey: SHOP_KEY, catId: CAT, requests: [], responses: [], errors: [] }
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
  p.on('request', r => {
    const u = r.url()
    if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ttf|ico)/.test(u)) return
    if (out.requests.length < 200) out.requests.push({ method: r.method(), type: r.resourceType(), url: u.slice(0, 240) })
  })
  p.on('response', async res => {
    const u = res.url()
    if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ttf|ico)/.test(u)) return
    if (out.responses.length >= 120) return
    let body = ''
    try { body = (await res.text()).slice(0, 700) } catch {}
    out.responses.push({ status: res.status(), url: u.slice(0, 240), bodyHead: (body || '').replace(/\s+/g, ' ').slice(0, 700) })
  })
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(e => out.errors.push('goto: ' + e.message))
  await sleep(15000)
  // 页面里是否记录了 react state / window 变量
  out.windowProbe = await p.evaluate(() => {
    const keys = Object.keys(window).filter(k => /goods|cat|spec|form/i.test(k)).slice(0, 40)
    return { keys, hash: location.hash, href: location.href }
  }).catch(e => ({ err: e.message }))
  out.domState = await p.evaluate(() => {
    const norm = t => (t || '').replace(/\s+/g, ' ').trim()
    const q = s => document.querySelector(s)
    return {
      titleInputPh: q('input[placeholder*="商品标题组成"]')?.placeholder || '',
      catArea: norm(q('#goods-category')?.outerHTML || '').slice(0, 900),
      specArea: norm(q('#goods-spec-sku')?.outerHTML || '').slice(0, 900),
      bodyHasError: /权限|无权限|错误|失败|不可用|暂不支持/.test(norm(document.body.innerText)),
      bodyTail: norm(document.body.innerText).slice(-800),
    }
  }).catch(e => ({ err: e.message }))
} catch (e) { out.errors.push(String(e?.stack || e)) }
finally {
  try { if (browser) await browser.close() } catch {}
  fs.writeFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/preset-dim-catid-net.json', JSON.stringify(out, null, 2), 'utf8')
  console.log('requests=' + out.requests.length + ' responses=' + out.responses.length)
}
