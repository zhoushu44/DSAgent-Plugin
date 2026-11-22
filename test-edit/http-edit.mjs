/**
 * test-edit/http-edit.mjs — 用正确的 goods_commit_id 走 HTTP 编辑
 *
 * 用法:
 *   node test-edit/http-edit.mjs read <goodsId> <commitId>
 *   node test-edit/http-edit.mjs stock <goodsId> <commitId> <数量>
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
const log = (...a) => console.log('[H]', ...a)

const cmd = process.argv[2] || 'read'
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
    } catch (e) { return { ex: String(e.message).slice(0, 100) } }
  }, { method, url: urlPath, body })
}

// ══ read：拉商品完整数据 ══
if (cmd === 'read') {
  log(`\n=== 读商品 goodsId=${goodsId} commitId=${commitId} ===`)
  const tries = [
    ['GET', `/glide/v2/mms/query/commit/detail?goods_id=${goodsId}&goods_commit_id=${commitId}`, null],
    ['GET', `/glide/v2/mms/query/commit/detail?goods_commit_id=${commitId}`, null],
    ['GET', `/glide/v2/mms/query/commit/on_shop/detail?goods_id=${goodsId}&goods_commit_id=${commitId}`, null],
    ['POST', `/glide/v2/mms/query/commit/detail`, { goods_id: goodsId, goods_commit_id: commitId }],
    ['POST', `/glide/v2/mms/query/commit/on_shop/detail`, { goods_id: goodsId, goods_commit_id: commitId }],
    ['POST', `/glide/v2/mms/edit/commit/update`, { goods_id: goodsId, goods_commit_id: commitId }],
  ]
  for (const [m, u, b] of tries) {
    const r = await req(m, u, b)
    const tag = m + ' ' + u.split('?')[0].replace('/glide/v2/mms', '')
    const n = r.result ? Object.keys(r.result).length : 0
    log(`${tag.padEnd(40)} ${r.ok ? '✅' : '❌'} ec=${r.ec || '-'} keys=${n} ${(r.msg || r.ex || r.raw || '').slice(0, 40)}`)
    if (r.ok && r.result && n > 5) {
      log('  ★ 成功！字段:', Object.keys(r.result).slice(0, 30).join(','))
      fs.writeFileSync(path.join(P, 'artifacts', `commit-${goodsId}.json`), JSON.stringify(r.result, null, 2), 'utf8')
      log('  已保存 → artifacts/commit-' + goodsId + '.json')
      const d = r.result
      log('  标题:', (d.goods_name || '').slice(0, 40))
      log('  轮播图:', (d.carousel_gallery || []).length, '| 详情图:', (d.detail_gallery || []).length)
      log('  SKU 数:', (d.sku || d.skus || []).length)
      log('  参考价:', d.market_price)
      break
    }
    await sleep(1200)
  }
  process.exit(0)
}

// ══ stock：改库存 ══
if (cmd === 'stock') {
  const qty = Number(process.argv[5] || 300)
  log(`\n=== 改库存 → ${qty} ===`)

  // 先拉 commit detail
  let detail = null
  for (const [m, u, b] of [
    ['GET', `/glide/v2/mms/query/commit/detail?goods_id=${goodsId}&goods_commit_id=${commitId}`, null],
    ['POST', `/glide/v2/mms/query/commit/detail`, { goods_id: goodsId, goods_commit_id: commitId }],
  ]) {
    const r = await req(m, u, b)
    if (r.ok && r.result && Object.keys(r.result).length > 5) { detail = r.result; log('拉详情 ✅ 字段数:', Object.keys(detail).length); break }
    await sleep(1200)
  }
  if (!detail) { log('❌ 拉不到详情'); process.exit(1) }

  const skus = detail.sku || detail.skus || []
  log('SKU 数:', skus.length)
  if (skus.length) log('第一个 SKU:', JSON.stringify(skus[0], null, 1).slice(0, 500))

  // 改库存
  const before = skus.map(s => s.quantity ?? s.stock)
  for (const s of skus) { s.quantity = qty; s.stock = qty }
  detail.sku = skus

  const r = await req('POST', '/glide/mms/goodsCommit/action/edit', detail)
  log('改库存:', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), (r.msg || '').slice(0, 60))
  log('改前:', JSON.stringify(before))
  process.exit(0)
}

log('未知命令')
process.exit(0)
