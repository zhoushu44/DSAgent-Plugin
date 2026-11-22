/**
 * test-edit/edit-http.mjs — 编辑原商品 · HTTP 模式（独立测试）
 *
 * 用法:
 *   node test-edit/edit-http.mjs list
 *   node test-edit/edit-http.mjs probe <goodsId>
 *   node test-edit/edit-http.mjs stock <goodsId> <数量>
 *   node test-edit/edit-http.mjs price <goodsId> <拼单价> <单买价>
 *   node test-edit/edit-http.mjs title <goodsId> "<新标题>"
 *   node test-edit/edit-http.mjs itemNo <goodsId> "<编码>"
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
const log = (...a) => console.log('[E]', ...a)

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]
if (!acc) { log('没有可用账号'); process.exit(1) }
log('账号:', acc.display_label)

const cmd = process.argv[2] || 'list'
const goodsId = process.argv[3] || ''

if (cmd === 'list') {
  const list = [
    ['1028374071813', '纸杯（最新，含详情图）'],
    ['1027998749178', '纸杯（1维容量）'],
    ['1028059700489', '女装T恤（3色×4码）'],
    ['1028252715395', '休闲裤'],
  ]
  log('测试商品:')
  for (const [id, n] of list) log('  ' + id + '  ' + n)
  process.exit(0)
}

// ── 启动浏览器 ──
const { browser } = await launchStealth(acc.shop_key, puppeteer)
await sleep(5000)
let p = null
for (let i = 0; i < 40; i++) {
  const ps = await browser.pages()
  const hit = ps.find(x => /mms\.pinduoduo\.com$|mms\.pinduoduo\.com\//.test(x.url()))
  if (hit) { p = hit; break }
  await sleep(400)
}
if (!p) { p = await browser.newPage() }
await p.bringToFront()

// 先到商品列表，确保会话有效
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(4000)
log('页面:', p.url().slice(0, 70))

/** 在页面内发请求（带真实会话） */
async function api(urlPath, method = 'GET', body = null) {
  return p.evaluate(async (args) => {
    try {
      const opt = { credentials: 'include', headers: { 'Accept': 'application/json' } }
      if (args.method === 'POST') {
        opt.method = 'POST'
        opt.headers['Content-Type'] = 'application/json'
        opt.body = JSON.stringify(args.body)
      }
      const res = await fetch(args.url, opt)
      const txt = await res.text()
      let j = null
      try { j = JSON.parse(txt) } catch { }
      return { status: res.status, ok: !!(j && j.success), ec: j?.error_code, msg: j?.error_msg || '', data: j?.result || j, rawLen: txt.length, head: j ? '' : txt.slice(0, 150) }
    } catch (e) { return { ex: String(e.message).slice(0, 120) } }
  }, { url: 'https://mms.pinduoduo.com' + urlPath, method, body })
}

// ══ probe ══
if (cmd === 'probe') {
  log('\n=== 拉商品完整数据 ' + goodsId + ' ===')
  const tries = [
    '/glide/v2/mms/query/commit/on_shop/detail?goods_id=' + goodsId,
    '/glide/v2/mms/edit/commit/update?goods_id=' + goodsId,
    '/vodka/v2/mms/query/sku/info?goods_id=' + goodsId,
  ]
  for (const u of tries) {
    const r = await api(u)
    const k = u.split('/').slice(-2).join('/')
    log(k, '→', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), 'msg=' + (r.msg || '').slice(0, 50), 'keys=' + (r.data ? Object.keys(r.data).length : 0))
    if (r.ok && r.data) {
      const keys = Object.keys(r.data)
      log('  字段:', keys.slice(0, 25).join(', '))
      const d = r.data
      log('  goods_name:', (d.goods_name || '').slice(0, 40))
      log('  carousel:', (d.carousel_gallery || []).length, '| detail:', (d.detail_gallery || []).length)
      log('  sku:', (d.sku || d.skus || d.sku_list || []).length)
    }
    await sleep(1500)
  }
  fs.writeFileSync(path.join(P, 'artifacts', 'edit-probe-result.json'), JSON.stringify({ goodsId }, null, 2), 'utf8')
  await browser.close()
  process.exit(0)
}

// ══ stock ══
if (cmd === 'stock') {
  const qty = Number(process.argv[4] || 200)
  log('\n=== 改库存 → ' + qty + ' ===')
  const skuR = await api('/vodka/v2/mms/query/sku/info?goods_id=' + goodsId)
  log('读 SKU:', skuR.ok ? '✅' : '❌', skuR.ec || '', skuR.msg || '')
  if (!skuR.ok) { await browser.close(); process.exit(1) }
  const list = skuR.data?.sku_list || skuR.data?.skus || []
  log('SKU 数:', list.length)
  if (list.length) log('第一个 SKU:', JSON.stringify(list[0]).slice(0, 300))
  await browser.close()
  process.exit(0)
}

log('未知命令:', cmd)
await browser.close()
