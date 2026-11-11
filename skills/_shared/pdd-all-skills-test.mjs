/**
 * pdd-all-skills-test.mjs —— 拼多多全技能回归测试
 *
 * 逐个跑各 skill 的只读模式，每个之间：
 *   · 清账号锁（避免上一个没放锁导致「正被其他任务占用」）
 *   · 清 Chrome 残留（避免 Profile 锁）
 *   · 清 needRelogin（避免瞬时 43001 永久锁号）
 *
 * 输出：每个技能 ok / failureKind / 耗时 / 一句话结论
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const SK = process.argv[2] || 'pdd_mms_25f216caa8b4b688125881972162f76f'
const ONLY = process.argv[3] || ''

const CASES = [
  // ── pdd-shop ──
  ['pdd-shop', 'scripts/shop.mjs', ['--mode', 'overview']],
  ['pdd-shop', 'scripts/shop.mjs', ['--mode', 'flow']],
  ['pdd-shop', 'scripts/shop.mjs', ['--mode', 'score']],
  ['pdd-shop', 'scripts/shop.mjs', ['--mode', 'goods', '--limit', '3']],
  // ── pdd-works ──
  ['pdd-works', 'scripts/query.mjs', ['--mode', 'overview', '--limit', '5']],
  // ── pdd-chance ──
  ['pdd-chance', 'scripts/chance.mjs', ['--mode', 'list', '--size', '10']],
  ['pdd-chance', 'scripts/chance.mjs', ['--mode', 'filters']],
  ['pdd-chance', 'scripts/chance.mjs', ['--mode', 'cates']],
  ['pdd-chance', 'scripts/chance.mjs', ['--mode', 'labels']],
  ['pdd-chance', 'scripts/chance.mjs', ['--mode', 'mission']],
  // ── pdd-promo ──
  ['pdd-promo', 'scripts/promo.mjs', ['--mode', 'overview']],
  ['pdd-promo', 'scripts/promo.mjs', ['--mode', 'units']],
  ['pdd-promo', 'scripts/promo.mjs', ['--mode', 'daily', '--days', '7']],
  // ── pdd-video ──
  ['pdd-video', 'scripts/video.mjs', ['--mode', 'list']],
  ['pdd-video', 'scripts/video.mjs', ['--mode', 'qualify']],
  ['pdd-video', 'scripts/video.mjs', ['--mode', 'topics']],
  ['pdd-video', 'scripts/video.mjs', ['--mode', 'anchor']],
  // ── pdd-activity ──
  ['pdd-activity', 'scripts/activity.mjs', ['--mode', 'overview']],
  ['pdd-activity', 'scripts/activity.mjs', ['--mode', 'types']],
  ['pdd-activity', 'scripts/activity.mjs', ['--mode', 'stats']],
  ['pdd-activity', 'scripts/activity.mjs', ['--mode', 'effect']],
  // ── pdd-ai-video ──
  ['pdd-ai-video', 'scripts/gen-video.mjs', ['--mode', 'quota']],
  // ── pdd-publish-http（类目查询，纯 Node 部分）──
  ['pdd-publish-http', 'scripts/pdd-category.mjs', ['template', '--cat-id', '8463']],
  ['pdd-publish-http', 'scripts/pdd-category.mjs', ['search', '--keyword', 'T恤']],
  // ── pdd-link-matrix（参数校验，不实际发请求）──
  ['pdd-link-matrix', 'scripts/matrix.mjs', ['--help']],
]

function clearLocks() {
  for (const d of ['pdd-account-locks']) {
    try {
      const dir = path.join(os.homedir(), '.dsh', d)
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.lock')) fs.rmSync(path.join(dir, f), { force: true })
    } catch { /* ignore */ }
  }
}

function killChrome() {
  try { execFileSync('taskkill', ['/IM', 'chrome.exe', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* none */ }
}

async function clearRelogin() {
  try {
    const m = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-antiban.mjs')).href)
    m.clearCooldown?.(SK)
  } catch { /* ignore */ }
}

function runOne(skill, script, args) {
  return new Promise((resolve) => {
    const p = path.join(ROOT, 'skills', skill, script)
    if (!fs.existsSync(p)) return resolve({ ok: false, kind: 'missing_script', ms: 0, text: `脚本不存在: ${script}` })
    const t0 = Date.now()
    const child = spawn(process.execPath, [p, ...args, '--account', SK], {
      cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const timer = setTimeout(() => { try { child.kill() } catch {} }, 240000)
    child.on('close', () => {
      clearTimeout(timer)
      const ms = Date.now() - t0
      const line = out.split('\n').find((l) => l.includes('__DSAGENT_RESULT__'))
      let j = null
      if (line) { try { j = JSON.parse(line.replace('__DSAGENT_RESULT__', '')) } catch {} }
      resolve({
        ok: !!j?.ok,
        kind: j?.failureKind || (j?.ok ? 'ok' : 'no_result'),
        ms,
        text: String(j?.text || err.split('\n').filter(Boolean).slice(-1)[0] || '').replace(/\s+/g, ' ').slice(0, 110),
        ec: j?.ec,
      })
    })
  })
}

const results = []
for (const [skill, script, args] of CASES) {
  const label = `${skill} ${args.filter(a => !a.startsWith('--account')).join(' ')}`
  if (ONLY && !label.includes(ONLY)) continue
  clearLocks()
  await clearRelogin()
  await new Promise(r => setTimeout(r, 800))
  const r = await runOne(skill, script, args)
  results.push({ label, ...r })
  const icon = r.ok ? 'OK  ' : 'FAIL'
  console.log(`${icon} ${label.padEnd(52)} ${String(r.ms).padStart(6)}ms  ${r.ok ? '' : `[${r.kind}] ${r.text}`}`)
  // 每个之后清 Chrome（下次要开浏览器时才不会被上一个占住）
  killChrome()
  await new Promise(r => setTimeout(r, 1500))
}

const okN = results.filter(r => r.ok).length
console.log('\n' + '='.repeat(72))
console.log(`总计 ${results.length} 项 | 通过 ${okN} | 失败 ${results.length - okN}`)
console.log('='.repeat(72))
const bad = results.filter(r => !r.ok)
if (bad.length) {
  console.log('\n失败明细：')
  for (const b of bad) console.log(`  · ${b.label}\n      kind=${b.kind} ec=${b.ec ?? '-'}  ${b.text}`)
}
fs.writeFileSync(path.join(ROOT, 'artifacts', 'pdd-all-skills-test.json'), JSON.stringify(results, null, 1), 'utf8')
