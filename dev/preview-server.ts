/**
 * 最小宿主 stub：在浏览器里真实渲染两个页面，用于开发预览。
 *
 * 用途：Harness UI 插件的注册 API 尚未确定（TODO-03）。
 *       这层 stub 承担「宿主职责」——调用页面的 html() 渲染、再调 mount() 绑交互，
 *       与宿主 API 完全解耦，因此页面效果可在真实宿主接入前先验收。
 *
 * 启动：npx tsx dev/preview-server.ts
 * 访问：http://127.0.0.1:5199
 *
 * 注意：这是**开发预览工具**，不参与生产挂载，不被 cordis.yml 加载。
 */

import { createServer } from 'node:http'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { build } from 'esbuild'
import { createAccountService } from '../src/services/account-service'
import { createSkillService } from '../src/services/skill-service'
import { CredentialStore } from '../src/services/credential-store'
import { createWorkflowService } from '../src/workflow/service'
import { registerWorkflowApi } from '../src/workflow/api'
import { startGatewayProxy } from '../src/gateway-proxy'
import { requiredPlatform, guidedPlatform, guidedPlatformExtra } from '../src/bindings'
import { doBrowserLogin, closeBrowser } from '../src/browser-login'
import { loginOwnerPlatform } from '../src/services/credential-store'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 仓库根 = dev/ 的上一级（原 '../../..' 误把用户主目录当根，导致 SKILL_ROOT 指向不存在的目录）
const PROJECT_ROOT = resolve(__dirname, '..')
const SKILL_ROOT = join(PROJECT_ROOT, 'skills')

/**
 * 凭证库路径。
 * 默认指向真实库；测试可通过 DSAGENT_STORE 指向临时副本，避免测试删除污染真实账号数据。
 */
const STORE_PATH = process.env.DSAGENT_STORE || join(homedir(), '.dsh', 'dsagent-accounts.json')

const PORT = Number(process.env.PREVIEW_PORT || 5199)

/**
 * 账号读写都按请求新建实例。
 * CredentialStore 内部有内存 cache，长驻实例在「删除/绑定后重新列账号」时会返回旧快照，
 * 因此预览侧刻意不复用实例 —— 每次请求都从磁盘重新读取。
 */
function freshAccount() {
  return createAccountService(STORE_PATH)
}
function freshStore() {
  return new CredentialStore(STORE_PATH)
}

const skill = createSkillService(SKILL_ROOT)

/**
 * 真实本地代理网关（复刻 qiworkconnect.exe）。
 * 长驻实例 —— 网关的节流/风控冷却状态必须跨请求存活（同一账号 4s+抖动间隔）；
 * store 的 read() 有 mtime 失效检查，磁盘被 freshStore() 写后会自动重读，不会拿到旧快照。
 */
const gatewayReady = startGatewayProxy(new CredentialStore(STORE_PATH))

/**
 * 真实 executeSkill —— 复刻 index.ts executeSkillCore 的关键路径：
 * 平台解析 → 账号绑定上下文（选号链 + 状态拦截）→ 网关三件套 env → Cookie 注入 → skill.run。
 * 不含 tool_triggers / 坑位提示 / 坑位累积（那些是模型对话侧的增强，工作流无人消费）。
 */
