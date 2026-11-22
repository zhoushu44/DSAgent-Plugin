/**
 * open-taobao-login.mjs — 打开淘宝登录窗口（用户在窗口内扫码登录）
 * ★ 不关闭浏览器，登录后由后续脚本连上抓数据
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { default: puppeteer } = await import(pathToFileURL(P + '/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js').href)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'taobao-login')
const sleep = ms => new Promise(r => setTimeout(r, ms))

for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
  try { fs.rmSync(path.join(PROFILE, n), { force: true, recursive: true }) } catch { }
}
fs.mkdirSync(PROFILE, { recursive: true })

const port = await new Promise((res, rej) => {
  const srv = net.createServer()
  srv.on('error', rej)
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)) })
})
console.log('调试端口:', port)

const proc = spawn(CHROME, [
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-position=100,50',
  '--window-size=1500,950',
  '--disable-blink-features=AutomationControlled',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })
console.log('chrome pid:', proc.pid)

for (let i = 0; i < 200; i++) {
  await sleep(100)
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })
    if (r.ok) break
  } catch { }
}

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
const pages = await browser.pages()
const p = pages[0] || await browser.newPage()

await p.goto('https://login.taobao.com/havanaone/login/login.htm', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
console.log('已打开淘宝登录页')
console.log('')
console.log('★ 请在窗口里扫码登录')
console.log('★ 登录完成后告诉我，我抓 3 个商品数据')

// 每 5 秒检查是否登录
let last = ''
for (let i = 0; i < 240; i++) {
  await sleep(5000)
  const st = await p.evaluate(() => ({
    url: location.href,
    hasUser: /登录|扫码/.test(document.body.innerText || '') === false,
  })).catch(() => ({}))
  const cur = /login\.taobao\.com/.test(st.url || '') ? '未登录' : '已登录'
  if (cur !== last) { console.log(`[${i * 5}s] ${cur}  ${(st.url || '').slice(0, 70)}`); last = cur }
  if (cur === '已登录') {
    console.log('')
    console.log('★ 检测到已登录，窗口保持打开')
    break
  }
}

setInterval(() => { }, 60000)
