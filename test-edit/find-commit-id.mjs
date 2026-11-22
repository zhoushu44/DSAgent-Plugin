/**
 * test-edit/find-commit-id.mjs — 从商品列表 DOM 抓 goods_commit_id
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)
const { launchStealth } = await import(pathToFileURL(P + '/skills/_shared/pdd-launch.mjs').href)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[F]', ...a)

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]

const { browser, page } = await launchStealth(acc.shop_key, puppeteer)
const p = page
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(8000)
log('页面:', p.url().slice(0, 70))

// 1) 抓列表里所有链接和按钮
const info = await p.evaluate(() => {
  const out = { rows: [], links: [], buttons: [], dataAttrs: [] }
  // 商品行
  for (const tr of document.querySelectorAll('tr')) {
    const t = (tr.innerText || '').replace(/\s+/g, ' ')
    if (!/ID:\s*\d+/.test(t)) continue
    const gidM = t.match(/ID:\s*(\d+)/)
    const links = [...tr.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().slice(0, 10) })).filter(x => x.href)
    const btns = [...tr.querySelectorAll('button')].map(b => ({ text: (b.innerText || '').replace(/\s+/g, ''), id: b.id || '', cls: (b.className || '').slice(0, 30) })).slice(0, 8)
    // data 属性
    const attrs = []
    for (const el of [tr, ...tr.querySelectorAll('*')]) {
      for (const a of el.attributes || []) {
        if (/data-/.test(a.name) && /id|commit|goods/i.test(a.value)) attrs.push({ name: a.name, value: a.value.slice(0, 60) })
      }
    }
    out.rows.push({ goodsId: gidM ? gidM[1] : '', text: t.slice(0, 90), links, btns, attrs: attrs.slice(0, 5) })
    if (out.rows.length >= 3) break
  }
  // 全页所有含 commit 的属性
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes || []) {
      if (/commit/i.test(a.value || '')) out.dataAttrs.push({ tag: el.tagName, name: a.name, value: a.value.slice(0, 70) })
    }
  }
  out.dataAttrs = out.dataAttrs.slice(0, 15)
  return out
})

log('\n=== 商品行 ===')
for (const r of info.rows) {
  log(`goodsId=${r.goodsId}`)
  log('  文本:', r.text.slice(0, 70))
  log('  链接:', JSON.stringify(r.links))
  log('  按钮:', JSON.stringify(r.btns))
  log('  data-*:', JSON.stringify(r.attrs))
}
log('\n=== 全页含 commit 的属性 ===')
for (const a of info.dataAttrs) log(`  <${a.tag} ${a.name}="${a.value}">`)

fs.writeFileSync(path.join(P, 'artifacts', 'list-dom.json'), JSON.stringify(info, null, 2), 'utf8')
log('\n→ artifacts/list-dom.json')
process.exit(0)
