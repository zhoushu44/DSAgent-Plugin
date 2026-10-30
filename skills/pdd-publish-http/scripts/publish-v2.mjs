#!/usr/bin/env node
/**
 * 拼多多上架 · 组件化入口（v2）
 *
 * 全流程纯组件链，不经过 lib/pdd-publish.js 的段3/段4：
 *
 *   段1 stage-nav.openPublishEntry     打开商品列表 → 点「发布新商品」
 *   段2 stage-nav.selectCategory       搜索类目 → 等稳定 → 选中 → 确认
 *   段3 publish-flow（标题/参考价/主图/详情图）
 *   段4 publish-flow（规格 → 价格库存 → 属性 → 发货）
 *   段5 stage-submit.submitAndVerify   点提交 → 判定结果
 *
 * 为什么单独做 v2：
 *   lib 的 domFillSpecs 分支会先填属性+发货，再调外部函数，
 *   与组件链的段3/段4 重复，导致慢（358s）且预览图偶发失败。
 *   v2 只走组件链，实测 120s 成功（goods_id=1022682668973）。
 *
 * 用法：
 *   node publish-v2.mjs --product-file <path> --account <shopKey> [--confirm true]
 *   node publish-v2.mjs --from-pack <packDir> --gen <aiDir> [--category 儿童睡衣] --confirm true
 *
 * ★ L2 门禁：不带 --confirm true 只做校验和预览，不启浏览器、零写操作。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const require = createRequire(path.join(PLUGIN_ROOT, 'package.json'))

const sleep = ms => new Promise(r => setTimeout(r, ms))
const emit = (obj) => process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n')
const log = (...a) => console.log('[' + new Date().toTimeString().slice(0, 8) + ']', ...a)

/** 参数解析（支持 --key value / --key=value / --flag） */
function parseArgs(argv) {
  const out = { flags: new Set(), vals: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq > 2) {
      // --key=value
      out.vals[a.slice(2, eq)] = a.slice(eq + 1)
      continue
    }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out.flags.add(key)
    } else {
      out.vals[key] = next
      i++
    }
  }
  return out
}
const A = parseArgs(process.argv.slice(2))
const argOf = (k) => A.vals[k]
const hasFlag = (k) => A.flags.has(k)

const productFile = argOf('product-file')
const productStr = argOf('product')
const fromPack = argOf('from-pack')
const genDir = argOf('gen')
const categoryKw = argOf('category') || '儿童睡衣'
const priceFactor = parseFloat(argOf('price-factor') || '2')
const maxColors = parseInt(argOf('max-colors') || '3', 10)
const maxSizes = parseInt(argOf('max-sizes') || '3', 10)
const account = argOf('account') || ''
// ★ confirm 判定：`--confirm true` 会把 'true' 存进 vals（不是 flags），
//   所以三个条件都要认：flags 里有 confirm / vals.confirm 是 true / vals.confirm 是 'true'
const confirmRaw = A.vals.confirm
const confirm = (A.flags.has('confirm') && confirmRaw !== 'false')
  || confirmRaw === 'true' || confirmRaw === true

