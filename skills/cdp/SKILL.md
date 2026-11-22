---
name: cdp
description: "用 CDP 连接已在运行的 Chrome，全程不关浏览器、不丢登录态、不用固定 sleep，并能拦截分析网络请求。当用户说别关浏览器、连上我开着的窗口、不要重启、复用我的登录态、页面报 detached frame、上传文件没反应、脚本启动太慢、要抓接口/分析请求时使用。任何需要浏览器交互（点按钮、填表、传文件、抓 DOM、看网络）但不希望重启浏览器的场景都用这个。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "CDP 浏览器操控"
    emoji: "🔌"
    requires: {}
---

# CDP 操控浏览器：不关浏览器

**核心目标只有一个：连上用户已经开着的浏览器，全程不杀进程。**

杀浏览器是这类任务最大的坑——一旦杀掉，登录态没了、用户正在看的页面没了、下一步还得重新扫码。

## 何时调用

- 用户说：**别关浏览器**、别 kill、连上我开着的那个窗口、不要重启
- 用户已经手动登录好，希望复用这个登录态
- 页面反复报 `Attempted to use detached Frame` / `Execution context was destroyed`
- `uploadFile` 之后页面没反应
- 脚本每次都重启浏览器很慢
- 需要用户在旁边同时看/操作同一个浏览器

### 何时不调用

- 用户允许全新启动，且不需要保留登录态 → 直接 `puppeteer.launch`
- 纯静态抓取 → `fetch` 就够
- 目标是 canvas 内容、跨域 iframe 内部、系统级弹窗 → 本方法覆盖不到

## 必需输入

| 输入 | 说明 |
|---|---|
| 目标站点特征 | 用来判断该连哪个浏览器（域名或 URL 片段）|
| 要执行的操作 | 点哪些元素、填哪些值、传哪些文件 |
| 完成判据 | 什么现象算成功 |

---

# 一、核心：连上，不关

```powershell
# ❌ 绝对不要执行
Get-Process chrome | Stop-Process -Force
```

| | kill + 重启 | connect 已有 |
|---|---|---|
| 登录态 | **丢失，要重扫** | 保留 |
| 用户窗口 | **被关掉** | 不受影响 |
| 启动耗时 | 15~20s | **0.3~0.8s** |
| 用户能否同时操作 | 不能 | **能** |
| 页面状态 | 全部重置 | 保持原样 |

```js
// ✅ 用完只断开连接，浏览器继续开着
await browser.disconnect()
```

⚠ `browser.close()` 也会关浏览器，**不要用**。

---

# 二、找 CDP 端口

Chrome 的调试端口可能是随机的，**不要写死**。

## 方法 A：扫监听端口（推荐，最通用）

```js
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 连上已有浏览器
 * @param {RegExp} matchRe 目标站点特征，用来筛选浏览器
 * @returns {{browser, page, port} | null}
 */
async function connectExisting(matchRe = /https?:\/\//) {
  const cmd = process.platform === 'win32'
    ? "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"
    : "ss -tlnp 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -un"

  const out = execFileSync(process.platform === 'win32' ? 'powershell.exe' : 'bash',
    process.platform === 'win32' ? ['-NoProfile', '-Command', cmd] : ['-c', cmd],
    { encoding: 'utf8' })

  const ports = out.split(/\s+/).map(Number).filter(n => n > 1024)

  for (const pt of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(250) })
      const j = await r.json()
      if (!j.Browser || !/Chrome|Chromium|Edge/i.test(j.Browser)) continue

      const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
      const ps = await b.pages()

      // ★ 确认这个浏览器里有目标站点
      const hit = ps.find(x => { try { return matchRe.test(x.url()) } catch { return false } })
      if (hit) return { browser: b, page: hit, port: pt }

      await b.disconnect()      // 不是这个，断开继续找
    } catch { }
  }
  return null
}
```

**耗时**：扫 40~60 个端口约 **0.3~0.8s**。

## 方法 B：从 profile 的 DevToolsActivePort 读

Chrome 启动时会在 profile 目录写这个文件（第一行是端口）。

