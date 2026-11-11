# CDP 操控浏览器 —— 不关浏览器 + 快速响应

> 2026-11-11 定稿。这套方法在拼多多上架里跑通了 13 个商品。

---

## 一、核心思路

**错误做法**（我踩过的坑）：

```powershell
Get-Process chrome | Stop-Process -Force   # ❌ 杀掉用户窗口 + 登录态丢失
node xxx.mjs                                # 重新启动，又要重新登录
```

**正确做法**：

```
浏览器一直开着 → 脚本 connect 上去 → 用完 disconnect（不断开浏览器）
```

关键区别：

| | kill + 重启 | connect 已有 |
|---|---|---|
| 登录态 | 丢失，要重扫 | 保留 |
| 用户窗口 | 被关掉 | 不受影响 |
| 启动耗时 | 15~20s | **0.3s** |
| 用户能否同时操作 | 不能 | **能** |

---

## 二、找 CDP 端口

Chrome 除了 `--remote-debugging-port` 指定端口，也可能随机分配。**不要写死端口，扫一遍**：

```js
import { execFileSync } from 'node:child_process'

const out = execFileSync('powershell.exe', [
  '-NoProfile', '-Command',
  "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"
], { encoding: 'utf8' })

const ports = out.split(/\s+/).map(Number).filter(Boolean)   // 通常 40~60 个
```

然后逐个试探：

```js
let browser = null
for (const pt of ports) {
  try {
    const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(250) })
    const j = await r.json()
    if (!j.Browser || !/Chrome/i.test(j.Browser)) continue   // 不是 Chrome，跳过

    const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
    const ps = await b.pages()

    // ★ 关键：确认里面有目标站点的页面
    if (ps.some(x => /mms\.pinduoduo\.com/.test(x.url()) && !/login/.test(x.url()))) {
      browser = b
      break
    }
    await b.disconnect()   // 不是目标浏览器，断开继续找
  } catch { }
}
```

**耗时**：扫描 + 连接 ≈ **0.3~0.8s**（40 个端口）。

---

## 三、拿页面：必须每步重取

### 为什么

发布页会自己导航、重建 iframe：

```
Attempted to use detached Frame '4A6284EB...'
Execution context was destroyed, most likely because of a navigation.
```

`page` 引用一旦失效，后面所有 `page.evaluate()` 全崩。

### 正确写法

```js
let p = null

async function refetch(re = /mms\.pinduoduo\.com/) {
  for (let i = 0; i < 25; i++) {                    // 最多等 25×250ms = 6.25s
    try {
      const ps = await browser.pages()             // ★ 每次都重新取列表
      const hits = ps.filter(x => {
        try {
          const u = x.url()
          return !x.isClosed()                       // 排除已关闭
            && re.test(u)                            // 匹配目标 URL
            && !/goods_add\/success/.test(u)         // ★ 排除成功页（否则会误操作）
        } catch { return false }
      })
      if (hits.length) {
        p = hits[hits.length - 1]                    // 取最后一个（最新的标签）
        await p.bringToFront().catch(() => { })
        return p
      }
    } catch { }
    await sleep(250)
  }
  return p
}
```

### 调用位置

```js
await refetch(/goods\/category/)   // 主图前
// ... 上传主图
await refetch(/goods\/category/)   // 主图后（页面可能重渲染）
await refetch(/goods\/category/)   // 标题前
await refetch(/goods\/category/)   // 类目前
```

**实测加了 refetch 之后，`detached Frame` 从必现变成 0 次。**

---

## 四、点「发布新商品」打开新标签

点按钮后**不要等 `waitForTarget`**（容易漏事件），改成轮询 `browser.pages()`：

```js
// ❌ 偶尔漏
const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 20000 })
await p.evaluate(() => { document.querySelector('button[data-tracking-viewid="new_product_releasing"]').click() })
const tg = await tp

// ✅ 稳定
await p.evaluate(() => {
  const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]')
  if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
})

let pg = null
for (let i = 0; i < 60; i++) {
  const ps = await browser.pages()
  pg = ps.find(x => /goods\/category/.test(x.url()))
  if (pg) break
  await sleep(250)
}
if (pg) { await pg.bringToFront(); p = pg }
```

**耗时**：通常 1.5~2.5s。

---

## 五、快速响应：不用固定 sleep

### 核心原则

**「等元素出现」而不是「等固定时间」**

```js
// ❌ 慢且不稳
await sleep(3000)
await page.click(...)

// ✅ 快且稳
await page.waitForSelector('input[placeholder*="商品标题组成"]', { timeout: 25000 })
await page.evaluate(...)
```

