/**
 * C: 批量上架（多个商品顺序处理）
 * 用法：node batch-publish.mjs --dir <目录> [--confirm] [--no-submit]
 *
 * 目录下的每个子目录含 product.json，逐个调用 publish-v2 流程
 */
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
const shopKey = arg('account', 'pdd_mms_c09a0b4f80ef6a8524cd0f23d53f40f4')
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

// ★ 2026-11-02：批次开始前做一次登录预检
//   否则登录失效时 200 个商品会一个个失败（每个浪费 30 秒 = 100 分钟）
{
  log('登录预检…')
  const checkPage = await sharedBrowser.newPage()
  try {
    await checkPage.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 40000 })
    await sleep(5000)
    const st = await checkPage.evaluate(() => {
      const txt = document.body?.innerText || ''
      const url = location.href
      const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
      const btns = [...document.querySelectorAll('button, a, div, span')]
        .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
      return {
        url,
        isLogin: /\/login\//.test(url) || /扫码登录|账号登录/.test(txt.slice(0, 300)),
        hasBtn: btns.length > 0,
        textLen: txt.trim().length,
      }
    }).catch(() => null)

    if (!st) {
      log('  ⚠ 登录预检失败（页面不可读），继续尝试')
    } else if (st.isLogin) {
      log('  ❌ 登录已失效！请在浏览器窗口内扫码登录后重跑')
      log(`     当前页面：${st.url.slice(0, 80)}`)
      try { await sharedBrowser.close() } catch { /* ignore */ }
      process.exit(2)
    } else if (!st.hasBtn) {
      log('  ⚠ 未找到「发布新商品」按钮（可能页面未加载完），继续尝试')
    } else {
      log('  ✅ 登录有效，开始批量')
    }
  } catch (e) {
    log(`  ⚠ 登录预检异常：${e.message.slice(0, 80)}（继续尝试）`)
  } finally {
    try { await checkPage.close() } catch { /* ignore */ }
  }
}

for (let idx = 0; idx < products.length; idx++) {
  const item = products[idx]
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
  let ownPages = []
  try {
    // ★ 2026-11-01：页面隔离 —— 记录开始时已有的标签页，之后只认新增的
    //   否则 waitForPublishPage 会命中上一个商品残留的 goods_add 页面
    const beforePages = new Set(await sharedBrowser.pages())

    const page = await sharedBrowser.newPage()
    ownPages.push(page)
    await page.setViewport({ width: 1600, height: 900 })

    await openPublishEntry(page, { log })

    // 只在新出现的页面里找发布页
    // ★ 2026-11-02：改成「快速失败」—— 每轮同时检测明确的失败信号，不必傻等 45 秒
    work = await (async () => {
      const startAt = Date.now()
      const HARD_TIMEOUT = 30000      // 硬上限 30s（正常 10-15s 就出来）
      const FAST_FAIL_AFTER = 5000    // 5 秒后开始检测失败信号

      let blankStreak = 0
      while (Date.now() - startAt < HARD_TIMEOUT) {
        const elapsed = Date.now() - startAt

        // ① 新标签页里找发布页
        const pages = await sharedBrowser.pages()
        const fresh = pages.filter(p => !beforePages.has(p))
        const hit = fresh.find(p => /goods\/(category|goods_add)/.test(String(p.url() || '')))
        if (hit) {
          await hit.bringToFront()
          await sleep(1500)
          if (!ownPages.includes(hit)) ownPages.push(hit)
          return hit
        }

        // ② 5 秒后开始快速失败检测（只查当前 page，不新建）
        if (elapsed > FAST_FAIL_AFTER) {
          const probe = await page.evaluate(() => {
            const txt = document.body?.innerText || ''
            const url = location.href
            return {
              url,
              isLoginPage: /\/login\//.test(url) || /扫码登录|账号登录/.test(txt.slice(0, 300)),
              isBlank: txt.trim().length < 20,
              hasBlockingDialog: /请先完成|请先完善|无权访问|操作频繁|系统繁忙|账号异常|请重新登录/.test(txt),
              hasError: /加载失败|出错了|网络异常/.test(txt),
              textLen: txt.trim().length,
            }
          }).catch(() => null)

          if (probe) {
            if (probe.isLoginPage) {
              throw new Error(`登录已失效（页面跳到 ${probe.url.slice(0, 60)}），请重新登录`)
            }
            if (probe.hasBlockingDialog) {
              const m = (await page.evaluate(() => (document.body?.innerText || '').match(/(请先完成[^\n]{0,30}|请先完善[^\n]{0,30}|无权访问|操作频繁|系统繁忙|账号异常|请重新登录)/)).catch(() => null))
              throw new Error(`页面拦截：${m?.[1] || '出现阻断提示'}`)
            }
            if (probe.hasError) {
              throw new Error('页面加载失败')
            }
            // 白屏连续 5 次（约 2.5s）判定失败
            if (probe.isBlank) {
              blankStreak++
              if (blankStreak >= 5) throw new Error('页面持续白屏')
            } else {
              blankStreak = 0
            }
          }
        }

        await sleep(500)
      }
      throw new Error(`类目页/表单页 ${Math.round((Date.now() - startAt) / 1000)}s 内未出现`)
    })()
    await sleep(1000)

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
      submitResult = await submitAndVerify(work, { log, timeoutMs: 45000, productTitle: product.title })
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
    // ★ 只关本商品的页面，浏览器整批复用
    //   注意：要关掉所有属于这个商品的页面（openPublishEntry 可能开了新标签页）
    for (const pg of ownPages) {
      try { if (!pg.isClosed()) await pg.close() } catch { /* ignore */ }
    }
    // 兜底：关掉任何还没关的、不在白名单里的页面
    try {
      const pages = await sharedBrowser.pages()
      for (const pg of pages) {
        const url = String(pg.url() || '')
        if (/goods\/(category|goods_add)/.test(url)) {
          await pg.close().catch(() => {})
        }
      }
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
fs.writeFileSync(path.join(dir, 'batch-results.json'), JSON.stringify(results, null, 2), 'utf8')
log(`结果已存 ${path.join(dir, 'batch-results.json')}`)
process.exit(okCount === results.length ? 0 : 1)