```js
import fs from 'node:fs'
import path from 'node:path'

const portFile = path.join(profileDir, 'DevToolsActivePort')
if (fs.existsSync(portFile)) {
  const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])

  // ★ 文件可能是残留（浏览器已关），必须先验证
  const alive = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(250) })
    .then(r => r.ok).catch(() => false)
  if (!alive) console.log('端口是残留，浏览器已关闭')
}
```

## 方法 C：从命令行参数找

```powershell
Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging-port=(\d+)' } |
  ForEach-Object { ($_.CommandLine -match 'remote-debugging-port=(\d+)') | Out-Null; $matches[1] }
```

---

# 三、每步重取 page（关键）

页面自己导航/重建会让旧 `page` 引用失效，报：

```
Attempted to use detached Frame 'xxx'
Execution context was destroyed, most likely because of a navigation.
```

**修法：每个关键步骤前重新取。**

```js
let p = null

async function refetch(re = /https?:\/\//, opts = {}) {
  const tries = opts.tries ?? 25
  const gap = opts.gap ?? 250

  for (let i = 0; i < tries; i++) {
    try {
      const ps = await browser.pages()          // ★ 每次重新取列表
      const hits = ps.filter(x => {
        try {
          const u = x.url()
          if (x.isClosed()) return false
          if (!re.test(u)) return false
          if (opts.exclude && opts.exclude.test(u)) return false   // 排除特定页
          return true
        } catch { return false }
      })
      if (hits.length) {
        p = hits[hits.length - 1]               // 取最后一个（最新标签）
        await p.bringToFront().catch(() => { })
        return p
      }
    } catch { }
    await sleep(gap)
  }
  return p
}
```

## 为什么要排除特定页

如果目标 URL 前后缀相同（如 `xxx/edit` 和 `xxx/edit/success`），不排除会误操作到成功页。

```js
await refetch(/mysite\.com\/form/, { exclude: /\/success/ })
```

## 实测效果

加了 refetch 之后，`detached Frame` 从**必现**变成 **0 次**。

---

# 四、打开新标签：轮询，别用 waitForTarget

点按钮会开新标签时，`waitForTarget` 偶尔漏事件。

```js
// ❌ 偶尔漏
const tp = browser.waitForTarget(t => /target-url/.test(t.url()), { timeout: 20000 })
await p.evaluate(() => document.querySelector('#btn').click())
const tg = await tp

// ✅ 稳定
await p.evaluate(() => {
  const b = document.querySelector('#btn')
  if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
})

let pg = null
for (let i = 0; i < 60; i++) {                 // 最多 15s
  const ps = await browser.pages()
  pg = ps.find(x => /target-url/.test(x.url()))
  if (pg) break
  await sleep(250)
}
if (pg) { await pg.bringToFront(); p = pg }
```

**耗时**：通常 1.5~2.5s。

---

# 五、等元素，不等秒数

```js
// ❌ 又慢又不稳
await sleep(3000)
await page.click('...')

// ✅ 元素一出现就走
await page.waitForSelector('#target', { timeout: 25000 })
await page.evaluate(() => document.querySelector('#target').click())
```

## 等数量出现（如列表行数）

```js
for (let i = 0; i < 40; i++) {                 // 最多 8s
  const n = await page.evaluate(() => document.querySelectorAll('#list tbody tr').length)
  if (n >= expected) break
  await sleep(200)
}
```

## 等文字出现

```js
for (let i = 0; i < 50; i++) {
  const hit = await page.evaluate(() => /操作成功|提交成功/.test(document.body.innerText || ''))
  if (hit) break
  await sleep(300)
}
```

## 等值回填

填完不能只看「点成功了」，要看「值真的在里面」。

```js
await page.evaluate((sel, v) => { /* 填值 */ }, sel, val)
for (let i = 0; i < 30; i++) {
  const now = await page.evaluate(s => document.querySelector(s)?.value, sel)
  if (String(now) === String(val)) break
  await sleep(200)
}
```

---

# 六、输入值：必须用原生 setter

直接 `el.value = v` 会被 React/Vue 的 value tracker 拦下——看起来值变了，但组件状态没更新，提交时是空的。

```js
async function setValue(page, selector, value) {
  await page.evaluate((s, v) => {
    const el = document.querySelector(s)
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    el.focus()
    if (setter) setter.call(el, String(v)); else el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }, selector, value)
}
```

