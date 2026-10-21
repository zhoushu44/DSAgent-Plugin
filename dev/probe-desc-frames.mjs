/**
 * 列出发布页所有 iframe / frame，并统计每个 frame 里的 img 与 desc 相关容器。
 * 目的：确认详情编辑器是否在独立 iframe 内（影响验收选择器与注入方式）。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const dir = profileDir('taobao', account)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
const ck = Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ]))
await page.setCookie(...ck)
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

const frames = page.frames()
console.log('frame 总数', frames.length)
for (const [i, f] of frames.entries()) {
  let info = { url: f.url().slice(0, 150) }
  try {
    info = await f.evaluate(() => ({
      url: location.href.slice(0, 150),
      imgs: document.querySelectorAll('img').length,
      liteEditor: !!document.querySelector('#lite-decoration-editor'),
      descNode: !!document.querySelector('[id*="desc"], [class*="desc"]'),
      textSample: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    }))
  } catch (e) { info.err = e.message.slice(0, 80) }
  console.log(`[${i}]`, JSON.stringify(info))
}

// 主 frame 里 desc 区 DOM 概览
const descDom = await page.evaluate(() => {
  const out = []
  for (const sel of ['#lite-decoration-editor', '#struct-descRepublicOfSell', '#struct-desc', '[id*="descRepublic"]', 'iframe']) {
    const els = Array.from(document.querySelectorAll(sel))
    out.push({ sel, n: els.length, samples: els.slice(0, 2).map((e) => ({ tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 70), src: e.getAttribute?.('src')?.slice(0, 100) })) })
  }
  return out
})
console.log('\n=== desc 相关选择器 ===')
console.log(JSON.stringify(descDom, null, 1))

console.log('\n窗口保持 10s')
await sleep(10000)
await browser.close()