### 实测对比

| 操作 | 固定 sleep | 等元素 |
|---|---|---|
| 打开发布页 | 26s | **1.9s** |
| 上传主图 5 张 | 18s | **0.3s** |
| 规格填充 | 8.1s | **2~6.5s** |
| **单类目总计** | **180s+** | **30~75s** |

### 轮询等待值回填

填完值不能只看「点成功了」，要看「值真的在里面」：

```js
// 填完之后轮询读回
for (let i = 0; i < 50; i++) {                    // 最多 50×300ms = 15s
  const now = await page.evaluate(() => {
    const t = document.body.innerText || ''
    const m = t.match(/已上传\s*(\d+)\s*\/\s*(\d+)/)
    return m ? +m[1] : -1
  })
  if (now > before) return { ok: true }           // 计数变了 → 成功
  await sleep(300)
}
```

### 等 SKU 行数出现

```js
// ❌ sleep(2500)
// ✅
for (let i = 0; i < 40; i++) {                   // 最多 40×200ms = 8s
  const n = await page.evaluate(() => document.querySelectorAll('#sku tbody tr').length)
  if (n >= expected) break
  await sleep(200)
}
```

---

## 六、文件上传要用 CDP

### uploadFile 后必须补派发事件

```js
const fi = await page.$('section[class*="goodsCarousel"] input[type="file"]')
await fi.uploadFile(...paths)

// ★ 不做这步，React 收不到，页面显示「已上传 0 张」
await fi.evaluate(el => {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
```

**原理**：`uploadFile` 底层走 CDP `DOM.setFileInputFiles`，只设置 `input.files`，
不触发事件。React 的受控组件监听的是 `change`，所以必须手动派发。

### 重试前必须清空

```js
await fi.evaluate(el => { el.value = '' })   // 同一个文件第二次会被浏览器忽略
await fi.uploadFile(...paths)
```

---

## 七、完整骨架（可直接抄）

```js
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let browser = null
let p = null

// ① 找浏览器
async function connectExisting(matchRe = /mms\.pinduoduo\.com/) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -gt 1024} | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"
  ], { encoding: 'utf8' })
  const ports = out.split(/\s+/).map(Number).filter(Boolean)

  for (const pt of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${pt}/json/version`, { signal: AbortSignal.timeout(250) })
      const j = await r.json()
      if (!j.Browser || !/Chrome/i.test(j.Browser)) continue
      const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}`, defaultViewport: null })
      const ps = await b.pages()
      if (ps.some(x => matchRe.test(x.url()) && !/login/.test(x.url()))) {
        browser = b
        p = ps.find(x => matchRe.test(x.url()))
        return true
      }
      await b.disconnect()
    } catch { }
  }
  return false
}

// ② 每次操作前重取页面
async function refetch(re = matchRe) {
  for (let i = 0; i < 25; i++) {
    try {
      const ps = await browser.pages()
      const hits = ps.filter(x => {
        try { return !x.isClosed() && re.test(x.url()) && !/success/.test(x.url()) } catch { return false }
      })
      if (hits.length) { p = hits[hits.length - 1]; await p.bringToFront().catch(() => { }); return p }
    } catch { }
    await sleep(250)
  }
  return p
}

// ③ 用完只断开，不关浏览器
await browser.disconnect()
```

---

## 八、常见坑

| 现象 | 原因 | 修法 |
|---|---|---|
| `Failed to launch the browser process! undefined` | profile 被占用 | 不要 kill，改 connect |
| `Attempted to use detached Frame` | page 引用失效 | 每步前 `refetch()` |
| `Execution context was destroyed` | 页面导航中 | 同上 + try/catch |
| `uploadFile` 后计数 0 | 没派发 change | 补 `dispatchEvent` |
| 重试同文件无效 | input.value 没清 | `el.value = ''` |
| 选错标签页 | `pages()` 顺序不对 | 用 URL 正则筛，取最后一个 |
| 误操作成功页 | 成功页 URL 也含 `goods_add` | 排除 `/success/` |

---

## 九、性能数据

| 操作 | 耗时 |
|---|---|
| 扫端口 + connect | 0.3~0.8s |
| `browser.pages()` | 5~15ms |
| `page.evaluate()` 一次 | 10~50ms |
| `waitForSelector` 命中即返回 | 视页面而定 |

**单类目上架全流程 30~75s**（含浏览器启动）。
**如果浏览器已开着直接 connect，可省 15~20s。**
