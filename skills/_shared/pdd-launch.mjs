/**
 * PDD 统一浏览器启动配置（从觅千手 SDK 指纹采集清单反推）
 *
 * 觅千手 SDK 采集的 20 项指纹（AesApp_2.js 类 f）：
 *   innerHeight / innerWidth / devicePixelRatio
 *   availHeight / availWidth / height / width / colorDepth / locationHref
 *   navigator.{appCodeName,appName,hardwareConcurrency,language,cookieEnabled,
 *              platform,doNotTrack,vendor,product,productSub}
 *   referer / timezoneOffset
 *
 * ★ 关键结论：
 *   ① 不含 Canvas / WebGL / AudioContext 指纹 → 不需要复杂反指纹
 *   ② 只有基础环境项 → 只要「让环境自洽」即可
 *   ③ devicePixelRatio / screen.* 与 viewport 不一致是最容易露马脚的点
 *
 * 因此正确做法：
 *   · defaultViewport: null       ← 用真实窗口尺寸，不强制
 *   · --start-maximized           ← 最大化，让 innerWidth ≈ screen.availWidth
 *   · 不禁用 AutomationControlled 相关特性（反而要主动隐藏）
 *   · webdriver 必须为 false      ← navigator.webdriver 是最基础的检测
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

export const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

/** ★ 统一的反检测启动参数（2026-10-23 从 SDK 指纹清单反推） */
export const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // ★ 关键：不用 --disable-blink-features=AutomationControlled 单独对抗，
  //   改成下面几条一起做「让自动化痕迹自然消失」
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--start-maximized',                    // 让 innerWidth ≈ screen.availWidth
  '--window-position=0,0',
  '--no-default-browser-check',
  '--no-first-run',
  '--disable-features=IsolateOrigins,site-per-process',
  '--lang=zh-CN',
]

/**
 * 生成 puppeteer 启动参数（统一入口，所有 pdd 技能都该用这个）
 * @param {string} shopKey 账号
 * @param {object} extra 额外参数
 */
export function launchOptions(shopKey, extra = {}) {
  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
  if (!fs.existsSync(profile)) {
    // 兼容旧的 hash 目录
    const fallback = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
    if (fs.existsSync(fallback)) profile = fallback
  }
  return {
    executablePath: CHROME_PATH,
    userDataDir: profile,
    headless: false,
    // ★★★ 关键修正：null = 用真实窗口尺寸，不强制覆盖 innerWidth/innerHeight
    defaultViewport: null,
    args: [...STEALTH_ARGS, ...(extra.args || [])],
    ignoreDefaultArgs: ['--enable-automation'],   // ★ 去掉「Chrome 正受自动化软件控制」提示
    ...extra,
  }
}

/**
 * 在页面注入反检测脚本（page.evaluateOnNewDocument 之前调）
 *
 * 覆盖觅千手 SDK 会采集的项里，最容易被 puppeteer 污染的：
 *   · navigator.webdriver         → puppeteer 默认 true
 *   · navigator.plugins.length    → 无头/自动化环境常为 0
 *   · navigator.languages         → 可能只有 en-US
 *   · chrome.runtime              → 自动化环境可能缺失
 */
export const STEALTH_SCRIPT = `
  // ① navigator.webdriver → undefined（最基础的检测项）
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // ② navigator.plugins → 补齐常见插件（真实的 Chrome 至少有 PDF 插件）
  try {
    const fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => Object.assign(fakePlugins, { length: fakePlugins.length, item: i => fakePlugins[i], namedItem: n => fakePlugins.find(p => p.name === n) }),
    });
  } catch (e) {}

  // ③ navigator.languages → 中文环境
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  } catch (e) {}

  // ④ chrome.runtime → 补齐（真实 Chrome 有）
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch (e) {}

  // ⑤ permissions.query 一致性（避免 notification 检测露馅）
  try {
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) => (
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery.call(window.navigator.permissions, params)
      );
    }
  } catch (e) {}
`;

/**
 * 一键启动 + 注入反检测
 * @returns {{ browser, page }}
 */
export async function launchStealth(shopKey, puppeteer, extra = {}) {
  const browser = await puppeteer.launch(launchOptions(shopKey, extra))
  const page = (await browser.pages())[0] || await browser.newPage()
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)
  return { browser, page }
}
