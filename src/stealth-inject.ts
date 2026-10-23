/**
 * 反检测注入工具
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么不能用 Object.defineProperty 覆写 navigator
 * ══════════════════════════════════════════════════════════════════
 *
 * PDD 官方 SDK 的 `hl` 15 项反自动化检测里，有一条专门抓这个：
 *
 *   u("0x11d") in navigator  &&  navigator.hasOwnProperty(u("0x11d"))
 *
 * 即「先 in 查，再 hasOwnProperty 双查」。真实 Chrome 里
 * `navigator.webdriver` 存在且是 false；而 defineProperty 覆写后：
 *
 *   Object.getOwnPropertyDescriptor(navigator, 'webdriver')
 *     → { get: [Function], set: undefined, enumerable: true, configurable: true }
 *
 * **属性描述符里带了自定义 getter，一行就识破。** 同理适用于
 * Function.prototype.bind.toString() 的检测。
 *
 * ══════════════════════════════════════════════════════════════════
 * 正确做法：HTML 注入 + 随机化 + 自删除
 * ══════════════════════════════════════════════════════════════════
 *
 * 来自 patchright 的做法（`patchright-core/lib/coreBundle.js:36301-36303`）：
 *   ① 拦截 document 响应
 *   ② 在 <head> 里第一个「真 script」之前插入一个 <script> 标签
 *   ③ class / id 用随机 hex，避免被特征匹配
 *   ④ 执行完 remove() 自身，不留痕迹
 *
 * 这样做的好处：
 *   · 不改属性描述符（不触发 hasOwnProperty 双查）
 *   · 用原生赋值 delete/覆盖，descriptor 与真实 Chrome 一致
 *   · script 标签执行后消失，DOM 里无残留
 */

/** 生成随机 hex 字符串 */
function rndHex(len: number): string {
  const chars = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

/**
 * 反检测脚本内容（字符串形式）
 *
 * 注意：
 *   · 用 `delete navigator.webdriver` + 重新定义的方式，
 *     让 descriptor 变成原生 data descriptor，而不是 getter
 *   · 真实 Chrome 的 navigator.webdriver 是 false（非 undefined）
 *   · Chrome 有时会在文档创建后再设回 webdriver=true，所以延迟多修几次
 */
const STEALTH_BODY = `
(function () {
  function fix() {
    try {
      delete navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        value: false, writable: false, enumerable: true, configurable: true,
      })
    } catch (e) {}
    try {
      var fake = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      ]
      var make = function () {
        var a = fake.slice()
        a.item = function (i) { return fake[i] }
        a.namedItem = function (n) { return fake.find(function (p) { return p.name === n }) }
        a.refresh = function () { return undefined }
        return a
      }
      Object.defineProperty(navigator, 'plugins', { get: make, configurable: true })
    } catch (e) {}
    try {
      Object.defineProperty(navigator, 'languages', {
        get: function () { return ['zh-CN', 'zh', 'en'] }, configurable: true,
      })
    } catch (e) {}
    try {
      if (!window.chrome) window.chrome = {}
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect: function () { return { onMessage: { addListener: function () {} }, disconnect: function () {} } },
          sendMessage: function () { return undefined },
          onMessage: { addListener: function () {}, removeListener: function () {} },
          onConnect: { addListener: function () {}, removeListener: function () {} },
          id: undefined,
        }
      }
    } catch (e) {}
    try {
      var origQuery = window.navigator.permissions && window.navigator.permissions.query
      if (origQuery) {
        window.navigator.permissions.query = function (params) {
          if (params && params.name === 'notifications') return Promise.resolve({ state: Notification.permission })
          return origQuery.call(window.navigator.permissions, params)
        }
      }
    } catch (e) {}
  }
  fix()
  setTimeout(fix, 0)
  setTimeout(fix, 50)
  setTimeout(fix, 200)
})();
`

/**
 * ★ 直接注入版（主力）
 *
 * 为什么不用 HTML <script> 注入：
 *   · about:blank / data: 页面上 script 标签的插入与执行时机不可靠
 *   · evaluateOnNewDocument 本身就是页面上下文执行，等价于「最早的真 script」
 *   · 关键是**不要留下自定义 getter** —— 我们用 delete + data descriptor
 *
 * 用法：
 *   await page.evaluateOnNewDocument(STEALTH_DIRECT)
 */
export const STEALTH_DIRECT = STEALTH_BODY

/**
 * HTML 注入版（备用：某些场景需要真实 script 标签）
 *
 * 用法：
 *   await page.evaluateOnNewDocument(STEALTH_SOURCE)
 */
export const STEALTH_SOURCE = `(function () {
  var cls = '${rndHex(8)}'
  var id = '${rndHex(10)}'
  var s = document.createElement('script')
  s.className = cls
  s.id = id
  s.textContent = ${JSON.stringify(STEALTH_BODY)}
  var insert = function () {
    var head = document.head || document.getElementsByTagName('head')[0]
    if (!head) { return }
    var firstReal = null
    for (var i = 0; i < head.children.length; i++) {
      var c = head.children[i]
      if (c.tagName === 'SCRIPT' && c.src) { firstReal = c; break }
    }
    if (firstReal) { head.insertBefore(s, firstReal) }
    else { head.appendChild(s) }
    s.addEventListener('load', function () { if (s.parentNode) s.parentNode.removeChild(s) })
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s) }, 3000)
  }
  if (document.head) { insert() }
  else {
    var obs = new MutationObserver(function () {
      if (document.head) { obs.disconnect(); insert() }
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
  }
})()`

/**
 * 给 page 挂反检测（直接注入版）
 */
export async function applyStealth(page: any): Promise<void> {
  await page.evaluateOnNewDocument(STEALTH_DIRECT)
}

/**
 * 旧版（不推荐）：defineProperty 覆写
 * 保留仅为兼容，调用方应尽快迁移到 applyStealth
 * @deprecated
 */
export const STEALTH_LEGACY = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
}
