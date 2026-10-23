#!/usr/bin/env node
/**
 * PDD captcha 通行证管理 CLI
 *
 * 用法：
 *   node pdd-captcha-token.mjs --status [--account SHOP]      查看当前通行证状态
 *   node pdd-captcha-token.mjs --set TOKEN [--account SHOP]   手动存入 verifyAuthToken
 *   node pdd-captcha-token.mjs --clear [--account SHOP]       清除
 *   node pdd-captcha-token.mjs --auto [--account SHOP]        自动抓取：开页面等滑块过完，自动提取 token
 *   node pdd-captcha-token.mjs --watch [--account SHOP]       常驻监听：每次页面发请求就抓 token（推荐）
 *
 * 原理（从觅千手 SDK 逆向）：
 *   滑块过一次 → 拿 verifyAuthToken → 有效期 10 分钟
 *   这 10 分钟内所有请求带 VerifyAuthToken 头 → 不再弹滑块
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PLUGIN_ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const {
  saveCaptchaToken, getCaptchaToken, clearCaptchaToken, extractCaptchaToken,
  recordCaptchaPass, fmtRemain,
} = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-risk.mjs`)

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const has = (n) => process.argv.includes(`--${n}`)

// 找账号
let SHOP = argOf('account')
if (!SHOP) {
  const { CredentialStore } = await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)
  const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const accs = store.listAccounts().filter(a => a.platform === 'pdd_mms')
  // 优先选最近心跳的
  SHOP = accs[0]?.shop_key
  if (!SHOP) { console.error('❌ 没有 pdd_mms 账号'); process.exit(1) }
}

// ── --status ──
if (has('status')) {
  const t = getCaptchaToken(SHOP)
  console.log(`账号: ${SHOP}`)
  if (t) {
    console.log(`✅ 有有效通行证，剩余 ${fmtRemain(t.remainMs)}`)
    console.log(`   token: ${t.token.slice(0, 24)}...`)
  } else {
    console.log(`❌ 无有效通行证（过期或未存）`)
    console.log(`   → 需要手动过一次滑块，或用 --watch 自动抓取`)
  }
  process.exit(0)
}

// ── --set ──
const setVal = argOf('set')
if (setVal) {
  if (saveCaptchaToken(SHOP, setVal)) {
    console.log(`✅ 已存入通行证: ${setVal.slice(0, 24)}...（10 分钟有效）`)
  } else {
    console.error('❌ 存入失败')
    process.exit(1)
  }
  process.exit(0)
}

// ── --clear ──
if (has('clear')) {
  clearCaptchaToken(SHOP)
  console.log(`✅ 已清除 ${SHOP} 的通行证`)
  process.exit(0)
}

// ── --auto / --watch ──
if (has('auto') || has('watch')) {
  const isWatch = has('watch')
  const PROFILE = join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  const browser = await puppeteer.launch({
    executablePath: chrome, userDataDir: PROFILE, headless: false,
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox', '--window-position=100,50', '--start-maximized', '--disable-blink-features=AutomationControlled'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()

  // ★ 在页面内 hook，捕获所有带 verifyAuthToken 的响应
  await page.evaluateOnNewDocument(() => {
    window.__tokens = []
    const O = XMLHttpRequest.prototype.open
    const S = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return O.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function () {
      const self = this
      this.addEventListener('load', () => {
        try {
          const txt = self.responseText
          if (!txt || !txt.includes('verifyAuthToken')) return
          const j = JSON.parse(txt)
          const t = j?.result?.verifyAuthToken ?? j?.data?.verifyAuthToken
          if (typeof t === 'string' && t.length > 10) {
            window.__tokens.push({ url: String(self.__u).slice(0, 120), token: t, ts: Date.now() })
          }
        } catch { /* ignore */ }
      })
      return S.apply(this, arguments)
    }
  })

  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 10; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await sleep(1000)
    }
    return null
  }

  console.log('='.repeat(74))
  console.log(`  ${isWatch ? '常驻监听模式' : '自动抓取模式'}`)
  console.log('='.repeat(74))
  console.log(`账号: ${SHOP}`)
  console.log('')
  console.log('浏览器已打开。请：')
  console.log('  1. 如果弹滑块 → 手动拖过去')
  console.log('  2. 如果要求扫码 → 扫码')
  console.log('  3. 通过后我会自动抓取 verifyAuthToken 并存入')
  console.log('')

  // 打开一个会触发 54001 的页面（推广域最容易触发）
  await page.goto('https://yingxiao.pinduoduo.com/mains/promotionOverview', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})

  let saved = null
  const deadline = Date.now() + (isWatch ? 30 * 60 * 1000 : 10 * 60 * 1000)
  let lastCount = 0

  while (Date.now() < deadline) {
    await sleep(2500)
    const tokens = await safeEval(() => window.__tokens || [])
    if (tokens && tokens.length > lastCount) {
      lastCount = tokens.length
      const latest = tokens[tokens.length - 1]
      saveCaptchaToken(SHOP, latest.token)
      recordCaptchaPass(SHOP, 'manual')
      saved = latest
      const t = getCaptchaToken(SHOP)
      console.log(`\n✅ 抓到通行证！`)
      console.log(`   token: ${latest.token.slice(0, 32)}...`)
      console.log(`   来源: ${latest.url}`)
      console.log(`   有效期: 10 分钟（剩余 ${fmtRemain(t?.remainMs || 0)}）`)
      console.log(`\n   现在所有 pdd 技能会自动带 VerifyAuthToken 头，10 分钟内不再弹滑块。`)
      if (!isWatch) break
    }
    // 状态提示
    const st = await safeEval(() => {
      const txt = document.body?.innerText || ''
      const hasSlider = Array.from(document.querySelectorAll('[class*="Modal"], [class*="MDL"]'))
        .some(m => { const r = m.getBoundingClientRect(); return r.width > 200 && /滑块|拼图|验证/.test((m.innerText || '').slice(0, 60)) })
      return { hasSlider, isLogin: /\/login|\/sso/i.test(location.href), len: txt.length }
    })
    if (st?.hasSlider) console.log(`[${new Date().toLocaleTimeString()}] ⏳ 有滑块 —— 请拖过去`)
    else if (st?.isLogin) console.log(`[${new Date().toLocaleTimeString()}] ⏳ 登录页 —— 请扫码`)
  }

  if (!saved) {
    console.log('\n⚠️ 超时未抓到 token。可能：')
    console.log('   ① 滑块没过')
    console.log('   ② 页面没触发 54001（当前无风控）')
    console.log('   ③ 登录态失效')
  }
  console.log('\n窗口保持 30s...')
  await sleep(30000)
  await browser.close()
  process.exit(saved ? 0 : 1)
}

console.error(`用法：
  node pdd-captcha-token.mjs --status [--account SHOP]
  node pdd-captcha-token.mjs --set TOKEN [--account SHOP]
  node pdd-captcha-token.mjs --clear [--account SHOP]
  node pdd-captcha-token.mjs --auto [--account SHOP]     开页面等滑块过完自动抓
  node pdd-captcha-token.mjs --watch [--account SHOP]    常驻监听（推荐）`)
process.exit(1)
