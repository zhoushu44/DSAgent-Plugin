/**
 * pdd-signer-daemon.mjs —— 拼多多推广域**常驻签名服务**（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（2026-11-09）
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯 Node（jsdom）签名走不通：拼多多 SDK 的设备指纹不是「读几个属性」那么简单，
 * 而是在 window.name 里维护一坨**活状态**（版本号 + 2 个 UUID + 时间戳，互相耦合）。
 * 实测已排除的差异：
 *   · 环境画像没回放      → 已修（seed.promoEnv）
 *   · Cookie 没带/没刷新  → 已修（凭证库 + 自愈）
 *   · 属性挂在实例而非原型 → 已修（hasOwnProperty 反篡改检测）
 *   · UA/screen 不一致    → 已修（对齐）
 *   · 时间戳过期          → 已修
 *   ★ 剩下的 window.name 状态机耦合，jsdom 复刻不出来 → 纯 Node 签名恒被拒（54001）
 *
 * 但用户要的是**运营效果**：skill 不要再自己开浏览器、请求全部走 Node。
 * → 把「唯一必须真实浏览器的那部分」抽出来，做成**常驻服务**：
 *
 *     skill ──HTTP──▶ 签名守护进程 ──▶ 常驻 Chrome（只负责签名）
 *       │                  │
 *       └──── 业务请求 ────┴──▶ Node fetch（带签名）
 *
 * 效果：
 *   · Chrome 只启动一次（守护进程持有），之后热签名 ~50~200ms
 *   · skill 进程**完全不碰浏览器**，也不占 Profile 锁
 *   · 业务请求仍然 100% 由 Node 发出（风控/限流/并发都在 Node 侧）
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *
 *   node skills/_shared/pdd-signer-daemon.mjs start    # 启动（后台常驻）
 *   node skills/_shared/pdd-signer-daemon.mjs stop     # 停止
 *   node skills/_shared/pdd-signer-daemon.mjs status   # 状态
 *   node skills/_shared/pdd-signer-daemon.mjs sign <shopKey>   # 手动签一次（调试）
 *
 * 基座自动使用：pdd-request.mjs 的 signFor() 先问守护进程，
 *   问不到再退回进程内混合签名器（并尝试拉起守护进程）。
 */

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')

export const DAEMON_PORT = Number(process.env.PDD_SIGNER_PORT || 8791)
export const DAEMON_HOST = '127.0.0.1'
const PID_FILE = path.join(os.homedir(), '.dsh', 'pdd-signer-daemon.pid')
const LOG_FILE = path.join(os.homedir(), '.dsh', 'pdd-signer-daemon.log')

/* ─────────────────────────── 客户端（基座用） ─────────────────────────── */

/** 守护进程是否在线 */
export async function daemonHealth(timeoutMs = 400) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/health`, { signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

/** 向守护进程要一个签名。 */
export async function daemonSign(shopKey, timeoutMs = 20000) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopKey }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    return j?.ok && j.sig ? j : null
  } catch { return null }
}

/** 让守护进程预热某个账号的浏览器（提前把 Chrome 拉起来） */
export async function daemonWarm(shopKey, timeoutMs = 60000) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/warm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopKey }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

/** 让守护进程抓一份推广域环境画像（设备指纹回放用） */
export async function daemonEnv(shopKey, timeoutMs = 60000) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/env`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopKey }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    return j?.ok ? j.profile : null
  } catch { return null }
}

/** 向守护进程要这个账号的**当前 Cookie**（live 域的 VerifyAuthToken 走这里） */
export async function daemonCookies(shopKey, timeoutMs = 20000) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopKey }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    return j?.ok && j.cookies ? j : null
  } catch { return null }
}

/**
 * 按域取 Cookie。
 *
 * ★ live 域有自己一套登录票据：L_PASS_ID / HEARTBEAT_PASS_ID / L_PASS_TYPE，
 *   和 mms 的 PASS_ID **不通用**。拿 mms 的票去打 live 域 → HTTP 403 + 40001（空文案），
 *   看起来像「未登录」，实际是「票不对域」。
 *
 * ★ 2026-11-10：失败时自动杀残留 Chrome 重试一次。
 *   故障现场：守护进程 session=0，但磁盘上有 chrome.exe 占着 Profile 锁 →
 *   initHybridSigner 等 12 秒后报「Failed to launch」。杀进程才能解开。
 */
