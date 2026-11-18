/**
 * nostartup-launch.mjs — 无窗口启动 Chrome（spawn + CDP）
 *
 * 原理（来自 Accio/DSH gateway-worker）：
 *   ① --no-startup-window  → Chrome 起来但没有顶层窗口
 *   ② Target.createTarget({ background: true })  → 建 tab 不激活
 *   ③ --disable-*Throttling → 无窗口时不被节流
 *
 * 和 pdd-launch.mjs 的区别：
 *   · 不用 puppeteer.launch()（会因等初始 page 超时）
 *   · 用 spawn + puppeteer.connect()
 */
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

export const NO_WINDOW_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--no-startup-window',                                          // ★ 不创建窗口
  '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-frame-rate-limit',
  '--disable-blink-features=AutomationControlled',
]

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/**
 * 无窗口启动 Chrome 并返回 puppeteer Browser
 *
 * @param {string} userDataDir  Chrome profile 目录
 * @param {object} puppeteer    puppeteer-core 模块
 * @param {object} [opts]       { extraArgs, timeoutMs, log }
 * @returns {Promise<{ browser, proc, port, close }>}
 */
export async function launchNoWindow(userDataDir, puppeteer, opts = {}) {
  const log = opts.log || (() => { })
  const timeoutMs = opts.timeoutMs || 30000

  // 清残留锁
  for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
    try { fs.rmSync(path.join(userDataDir, n), { force: true, recursive: true }) } catch { }
  }
  fs.mkdirSync(userDataDir, { recursive: true })

  const port = await freePort()
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    ...NO_WINDOW_ARGS,
    ...(opts.extraArgs || []),
  ]

  log(`[no-window] spawn chrome pid 端口=${port}`)
  const proc = spawn(CHROME_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderrTail = ''
  proc.stderr.on('data', d => { stderrTail = (stderrTail + String(d)).slice(-2000) })
  proc.on('exit', (code) => log(`[no-window] chrome 退出 code=${code}`))

  // 等 DevTools 端口
  const t0 = Date.now()
  let info = null
  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, 120))
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
      info = await r.json()
      break
    } catch { }
  }
  if (!info) {
    try { proc.kill() } catch { }
    throw new Error(`Chrome DevTools 端口未就绪（${timeoutMs}ms）${stderrTail.slice(-300)}`)
  }
  log(`[no-window] DevTools 就绪 ${info.Browser}  (${Date.now() - t0}ms)`)

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  })
  log('[no-window] puppeteer.connect 完成')

  const close = async () => {
    try { await browser.disconnect() } catch { }
    try { proc.kill() } catch { }
  }

  return { browser, proc, port, close, info }
}

/**
 * 在无窗口 Chrome 里建一个后台标签页并返回 puppeteer Page
 *
 * ★ 关键：必须用 Target.createTarget({ background: true })
 *   否则 Chrome 会为这个 tab 创建一个可见窗口
 */
export async function newBackgroundPage(browser, puppeteer) {
  const client = await browser.target().createCDPSession()
  const { targetId } = await client.send('Target.createTarget', {
    url: 'about:blank',
    background: true,
  })
  await new Promise(r => setTimeout(r, 800))

  // 等 puppeteer 能看到这个 target
  for (let i = 0; i < 40; i++) {
    const pages = await browser.pages()
    const p = pages.find(pg => {
      try {
        const u = pg.url()
        return u === 'about:blank'
      } catch { return false }
    })
    if (p) return p
    await new Promise(r => setTimeout(r, 100))
  }
  // 兜底：返回最后一个
  const pages = await browser.pages()
  if (pages.length) return pages[pages.length - 1]
  return await browser.newPage()
}

export default { launchNoWindow, newBackgroundPage, NO_WINDOW_ARGS, CHROME_PATH }
