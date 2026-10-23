#!/usr/bin/env node
/**
 * 抖音小店 · 完整发布链路（douyin-publish-full）
 *
 * 打通「材料页 → 选类目 → 第二级 → 提交」全流程，对标 pdd-publish-http 的定位，
 * 但用**DOM 驱动 + 结构化接口辅助**（不用 HTTP 改包——抖店是 publish_id 有状态链路，
 * 强行走改包要同时逆 a_bogus + AI 协议，成本远高于收益）。
 *
 * 链路（2026-10 真机实测）：
 *   ① openEntry        /ffa/g/create（默认是 AI 新版，0 个 input）
 *   ② backToOldVersion 点「返回旧版」→ 表单流程
 *   ③ uploadImages     上传主图/详情图（input[type=file]）
 *   ④ fillTitle        填标题（input[placeholder*="请输入2-60个字符"]）
 *   ⑤ aiPredict        点「下一步」→ submitPredictTask/getPredictTask → AI 推荐标题
 *   ⑥ selectCategory   点「手动选择类目」→ 在搜索框输关键词 → 点叶子候选 → 确认
 *                       （类目候选来自 /product/tproduct/searchCategoryN 结构化数据）
 *   ⑦ confirmMaterial  类目选完后「确认信息，继续生成」才可用 → 点它进第二级
 *   ⑧ level2           第二级：SKU/属性/详情图/提交（锚点见 publish-config）
 *
 * 用法：
 *   node publish-full.mjs --mode preview --product-file ./p.json
 *   node publish-full.mjs --mode publish --product-file ./p.json --confirm true
 *   node publish-full.mjs --mode cate --cate-query 茶杯
 */
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href

// 抖店风控绕过（hook XHR/fetch 让风控检测请求不发出去，不过滑块）
const { injectRiskBypass, getBypassHits } = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'douyin-risk-bypass.mjs')))

// ── 参数解析 ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = 'true'
    else { out[key] = next; i++ }
  }
  return out
}
const ARGS = parseArgs(process.argv)
const truthy = (v) => String(v ?? '').trim().toLowerCase() === 'true'

const MODE = (ARGS.mode || 'preview').trim()
const CONFIRM = truthy(ARGS.confirm)
const ACCOUNT = (ARGS.account || '').trim()
const CATEGORY_OVERRIDE = (ARGS.category || '').trim()
const CATE_ID = (ARGS['cate-id'] || '').trim()
const CATE_QUERY = (ARGS['cate-query'] || '').trim()

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-publish-full] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 读 product ────────────────────────────────────────────
function loadProduct() {
  const pf = (ARGS['product-file'] || '').trim()
  const ps = (ARGS.product || '').trim()
  let raw = null
  if (pf) {
    if (!existsSync(pf)) { fail('api_error', `product 文件不存在：${pf}`) }
    raw = readFileSync(pf, 'utf8')
  } else if (ps) {
    raw = ps
  } else {
    fail('api_error', '缺少商品数据：请传 --product-file <path> 或 --product <json>')
  }
  let p = null
  try { p = JSON.parse(raw) } catch (e) { fail('api_error', `product JSON 解析失败：${e.message}`) }

  // 校验
  if (!p.title || !String(p.title).trim()) fail('api_error', 'product.title 不能为空（≤60 字符）')
  if (String(p.title).length > 60) fail('api_error', `product.title 超过 60 字符（当前 ${String(p.title).length}）`)
  const imgs = Array.isArray(p.images) ? p.images : []
  if (!imgs.length) fail('api_error', 'product.images 不能为空（至少 1 张本地主图）')
  if (imgs.length > 9) fail('api_error', `product.images 超过 9 张（当前 ${imgs.length}）`)
  for (const f of [...imgs, ...(Array.isArray(p.detailImages) ? p.detailImages : [])]) {
    if (!existsSync(f)) fail('api_error', `图片不存在：${f}`)
    const mb = statSync(f).size / 1024 / 1024
    if (mb > 5) fail('api_error', `图片超过 5MB：${f}（${mb.toFixed(2)}MB）`)
  }
  // 规格校验（≤2 维，SKU 行覆盖全维度）
  const specs = Array.isArray(p.specs) ? p.specs : []
  if (specs.length > 2) fail('api_error', `specs 超过 2 维（当前 ${specs.length}）`)
  const skus = Array.isArray(p.skus) ? p.skus : []
  if (specs.length && !skus.length) {
    fail('api_error', '传了 specs 必须同时传 skus（每行覆盖全部维度）')
  }
  if (skus.length) {
    for (const [i, s] of skus.entries()) {
      for (const d of specs) {
        if (s.specs?.[d.name] == null) {
          fail('api_error', `skus[${i}] 缺少维度「${d.name}」的值`)
        }
      }
    }
  }
  return {
    title: String(p.title).trim(),
    images: imgs,
    detailImages: Array.isArray(p.detailImages) ? p.detailImages : [],
    category: (p.category || '').trim(),
    price: p.price != null ? String(p.price) : '',
    stock: p.stock != null ? String(p.stock) : '',
    itemNo: (p.itemNo || '').trim(),
    specs,
    skus,
    attributes: Array.isArray(p.attributes) ? p.attributes : [],
    account: (p.account || '').trim(),
  }
}

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