async function executeSkillReal(opts: {
  skillId: string
  requestStr: string
  explicitArgs?: string[]
  chosenShopKey: string
  agentId: string
  fromContract: boolean
}): Promise<any> {
  const { skillId, requestStr, explicitArgs, chosenShopKey, agentId, fromContract } = opts

  const skillInfo = await skill.get(skillId)
  if (!skillInfo) {
    return { ok: false, failureKind: 'skill_not_found', text: `技能「${skillId}」不存在。`, exitCode: -1, skillId, message: '' }
  }

  // 平台解析 + 账号绑定上下文（选号链：①显式 shopKey→②会话绑定→③平台默认→④兜底）
  const platform = requiredPlatform(skillId)
  let resolvedShopKey = chosenShopKey
  if (platform) {
    const account = freshAccount()
    const ctx2 = await account.fetchBindingContext(platform, agentId, chosenShopKey)
    if (!ctx2) {
      return { ok: false, failureKind: 'not_bound', text: `技能「${skillId}」需要 ${guidedPlatform(platform)} 平台授权${guidedPlatformExtra(platform)}，请先到「账号连接」页面绑定账号。`, exitCode: -1, skillId, message: '' }
    }
    if (ctx2.failureKind === 'need_account_choice') {
      const choices = ctx2.choices || []
      const lines = choices.map((c, i) => `${i + 1}. ${c.nickname}（shopKey=${c.shopKey}，状态=${c.status}）`)
      return {
        ok: false,
        failureKind: 'need_account_choice',
        text: `技能「${skillId}」需要 ${platform} 平台账号，且有 ${choices.length} 个可用账号，请在创建任务时通过 shop 参数指定：\n${lines.join('\n')}`,
        platform,
        accounts: choices,
        exitCode: -1,
        skillId,
        message: '',
      }
    }
    if (ctx2.sessionHint === 'reauth_required') {
      return { ok: false, failureKind: 'token_expired', text: `${guidedPlatform(platform)} 平台登录态已失效（连续探测失败，重试无法恢复）。请到「账号连接」页面重新登录${guidedPlatformExtra(platform)}。`, exitCode: -1, skillId, message: '' }
    }
    if (ctx2.sessionHint === 'expired') {
      return { ok: false, failureKind: 'token_expired', text: `${guidedPlatform(platform)} 平台登录态疑似过期（可能是网络抖动）。可先重试一次；若仍失败，请到「账号连接」页面重新登录。`, exitCode: -1, skillId, message: '' }
    }
    if (ctx2.sessionHint === 'risk_control') {
      return { ok: false, failureKind: 'risk_control', text: `${platform} 平台会话被风控拦截。请到「账号连接」页面重新登录后再试。`, exitCode: -1, skillId, message: '' }
    }
    resolvedShopKey = ctx2.shopKey || resolvedShopKey
  }

  // 网关三件套 + Cookie 注入（与 index.ts executeSkillCore 同构）
  const gw = await gatewayReady
  const env: Record<string, string> = {
    DSAGENT_WORKSPACE: process.env.DSAGENT_WORKSPACE ?? process.cwd(),
    DSAGENT_SKILL_ROOT: SKILL_ROOT,
    DSAGENT_REQUEST: requestStr,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    DSCONNECT_URL: gw.url,
    DSCONNECT_TOKEN: 'local', // 占位值，本地网关不验签
    DSCONNECT_AGENT_ID: agentId,
  }
  if (resolvedShopKey) env.DSCONNECT_SHOP_KEY = resolvedShopKey
  if (platform) {
    const stored = freshAccount().findStoredAccount(platform, agentId, resolvedShopKey)
    if (stored) {
      env.DSAGENT_COOKIE = stored.cookie_str
      env.DSAGENT_PLATFORM = stored.platform
      env.DSAGENT_ACCOUNT_ID = stored.account_id
      env.DSAGENT_TB_TOKEN = stored.tb_token
      env.DSCONNECT_SHOP_KEY = stored.shop_key
    }
  }

  // 真实执行：spawn 子进程 + PYTHONPATH 注入 + 5 分钟看门狗（skill-service 内置）
  const result = await skill.run(skillId, requestStr, env, { args: explicitArgs, fromContract })
  if (!result.ok) {
    let failureKind = result.failureKind || ''
    if (!failureKind) {
      failureKind = 'skill_error'
      const errMsg = (result.message + ' ' + result.stderr).toLowerCase()
      if (errMsg.includes('risk_control') || errMsg.includes('风控')) {
        failureKind = 'risk_control'
      } else if (errMsg.includes('rate_limit') || errMsg.includes('限流') || errMsg.includes('too many')) {
        failureKind = 'rate_limit'
      } else if (errMsg.includes('no_permission') || errMsg.includes('无权限') || errMsg.includes('权限不足') || errMsg.includes('无权访问') || errMsg.includes('无权')) {
        failureKind = 'no_permission'
      } else if (errMsg.includes('token_expired') || errMsg.includes('FAIL_BIZ_LOGIN') || errMsg.includes('site_illegal') || errMsg.includes('登录站点非法') || errMsg.includes('请登录')) {
        failureKind = 'token_expired'
      } else if (errMsg.includes('parse_error') || errMsg.includes('parse')) {
        failureKind = 'parse_error'
      }
    }
    return {
      ok: false,
      failureKind,
      text: `技能执行失败：${result.message || result.stderr || '未知错误'}`,
      usage: result.usage ?? null,
      exitCode: result.exitCode,
      skillId,
      message: result.message || '',
    }
  }

  const isInstructions = typeof result.payload === 'object' && result.payload !== null
    && (result.payload as Record<string, unknown>).mode === 'instructions'
  const rawPayload = result.payload != null
    ? (typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2))
    : result.stdout.slice(-4000)
  return {
    ok: true,
    text: `技能「${skillId}」执行成功。\n\n${isInstructions ? rawPayload : rawPayload}`,
    exitCode: result.exitCode,
    skillId,
    message: result.message,
    payload: result.payload ?? null,
  }
}

