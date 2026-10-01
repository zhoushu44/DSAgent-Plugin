#!/usr/bin/env node
/**
 * 批量实跑技能 —— 完全复现插件 dsagent_execute_skill 的管线：
 *   cwd = skill.dir
 *   env = process.env + 网关三件套 + DSAGENT_* + DSAGENT_COOKIE
 *   command = buildCommand(SKILL.md 正文, request)   ← 与 skill-service.ts 同逻辑
 *
 * 用法：node scripts/batch-test-skills.cjs [并发数]
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const SKILL_ROOT = 'e:\\360MoveData\\Users\\Administrator\\Desktop\\deepseek-agent\\skills'
const WORKSPACE = 'e:\\360MoveData\\Users\\Administrator\\Desktop\\deepseek-agent'
const GATEWAY = process.env.DSCONNECT_URL || 'http://127.0.0.1:25360'
const ACCOUNTS_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')
const PY = process.env.PYTHON || 'C:\\Python312\\python.exe'

const CONCURRENCY = Number(process.argv[2] || 4)
const TIMEOUT_MS = 180_000

// ── 与 index.ts BINDING_RULES 对齐 ──
const BINDING_RULES = [
  ['sycm-customer', 'sycm'], ['competitor-strategy-comparison', 'sycm'],
  ['competitor-indicator', 'sycm'], ['keyword-assistant', 'sycm'],
  ['keyword-traffic', 'sycm'], ['market-trend', 'sycm'], ['store-patrol-manager', 'sycm'],
  ['product-reviews', 'taobao'], ['product-wdj', 'taobao'], ['market-analysis', 'taobao'],
  ['douyin-crawl', 'douyin'], ['zhihu-crawl', 'zhihu'], ['xiaohongshu-crawl', 'xhs'],
  ['xianyu-crawl', 'xianyu'],
]
function requiredPlatform(id) {
  for (const [k, p] of BINDING_RULES) if (id === k || id.startsWith(k)) return p
  return null
}

// ── 与 account-service.ts extractTokens 对齐 ──
const ARG_TOKEN_RE = /(?<![0-9A-Za-z_])(\d{5,13}|[A-Za-z]{1,6}_?\d{3,12})(?![0-9A-Za-z])/g
function extractTokens(text) {
  if (!text) return []
  const seen = []
  for (const m of text.matchAll(ARG_TOKEN_RE)) if (m[1] && !seen.includes(m[1])) seen.push(m[1])
  return seen
}

// ── 与 skill-service.ts findScript / buildCommand 对齐 ──
const SCRIPT_CALL_RE = /\{baseDir\}\/(scripts\/[\w./-]+\.py)/
function findScript(body) {
  const m = body.match(SCRIPT_CALL_RE)
  return m ? m[1] : null
}
function buildCommand(skill, request) {
  const body = skill.body
  const pkg = skill.id.replace(/-/g, '_')
  const args = extractTokens(request)
  if (request.includes('inject-report')) return [PY, '-m', pkg, 'inject-report']
  if (body.includes(`-m ${pkg}`) || body.includes(`-m ${skill.id}`)) return [PY, '-m', pkg, ...args]
  const script = findScript(body)
  if (script) return [PY, path.join(skill.dir, script), ...args]
  for (const entry of ['main.py', 'run.py', 'fetch_data.py', 'cli.py']) {
    if (body.includes(entry)) return [PY, path.join(skill.dir, 'scripts', entry), ...args]
  }
  return null
}

// ── 账号查找（与 account.findStoredAccount 对齐：精确 platform 优先） ──
function loadAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')).accounts || {} } catch { return {} }
}
const ACCOUNTS = loadAccounts()
const CREDENTIAL_PLATFORM = { alimama: 'sycm', dmp: 'sycm', sycm_insight: 'sycm' }
function findStoredAccount(platform, agentId = 'default') {
  const all = Object.values(ACCOUNTS)
  const exact = all.filter(a => a.platform === platform && a.status !== 'invalid')
  const cred = CREDENTIAL_PLATFORM[platform] || platform
  const fallback = all.filter(a => a.platform !== platform && a.credential_platform === cred && a.status !== 'invalid')
  const pool = exact.length ? exact : fallback
  if (!pool.length) return null
  const bound = pool.find(a => (a.bound_agent_ids || []).includes(agentId))
  return bound || pool[0]
}

function readSkill(id) {
  const dir = path.join(SKILL_ROOT, id)
  const md = path.join(dir, 'SKILL.md')
  if (!fs.existsSync(md)) return null
  return { id, dir, body: fs.readFileSync(md, 'utf8') }
}

// ── 测试用例：request 用自然语言（与 UI 对话一致） ──
const CASES = [
  { id: 'keyword-assistant', request: '用关键词助手帮我分析一下手机壳的搜索热度' },
  { id: 'keyword-traffic', request: '帮我看看充电宝这个关键词的流量趋势' },
  { id: 'market-trend', request: '帮我看一下女装类目的市场趋势' },
  { id: 'market-analysis', request: '帮我分析淘宝上手机壳这个品类的市场行情' },
  { id: 'competitor-indicator', request: '帮我分析一下竞品的受众指标' },
  { id: 'competitor-strategy-comparison', request: '帮我对比一下竞品的策略' },
  { id: 'sycm-customer', request: '帮我看一下店铺的客户分析' },
  { id: 'store-patrol-manager', request: '帮我做一次店铺巡检' },
  { id: 'product-reviews', request: '帮我采集商品 614498626290 的评价' },
  { id: 'product-wdj', request: '帮我采集商品 762128994852 的问大家' },
  { id: 'xianyu-crawl', request: '帮我在闲鱼搜索 手机壳' },
  { id: 'xiaohongshu-crawl', request: '帮我搜索小红书上的 手机壳 笔记' },
  { id: 'zhihu-crawl', request: '帮我采集知乎上的 手机壳 相关问题' },
  { id: 'a-stock-diagnosis', request: '查一下贵州茅台的股票诊断' },
  { id: 'pywencai-stock', request: '帮我查一下今日涨幅前10的股票' },
]

function runOne(c) {
  return new Promise(resolve => {
    const skill = readSkill(c.id)
    if (!skill) return resolve({ ...c, status: 'NO_SKILL_MD', ms: 0 })
    const cmd = buildCommand(skill, c.request)
    if (cmd === null) return resolve({ ...c, status: 'INSTRUCTION_ONLY', cmd: '(null)', ms: 0 })

    const platform = requiredPlatform(c.id)
    const env = {
      ...process.env,
      DSAGENT_WORKSPACE: WORKSPACE,
      DSAGENT_SKILL_ROOT: SKILL_ROOT,
      DSAGENT_REQUEST: c.request,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      DSCONNECT_URL: GATEWAY,
      DSCONNECT_TOKEN: 'local',
      DSCONNECT_AGENT_ID: 'default',
    }
    if (platform) {
      const acc = findStoredAccount(platform)
      if (acc) {
        env.DSAGENT_COOKIE = acc.cookie_str || ''
        env.DSAGENT_PLATFORM = acc.platform
        env.DSAGENT_ACCOUNT_ID = acc.account_id || ''
        env.DSAGENT_TB_TOKEN = acc.tb_token || ''
      }
    }

    const t0 = Date.now()
    const proc = spawn(cmd[0], cmd.slice(1), { cwd: skill.dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', done = false
    const finish = (status, extra = {}) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { proc.kill('SIGKILL') } catch {}
      resolve({ ...c, status, cmd: cmd.join(' '), platform, ms: Date.now() - t0, stdout, stderr, ...extra })
    }
    const timer = setTimeout(() => finish('TIMEOUT'), TIMEOUT_MS)
    proc.stdout.on('data', d => { stdout += d.toString('utf8') })
    proc.stderr.on('data', d => { stderr += d.toString('utf8') })
    proc.on('error', e => finish('SPAWN_ERROR', { spawnError: e.message }))
    proc.on('close', code => {
      const line = stdout.split(/\r?\n/).find(l => l.startsWith('__DSAGENT_RESULT__'))
      let payload = null
      if (line) { try { payload = JSON.parse(line.slice('__DSAGENT_RESULT__'.length)) } catch {} }
      finish(code === 0 ? 'EXIT0' : `EXIT${code}`, { exitCode: code, hasPrefix: !!line, payload })
    })
  })
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

function summarize(r) {
  if (r.status === 'NO_SKILL_MD') return 'SKILL.md 缺失'
  if (r.status === 'INSTRUCTION_ONLY') return '⚠️ 退化为纯指令型（命令构建失败）'
  if (r.status === 'SPAWN_ERROR') return `❌ 启动失败: ${r.spawnError}`
  if (r.status === 'TIMEOUT') return '⏱️ 超时'
  const p = r.payload
  if (!r.hasPrefix) return `❌ 无 __DSAGENT_RESULT__（exit=${r.exitCode}）`
  if (p && p.ok === false) return `❌ ok=false failure_kind=${p.failure_kind || '?'} ${String(p.error_message || p.error || '').slice(0, 120)}`
  if (p && p.ok === true) {
    const d = p.data
    const n = Array.isArray(d) ? d.length : (d && typeof d === 'object' ? Object.keys(d).length : 0)
    return `✅ ok=true data=${n}${p.report_path ? ' +report' : ''}`
  }
  return `? 前缀存在但无 ok 字段: ${JSON.stringify(p).slice(0, 120)}`
}

;(async () => {
  console.log(`网关=${GATEWAY}  Python=${PY}  并发=${CONCURRENCY}  用例=${CASES.length}`)
  const t0 = Date.now()
  const results = await pool(CASES, CONCURRENCY, runOne)
  console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  console.log('| 技能 | 平台 | 命令 | 状态 | 耗时 |')
  console.log('|------|------|------|------|------|')
  for (const r of results) {
    console.log(`| ${r.id} | ${r.platform || '-'} | \`${(r.cmd || '-').slice(0, 70)}\` | ${summarize(r)} | ${(r.ms / 1000).toFixed(1)}s |`)
  }
  fs.writeFileSync(path.join(__dirname, '..', 'batch-test-result.json'), JSON.stringify(results, null, 2))
  console.log('\n明细已写入 batch-test-result.json')
})()
