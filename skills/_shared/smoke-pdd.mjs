/**
 * smoke-pdd.mjs —— 拼多多技能最小回归（只读，零写操作）
 *
 * 用途：基座大改之后，验证 8 个 skill 没被改坏。
 * 全部用**最轻的只读 mode**，不发布、不改价、不报名、不删任何东西。
 *
 * 用法：
 *   node smoke-pdd.mjs --account pdd_mms_xxx
 *   node smoke-pdd.mjs --account pdd_mms_xxx --skip pdd-promo,pdd-video
 *   node smoke-pdd.mjs --account pdd_mms_xxx --timeout 120
 *
 * 判读：
 *   PASS      正常返回（ok:true 或至少拿到业务数据）
 *   RATE      被风控冷却（rate_limit）—— 不是代码问题，等或换号
 *   TOKEN     登录态过期（token_expired）—— 需重新扫码
 *   FAIL      代码/参数问题 —— 需要修
 *
 * 退出码：0 = 全部 PASS 或 RATE/TOKEN（账号问题，非代码问题）；1 = 有 FAIL
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.resolve(HERE, '..')
const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
const ACCOUNT = arg('account')
const TIMEOUT = Number(arg('timeout', '180')) * 1000
// ★ 用例间隔：pnnd-guard 的「不背靠背」会在上一个 close 后强制等 30s，
//   回归脚本自己先等，避免把「等待」算进用例耗时导致误判 TIMEOUT
// ★ 2026-11-05：默认 60s。原因：9 个技能连打同一账号 = 平台眼中的脚本行为，
//   35s 实测会累积到 54001。宁可慢，也不要为了跑回归把账号打伤。
const CASE_GAP_MS = Number(arg('gap', '60')) * 1000
const SKIP = new Set(arg('skip', '').split(',').map(s => s.trim()).filter(Boolean))
// ★ 分批跑：--only 只跑指定的，--max 限制个数
const ONLY = new Set(arg('only', '').split(',').map(s => s.trim()).filter(Boolean))
const MAX = Number(arg('max', '0'))

if (!ACCOUNT) {
  console.error('用法: node smoke-pdd.mjs --account pdd_mms_xxx [--skip pdd-promo] [--timeout 180]')
  process.exit(2)
}

/** 每个 skill 的最轻只读调用 */
const CASES = [
  // ── L2 写操作型：只跑「无 --confirm」的预览/校验分支（零写操作、不启浏览器）──
  { skill: 'pdd-publish', script: 'publish-v2.mjs', args: ['--product-file', '__smoke_product__'], desc: '上架预检（无 confirm，零写）', l2: true, expectNeedConfirm: true },

  { skill: 'pdd-works', script: 'query.mjs', args: ['--mode', 'list'], desc: '商品列表（只读）' },
  { skill: 'pdd-shop', script: 'shop.mjs', args: ['--mode', 'overview'], desc: '店铺总览（只读）' },
  { skill: 'pdd-promo', script: 'promo.mjs', args: ['--mode', 'overview'], desc: '推广总览（只读）' },
  { skill: 'pdd-activity', script: 'activity.mjs', args: ['--mode', 'overview'], desc: '活动总览（只读）' },
  { skill: 'pdd-chance', script: 'chance.mjs', args: ['--mode', 'list'], desc: '机会商品（只读）' },
  { skill: 'pdd-video', script: 'video.mjs', args: ['--mode', 'list'], desc: '视频列表（只读）' },
  { skill: 'pdd-ai-video', script: 'gen-video.mjs', args: ['--mode', 'quota'], desc: 'AI视频额度（只读）' },
  { skill: 'pdd-crawl', lib: 'lib/pdd-crawl.js', fn: 'pddCrawl', args: { mode: 'feed', limit: '5' }, desc: 'H5 推荐流（只读）' },
]


/** 生成 smoke 用的临时商品文件（内容合法但不真实，只为过校验） */
function makeSmokeProduct() {
  const dir = path.join(SKILLS_DIR, '..', 'artifacts', 'smoke')
  fs.mkdirSync(dir, { recursive: true })
  const img = path.join(dir, 'smoke-img.png')
  if (!fs.existsSync(img)) {
    // 1x1 透明 PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    fs.writeFileSync(img, Buffer.from(b64, 'base64'))
  }
  const product = {
    title: 'SMOKE_TEST_勿发布_删除',
    images: [img],
    detailImages: [],
    category: '纸杯',
    price: '9.90',
    stock: '1',
    specs: [{ name: '容量', values: [{ value: '250ml' }] }],
    skus: [{ specs: { 容量: '250ml' }, price: '9.90', stock: '1' }],
    attributes: [],
  }
  const pf = path.join(dir, 'smoke-product.json')
  fs.writeFileSync(pf, JSON.stringify(product, null, 2), 'utf8')
  const vf = path.join(dir, 'smoke-variants.json')
  fs.writeFileSync(vf, JSON.stringify([{ title: 'SMOKE_TEST_勿发布_A' }], null, 2), 'utf8')
  return { pf, vf }
}

