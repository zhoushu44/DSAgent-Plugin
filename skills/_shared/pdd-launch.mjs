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
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { cleanCookiePollutionSync } from './cookie-clean.mjs'

// 凭证库是 ESM，但本文件需要同步读 → 用 createRequire 走 CJS 入口。
//
// ★ 2026-10-27：base 从 import.meta.url 推导，不再硬编码绝对路径。
//   原为 createRequire('E:/360MoveData/.../DSAgent-Plugin/package.json')，
//   换机器 / 换目录 / 插件被复制到别处后必然失效（报 MODULE_NOT_FOUND）。
//
//   目录结构（本文件在 skills/_shared/ 下）：
//     <插件根>/package.json                        ← 目标
//     <插件根>/lib/services/credential-store.js    ← _require 的相对目标
//     <插件根>/skills/_shared/pdd-launch.mjs       ← 本文件
//   所以要从 HERE 上推**两层**才到插件根。
//
//   回退链（覆盖「目录被移动」等异常情形）：
//     ① <插件根>/package.json   正常
//     ② <_shared>/package.json  目录结构不同时
//     ③ tmpdir 占位             都找不到时至少不崩，后续读取走 catch
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..')
const PKG_CANDIDATES = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
]
const PKG_BASE = PKG_CANDIDATES.find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-launch-base.json')
const _require = createRequire(PKG_BASE)

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
 * @returns {{ executablePath, userDataDir, profileMissing?: boolean, resolvedProfile?: string, headless, defaultViewport, args, ignoreDefaultArgs, ...}}
 */
export function launchOptions(shopKey, extra = {}) {
  const base = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts')
  let profile = path.join(base, shopKey)

  // ★ 2026-10-24：shopKey 自带的 profile 目录里可能是**过期票据**。
  //
  //   实例（实测）：
  //     shopKey       = pdd_mms_0701d3ca4163a60d16f06a679099dcc8
  //     display_label = de55c3e159072dfb5297b234eaa487c3
  //     · pdd_mms_0701d3ca... 目录存在，但里面 PASS_ID 已过期（43001）
  //     · pdd_mms_de55c3e...  目录里才是有效登录态
  //
  //   根因：账号连接器「收编 Profile」时按 display_label 命名目录，
  //   而 shopKey 用 account_id 命名，两者不一致。
  //
  //   解法：shopKey 目录不存在时，按 profileCandidates() 列出的
  //   候选名依次试，取第一个存在的。票据是否有效仍靠 43001 判定。
  if (!fs.existsSync(profile)) {
    for (const alt of profileCandidates(shopKey)) {
      if (fs.existsSync(path.join(base, alt))) { profile = path.join(base, alt); break }
    }
  }

  // ★ 2026-10-27 修：删掉原来的「硬编码兜底目录」。
  //
  //   原代码：
  //     if (!fs.existsSync(profile)) {
  //       const fallback = path.join(base, 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
  //       if (fs.existsSync(fallback)) profile = fallback
  //     }
  //
  //   问题：这是**隐式借用未知账号身份**。任何 shopKey 目录缺失时
  //   （新账号未登录过、目录被清理、shopKey 命名规则变更），
  //   都会静默落到这一个固定目录 → 用「不知道是谁」的登录态操作，
  //   查到的可能是别的店铺数据，写入甚至可能落到错误账号上。
  //
  //   而且该目录不在凭证库里（孤儿 Profile），一旦过期或被清理，
  //   所有技能会静默失败且看不出原因。
  //
  //   现在：**直接抛错**，绝不静默借用。
  //
  //   为什么是抛错而不是只返回 profileMissing 字段：`launchOptions()` 有 6 个调用方
  //   （pdd-client / pdd-works / pdd-video / pdd-promo/images / fill-mall-names），
  //   逐个加检查容易漏；而在入口抛错可让所有调用方自动获得保护，
  //   且报错信息比「Chrome 用不存在路径启动后莫名失败」清晰得多。
  //   想兼容旧目录请在 profileCandidates() 里显式加候选。
  if (!fs.existsSync(profile)) {
    const tried = profileCandidates(shopKey).join('、')
    const err = new Error(
      `账号 ${shopKey} 没有对应的浏览器 Profile 目录（已尝试候选：${tried}）。\n`
      + `这不等于未绑定账号，而是「登录过但 Profile 目录不在预期位置」。\n`
      + `请到「账号连接」页面对该账号重新扫码登录一次（会自动收编 Profile），然后重试。`
    )
    err.code = 'PDD_PROFILE_MISSING'
    err.shopKey = shopKey
    throw err
  }

  // ★ 自动清理 Cookie 域污染（2026-10-28）
  //   拼多多 Cookie 同时存在于 .pinduoduo.com（父域，最新）/ mms / yingxiao（子域，旧值）。
  //   浏览器对同名 Cookie 优先发更具体的域 → 推广域拿到子域旧 SUB_PASS_ID，
  //   而不是父域新值 → 「推广域反复掉登录、mms 主域正常」，重扫码也治不好。
  //   这里删掉子域重名项，让浏览器回落到父域新值。幂等；跳过用 --no-cookie-clean。
  if (!process.argv.includes('--no-cookie-clean')) {
    try {
      const cleaned = cleanCookiePollutionSync(profile)
      if (cleaned > 0) console.warn(`[pdd-launch] ✅ 清理 ${cleaned} 条域污染 Cookie`)
    } catch (e) {
      console.warn('[pdd-launch] Cookie 清理跳过：' + String(e.message).slice(0, 60))
    }
  }


  return {
    executablePath: CHROME_PATH,
    userDataDir: profile,
    resolvedProfile: path.basename(profile),
    headless: false,
    // ★★★ 关键修正：null = 用真实窗口尺寸，不强制覆盖 innerWidth/innerHeight
    defaultViewport: null,
    args: [...STEALTH_ARGS, ...(extra.args || [])],
    ignoreDefaultArgs: ['--enable-automation'],   // ★ 去掉「Chrome 正受自动化软件控制」提示
    ...extra,
  }
}

