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

const SKILL_ROOT = process.env.DSAGENT_SKILL_ROOT
  || path.join(__dirname, '..', 'skills')
const WORKSPACE = process.env.DSAGENT_WORKSPACE
  || path.join(__dirname, '..')
const ACCOUNTS_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')
const PY = process.env.PYTHON || 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python310\\python.exe'

const CONCURRENCY = Number(process.argv[2] || 4)
const TIMEOUT_MS = 180_000

// ── 动态发现网关端口（gateway-proxy.ts 用 server.listen(0) 动态分配） ──
const http = require('node:http')
function probeHealth(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/v1/health`, { timeout: 1500 }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => resolve(res.statusCode === 200))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}
async function discoverGateway() {
  if (process.env.DSCONNECT_URL) return process.env.DSCONNECT_URL
  const known = [25360, 14082, 21423, 23154, 47850, 56169]
  for (const p of known) if (await probeHealth(p)) return `http://127.0.0.1:${p}`
  for (let base = 14000; base < 60000; base += 100) {
    const ps = []
    for (let i = 0; i < 100; i++) ps.push(probeHealth(base + i))
    const results = await Promise.all(ps)
    for (let i = 0; i < results.length; i++) {
      if (results[i]) return `http://127.0.0.1:${base + i}`
    }
  }
  return 'http://127.0.0.1:25360'
}

// ── 通过 secure-store.js 解密凭证库（与 index.ts findStoredAccount 对齐） ──
let GATEWAY_URL = 'http://127.0.0.1:25360'
let ACCOUNTS = {}
function loadAccountsViaSecureStore() {
  try {
    const { decodeCredentialsFile } = require(path.join(__dirname, '..', 'lib', 'services', 'secure-store.js'))
    const r = decodeCredentialsFile(ACCOUNTS_FILE, o => {
      if (!o || typeof o !== 'object' || !o.accounts) return null
      return o
    })
    if (!r.ok) {
      console.error(`[batch-test] 凭证库加载失败: ${r.reason} ${r.detail || ''}`)
      return {}
    }
    return r.data.accounts || {}
  } catch (err) {
    console.error(`[batch-test] 无法加载 secure-store: ${err.message}`)
    return {}
  }
}

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
const SCRIPT_CALL_RE2 = /\{this_skill_dir\}\/?(scripts\/[\w./-]+\.py)/
// 通用匹配：cd "{this_skill_dir}" && python scripts/xxx.py
const SCRIPT_CALL_RE3 = /python\s+(scripts\/[\w./-]+\.py)/
const MODULE_RE = /python\s+-m\s+(\S+)/
function findScript(body) {
  let m = body.match(SCRIPT_CALL_RE)
  if (m) return m[1]
  m = body.match(SCRIPT_CALL_RE2)
  if (m) return m[1]
  m = body.match(SCRIPT_CALL_RE3)
  if (m) return m[1]
  return null
}
function findModuleName(body, skillId) {
  // 从 SKILL.md 提取 python -m <pkg> 的实际包名（可能与 skill.id 不同）
  const pkg = skillId.replace(/-/g, '_')
  // 优先匹配 skill.id 转换的包名
  if (body.includes(`-m ${pkg}`) || body.includes(`-m ${skillId}`)) return pkg
  // 从正文提取任意 python -m <name>
  const m = body.match(MODULE_RE)
  if (m) return m[1]
  return null
}
function buildCommand(skill, request, explicitArgs) {
  const body = skill.body
  const pkg = skill.id.replace(/-/g, '_')
  const args = explicitArgs || extractTokens(request)
  if (request.includes('inject-report')) return [PY, '-m', pkg, 'inject-report']
  // 1) 尝试从 SKILL.md 提取实际模块名
  const modName = findModuleName(body, skill.id)
  if (modName) return [PY, '-m', modName, ...args]
  // 2) 尝试从 SKILL.md 提取脚本路径
  const script = findScript(body)
  if (script) return [PY, path.join(skill.dir, script), ...args]
  // 3) 尝试 scripts/ 下已知入口文件名
  for (const entry of ['main.py', 'run.py', 'fetch_data.py', 'cli.py']) {
    if (body.includes(entry)) return [PY, path.join(skill.dir, 'scripts', entry), ...args]
  }
  return null
}

