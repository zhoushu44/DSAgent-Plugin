/**
 * test-edit/probe2.mjs — 补齐参数继续探测
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
const log = (...a) => console.log('[P2]', ...a)
const goodsId = Number(process.argv[2] || '1028374071813')

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

// 1) 先从商品列表拿 goods_commit_id（页面上通常有）
log('=== 1. 从商品列表页找 goods_commit_id ===')
const listData = await p.evaluate(async () => {
  try {
    const res = await fetch('https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 1, size: 10, status: 1 }),
    })
    const j = await res.json()
    const list = j?.result?.list || []
    return { ok: j.success, n: list.length, sample: list.slice(0, 5).map(x => ({ goods_id: x.goods_id, commit_id: x.goods_commit_id || x.commit_id, title: (x.goods_name || '').slice(0, 20) })) }
  } catch (e) { return { ex: String(e.message).slice(0, 100) } }
})
log(JSON.stringify(listData, null, 1).slice(0, 800))

// 2) 试 edit/commit/update 带各种 id 组合
log('\n=== 2. 试 edit/commit/update ===')
const combos = [
  { goods_id: goodsId, goods_commit_id: goodsId },
  { goods_id: goodsId, goods_commit_id: 0 },
  { goods_id: goodsId, id: goodsId },
  { goodsId: goodsId, goodsCommitId: goodsId },
]
for (const b of combos) {
  const r = await req('POST', '/glide/v2/mms/edit/commit/update', b)
  log(JSON.stringify(b), '→', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), (r.msg || r.ex || '').slice(0, 50))
  if (r.ok && r.result) {
    log('  ★ 成功！字段:', Object.keys(r.result).join(','))
    fs.writeFileSync(path.join(P, 'artifacts', 'edit-update-ok.json'), JSON.stringify(r.result, null, 2), 'utf8')
    break
  }
  await sleep(1500)
}

// 3) 试 on_shop/detail 带不同 id
log('\n=== 3. 试 on_shop/detail ===')
for (const b of [{ goods_id: goodsId, goods_commit_id: goodsId }, { goods_id: goodsId }]) {
  const r = await req('POST', '/glide/v2/mms/query/commit/on_shop/detail', b)
  log(JSON.stringify(b), '→', r.ok ? '✅' : '❌', 'ec=' + (r.ec || '-'), (r.msg || '').slice(0, 50))
  if (r.ok && r.result) {
    log('  ★ 字段:', Object.keys(r.result).slice(0, 25).join(','))
    fs.writeFileSync(path.join(P, 'artifacts', 'goods-detail-ok.json'), JSON.stringify(r.result, null, 2), 'utf8')
    break
  }
  await sleep(1500)
}

process.exit(0)
