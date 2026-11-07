#!/usr/bin/env node
/**
 * 精确测试：复制 Profile 后 Cookie 是否真的能用
 * 关键点：
 *   ① Local State（加密密钥）必须一起复制
 *   ② Default/Network/Cookies（Cookie 库）必须一起复制
 *   ③ 用页面登录态验证，而不是只看文件
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const SHOP = 'pdd_mms_2384db98bbcb596936cded12513defe7'
const BASE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts'
const SRC = path.join(BASE, SHOP)
const COPY = path.join(BASE, `${SHOP}--tmp-${Date.now()}`)

const KEY_FILES = [
  'Local State',
  'Default/Network/Cookies',
  'Default/Secure Preferences',
  'Default/Preferences',
  'Default/Login Data',
]

// ── ① 复制 ──
console.log('=== 复制 ===')
fs.cpSync(SRC, COPY, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(SRC, src)
    if (!rel) return true
    const first = rel.split(path.sep)[0]
    const EX = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile',
      'Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'Service Worker',
      'DawnGraphCache', 'DawnWebGPUCache', 'GraphiteDawnCache'])
    return !EX.has(first)
  },
})
console.log('✅ 复制完成')

// ── ② 对比关键文件 ──
console.log('\n=== 关键文件对比（源 vs 副本）===')
for (const rel of KEY_FILES) {
  const s = path.join(SRC, rel), c = path.join(COPY, rel)
  const ss = fs.existsSync(s) ? fs.statSync(s).size : -1
  const cs = fs.existsSync(c) ? fs.statSync(c).size : -1
  const same = ss === cs && ss > 0
  console.log(`  ${same ? '✅' : '❌'} ${rel.padEnd(26)} 源 ${String(ss).padStart(7)}  副本 ${String(cs).padStart(7)}`)
}

// ── ③ 清副本锁 ──
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(path.join(COPY, f)) } catch {}
}

// ── ④ 启动 + 验证 ──
console.log('\n=== 启动副本并验证登录态 ===')
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: COPY, defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})
console.log('✅ 启动成功')

const page = await browser.newPage()
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))

const st = await page.evaluate(() => {
  const txt = document.body.innerText || ''
  return {
    url: location.href,
    isLogin: /\/login\//.test(location.href),
    shop: (txt.match(/空空商行|旗舰店/) || [])[0] || '',
    textLen: txt.length,
  }
})

console.log(`URL: ${st.url.slice(0, 75)}`)
console.log(`登录: ${st.isLogin ? '❌ 失效' : '✅ 有效'}`)
console.log(`店铺: ${st.shop || '(未识别)'}`)

// ── ⑤ 对比：同时启动源 Profile（如果空闲）会怎样 ──
const srcLocks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].filter(f => fs.existsSync(path.join(SRC, f)))
console.log(`\n源 Profile 锁: ${srcLocks.length ? srcLocks.join(',') : '无（副本运行期间源也是空闲的）'}`)

await page.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/copy_verify.png' })
await new Promise(r => setTimeout(r, 20000))
await browser.close()

console.log('\n=== 结论 ===')
console.log(st.isLogin
  ? '❌ 副本未继承登录态 —— Cookie 解密失败（Local State 密钥不匹配）'
  : '✅ 副本继承登录态 —— 可并行操作')

// 保留副本供检查（不删）
console.log(`\n副本保留在: ${COPY}`)
