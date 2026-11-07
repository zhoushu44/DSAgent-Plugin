/**
 * bench-chance-pure.mjs —— pdd-chance 纯 Node vs 浏览器 对比测试
 *
 * 只测，不改技能。
 *
 * A 组：纯 Node（pdd-http + 凭证库 Cookie）—— 完全不开浏览器
 * B 组：现有技能（pdd-chance，开浏览器）
 *
 * 对比：耗时 / 是否成功 / 拿到的条数
 *
 * 用法：node bench-chance-pure.mjs --account pdd_mms_xxx
 */
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href)

const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
const SHOP = arg('account')
if (!SHOP) { console.error('用法: node bench-chance-pure.mjs --account pdd_mms_xxx'); process.exit(2) }

const { CredentialStore } = await load('lib/services/credential-store.js')
const { call } = await load('skills/_shared/pdd-http.mjs')

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.shop_key === SHOP)
if (!acc) { console.error('账号不存在'); process.exit(2) }
const cookies = Object.entries(acc.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ')
const nCk = Object.keys(acc.cookies || {}).length

console.log(`\npdd-chance 通道对比 · ${acc.display_label || SHOP.slice(-8)}`)
console.log(`凭证库 Cookie: ${nCk} 项 | PASS_ID: ${!!acc.cookies?.PASS_ID}`)
console.log('='.repeat(70))

const URL_HOME = 'https://mms.pinduoduo.com/opportunity-goods/chance-goods/home_list'
const REFERER = 'https://mms.pinduoduo.com/goods/goods_list/chance'
const BODY = { size: 20, page: 1, banner_type: 0 }

// ── A 组：纯 Node ──
console.log('\n[A 组] 纯 Node（不开浏览器）')
let tA = Date.now()
let aOk = false, aCount = 0, aEc = null, aHint = ''
try {
  const r = await call({ shopKey: SHOP, cookies, url: URL_HOME, body: BODY, referer: REFERER, maxRetry: 0 })
  aEc = r.ec ?? r.json?.error_code ?? r.json?.errorCode ?? null
  aOk = !!r.ok
  const list = r.json?.result?.list || []
  aCount = list.length
  if (!aOk) aHint = String(r.hint || r.kind || '').slice(0, 90)
} catch (e) {
  aHint = String(e.message).slice(0, 90)
}
const msA = Date.now() - tA
console.log(`  耗时 ${(msA / 1000).toFixed(1)}s | ok=${aOk} | 条数=${aCount} | ec=${aEc}${aHint ? ' | ' + aHint : ''}`)

// ── B 组：现有技能 ──
console.log('\n[B 组] 现有技能（开浏览器）')
const tB = Date.now()
const bRes = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'skills/pdd-chance/scripts/chance.mjs'), '--account', SHOP, '--mode', 'list', '--size', '20'], {
    cwd: path.join(ROOT, 'skills/pdd-chance'), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} resolve({ ok: false, reason: 'timeout' }) }, 180000)
  child.stdout.on('data', d => { out += String(d) })
  child.stderr.on('data', d => { out += String(d) })
  child.on('close', () => {
    clearTimeout(timer)
    const line = out.split(/\r?\n/).find(l => l.includes('__DSAGENT_RESULT__'))
    if (!line) return resolve({ ok: false, reason: out.slice(-150).replace(/\s+/g, ' ') })
    try {
      const j = JSON.parse(line.slice(line.indexOf('__DSAGENT_RESULT__') + 18))
      resolve({ ok: !!j.ok, count: (j.items || []).length, fk: j.failureKind || '', text: String(j.text || '').slice(0, 90) })
    } catch { resolve({ ok: false, reason: 'parse' }) }
  })
})
const msB = Date.now() - tB
console.log(`  耗时 ${(msB / 1000).toFixed(1)}s | ok=${bRes.ok} | 条数=${bRes.count ?? 0}${bRes.fk ? ' | ' + bRes.fk : ''}${bRes.reason ? ' | ' + bRes.reason : ''}`)

// ── 对比 ──
console.log('\n' + '='.repeat(70))
console.log('组                    耗时      成功   条数')
console.log(`A 纯 Node       ${(msA / 1000).toFixed(1).padStart(8)}s  ${String(aOk).padStart(6)}  ${String(aCount).padStart(5)}`)
console.log(`B 现有(浏览器)  ${(msB / 1000).toFixed(1).padStart(8)}s  ${String(bRes.ok).padStart(6)}  ${String(bRes.count ?? 0).padStart(5)}`)
if (aOk && msB > 0) console.log(`\n提速: ${(msB / msA).toFixed(1)}×`)
else if (!aOk) console.log(`\n⚠️ 纯 Node 失败，原因见上（不影响现有技能）`)
console.log('')
