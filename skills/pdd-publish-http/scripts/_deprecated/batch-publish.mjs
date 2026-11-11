/**
 * C: 批量上架（多个商品顺序处理）
 * 用法：node batch-publish.mjs --dir <目录> [--confirm] [--no-submit]
 *
 * 目录下的每个子目录含 product.json，逐个调用 publish-v2 流程
 */
// ★ 2026-11-05：页面 URL 从基座注册表取
const { pageUrl: _purl } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-api.mjs')
const GOODS_ADD_URL = _purl('page.goodsAdd')
const GOODS_LIST_URL = _purl('page.goodsList')
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const S = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts'
const { openPublishEntry, waitForPublishPage, selectCategory } = await import(`file:///${S}/stage-nav.mjs`)
const { publishFlow } = await import(`file:///${S}/publish-flow.mjs`)
const { submitAndVerify } = await import(`file:///${S}/stage-submit.mjs`)
const { findTemplate, saveTemplate } = await import(`file:///${S}/category-template.mjs`)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a)

// ── 参数 ──
function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const dir = arg('dir', '')
const shopKey = arg('account', '')

// ★ 2026-11-04 修（P0）：原来这里是 `arg('account', 'pdd_mms_c09a0b4f80ef6a8524cd0f23d53f40f4')`
//   —— 硬编码了一个具体账号做兜底。不传 --account 时，**批量上架会直接打进别人的店铺**。
//   这与知识库《拼多多风控代码实现缺陷与修复清单》里记录的
//   「Profile 兜底硬编码落到别人账号」是同一类缺陷，只是这次在 shopKey 这一层。
//   现在改为必填：不传就报错退出，绝不做兜底。
if (!shopKey) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify({
    ok: false,
    failureKind: 'api_error',
    text: '缺少 --account（shopKey）。批量上架必须在参数里显式指定账号，不做默认兜底（防误发到别人店铺）。',
  }))
  process.exit(2)
}
const noSubmit = process.argv.includes('--no-submit')
const doConfirm = process.argv.includes('--confirm')

if (!dir || !fs.existsSync(dir)) {
  console.error('用法: node batch-publish.mjs --dir <目录> [--confirm] [--no-submit]')
  process.exit(1)
}

const PROFILE = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)

// ── 找所有 product.json ──
const products = []
for (const sub of fs.readdirSync(dir)) {
  const p = path.join(dir, sub, 'product.json')
  if (fs.existsSync(p)) products.push({ name: sub, file: p })
}
if (!products.length) {
  console.error('目录下没有 product.json')
  process.exit(1)
}

log(`批量上架：${products.length} 个商品`)
log(`模式：${noSubmit ? '仅填表（不提交）' : doConfirm ? '真实提交' : '预览'}`)

const results = []

// ══════ 风控闸门（2026-11-04 接入）══════
// 批量上架是**全平台最容易触发风控的动作**：同一账号在几十分钟内连续提交 N 个商品，
// 而 /glide/ /vodka/ 恰好是签名门禁最严的两个域。
// 这里做三件事：
//   ① 开批次前过闸门（冷却中/被占用 → 整批拒绝，不要开始）
//   ② 批次内每个商品之间强制间隔（默认 45s，可用 --gap 调；低于 20s 会被抬到 20s）
//   ③ 收尾放锁 + 打印整批风控汇总
// S = <plugin>/skills/pdd-publish-http/scripts
// → 上两级才是 <plugin>/skills，再进 _shared
const { openTask } = await import(`file:///${S}/../../_shared/pdd-guard.mjs`)
const batchGuard = await openTask('pdd-publish-http:batch', shopKey)
if (batchGuard.blocked) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify({
    ok: false, failureKind: 'rate_limit', shopKey,
    text: `已跳过整批：风控闸门拒绝执行。\n原因：${batchGuard.reason}\n\n批量上架前必须先让账号冷却结束——此时开批大概率中途被封，整批白跑。`,
  }))
  process.exit(0)
}
batchGuard.startHeartbeat()

// 商品间隔：默认 45s。批量上架不是"越快越好"，40~60s 是实测不触发频控的安全区。
const GAP_MS = Math.max(20_000, Number(arg('gap', '45')) * 1000)
log(`风控间隔：每个商品之间 ${(GAP_MS / 1000).toFixed(0)}s（--gap 可调，下限 20s）`)

// ★ 2026-11-01 提速：整个批次只启动一次浏览器
//   原来每个商品 launch + close（8-10s/次），100 个白费 15 分钟
log('启动浏览器（整批复用）…')
const sharedBrowser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 3600000,
})
log('浏览器已就绪')

