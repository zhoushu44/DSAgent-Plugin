#!/usr/bin/env node
/**
 * Cookie 共享工具
 *
 * 解决「多个对话同时打开拼多多会互相掉登录」的问题。
 *
 * 原理：
 *   Chrome 的 Cookie 加密密钥（DPAPI）绑定 Profile 路径，
 *   所以【复制 Profile 目录】会让 Cookie 解不开 → 跳登录。
 *   但 page.cookies() 拿到的是【解密后的明文】，可以跨 Profile 迁移。
 *
 * 用法：
 *   node dev/cookie-share.mjs export <shopKey> [cookieFile]   # 从原 Profile 导出
 *   node dev/cookie-share.mjs import <shopKey> [cookieFile]   # 注入到新 Profile
 *   node dev/cookie-share.mjs fresh  <newShopKey> [cookieFile] # 建全新 Profile 并注入
 *   node dev/cookie-share.mjs status <shopKey>                # 检查某 Profile 登录态
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const BASE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts'
const DEFAULT_COOKIE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd_cookies_share.json'

async function launch(dir, headless = false) {
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
    try { fs.unlinkSync(path.join(dir, f)) } catch {}
  }
  return puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless,
    userDataDir: dir,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 600000,
  })
}

/** 检查登录态 */
async function checkLogin(page) {
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 8000))
  return page.evaluate(() => {
    const txt = document.body.innerText || ''
    const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
    const btns = [...document.querySelectorAll('button, a, div, span')]
      .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
    return {
      isLogin: /\/login\//.test(location.href),
      shop: (txt.match(/[\u4e00-\u9fa5]{2,12}(?:商行|旗舰店|专营店|专卖店)/) || [])[0] || '',
      hasBtn: btns.length > 0,
    }
  })
}

const [cmd, shopKey, cookieArg] = process.argv.slice(2)
const cookieFile = cookieArg || DEFAULT_COOKIE

if (!cmd || !shopKey) {
  console.log(`用法：
  node dev/cookie-share.mjs export <shopKey> [cookieFile]   从原 Profile 导出 Cookie
  node dev/cookie-share.mjs import <shopKey> [cookieFile]   注入 Cookie 到已有 Profile
  node dev/cookie-share.mjs fresh  <newShopKey> [cookieFile] 建全新 Profile 并注入
  node dev/cookie-share.mjs status <shopKey>                检查登录态`)
  process.exit(1)
}

const dir = path.join(BASE, shopKey)

switch (cmd) {
  case 'export': {
    console.log(`=== 从 ${shopKey} 导出 Cookie ===`)
    if (!fs.existsSync(dir)) { console.log('❌ Profile 不存在'); process.exit(1) }
    const b = await launch(dir)
    const p = await b.newPage()
    const st = await checkLogin(p)
    if (st.isLogin) {
      console.log('❌ 该 Profile 未登录，无法导出有效 Cookie')
      await b.close()
      process.exit(1)
    }
    const cookies = await p.cookies()
    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2), 'utf8')
    console.log(`✅ 导出 ${cookies.length} 个 Cookie → ${cookieFile}`)
    console.log(`   店铺: ${st.shop}`)
    console.log(`   关键: ${[...new Set(cookies.map(c => c.name))].filter(n => /PASS_ID|JSESSIONID|PDD/i.test(n)).join(', ')}`)
    await b.close()
    break
  }

  case 'import': {
    console.log(`=== 注入 Cookie 到 ${shopKey} ===`)
    if (!fs.existsSync(cookieFile)) { console.log(`❌ Cookie 文件不存在: ${cookieFile}`); process.exit(1) }
    const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'))
    fs.mkdirSync(dir, { recursive: true })
    const b = await launch(dir)
    const p = await b.newPage()
    await p.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 3000))
    await p.setCookie(...cookies)
    console.log(`✅ 已注入 ${cookies.length} 个 Cookie`)
    const st = await checkLogin(p)
    console.log(`   登录: ${st.isLogin ? '❌ 失效' : '✅ 有效'} | 店铺: ${st.shop || '(未识别)'} | 发布按钮: ${st.hasBtn ? '可见' : '不可见'}`)
    await b.close()
    break
  }

  case 'fresh': {
    console.log(`=== 建全新 Profile ${shopKey} 并注入 Cookie ===`)
    if (!fs.existsSync(cookieFile)) { console.log(`❌ Cookie 文件不存在: ${cookieFile}`); process.exit(1) }
    const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'))
    fs.mkdirSync(dir, { recursive: true })
    const b = await launch(dir)
    const p = await b.newPage()
    await p.goto('https://mms.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 3000))
    await p.setCookie(...cookies)
    console.log(`✅ 全新 Profile 已注入 ${cookies.length} 个 Cookie`)
    const st = await checkLogin(p)
    console.log(`   登录: ${st.isLogin ? '❌ 失效' : '✅ 有效'} | 店铺: ${st.shop || '(未识别)'} | 发布按钮: ${st.hasBtn ? '可见' : '不可见'}`)
    console.log(`\n现在可以用这个 shopKey 操作了：`)
    console.log(`  --account ${shopKey}`)
    await b.close()
    break
  }

  case 'status': {
    console.log(`=== 检查 ${shopKey} 登录态 ===`)
    if (!fs.existsSync(dir)) { console.log('❌ Profile 不存在'); process.exit(1) }
    const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].filter(f => fs.existsSync(path.join(dir, f)))
    console.log(`   锁文件: ${locks.length ? locks.join(', ') + ' ⚠ 正被占用' : '无'}`)
    const b = await launch(dir)
    const p = await b.newPage()
    const st = await checkLogin(p)
    console.log(`   登录: ${st.isLogin ? '❌ 失效' : '✅ 有效'} | 店铺: ${st.shop || '(未识别)'}`)
    await b.close()
    break
  }

  default:
    console.log(`未知命令: ${cmd}`)
    process.exit(1)
}
