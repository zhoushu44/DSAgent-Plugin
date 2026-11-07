/**
 * probe-shop-alias.mjs —— pdd-shop 新旧接口 A/B 对照（只读，零写）
 *
 * 目的：确认「旧别名接口」是否还能用，还是应该换成新接口。
 *
 * 背景：
 *   pdd-shop 现在用的是 4 个旧别名（queryGoodsDetailVOListForMMS 等），
 *   而线上 bundle 里已经是新名字（queryGoodsDetailVOList 等）。
 *   如果旧别名已下线，pdd-shop 会静默失效；如果新名不可用，就不能盲目改。
 *
 * 做法：每个业务各打新旧两个接口，比对：
 *   - HTTP 状态
 *   - error_code
 *   - 是否 success
 *   - 返回数据的关键字段能否取到
 *
 * 用法：
 *   node probe-shop-alias.mjs --account pdd_mms_xxx
 *
 * ⚠️ 只读：不修改任何数据。但会发 8 次真实请求，请在账号状态良好时跑。
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')
const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
const SHOP = arg('account')
if (!SHOP) { console.error('用法: node probe-shop-alias.mjs --account pdd_mms_xxx'); process.exit(2) }

const load = (p) => import(pathToFileURL(path.join(PLUGIN_ROOT, p)).href)
const { call } = await load('skills/_shared/pdd-http.mjs')
const { createSession } = await load('skills/_shared/pdd-client.mjs')
const { API } = await load('skills/_shared/pdd-api.mjs')

/** 4 组对照：业务名 / 旧接口 / 新接口 / 判定字段 */
// ★ referer 是必需的：pdd-shop 实际调用都带，漏了会 43001（实测）
const PAIRS = [
  { biz: '商品明细', old: 'shop.legacyGoodsDetailVO', neu: 'shop.goodsDetailVO', referer: 'https://mms.pinduoduo.com/sycm/goods_effect' },
  { biz: '商品总览', old: 'shop.legacyGoodsOverview', neu: 'shop.goodsOverview', referer: 'https://mms.pinduoduo.com/sycm/goods_effect' },
  { biz: '店铺流量', old: 'shop.legacyFlow', neu: 'shop.flow', referer: 'https://mms.pinduoduo.com/sycm/evaluation' },
  { biz: '店铺评分', old: 'shop.legacyScore', neu: 'shop.score', referer: 'https://mms.pinduoduo.com/sycm/evaluation' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 起一个会话拿 Cookie（pdd-http 需要 cookies）
console.log(`\npdd-shop 新旧接口对照 · 账号 ${SHOP.slice(-8)}\n${'='.repeat(76)}`)
let sess = null
let ck = null
try {
  sess = await createSession(SHOP)
  await sess.goto('https://mms.pinduoduo.com/goods/goods_list', 20000)
  ck = await sess.cookieStr()
  console.log(`会话就绪（Cookie ${ck.count}）\n`)

  const probe = async (name, referer) => {
    const spec = API[name]
    if (!spec) return { ok: false, ec: 'no-registry', note: `注册表缺少 ${name}` }
    const url = 'https://mms.pinduoduo.com' + spec.path
    try {
      const r = await call({ shopKey: SHOP, cookies: ck.str, url, body: {}, referer, maxRetry: 0 })
      const ec = r.ec ?? r.json?.error_code ?? r.json?.errorCode ?? null
      return {
        ok: !!r.ok,
        http: r.status,
        ec,
        kind: r.kind || '',
        hasResult: !!(r.json?.result),
        resultKeys: r.json?.result && typeof r.json.result === 'object' ? Object.keys(r.json.result).slice(0, 5) : [],
      }
    } catch (e) {
      return { ok: false, ec: 'exception', note: String(e.message).slice(0, 80) }
    }
  }

  const rows = []
  for (const p of PAIRS) {
    console.log(`── ${p.biz}`)
    const o = await probe(p.old, p.referer)
    console.log(`   旧 ${API[p.old].path}`)
    console.log(`      → ok=${o.ok} http=${o.http} ec=${o.ec} result=${o.hasResult} keys=${(o.resultKeys || []).join(',')}`)
    await sleep(5000 + Math.random() * 2000)

    const n = await probe(p.neu, p.referer)
    console.log(`   新 ${API[p.neu].path}`)
    console.log(`      → ok=${n.ok} http=${n.http} ec=${n.ec} result=${n.hasResult} keys=${(n.resultKeys || []).join(',')}`)
    await sleep(5000 + Math.random() * 2000)

    rows.push({ biz: p.biz, old: { name: p.old, ...o }, neu: { name: p.neu, ...n } })
  }

  console.log(`\n${'='.repeat(76)}`)
  console.log('汇总\n')
  console.log('业务        旧接口          新接口          建议')
  for (const r of rows) {
    const o = r.old, n = r.neu
    let advice = ''
    if (o.ok && n.ok) advice = '都可以 → 保持旧别名（零风险）'
    else if (!o.ok && n.ok) advice = '★ 旧失效 → 必须换新'
    else if (o.ok && !n.ok) advice = '★ 新不可用 → 保持旧'
    else advice = '两个都不行 → 需查（可能参数不对）'
    console.log(
      `${r.biz.padEnd(10)}  ${(o.ok ? 'OK' : 'FAIL').padEnd(14)}  ${(n.ok ? 'OK' : 'FAIL').padEnd(14)}  ${advice}`
    )
  }
  console.log('')

  // 落盘
  const fs = await import('node:fs')
  const outDir = path.join(PLUGIN_ROOT, 'artifacts', 'probe')
  fs.mkdirSync(outDir, { recursive: true })
  const f = path.join(outDir, `shop-alias-${Date.now()}.json`)
  fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), shop: SHOP, rows }, null, 2), 'utf8')
  console.log('明细 →', f)
} finally {
  try { await sess?.close?.() } catch { /* ignore */ }
}
