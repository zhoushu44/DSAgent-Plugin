/**
 * probe-pure-http.mjs —— 纯 Node 通道能力实测（不启动浏览器）
 *
 * 目的：确认 pdd-transport 的 t1/t2 分类是否准确。
 *   如果某些被判为 t2 的接口其实纯 Node 能跑，那就能大幅减少开浏览器。
 *
 * 方法：对每个前缀各挑 1 个只读接口，用 pdd-http（零浏览器依赖）打一次。
 *   只看 errorCode，不看业务数据（有些接口参数不对会返 3000000，那也是「通道可用」的证据，
 *   因为 54001 才是通道级拒绝）。
 *
 * 判读：
 *   1000000 / success  → 通道 OK
 *   3000000 / 4000000  → 参数问题，但通道 OK（说明签名过了）
 *   54001              → 通道不行（签名不够，必须真签名/浏览器）
 *   43001              → 会话问题，不算通道问题
 *
 * 用法：node probe-pure-http.mjs --account pdd_mms_xxx
 */
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href)

const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
const SHOP = arg('account')
if (!SHOP) { console.error('用法: node probe-pure-http.mjs --account pdd_mms_xxx'); process.exit(2) }

const { CredentialStore } = await load('lib/services/credential-store.js')
const { call } = await load('skills/_shared/pdd-http.mjs')

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.shop_key === SHOP)
if (!acc) { console.error('账号不存在'); process.exit(2) }
const cookies = Object.entries(acc.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ')
console.log(`\n纯 Node 通道实测 · ${acc.display_label || SHOP.slice(-8)} · Cookie ${Object.keys(acc.cookies||{}).length} 项\n${'='.repeat(72)}`)

/** 每个前缀挑一个只读接口 */
const TARGETS = [
  { pre: 'sydney',       name: '店铺流量',   url: 'https://mms.pinduoduo.com/sydney/api/mallFlow/getMallFlowData', body: {}, referer: 'https://mms.pinduoduo.com/sycm/evaluation' },
  { pre: 'earth',        name: '店铺信息',   url: 'https://mms.pinduoduo.com/earth/api/mallInfo/commonMallInfo', body: {}, referer: 'https://mms.pinduoduo.com/' },
  { pre: 'lakemms',      name: '活动列表',   url: 'https://mms.pinduoduo.com/lakemms/activityGoods/list', body: { page: 1, size: 5 }, referer: 'https://mms.pinduoduo.com/act/index' },
  { pre: 'opportunity',  name: '机会商品',   url: 'https://mms.pinduoduo.com/opportunity-goods/chance-goods/home_list', body: { size: 5, page: 1, banner_type: 0 }, referer: 'https://mms.pinduoduo.com/goods/goods_list/chance' },
  { pre: 'vodka',        name: '商品列表',   url: 'https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', body: { page: 1, size: 1, is_onsale: 1 }, referer: 'https://mms.pinduoduo.com/goods/goods_list' },
  { pre: 'glide',        name: '商品详情',   url: 'https://mms.pinduoduo.com/glide/v2/mms/query/commit/on_shop/detail', body: { goodsId: 0 }, referer: 'https://mms.pinduoduo.com/goods/goods_list' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rows = []

for (const t of TARGETS) {
  let r
  try {
    r = await call({ shopKey: SHOP, cookies, url: t.url, body: t.body, referer: t.referer, maxRetry: 0 })
  } catch (e) {
    r = { ok: false, ec: 'exception', kind: String(e.message).slice(0, 60) }
  }
  const ec = r.ec ?? r.json?.error_code ?? r.json?.errorCode ?? null
  const ok = !!r.ok
  let verdict
  if (ok) verdict = '✅ 通道 OK'
  else if (ec === 54001) verdict = '❌ 需签名（54001）'
  else if (ec === 43001 || r.kind === 'session_expired') verdict = '🔑 会话过期'
  else if (ec === 40002 || r.kind === 'rate_limit') verdict = '⏸ 限流'
  else if (ec === 3000000 || ec === 4000000) verdict = '✅ 通道 OK（参数错）'
  else if (ec >= 2000000 && ec < 3000000) verdict = '✅ 通道 OK（无权限）'
  else if (ec === 2000000) verdict = '✅ 通道 OK（无权限）'
  else verdict = `? ec=${ec} kind=${r.kind || ''}`

  rows.push({ pre: t.pre, name: t.name, ok, ec, verdict })
  console.log(`${t.pre.padEnd(14)} ${t.name.padEnd(8)} ec=${String(ec).padEnd(10)} ${verdict}`)
  await sleep(5000 + Math.random() * 2000)
}

console.log(`\n${'='.repeat(72)}`)
console.log('结论\n')
const pureOk = rows.filter(r => /✅/.test(r.verdict))
const needSig = rows.filter(r => /❌/.test(r.verdict))
console.log(`纯 Node 可跑: ${pureOk.length}/${rows.length}  →  ${pureOk.map(r => r.pre).join(', ') || '（无）'}`)
console.log(`需真签名   : ${needSig.length}/${rows.length}  →  ${needSig.map(r => r.pre).join(', ') || '（无）'}`)
console.log('')