## 特殊情况：输入后要回车才生效

```js
await page.evaluate((s, v) => {
  const el = document.querySelector(s)
  /* ...设置值... */
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
  el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
}, selector, value)
```

---

# 七、文件上传

## 核心坑：uploadFile 后必须补派发事件

```js
const fi = await page.$('input[type="file"]')

// 重试前先清空，否则同一个文件第二次会被浏览器忽略
await fi.evaluate(el => { try { el.value = '' } catch { } })

await fi.uploadFile(...filePaths)

// ★ 不做这步，框架收不到，页面显示「已上传 0 张」
await fi.evaluate(el => {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
```

**原理**：`uploadFile` 底层走 CDP `DOM.setFileInputFiles`，只设置 `input.files`，**不触发任何事件**。React/Vue 的受控组件监听 `change`，所以必须补发。

## 页面上有多个 file input 时怎么定位

```js
const loc = await page.evaluate(() => {
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('input[type="file"]')]

  // ① 按区块文字筛（最可靠）
  for (const el of document.querySelectorAll('section, div, form')) {
    const t = norm(el.innerText)
    if (!/上传图片|选择文件|拖拽/.test(t)) continue      // 换成目标页面的特征文字
    if (t.length > 800) continue                          // 太大的容器跳过
    const files = [...el.querySelectorAll('input[type="file"]')]
    if (!files.length) continue
    return { found: true, index: all.indexOf(files[files.length - 1]), why: 'block' }
  }

  // ② 兜底：multiple + accept 匹配，且排除已知的其他区域
  const rest = all.map((e, i) => ({ e, i }))
    .filter(x => x.e.multiple && !x.e.closest('section[class*="Carousel"]'))
  if (rest.length) return { found: true, index: rest[rest.length - 1].i, why: 'fallback' }

  return { found: false, total: all.length }
})
```

## 校验上传成功：轮询计数

```js
const readCount = async () => page.evaluate(() => {
  const t = document.body.innerText || ''
  const m = t.match(/已上传\s*(\d+)\s*\/\s*(\d+)/) || t.match(/\((\d+)\s*\/\s*(\d+)\)/)
  return m ? +m[1] : -1
})

const before = await readCount()
// ...上传...
for (let i = 0; i < 50; i++) {
  if (await readCount() > before) return { ok: true }
  await sleep(300)
}
```

**没有计数显示时**，用图片数量兜底：

```js
const cnt = () => page.evaluate(() => document.querySelectorAll('div[class*="upload"] img').length)
```

---

# 八、完整骨架（可直接抄）

```js
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let browser = null, p = null

async function connectExisting(matchRe = /https?:\/\//) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | " +
    "Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"], { encoding: 'utf8' })
  const ports = out.split(/\s+/).map(Number).filter(n => n > 1024)

  for (const pt of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(250) })
      const j = await r.json()
      if (!j.Browser || !/Chrome|Chromium|Edge/i.test(j.Browser)) continue
      const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
      const ps = await b.pages()
      const hit = ps.find(x => { try { return matchRe.test(x.url()) } catch { return false } })
      if (hit) { browser = b; p = hit; return true }
      await b.disconnect()
    } catch { }
  }
  return false
}

async function refetch(re = /https?:\/\//, exclude = null) {
  for (let i = 0; i < 25; i++) {
    try {
      const ps = await browser.pages()
      const hits = ps.filter(x => {
        try {
          const u = x.url()
          return !x.isClosed() && re.test(u) && !(exclude && exclude.test(u))
        } catch { return false }
      })
      if (hits.length) { p = hits[hits.length - 1]; await p.bringToFront().catch(() => { }); return p }
    } catch { }
    await sleep(250)
  }
  return p
}

// ── 主流程 ──
if (!await connectExisting(/example\.com/)) {
  console.log('没有找到已打开的浏览器')
  process.exit(0)
}

await refetch(/example\.com/)
await p.waitForSelector('#btn', { timeout: 20000 })
await p.evaluate(() => document.querySelector('#btn').click())

await refetch(/example\.com\/form/)
await p.waitForSelector('input[name="title"]', { timeout: 20000 })
// ... 填表 ...

await browser.disconnect()          // ★ 只断开，浏览器保持打开
console.log('完成，浏览器未关闭')
```