const SMOKE_FILES = makeSmokeProduct()

function runOne(c) {
  // ★ 库函数型（pdd-crawl 是 TS 编译产物，无 CLI）
  if (c.lib) {
    return (async () => {
      try {
        const storeMod = await import(pathToFileURL(path.join(SKILLS_DIR, '..', 'lib', 'services', 'credential-store.js')).href)
        const crawlMod = await import(pathToFileURL(path.join(SKILLS_DIR, '..', c.lib)).href)
        const store = new storeMod.CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
        const r = await crawlMod[c.fn](store, { account: ACCOUNT, ...c.args })
        const txt = String(r?.text || '')
        let status = r?.ok ? 'PASS' : (/未登录|登录态|重新扫码/.test(txt) ? 'TOKEN' : 'FAIL')
        return { ...c, status, detail: (txt || r?.failureKind || '').slice(0, 120).replace(/\s+/g, ' '), ec: r?.failureKind }
      } catch (e) {
        return { ...c, status: 'FAIL', detail: String(e?.message || e).slice(0, 120) }
      }
    })()
  }
  return new Promise((resolve) => {
    /**
     * ★ 2026-11-20 修：入口路径**以 contract.json 为准**，不再硬拼 `scripts/`。
     *
     *   事故：冒烟脚本写死 `path.join(dir,'scripts',c.script)` 且 CASES 里写的是
     *   `publish-v2.mjs`，而 pdd-publish 早已重构为 16 步链路，
     *   真实入口是 `steps/index.mjs`（见其 contract.json）。
     *   → 冒烟长期报「脚本不存在」，让人误以为技能坏了。
     *
     *   现在：先读 contract.entry.script；读不到再回落到旧的 scripts/<name> 约定。
     *   这样技能内部怎么调结构都不会再让冒烟误报。
     */
    const skillDir = path.join(SKILLS_DIR, c.skill)
    let entry = ''
    try {
      const contract = JSON.parse(fs.readFileSync(path.join(skillDir, 'contract.json'), 'utf8'))
      const s = contract?.entry?.script
      if (s) entry = path.join(skillDir, s)
    } catch { /* 没有 contract 就走回落 */ }
    if (!entry || !fs.existsSync(entry)) {
      entry = path.join(skillDir, 'scripts', c.script)
    }
    if (!fs.existsSync(entry)) return resolve({ ...c, status: 'FAIL', detail: '脚本不存在: ' + entry })

    const realArgs = c.args.map(a =>
      a === '__smoke_product__' ? SMOKE_FILES.pf
        : a === '__smoke_variants__' ? SMOKE_FILES.vf
        : a === '__smoke_variants_json__' ? JSON.stringify([{ title: 'SMOKE_TEST_勿发布_A' }])
        : a)
    const child = spawn(process.execPath, [entry, '--account', ACCOUNT, ...realArgs], {
      cwd: path.join(SKILLS_DIR, c.skill),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let out = '', err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ ...c, status: 'TIMEOUT', detail: `超过 ${TIMEOUT / 1000}s 未完成` })
    }, TIMEOUT)

    child.stdout.on('data', d => { out += String(d) })
    child.stderr.on('data', d => { err += String(d) })
    child.on('close', () => {
      clearTimeout(timer)
      // 取 __DSAGENT_RESULT__ 那一行
      const line = out.split(/\r?\n/).find(l => l.includes('__DSAGENT_RESULT__'))
      let obj = null
      if (line) {
        try { obj = JSON.parse(line.slice(line.indexOf('__DSAGENT_RESULT__') + '__DSAGENT_RESULT__'.length)) } catch { /* ignore */ }
      }
      if (!obj) {
        // 没有结构化结果：看异常
        const fatal = /Error:|异常/.test(err + out)
        return resolve({ ...c, status: fatal ? 'FAIL' : 'UNKNOWN', detail: (err || out).slice(0, 160).replace(/\s+/g, ' ') })
      }
      const fk = obj.failureKind || ''
      // ★ L2 用例：needConfirm=true 表示「进到了预览分支且没有提交」= 符合预期
      if (c.expectNeedConfirm) {
        if (obj.needConfirm === true) return resolve({ ...c, status: 'PASS', detail: '已到预览分支，未提交 ✓' })
        if (fk === 'rate_limit') return resolve({ ...c, status: 'RATE', detail: '闸门拦住（正常）' })
        if (fk === 'token_expired') return resolve({ ...c, status: 'TOKEN', detail: '登录过期' })
        return resolve({ ...c, status: 'FAIL', detail: '未进预览分支: ' + (obj.text || '').slice(0, 110).replace(/\s+/g, ' ') })
      }
      let status = 'PASS'
      const txt = String(obj.text || '')
      // ★ 2026-11-05：有些技能把域未登录包成了 api_error（如 pdd-video 的 live 域），
      //   靠文案识别，否则会误报成代码问题。
      const looksAuth = /未登录|登录态|重新扫码|token_expired|login\/sso|未就绪.*登录/i.test(txt)
      if (fk === 'rate_limit') status = 'RATE'
      else if (fk === 'token_expired' || looksAuth) status = 'TOKEN'
      else if (obj.ok === false) status = 'FAIL'
      resolve({ ...c, status, detail: (obj.text || '').slice(0, 120).replace(/\s+/g, ' '), ec: obj.ec })
    })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ...c, status: 'FAIL', detail: e.message.slice(0, 120) }) })
  })
}