/**
 * 工作流服务（host 半区真实实现）。
 * executeSkill 为真实链路：本地代理网关 + 账号绑定选号 + Cookie 注入 + skill.run 子进程。
 */
const workflow = createWorkflowService({
  skill,
  executeSkill: executeSkillReal,
  workflowDir: join(SKILL_ROOT, 'workflows'),
  tasksPath: join(PROJECT_ROOT, 'dev', '.preview-workflow-tasks.json'),
})
const workflowApi = registerWorkflowApi({ service: workflow })

const SHELL = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSAgent 插件预览</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#f4f6fa; color:#1f2430;
         font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  .top { background:#fff; border-bottom:1px solid #e6eaf2; padding:0 22px;
         display:flex; align-items:center; gap:4px; position:sticky; top:0; z-index:50; }
  .top b { margin-right:16px; font-size:14px; }
  .top button { border:none; background:none; padding:13px 14px; cursor:pointer;
                color:#67708a; font-size:13px; border-bottom:2px solid transparent; }
  .top button.on { color:#2b6cff; border-bottom-color:#2b6cff; font-weight:600; }
  .wrap { padding:22px; }
  .pane { display:none; }
  .pane.on { display:block; }
  .card { background:#fff; border:1px solid #e6eaf2; border-radius:10px; padding:22px; }
  .hint { margin:0 0 14px; padding:9px 12px; background:#fff8e6; border:1px solid #ffe2a8;
          border-radius:6px; color:#8a6a00; font-size:12px; }
  #boot-err { display:none; margin:0 22px 14px; padding:12px; background:#fdecec;
              border:1px solid #f5b5b5; border-radius:6px; color:#a02020;
              font-family:Consolas,monospace; font-size:12px; white-space:pre-wrap; }
</style>
</head>
<body>
  <div class="top">
    <b>DSAgent 插件预览</b>
    <button data-nav="account" class="on">账号连接</button>
    <button data-nav="market">技能市场</button>
    <button data-nav="workflow">工作流</button>
  </div>
  <div id="boot-err"></div>
  <div class="wrap">
    <div class="pane on" data-pane="account">
      <p class="hint">预览模式 · 无网关时用内置回退数据渲染。弹窗、分页、复制、删除确认、重新登录均可点。</p>
      <div class="card" id="m-account"></div>
    </div>
    <div class="pane" data-pane="market">
      <p class="hint">预览模式 · 技能读自真实 skills/ 目录。拨动开关会真实改写 SKILL.md 的 disable-model-invocation。</p>
      <div class="card" id="m-market"></div>
    </div>
    <div class="pane" data-pane="workflow">
      <p class="hint">预览模式 · 模板读自 skills/workflows/（真实读写）。执行为真实链路：本地代理网关 + 账号绑定选号 + Cookie 注入 + 技能子进程。</p>
      <div class="card" id="m-workflow"></div>
    </div>
  </div>
  <script>
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b === btn));
        document.querySelectorAll('.pane').forEach(p =>
          p.classList.toggle('on', p.dataset.pane === btn.dataset.nav));
      };
    });
    window.addEventListener('error', e => {
      const box = document.getElementById('boot-err');
      if (box) { box.style.display = 'block'; box.textContent = '页面脚本出错：\\n' + (e.error?.stack || e.message); }
    });
  </script>
  <script src="/client.js"></script>