---

# 九、常见坑速查

| 现象 | 原因 | 修法 |
|---|---|---|
| `Failed to launch the browser process! undefined` | profile 被占用 | 不要 kill，改 `connect` |
| `Attempted to use detached Frame` | page 引用失效 | 每步前 `refetch()` |
| `Execution context was destroyed` | 页面导航中 | 同上，加 try/catch |
| `uploadFile` 后页面没反应 | 没派发 change 事件 | 补 `dispatchEvent` |
| 重试同文件无效 | `input.value` 没清 | `el.value = ''` |
| 连到错误的浏览器 | 只看端口不看内容 | 用 `pages()` 的 URL 校验 |
| 端口连不上 | `DevToolsActivePort` 残留 | 先 `/json/version` 验活 |
| 选错标签页 | `pages()` 顺序不定 | URL 正则筛，取最后一个 |
| 误操作到结果页 | URL 前缀相同 | 加 `exclude` 正则 |
| 值写了但提交时为空 | 直接 `el.value=` | 原生 setter + 派发事件 |
| 点击没反应 | 元素在视口外 | `scrollIntoView` 后再 click |
| 下拉框选不中 | 没触发聚焦 | `click()` + `mousedown/mouseup` |

---

# 十、性能基准

| 操作 | 耗时 |
|---|---|
| 扫 40~60 个端口 + connect | 0.3~0.8s |
| `browser.pages()` | 5~15ms |
| `page.evaluate()` 一次 | 10~50ms |
| `waitForSelector` 命中即返回 | 视页面 |

**相比每次重启浏览器：省 15~20 秒/次，且不丢登录态。**

---

# 十一、错误处理与降级

## 连接阶段

| 错误 | 原因 | 降级路径 |
|---|---|---|
| 扫不到任何 CDP 端口 | 浏览器不是用 `--remote-debugging-port` 启动的 | ① 提示用户手动启动带调试端口的 Chrome；② 或改用 `puppeteer.launch` 新开（会丢登录态，需告知）|
| 端口能连但 `pages()` 为空 | 浏览器刚启动，还没建页面 | 轮询 `pages()` 最多 10s，仍空则 `browser.newPage()` |
| 连到了错误的浏览器 | 多个 Chrome 实例，只看端口不验内容 | 必须用 `pages()` 的 URL 正则二次确认；不匹配就 `disconnect()` 换下一个 |
| `DevToolsActivePort` 有值但连不上 | 文件是上次运行残留 | 先用 `/json/version` 验活，不通就跳过 |
| `connect ETIMEDOUT` / `ECONNREFUSED` | 端口过期或已关闭 | 继续扫下一个端口，不要中断整个循环 |

## 操作阶段

| 错误 | 原因 | 降级路径 |
|---|---|---|
| `Attempted to use detached Frame` | page 引用失效 | `refetch()` 重取；失败 3 次则重新 `connectExisting()` |
| `Execution context was destroyed` | 页面正在导航 | 等 `page.waitForNavigation` 或轮询 `document.readyState === "complete"` |
| `Target closed` | 页面/标签被关闭 | `refetch()` 找其他标签；全没了就重新 `connectExisting()` |
| `Element not found` / `null` | 选择器不对或还没渲染 | 先 `waitForSelector`，超时后 dump 页面 DOM 排查 |
| 点击没反应 | 元素被遮挡 / 在视口外 | ① `scrollIntoView`；② 改用 `evaluate(() => el.click())`；③ 仍不行用 CDP `Input.dispatchMouseEvent` 真实点击 |
| 输入无效 | 直接改了 `el.value` | 用原生 setter + 派发事件（见第六章）|
| 上传无反应 | 没派发 change 事件 | 补 `dispatchEvent`（见第七章）|

## 拦截阶段

