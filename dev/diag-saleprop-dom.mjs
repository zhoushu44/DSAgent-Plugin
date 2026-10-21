/** 看直达发布页里「销售属性」区的真实 DOM（含操作入口） */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')
const { buildTaobaoJsonDocument, buildTaobaoJsonReplayInitScript } = await import('../lib/taobao-publish-replay.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const main = await localImagesToSpaceUrls([join(SRC, 'main_06.jpg')], { cookies: acc.cookies || {} })

const doc = buildTaobaoJsonDocument({
  title: '销售属性结构探测', price: '59.9', stock: '100', images: [],
  skus: [{ name: '格蕾灰', price: '59.9', stock: '50' }, { name: '奶油黄', price: '59.9', stock: '50' }],
  imageUrls: main.urls, detailImageUrls: [],
})
const b = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const p = (await b.pages())[0]
await p.evaluateOnNewDocument(buildTaobaoJsonReplayInitScript(JSON.stringify(doc)))
await p.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([n, v]) => [{ name: n, value: String(v), domain: '.taobao.com', path: '/' }]))
await p.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await p.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => 0)) break }
await sleep(4000)

const r = await p.evaluate(() => {
  const out = {}
  const sp = document.getElementById('struct-saleProp')
  out.salePropPresent = !!sp
  if (sp) {
    out.text = (sp.innerText || '').replace(/\s+/g, ' ').slice(0, 300)
    out.inputs = Array.from(sp.querySelectorAll('input')).map((i) => ({
      ph: i.placeholder, val: i.value, cls: String(i.className).slice(0, 40), vis: !!i.offsetParent,
    }))
    out.buttons = Array.from(sp.querySelectorAll('button, [class*="btn"], [class*="add"]'))
      .map((e) => ({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 20), cls: String(e.className).slice(0, 40), vis: !!e.offsetParent }))
      .filter((x) => x.text)
    out.innerIds = Array.from(sp.querySelectorAll('[id]')).map((e) => e.id).slice(0, 20)
  }
  const sku = document.getElementById('struct-sku')
  out.skuPresent = !!sku
  out.skuVisible = sku ? !!sku.offsetParent : false
  if (sku) out.skuText = (sku.innerText || '').replace(/\s+/g, ' ').slice(0, 200)
  // 全页找「创建规格」「添加规格」「销售属性」
  const hints = []
  for (const e of Array.from(document.querySelectorAll('*'))) {
    if (e.children.length > 1) continue
    const t = (e.innerText || '').trim()
    if (/创建规格|添加规格|添加销售属性|自定义规格|销售属性/.test(t) && t.length < 20 && e.offsetParent) {
      hints.push({ tag: e.tagName, text: t, cls: String(e.className).slice(0, 50) })
    }
  }
  out.hints = hints.slice(0, 10)
  return out
})
console.log(JSON.stringify(r, null, 1))
await sleep(8000)
await b.close()