/**
 * 列出该 shopKey 可能对应的 profile 目录名（按优先级）
 *
 * 账号连接器的命名历史：
 *   ① pdd_mms_{account_id}                 shopKey 本体
 *   ② pdd_mms_{display_label}              收编 Profile 时的名字
 *      （display_label 常是 mall_id / 32 位 hex，如 de55c3e159072dfb5297b234eaa487c3）
 *   ③ 无平台前缀的 {display_label}           早期收编遗漏前缀
 *   ④ pdd_mms_pdd_mms_{label} / 无下划线变体  历史上双重前缀 bug 的产物
 *      （磁盘上确实存在这两个目录，见 ~/.dsh/browser-profiles/accounts/）
 *
 * ★ 2026-10-27 补 ③④：这两个变体在磁盘上真实存在，是早期「前缀拼接 bug」
 *   留下的。把它们显式列进候选链，就不需要那个危险的硬编码兜底了。
 *   ⚠ 只加「与当前 shopKey 有关联」的变体，绝不加与 shopKey 无关的固定目录。
 */
export function profileCandidates(shopKey) {
  const out = [shopKey]
  let label = null
  try {
    // ★ 凭证库是 AES-256-GCM 加密的，不能直接读 JSON，
    //   要用 CredentialStore 的解密接口（listAccounts 是同步的）。
    const { CredentialStore } = _require('./lib/services/credential-store.js')
    const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
    const acc = store.listAccounts().find(a => a.shop_key === shopKey)
    if (acc) {
      label = acc.display_label || acc.account_meta?.display_nick || acc.account_meta?.mall_name
    }
  } catch { /* ignore */ }
  if (label && /^[0-9a-f]{16,}$/i.test(String(label))) {
    out.push('pdd_mms_' + label)                                  // ②
    out.push(label)                                               // ③ 无前缀
    out.push('pdd_mms_pdd_mms_' + label)                          // ④ 双重前缀
    out.push('pdd_mms_' + 'pddmms' + label)                       // ④ 无下划线变体
  }
  return [...new Set(out)]
}

