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
// ★ 2026-10-30：--no-submit = 只填到提交前，不点发布（供人工核对）
const noSubmit = A.flags.has('no-submit') || argOf('no-submit') === 'true'

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

// ★ 2026-11-01：标题长度预校验（拼多多限 30 汉字 / 60 字符）
//   实测踩过：50 字标题 + 后缀 → 31 汉字 → 超限 → 提交才报错 → 批量白跑
//   注意：拼多多的「60 字符」= 30 个汉字（汉字算 2 字符），所以两个都要查。
{
  const t = String(product.title || '').trim()
  const hanziCount = (t.match(/[\u4e00-\u9fa5]/g) || []).length
  const asPddLen = hanziCount * 2 + (t.length - hanziCount)   // 汉字算 2
  if (hanziCount > 30) {
    problems.push(`标题汉字超限（${hanziCount} 个汉字，上限 30）`)
  } else if (asPddLen > 60) {
    problems.push(`标题超长（按拼多多算法 ${asPddLen} 字符，上限 60）`)
  }
}

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
const { findTemplate, saveTemplate, templateAttrs: getTplAttrs } = await import('./category-template-v2.mjs')
// ★ 启动时把老模板升级到 v2（幂等）
try {
  const { upgradeTemplates } = await import('./category-template-v2.mjs')
  const n = upgradeTemplates()
  if (n > 0) log(`[template] 已升级 ${n} 个模板到 v2`)
} catch { /* ignore */ }

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
      + `属性 ${getTplAttrs(tpl).length} 条，规格 ${(tpl.dims || []).length} 维`)
  } else {
    log(`[template] 无「${catKey}」模板，本次从头探测（成功后自动沉淀）`)
  }
} catch (e) {
  log(`[template] 读取失败（忽略）：${e.message}`)
}