// ─── 读取/组装商品数据 ───
let product = null
try {
  if (productFile) {
    product = JSON.parse(fs.readFileSync(productFile, 'utf8'))
  } else if (productStr) {
    product = JSON.parse(productStr)
  } else if (fromPack) {
    // 复用 publish.mjs 里的组装函数
    const mod = await import('./publish.mjs').catch(() => null)
    // publish.mjs 是脚本不是模块，直接用 build_product.py
    const { execFileSync } = await import('node:child_process')
    const tmpOut = path.join(path.dirname(genDir || fromPack), 'product-v2.json')
    const pyExe = process.env.PYTHON || 'python'
    execFileSync(pyExe, [
      path.join(PLUGIN_ROOT, 'skills', 'image-gen', 'scripts', 'build_product.py'),
      '--pack', fromPack, '--gen', genDir, '--out', tmpOut,
      '--category', categoryKw, '--price-factor', String(priceFactor),
      '--max-colors', String(maxColors), '--max-sizes', String(maxSizes),
    ], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    product = JSON.parse(fs.readFileSync(tmpOut, 'utf8'))
  } else {
    emit({ ok: false, failureKind: 'api_error', text: '缺少 --product-file / --product / --from-pack' })
    process.exit(2)
  }
} catch (e) {
  emit({ ok: false, failureKind: 'api_error', text: `读取商品数据失败：${e.message}` })
  process.exit(2)
}

// ─── 校验 ───
const problems = []
if (!product.title || String(product.title).trim().length < 2) problems.push('标题缺失')
if (!Array.isArray(product.images) || !product.images.length) problems.push('主图缺失')
if (problems.length) {
  emit({ ok: false, failureKind: 'api_error', text: `商品数据校验未通过：${problems.join('、')}` })
  process.exit(2)
}

// ─── 预览模式（不带 --confirm true）───
if (!confirm) {
  const lines = [
    '【拼多多上架预览 · 组件化 v2 · 需用户确认】',
    `标题：${product.title}`,
    `类目：${product.category || categoryKw}`,
    `主图：${product.images.length} 张`,
    `详情图：${(product.detailImages || []).length} 张`,
    `规格维度：${(product.specs || []).map(d => `${d.name}（${d.values.length} 个值：${d.values.map(v => (v && typeof v === 'object') ? v.value : v).join('/')}）`).join('；') || '无'}`,
    `SKU 组合：${(product.skus || []).length} 行`,
    `参考价：${product.price || '（未填）'}`,
    `属性：${(product.attributes || []).length} 条`,
    '',
    '执行链路：段1 打开列表 → 段2 选类目 → 段3 标题/主图/详情 → 段4 规格/价格/属性/发货 → 段5 提交',
    '确认无误后请带 --confirm true 重新调用。注意：发布是不可撤销的真实操作（L2）。',
  ]
  emit({ ok: false, needConfirm: true, text: lines.join('\n') })
  process.exit(0)
}

// ─── 真正上架 ───
const puppeteer = require('puppeteer-core')
const { openPublishEntry, waitForPublishPage, selectCategory } = await import('./stage-nav.mjs')
const { publishFlow } = await import('./publish-flow.mjs')
const { submitAndVerify } = await import('./stage-submit.mjs')
const { findTemplate, saveTemplate } = await import('./category-template.mjs')

const shopKey = account
if (!shopKey) {
  emit({ ok: false, failureKind: 'api_error', text: '缺少 --account（shopKey）' })
  process.exit(2)
}

// ══════ 类目模板：上架前读取，用于预填属性 ══════
const catKey = String(product.category || categoryKw || '').trim()
let tpl = null
try {
  tpl = findTemplate(catKey)
  if (tpl) {
    log(`[template] 命中类目模板「${catKey}」：已成功 ${tpl.successCount || 0} 次，`
      + `属性 ${(tpl.requiredAttrs || []).length} 条，规格 ${(tpl.dims || []).length} 维`)
  } else {
    log(`[template] 无「${catKey}」模板，本次从头探测（成功后自动沉淀）`)
  }
} catch (e) {
  log(`[template] 读取失败（忽略）：${e.message}`)
}

// 用模板属性补全商品属性：商品里没给的、模板里有的 → 用模板值
// （商品自带属性优先，模板只补空缺 —— 避免覆盖本次真实数据）
if (tpl?.requiredAttrs?.length) {
  const norm = s => String(s || '').replace(/\s+/g, '')
  const have = new Set((product.attributes || []).map(a => norm(a.name)))
  const added = []
  for (const a of tpl.requiredAttrs) {
    const n = norm(a?.name)
    if (!n || have.has(n)) continue
    // 跳过「商品货号」这类一物一码的字段（模板值对本次无意义）
    if (/货号|商品编码|规格编码|商家编码/.test(n)) continue
    product.attributes = product.attributes || []
    product.attributes.push({ name: a.name, value: a.value })
    added.push(a.name)
    have.add(n)
  }
  if (added.length) log(`[template] 从模板补全 ${added.length} 条属性：${added.join('、')}`)
}

// 用模板价格兜底（商品没给 price 时才用）
if (!product.price && tpl?.price) {
  product.price = String(tpl.price)
  log(`[template] 用模板价格兜底：${product.price}`)
}

const PROFILE = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
const t0 = Date.now()
let browser = null

try {
  browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    userDataDir: PROFILE,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    ignoreDefaultArgs: ['--enable-automation'],
    protocolTimeout: 3600000,
  })

  const page = (await browser.pages())[0] || await browser.newPage()

  // 段1
  await openPublishEntry(page, { log })
  // 段2
  let work = await waitForPublishPage(browser, { log })
  work = await selectCategory(work, product.category || categoryKw, { log })

  // 段3 + 段4
  const flowResult = await publishFlow(work, product, { log })

  // 段5
  const submitResult = await submitAndVerify(work, { log, timeoutMs: 30000 })

  const cost = Math.round((Date.now() - t0) / 1000)

  if (submitResult.ok) {
    // ══════ 成功 → 沉淀类目模板（下次同目录直接复用属性） ══════
    try {
      const dims = (product.specs || []).map(d => ({
        user: d.name,
        page: d.name,          // 首次记录时页面维度名等同上架成功后的定名
        type: '',              // 由下次实际填写时补全
      }))
      // 只沉淀「实际上架成功的属性」——从 filled 里解析出 名称=值 的项
      const attrFromFilled = flowResult.filled
        .filter(s => /^[^=]+=/.test(s) && !/^(标题|参考价|类目|主图|详情图|SKU|发货方式|发货时间|运费模板|库存|拼单价|单买价)/.test(s))
        .map(s => {
          const i = s.indexOf('=')
          return { name: s.slice(0, i).replace(/（.*?）$/, '').trim(), value: s.slice(i + 1).trim() }
        })
        .filter(a => a.name && a.value && a.name.length <= 20)

      saveTemplate(catKey, {
        catId: (submitResult.url.match(/[?&]id=(\d+)/) || [])[1] || tpl?.catId || '',
        catePath: tpl?.catePath || '',
        dims,
        requiredAttrs: attrFromFilled,
        price: product.price || '',
        stock: product.stock || '',
        goodsId: submitResult.goodsId,
      })
      log(`[template] 已沉淀「${catKey}」：属性 ${attrFromFilled.length} 条`)
    } catch (e) {
      log(`[template] 沉淀失败（不影响上架）：${e.message}`)
    }

    emit({
      ok: true,
      shopKey,
      goodsId: submitResult.goodsId,
      finalUrl: submitResult.url,
      costSeconds: cost,
      text: [
        '拼多多商品发布已提交成功（组件化 v2）。',
        `账号：${shopKey}`,
        `商品 ID：${submitResult.goodsId}`,
        `耗时：${cost} 秒`,
        `标题：${product.title}`,
        `已填：${flowResult.filled.join('、') || '（无）'}`,
        `未填（需人工确认）：${flowResult.missed.join('、') || '（无）'}`,
        '',
        '注意：平台仍会审核，最终状态请在商家后台「商品管理 → 出售中」确认。',
      ].join('\n'),
    })
  } else {
    emit({
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl: submitResult.url,
      costSeconds: cost,
      filled: flowResult.filled,
      missed: flowResult.missed,
      errors: submitResult.errors,
      text: [
        '提交未成功。',
        `耗时：${cost} 秒`,
        `已填：${flowResult.filled.join('、') || '（无）'}`,
        `未填：${flowResult.missed.join('、') || '（无）'}`,
        `错误：${(submitResult.errors || []).join('、') || '（未捕获）'}`,
        submitResult.panelText ? `填写建议：${submitResult.panelText}` : '',
      ].filter(Boolean).join('\n'),
    })
  }
} catch (e) {
  emit({
    ok: false,
    failureKind: 'api_error',
    shopKey,
    costSeconds: Math.round((Date.now() - t0) / 1000),
    text: `组件链执行异常：${e.message}`,
    stack: String(e.stack || '').slice(0, 800),
  })
} finally {
  // 不自动关浏览器：方便人工核对
  if (browser) {
    log('浏览器保留，供人工核对（不自动关闭）')
  }
}