| 错误 | 原因 | 降级路径 |
|---|---|---|
| `Network.getResponseBody` 报错 | 页面已导航 / 请求太早 | 改在 `loadingFinished` 里调；或改用页面内 Hook（方式三）|
| 拿不到 body（空） | 走了 disk cache | `Network.setCacheDisabled({ cacheDisabled: true })` |
| 响应被截断 | 超过 buffer | `Network.enable({ maxTotalBufferSize: 200_000_000 })` |
| WebSocket 收不到 | 主 session 不包含子 target | `Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: false })` |
| 改请求无效 | `Fetch.enable` 的 pattern 不匹配 | 先 `Fetch.enable({ patterns: [{ urlPattern: "*" }] })` 全量试通再收窄 |

## Pitfalls（踩过的坑）

### P1：kill chrome 是全流程最大杀手

```powershell
# 一旦执行：登录态丢失 + 用户窗口被关 + 下一轮要重新扫码
Get-Process chrome | Stop-Process -Force
```

**后果链**：
```
kill → profile 锁残留 → 下次启动 Failed to launch
     → 用户要重新扫码 → 多花 3~5 分钟
     → 期间可能触发风控 → 更慢
```

**正确做法**：`connect` 已有；确实要重启时，先把 profile 锁文件清掉再起。

### P2：`waitForTarget` 会漏事件

新标签打开很快时，`waitForTarget` 可能错过 `targetcreated` 事件。**永远用轮询 `pages()`**。

### P3：`uploadFile` 只是设了 `input.files`

底层是 CDP `DOM.setFileInputFiles`，**不触发任何 DOM 事件**。React/Vue 的受控组件监听 `change`，不补派发就等于没上传。

### P4：重试同一个文件会被忽略

浏览器对 `input.files` 有去重逻辑（同一个 `File` 对象不会二次触发 change）。**重试前必须 `el.value = ""`**。

### P5：直接 `el.value = x` 对 React 无效

React 用 value tracker 比对，直接赋值会被认为「值没变」。必须用原生 setter：

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
setter.call(el, v)
```

### P6：成功页 URL 也匹配目标正则

如 `/form` 和 `/form/success`。不排除会误操作到成功页，导致「找不到按钮」。**refetch 加 `exclude`**。

### P7：固定 `sleep` 在弱网下必然不够

本机跑 1.5s 够，用户机器可能要 8s。**全部改成 `waitForSelector` / 轮询判据**。

### P8：`browser.disconnect()` vs `browser.close()`

| 方法 | 效果 |
|---|---|
| `disconnect()` | 只断开 CDP 连接，**浏览器继续开着** |
| `close()` | **关掉浏览器**，登录态可能丢 |

**收尾永远用 `disconnect()`。**

## 降级决策树

```
脚本报错了
  │
  ├─ 错误是 detached Frame / context destroyed？
  │    └─ refetch() 重试 → 还不行 → 重新 connectExisting()
  │
  ├─ 元素找不到？
  │    ├─ 先 waitForSelector（可能只是没渲染）
  │    └─ 超时 → dump DOM → 修选择器
  │
  ├─ 上传没反应？
  │    ├─ 检查是否派发了 change
  │    ├─ 检查 file input 是否定位错了（页面常有多个）
  │    └─ 清 value 后重试
  │
  ├─ 接口拿不到？
  │    ├─ getResponseBody 时机不对 → 改用 loadingFinished
  │    └─ 还是不行 → 改用页面内 Hook fetch/XHR
  │
  └─ 完全连不上浏览器？
       ├─ 提示用户启动带调试端口的 Chrome（保留登录态）
       └─ 或 puppeteer.launch 新开（会丢登录态，必须先告知用户）
