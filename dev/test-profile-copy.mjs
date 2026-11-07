#!/usr/bin/env node
/**
 * 测试：复制拼多多 Profile 到临时副本，验证能否独立启动
 *
 * 用法：node dev/test-profile-copy.mjs [shopKey]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const SHOP = process.argv[2] || 'pdd_mms_2384db98bbcb596936cded12513defe7'
const BASE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts'
const SRC = path.join(BASE, SHOP)
const COPY = path.join(BASE, `${SHOP}--tmp-${Date.now()}`)

// ── ① 检查源 Profile ──
console.log('=== ① 源 Profile ===')
if (!fs.existsSync(SRC)) { console.log(`不存在: ${SRC}`); process.exit(1) }

const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].filter(f => fs.existsSync(path.join(SRC, f)))
console.log(`路径: ${SRC}`)
console.log(`锁文件: ${locks.length ? locks.join(', ') + ' ⚠ 被占用' : '无 ✅ 空闲'}`)

// 大小
let size = 0, files = 0
for (const f of fs.readdirSync(SRC, { recursive: true, withFileTypes: true })) {
  if (f.isFile()) {
    files++
    try { size += fs.statSyncSync ? 0 : 0 } catch {}
  }
}
// 用 PowerShell 算大小（快）
try {
  const out = execSync(`powershell -NoProfile -Command "'{0:N1}' -f ((Get-ChildItem -LiteralPath '${SRC}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB)"`, { encoding: 'utf8' })
  console.log(`大小: ${out.trim()} MB`)
} catch { console.log('大小: 计算失败') }

// ── ② 复制（排除锁文件和缓存） ──
console.log('\n=== ② 复制到临时副本 ===')
console.log(`目标: ${COPY}`)
const t0 = Date.now()
try {
  // ★ Node 原生复制（robocopy 在 execSync 下重定向有问题）
  //   排除锁文件和大缓存目录
  const EXCLUDE = new Set([
    'SingletonLock', 'SingletonSocket', 'SingletonCookie',
    'DevToolsActivePort', 'lockfile',
    'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache',
    'Service Worker', 'DawnGraphCache', 'DawnWebGPUCache', 'GraphiteDawnCache',
  ])
  fs.cpSync(SRC, COPY, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(SRC, src)
      if (!rel) return true
      const first = rel.split(path.sep)[0]
      return !EXCLUDE.has(first)
    },
  })
  const cost = ((Date.now() - t0) / 1000).toFixed(1)
  let copySize = 0
  try {
    const out = execSync(`powershell -NoProfile -Command "'{0:N1}' -f ((Get-ChildItem -LiteralPath '${COPY}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB)"`, { encoding: 'utf8' })
    copySize = out.trim()
  } catch {}
  console.log(`✅ 复制完成，耗时 ${cost}s，大小 ${copySize} MB`)
} catch (e) {
  console.log(`❌ 复制失败: ${String(e.message).slice(0, 150)}`)
  process.exit(1)
}

// ── ③ 清副本的锁文件 ──
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(path.join(COPY, f)) } catch {}
}
console.log('✅ 已清副本锁文件')

// ── ④ 启动副本 ──
console.log('\n=== ③ 启动副本浏览器 ===')
const puppeteer = require('puppeteer-core')
let browser
try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, userDataDir: COPY, defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
  })
  console.log('✅ 副本浏览器启动成功')
} catch (e) {
  console.log(`❌ 启动失败: ${String(e.message).slice(0, 150)}`)
  process.exit(1)
}

// ── ⑤ 验证登录态 ──
const page = await browser.newPage()
console.log('\n=== ④ 验证登录态 ===')
console.log('打开商品列表...')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 8000))

const st = await page.evaluate(() => {
  const txt = document.body.innerText || ''
  const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
  const btns = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
  return {
    url: location.href,
    isLogin: /\/login\//.test(location.href) || /扫码登录|账号登录/.test(txt.slice(0, 300)),
    hasBtn: btns.length > 0,
    shop: (txt.match(/空空商行|旗舰店/) || [])[0] || '',
  }
})

console.log(`URL: ${st.url.slice(0, 70)}`)
console.log(`登录状态: ${st.isLogin ? '❌ 未登录' : '✅ 已登录'}`)
console.log(`店铺: ${st.shop || '(未识别)'}`)
console.log(`发布按钮: ${st.hasBtn ? '✅ 可见' : '❌ 未找到'}`)

await page.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/copy_profile_test.png' })
console.log('\n截图: copy_profile_test.png')

// ── ⑥ 保持 30 秒供观察 ──
console.log('\n浏览器保持 30 秒...')
await new Promise(r => setTimeout(r, 30000))

await browser.close()
console.log('✅ 浏览器已关闭')

// ── ⑦ 清理副本 ──
console.log('\n=== ⑤ 清理副本 ===')
try {
  execSync(`powershell -NoProfile -Command "Remove-Item -LiteralPath '${COPY}' -Recurse -Force -ErrorAction SilentlyContinue"`, { encoding: 'utf8', timeout: 120000 })
  console.log(fs.existsSync(COPY) ? '⚠ 副本仍存在' : '✅ 副本已删除')
} catch (e) {
  console.log(`⚠ 删除失败（可手动删）: ${COPY}`)
}

console.log('\n=== 测试结论 ===')
console.log(st.isLogin ? '❌ 副本未继承登录态' : '✅ 副本继承登录态，可独立操作')
