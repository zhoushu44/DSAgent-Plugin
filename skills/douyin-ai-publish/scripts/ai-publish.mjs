#!/usr/bin/env node
/**
 * 抖音小店 · AI 智能发布（douyin-ai-publish）
 *
 * 设计思想：**能用 AI/HTTP 的绝不用 DOM 点**。实测抖店 AI 发品能吃图 + Excel，
 * 自动填标题/类目/SKU 表格，DOM 只留两个必须的点击（选类目候选、确认信息）。
 *
 * 与 douyin-publish-full 的区别：
 *   - publish-full：通用链路，DOM 逐个试类目
 *   - ai-publish（本技能）：**优先走新版 AI 发品入口**，让平台 AI 识别图+Excel，
 *     自动填 SKU/属性，人工只做最后确认
 *
 * 三种模式：
 *   material  上传图+Excel → 跑 AI 识别 → 产出物料包（推荐标题/主图/材料分类）
 *   props     进第二级 → 读取类目必填属性清单（材质/容量/数量…）
 *   submit    完整链路 + AI 填表 → （--confirm true 时）点「发布商品」
 *
 * 用法：
 *   node ai-publish.mjs --mode material --images a.jpg --excel sku.xlsx
 *   node ai-publish.mjs --mode props --images a.jpg --category 隐茶杯
 *   node ai-publish.mjs --mode submit --images a.jpg --excel sku.xlsx --confirm true
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href

// 抖店风控绕过（hook XHR/fetch 让风控检测请求不发出去，不过滑块）
const { injectRiskBypass } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-risk-bypass.mjs')))
// 属性智能填（dump 候选表 + 按 hint 匹配选中）
const { smartFillAttrs, dumpAttrCandidates, readAttrState } =
  await import(PURL(join(HERE, 'attr-fill.mjs')))
// SKU 表填充（规格值 + 价格库存）
const { fillSkuTable, readSkuState } = await import(PURL(join(HERE, 'sku-fill.mjs')))

// ── 参数解析 ──────────────────────────────────────────────
// ★ JSON 值含空格（如 {"颜色分类":["红茶","白茶"]}），简单 split 会截断。
//   所以遇到以 { [ " 开头的值，要吃到配对结束符（或到下一个 -- 开头）。
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { out[key] = 'true'; continue }
    // JSON 值：吃到括号配对
    const first = next[0]
    if (first === '{' || first === '[') {
      const close = first === '{' ? '}' : ']'
      let depth = 0, buf = ''
      let j = i + 1
      for (; j < argv.length; j++) {
        const part = argv[j]
        for (const ch of part) {
          if (ch === first) depth++
          else if (ch === close) depth--
        }
        buf += (buf ? ' ' : '') + part
        if (depth <= 0) break
      }
      out[key] = buf
      i = j
      continue
    }
    // 引号值
    if (first === '"' || first === "'") {
      let buf = next.slice(1)
      let j = i + 1
      while (!buf.endsWith(first) && j + 1 < argv.length) { j++; buf += ' ' + argv[j] }
      out[key] = buf.slice(0, -1)
      i = j
      continue
    }
    out[key] = next
    i++
  }
  return out
}
const ARGS = parseArgs(process.argv)
const truthy = (v) => String(v ?? '').trim().toLowerCase() === 'true'

const MODE = (ARGS.mode || 'material').trim()
const CONFIRM = truthy(ARGS.confirm)
const ACCOUNT = (ARGS.account || '').trim()
const IMAGES = (ARGS.images || '').split(',').map((s) => s.trim()).filter(Boolean)
const EXCEL = (ARGS.excel || '').trim()
const TITLE_OVERRIDE = (ARGS.title || '').trim()
const CATEGORY = (ARGS.category || '').trim()
// SKU 规格：JSON，形如 {"specs":{"颜色分类":["红茶","白茶"]},"price":"12","stock":"500","itemNo":"SKU001"}
//   或 {"rows":[{"颜色分类":"红茶","价格":"12","库存":"500"}, ...]}
const SKU_SPEC = (() => {
  const raw = (ARGS.skus || '').trim()
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
})()
const OUT_DIR = (ARGS.out || '').trim() || join(process.cwd(), 'artifacts', 'douyin-ai-publish')

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-ai-publish] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 账号 ──────────────────────────────────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
}
let account
if (ACCOUNT) {
  account = accounts.find((a) => a.shop_key === ACCOUNT)
  if (!account) fail('api_error', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map((a) => a.shop_key).join(' / ')}`)
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `抖音小店有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map((a) => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

// ── 本地校验（不起浏览器）────────────────────────────────
function checkFile(p, maxMB, label) {
  if (!p) return
  if (!existsSync(p)) { releaseProfile(dir); fail('api_error', `${label}不存在：${p}`) }
  const mb = statSync(p).size / 1024 / 1024
  if (mb > maxMB) { releaseProfile(dir); fail('api_error', `${label}超过 ${maxMB}MB：${p}（${mb.toFixed(2)}MB）`) }
}
function imageRatio(p) {
  try {
    const fd = readFileSync(p)
    if (fd.length > 24 && fd.toString('latin1', 1, 4) === 'PNG') {
      const w = fd.readUInt32BE(16), h = fd.readUInt32BE(20)
      return w && h ? { w, h, ratio: w / h } : null
    }
    if (fd.length > 4 && fd[0] === 0xFF && fd[1] === 0xD8) {
      let off = 2
      while (off < fd.length) {
        if (fd[off] !== 0xFF) { off++; continue }
        const marker = fd[off + 1], len = fd.readUInt16BE(off + 2)
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          const h = fd.readUInt16BE(off + 5), w = fd.readUInt16BE(off + 7)
          return w && h ? { w, h, ratio: w / h } : null
        }
        off += 2 + len
      }
    }
  } catch { /* ignore */ }
  return null
}