```

## 失败时的最小可诊断输出

出错时打印这些，便于快速定位：

```js
async function dumpState(browser, p) {
  const out = {
    pages: [],
    current: null,
    readyState: null,
    bodyLen: 0,
    hasTarget: {},
  }
  try {
    const ps = await browser.pages()
    out.pages = ps.map(x => { try { return x.url().slice(0, 100) } catch { return "(closed)" } })
  } catch { }
  try {
    out.current = p.url().slice(0, 100)
    out.readyState = await p.evaluate(() => document.readyState)
    out.bodyLen = await p.evaluate(() => document.body?.innerText?.length || 0)
  } catch (e) { out.current = "ERR: " + String(e.message).slice(0, 80) }
  console.log(JSON.stringify(out, null, 2))
}
```

## 检查清单（错误处理）

- [ ] 所有 `connect` 都验证了 `pages()` 内容，不是只看端口
- [ ] 所有可能失效的操作都包了 try/catch
- [ ] `refetch()` 失败有二次降级（重新 connect）
- [ ] 上传重试前清 `el.value`
- [ ] 收尾用 `disconnect()` 不用 `close()`
- [ ] 出错时能 dump 出 pages 列表 + readyState + bodyLen


---

# 十二、拦截请求（分析网络）

CDP 的 Network 域能看页面所有请求和响应。比抓 DOM 可靠——DOM 只显示渲染结果，网络能看到真实数据和参数。

## 为什么用它

| 场景 | DOM 抓取 | 网络拦截 |
|---|---|---|
| 拿列表数据 | 解析表格，字段不全 | **直接拿 JSON** |
| 拿接口参数 | 拿不到 | **有完整 body** |
| 分析签名规则 | 看不到 | **有完整 headers** |
| 找隐藏字段 | 要找 DOM | **响应里都有** |
| 判断提交成功 | 看提示文字 | **看接口返回码** |

## 基础：监听所有请求

```js
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')

const records = []
const byId = new Map()

cdp.on('Network.requestWillBeSent', (e) => {
  const rec = {
    id: e.requestId,
    method: e.request.method,
    url: e.request.url,
    headers: { ...e.request.headers },
    postData: e.request.postData,
    type: e.type,
  }
  byId.set(e.requestId, rec)
  records.push(rec)
})

cdp.on('Network.responseReceived', (e) => {
  const rec = byId.get(e.requestId)
  if (!rec) return
  rec.status = e.response.status
  rec.mimeType = e.response.mimeType
})

cdp.on('Network.loadingFinished', async (e) => {
  const rec = byId.get(e.requestId)
  if (!rec) return
  try {
    const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
    rec.respText = text
    try { rec.respJson = JSON.parse(text) } catch { }
  } catch { }
})
```

> getResponseBody 要在 loadingFinished 里调，且得在页面导航前——导航后 body 会失效。

## 过滤：只看关心的请求

```js
const WANT = /\/api\/|\/graphql/i

cdp.on('Network.responseReceived', (e) => {
  if (!WANT.test(e.response.url)) return
  console.log(e.response.status, e.response.url.slice(0, 120))
})

// 按类型过滤：只要接口，不要图片/字体
cdp.on('Network.requestWillBeSent', (e) => {
  if (e.type !== 'XHR' && e.type !== 'Fetch') return
})
```

## 抓响应体：三种方式

### 方式一：事件里拿（边操作边抓）

```js
const bodies = []

cdp.on('Network.loadingFinished', async (e) => {
  const req = byId.get(e.requestId)
  if (!req || !WANT.test(req.url)) return
  try {
    const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
    const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
    let json = null
    try { json = JSON.parse(text) } catch { }
    bodies.push({ url: req.url, json, text: json ? null : text.slice(0, 2000) })
  } catch { }
})
```

### 方式二：主动等某个请求（点一下等结果）

```js
function waitForResponse(cdp, urlRe, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const pending = new Map()
    const timer = setTimeout(() => {
      cdp.off('Network.responseReceived', onResp)
      cdp.off('Network.loadingFinished', onDone)
      reject(new Error('超时'))
    }, timeoutMs)

    function onResp(e) {
      if (!urlRe.test(e.response.url)) return
      pending.set(e.requestId, e.response)
    }
    cdp.on('Network.responseReceived', onResp)

    async function onDone(e) {
      const resp = pending.get(e.requestId)
      if (!resp) return
      clearTimeout(timer)
      cdp.off('Network.responseReceived', onResp)
      cdp.off('Network.loadingFinished', onDone)
      try {
        const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
        const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
        let json = null
        try { json = JSON.parse(text) } catch { }
        resolve({ response: resp, text, json })
      } catch (err) { reject(err) }
    }
    cdp.on('Network.loadingFinished', onDone)
  })
}