console.log(`\n拼多多技能最小回归 · 账号 ${ACCOUNT.slice(-8)} · ${CASES.filter(c => !SKIP.has(c.skill)).length} 个 skill\n${'='.repeat(78)}`)
const results = []
let _first = true
for (const c of CASES) {
  if (SKIP.has(c.skill) || (ONLY.size && !ONLY.has(c.skill))) { console.log(`⏭  ${c.skill.padEnd(16)} 跳过`); continue }
  if (MAX > 0 && results.length >= MAX) { console.log(`⏭  ${c.skill.padEnd(16)} 超出 --max ${MAX}`); continue }
  if (!_first) await new Promise(r => setTimeout(r, CASE_GAP_MS))
  _first = false
  process.stdout.write(`…  ${c.skill.padEnd(16)} ${c.desc} ... `)
  let r = await runOne(c)
  // ★ 2026-11-05：detached Frame / 启动失败 属偶发（页面被上一轮关掉或端口残留），
  //   自动重试一次；仍失败才算真失败。单独跑必过 → 说明不是代码问题。
  if (r.status === 'FAIL' && /detached Frame|Failed to launch the browser process|Target closed|Protocol error|Session closed|Navigation failed/i.test(String(r.detail || ''))) {
    console.log('   ↻ 偶发错误，重试一次…')
    await new Promise(s => setTimeout(s, 20000))
    r = await runOne(c)
  }
  results.push(r)
  const icon = r.status === 'PASS' ? '✅' : r.status === 'RATE' ? '⏸' : r.status === 'TOKEN' ? '🔑' : '❌'
  console.log(`${icon} ${r.status}${r.ec ? ' (ec=' + r.ec + ')' : ''}`)
  if (r.status !== 'PASS' && r.detail) console.log(`    ${r.detail}`)
}

const g = (s) => results.filter(r => r.status === s).length
console.log('='.repeat(78))
console.log(`PASS ${g('PASS')} | RATE ${g('RATE')} | TOKEN ${g('TOKEN')} | FAIL ${g('FAIL')} | TIMEOUT ${g('TIMEOUT')} | UNKNOWN ${g('UNKNOWN')}`)

const failed = results.filter(r => ['FAIL', 'TIMEOUT', 'UNKNOWN'].includes(r.status))
if (failed.length) {
  console.log('\n需要修的：')
  for (const f of failed) console.log(`  ❌ ${f.skill}: ${f.detail}`)
  process.exit(1)
}
if (g('RATE') || g('TOKEN')) {
  console.log('\n⚠️ 有账号问题（不是代码问题）：RATE=等冷却/换号，TOKEN=重新扫码')
}
console.log('\n✅ 无代码级失败\n')

// 落盘
const outDir = path.join(SKILLS_DIR, '..', 'artifacts', 'smoke')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, `smoke-${Date.now()}.json`),
  JSON.stringify({ at: new Date().toISOString(), account: ACCOUNT, results }, null, 2), 'utf8')

// ★ 清理临时商品 JSON（图片保留复用，避免每次重建）
try {
  fs.rmSync(SMOKE_FILES.pf, { force: true })
  fs.rmSync(SMOKE_FILES.vf, { force: true })
} catch { /* ignore */ }
