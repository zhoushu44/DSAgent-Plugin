/**
 * test-edit/do-edit.mjs — 实际修改商品（逐项测试）
 *
 * 用法:
 *   node test-edit/do-edit.mjs stock <goodsId> <commitId> <数量>
 *   node test-edit/do-edit.mjs price <goodsId> <commitId> <拼单价元> <单买价元>
 *   node test-edit/do-edit.mjs title <goodsId> <commitId> "<新标题>"
 *   node test-edit/do-edit.mjs itemNo <goodsId> <commitId> "<编码>"
 *
 * 流程：拉 on_shop/detail → 改字段 → POST goodsCommit/action/edit → 回读验证
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
const log = (...a) => console.log('[D]', ...a)

const cmd = process.argv[2]
const goodsId = Number(process.argv[3] || 0)
const commitId = Number(process.argv[4] || 0)

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]

const { browser, page } = await launchStealth(acc.shop_key, puppeteer)
const p = page
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(5000)

async function req(method, urlPath, body) {
  return p.evaluate(async (a) => {
    try {
      const opt = { credentials: 'include', headers: { 'Accept': 'application/json' } }
      if (a.method === 'POST') {
        opt.method = 'POST'
        opt.headers['Content-Type'] = 'application/json'
        opt.body = JSON.stringify(a.body)
      }
      const res = await fetch('https://mms.pinduoduo.com' + a.url, opt)
      const txt = await res.text()
      let j = null; try { j = JSON.parse(txt) } catch { }
      return { ok: !!(j && j.success), ec: j?.error_code, msg: j?.error_msg || '', result: j?.result, raw: !j ? txt.slice(0, 150) : '' }
    } catch (e) { return { ex: String(e.message).slice(0, 120) } }
  }, { method, url: urlPath, body })
}

const readDetail = () => req('POST', '/glide/v2/mms/query/commit/on_shop/detail', { goods_id: goodsId, goods_commit_id: commitId })

// ── 拉详情 ──
log(`拉商品 goodsId=${goodsId} commitId=${commitId}`)
let detail = null
for (let i = 0; i < 3 && !detail; i++) {
  const r = await readDetail()
  if (r.ok && r.result && Object.keys(r.result).length > 5) detail = r.result
  else { log('  重试', i + 1, r.ec, (r.msg || '').slice(0, 40)); await sleep(2000) }
}
if (!detail) { log('❌ 拉不到详情'); process.exit(1) }
log('✅ 详情字段数:', Object.keys(detail).length)
log('标题:', (detail.goods_name || '').slice(0, 40))
log('SKU:', (detail.skus || []).length, '| 轮播:', (detail.carousel_gallery || []).length, '| 详情图:', (detail.detail_gallery || []).length)

const memoSave = (name, obj) => fs.writeFileSync(path.join(P, 'artifacts', name + '-' + goodsId + '.json'), JSON.stringify(obj, null, 2), 'utf8')
memoSave('before-edit', {
  goods_name: detail.goods_name,
  market_price: detail.market_price,
  skus: (detail.skus || []).map(s => ({ sku_id: s.sku_id, quantity: s.quantity, multi_price: s.multi_price, price: s.price, sku_sn: s.sku_sn, spec: (s.spec || []).map(x => x.spec_name) })),
})

// ── 改字段 ──
if (cmd === 'stock') {
  const qty = Number(process.argv[5] || 300)
  log(`\n改库存 → ${qty}`)
  const before = (detail.skus || []).map(s => s.quantity)
  for (const s of detail.skus || []) s.quantity = qty
  log('改前:', JSON.stringify(before))
}

if (cmd === 'price') {
  const multiYuan = Number(process.argv[5] || 0)
  const priceYuan = Number(process.argv[6] || 0)
  log(`\n改价格 → 拼单价 ${multiYuan} / 单买价 ${priceYuan}`)
  const before = (detail.skus || []).map(s => ({ m: s.multi_price, p: s.price }))
  for (const s of detail.skus || []) {
    s.multi_price = Math.round(multiYuan * 100)
    s.price = Math.round(priceYuan * 100)
  }
  log('改前(分):', JSON.stringify(before.slice(0, 2)))
}

if (cmd === 'title') {
  const t = process.argv[5] || ''
  log(`\n改标题 → ${t}`)
  log('改前:', detail.goods_name)
  detail.goods_name = t
}

if (cmd === 'itemNo') {
  const sn = process.argv[5] || ''
  log(`\n改编码 → ${sn}`)
  const before = (detail.skus || []).map(s => s.sku_sn)
  for (const s of detail.skus || []) s.sku_sn = sn
  log('改前:', JSON.stringify(before.slice(0, 3)))
}

// ── 提交 ──
log('\n提交 goodsCommit/action/edit')
// ★ 172 字段是 on_shop/detail 的 schema，action/edit 要 157 字段
// 先试 edit/commit/update（它接受 on_shop/detail 的结构）
let r = await req('POST', '/glide/v2/mms/edit/commit/update', detail)
if (!r.ok) {
  log('edit/commit/update 失败，试 goodsCommit/action/edit')
  r = await req('POST', '/glide/mms/goodsCommit/action/edit', detail)
}
if (!r.ok) {
  log('再试 commit/submit')
  r = await req('POST', '/glide/v2/mms/edit/commit/submit', detail)
}
log('结果:', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), (r.msg || r.ex || r.raw || '').slice(0, 100))

// ── 回读验证 ──
if (r.ok) {
  await sleep(3000)
  const a = await readDetail()
  if (a.ok && a.result) {
    const d = a.result
    log('\n回读:')
    log('  标题:', (d.goods_name || '').slice(0, 40))
    log('  库存:', JSON.stringify((d.skus || []).map(s => s.quantity).slice(0, 4)))
    log('  价格:', JSON.stringify((d.skus || []).map(s => ({ m: s.multi_price, p: s.price })).slice(0, 2)))
    log('  编码:', JSON.stringify((d.skus || []).map(s => s.sku_sn).slice(0, 3)))
    memoSave('after-edit', {
      goods_name: d.goods_name,
      skus: (d.skus || []).map(s => ({ sku_id: s.sku_id, quantity: s.quantity, multi_price: s.multi_price, price: s.price, sku_sn: s.sku_sn })),
    })
  }
}
process.exit(r.ok ? 0 : 1)