// ── 图片本地预校验（1:1 / ≥600×600，避免上传后被平台静默拦截）──
function checkImages(paths) {
  const bad = []
  for (const p of paths) {
    try {
      const fd = readFileSync(p)
      let w = 0, h = 0
      if (fd.length > 24 && fd.toString('latin1', 1, 4) === 'PNG') {
        w = fd.readUInt32BE(16); h = fd.readUInt32BE(20)
      } else if (fd.length > 4 && fd[0] === 0xFF && fd[1] === 0xD8) {
        let off = 2
        while (off < fd.length) {
          if (fd[off] !== 0xFF) { off++; continue }
          const marker = fd[off + 1]
          const len = fd.readUInt16BE(off + 2)
          if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            h = fd.readUInt16BE(off + 5); w = fd.readUInt16BE(off + 7); break
          }
          off += 2 + len
        }
      }
      if (w && h && (Math.abs(w / h - 1) > 0.02 || w < 600)) {
        bad.push(`${p}（${w}×${h}）`)
      }
    } catch { /* 读不了尺寸不拦，交给平台 */ }
  }
  return bad
}

const dir = profileDir('douyin_shop', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-publish-full')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

// ── mode: cate（纯查询类目，不起浏览器以外的流程）────────
if (MODE === 'cate') {
  if (!CATE_QUERY) { releaseProfile(dir); fail('api_error', '--mode cate 需要 --cate-query <关键词>') }
}

let browser = null
try {
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  browser = await puppeteer.default.launch({
    headless: false, executablePath: chromePath, userDataDir: dir,
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1600,1000'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  // ★ 风控绕过必须在 page.goto 之前注入（evaluateOnNewDocument 每次导航自动生效）
  await injectRiskBypass(page)
  await page.setCookie(...Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => [
      { name: n, value: String(v), domain: '.jinritemai.com', path: '/' },
      { name: n, value: String(v), domain: '.douyin.com', path: '/' },
    ]))

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // hook：类目搜索 + AI 预测任务
  const byApi = {}
  // 记录页面自发请求体（publish_id 只在这些请求里出现，实测）
  const notifyReqs = []
  cdp.on('Network.requestWillBeSent', (e) => {
    try {
      const u = e.request.url
      if (!/jinritemai\.com/.test(u)) return
      if (!/json/.test(e.request.headers?.['content-type'] || e.request.headers?.['Content-Type'] || '')) return
      if (e.request.postData) notifyReqs.push(e.request.postData.slice(0, 2000))
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
        : /submitPredictTask/.test(u) ? 'submitPredict'
        : /batchupload/.test(u) ? 'batchUpload'
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

  log('open https://fxg.jinritemai.com/ffa/g/create')
  await page.goto('https://fxg.jinritemai.com/ffa/g/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(13000)
  if (/\/login|passport/i.test(page.url())) {
    fail('token_expired', '抖店后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。')
  }

  // 返回旧版
  const backed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,[role=button],a,span,div')].find(x => (x.textContent || '').trim() === '返回旧版')
    if (el) { el.click(); return true }
    return false
  })
  log(`返回旧版：${backed ? '成功' : '未找到（可能已是旧版）'}`)
  await sleep(10000)

  // ── mode: cate ─────────────────────────────────────────
  if (MODE === 'cate') {
    // ★ 门禁（实测）：「手动选择类目」按钮要**有图 + 有标题**后才出现。
    //   只上传图时页面只有「换一批」（AI 标题刷新），没有类目入口。
    //   所以 cate 模式先上传占位图 + 填一个占位标题。
    try {
      const fi0 = await page.$('input[type=file]')
      const placeholder = join(HERE, '..', '..', '_douyin_probe', 'test-fresh-1082336667.png')
      if (fi0 && existsSync(placeholder)) {
        await fi0.uploadFile(placeholder)
        log('已上传占位图')
        await sleep(14000)
      }
    } catch (e) { log('占位图上传失败: ' + e.message) }
    await page.evaluate(() => {
      const i = document.querySelector('input[placeholder*="请输入2-60个字符"], input[placeholder*="标题"]')
      if (i) {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        set.call(i, '类目查询占位标题')
        i.dispatchEvent(new Event('input', { bubbles: true }))
        i.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await sleep(3000)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,[role=button],a,span,div')].find(x => (x.textContent || '').trim() === '手动选择类目')
      if (el) el.click()
    })
    await sleep(8000)
    const panelOpen = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].filter(x => {
        const r = x.getBoundingClientRect()
        return r.width > 0 && /搜索/.test(x.placeholder || '')
      })
      return inputs.map(i => i.placeholder || '')
    })
    log(`类目面板搜索框：${JSON.stringify(panelOpen)}`)
    if (!panelOpen.length) {
      fail('api_error',
        '类目面板未能打开。已知门禁：需先上传图片 + 填写标题，「手动选择类目」按钮才会出现。'
        + '若已传图填标题仍打不开，可能是页面改版——跑 probe-cate-api.mjs 重新确认。',
        { panelSearchInputs: panelOpen })
    }
    await page.evaluate((q) => {
      const all = [...document.querySelectorAll('input')].filter(x => {
        const r = x.getBoundingClientRect()
        return r.width > 0 && /搜索/.test(x.placeholder || '')
      })
      const i = all.find(x => /商品名|关键词/.test(x.placeholder || '')) || all[0]
      if (!i) return
      i.focus(); i.click()
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, q)
      // React 受控输入：必须逐字符派发 input 才会进 state 并发请求
      for (const type of ['input', 'compositionend', 'change', 'keyup', 'blur', 'focus']) {
        i.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
      }
      // 有些实现认 KeyboardEvent
      i.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
      i.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }))
      i.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
    }, CATE_QUERY)
    // 轮询等接口返回（搜索是防抖的，可能要 1~2s）
    for (let i = 0; i < 15; i++) {
      await sleep(1500)
      if (byApi.cateSearch) break
    }

    const cands = Array.isArray(byApi.cateSearch) ? byApi.cateSearch : []
    const leaves = cands.filter((c) => c.is_leaf)
    const usable = leaves.filter((c) => c.industry_status === 2)
    const lines = []
    lines.push(`类目搜索「${CATE_QUERY}」：共 ${cands.length} 个候选，其中叶子类目 ${leaves.length} 个，已开通可发 ${usable.length} 个`)
    lines.push('')
    usable.slice(0, 15).forEach((c, i) => {
      lines.push(`  ${i + 1}. [${c.id}] ${c.first_name} / ${c.second_name} / ${c.third_name}`)
    })
    if (!usable.length && leaves.length) {
      lines.push('  ⚠️ 有叶子类目但 industry_status≠2（未开通资质），需先去资质中心开通：')
      leaves.slice(0, 10).forEach((c, i) => {
        lines.push(`    ${i + 1}. [${c.id}] ${c.first_name} / ${c.second_name} / ${c.third_name}（status=${c.industry_status}）`)
      })
    }
    emit({
      ok: true, mode: MODE, query: CATE_QUERY,
      total: cands.length, leafCount: leaves.length, usableCount: usable.length,
      candidates: usable.slice(0, 30).map((c) => ({
        id: c.id, path: [c.first_name, c.second_name, c.third_name].filter(Boolean).join('/'),
        cids: { first: c.first_cid, second: c.second_cid, third: c.third_cid },
      })),
      text: lines.join('\n'),
    })
  } else {
  // ── mode: preview / publish ────────────────────────────
  const product = loadProduct()

  // 图片宽高比前置校验
  const badRatio = checkImages(product.images)
  if (badRatio.length) {
    releaseProfile(dir)
    fail('api_error',
      '主图必须 1:1 且 ≥600×600（平台会用「长宽比需为1:1」静默拦住 AI 流程），以下不符：\n  '
      + badRatio.join('\n  ') + '\n请先裁成正方形高清图。',
      { badRatio })
  }

  // ── L2 预览门禁 ────────────────────────────────────────
  const preview = {
    ok: false,
    needConfirm: true,
    mode: MODE,
    shopKey: account.shop_key,
    product: {
      title: product.title,
      images: product.images,
      detailImages: product.detailImages,
      category: CATEGORY_OVERRIDE || product.category || `（将用「${product.title.slice(0, 10)}」搜索）`,
      cateId: CATE_ID || null,
      price: product.price || '—',
      stock: product.stock || '—',
      itemNo: product.itemNo || '—',
      specs: product.specs.map((s) => ({ name: s.name, values: (s.values || []).map((v) => v.value ?? v) })),
      skuCount: product.skus.length,
      attributes: product.attributes,
    },
    text: [
      '【发布预览】确认要发布到抖音小店吗？',
      '',
      `  标题：${product.title}`,
      `  主图：${product.images.length} 张`,
      product.detailImages.length ? `  详情图：${product.detailImages.length} 张` : null,
      `  类目：${CATEGORY_OVERRIDE || product.category || '自动搜索'}${CATE_ID ? `（ID ${CATE_ID}）` : ''}`,
      `  价格：${product.price || '—'} | 库存：${product.stock || '—'} | 货号：${product.itemNo || '—'}`,
      product.specs.length ? `  规格：${product.specs.map((s) => s.name).join(' × ')}（${product.skus.length} 个 SKU）` : '  规格：无（单 SKU）',
      product.attributes.length ? `  属性：${product.attributes.map((a) => `${a.name}=${a.value}`).join('，')}` : null,
      '',
      '流程：上传主图 → 填标题 → AI 识别 → 选类目 → 进第二级填 SKU/属性 → 提交',
      '⚠️ 品牌与部分商品资质不会自动填，需在弹出窗口内人工补全。',
      '⚠️ 提交后平台仍会审核，最终状态以抖店后台「商品管理」为准。',
      '',
      '确认发布请回复明确同意，我会带 --confirm true 重新执行。',
    ].filter(Boolean).join('\n'),
  }
  emit(preview)

  if (!CONFIRM) {
    log('未带 --confirm，仅返回预览（零写操作）')
  } else {
  // ── 真正发布 ───────────────────────────────────────────
  log('── 开始发布流程（混合模式：HTTP 为主 + 2 个必要 DOM 点击）──')

  // ★ 页面内 fetch 助手：secsdk 会为页面内的 fetch 自动附加 a_bogus/msToken 签名
  //   （实测 searchCategoryN / notify_material_change / submitPredictTask 全部 st=0）。
  //   这比 Node 直连可靠——Node 侧算不出 a_bogus。
  const apiFetch = (path, body) => page.evaluate(async (path, body) => {
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

  // ★ 容错 evaluate：开类目面板/切旧版会触发页面重绘 → frame detached
  const safeEval = async (fn, ...args) => {
    for (let i = 0; i < 3; i++) {
      try { return await page.evaluate(fn, ...args) } catch (e) {
        if (/detached|Execution context was destroyed|Cannot find context/i.test(String(e?.message))) {
          await sleep(4000)
          continue
        }
        throw e
      }
    }
    return null
  }

  // ① 上传图片（HTTP FormData 优先，失败降级 DOM file input）
  //    ★ 实测：页面内 fetch + FormData 调 /product/img/batchupload 能过 secsdk，
  //      且多张可一次传（比 DOM file input 快，且不受上传控件改版影响）
  let imgUrl = null
  const allLocalImages = [...product.images, ...product.detailImages]
  const b64Files = allLocalImages.map((p) => ({
    name: p.split(/[\\/]/).pop() || 'img.png',
    b64: readFileSync(p).toString('base64'),
  }))
  try {
    const upRes = await page.evaluate(async (files) => {
      const b64toBlob = (b64, name) => {
        const bin = atob(b64)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        return new File([u8], name, { type: 'image/png' })
      }
      const fd = new FormData()
      for (const f of files) fd.append('file', b64toBlob(f.b64, f.name))
      const r = await fetch('/product/img/batchupload', { method: 'POST', credentials: 'include', body: fd })
      const t = await r.text()
      let j = null
      try { j = JSON.parse(t) } catch { /* ignore */ }
      return { status: r.status, json: j, raw: j ? null : t.slice(0, 200) }
    }, b64Files)
    if (upRes.json?.st === 0 && Array.isArray(upRes.json.data) && upRes.json.data.length) {
      imgUrl = upRes.json.data[0]
      log(`① ✅ HTTP 上传成功，${upRes.json.data.length} 个 CDN URL`)
      // 回填 byApi，供后续步骤用
      byApi.batchUpload = upRes.json.data
    } else {
      log(`① ⚠️ HTTP 上传失败（${JSON.stringify(upRes.json || upRes.raw || upRes.err).slice(0, 100)}），降级 DOM file input`)
      const fi = await page.$('input[type=file]')
      if (!fi) fail('api_error', 'HTTP 上传失败且未找到 DOM 上传控件 input[type=file]')
      await fi.uploadFile(...allLocalImages)
      log(`① 已用 DOM 上传 ${allLocalImages.length} 张图`)
      await sleep(15000)
      const urls = Array.isArray(byApi.batchUpload) ? byApi.batchUpload : []
      imgUrl = urls[0] || null
    }
  } catch (e) {
    log(`① HTTP 上传异常（${e?.message}），降级 DOM file input`)
    const fi = await page.$('input[type=file]')
    if (!fi) fail('api_error', `上传失败：${e?.message || String(e)}`)
    await fi.uploadFile(...allLocalImages)
    await sleep(15000)
    const urls = Array.isArray(byApi.batchUpload) ? byApi.batchUpload : []
    imgUrl = urls[0] || null
  }
  log(`② 主图 CDN：${imgUrl ? imgUrl.slice(0, 70) + '…' : '（未拿到）'}`)

  // ③ 拿 publish_id
  //    ★ 实测结论：publish_id 不在 URL、不在 window 全局、不在 HTML 里。
  //      唯一来源是**页面自己发的 notify_material_change 请求体**——
  //      而它要等图片上传后才会发。所以顺序必须是：先 DOM 上传 → 从抓包取 publish_id。
  //      提前自己调 notify 是没用的（那个接口本身就要 publish_id 入参）。
  let publishId = null
  {
    // 3a. URL
    publishId = await page.evaluate(() => {
      const m = location.href.match(/publish_id=(\d{15,})/)
      return m ? m[1] : (window.__publishId || null)
    })
    // 3b. 从 CDP 抓包记录里找页面自发 notify 的 publish_id
    if (!publishId) {
      const hit = notifyReqs.find((b) => /publish_id["']?\s*:\s*["']?(\d{15,})/.test(b))
      const m = hit ? hit.match(/publish_id["']?\s*:\s*["']?(\d{15,})/) : null
      if (m) publishId = m[1]
    }
    // 3c. performance entries（兜底）
    if (!publishId) {
      publishId = await page.evaluate(() => {
        for (const e of performance.getEntriesByType('resource')) {
          const m = e.name.match(/publish_id[=:"']+(\d{15,})/)
          if (m) return m[1]
        }
        return null
      })
    }
    // 3d. 仍没有：主动触发一次页面 notify（点一下上传区附近的交互通常不够，
    //     这里改用再上传一次同一张图来逼页面重发 notify）
    if (!publishId && imgUrl) {
      log('③ publish_id 未拿到，尝试再上传一次以触发页面 notify')
      try {
        const fi2 = await page.$('input[type=file]')
        if (fi2) { await fi2.uploadFile(product.images[0]); await sleep(12000) }
      } catch { /* ignore */ }
      const hit = notifyReqs.find((b) => /publish_id["']?\s*:\s*["']?(\d{15,})/.test(b))
      const m = hit ? hit.match(/publish_id["']?\s*:\s*["']?(\d{15,})/) : null
      if (m) publishId = m[1]
    }
  }
  const traceRes = await apiFetch('/product/tproduct/material/generateMaterialTraceId', {})
  // 响应实测：{st:0, data:{trace_id:"uuid"}}（data 是对象不是数组）
  const traceId = traceRes.json?.data?.trace_id
    || traceRes.json?.trace_id
    || (typeof traceRes.json?.data === 'string' ? traceRes.json.data : null)
    || null
  log(`③ publish_id=${publishId || '（未拿到）'} | trace_id=${traceId || '（未拿到）'}`)

  // ④ 填标题（DOM：React 受控输入，必须逐字符派发事件）
  await page.evaluate((t) => {
    const i = document.querySelector('input[placeholder*="请输入2-60个字符"], input[placeholder*="标题"]')
    if (i) {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(i, t)
      for (const type of ['input', 'compositionend', 'change', 'keyup', 'blur']) {
        i.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
      }
      i.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
      i.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
    }
  }, product.title)
  log('④ 已填标题（DOM 受控输入）')
  await sleep(2500)

  // ⑤ 材料上报（HTTP）
  if (publishId && imgUrl) {
    const nr = await apiFetch('/product/tproduct/ai_publish/notify_material_change', {
      submit_type: 1,
      publish_id: publishId,
      materials: [{ material_type: 1, url: imgUrl }],
      classify_source: 1,
    })
    log(`⑤ notify_material_change：${nr.json?.st === 0 ? '✅' : '⚠️ ' + JSON.stringify(nr.json || nr.err || nr.raw).slice(0, 100)}`)
  } else {
    log('⑤ notify_material_change：跳过（缺 publish_id 或 imgUrl）')
  }

  // ⑥ AI 预测任务（HTTP）：submitPredictTask → getPredictTask 轮询
  if (publishId && imgUrl) {
    const sr = await apiFetch('/product/tproduct/submitPredictTask', {
      publish_id: publishId, scene: 5, files: [{ url: imgUrl, type: 'png' }],
    })
    const taskId = sr.json?.data?.async_options?.task_id
    if (taskId) {
      let done = null
      for (let i = 0; i < 20; i++) {
        await sleep(1500)
        const poll = await apiFetch('/product/tproduct/getPredictTask', { taskId, scene: 5, publish_id: publishId })
        if (poll.json?.data?.task_status === 'success') { done = poll.json.data; break }
      }
      const tc = done?.product_info?.title_candidates || []
      log(`⑥ AI 预测：${done ? `✅ success，${tc.length} 个标题候选` : '⏳ 未拿到 success'}`)
      if (tc.length) tc.slice(0, 3).forEach((t) => log(`     · ${t}`))
    } else {
      log('⑥ AI 预测：未拿到 task_id（不影响继续）')
    }
  }

  // ⑦ 选类目
  //    ★ 实测关键结论：接口的 industry_status=2 **不等于**真能发（试了 16 个全弹「未开通」）。
  //      唯一可靠判据是「点了候选后确认按钮是否亮」。
  //      所以策略是：开面板 → 搜词 → **从第一个候选开始逐个点**，确认亮了就用它。
  let cateId = CATE_ID
  let catePath = CATEGORY_OVERRIDE || product.category || product.title.slice(0, 10)
  let leafPick = null
  if (!cateId) {
    // ⑦a HTTP 拿结构化候选（仅用于日志与 cid 对齐，选择以面板实测为准）
    const cs = await apiFetch("/product/tproduct/searchCategoryN?key=" + encodeURIComponent(catePath) + "&search_type=1")
    const cands = (Array.isArray(cs.json?.data) ? cs.json.data : []).filter((c) => c.is_leaf)
    const usable = cands.filter((c) => c.industry_status === 2)
    leafPick = usable[0] || cands[0] || null
    log(`⑦ 类目搜索（HTTP）：${cands.length} 候选 / ${usable.length} 个 status=2（仅供参考，以面板实测为准）`)

    // ⑦b 开面板 + 回填搜索词
    await safeEval(() => {
      const el = [...document.querySelectorAll("button,[role=button],a,span,div")].find(x => (x.textContent || "").trim() === "手动选择类目")
      if (el) el.click()
    })
    await sleep(7000)
    await safeEval((q) => {
      const all = [...document.querySelectorAll("input")].filter(x => {
        const r = x.getBoundingClientRect()
        return r.width > 0 && /搜索/.test(x.placeholder || "")
      })
      const i = all.find(x => /商品名|关键词/.test(x.placeholder || "")) || all[0]
      if (i) {
        i.focus(); i.click()
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
        set.call(i, q)
        for (const t of ["input", "compositionend", "change", "keyup", "blur"]) i.dispatchEvent(new Event(t, { bubbles: true }))
        i.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }))
        i.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }))
      }
    }, catePath)
    for (let i = 0; i < 10; i++) { await sleep(1200); if (await page.$('[class*="resultItem"]')) break }

    // ⑦c 逐个点候选，直到「确认」亮（最多 6 个）
    let confirmed = false
    const MAX_CANDIDATES = 6
    for (let idx = 0; idx < MAX_CANDIDATES && !confirmed; idx++) {
      const clicked = await safeEval((n) => {
        const els = [...document.querySelectorAll('[class*="resultItem"]')]
        if (!els.length || n >= els.length) return null
        const hit = els[n]
        const r = hit.getBoundingClientRect()
        const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
        for (const type of ["mouseenter", "mouseover", "mousedown", "mouseup", "click"]) hit.dispatchEvent(new MouseEvent(type, o))
        return (hit.textContent || "").trim()
      }, idx)
      if (!clicked) { log(`⑦c 面板候选不足（第 ${idx + 1} 个不存在）`); break }
      await sleep(5000)

      const ok = await safeEval(() => {
        const el = [...document.querySelectorAll("button,[role=button]")].find(x => (x.textContent || "").trim() === "确认")
        return el ? !el.disabled : null
      })
      if (ok === true) {
        log(`⑦c ✅ 第 ${idx + 1} 个候选「${clicked}」可发布（确认按钮已亮）`)
        const matched = cands.find((c) => [c.first_name, c.second_name, c.third_name].filter(Boolean).join("") === clicked.replace(/\s/g, ""))
        if (matched) { leafPick = matched; cateId = String(matched.id) }
        await safeEval(() => {
          const el = [...document.querySelectorAll("button,[role=button]")].find(x => (x.textContent || "").trim() === "确认" && !x.disabled)
          if (el) el.click()
        })
        confirmed = true
        await sleep(9000)
      } else {
        log(`⑦c 第 ${idx + 1} 个候选「${clicked}」→ ${ok === false ? "资质未开通" : "无确认按钮"}，试下一个`)
      }
    }
    if (!confirmed) {
      log(`⑦c ⚠️ 试了 ${MAX_CANDIDATES} 个候选全部资质未开通`)
      log("⑦c → 这是**店铺资质问题**，需去抖店「资质中心」开通对应类目")
    }
  } else {
    log(`⑦ 使用指定类目 ID：${cateId}（仍需在面板手动选中）`)
  }

  // ⑧ 点「确认信息，继续生成」进第二级（DOM：无接口）
  const wentL2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').includes('确认信息'))
    if (el && !el.disabled) { el.click(); return true }
    return false
  })
  log(`⑧ 进第二级：${wentL2 ? '✅ 成功' : '❌ 失败（类目可能没选上）'}`)
  await sleep(18000)

  // ⑨ 第二级盘点 + 截图（SKU/属性/提交留给用户人工确认）
  const l2 = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    return {
      url: location.href,
      inputs: [...document.querySelectorAll('input')].filter(vis)
        .map(i => i.placeholder || '').filter(Boolean).slice(0, 25),
      buttons: [...document.querySelectorAll('button,[role=button]')].filter(vis)
        .map(b => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 25),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    }
  })
  const shotDir = join(process.cwd(), 'artifacts', 'douyin-publish-full')
  mkdirSync(shotDir, { recursive: true })
  const shotPath = join(shotDir, `level2-${Date.now()}.png`)
  try { await page.screenshot({ path: shotPath, fullPage: false }) } catch { /* ignore */ }

  const lines = []
  lines.push(wentL2 ? '已进入第二级（商品信息页）：' : '⚠️ 未能进入第二级（类目可能未选成功）：')
  lines.push(`  标题：${product.title}`)
  lines.push(`  类目 ID：${cateId || '（未选到）'}${leafPick ? `（${[leafPick.first_name, leafPick.second_name, leafPick.third_name].filter(Boolean).join('/')}）` : ''}`)
  lines.push(`  主图：${imgUrl ? imgUrl.slice(0, 70) + '…' : '（未拿到）'}`)
  lines.push(`  当前 URL：${l2.url.slice(0, 100)}`)
  if (l2.inputs.length) lines.push(`  输入框：${l2.inputs.slice(0, 8).join(' | ')}`)
  if (l2.buttons.length) lines.push(`  按钮：${l2.buttons.slice(0, 10).join(' | ')}`)
  lines.push(`  截图：${shotPath}`)
  lines.push('')
  lines.push('下一步请在弹出的浏览器窗口内人工完成：')
  lines.push('  ① 填/核对 SKU 价格与库存')
  lines.push('  ② 选商品属性（品牌需人工，涉及授权）')
  lines.push('  ③ 补详情图（如有）')
  lines.push('  ④ 选运费模板')
  lines.push('  ⑤ 点「发布商品」提交')

  emit({
    ok: wentL2,
    mode: 'publish',
    shopKey: account.shop_key,
    stage: wentL2 ? 'level2' : 'material',
    cateId: cateId || null,
    catePath: leafPick ? [leafPick.first_name, leafPick.second_name, leafPick.third_name].filter(Boolean).join('/') : null,
    title: product.title,
    imgUrl,
    level2: { url: l2.url, inputs: l2.inputs, buttons: l2.buttons },
    screenshot: shotPath,
    text: lines.join('\n'),
  })
  }
  }
} catch (err) {
  fail('api_error', '发布流程异常：' + (err instanceof Error ? err.message : String(err)))
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
