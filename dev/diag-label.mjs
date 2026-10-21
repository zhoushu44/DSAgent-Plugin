/** 核对 struct-p-* 下 label 的真实选择器命中情况 */
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
await sleep(3000)

const r = await p.evaluate(() => {
  const root = document.getElementById('struct-catProp')
  if (!root) return { err: 'no root' }
  const items = Array.from(root.querySelectorAll('[id^="struct-p-"]'))
  const sample = items.slice(0, 4).map((it) => {
    const box = it.closest('.sell-catProp-item-common, .sell-catProp-item') || it
    const label = box.querySelector('label.label, label')
    return {
      id: it.id,
      boxCls: String(box.className).slice(0, 70),
      isSelf: box === it,
      labelFound: !!label,
      labelText: label ? (label.innerText || '').slice(0, 10) : null,
      labelCls: label ? String(label.className).slice(0, 40) : null,
      requiredByCls: !!box.querySelector('label.required'),
      child0: it.children[0] ? `${it.children[0].tagName}.${String(it.children[0].className).slice(0, 30)}` : null,
    }
  })
  // 再统计：全页 label.required 有多少个、分别叫什么
  const reqLabels = Array.from(document.querySelectorAll('label.required'))
    .map((e) => (e.innerText || '').trim()).filter(Boolean)
  return { count: items.length, sample, reqLabels }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
