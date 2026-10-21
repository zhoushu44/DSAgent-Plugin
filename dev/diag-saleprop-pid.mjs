/** 读销售属性区的真实 pid + 每个维度的可选值 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const b = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--window-size=1440,950'], defaultViewport: null,
})
const p = (await b.pages())[0]
await p.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([n, v]) => [{ name: n, value: String(v), domain: '.taobao.com', path: '/' }]))
await p.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await p.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => 0)) break }
await sleep(4000)

const r = await p.evaluate(() => {
  const out = { structIds: [], inputs: [], labels: [] }
  const box = document.getElementById('struct-saleProp')
  if (!box) return { err: 'no saleProp' }
  // 所有 struct-p-* id
  out.structIds = Array.from(box.querySelectorAll('[id^="struct-p-"]')).map((e) => e.id)
  // 每个 input 及其所属 struct-p-
  for (const inp of Array.from(box.querySelectorAll('input'))) {
    if (inp.offsetParent === null) continue
    let el = inp, pid = ''
    for (let i = 0; i < 10 && el; i++) {
      const m = (el.id || '').match(/^struct-(p-\d+)$/)
      if (m) { pid = m[1]; break }
      el = el.parentElement
    }
    out.inputs.push({ ph: inp.placeholder || '', pid, type: inp.type, cls: String(inp.className).slice(0, 40) })
  }
  // 标签文本（维度名）
  out.labels = Array.from(box.querySelectorAll('.info-content, label, .sell-common-sale-props-label'))
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12)
  // 自定义销售属性区
  const csp = box.querySelector('[class*="custom"]')
  out.hasCustomSection = !!csp
  return out
})
console.log(JSON.stringify(r, null, 1))
await b.close()