for (let idx = 0; idx < products.length; idx++) {
  const item = products[idx]

  // ★ 2026-11-04：批次内强制间隔（第 2 个商品起生效）。
  //   不间隔连续提交 = 主动告诉平台"这是脚本"，是批量上架被封的主因。
  if (idx > 0) {
    log(`\n[风控间隔] 等待 ${(GAP_MS / 1000).toFixed(0)}s 后处理下一个商品…`)
    await sleep(GAP_MS)
    // 每批间隔后再确认一次账号没在这期间被风控（比如上一个商品触发了 54001）
    const recheck = await batchGuard.beforeCall(GOODS_ADD_URL)
    if (!recheck.allow) {
      log(`[风控间隔] 账号已不可用（${recheck.reason}），提前中止本批。`)
      results.push({ name: item.name, ok: false, skipped: true, reason: recheck.reason })
      break
    }
  }

  log(`\n${'='.repeat(70)}`)
  log(`[${idx + 1}/${products.length}] ${item.name}`)
  log('='.repeat(70))

  const product = JSON.parse(fs.readFileSync(item.file, 'utf8'))
  log(`标题: ${product.title}`)
  log(`规格: ${(product.specs || []).map(s => `${s.name}(${s.values?.length || 0})`).join(' × ')}`)
  log(`SKU: ${(product.skus || []).length} 行`)

  // 检查模板
  const catKey = String(product.category || '').trim()
  const tpl = catKey ? findTemplate(catKey) : null
  if (tpl) {
    log(`模板命中「${catKey}」：${tpl.dims?.length || 0} 维 / ${tpl.requiredAttrs?.length || 0} 属性`)
  } else {
    log(`无模板，首次探测`)
  }

  const t0 = Date.now()
  let work = null
  try {
    // ★ 复用共享浏览器，每个商品开新页面
    const page = await sharedBrowser.newPage()
    await page.setViewport({ width: 1600, height: 900 })

    await openPublishEntry(page, { log })
    work = await waitForPublishPage(sharedBrowser, { log })
    work = await selectCategory(work, catKey, { log, catId: tpl?.catId || '' })

    // ★ 2026-11-01：上传前图片预处理（单张 ≤ 3MB）
    {
      try {
        const { prepareImages } = await import(`file:///${S}/img-prep.mjs`)
        const MAX = 3 * 1024 * 1024
        const m = await prepareImages(product.images || [], { maxBytes: MAX, log })
        const d = await prepareImages(product.detailImages || [], { maxBytes: MAX, log })
        product.images = m.files
        product.detailImages = d.files
        const c = m.stats.compressed + d.stats.compressed
        if (c) log(`  图片预处理 → 压缩 ${c} 张`)
      } catch (e) {
        log(`  ⚠ 图片预处理异常（跳过）：${e.message.slice(0, 80)}`)
      }
    }

    const flowResult = await publishFlow(work, product, {
      log,
      templateAttrs: tpl?.requiredAttrs || [],
    })

    let submitResult = { ok: false, note: 'no-submit 模式' }
    if (!noSubmit && doConfirm) {
      log('点提交…')
      submitResult = await submitAndVerify(work, { log, timeoutMs: 30000, productTitle: product.title })
    }

    const cost = Math.round((Date.now() - t0) / 1000)

    // 沉淀模板
    if (submitResult.ok || noSubmit) {
      try {
        const { scanDims, alignDims } = await import(`file:///${S}/spec-dims.mjs`)
        const scanResult = await scanDims(work).catch(() => ({ dims: [] }))
        const pageDims = Array.isArray(scanResult) ? scanResult : (scanResult?.dims || [])
        const dims = alignDims(pageDims, product.specs || [])
        const catId = (String(work.url()).match(/[?&]id=(\d+)/) || [])[1] || ''
        const ATTR_EXCLUDE = /^(标题|参考价|类目|主图|详情图|SKU|发货|运费|库存|拼单价|单买价|第\d+行|服务承诺)/
        const attrs = (flowResult.filled || [])
          .filter(s => /^[^=]+=/.test(s) && !ATTR_EXCLUDE.test(s))
          .map(s => ({ name: s.slice(0, s.indexOf('=')).trim(), value: s.slice(s.indexOf('=') + 1).trim() }))
          .filter(a => a.name && a.value && a.name.length <= 20)
        const seen = new Set()
        const uniq = attrs.filter(a => { const k = a.name + '=' + a.value; if (seen.has(k)) return false; seen.add(k); return true })
        saveTemplate(catKey, {
          catId, catePath: '', dims, requiredAttrs: uniq,
          price: product.price || '', stock: product.stock || '',
          goodsId: submitResult.goodsId || '',
        })
        log(`模板已沉淀`)
      } catch { /* ignore */ }
    }

    results.push({
      name: item.name,
      ok: submitResult.ok || noSubmit,
      goodsId: submitResult.goodsId || '',
      cost,
      filled: flowResult.filled?.length || 0,
      missed: flowResult.missed?.length || 0,
      note: submitResult.note || '',
    })
  } catch (e) {
    log(`❌ 失败: ${e.message.slice(0, 150)}`)
    results.push({ name: item.name, ok: false, err: e.message.slice(0, 200) })
  } finally {
    // ★ 只关页面，浏览器整批复用
    try {
      if (work && !work.isClosed()) await work.close()
    } catch { /* ignore */ }
    await sleep(1500)
  }
}

// ★ 批次结束，关闭共享浏览器
try { await sharedBrowser.close() } catch { /* ignore */ }
const fsx = await import('node:fs')
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fsx.unlinkSync(path.join(PROFILE, f)) } catch { /* ignore */ }
}

log(`\n${'='.repeat(70)}`)
log('批量上架汇总')
log('='.repeat(70))
for (const r of results) {
  if (!r.ok) {
    log(`❌ ${r.name}: ${r.err || r.note}`)
  } else {
    log(`✅ ${r.name}: ${r.goodsId ? `goods_id=${r.goodsId}` : '(未提交)'} | ${r.cost}s | 已填 ${r.filled} 项`)
  }
}

const okCount = results.filter(r => r.ok).length
log(`\n成功 ${okCount}/${results.length}`)

// ★ 风控闸门收尾（紧跟汇总，确保异常路径也放锁）
try { await batchGuard.close() } catch { /* ignore */ }

fs.writeFileSync(path.join(dir, 'batch-results.json'), JSON.stringify(results, null, 2), 'utf8')
log(`结果已存 ${path.join(dir, 'batch-results.json')}`)
process.exit(okCount === results.length ? 0 : 1)
