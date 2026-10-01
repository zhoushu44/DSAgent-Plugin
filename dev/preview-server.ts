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

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '../../..')
const SKILL_ROOT = join(PROJECT_ROOT, 'skills')

/**
 * 凭证库路径。
 * 默认指向真实库；测试可通过 DSAGENT_STORE 指向临时副本，避免测试删除污染真实账号数据。
 */
const STORE_PATH = process.env.DSAGENT_STORE || join(homedir(), '.dsh', 'dsagent-accounts.json')

const PORT = Number(process.env.PREVIEW_PORT || 5199)

const skill = createSkillService(SKILL_ROOT)

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

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  DSAgent 插件预览已启动`)
  console.log(`  技能根目录: ${SKILL_ROOT}`)
  console.log(`  访问: http://127.0.0.1:${PORT}\n`)
})