// 用法：先挂监听，再触发动作
const p1 = waitForResponse(cdp, /\/api\/list/)
await page.evaluate(() => document.querySelector('#search').click())
const r = await p1
console.log(r.json)
```

### 方式三：页面内 Hook fetch / XHR

在页面加载**之前**注入，Hook 住 fetch 和 XMLHttpRequest：

```js
await page.evaluateOnNewDocument(() => {
  window.__netLog = []

  const origFetch = window.fetch
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args)
    try {
      const clone = res.clone()
      const text = await clone.text()
      window.__netLog.push({
        type: 'fetch',
        url: String(args[0]),
        status: res.status,
        body: text.slice(0, 100000),
      })
    } catch { }
    return res
  }

  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = url
    this.__method = method
    return origOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        window.__netLog.push({
          type: 'xhr',
          url: this.__url,
          method: this.__method,
          status: this.status,
          body: String(this.responseText || '').slice(0, 100000),
        })
      } catch { }
    })
    return origSend.apply(this, args)
  }
})

// 操作之后读
const logs = await page.evaluate(() => window.__netLog)
```

**优点**：不用管 CDP session 生命周期，导航后重新注入即可。
**缺点**：只能看到页面自己发的请求，看不到浏览器预加载的资源。

## 抓请求参数（不只是响应）

真正有用的信息常在**请求体**里：

```js
cdp.on('Network.requestWillBeSent', (e) => {
  if (!WANT.test(e.request.url)) return
  const rec = {
    method: e.request.method,
    url: e.request.url,
    headers: e.request.headers,     // 签名、token 都在这里
    postData: e.request.postData,   // 表单 / JSON body
  }
  if (e.request.postData) {
    try { rec.body = JSON.parse(e.request.postData) } catch { }
  }
  console.log(JSON.stringify(rec, null, 1).slice(0, 1500))
})
```

**重点看这些 header**（不同站点名字不同）：

| 名字 | 作用 |
|---|---|
| Authorization / token | 身份凭证 |
| X-Sign / sign / signature | 请求签名 |
| X-Timestamp / timestamp | 防重放 |
| Referer | 来源校验 |
| Cookie | 会话 |
| 自定义 X-* | 风控指纹 |

## 复现请求：抓到的直接用 Node 重发

抓到完整请求后脱离浏览器调用，快 10~100 倍：

```js
// 1. 抓
const samples = []
cdp.on('Network.requestWillBeSent', (e) => {
  if (/\/api\/target/.test(e.request.url)) {
    samples.push({
      url: e.request.url,
      method: e.request.method,
      headers: e.request.headers,
      body: e.request.postData,
    })
  }
})

// 2. 触发
await page.evaluate(() => document.querySelector('#btn').click())
await sleep(3000)

// 3. 用 Node 重发
const s = samples[0]
const res = await fetch(s.url, {
  method: s.method,
  headers: {
    ...s.headers,
    cookie: s.headers.cookie || cookieFromStore,   // 浏览器自动加的 Node 要手补
    ,'user-agent': s.headers['user-agent'] || UA
  },
  body: s.body,
})
console.log(await res.json())
```

> 签名类 header 有时效（时间戳/随机数），过期失效。要么每次重新生成，要么继续走浏览器。

## 监听 WebSocket

```js
cdp.on('Network.webSocketCreated', (e) => console.log('WS 建立:', e.url))
cdp.on('Network.webSocketFrameSent', (e) => console.log('→', e.response.payloadData?.slice(0, 500)))
cdp.on('Network.webSocketFrameReceived', (e) => console.log('←', e.response.payloadData?.slice(0, 500)))
```

## 完整工具：网络录制器

```js
/**
 * 创建网络录制器
 * @param {Page} page
 * @param {RegExp} filter 只录匹配的 URL
 */
