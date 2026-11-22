/**
 * taobao-browser.mjs —— 淘宝浏览器通道（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么基座需要浏览器通道（不只是 mtop HTTP）
 * ══════════════════════════════════════════════════════════════════
 *   发布类技能（taobao-publish / taobao-publish-mqs / tmall-publish-mqs）**没法纯 HTTP**：
 *     · 类目属性、SKU 表单、运费模板都由页面 JS 运行时渲染
 *     · 提交需要页面会话里的真实票据与签名
 *     · 图片上传虽有 HTTP 直传（见 taobao-upload.mjs），但表单 state 只能页面注入
 *   PUBLISH-MATRIX.md 已明确结论：**发布一律 puppeteer 驱动网页版发布页**。
 *
 *   而 mtop HTTP 通道解决的是另一类问题（采集 / 详情 / 评价 / 问大家），
 *   所以两条通道**并存、各管一段**，不是替代关系。
 *
 * ══════════════════════════════════════════════════════════════════
 * 本模块提供什么（不自造轮子，复用本机 Chrome + 账号 Profile）
 * ══════════════════════════════════════════════════════════════════
 *   · 用账号自己的 browser Profile 启动（登录态天然在位，不用重新扫码）
 *   · 统一的 page 获取 / 导航 / 等待选择器 / 截图
 *   · 从页面实时取 Cookie（HTTP 通道的 Cookie 失效时可自愈）
 *   · 执行页面内 fetch（带页面身份的签名上下文，用于必须页面签名的接口）
 *
 * 依赖：puppeteer-core（插件已装）+ 本机 Chrome。
 * Profile 路径与 pdd-launch / xhs-browser 保持同一约定：
 *   ~/.dsh/browser-profiles/accounts/<shopKey>
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROFILE_ROOT = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')

/** 探测本机 Chrome 可执行文件 */
export function findChrome() {
  const cands = []
  if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA'],
    ].filter(Boolean)
    for (const r of roots) {
      cands.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      cands.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  } else {
    cands.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser')
  }
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c } catch { /* ignore */ }
  }
  return ''
}

/** 账号 Profile 目录（不存在则创建） */
export function profileDir(shopKey) {
  const dir = path.join(PROFILE_ROOT, shopKey)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

let _puppeteer = null
async function loadPuppeteer(pluginRoot) {
  if (_puppeteer) return _puppeteer
  const p = path.join(pluginRoot, 'node_modules', 'puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js')
  const url = new URL(`file:///${p.replace(/\\/g, '/')}`).href
  const mod = await import(url)
  _puppeteer = mod.default || mod
  return _puppeteer
}

/**
 * 打开一个淘宝页面会话
 * @param {object} o
 * @param {string} o.shopKey
 * @param {string} o.pluginRoot   插件根（找 puppeteer-core）
 * @param {boolean} [o.headless]
 * @returns {Promise<{browser:any, page:any, close:()=>Promise<void>, cookies:()=>Promise<Record<string,string>>}>}
 */
export async function openSession(o) {
  const { shopKey, pluginRoot, headless = true } = o
  const puppeteer = await loadPuppeteer(pluginRoot)
  const exe = findChrome()
  if (!exe) throw new Error('找不到本机 Chrome（puppeteer 需要）')

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: headless ? 'new' : false,
    userDataDir: profileDir(shopKey),
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    defaultViewport: { width: 1440, height: 900 },
  })

  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({ 'accept-language': 'zh-CN,zh;q=0.9' })

  const close = async () => {
    try { await browser.close() } catch { /* ignore */ }
  }

  /** 从浏览器实时取 Cookie（键值对） */
  const cookies = async () => {
    try {
      const list = await page.cookies()
      const jar = {}
      for (const c of list) jar[c.name] = c.value
      return jar
    } catch {
      return {}
    }
  }

  return { browser, page, close, cookies }
}

/** 导航并等加载完成 */
export async function goto(page, url, { timeout = 60_000, waitUntil = 'domcontentloaded' } = {}) {
  await page.goto(url, { waitUntil, timeout })
  return page
}

/** 等选择器出现（返回元素句柄，失败返回 null） */
export async function waitFor(page, selector, timeout = 30_000) {
  try {
    return await page.waitForSelector(selector, { timeout })
  } catch {
    return null
  }
}

/** 截图（排障用） */
export async function screenshot(page, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await page.screenshot({ path: outPath, fullPage: false })
  return outPath
}

/**
 * 在页面上下文里发 fetch（带页面真实签名/票据）
 * 用于「必须页面 JS 签名」的接口（发布、图形验证等）
 */
export async function pageFetch(page, { url, method = 'GET', body = null, headers = {} } = {}) {
  return page.evaluate(async (u, m, b, h) => {
    const res = await fetch(u, {
      method: m,
      headers: h,
      body: b == null ? undefined : (typeof b === 'string' ? b : JSON.stringify(b)),
      credentials: 'include',
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* ignore */ }
    return { status: res.status, json, text: text.slice(0, 4000) }
  }, url, method, body, headers)
}

export default { findChrome, profileDir, openSession, goto, waitFor, screenshot, pageFetch }
