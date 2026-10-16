/**
 * 挖竞品类目名：保存完整详情接口响应，搜索其中的中文类目名称，
 * 并把 categoryId / channelCatId 映射成人类可读的类目。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const IDS = ['1052961253244', '1076162957423', '990439309590', '1050781473609']
const CAT_IDS = new Set(['50023914', '201453616', '201459411', '201461105', '202038701'])

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
  { name, value: String(value), domain: '.goofish.com', path: '/' },
  { name, value: String(value), domain: '.taobao.com', path: '/' },
])))

const store2 = []
for (const id of IDS) {
  const caps = []
  const onResp = async (res) => {
    const u = res.url()
    if (/mtop|api/i.test(u)) {
      try {
        const txt = await res.text()
        if (txt && txt.length > 500 && /categor|类目|category/i.test(txt)) {
          caps.push({ url: u.slice(0, 200), body: txt })
        }
      } catch {}
    }
  }
  page.on('response', onResp)
  await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(8000)
  page.off('response', onResp)

  // 在响应里找类目名：找包含类目 ID 附近的字段，以及所有 "xxName"/"xxname" 字段
  const found = {}
  for (const c of caps) {
    // 直接搜类目 id 上下文
    for (const cid of CAT_IDS) {
      let idx = 0
      while ((idx = c.body.indexOf(cid, idx)) !== -1) {
        const ctx = c.body.slice(Math.max(0, idx - 260), idx + 260)
        if (!found[cid]) found[cid] = []
        found[cid].push(ctx)
        idx += cid.length
        if (found[cid].length > 4) break
      }
    }
    // 搜类目名类字段
    for (const m of c.body.matchAll(/"(cat\w*Name|categor\w*Name|categoryName|channelCatName|catName)"\s*:\s*"([^"]{1,40})"/gi)) {
      if (!found._names) found._names = new Set()
      found._names.add(`${m[1]}=${m[2]}`)
    }
  }
  store2.push({ id, urls: caps.map(c => c.url), found: {
    ...Object.fromEntries(Object.entries(found).filter(([k]) => k !== '_names').map(([k, v]) => [k, v.slice(0, 2)])),
    names: found._names ? [...found._names] : [],
  } })
  console.log(`\n=== ${id} ===`)
  console.log('names:', JSON.stringify(found._names ? [...found._names] : []))
  for (const cid of CAT_IDS) {
    if (found[cid]) {
      const ctx = found[cid][0]
      const nm = ctx.match(/"(\w*[Nn]ame\w*)"\s*:\s*"([^"]{1,40})"/g)
      console.log(`  ${cid} 上下文名:`, JSON.stringify(nm ? nm.slice(0, 6) : []))
    }
  }
}

writeFileSync(`${OUT}/xianyu-cat-names.json`, JSON.stringify(store2, null, 2), 'utf-8')
console.log('\n已保存')
await browser.close()