if (!['material', 'props', 'submit'].includes(MODE)) {
  releaseProfile(dir)
  fail('api_error', `未知 mode：${MODE}。可用：material / props / submit`)
}
if (!IMAGES.length) {
  releaseProfile(dir)
  fail('api_error', '必须传 --images（本地图片路径，英文逗号分隔）。AI 发品至少需要一张商品图')
}
for (const p of IMAGES) {
  checkFile(p, 5, '图片')
  const r = imageRatio(p)
  // ★ 主图必须 1:1 且 ≥600×600，否则页面出「长宽比需为1:1」静默卡死 AI 流程
  if (r && (Math.abs(r.ratio - 1) > 0.02 || r.w < 600)) {
    releaseProfile(dir)
    fail('api_error',
      `图片须为 1:1 且 ≥600×600（平台会用「长宽比需为1:1」拦住 AI 流程）：\n  ${p}（${r.w}×${r.h}）\n请先裁成正方形高清图。`,
      { badImage: { path: p, ...r } })
  }
}
if (EXCEL) checkFile(EXCEL, 1, 'Excel')

const dir = profileDir('douyin_shop', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-ai-publish')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)
mkdirSync(OUT_DIR, { recursive: true })

let browser = null
try {
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  // ★ launch 重试 3 次（Chrome 间歇性启动失败/崩溃，实测时好时坏）
  let browser = null
  for (let attempt = 1; attempt <= 3 && !browser; attempt++) {
    try {
      browser = await puppeteer.default.launch({
        headless: false, executablePath: chromePath, userDataDir: dir,
        defaultViewport: { width: 1600, height: 1000 },
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1600,1000'],
      })
      log(`① Chrome 启动成功${attempt > 1 ? `（第 ${attempt} 次）` : ''}`)
    } catch (e) {
      log(`① Chrome 启动失败（第 ${attempt} 次）：${String(e?.message).slice(0, 80)}`)
      if (attempt < 3) await sleep(8000)
    }
  }
  if (!browser) fail('api_error', 'Chrome 3 次启动失败。请关闭所有 Chrome 窗口后重试。')

  const page = (await browser.pages())[0] || await browser.newPage()
  // ★ risk bypass 单独 try：它只是增强（拦风控检测请求），失败不该阻断发布
  try {
    await injectRiskBypass(page)
    log('① 风控绕过已注入')
  } catch (e) {
    log(`① 风控绕过注入失败（继续）：${String(e?.message).slice(0, 60)}`)
  }
  await page.setCookie(...Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => [
      { name: n, value: String(v), domain: '.jinritemai.com', path: '/' },
      { name: n, value: String(v), domain: '.douyin.com', path: '/' },
    ]))

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // hook AI 链路接口
  const byApi = {}
  const notifyBodies = []
  cdp.on('Network.requestWillBeSent', (e) => {
    try {
      const u = e.request.url
      if (!/jinritemai\.com/.test(u)) return
      if (e.request.postData) notifyBodies.push(e.request.postData.slice(0, 4000))
    } catch { /* ignore */ }
  })
  cdp.on('Network.responseReceived', async (e) => {
    try {
      const u = e.response.url
      if (!/jinritemai\.com/.test(u)) return
      if (!/json|text|plain/.test(e.response.mimeType || '')) return
      if (e.response.status !== 200) return
      const key = /searchCategoryN/.test(u) ? 'cateSearch'
        : /getPredictTask/.test(u) ? 'getPredict'
        : /batchupload/.test(u) ? 'batchUpload'
        : /notify_material_change/.test(u) ? 'notify'
        : null
      if (!key) return
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      let j = null
      try { j = JSON.parse(b.body || '') } catch { /* ignore */ }
      if (!j) return
      if (j.st === 0 || j.code === 0 || j.status_code === 0) {
        byApi[key] = j.data ?? j
        if (key === 'getPredict' && (j.data ?? j)?.task_status === 'success') byApi.predictResult = j.data ?? j
      }
    } catch { /* ignore */ }
  })

  // 页面内 fetch（secsdk 自动加签名）—— 用 CDP evaluate 包裹
  const apiFetch = (path, body) => safeEval(async (path, body) => {
    try {
      const opt = { credentials: 'include', headers: { 'Content-Type': 'application/json' } }
      if (body) { opt.method = 'POST'; opt.body = JSON.stringify(body) }
      const r = await fetch(path, opt)
      const t = await r.text()
      let j = null
      try { j = JSON.parse(t) } catch { /* ignore */ }
      return { status: r.status, json: j, raw: j ? null : t.slice(0, 200) }
    } catch (e) { return { err: String(e).slice(0, 150) } }
  }, path, body)

  // 容错 evaluate（开面板/切版本会重绘页面 → frame detached）
  //   ★ 用 CDP Runtime.evaluate 直调，绕开 puppeteer 的 frame 管理
  //     （page.evaluate 在抖店 SPA 重绘后频繁 detached，实测 CDP 稳得多）
  //   ★ detached 时优先新建 page（同一 frame 反复 detached 说明该 page 对象已废）
  let curPage = page
  const refreshPage = async () => {
    try {
      const p = await browser.newPage()
      if (p) { curPage = p; return true }
    } catch { /* ignore */ }
    try {
      const pages = await browser.pages()
      const fresh = pages.find(x => x !== curPage && !x.isClosed()) || pages[0]
      if (fresh && fresh !== curPage) { curPage = fresh; return true }
    } catch { /* ignore */ }
    return false
  }
  let evalCdp = await curPage.target().createCDPSession()
  /** 重建 CDP session（Session closed 后必须重建，旧的重试也没用） */
  const rebuildCdp = async () => {
    try { await evalCdp.detach().catch(() => {}) } catch { /* ignore */ }
    for (let i = 0; i < 3; i++) {
      try {
        evalCdp = await curPage.target().createCDPSession()
        await evalCdp.send('Runtime.enable')
        return true
      } catch { await sleep(2000) }
    }
    return false
  }
  const safeEval = async (fn, ...args) => {
    const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`
    let lastErr = null
    for (let i = 0; i < 5; i++) {
      try {
        await evalCdp.send('Runtime.enable')
        const r = await evalCdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        if (r.exceptionDetails) {
          const msg = r.exceptionDetails.text || r.exceptionDetails.exception?.description || ''
          if (/detached|Cannot find|Target closed|Execution context/i.test(msg)) {
            await refreshPage(); await rebuildCdp()
            await sleep(3000); continue
          }
          log(`⚠️ evaluate 异常：${msg.slice(0, 100)}`)
          return null
        }
        return r.result?.value ?? null
      } catch (e) {
        lastErr = e
        const m = String(e?.message || '')
        if (/detached|Execution context|Cannot find context|Target closed|Protocol error|Session closed/i.test(m)) {
          await refreshPage()
          await rebuildCdp()
          await sleep(3000); continue
        }
        throw e
      }
    }
    log(`⚠️ safeEval 5 次失败：${String(lastErr?.message).slice(0, 100)}`)
    return null
  }
  const gotoUrl = async (url, opts) => {
    let lastErr = null
    for (let i = 0; i < 3; i++) {
      try {
        await curPage.goto(url, opts)
        await rebuildCdp()
        return true
      } catch (e) {
        lastErr = e
        if (/detached|Target closed|Protocol error/i.test(String(e?.message))) {
          await refreshPage()
          await rebuildCdp()
          await sleep(5000); continue
        }
        throw e
      }
    }
    log(`⚠️ goto 3 次失败：${String(lastErr?.message).slice(0, 80)}`)
    return false
  }
  const curUrl = () => curPage.url()

  // ═══ ① 打开发布页（新版 AI 发品入口）════════════════════
  //    ★ 就绪判据用「有下一步按钮或有 file input」，
  //      不能只数 button 数（SPA 外壳也有按钮，实测 btns=3 时就已能操作）
  log('① 打开发布页（AI 发品入口）')
  let pageReady = false
  for (let attempt = 1; attempt <= 3 && !pageReady; attempt++) {
    const ok = await gotoUrl('https://fxg.jinritemai.com/ffa/g/create', { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!ok) { await sleep(5000); continue }
    if (/\/login|passport/i.test(curUrl())) {
      fail('token_expired', '抖店后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。')
    }
    for (let i = 0; i < 12; i++) {
      await sleep(2000)
      const probe = await safeEval(() => ({
        hasNext: !![...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('下一步')),
        hasUpload: !!document.querySelector('input[type=file]'),
      }))
      if (probe && (probe.hasNext || probe.hasUpload)) { pageReady = true; log(`① 页面就绪（第 ${attempt} 次尝试）`); break }
    }
    if (!pageReady) { log(`① 页面未就绪（第 ${attempt} 次），重试`); await sleep(5000) }
  }
  if (!pageReady) {
    fail('api_error', '打开发布页后页面未就绪（连续 3 次）。建议：关闭所有 Chrome 窗口后重试，'
      + '或到「账号连接」重新登录抖店。')
  }

  // ═══ ② 上传（顺序：先 Excel 后图）═══════════════════════════
  //    ★ 实测：Excel 必须走 DOM file input（AI 素材登记要页面响应 file 变更），
  //      且会触发页面重渲染 → 必须先传 Excel 并等页面稳定，再传图。
  //      反过来（先图后 Excel）会在 Excel 上传后 detached（实测踩坑）。
  log(`② 上传 ${IMAGES.length} 张图${EXCEL ? ' + 1 个 Excel' : ''}`)
  let uploadedUrls = []
  let publishId = null
  const grabPublishId = () => {
    for (const b of notifyBodies) {
      const m = b.match(/publish_id["']?\s*:\s*["']?(\d{15,})/)
      if (m) return m[1]
    }
    return null
  }

  // ②a Excel 先走 DOM（页面需要响应 file input 变更来登记素材）
  //    ★ 实测：Excel HTTP 上传能拿到 CDN URL，但**素材登记**（notify 里 material_type=2）
  //      只有 DOM file input 才触发，且登记的 URL 是页面生成的 xiaodian_xxx.xlsx
  //      （不是 CDN URL）——所以 Excel 必须走 DOM。
  //      DOM 上传 Excel 会触发整页 reload → 必须重新 goto 重建会话，否则后续连环 detached
  if (EXCEL) {
    log('②a Excel 走 DOM file input（素材登记唯一路径）')
    try {
      const fi0 = await curPage.$('input[type=file]')
      if (fi0) { await fi0.uploadFile(EXCEL); log('②a Excel 已上传，等页面响应…'); await sleep(15000) }
    } catch (e) { log('②a Excel 上传失败: ' + String(e?.message).slice(0, 80)) }
    publishId = grabPublishId()
    log(`②a publish_id：${publishId || '（未拿到）'}`)

    // ★ Excel 的 DOM 上传触发整页 reload → 用 page.reload() 重建（不用 goto/newPage）
    //   实测：Excel 上传后 browser.newPage() / browser.pages() 都拿不到可用 page
    //   （Chrome 实例级僵死），只有原 page 对象的 reload() 能恢复
    log('②a Excel 已登记，reload 重建会话')
    try {
      await curPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch (e) {
      log('②a reload 超时（页面可能仍在加载），转探活：' + String(e?.message).slice(0, 60))
    }
    let reReady = false
    for (let i = 0; i < 20; i++) {
      await sleep(3000)
      // reload 后 curPage 通常是同一个对象，直接 evaluate
      let probe = null
      try {
        probe = await curPage.evaluate(() => ({
          url: location.href,
          btns: document.querySelectorAll('button').length,
          hasUpload: !!document.querySelector('input[type=file]'),
        }))
      } catch {
        probe = await safeEval(() => ({
          url: location.href,
          btns: document.querySelectorAll('button').length,
          hasUpload: !!document.querySelector('input[type=file]'),
        }))
      }
      if (probe && probe.btns > 0 && !/login|passport/i.test(probe.url || '')) { reReady = true; break }
    }
    if (!reReady) fail('api_error', 'Excel 上传后 reload 未就绪')
    log('②a 发布页已重建')
  }

  // ②b 图片走 HTTP FormData（多张并发，比 DOM 快）
  const b64Files = IMAGES.map((p) => ({
    name: p.split(/[\\/]/).pop() || 'img.png',
    b64: readFileSync(p).toString('base64'),
  }))
  try {
    const r = await safeEval(async (files) => {
      const b64toBlob = (b64, name) => {
        const bin = atob(b64)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        return new File([u8], name, { type: 'image/png' })
      }
      const fd = new FormData()
      for (const f of files) fd.append('file', b64toBlob(f.b64, f.name))
      const resp = await fetch('/product/img/batchupload', { method: 'POST', credentials: 'include', body: fd })
      const t = await resp.text()
      let j = null
      try { j = JSON.parse(t) } catch { /* ignore */ }
      return { status: resp.status, json: j, raw: j ? null : t.slice(0, 200) }
    }, b64Files)
    if (r?.json?.st === 0 && Array.isArray(r.json.data)) {
      uploadedUrls = r.json.data
      log(`②b ✅ HTTP 上传成功，${uploadedUrls.length} 个 CDN URL`)
    } else {
      log(`②b ⚠️ HTTP 上传失败（${JSON.stringify(r?.json || r?.raw || r?.err).slice(0, 100)}），降级 DOM`)
      const fi = await curPage.$('input[type=file]')
      if (!fi) fail('api_error', 'HTTP 上传失败且未找到 DOM 上传控件 input[type=file]')
      await fi.uploadFile(...IMAGES)
      log('②b 已用 DOM 上传图片')
      await sleep(15000)
    }
  } catch (e) {
    log(`②b HTTP 上传异常（${String(e?.message).slice(0, 80)}），降级 DOM`)
    try {
      const fi = await curPage.$('input[type=file]')
      if (fi) { await fi.uploadFile(...IMAGES); await sleep(15000) }
    } catch (e2) { fail('api_error', `图片上传失败：${String(e2?.message).slice(0, 100)}`) }
  }
  const imgUrl = uploadedUrls[0] || (Array.isArray(byApi.batchUpload) ? byApi.batchUpload[0] : null) || null
  log(`② 主图 CDN：${imgUrl ? imgUrl.slice(0, 70) + '…' : '（未拿到）'}`)
  await sleep(6000)

  // ②c 补拿 publish_id（HTTP 上传后页面可能自发 notify）
  if (!publishId) {
    for (let wait = 0; wait < 4 && !publishId; wait++) {
      publishId = grabPublishId()
      if (!publishId) await sleep(2500)
    }
    if (!publishId) {
      log('②c 页面未自发 notify，DOM 传一次兜底')
      try {
        const fi2 = await curPage.$('input[type=file]')
        if (fi2) { await fi2.uploadFile(IMAGES[0]); await sleep(12000) }
      } catch (e) { log('②c DOM 兜底失败: ' + String(e?.message).slice(0, 60)) }
      publishId = grabPublishId()
    }
    log(`②c publish_id：${publishId || '（未拿到）'}`)
  }

  // ═══ ③ 点「下一步」触发 AI 预测 ═════════════════════════
  //    ★ 点「下一步」会触发整页跳转（新版入口 → 材料页），frame 必 detached。
  //      带 Excel 时页面更重，跳转更久 → 必须等页面重新就绪再继续
  //      （实测：不等待会连环 detached）
  if (publishId && uploadedUrls.length) {
    const nr = await apiFetch('/product/tproduct/ai_publish/notify_material_change', {
      submit_type: 1,
      publish_id: publishId,
      materials: uploadedUrls.map((u) => ({ material_type: 1, url: u })),
      classify_source: 1,
    })
    log(`③ notify_material_change：${nr.json?.st === 0 ? '✅' : '⚠️ ' + JSON.stringify(nr.json || nr.err || nr.raw).slice(0, 100)}`)
  }
  log('③ 点「下一步，生成商品」触发 AI 预测')
  {
    let clicked = false
    for (let i = 0; i < 3 && !clicked; i++) {
      clicked = await safeEval(() => {
        const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').includes('下一步'))
        if (el) { el.click(); return true }
        return false
      })
      if (!clicked) await sleep(3000)
    }
    log(`③ 点击：${clicked ? '✅' : '❌ 未找到按钮'}`)
    // 等跳转完成 + 材料页渲染（标题框出现即算就绪）
    for (let i = 0; i < 40; i++) {
      await sleep(2000)
      const ready = await safeEval(() => !!document.querySelector('input[placeholder*="请输入2-60个字符"], input[placeholder*="标题"]'))
      if (ready) { log('③ 材料页就绪'); break }
      if (i === 39) log('③ ⚠️ 材料页 80s 未就绪')
    }
  }
  let predictResult = null
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    if (byApi.predictResult) { predictResult = byApi.predictResult; break }
  }
  const productInfo = predictResult?.product_info || {}
  const aiTitles = Array.isArray(productInfo.title_candidates) ? productInfo.title_candidates.filter(Boolean) : []
  const moreMaterials = Array.isArray(productInfo.more_materials) ? productInfo.more_materials : []
  log(`③ AI 预测：${predictResult ? `✅ success（task_id=${predictResult.task_id}）` : '⏳ 未拿到 success'}`)
  if (aiTitles.length) aiTitles.slice(0, 3).forEach((t) => log(`     · ${t}`))
  if (moreMaterials.length) log(`     更多素材（Excel/截图）：${moreMaterials.length} 个`)

  // ═══ material 模式：产出物料包就返回 ═══════════════════════
  if (MODE === 'material') {
    const material = {
      createdAt: new Date().toISOString(),
      shopKey: account.shop_key,
      images: { local: IMAGES, uploadedUrls },
      excel: EXCEL || null,
      predict: predictResult ? {
        taskId: predictResult.task_id,
        taskStatus: predictResult.task_status,
        titleCandidates: aiTitles,
        mainPics: productInfo.main_pics || [],
        detailMaterials: productInfo.detail_materials || [],
        moreMaterials,
      } : null,
      finalTitle: TITLE_OVERRIDE || aiTitles[0] || null,
    }
    const outFile = join(OUT_DIR, `material-${Date.now()}.json`)
    writeFileSync(outFile, JSON.stringify(material, null, 2))
    const lines = [
      'AI 发品物料包已生成：',
      `  上传图片：${IMAGES.length} 张${EXCEL ? ` + Excel（${moreMaterials.length ? '已识别' : '未识别为素材'}）` : ''}`,
      `  主图 CDN：${imgUrl ? imgUrl.slice(0, 70) + '…' : '（未拿到）'}`,
      `  AI 预测：${predictResult ? 'success' : '未完成'}`,
      aiTitles.length ? '  AI 推荐标题：' : '  AI 推荐标题：（未生成，可传 --title 指定）',
      ...aiTitles.slice(0, 5).map((t) => `    · ${t}`),
      '',
      EXCEL ? '提示：Excel 的 SKU/价格/库存会在进入第二级后由 AI 自动填入表单（实测有效）。' : '',
      '下一步：用 --mode submit 走完整链路，或 --mode props 查类目必填属性。',
      `物料包：${outFile}`,
    ].filter(Boolean)
    emit({ ok: true, mode: MODE, shopKey: account.shop_key, material, materialFile: outFile, text: lines.join('\n') })
  } else {
  // ═══ ④ 填标题（AI 候选优先，--title 覆盖）═════════════════
  const finalTitle = TITLE_OVERRIDE || aiTitles[0] || ''
  if (finalTitle) {
    await safeEval((t) => {
      const i = document.querySelector('input[placeholder*="请输入2-60个字符"], input[placeholder*="标题"]')
      if (i) {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, t)
        for (const type of ['input', 'compositionend', 'change', 'keyup']) i.dispatchEvent(new Event(type, { bubbles: true }))
      }
    }, finalTitle)
    log(`④ 已填标题：${finalTitle}`)
    await sleep(2500)
  }

  // ═══ ⑤ 选类目（HTTP 搜索 + DOM 逐个试到确认亮）════════════
  const cateQuery = CATEGORY || finalTitle.slice(0, 10) || '商品'
  const cs = (await apiFetch('/product/tproduct/searchCategoryN?key=' + encodeURIComponent(cateQuery) + '&search_type=1')) || {}
  const cateCands = (Array.isArray(cs.json?.data) ? cs.json.data : []).filter((c) => c.is_leaf)
  log(`⑤ 类目搜索（HTTP）「${cateQuery}」：${cateCands.length} 个叶子候选`)

  await safeEval(() => {
    const el = [...document.querySelectorAll('button,[role=button],a,span,div')].find(x => (x.textContent || '').trim() === '手动选择类目')
    if (el) el.click()
  })
  await sleep(7000)
  await safeEval((q) => {
    const all = [...document.querySelectorAll('input')].filter(x => {
      const r = x.getBoundingClientRect()
      return r.width > 0 && /搜索/.test(x.placeholder || '')
    })
    const i = all.find(x => /商品名|关键词/.test(x.placeholder || '')) || all[0]
    if (i) {
      i.focus(); i.click()
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, q)
      for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) i.dispatchEvent(new Event(t, { bubbles: true }))
      i.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
      i.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
    }
  }, cateQuery)
  // 等候选列表出现（page.$ 也可能遇 detached，包一层）
  let hasResultItem = false
  for (let i = 0; i < 10; i++) {
    await sleep(1200)
    try { hasResultItem = !!(await curPage.$('[class*="resultItem"]')) } catch { hasResultItem = false }
    if (hasResultItem) break
  }

  // ★ industry_status 不可信，逐个试到「确认」亮
  let cateId = null, catePathText = null, cateOk = false
  for (let idx = 0; idx < 6 && !cateOk; idx++) {
    const clicked = await safeEval((n) => {
      const els = [...document.querySelectorAll('[class*="resultItem"]')]
      if (!els.length || n >= els.length) return null
      const hit = els[n]
      const r = hit.getBoundingClientRect()
      const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
      for (const type of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) hit.dispatchEvent(new MouseEvent(type, o))
      return (hit.textContent || '').trim()
    }, idx)
    if (!clicked) break
    await sleep(5000)
    const ok = await safeEval(() => {
      const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').trim() === '确认')
      return el ? !el.disabled : null
    })
    if (ok === true) {
      log(`⑤ ✅ 类目选中：${clicked}`)
      const matched = cateCands.find((c) => [c.first_name, c.second_name, c.third_name].filter(Boolean).join('') === clicked.replace(/\s/g, ''))
      if (matched) cateId = String(matched.id)
      catePathText = clicked
      await safeEval(() => {
        const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').trim() === '确认' && !x.disabled)
        if (el) el.click()
      })
      cateOk = true
      await sleep(9000)
    } else {
      log(`⑤ 候选「${clicked}」→ ${ok === false ? '资质未开通' : '无确认按钮'}，试下一个`)
    }
  }
  if (!cateOk) {
    fail('api_error',
      `试了 6 个类目候选全部「资质未开通」。这是店铺资质问题，需去抖店「资质中心」开通对应类目。`
      + `\n本次搜索词：「${cateQuery}」，可换词重试（如更具体的品名）。`,
      { cateQuery, tried: 6 })
  }

  // ═══ ⑥ 进第二级 ═════════════════════════════════════════
  const wentL2 = await safeEval(() => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').includes('确认信息'))
    if (el && !el.disabled) { el.click(); return true }
    return false
  })
  log(`⑥ 进第二级：${wentL2 ? '✅' : '❌'}`)
  await sleep(18000)
  if (!wentL2) {
    // 没进第二级：明确失败，不要在材料页白填属性
    fail('api_error',
      '未能进入第二级（商品信息页）。可能原因：类目没选上（「确认信息，继续生成」仍 disabled）、'
      + '或页面状态异常。\n建议：换 --category 关键词重试；或到抖店「资质中心」确认该类目已开通。',
      { stage: 'material', cateQuery })
  }

  // ═══ ⑦b 智能填属性（dump 候选表 → 按 hint 匹配 → 选中）═════════
  //  hint 来源：--attrs 参数（用户指定）> Excel 属性 sheet > 空（默认第一个保底）
  //  ★ Excel 实测**不能**填属性（AI 只认 SKU/价格/库存），所以属性走「候选表匹配」路线
  const attrHints = (() => {
    try { return ARGS.attrs ? JSON.parse(ARGS.attrs) : {} } catch { return {} }
  })()
  const fillRes = await smartFillAttrs(page, attrHints)
  if (fillRes.filled.length) {
    log(`⑦b 智能填属性：${fillRes.filled.length} 项`)
    fillRes.filled.forEach((x) => log(`⑦b   ${x.label} → 「${x.value}」（${x.matched}）`))
  } else {
    log('⑦b 无需填（必填属性均已填或未出现）')
  }
  if (fillRes.failed.length) {
    log(`⑦b ⚠️ ${fillRes.failed.length} 项失败：${fillRes.failed.map((x) => `${x.label}(${x.why})`).join('、')}`)
  }
  await sleep(2000)

  // ═══ ⑦c 填 SKU 表（--skus 指定；不传则跳过，靠 Excel/AI 或人工）══════
  //    ★ 实测发布被拦的头号原因：「价格 该项为必填，请输入」——SKU 表 0 行
  //    ★ 规格值控件是 cascader（.ecom-g-cascader-picker），不是普通 input
  let skuRes = null
  if (SKU_SPEC) {
    log('⑦c 填 SKU 表（cascader 规格值）')
    // 兼容两种写法：{values:[...]} 或 {specs:{颜色分类:[...]}}
    const normalized = {
      values: SKU_SPEC.values || Object.values(SKU_SPEC.specs || {})[0] || [],
      price: SKU_SPEC.price,
      stock: SKU_SPEC.stock,
      totalStock: SKU_SPEC.totalStock,
      itemNo: SKU_SPEC.itemNo,
    }
    skuRes = await fillSkuTable(curPage, normalized)
    skuRes.log.forEach((l) => log('⑦c   ' + l))
    if (!skuRes.ok) log('⑦c ⚠️ SKU 未完全填充（见上）')
  } else {
    const st = await readSkuState(curPage)
    log(`⑦c SKU 表：${st.rows} 行（${st.filledRows} 行已填）${st.rows === 0 ? ' ← 未提供 --skus，发布可能被「价格必填」拦下' : ''}`)
  }
  await sleep(1500)


  // ═══ ⑦ 盘点第二级（填属性之后）════════════════════════════
  // props 用 attr-fill 的 readAttrState（已验证的 ecom-g-select 定位），
  // SKU 表 / AI 填入值仍用 DOM 直读
  const attrState = await readAttrState(page, true)
  const l2 = (await safeEval(() => {
    const tables = [...document.querySelectorAll('table')].map((t) => ({
      headers: [...t.querySelectorAll('th')].map((h) => (h.textContent || '').trim()).slice(0, 12),
      rowCount: t.querySelectorAll('tbody tr').length,
      filledRows: [...t.querySelectorAll('tbody tr')].filter((r) => {
        const inp = r.querySelector('input')
        return inp && inp.value
      }).length,
    }))
    const filled = [...document.querySelectorAll('input')]
      .map((i) => ({ ph: i.placeholder || '', val: (i.value || '').slice(0, 40) }))
      .filter((x) => x.val && x.val !== '0').slice(0, 20)
    const todo = (document.body.innerText || '').match(/待完善信息\s*(\d+)/)
    return {
      url: location.href,
      tables,
      filled,
      todoCount: todo ? Number(todo[1]) : null,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500),
    }
  })) || { url: '', tables: [], filled: [], todoCount: null, text: '' }
  l2.props = attrState.map((a) => ({
    label: a.label,
    hasValue: a.filled,
    value: a.text,
    control: a.text ? 'g-select' : 'custom',
  }))
  if (!attrState.length) log('⑦ ⚠️ 未读到属性（可能未进第二级或页面未渲染完）')
  const missingProps = l2?.props?.filter((p) => !p.hasValue) || []
  // ★ 必填属性清单（实测「餐饮厨具/水具/玻璃杯」；类目不同可能不同，以页面「待完善」为准）
  const REQUIRED_LABELS = ['适用温度', '材质', '容量', '数量', '款式', '品牌']
  const attrReadOk = (l2?.props?.length || 0) > 0
  const missingRequired = missingProps.filter((p) => REQUIRED_LABELS.includes(p.label))
  const missingOptional = missingProps.filter((p) => !REQUIRED_LABELS.includes(p.label))
  log(`⑦ 第二级盘点：待完善 ${l2?.todoCount ?? '?'} 项 | 属性 ${l2?.props?.length ?? 0} 个（未填 ${missingProps.length}，其中必填未填 ${missingRequired.length}）`)
  log(`⑦ SKU 表：${(l2?.tables || []).map((t) => `${t.rowCount} 行/${t.filledRows} 行已填`).join(' ; ') || '无'}`)
  if (!attrReadOk) log('⑦ ⚠️ 未读到属性清单——**不能**断定必填已填，请在弹出窗口内人工核对')
  if (missingRequired.length) log(`⑦ ⚠️ 必填未填：${missingRequired.map((p) => p.label).join('、')}`)
  if (missingOptional.length) log(`⑦ 非必填未填（可忽略）：${missingOptional.map((p) => p.label).join('、')}`)

  // ═══ props 模式：输出属性清单就结束 ════════════════════════
  if (MODE === 'props') {
    emit({
      ok: true, mode: MODE, shopKey: account.shop_key,
      cateId, catePath: catePathText,
      props: l2?.props || [],
      missingProps,
      missingRequired,
      text: [
        `类目「${catePathText || cateId}」属性清单（共 ${l2?.props?.length ?? 0} 项）：`,
        ...(l2?.props || []).map((p) => `  ${p.hasValue ? '✅' : '❌'} ${p.label}（${p.control}）${REQUIRED_LABELS.includes(p.label) ? ' ←必填' : ''}`),
        '',
        missingRequired.length
          ? `⚠️ 必填未填 ${missingRequired.length} 项：${missingRequired.map((p) => p.label).join('、')}`
          : attrReadOk ? '✅ 必填属性已全部填写' : '⚠️ 未读到属性清单，请人工核对必填项',
        missingOptional.length ? `非必填未填 ${missingOptional.length} 项（可忽略）：${missingOptional.map((p) => p.label).join('、')}` : null,
        !attrReadOk ? '（属性清单读取失败，不影响已填部分）' : null,
      ].filter(Boolean).join('\n'),
    })
  } else {

  const shotDir = OUT_DIR
  const shotPath = join(shotDir, `level2-${Date.now()}.png`)
  try { await curPage.screenshot({ path: shotPath, fullPage: false }) } catch { /* ignore */ }


  const outFile = join(OUT_DIR, `ai-publish-${Date.now()}.json`)
  writeFileSync(outFile, JSON.stringify({
    createdAt: new Date().toISOString(),
    shopKey: account.shop_key,
    title: finalTitle,
    cateId, catePath: catePathText,
    imgUrl, excel: EXCEL || null,
    predict: { taskId: predictResult?.task_id, titleCandidates: aiTitles },
    level2: l2,
    missingProps,
  }, null, 2))

  // ═══ props 模式：只返回属性清单 ════════════════════════════
  // ═══ ⑧ submit 模式：点「发布商品」（L2）═══════════════════
  if (!CONFIRM) {
    emit({
      ok: false, needConfirm: true, mode: MODE, shopKey: account.shop_key,
      title: finalTitle, cateId, catePath: catePathText,
      level2: { todoCount: l2?.todoCount, props: l2?.props, tables: l2?.tables },
      missingProps,
      missingRequired,
      screenshot: shotPath, materialFile: outFile,
      text: [
        '【发布预览】AI 已填完商品信息，确认发布吗？',
        '',
        `  标题：${finalTitle}`,
        `  类目：${catePathText || cateId}`,
        `  SKU 表：${(l2?.tables || []).map((t) => `${t.rowCount} 行（${t.filledRows} 行已填）`).join(' ; ') || '无'}`
        + (skuRes ? ` ← 本次填充后 ${skuRes.after.filledRows} 行有值` : ''),
        l2?.todoCount != null ? `  待完善信息：${l2.todoCount} 项` : null,
        missingRequired.length
          ? `  ⚠️ 必填属性未填：${missingRequired.map((p) => p.label).join('、')}`
          : attrReadOk ? '  ✅ 必填属性已全部填写' : '  ⚠️ 未读到属性清单，请在窗口内人工核对必填项',
        missingOptional.length ? `  非必填未填（可忽略）：${missingOptional.map((p) => p.label).join('、')}` : null,
        EXCEL ? '  Excel 来源：SKU/价格/库存由 AI 从表格识别填入' : null,
        '',
        `  截图：${shotPath}`,
        '',
        missingRequired.length
          ? '⚠️ 必填属性未填全，直接发布会被拦。请先在弹出窗口内补齐，或回复同意后我尝试发布。'
          : !skuRes && (l2?.tables || []).every((t) => t.filledRows === 0)
            ? '⚠️ SKU 表是空的（价格必填未填），直接发布会被拦。请补 --skus 或在窗口内手工填价格库存。'
            : attrReadOk
              ? '✅ 必填项已齐。确认发布请回复明确同意，我会带 --confirm true 重新执行。'
              : '⚠️ 属性清单未读到，请在弹出窗口内核对必填项后再确认。',
      ].filter(Boolean).join('\n'),
    })
    log('⑧ 未带 --confirm，仅返回预览（零写操作）')
  } else {
  log('⑧ 点「发布商品」')
  const submitted = await safeEval(() => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').trim() === '发布商品')
    if (el && !el.disabled) { el.click(); return true }
    return false
  })
  await sleep(15000)

  const finalState = await safeEval(() => ({
    url: location.href,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
  }))
  const success = /发布成功|提交成功|上架成功|审核中|已提交/.test(finalState?.text || '')
  log(`⑧ 发布结果：${success ? '✅ 成功' : '⚠️ 见页面状态'}`)

  emit({
    ok: submitted && success,
    mode: MODE, shopKey: account.shop_key,
    stage: success ? 'submitted' : 'unknown',
    title: finalTitle, cateId, catePath: catePathText,
    finalUrl: finalState?.url,
    finalText: (finalState?.text || '').slice(0, 400),
    screenshot: shotPath, materialFile: outFile,
    text: [
      success ? '✅ 已提交发布' : '⚠️ 已点「发布商品」，但未确认成功（见下方页面状态）',
      `  标题：${finalTitle}`,
      `  类目：${catePathText || cateId}`,
      `  页面 URL：${(finalState?.url || '').slice(0, 100)}`,
      `  页面状态：${(finalState?.text || '').slice(0, 250)}`,
      '',
      '平台仍会审核，最终状态以抖店后台「商品管理」为准。',
    ].join('\n'),
  })
  }
  }
  }
} catch (err) {
  fail('api_error', `AI 发布流程异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