/**
 * 清理 Chrome 遗留的 Profile 锁文件。
 *
 * ★ 2026-10-27 新增（与插件侧 browser-login.ts 的 clearProfileLocks 等价）。
 *   上一次验证的浏览器被强杀 / 崩溃时，userDataDir 里的 SingletonLock 等会残留，
 *   导致下次 puppeteer.launch 直接 `Failed to launch the browser process!`，
 *   且报错指不到真正原因。启动前清一遍 + 失败后清一遍重试。
 *
 * @param {string} dir userDataDir 绝对路径
 */
export function clearProfileLocks(dir) {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    try { fs.rmSync(path.join(dir, name), { force: true }) } catch { /* 不存在或正被占用 */ }
  }
}

/**
 * 在页面注入反检测脚本（page.evaluateOnNewDocument 之前调）
 *
 * ★ 2026-10-27 重写：不再用 Object.defineProperty 定义 getter（那会留下痕迹，
 *   Object.getOwnPropertyDescriptor 一行识破）。改用原生 setter 改写属性值，
 *   属性描述符形态与真实浏览器一致。详见 STEALTH_SCRIPT 上方注释。
 */
/**
 * 反检测注入脚本
 *
 * ★ 2026-10-27 重写：原来用 `Object.defineProperty(navigator, 'webdriver', { get: ... })`
 *   覆盖属性，这恰恰**留下自定义 getter 痕迹**——平台只要一行
 *   `Object.getOwnPropertyDescriptor(navigator,'webdriver')` 就能识破：
 *   原生属性是 `{ value, writable, ... }` 描述符，被改过的是 `{ get, set, ... }`。
 *   等于主动举手说"我是自动化"。
 *
 *   现在改用**原生 setter 改写自有属性值**：
 *     · `webdriver` / `languages` 在 Navigator.prototype 上有原生 setter
 *       → 用 `Reflect` 找到原型链上的 setter 调用，属性描述符保持原生形态
 *     · 找不到原生 setter 时才退化为 defineProperty（并尽量模拟 value 描述符）
 *
 *   另外 `plugins` 原来返回普通对象数组，`instanceof Plugin` 为 false、
 *   `Object.getPrototypeOf(plugins[0])` 对不上 —— 现在改从真实 Chrome 的
 *   插件列表取，取不到才用最小可用兜底。
 *
 *   仍覆盖的项（觅千手 SDK 会采集的 20 项里最易被 puppeteer 污染的）：
 *     · navigator.webdriver         → puppeteer 默认 true
 *     · navigator.plugins.length    → 无头/自动化环境常为 0
 *     · navigator.languages         → 可能只有 en-US
 *     · chrome.runtime              → 自动化环境可能缺失
 */
