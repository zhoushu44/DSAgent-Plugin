/**
 * 照抄 sku_build.py 的浏览器架构：独立 Chrome + CDP 外挂连接
 *
 * 原码做法（sku_build.py 30-45 行）：
 *   ① 杀 chrome
 *   ② subprocess.Popen([chrome, "--remote-debugging-port=9333",
 *                       "--user-data-dir={PROFILE}", "--no-first-run",
 *                       "--window-size=1500,950", "about:blank"])
 *   ③ 轮询 http://127.0.0.1:9333/json/version 直到起来
 *   ④ playwright.connect_over_cdp("http://127.0.0.1:9333")
 *   ⑤ ctx.new_page() + ctx.new_cdp_session(page)
 *
 * 为什么这比我之前稳：
 *   - puppeteer.launch 是「托管」模式，page 崩 = browser 崩 = 连接断
 *   - connectOverCDP 是「外挂」模式，浏览器独立存活，连接可重连
 *   - Chrome 自己管页面，不受 puppeteer 生命周期影响
 *
 * 本模块导出：
 *   launchChromeCDP()  → { browser, page, cleanup }
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const DEBUG_PORT = 9333

/** 杀所有 chrome（照抄 sku_build.py 第30行） */
function killChrome() {
  try {
    execSync('powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force"', {
      stdio: 'ignore', timeout: 20000,
    })
  } catch { /* ignore */ }
}

/** 轮询 CDP 端口是否起来（照抄 sku_build.py 36-40 行） */
async function waitCdp(timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) return true
    } catch { /* not up yet */ }
    await sleep(1000)
  }
  return false
}

/**
 * 启动独立 Chrome + 外挂 CDP 连接
 * @param {Object} opts { profileDir, chromePath, cookies, headless }
 */
export async function launchChromeCDP(opts = {}) {
  const log = []
  const profileDir = opts.profileDir
  const chromePath = opts.chromePath
  if (!profileDir) throw new Error('profileDir required')
  if (!chromePath) throw new Error('chromePath required')
  mkdirSync(profileDir, { recursive: true })

  // ① 杀旧 chrome
  log.push('杀旧 Chrome')
  killChrome()
  await sleep(5000)

  // ② 独立启动（照抄 Popen 参数 + 方案第五节的进阶参数）
  //   「进阶：配合反调试 + 禁代理」来自《抖音风控绕过方案.md》第五节（抖上货逆向）：
  //     no-proxy-server          不走代理（躲抓包特征）
  //     ignore-certificate-errors 忽略证书错误
  //     disable-http2            禁 H2（有些风控靠 H2 指纹）
  log.push(`启动 Chrome --remote-debugging-port=${DEBUG_PORT}`)
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',                  // ★ 方案第五节：不走代理
    '--ignore-certificate-errors',        // ★ 方案第五节：忽略证书
    '--disable-http2',                    // ★ 方案第五节：禁 H2 指纹
    '--disable-blink-features=AutomationControlled',
    '--window-size=1600,1000',
    'about:blank',
  ]
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' })
  child.unref()

  // ③ 等 CDP 端口
  const up = await waitCdp(35000)
  if (!up) throw new Error(`CDP 端口 ${DEBUG_PORT} 35s 未就绪`)
  log.push('CDP 就绪')

  // ④ 外挂连接
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const browser = await puppeteer.default.connect({ browserURL: `http://127.0.0.1:${DEBUG_PORT}` })
  log.push('CDP 已连接')

  // ⑤ 新开 page
  let page = null
  try {
    page = await browser.newPage()
  } catch {
    const pages = await browser.pages()
    page = pages[0] || await browser.newPage()
  }
  log.push('page 已创建')

  // 灌 cookie
  if (opts.cookies && Object.keys(opts.cookies).length) {
    const list = Object.entries(opts.cookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([n, v]) => [
        { name: n, value: String(v), domain: '.jinritemai.com', path: '/' },
        { name: n, value: String(v), domain: '.douyin.com', path: '/' },
      ])
    try { await page.setCookie(...list) } catch { /* ignore */ }
    log.push(`注入 ${list.length} 个 cookie`)
  }

  const cleanup = async () => {
    try { await browser.disconnect() } catch { /* ignore */ }
    // 不杀 chrome：让用户能看/手动操作
  }

  return { browser, page, cleanup, log, childPid: child.pid }
}

export { killChrome, DEBUG_PORT }