export async function daemonDomainCookies(shopKey, domains = ['live.pinduoduo.com', 'mms.pinduoduo.com'], timeoutMs = 30000) {
  const attempt = async () => {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), timeoutMs)
      const r = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/domaincookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopKey, domains }),
        signal: ctl.signal,
      })
      clearTimeout(t)
      if (!r.ok) return null
      const j = await r.json()
      return j?.ok ? j.domains : null
    } catch { return null }
  }
  let d = await attempt()
  if (d?.[domains[0]]) return d
  // 失败 → 杀残留 Chrome → 再来一次
  try { await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/killchrome`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopKey }),
  }).then(r => r.text()).catch(() => {}) } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 1500))
  d = await attempt()
  return d
}

/** 拉起守护进程（幂等：已在线就直接返回） */
export async function ensureDaemon(opts = {}) {
  const h = await daemonHealth()
  if (h) return { ok: true, started: false, health: h }
  try {
    const logFd = fs.openSync(LOG_FILE, 'a')
    const child = spawn(process.execPath, [path.join(HERE, 'pdd-signer-daemon.mjs'), 'serve'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: PLUGIN_ROOT,
      windowsHide: true,
    })
    child.unref()
    // 等它起来（最多 ~15s：要先开 Chrome）
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 250))
      const hh = await daemonHealth(600)
      if (hh) return { ok: true, started: true, health: hh }
      if (child.exitCode !== null) break
    }
    return { ok: false, started: false, reason: '守护进程启动超时/异常退出，见 ' + LOG_FILE }
  } catch (e) {
    return { ok: false, started: false, reason: String(e?.message || e).slice(0, 120) }
  }
}

/** 按端口找出监听进程 pid（Windows：netstat -ano） */
function findPidByPort(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    const re = new RegExp(`[:.]${port}\\s+.*LISTENING\\s+(\\d+)`, 'i')
    const m = out.match(re)
    return m ? Number(m[1]) : 0
  } catch { return 0 }
}

/** 停止守护进程 */
export async function stopDaemon() {
  const killed = []
  // ① PID 文件里的 pid
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
      if (pid > 0) killed.push(pid)
      try { fs.unlinkSync(PID_FILE) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // ② 端口上的监听进程（PID 文件丢了/过期的兜底）
  const byPort = findPidByPort(DAEMON_PORT)
  if (byPort && !killed.includes(byPort)) killed.push(byPort)
  for (const pid of killed) {
    try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* ignore */ }
  }
  return { ok: true, killed }
}

/* ─────────────────────────── 服务端 ─────────────────────────── */

/**
 * 杀掉占用指定 Profile 目录的 Chrome 进程（Windows）。
 *
 * ★ 只杀命令行里带这个 `--user-data-dir` 的，不动别的 Chrome
 *   （用户可能开着正常浏览器，误杀是灾难）。
 * @returns {number} 杀掉的进程数
 */
function killChromeByProfile(profileDir) {
  if (!profileDir) return 0
  try {
    const want = String(profileDir).toLowerCase().replace(/\//g, '\\')
    const ps = `
      $want = '${want.replace(/'/g, "''")}'
      $n = 0
      Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.CommandLine -and $_.CommandLine.ToLower().Replace('/','\\') -like "*$want*") {
          try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $n++ } catch {}
        }
      }
      Write-Output $n
    `
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8', windowsHide: true, timeout: 20000,
    })
    return Number(String(out).trim()) || 0
  } catch { return 0 }
}

async function serve() {
  const { initHybridSigner, getHybridCookies, signHybrid, closeAllHybridSigners } =
    await import(pathToFileURL(path.join(HERE, 'pdd-promo-signer-hybrid.mjs')).href)

  // 预热：先把 Chrome 拉起来，skill 第一次调用就不用等
  const warm = process.argv[3]
  const shopKey0 = warm || process.env.PDD_SIGNER_SHOPKEY || ''
  try {
    if (shopKey0) {
      await initHybridSigner(shopKey0)
      await getHybridCookies(shopKey0)
      console.log('[daemon] 预热完成：' + shopKey0)
    }
  } catch (e) {
    console.warn('[daemon] 预热失败（不致命）：' + String(e?.message || e).slice(0, 120))
  }

  const server = http.createServer(async (req, res) => {
    const json = (code, obj) => {
      const b = Buffer.from(JSON.stringify(obj), 'utf8')
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length })
      res.end(b)
    }
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(200, { ok: true, pid: process.pid, port: DAEMON_PORT, uptime: Math.round(process.uptime()) })
      }
      // 诊断：当前守护进程持有哪些账号的浏览器
      if (req.method === 'GET' && req.url === '/sessions') {
        const hb = await import(pathToFileURL(path.join(HERE, 'pdd-promo-signer-hybrid.mjs')).href)
        const list = hb.listHybridSigners?.() || []
        return json(200, { ok: true, sessions: list })
      }
      if (req.method === 'POST' && req.url === '/sign') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        if (!shopKey) return json(400, { ok: false, error: '缺少 shopKey' })
        const t = Date.now()
        const sig = await signHybrid(shopKey)
        if (!sig) return json(503, { ok: false, error: '签名失败' })
        const cookies = await getHybridCookies(shopKey)
        let ua = ''
        try {
          const s = await initHybridSigner(shopKey)
          ua = await s.page.evaluate(() => navigator.userAgent)
        } catch { /* ignore */ }
        return json(200, { ok: true, shopKey, sig, cookies, ua, ms: Date.now() - t })
      }
      if (req.method === 'POST' && req.url === '/release') {
        // ★ 释放 Profile 锁：浏览器类技能（发布/视频等）要用同一个 Profile 起 Chrome，
        //   而守护进程长期持有它 → "Failed to launch the browser process"。
        //   由 pdd-launch.mjs 的 launchOptions() 统一调用（零 per-skill 改动）。
        //
        // ★★ 2026-11-10 修：**不能只按传入的 shopKey 释放**。
        //   账号 shop_key 会因 PASS_ID 轮换而漂移，守护进程是按「当时那个 key」
        //   预热的。按新 key 释放 → 找不到 session → 返回 200 但 Chrome 没关，
        //   Profile 锁还在，浏览器类技能照样起不来（实测就是这么坑的）。
        //   → 只要收到释放请求，就把**所有** session 关掉。
        //     代价只是下次签名多等一次浏览器启动（~8s），换来的是「一定能起」。
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        try {
          const hb = await import(pathToFileURL(path.join(HERE, 'pdd-promo-signer-hybrid.mjs')).href)
          const before = hb.listHybridSigners?.() || []
          await hb.closeAllHybridSigners()
          // ★ 2026-11-10：**光关 session 不够**。
          //   实测多次出现「sessionsBefore:0，但磁盘上还有 8~10 个 chrome.exe
          //   占着 Profile 锁」——那是进程异常退出/被 Kill 后留下的孤儿 Chrome。
          //   这种状态下浏览器类技能永远起不来（Failed to launch），
          //   因为锁在、session 不在，closeAll 无从下手。
          //   → release 时把该 Profile 的残留 Chrome 一并杀掉。
          const { resolveProfileDir } = await import(pathToFileURL(path.join(HERE, 'pdd-profile-map.mjs')).href)
          let killed = 0
          if (shopKey) {
            const { dir } = await resolveProfileDir(shopKey, { create: false })
            killed = killChromeByProfile(dir)
          } else {
            // 没指定账号 → 把这个账号库下所有 pdd Profile 的残留都清掉
            const base = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')
            try {
              for (const n of fs.readdirSync(base)) {
                if (n.startsWith('pdd_')) killed += killChromeByProfile(path.join(base, n))
              }
            } catch { /* ignore */ }
          }
          return json(200, { ok: true, released: shopKey || 'all', sessionsBefore: before.length, killedChrome: killed })
        } catch (e) {
          return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
        }
      }
      if (req.method === 'POST' && req.url === '/killchrome') {
        // ★ 2026-11-10：强制清理这个账号的残留 Chrome。
        //   故障现场：守护进程 _sessions 里是 0 个，但磁盘上有 8 个 chrome.exe
        //   占着 Profile 锁 → 再 initHybridSigner 就报
        //   "Failed to launch the browser process"（而且要等 12 秒超时才失败）。
        //   只有杀进程才能解开这个死锁。
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        try {
          const { resolveProfileDir } = await import(pathToFileURL(path.join(HERE, 'pdd-profile-map.mjs')).href)
          const { dir } = await resolveProfileDir(shopKey || '', { create: false })
          const killed = killChromeByProfile(dir)
          // 顺便清掉内存里的死 session
          const hb = await import(pathToFileURL(path.join(HERE, 'pdd-promo-signer-hybrid.mjs')).href)
          await hb.closeAllHybridSigners()
          return json(200, { ok: true, profileDir: dir, killed })
        } catch (e) {
          return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
        }
      }
      if (req.method === 'POST' && req.url === '/cookies') {        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        if (!shopKey) return json(400, { ok: false, error: '缺少 shopKey' })
        try {
          const cookies = await getHybridCookies(shopKey)
          let ua = ''
          try {
            const s = await initHybridSigner(shopKey)
            ua = await s.page.evaluate(() => navigator.userAgent)
          } catch { /* ignore */ }
          return json(200, { ok: true, shopKey, cookies, ua })
        } catch (e) {
          return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
        }
      }
      // ★ 按域取 Cookie（live 域有自己一套票据：L_PASS_ID / HEARTBEAT_PASS_ID）
      if (req.method === 'POST' && req.url === '/domaincookies') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey, domains } = JSON.parse(body || '{}')
        if (!shopKey) return json(400, { ok: false, error: '缺少 shopKey' })
        try {
          const s = await initHybridSigner(shopKey)
          const cdp = await s.page.target().createCDPSession()
          const all = (await cdp.send('Storage.getCookies')).cookies || []
          const want = Array.isArray(domains) && domains.length
            ? domains
            : ['live.pinduoduo.com', 'mms.pinduoduo.com']
          const out = {}
          for (const d of want) {
            const jar = {}
            for (const c of all) {
              if (String(c.domain || '').replace(/^\./, '') !== String(d).replace(/^\./, '')) continue
              if (c.value == null || c.value === '') continue
              jar[c.name] = c.value
            }
            // 父域（.pinduoduo.com）的通用 Cookie 一并合进去
            for (const c of all) {
              if (String(c.domain || '') !== '.pinduoduo.com') continue
              if (c.value == null || c.value === '') continue
              if (jar[c.name] === undefined) jar[c.name] = c.value
            }
            out[d] = jar
          }
          return json(200, { ok: true, shopKey, domains: out })
        } catch (e) {
          return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
        }
      }
      if (req.method === 'POST' && req.url === '/env') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        if (!shopKey) return json(400, { ok: false, error: '缺少 shopKey' })
        try {
          const { captureEnvProfile } = await import(pathToFileURL(path.join(HERE, 'pdd-env-profile.mjs')).href)
          const s = await initHybridSigner(shopKey)
          const profile = await captureEnvProfile(s.page, { url: s.page.url() })
          profile.source = 'daemon'
          return json(200, { ok: true, shopKey, profile })
        } catch (e) {
          return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
        }
      }
      if (req.method === 'POST' && req.url === '/warm') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { shopKey } = JSON.parse(body || '{}')
        if (!shopKey) return json(400, { ok: false, error: '缺少 shopKey' })
        const t = Date.now()
        await initHybridSigner(shopKey)
        await getHybridCookies(shopKey)
        return json(200, { ok: true, shopKey, ms: Date.now() - t })
      }
      return json(404, { ok: false, error: 'not found' })
    } catch (e) {
      return json(500, { ok: false, error: String(e?.message || e).slice(0, 200) })
    }
  })

  server.on('error', (e) => {
    console.error('[daemon] 端口占用或监听失败：' + String(e?.message || e))
    process.exit(1)
  })
  server.listen(DAEMON_PORT, DAEMON_HOST, () => {
    try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8') } catch { /* ignore */ }
    console.log(`[daemon] 已监听 http://${DAEMON_HOST}:${DAEMON_PORT}  pid=${process.pid}`)
  })

  const bye = () => {
    try { fs.unlinkSync(PID_FILE) } catch { /* ignore */ }
    closeAllHybridSigners().finally(() => process.exit(0))
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

/* ─────────────────────────── CLI ─────────────────────────── */
if (process.argv[1] && process.argv[1].endsWith('pdd-signer-daemon.mjs')) {
  const cmd = process.argv[2] || 'status'
  if (cmd === 'start') {
    const r = await ensureDaemon()
    console.log(JSON.stringify(r, null, 1))
    process.exit(r.ok ? 0 : 1)
  }
  if (cmd === 'stop') {
    console.log(JSON.stringify(await stopDaemon(), null, 1))
    process.exit(0)
  }
  if (cmd === 'status') {
    const h = await daemonHealth()
    console.log(h ? JSON.stringify(h, null, 1) : '守护进程未运行')
    console.log('PID 文件：' + (fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8').trim() : '无'))
    process.exit(0)
  }
  if (cmd === 'sign') {
    const sk = process.argv[3]
    const r = await daemonSign(sk)
    console.log(r ? `签名成功 ${r.sig.length} 字符 / ${r.ms}ms` : '签名失败（守护进程未运行？）')
    process.exit(r ? 0 : 1)
  }
  if (cmd === 'serve') {
    await serve()
  }
}

export default { daemonHealth, daemonSign, ensureDaemon, stopDaemon, DAEMON_PORT, DAEMON_HOST }