export const STEALTH_SCRIPT = `
(function () {
  'use strict';

  /**
   * 用原型链上的原生 setter 改写属性值。
   * 这样属性的描述符形态与真实浏览器一致（不会留下自定义 getter）。
   * @returns {boolean} 是否成功走了原生 setter
   */
  function setViaNativeSetter(obj, prop, value) {
    try {
      let proto = obj;
      while (proto) {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (d) {
          if (d.set) { d.set.call(obj, value); return true; }
          if (d.writable && proto === obj) { obj[prop] = value; return true; }
          return false;   // 只有 getter（非原生可写）→ 交给调用方兜底
        }
        proto = Object.getPrototypeOf(proto);
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // ① navigator.webdriver → false（最基础的检测项）
  //    优先走原生 setter；失败才 defineProperty，且用 value 描述符（不是 getter）
  if (!setViaNativeSetter(navigator, 'webdriver', false)) {
    try { Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true }); } catch (e) {}
  }

  // ② navigator.languages → 按账号配置（2026-10-28 改）
  //    ★ 原为硬编码 ['zh-CN','zh','en'] —— 所有账号完全一致，
  //      多账号时这是一个"同一台机器"的关联特征。
  //    现在读 window.__PDD_LANGS__（由 pdd-launch 按 shopKey 注入，
  //    来自比特 Lang 映射表的变体），读不到才用原中文默认值。
  var LANGS = (window.__PDD_LANGS__ && window.__PDD_LANGS__.length) ? window.__PDD_LANGS__ : ['zh-CN', 'zh', 'en'];
  if (!setViaNativeSetter(navigator, 'languages', LANGS)) {
    try { Object.defineProperty(navigator, 'languages', { value: LANGS, configurable: true }); } catch (e) {}
  }

  // ③ navigator.plugins → 真实 Chrome 至少有 PDF 插件
  //    用 navigator.plugins 自身迭代构造，保证 item()/namedItem() 行为与原型一致
  try {
    const real = [];
    const src = navigator.plugins;
    for (let i = 0; i < (src ? src.length : 0); i++) real.push(src[i]);
    if (real.length === 0) {
      // 兜底：构造 PluginArray 兼容对象（不假装成 Plugin 实例，避免 instanceof 露馅）
      const names = ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'WebKit built-in PDF'];
      real.push(...names.map(n => ({ name: n, filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 })));
    }
    const arr = real.slice();
    arr.item = (i) => real[i] || null;
    arr.namedItem = (n) => real.find(p => p.name === n) || null;
    arr.refresh = () => {};
    Object.defineProperty(arr, 'length', { value: real.length, configurable: true });
    if (!setViaNativeSetter(navigator, 'plugins', arr)) {
      try { Object.defineProperty(navigator, 'plugins', { value: arr, configurable: true }); } catch (e) {}
    }
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
})();
`;

/**
 * 一键启动 + 注入反检测 + 每账号指纹
 * @returns {{ browser, page }}
 */
export async function launchStealth(shopKey, puppeteer, extra = {}) {
  const browser = await puppeteer.launch(launchOptions(shopKey, extra))
  const page = (await browser.pages())[0] || await browser.newPage()
  // ★ 执行顺序很重要：evaluateOnNewDocument 按注册顺序跑，
  //   __PDD_LANGS__ 必须在 STEALTH_SCRIPT 之前（后者读它决定 navigator.languages）。
  try {
    const { webglFingerprintScript, pickLanguages } = await import('./pdd-fingerprint.mjs')
    // 语言：先设全局变量，STEALTH_SCRIPT 里的 navigator.languages 会读它
    const langs = pickLanguages(shopKey)
    await page.evaluateOnNewDocument(`window.__PDD_LANGS__ = ${JSON.stringify(langs)};`)
  } catch (e) {
    console.error(`[pdd-launch] ⚠ 语言指纹注入失败，用默认中文：${String(e && e.message || e).slice(0, 100)}`)
  }
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)
  // ★ 2026-10-28 补：每账号一套 WebGL 指纹（取自比特浏览器 18 套预制模板）。
  //   多账号共用同一套机器指纹 = 平台一眼看出"这些号是同一台机器"。
  //   同账号永远同一套（按 shopKey hash，不随机），不同账号不同。
  try {
    const { webglFingerprintScript } = await import('./pdd-fingerprint.mjs')
    const fp = webglFingerprintScript(shopKey)
    if (fp) await page.evaluateOnNewDocument(fp)
  } catch (e) {
    // 指纹注入失败不阻断业务（降级为原生指纹）
    console.error(`[pdd-launch] ⚠ WebGL 指纹注入失败，降级为原生指纹：${String(e && e.message || e).slice(0, 100)}`)
  }
  return { browser, page }
}