export async function createRecorder(page, filter = /./) {
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable', { maxTotalBufferSize: 200_000_000 })
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const records = []
  const byId = new Map()

  cdp.on('Network.requestWillBeSent', (e) => {
    if (!filter.test(e.request.url)) return
    const rec = {
      id: e.requestId,
      method: e.request.method,
      url: e.request.url,
      headers: { ...e.request.headers },
      postData: e.request.postData,
      type: e.type,
      ts: e.timestamp,
    }
    if (rec.postData) { try { rec.bodyJson = JSON.parse(rec.postData) } catch { } }
    byId.set(e.requestId, rec)
    records.push(rec)
  })

  cdp.on('Network.responseReceived', (e) => {
    const rec = byId.get(e.requestId)
    if (!rec) return
    rec.status = e.response.status
    rec.mimeType = e.response.mimeType
    rec.respHeaders = { ...e.response.headers }
  })

  cdp.on('Network.loadingFinished', async (e) => {
    const rec = byId.get(e.requestId)
    if (!rec) return
    try {
      const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
      rec.respText = text
      try { rec.respJson = JSON.parse(text) } catch { }
    } catch { }
  })

  cdp.on('Network.loadingFailed', (e) => {
    const rec = byId.get(e.requestId)
    if (rec) { rec.failed = true; rec.errorText = e.errorText }
  })

  return {
    all: () => records,
    find: (re) => records.filter(r => re.test(r.url)),
    json: () => records.filter(r => r.respJson),
    clear: () => { records.length = 0; byId.clear() },
    dump: (file) => {
      const fs2 = require('node:fs')
      fs2.writeFileSync(file, JSON.stringify(records, null, 2), 'utf8')
    },
    close: () => cdp.detach().catch(() => { }),
  }
}

// 用法
const rec = await createRecorder(page, /\/api\//)
await page.evaluate(() => document.querySelector('#loadMore').click())
await sleep(2000)
console.log(rec.find(/\/api\/list/)[0]?.respJson)
rec.dump('artifacts/network-log.json')
rec.close()
```

## 用拦截反推接口（逆向流程）

```
1. 录制器开着
2. 在页面上点一次目标操作
3. 看新出现了哪些请求
4. 找出「参数最多、响应最大」的那个 → 通常是主接口
5. 复制它的 url / headers / body
6. 用 Node 重发验证
7. 成功 → 以后直接调接口，不用开浏览器
```

## 进阶：真正拦截并修改请求

Network 只能看。要**改**请求/响应用 Fetch 域：

```js
await cdp.send('Fetch.enable', {
  patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }],
})

cdp.on('Fetch.requestPaused', async (e) => {
  const { requestId, request } = e

  const headers = { ...request.headers, 'X-Custom': 'injected' }

  let postData = request.postData
  if (postData) {
    try {
      const j = JSON.parse(postData)
      j.pageSize = 100
      postData = JSON.stringify(j)
    } catch { }
  }

  await cdp.send('Fetch.continueRequest', {
    requestId,
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    postData: postData ? Buffer.from(postData).toString('base64') : undefined,
  })
})
```

**也可以直接返回伪造响应**（不发真请求）：

```js
await cdp.send('Fetch.fulfillRequest', {
  requestId: e.requestId,
  responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
  body: Buffer.from(JSON.stringify({ mock: true })).toString('base64'),
})
```

## 需要注意

| 点 | 说明 |
|---|---|
| getResponseBody 时效 | 页面导航后失效，要在导航前拿到 |
| 大响应 | 设 maxTotalBufferSize，否则可能被截断 |
| 二进制响应 | base64Encoded:true 要手动解码 |
| 缓存请求 | 加 Network.setCacheDisabled 才拿得到 body |
| 签名 header | 有时效，不能直接复用 |
| 跨 iframe | 主 session 收不到子 frame |

## 检查清单

- [ ] Network.enable 在操作**之前**调用
- [ ] 用正则过滤，不要全量监听
- [ ] getResponseBody 在 loadingFinished 里调
- [ ] 大响应设了 maxTotalBufferSize
- [ ] 抓请求时同时记 headers 和 postData
- [ ] 复现时补浏览器自动加的 header
- [ ] 做完 cdp.detach() 释放


---

# 十三、检查清单

写脚本前过一遍：

- [ ] 没有 `Stop-Process`、`taskkill`、`browser.close()`
- [ ] 用 `connect` 而不是 `launch`
- [ ] 每个关键步骤前调 `refetch()`
- [ ] 目标页 URL 用了 `exclude` 排除结果页
- [ ] 所有 `sleep(固定值)` 换成 `waitForSelector` / 轮询
- [ ] 输入用原生 setter + 派发 `input`/`change`/`blur`
- [ ] `uploadFile` 后补派发 `input`/`change`
- [ ] 上传重试前清 `el.value`
- [ ] 结束时是 `browser.disconnect()` 而不是 `close()`