</body>
</html>`

/** 用 esbuild 把预览客户端打成一份 IIFE 给浏览器 */
async function bundleClient(payload: unknown): Promise<string> {
  // 把 payload 编码为 base64，避免特殊字符（emoji 等）破坏 JS 语法
  const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
  const result = await build({
    entryPoints: [join(__dirname, 'preview-client.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
    // node:* 内置模块映射到空 stub —— 与 dev/build-client.mjs 保持一致。
    // 页面会（经 credential-store.ts）间接引入 node:fs 等仅 host 半区使用的模块，
    // 少了这段 alias，浏览器侧打包会直接报 Could not resolve "node:fs"（HTTP 500）。
    alias: {
      'node:fs/promises': resolve(__dirname, 'node-stub.js'),
      'node:fs': resolve(__dirname, 'node-stub.js'),
      'node:path': resolve(__dirname, 'node-stub.js'),
      'node:crypto': resolve(__dirname, 'node-stub.js'),
      'node:child_process': resolve(__dirname, 'node-stub.js'),
      'node:os': resolve(__dirname, 'node-stub.js'),
      'node:url': resolve(__dirname, 'node-stub.js'),
    },
    define: {
      __DSAGENT_B64__: JSON.stringify(b64),
    },
  })
  return result.outputFiles[0].text
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'

  if (url === '/' || url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(SHELL)
    return
  }

  if (url === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  if (url === '/client.js') {
    try {
      // 服务端预取数据（文件系统只能在这里读），传给浏览器侧渲染
      const skills = await skill.list()
      const accounts = await freshAccount().list()
      const payload = {
        skillRoot: SKILL_ROOT,
        storePath: STORE_PATH,
        skills,
        accounts,
      }
      const code = await bundleClient(payload)
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      res.end(code)
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('打包失败：\n' + (err as Error).stack)
    }
    return
  }

  // ---- API：浏览器侧写操作回传到服务端执行 ----

  // 技能启停：真实改写 SKILL.md
  if (url === '/api/toggle' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const { id, enabled } = JSON.parse(body)
        await skill.setEnabled(id, enabled)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, id, enabled }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  // 刷新技能列表（开关切换后重新读取）
  if (url === '/api/skills') {
    try {
      const rows = await skill.list()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(rows))
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
    return
  }

  // 刷新账号列表（绑定/删除后重新读取，供浏览器侧重绘表格）
  if (url === '/api/accounts') {
    try {
      const rows = await freshAccount().list()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(rows))
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: (err as Error).message }))
    }
    return
  }

  // 绑定智能体：对齐 host 路由 bind_agent 契约（去重追加 agentId）
  if (url === '/api/bind_agent' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const { shopKey, agentId } = JSON.parse(body)
        const key = String(shopKey ?? '')
        const agent = String(agentId ?? '').trim()
        let payload: { ok: boolean; error?: string }
        if (!key || !agent) {
          payload = { ok: false, error: '缺少 shopKey / agentId' }
        } else {
          const store = freshStore()
          const existing = store.get(key)
          if (!existing) {
            payload = { ok: false, error: '账号不存在' }
          } else {
            const agentIds = [...(existing.bound_agent_ids || [])]
            if (!agentIds.includes(agent)) agentIds.push(agent)
            const saved = await store.setBindings(key, agentIds)
            payload = saved ? { ok: true } : { ok: false, error: '绑定失败' }
          }
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  // 删除账号：对齐 host 路由 delete_account 契约
  if (url === '/api/delete_account' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const { shopKey } = JSON.parse(body)
        const key = String(shopKey ?? '')
        let payload: { ok: boolean; error?: string }
        if (!key) {
          payload = { ok: false, error: '缺少 shopKey' }
        } else {
          const ok = await freshStore().deleteByShopKey(key)
          payload = ok ? { ok: true } : { ok: false, error: '账号不存在' }
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  // 工作流页面单入口：对齐宿主 /dsagent/api 契约（POST + {action, ...payload}）。
  // workflow_ 前缀分发到 workflowApi.handleAction；list_accounts 复用真实账号库。
  if (url === '/dsagent/api' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}') as Record<string, unknown>
        const { action, ...payload } = parsed
        let out: Record<string, unknown>
        if (action === 'list_accounts') {
          const rows = freshStore().listAccounts().map(a => ({
            shopKey: a.shop_key,
            platform: a.platform,
            accountId: a.account_id,
            displayLabel: a.display_label || a.account_id,
            status: a.status,
            authType: a.auth_type,
            boundAgentIds: a.bound_agent_ids || [],
          }))
          out = { ok: true, rows }
        } else if (action === 'browser_login') {
          const reqPlatform = String(payload.platform ?? '')
          const owner = loginOwnerPlatform(reqPlatform)
          if (owner) {
            out = { ok: false, error: `「${reqPlatform}」复用 ${owner} 登录态，没有独立登录流程。请改为登录 ${owner}。` }
          } else {
            const freshLogin = payload.freshLogin === true
            const replaceShopKey = String(payload.shopKey ?? '') || undefined
            console.log(`[preview] browser_login: platform=${reqPlatform}, freshLogin=${freshLogin}, replaceShopKey=${replaceShopKey || '(none)'}`)
            const result = await doBrowserLogin(
              reqPlatform,
              String(payload.loginUrl ?? ''),
              freshStore(),
              { freshLogin, replaceShopKey },
            )
            console.log(`[preview] browser_login 返回: ok=${result.ok}, error=${result.error || '(none)'}`)
            out = result as Record<string, unknown>
          }
        } else if (action === 'browser_close') {
          const result = await closeBrowser()
          out = result as Record<string, unknown>
        } else if (action === 'delete_account') {
          const shopKey = String(payload.shopKey ?? '')
          if (!shopKey) {
            out = { ok: false, error: '缺少 shopKey' }
          } else {
            const deleted = await freshStore().delete(shopKey)
            out = deleted ? { ok: true } : { ok: false, error: '账号不存在或删除失败' }
          }
        } else if (action === 'bind_agent') {
          const shopKey = String(payload.shopKey ?? '')
          const agentId = String(payload.agentId ?? '').trim()
          if (!shopKey || !agentId) {
            out = { ok: false, error: '缺少 shopKey / agentId' }
          } else {
            const store = freshStore()
            const existing = store.get(shopKey)
            if (!existing) {
              out = { ok: false, error: '账号不存在' }
            } else {
              const agentIds = [...(existing.bound_agent_ids || [])]
              if (!agentIds.includes(agentId)) agentIds.push(agentId)
              const saved = await store.setBindings(shopKey, agentIds)
              out = saved ? { ok: true } : { ok: false, error: '绑定失败' }
            }
          }
        } else if (action === 'unbind_agent') {
          const shopKey = String(payload.shopKey ?? '')
          const agentId = String(payload.agentId ?? '').trim()
          if (!shopKey || !agentId) {
            out = { ok: false, error: '缺少 shopKey / agentId' }
          } else {
            const store = freshStore()
            const existing = store.get(shopKey)
            if (!existing) {
              out = { ok: false, error: '账号不存在' }
            } else {
              const agentIds = (existing.bound_agent_ids || []).filter(id => id !== agentId)
              const saved = await store.setBindings(shopKey, agentIds)
              out = saved ? { ok: true } : { ok: false, error: '解绑失败' }
            }
          }
        } else if (typeof action === 'string' && action.startsWith('workflow_')) {
          out = await workflowApi.handleAction(action, payload)
        } else {
          out = { ok: false, error: `预览服务器未实现的 action：${String(action)}` }
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(out))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', async () => {
  try {
    const gw = await gatewayReady
    console.log(`\n  DSAgent 插件预览已启动`)
    console.log(`  技能根目录: ${SKILL_ROOT}`)
    console.log(`  本地代理网关（真实）: ${gw.url}`)
    console.log(`  访问: http://127.0.0.1:${PORT}\n`)
  } catch (err) {
    console.error('  本地代理网关启动失败：', err)
    console.log(`\n  DSAgent 插件预览已启动（无网关 —— 平台绑定类技能将报 not_bound）`)
    console.log(`  技能根目录: ${SKILL_ROOT}`)
    console.log(`  访问: http://127.0.0.1:${PORT}\n`)
  }
})
