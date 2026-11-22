/**
 * test-edit/run.mjs — 编辑能力逐项测试（稳健版）
 * 独立进程，每项测试自带浏览器启停
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)
const { launchStealth } = await import(pathToFileURL(P + '/skills/_shared/pdd-launch.mjs').href)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[T]', ...a)

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]
if (!acc) { log('无可用账号'); process.exit(1) }
log('账号:', acc.display_label, '| key:', acc.shop_key)

const cmd = process.argv[2] || 'list'
const goodsId = process.argv[3] || ''

// ── 连接已开浏览器，没有才启动 ──
async function getBrowser() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"], { encoding: 'utf8' })
    const ports = out.split(/\s+/).map(Number).filter(Boolean)
    for (const pt of ports) {
      try {
        const r = await fetch('http://127.0.0.1:' + pt + '/json/version', { signal: AbortSignal.timeout(250) })
        const j = await r.json()
        if (!j.Browser || !/Chrome/i.test(j.Browser)) continue
        const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
        const ps = await b.pages()
        if (ps.some(x => { try { return /mms\.pinduoduo\.com/.test(x.url()) } catch { return false } })) {
          log('连接已有浏览器 port=' + pt)
          return { browser: b, page: ps.find(x => { try { return /mms\.pinduoduo\.com/.test(x.url()) } catch { return false } }), port: pt }
        }
        await b.disconnect()
      } catch { }
    }
  } catch { }
  log('启动新浏览器…')
  const ls = await launchStealth(acc.shop_key, puppeteer)
  return { browser: ls.browser, page: ls.page, port: 0 }
}

/** 取一个可用页面（重试），必要时等浏览器就绪 */
async function getPage(browser, urlPat = /mms\.pinduoduo\.com/) {
  for (let i = 0; i < 50; i++) {
    try {
      const ps = await browser.pages()
      const hit = ps.find(x => { try { return urlPat.test(x.url()) } catch { return false } })
      if (hit) return hit
    } catch { }
    await sleep(400)
  }
  // 实在没有，新建
  for (let i = 0; i < 10; i++) {
    try { return await browser.newPage() } catch { await sleep(800) }
  }
  return null
}

/** 页面内发请求 */
async function api(p, urlPath, method = 'GET', body = null) {
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
      return {
        status: res.status,
        ok: !!(j && j.success),
        ec: j?.error_code,
        msg: j?.error_msg || '',
        data: j?.result || j,
        notJson: !j ? txt.slice(0, 150) : '',
      }
    } catch (e) { return { ex: String(e.message).slice(0, 120) } }
  }, { url: 'https://mms.pinduoduo.com' + urlPath, method, body })
}

const GOODS = {
  '1028374071813': '纸杯（最新，含详情图）',
  '1027998749178': '纸杯（1维容量）',
  '1028059700489': '女装T恤（3色×4码）',
  '1028252715395': '休闲裤',
}

if (cmd === 'list') {
  log('测试商品:')
  for (const [id, n] of Object.entries(GOODS)) log('  ' + id + '  ' + n)
  process.exit(0)
}

const got = await getBrowser()
const browser = got.browser
let p = got.page || await getPage(browser)
if (!p) { log('取不到页面'); process.exit(1) }
await p.bringToFront().catch(() => { })
// ★ 必须落在 mms 域，否则 fetch 全失败
if (!/mms\.pinduoduo\.com/.test(p.url())) {
  log('当前是 ' + p.url().slice(0, 40) + '，导航到商品列表…')
  await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
  await sleep(5000)
}
log('页面:', p.url().slice(0, 70))

// ══ probe：只读拉数据 ══
if (cmd === 'probe') {
  log('\n=== 探测商品 ' + goodsId + ' (' + (GOODS[goodsId] || '?') + ') ===')
  const ep = [
    '/glide/v2/mms/query/commit/on_shop/detail?goods_id=' + goodsId,
    '/glide/v2/mms/edit/commit/update?goods_id=' + goodsId,
    '/vodka/v2/mms/query/sku/info?goods_id=' + goodsId,
    '/glide/v2/mms/query/commit/detail?goods_id=' + goodsId,
  ]
  const out = {}
  for (const u of ep) {
    const r = await api(p, u)
    const name = u.split('?')[0].split('/').slice(-3).join('/')
    out[name] = { ok: r.ok, ec: r.ec, msg: r.msg, status: r.status, keys: r.data ? Object.keys(r.data).length : 0 }
    log(name)
    log('  →', r.ok ? '✅' : '❌', 'status=' + r.status, 'ec=' + (r.ec || '-'), (r.msg || r.ex || r.notJson || '').slice(0, 60))
    if (r.ok && r.data) {
      const d = r.data
      log('  字段数:', Object.keys(d).length)
      log('  goods_name:', (d.goods_name || d.goodsName || '').slice(0, 40))
      log('  carousel:', (d.carousel_gallery || d.carouselGallery || []).length, '| detail:', (d.detail_gallery || d.detailGallery || []).length)
      log('  sku:', (d.sku || d.skus || d.sku_list || []).length)
      log('  market_price:', d.market_price)
      fs.writeFileSync(path.join(P, 'artifacts', 'edit-raw-' + goodsId + '.json'), JSON.stringify(d, null, 2), 'utf8')
      log('  已保存原始数据')
    }
    await sleep(1200)
  }
  fs.writeFileSync(path.join(P, 'artifacts', 'edit-probe-' + goodsId + '.json'), JSON.stringify(out, null, 2), 'utf8')
  log('\n结果 → artifacts/edit-probe-' + goodsId + '.json')
  process.exit(0)
}

// ══ stock：读 SKU 看结构 ══
if (cmd === 'sku') {
  log('\n=== 读 SKU 结构 ' + goodsId + ' ===')
  const r = await api(p, '/vodka/v2/mms/query/sku/info?goods_id=' + goodsId)
  log('结果:', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), (r.msg || '').slice(0, 60))
  if (r.ok && r.data) {
    const list = r.data.sku_list || r.data.skus || []
    log('SKU 数:', list.length)
    if (list.length) {
      log('第一个 SKU 全字段:')
      log(JSON.stringify(list[0], null, 1).slice(0, 800))
      fs.writeFileSync(path.join(P, 'artifacts', 'sku-' + goodsId + '.json'), JSON.stringify(r.data, null, 2), 'utf8')
    }
  }
  process.exit(0)
}

log('未知命令:', cmd)
process.exit(0)