// ── 账号查找（与 account.findStoredAccount 对齐：精确 platform 优先） ──
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
  { id: 'keyword-assistant', request: '手机壳搜索热度', args: ['手机壳', '--max_pages', '1'] },
  { id: 'keyword-traffic', request: '充电宝流量趋势', args: ['trend', '充电宝', '--cate_id', '201272600', '--months', '6'] },
  { id: 'market-trend', request: '女装市场趋势', args: ['--cate_id', '50011999'] },
  { id: 'market-analysis', request: '手机壳市场行情', args: ['帮我看看手机壳的趋势'] },
  { id: 'competitor-indicator', request: '竞品受众指标', args: ['overall', '--competitor-ids', '1025781404398', '--entity-id', '720562597763', '--begin-date', '2026-06-01', '--end-date', '2026-06-07', '--peer-begin-date', '2026-05-25', '--peer-end-date', '2026-05-31'] },
  { id: 'competitor-strategy-comparison', request: '竞品策略对比', args: ['overall', '--item-id', '614498626290', '--competitor-id', '1025781404398', '--start-date', '2026-06-01', '--end-date', '2026-06-07'] },
  { id: 'sycm-customer', request: '店铺客户分析', args: ['--date', '2026-10-10'] },
  { id: 'store-patrol-manager', request: '店铺巡检', args: ['summary', '--facts', 'artifacts/patrol_facts.json'] },
  { id: 'product-reviews', request: '商品评价', args: ['614498626290', '--max_pages', '1'] },
  { id: 'product-wdj', request: '问大家', args: ['762128994852', '--max_pages', '1'] },
  { id: 'xianyu-crawl', request: '帮我在闲鱼搜索 手机壳' },
  { id: 'xiaohongshu-crawl', request: '帮我搜索小红书上的 手机壳 笔记' },
  { id: 'zhihu-crawl', request: '帮我采集知乎上的 手机壳 相关问题' },
]

async function probeAndRefresh(platform, shopKey) {
  if (!shopKey || !platform) return
  try {
    const probeData = JSON.stringify({ action: 'probe_session', platform, shopKey })
    await new Promise(resolve => {
      const req = http.request({
        hostname: '127.0.0.1', port: 3080, path: '/dsagent/api', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(probeData) }
      }, res => { let b = ''; res.on('data', () => {}); res.on('end', resolve) })
      req.write(probeData)
      req.end()
    })
    // probe 后重新加载凭证库
    ACCOUNTS = loadAccountsViaSecureStore()
  } catch {}
}

