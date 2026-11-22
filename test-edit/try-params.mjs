/**
 * test-edit/try-params.mjs — 尝试各接口的正确参数形式
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
const log = (...a) => console.log('[P]', ...a)
const goodsId = process.argv[2] || '1028374071813'

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status !== 'reauth_required')[0]

const { browser, page } = await launchStealth(acc.shop_key, puppeteer)
const p = page
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
await sleep(5000)
log('页面:', p.url().slice(0, 70))

/** 通用请求 */
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
      return { ok: !!(j && j.success), ec: j?.error_code, msg: j?.error_msg || '', dataKeys: j?.result ? Object.keys(j.result).length : 0, result: j?.result, raw: !j ? txt.slice(0, 120) : '' }
    } catch (e) { return { ex: String(e.message).slice(0, 100) } }
  }, { method, url: urlPath, body })
}

// 候选组合
const tries = [
  // commit/detail 各种形式
  ['GET', `/glide/v2/mms/query/commit/detail?goods_id=${goodsId}`, null],
  ['GET', `/glide/v2/mms/query/commit/detail?goodsId=${goodsId}`, null],
  ['POST', `/glide/v2/mms/query/commit/detail`, { goods_id: Number(goodsId) }],
  ['POST', `/glide/v2/mms/query/commit/detail`, { goodsId: Number(goodsId) }],
  ['POST', `/glide/v2/mms/query/commit/detail`, { goods_id: goodsId }],
  // on_shop detail
  ['GET', `/glide/v2/mms/query/commit/on_shop/detail?goods_id=${goodsId}`, null],
  ['POST', `/glide/v2/mms/query/commit/on_shop/detail`, { goods_id: Number(goodsId) }],
  // sku info
  ['GET', `/vodka/v2/mms/query/sku/info?goods_id=${goodsId}`, null],
  ['POST', `/vodka/v2/mms/query/sku/info`, { goods_id: Number(goodsId) }],
  // update
  ['GET', `/glide/v2/mms/edit/commit/update?goods_id=${goodsId}`, null],
  ['POST', `/glide/v2/mms/edit/commit/update`, { goods_id: Number(goodsId) }],
]

for (const [m, u, b] of tries) {
  const r = await req(m, u, b)
  const tag = m + ' ' + u.split('?')[0].replace('/glide/v2/mms', '').replace('/vodka/v2/mms', '')
  log(`${tag.padEnd(42)} ${r.ok ? '✅' : '❌'} ec=${r.ec || '-'} keys=${r.dataKeys || 0} ${(r.msg || r.ex || r.raw || '').slice(0, 40)}`)
  if (r.ok && r.result) {
    log('  ★ 成功！字段:', Object.keys(r.result).slice(0, 20).join(','))
    fs.writeFileSync(path.join(P, 'artifacts', 'edit-ok-' + goodsId + '.json'), JSON.stringify({ api: tag, result: r.result }, null, 2), 'utf8')
    break
  }
  await sleep(1200)
}
process.exit(0)