// 用模板属性补全商品属性：商品里没给的、模板里有的 → 用模板值
// （商品自带属性优先，模板只补空缺 —— 避免覆盖本次真实数据）
if (getTplAttrs(tpl).length) {
  const norm = s => String(s || '').replace(/\s+/g, '')
  const have = new Set((product.attributes || []).map(a => norm(a.name)))
  const added = []
  for (const a of getTplAttrs(tpl)) {
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
  // ★ 2026-10-30：优先连接**已打开的浏览器**（用户正在看的窗口），不新开
  //   这样用户能实时看到操作过程，不会出现「日志说做了但页面没变化」的错位。
  const portFile = path.join(PROFILE, 'DevToolsActivePort')
  let connected = false
  if (fs.existsSync(portFile)) {
    try {
      const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim()
      browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
      })
      connected = true
      log(`已连接现有浏览器（端口 ${port}），在当前页面继续`)
    } catch (e) {
      log(`连接现有浏览器失败：${e.message.slice(0, 60)}，改为新开`)
    }
  }
  if (!connected) {
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: false,
      userDataDir: PROFILE,
      defaultViewport: null,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
      ignoreDefaultArgs: ['--enable-automation'],
      protocolTimeout: 3600000,
    })
    log('新开浏览器窗口')
  }

  // 优先用「已打开的 goods_add 页面」；没有才新开
  let page = null
  if (connected) {
    const pages = await browser.pages()
    page = pages.find(p => /goods_add|goods_list/.test(String(p.url() || '')))
      || pages.find(p => /pinduoduo/.test(String(p.url() || '')))
      || pages[0]
    if (page) log('使用已打开页面: ' + String(page.url()).slice(0, 80))
  }
  if (!page) {
    page = (await browser.pages())[0] || await browser.newPage()
  }

  // ★ 2026-11-02 提速：模板有 catId 时**跳过段1**（打开商品列表 6 秒纯属浪费）
  //   直接 goto 直达 URL，省掉「打开列表 → 等加载 → 点发布新商品 → 等跳转」全流程
  const catIdDirect = String(tpl?.catId || '').trim()
  let work = null
  if (!connected && catIdDirect) {
    log(`段1+2：catId=${catIdDirect} 直达（跳过商品列表）`)
    const directUrl = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${catIdDirect}`
    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log(`  goto 警告：${e.message.slice(0, 60)}`))
    // 等表单页就绪
    let ready = false
    for (let w = 0; w < 40; w++) {
      await sleep(300)
      ready = await page.evaluate(() => {
        // 判据：出现类目属性区或标题输入框
        const hasProp = document.querySelectorAll('[id^="basic.propertys."]').length > 0
        const hasTitle = !!document.querySelector('input[placeholder*="标题"]')
        const hasCategory = !!document.querySelector('#goods-category')
        return hasProp || (hasTitle && hasCategory)
      }).catch(() => false)
      if (ready) break
    }
    if (ready) {
      log(`  直达页已就绪（${catIdDirect}）`)
      work = page
    } else {
      log('  ⚠ 直达页未就绪，回退到常规流程')
    }
  }

  if (!work) {
    // 段1
    if (!connected) {
      await openPublishEntry(page, { log })
    } else {
      log('连接模式：跳过段1 导航，直接使用当前页面')
    }
    // 段2（★ 老类目用 catId 直达，省 5s；连接模式下由 stage-nav 自动跳过直达）
    work = await waitForPublishPage(browser, { log })
    work = await selectCategory(work, product.category || categoryKw, { log, catId: tpl?.catId || '', connected })
  }

  // 段3 + 段4
  // ★ 2026-11-01：上传前图片预处理（拼多多主图/详情图单张 ≤ 3MB）
  //   AI 生成的 PNG 常在 3-4MB，直接传会被平台拒或让 lib 层报错退出。
  //   自动 PNG→JPEG(q92) 压缩，实测 3.5MB → 0.37MB（-89%），画质几乎无损。
  {
    try {
      const { prepareImages } = await import('./img-prep.mjs')
      const MAX = 3 * 1024 * 1024
      const before = (product.images || []).length + (product.detailImages || []).length

      const mainRes = await prepareImages(product.images || [], { maxBytes: MAX, log })
      const detailRes = await prepareImages(product.detailImages || [], { maxBytes: MAX, log })

      product.images = mainRes.files
      product.detailImages = detailRes.files

      const compressed = mainRes.stats.compressed + detailRes.stats.compressed
      const failed = mainRes.stats.failed + detailRes.stats.failed
      if (compressed) log(`  图片预处理 → 压缩 ${compressed}/${before} 张（上限 3MB/张）`)
      if (failed) log(`  ⚠ 图片预处理 → ${failed} 张压缩失败（保留原图，可能被平台拒）`)
      if (!compressed && !failed) log(`  图片预处理 → ${before} 张均达标，无需压缩`)

      // 压缩失败且仍超限的，明确告警
      const stillOver = [...mainRes.detail, ...detailRes.detail]
        .filter(d => d.ok === false || (d.bytes && d.bytes > MAX))
      if (stillOver.length) {
        log(`  ⚠ 仍有 ${stillOver.length} 张超过 3MB，请手工处理：`)
        stillOver.slice(0, 5).forEach(d => log(`    - ${d.src}`))
      }
    } catch (e) {
      log(`  ⚠ 图片预处理异常（跳过）：${e.message.slice(0, 100)}`)
    }
  }

  const flowResult = await publishFlow(work, product, { log, templateAttrs: getTplAttrs(tpl) })

  // ★ 2026-10-30：--no-submit 模式 → 不点提交，保留页面供人工核对
  if (noSubmit) {
    const cost = Math.round((Date.now() - t0) / 1000)

    // ★ 2026-10-31：--no-submit 也沉淀模板（字段已填对，值得复用）
    //   否则第 2 次同类目还要从头探测（实测毛巾两次都从零开始）
    try {
      const { scanDims, alignDims } = await import('./spec-dims.mjs')
      // ★ scanDims 返回 { dims: [...] }，不是数组
      const scanResult = await scanDims(work).catch(() => ({ dims: [] }))
      const pageDims = Array.isArray(scanResult) ? scanResult : (scanResult?.dims || [])
      const dims = alignDims(pageDims, product.specs || [])
      const catePath = await work.evaluate(() => {
        const el = document.querySelector('#goods-category, [class*="categoryPath"], [class*="category-path"]')
        return el?.innerText?.replace(/\s+/g, ' ').trim() || ''
      }).catch(() => '')
      const catId = (String(work.url()).match(/[?&]id=(\d+)/) || [])[1] || ''

      const ATTR_EXCLUDE = /^(标题|参考价|类目|主图|详情图|SKU|发货方式|发货时间|运费模板|库存|拼单价|单买价|第\d+行|颜色|尺寸|容量|型号|款式|尺码|规格)/
      const attrFromFilled = (flowResult.filled || [])
        .filter(s => /^[^=]+=/.test(s) && !ATTR_EXCLUDE.test(s))
        .map(s => {
          const i = s.indexOf('=')
          return {
            name: s.slice(0, i).replace(/（.*?）$/, '').trim(),
            value: s.slice(i + 1).replace(/（.*?）$/, '').trim(),
          }
        })
        .filter(a => a.name && a.value && a.name.length <= 20 && a.value.length <= 40)
        .filter(a => !/^第\d+行/.test(a.name))

      // 去重（多轮会重复）
      const seen = new Set()
      const uniqAttrs = attrFromFilled.filter(a => {
        const k = a.name + '=' + a.value
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })

      // ★ 2026-11-02 v2：把扫描到的完整字段（含 options）+ 本次填的值合并保存
      //   这样第二次发布时可以直接从模板取「字段名 → 值 + 候选」，零扫描
      const scanned = flowResult.attrFields || []
      const filledMap = new Map(uniqAttrs.map(a => [a.name.replace(/\s+/g, ''), a.value]))
      const attrsForTpl = scanned.map(f => ({
        name: f.name,
        required: !!f.required,
        kind: f.kind || 'select',
        options: Array.isArray(f.options) ? f.options : [],
        value: filledMap.get(f.name.replace(/\s+/g, '')) || '',
      }))
      // 补上扫描里没有但确实填了的（兜底）
      for (const a of uniqAttrs) {
        const n = a.name.replace(/\s+/g, '')
        if (!attrsForTpl.some(x => x.name.replace(/\s+/g, '') === n)) {
          attrsForTpl.push({ name: a.name, required: false, kind: 'select', options: [], value: a.value })
        }
      }

      saveTemplate(catKey, {
        catId,
        catePath: catePath && catePath !== '商品分类' ? catePath : '',
        dims,
        attrs: attrsForTpl,
        price: product.price || '',
        stock: product.stock || '',
      })
      log(`[template] ✅ --no-submit 也沉淀模板「${catKey}」：catId=${catId || '?'} 维度 ${dims.length} 属性 ${uniqAttrs.length}`)
    } catch (e) {
      log(`[template] 沉淀失败（不影响填表）：${e.message.slice(0, 80)}`)
    }

    log('')
    log('════════════════════════════════════════')
    log('  ★ --no-submit 模式：已填完，未点提交')
    log('  页面保持打开，请在浏览器窗口内核对后手动点「提交并上架」')
    log('════════════════════════════════════════')
    emit({
      ok: true,
      noSubmit: true,
      shopKey,
      costSeconds: cost,
      filled: flowResult.filled,
      missed: flowResult.missed,
      text: [
        '【填表完成 · 未提交】',
        `耗时：${cost} 秒`,
        `已填 ${flowResult.filled.length} 项：`,
        ...flowResult.filled.map(f => '  · ' + f),
        '',
        `未填 ${flowResult.missed.length} 项：`,
        ...flowResult.missed.map(m => '  · ' + m),
        '',
        '页面已保留，请人工核对后手动点击「提交并上架」。',
      ].join('\n'),
    })
    // 保持进程存活，等人工核对（最多 30 分钟）
    log('浏览器保留 30 分钟供核对（Ctrl+C 可提前结束）')
    await sleep(30 * 60 * 1000)
    process.exit(0)
  }

  // 段5
  const submitResult = await submitAndVerify(work, { log, timeoutMs: 60000, productTitle: product.title || '' })

  const cost = Math.round((Date.now() - t0) / 1000)

  if (submitResult.ok) {
    // ══════ 成功 → 沉淀类目模板（采集页面真实结构，供下次复用） ══════
    try {
      // ★ 关键：上架成功后从**页面**采集真实维度结构，而不是用商品 JSON 的维度名
      //   这样模板里存的是「页面维度名 + 填写类型 + 类目路径 + catId」，
      //   下次同目录可以直接按模板填，不用重新探测。
      const { scanDims, alignDims } = await import('./spec-dims.mjs')
      const pageInfo = await scanDims(work).catch(() => ({ dims: [] }))
      const pageDims = pageInfo?.dims || []

      // 类目路径：从表单页 #goods-category 读回；catId 从 URL 的 id 参数取
      const catePath = await work.evaluate(() => {
        const el = document.querySelector('#goods-category')
        return (el?.innerText || '').replace(/\s+/g, ' ').trim()
      }).catch(() => '')
      const catId = (submitResult.url.match(/[?&]id=(\d+)/) || [])[1] || tpl?.catId || ''

      // 维度映射：优先页面对齐结果（含 type），拿不到才退回商品 JSON
      const dims = pageDims.length
        ? alignDims(pageDims, product.specs || [])
        : (product.specs || []).map(d => ({ user: d.name, page: d.name, type: '' }))

      // 只沉淀**真正的类目属性**（排除规格值/价格库存这类非属性项）
      const ATTR_EXCLUDE = /^(标题|参考价|类目|主图|详情图|SKU|发货方式|发货时间|运费模板|库存|拼单价|单买价|第\d+行|颜色|尺寸|容量|型号|款式|尺码|规格)/
      const attrFromFilled = flowResult.filled
        .filter(s => /^[^=]+=/.test(s) && !ATTR_EXCLUDE.test(s))
        .map(s => {
          const i = s.indexOf('=')
          const name = s.slice(0, i).replace(/（.*?）$/, '').trim()
          const value = s.slice(i + 1).replace(/（.*?）$/, '').trim()
          return { name, value }
        })
        .filter(a => a.name && a.value && a.name.length <= 20 && a.value.length <= 30)
        // 去掉「第N行xxx」这种带行号的
        .filter(a => !/^第\d+行/.test(a.name))

      // ★ 2026-11-02 v2：同 --no-submit 分支，保存完整字段（含 options）
      const scanned2 = flowResult.attrFields || []
      const filledMap2 = new Map(attrFromFilled.map(a => [a.name.replace(/\s+/g, ''), a.value]))
      const attrsForTpl2 = scanned2.map(f => ({
        name: f.name,
        required: !!f.required,
        kind: f.kind || 'select',
        options: Array.isArray(f.options) ? f.options : [],
        value: filledMap2.get(f.name.replace(/\s+/g, '')) || '',
      }))
      for (const a of attrFromFilled) {
        const n = a.name.replace(/\s+/g, '')
        if (!attrsForTpl2.some(x => x.name.replace(/\s+/g, '') === n)) {
          attrsForTpl2.push({ name: a.name, required: false, kind: 'select', options: [], value: a.value })
        }
      }

      saveTemplate(catKey, {
        catId,
        catePath: catePath && catePath !== '商品分类' ? catePath : (tpl?.catePath || ''),
        dims,
        attrs: attrsForTpl2,
        price: product.price || '',
        stock: product.stock || '',
        goodsId: submitResult.goodsId,
      })
      log(`[template] 已沉淀「${catKey}」：catId=${catId || '?'} catePath="${catePath || '?'}" `
        + `维度 ${dims.map(d => `${d.user}→${d.page}(${d.type || '?'})`).join('/')} 属性 ${attrFromFilled.length} 条`)

      // ★ 2026-10-30 用户要求：「第一次发布的新的类目的是后属性都要拔下来存库」
      //   上架成功后，把当前页面**所有下拉型属性的候选值**全部采集入库。
      //   这样下次同类目直接用，不用重新探测。
      try {
        const { harvestAndSave } = await import('./attr-harvest.mjs')
        const hr = await harvestAndSave(work, catKey, {
          log: (m) => log('[harvest] ' + m),
          catePath,
          catId,
        })
        log(`[harvest] 已存库「${catKey}」：${hr.count} 个属性`)
      } catch (e) {
        log(`[harvest] 采集失败（不影响上架）：${e.message}`)
      }
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