async function runOne(c) {
  const skill = readSkill(c.id)
  if (!skill) return { ...c, status: 'NO_SKILL_MD', ms: 0 }
  const cmd = buildCommand(skill, c.request, c.args)
  if (cmd === null) return { ...c, status: 'INSTRUCTION_ONLY', cmd: '(null)', ms: 0 }

  const platform = requiredPlatform(c.id)

  // 执行前先 probe 刷新账号状态，避免之前的请求失败把 status 改回 expired
  const preAcc = platform ? findStoredAccount(platform) : null
  if (preAcc) await probeAndRefresh(platform, preAcc.shop_key)

  // 重新加载后的账号
  const acc = platform ? findStoredAccount(platform) : null
  const env = {
    ...process.env,
    DSAGENT_WORKSPACE: WORKSPACE,
    DSAGENT_SKILL_ROOT: SKILL_ROOT,
    DSAGENT_REQUEST: c.request,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    DSCONNECT_URL: GATEWAY_URL,
    DSCONNECT_TOKEN: 'local',
    DSCONNECT_AGENT_ID: 'default',
  }
  if (acc) {
    env.DSAGENT_COOKIE = acc.cookie_str || ''
    env.DSAGENT_PLATFORM = acc.platform
    env.DSAGENT_ACCOUNT_ID = acc.account_id || ''
    env.DSAGENT_TB_TOKEN = acc.tb_token || ''
    env.DSCONNECT_SHOP_KEY = acc.shop_key || ''
  }

  return new Promise(resolve => {

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

// 与 skill-service.ts tryLooseJson 对齐：从 stdout 尾部找松散 JSON
function tryLooseJson(stdout) {
  const text = stdout.trim()
  if (!text) return null
  let start = text.indexOf('{')
  if (start < 0) start = text.indexOf('[')
  if (start < 0) return null
  try { return JSON.parse(text.slice(start)) } catch { return null }
}

function summarize(r) {
  if (r.status === 'NO_SKILL_MD') return 'SKILL.md 缺失'
  if (r.status === 'INSTRUCTION_ONLY') return '⚠️ 退化为纯指令型（命令构建失败）'
  if (r.status === 'SPAWN_ERROR') return `❌ 启动失败: ${r.spawnError}`
  if (r.status === 'TIMEOUT') return '⏱️ 超时'

  // 先尝试 __DSAGENT_RESULT__ 前缀，再回退裸 JSON（与 skill-service.ts 对齐）
  let p = r.payload
  if (!p && r.stdout) p = tryLooseJson(r.stdout)
  const hasFiles = r.stderr && r.stderr.includes('---[OUTPUT_FILES]')

  if (!p) {
    if (hasFiles) return `✅ 产出文件（exit=${r.exitCode}）`
    return `❌ 无结果（exit=${r.exitCode}）`
  }
  // ok 字段协议（爬虫类）
  if (p.ok === false) return `❌ ok=false ${String(p.error_message || p.error || '').slice(0, 120)}`
  if (p.ok === true) {
    const d = p.data
    const n = Array.isArray(d) ? d.length : (d && typeof d === 'object' ? Object.keys(d).length : 0)
    return `✅ ok=true data=${n}${p.report_path ? ' +report' : ''}`
  }
  // status 字段协议（阿里系技能）
  if (p.status === 'error') return `❌ status=error code=${p.error_code} ${String(p.error_message || p.message || '').slice(0, 120)}`
  if (p.status === 'success') {
    const n = p.total_results ?? p.total_items ?? p.item_count ?? (p.data ? (Array.isArray(p.data) ? p.data.length : Object.keys(p.data).length) : 0)
    return `✅ status=success data=${n}${hasFiles ? ' +files' : ''}`
  }
  return `? 未知格式: ${JSON.stringify(p).slice(0, 120)}`
}

;(async () => {
  GATEWAY_URL = await discoverGateway()
  ACCOUNTS = loadAccountsViaSecureStore()
  const validCount = Object.values(ACCOUNTS).filter(a => a.status !== 'invalid').length
  // 支持环境变量 SKILL_FILTER 过滤要测的技能（逗号分隔）
  const filter = process.env.SKILL_FILTER
  const cases = filter ? CASES.filter(c => filter.split(',').map(s => s.trim()).includes(c.id)) : CASES
  console.log(`网关=${GATEWAY_URL}  Python=${PY}  并发=${CONCURRENCY}  用例=${cases.length}  有效账号=${validCount}`)
  const t0 = Date.now()
  const results = await pool(cases, CONCURRENCY, runOne)
  console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
  console.log('| 技能 | 平台 | 命令 | 状态 | 耗时 |')
  console.log('|------|------|------|------|------|')
  for (const r of results) {
    console.log(`| ${r.id} | ${r.platform || '-'} | \`${(r.cmd || '-').slice(0, 70)}\` | ${summarize(r)} | ${(r.ms / 1000).toFixed(1)}s |`)
  }
  fs.writeFileSync(path.join(__dirname, '..', 'batch-test-result.json'), JSON.stringify(results, null, 2))
  console.log('\n明细已写入 batch-test-result.json')
})()
