/**
 * baseline-54001.mjs —— 54001 基线采样（只读，零写操作）
 *
 * 目的：量出「当前基座」下每 100 次只读请求命中多少次 54001，作为后续改动的对比基线。
 *
 * 采样设计：
 *   · 用**真实账号**（默认 c35128，健康、今日 0 次 54001）
 *   · 只打**只读**接口（商品列表 / SKU 详情 / 店招信息）
 *   · 分两组对照：
 *       A 组「基座通道」= pdd-http.call（自带 Anti-Content + VerifyAuthToken + 节流）
 *       B 组「裸 fetch」  = page.evaluate(fetch) 不带任何头（复现技能里的旧写法）
 *   · 每组 10 次，共 20 次；严格节流，组间停 15s
 *
 * 产出：reports/baseline-54001.json + 控制台表格
 *
 * 用法：
 *   node baseline-54001.mjs --account pdd_mms_xxx [--n 10]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')
const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

const SHOP = arg('account', 'pdd_mms_c35128faa4d130f5aba289b0a1445252')
const N = Math.max(3, Math.min(20, Number(arg('n', '10'))))

const load = (p) => import(pathToFileURL(path.join(PLUGIN_ROOT, p)).href)
const { createSession, closeSession } = await load('skills/_shared/pdd-client.mjs')
const { call, cookiesOf } = await load('skills/_shared/pdd-http.mjs')
const { needAntiContent, signPlan } = await load('skills/_shared/pdd-sign-scope.mjs')
const { CredentialStore } = await load('lib/services/credential-store.js')

// 三个只读接口（都在 162 白名单外，但要验证的是"头带不带"的影响）
const PROBES = [
  { url: 'https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', body: { page: 1, size: 1, is_onsale: 1 }, label: '商品列表' },
  { url: 'https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', body: { goodsId: 0 }, label: 'SKU信息(空参)' },
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const stat = (arr) => {
  const n = arr.length
  const c = arr.filter(x => x.ec === 54001).length
  const r = arr.filter(x => x.ec === 40002).length
  const ok = arr.filter(x => x.ok).length
  const other = arr.filter(x => !x.ok && x.ec !== 54001 && x.ec !== 40002).length
  return { n, ok, c54001: c, c40002: r, other, rate54001: n ? +(c / n * 100).toFixed(1) : 0 }
}

console.log(`\n54001 基线采样 · 账号 ${SHOP.slice(-8)} · 每接口 ${N} 次\n${'='.repeat(64)}`)
const store = new CredentialStore(path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', 'dsagent-accounts.json'))
const acc = store.get?.(SHOP) || store.listAccounts?.().find(a => a.shop_key === SHOP)
const hasCk = !!acc?.cookies?.PASS_ID
if (!hasCk) console.warn('[警告] 凭证库无 PASS_ID，将只用浏览器会话 Cookie（pdd-client 起的会话）')

let sess = null
const results = { A_base: [], B_bare: [], meta: { shop: SHOP, n: N, at: new Date().toISOString() } }
const outDir0 = path.join(PLUGIN_ROOT, 'artifacts', 'baseline')
fs.mkdirSync(outDir0, { recursive: true })
const outFile0 = path.join(outDir0, `baseline-54001-${Date.now()}.json`)
const flush = () => { try { fs.writeFileSync(outFile0, JSON.stringify(results, null, 2), 'utf8') } catch { /* ignore */ } }
try {
  sess = await createSession(SHOP)
  await sess.goto('https://mms.pinduoduo.com/goods/goods_list', 20000)
  const ck = await sess.cookieStr()
  console.log('会话就绪，Cookie:', ck.count, '| PASS_ID:', !!ck.map['PASS_ID'])

  // ── A 组：走基座 pdd-http（带 Anti-Content + 可能的 VerifyAuthToken + 账号级节流）──
  console.log('\n[A 组] 基座 pdd-http（带签名头）')
  for (const p of PROBES) {
    for (let i = 0; i < N; i++) {
      const r = await call({ shopKey: SHOP, cookies: ck.str, url: p.url, body: p.body, maxRetry: 0 })
      const ec = r.ec ?? r.json?.error_code ?? r.json?.errorCode ?? null
      results.A_base.push({ label: p.label, i, ok: !!r.ok, ec, signed: r.signed, crawlerInBody: r.crawlerInfoInBody })
      results.A_base[results.A_base.length - 1].kind = r.kind
      results.A_base[results.A_base.length - 1].hint = (r.hint || '').slice(0, 80)
      process.stdout.write(r.ok ? '.' : (ec === 54001 ? 'C' : (ec === 40002 ? 'R' : `x[${r.kind || ec}]`)))
      flush()
      await sleep(4200 + Math.random() * 1800)
    }
  }
  console.log('')

  await sleep(15000)   // 组间冷却

  // ── B 组：裸 fetch（复现技能旧写法：只带 Content-Type）──
  console.log('\n[B 组] 裸 page.evaluate fetch（无 Anti-Content / 无 VerifyAuthToken）')
  for (const p of PROBES) {
    for (let i = 0; i < N; i++) {
      let out
      try {
        out = await sess.page.evaluate(async (u, bd) => {
        try {
          const resp = await fetch(u, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bd || {}),
          })
          const j = await resp.json().catch(() => null)
          return { http: resp.status, ec: j?.error_code ?? j?.errorCode ?? null, ok: j?.success === true }
        } catch (e) { return { err: String(e).slice(0, 80) } }
        }, p.url, p.body)
      } catch (e) {
        out = { err: String(e.message || e).slice(0, 60), detached: /detached|Target closed/i.test(String(e.message || e)) }
        results.B_bare.push({ label: p.label, i, ok: false, ec: 'detached', err: out.err })
        flush()
        process.stdout.write('D')
        if (out.detached) break
        continue
      }
      results.B_bare.push({ label: p.label, i, ok: !!out.ok, ec: out.ec ?? null, http: out.http })
      process.stdout.write(out.ok ? '.' : (out.ec === 54001 ? 'C' : (out.ec === 40002 ? 'R' : 'x')))
      flush()
      await sleep(4200 + Math.random() * 1800)
    }
  }
  console.log('')
} finally {
  try { await closeSession?.(sess) } catch { /* ignore */ }
  flush()
}

const A = stat(results.A_base)
const B = stat(results.B_bare)
results.summary = { A, B }

console.log('\n' + '='.repeat(64))
console.log('组                       请求  成功  54001  40002  其他  54001率')
console.log('A 基座(带签名头)   ' + String(A.n).padStart(6) + String(A.ok).padStart(6) + String(A.c54001).padStart(7) + String(A.c40002).padStart(7) + String(A.other).padStart(6) + (A.rate54001 + '%').padStart(8))
console.log('B 裸fetch(无头)    ' + String(B.n).padStart(6) + String(B.ok).padStart(6) + String(B.c54001).padStart(7) + String(B.c40002).padStart(7) + String(B.other).padStart(6) + (B.rate54001 + '%').padStart(8))
console.log('='.repeat(64))

const outDir = path.join(PLUGIN_ROOT, 'artifacts', 'baseline')
fs.mkdirSync(outDir, { recursive: true })
const outFile = outFile0
fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8')
console.log('明细 →', outFile)
