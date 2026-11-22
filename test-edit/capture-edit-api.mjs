/**
 * test-edit/capture-edit-api.mjs — 抓编辑页真实发出的接口 + body
 *
 * 打开编辑页，监听所有 XHR/fetch，记录 URL / method / body / 响应
 * 重点抓 goodsCommit/action/edit 的 157 字段提交体
 *
 * 用法: node test-edit/capture-edit-api.mjs <goodsId>
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
const log = (...a) => console.log('[CAP]', ...a)
const goodsId = process.argv[2] || '1005128989491'

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]

const { browser, page } = await launchStealth(acc.shop_key, puppeteer)
const p = page
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(6000)
log('页面:', p.url().slice(0, 70))

const captured = []

// ★ 监听所有请求
p.on('request', (req) => {
  const u = req.url()
  if (!/mms\.pinduoduo\.com/.test(u)) return
  if (!/glide|vodka|draco|earth/.test(u)) return
  const pd = req.postData()
  // 只记录可能相关的
  if (!/commit|edit|goods|sku|template/i.test(u)) return
  captured.push({
    url: u.replace('https://mms.pinduoduo.com', ''),
    method: req.method(),
    bodyLen: pd ? pd.length : 0,
    body: pd && pd.length < 200000 ? pd : null,
    ts: Date.now(),
  })
})

// 打开编辑页（点击方式）
log('点击商品行的编辑按钮…')
const clicked = await p.evaluate((gid) => {
  const t = e => (e.innerText || '').replace(/\s+/g, ' ').trim()
  for (const tr of document.querySelectorAll('tr')) {
    if (!t(tr).includes(gid)) continue
    const btns = [...tr.querySelectorAll('a,button,span,div')].filter(e => /^编辑$/.test(t(e)) && e.getBoundingClientRect().width > 10)
    if (btns.length) { btns[0].scrollIntoView({ block: 'center' }); btns[0].click(); return true }
  }
  return false
}, goodsId)
log('点击:', clicked)

// 等编辑页
await sleep(12000)
const pages = await browser.pages()
const editPage = pages.find(x => /goods_add\/index/.test(x.url()))
if (!editPage) { log('❌ 没进编辑页'); process.exit(1) }
log('编辑页:', editPage.url())

// 编辑页也要监听
editPage.on('request', (req) => {
  const u = req.url()
  if (!/mms\.pinduoduo\.com/.test(u)) return
  const pd = req.postData()
  if (!/commit|edit|goods|sku|template/i.test(u)) return
  captured.push({
    url: u.replace('https://mms.pinduoduo.com', ''),
    method: req.method(),
    bodyLen: pd ? pd.length : 0,
    body: pd && pd.length < 300000 ? pd : null,
    ts: Date.now(),
  })
})

await editPage.bringToFront()
await sleep(15000)

// ── 触发一次「保存草稿」或「提交」，看它发什么 ──
// 先看页面有哪些按钮
const btns = await editPage.evaluate(() => {
  return [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 30).map(b => ({
    text: (b.innerText || '').replace(/\s+/g, '').slice(0, 20),
    id: b.id || '',
    disabled: b.disabled,
    cls: (b.className || '').slice(0, 40),
  }))
})
log('\n页面按钮:')
for (const b of btns) log(`  #${b.id} "${b.text}" disabled=${b.disabled}`)

log('\n=== 捕获的接口 (' + captured.length + ') ===')
const seen = new Map()
for (const c of captured) {
  const k = c.method + ' ' + c.url.split('?')[0]
  if (!seen.has(k)) seen.set(k, [])
  seen.get(k).push(c)
}
for (const [k, arr] of seen) {
  const c = arr[0]
  log(`${k}  ×${arr.length}  bodyLen=${c.bodyLen}`)
}

// 保存完整抓包
fs.writeFileSync(path.join(P, 'artifacts', 'captured-edit-api.json'), JSON.stringify(captured, null, 2), 'utf8')
log('\n→ artifacts/captured-edit-api.json')

// ★ 如果抓到 action/edit，单独存 body 模板
const editReqs = captured.filter(c => /goodsCommit\/action\/edit/.test(c.url))
if (editReqs.length && editReqs[0].body) {
  const bodyObj = JSON.parse(editReqs[0].body)
  fs.writeFileSync(path.join(P, 'artifacts', 'action-edit-body.json'), JSON.stringify(bodyObj, null, 2), 'utf8')
  log('\n★★ 抓到 action/edit 的 body！字段数:', Object.keys(bodyObj).length)
  log('  → artifacts/action-edit-body.json')
  log('  字段:', Object.keys(bodyObj).slice(0, 40).join(','))
} else {
  log('\n⚠ 没抓到 action/edit（需要触发保存/提交）')
  log('  提示：页面加载后点一次「保存草稿」或「提交」才会发')
}

process.exit(0)
