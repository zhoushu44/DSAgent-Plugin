/**
 * steps/index.mjs — 拼多多上架 · 统一执行入口（基座版）
 *
 * 用法：
 *   node steps/index.mjs --product-file <product.json> --account <shopKey> [--confirm true]
 *   node steps/index.mjs --product '<json>' --account <shopKey> --confirm true
 *
 * 输出：__DSAGENT_RESULT__{"ok":...}
 *
 * ★ 全部走基座：
 *   - pdd-launch.launchStealth()      浏览器
 *   - pdd-antiban.reserveSlot()       节流
 *   - pdd-risk.guard()                风控
 *   - pdd-request.request()           接口（拉模板/校验）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const SHARED = path.join(PLUGIN, 'skills', '_shared')
const loadShared = f => import(pathToFileURL(path.join(SHARED, f)).href)
const loadStep = f => import(pathToFileURL(path.join(__dirname, f)).href)
const loadTpl = () => import(pathToFileURL(path.join(PLUGIN, 'skills/pdd-publish/templates/index.mjs')).href)
const { validateProduct, summarize } = await import(pathToFileURL(path.join(__dirname, 'helpers', 'product-schema.mjs')).href)
const { cutTitle, titleWeight } = await import(pathToFileURL(path.join(__dirname, 'helpers', 'title-weight.mjs')).href)

const emit = (obj) => {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(obj))
  process.exit(obj.ok ? 0 : 1)
}
const argOf = (name, dflt = '') => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const hasFlag = (name) => process.argv.includes('--' + name)

const sleep = ms => new Promise(r => setTimeout(r, ms))
// ★ 带时间戳的 log（用来定位每步耗时）
const __t0 = Date.now()
const log = (...a) => {
  const s = ((Date.now() - __t0) / 1000).toFixed(1)
  console.log('[pdd +' + s + 's]', ...a)
}

// ─── 参数 ────────────────────────────────────────────────
let product = null
const pf = argOf('product-file')
const pj = argOf('product')
if (pf) {
  if (!fs.existsSync(pf)) emit({ ok: false, failureKind: 'config_error', text: `找不到 product 文件: ${pf}` })
  product = JSON.parse(fs.readFileSync(pf, 'utf8'))
} else if (pj) {
  product = JSON.parse(pj)
}
if (!product) emit({ ok: false, failureKind: 'config_error', text: '缺少 --product-file / --product' })

const shopKey = argOf('account')
if (!shopKey) emit({ ok: false, failureKind: 'config_error', text: '缺少 --account（shopKey）' })
const confirm = String(argOf('confirm')).toLowerCase() === 'true'

// ─── 预览模式（不带 --confirm 只校验） ────────────────────
const T = await loadTpl()
const catId = Number(product.catId || product.category_id || 0)
let tpl = null
if (catId) { try { tpl = T.loadTemplate(catId) } catch { } }
if (!tpl && product.category) {
  const all = T.listTemplates()
  const hit = all.find(x => String(x.name || '').includes(String(product.category)))
  if (hit) tpl = T.loadTemplate(hit.catId)
}

// ══ 入口校验（统一在这里拦，不等到 step12）══
const V = validateProduct(product, tpl, { checkFiles: true })
if (!V.ok) {
  emit({
    ok: false,
    failureKind: 'validation_error',
    text: summarize(V),
    errors: V.errors,
    warnings: V.warnings,
  })
}
// 校验通过 → 用归一化后的数据（顶层 stock/itemNo 已兜底到每行 SKU）
product = V.normalized
if (V.warnings.length) log('校验警告:', V.warnings.slice(0, 5).join('; '))

if (!confirm) {
  const lines = [
    '【拼多多上架预览 · 基座版】',
    `标题：${product.title || '（未填）'}`,
    `类目：${tpl?.category?.fullName || product.category || '（未识别）'}`,
    `主图：${(product.images || []).length} 张`,
    `详情图：${(product.detailImages || []).length} 张`,
    `规格维度：${(product.specs || []).map(s => `${s.name}(${s.values.length})`).join(' / ') || '无'}`,
    `SKU 组合：${(product.skus || []).length} 行`,
    `参考价：${product.price || '（未填）'}`,
    '',
    '带 --confirm true 才真正提交（L2 写操作）',
  ]
  // ★ 预览是正常结果，ok=true；needConfirm 表示还需用户确认才能真提交
  emit({ ok: true, needConfirm: true, text: lines.join('\n'), preview: { catId, title: product.title, specs: product.specs, skus: product.skus, images: product.images?.length || 0, detailImages: product.detailImages?.length || 0 } })
}

// ─── 真实上架 ────────────────────────────────────────────
const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN, 'lib/services/credential-store.js')).href)
const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
// ★ 支持三种定位：精确 shopKey / 店铺名 / 模糊匹配
const all = store.listAccounts().filter(x => x.platform === 'pdd_mms')
// 有 cookie 才算「可登录」
const ckOf = (x) => {
  const v = x.cookies
  if (!v) return 0
  if (typeof v === 'object') return Object.keys(v).length
  if (typeof v === 'string') return v.split(';').filter(Boolean).length
  return 0
}
// ★ status 不作为硬性排除：reauth_required 时 cookie 可能仍有效，
//   真正是否可用由后面「实际请求能不能通」决定；这里只要求有 cookie
const usable = all.filter(x => ckOf(x) > 0)
// 排序：status=valid 的优先
usable.sort((a, b) => (b.status === 'valid' ? 1 : 0) - (a.status === 'valid' ? 1 : 0))
let acc = null
acc = usable.find(x => x.shop_key === shopKey)
if (!acc) acc = usable.find(x => x.display_label === shopKey)
if (!acc) acc = usable.find(x => (x.display_label || '').includes(shopKey) || shopKey.includes(x.display_label || ''))
if (!acc && usable.length === 1) acc = usable[0]
if (!acc) {
  const names = usable.map(x => x.display_label + '(' + x.shop_key.slice(-8) + ')').join(' / ') || '(无可用账号)'
  emit({ ok: false, failureKind: 'config_error', text: '无法确定账号 ' + shopKey + '。可用：' + names })
}
if (!acc) emit({ ok: false, failureKind: 'config_error', text: `凭证库找不到账号 ${shopKey}（可用：${all.map(x => x.display_label).join(' / ')}）` })
// ★ cookies 可能是对象 {name:value} 或字符串，两种都要认
const ckObj = acc.cookies
const hasCookie = (ckObj && typeof ckObj === 'object' && Object.keys(ckObj).length > 0)
  || (typeof ckObj === 'string' && ckObj.includes('PASS_ID'))
  || (typeof acc.cookie_str === 'string' && acc.cookie_str.includes('PASS_ID'))
if (!hasCookie) {
  emit({ ok: false, failureKind: 'auth', text: `账号「${acc.display_label}」登录态失效，请重新登录` })
}
const realShopKey = acc.shop_key

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { launchStealth, launchNoWindowStealth } = await loadShared('pdd-launch.mjs')
let AB = null, RISK = null
try { AB = await loadShared('pdd-antiban.mjs') } catch { }
try { RISK = await loadShared('pdd-risk.mjs') } catch { }

// ★ 基座节流：先拿配额
if (AB?.reserveSlot) {
  try {
    const slot = await AB.reserveSlot('pdd_mms', '/draco-ms/mms/template/mall')
    if (slot?.waitMs > 0) { log('基座节流等待', slot.waitMs, 'ms'); await sleep(slot.waitMs) }
    log('基座配额 ok', JSON.stringify(slot).slice(0, 80))
  } catch (e) { log('基座节流跳过:', String(e.message).slice(0, 60)) }
}

// ★ 基座风控检查
if (RISK?.checkCooldown) {
  const cd = RISK.checkCooldown(realShopKey)
  if (cd?.cooling) emit({ ok: false, failureKind: 'rate_limit', text: `账号冷却中，剩余 ${Math.ceil((cd.until - Date.now()) / 1000)}s` })
}

// ★ 2026-11-16 无干扰模式：spawn 启动 Chrome（窗口在屏幕外）
//   为什么不用 puppeteer.launch：它会追加 23 个默认参数（--start-maximized 等）
//   导致 --window-position=-32000,-32000 失效、下拉渲染异常
//   spawn 只传必要参数，实测 10/10 成功、63s/套
//   ★ 加 --visible 或 PDD_VISIBLE=1 可看窗口
const WANT_VISIBLE = process.argv.includes('--visible') || process.env.PDD_VISIBLE === '1'
const { browser, page: p0 } = WANT_VISIBLE
  ? await launchStealth(realShopKey, puppeteer)
  : await launchNoWindowStealth(realShopKey, puppeteer)
if (!WANT_VISIBLE) log('浏览器: 无干扰模式（窗口屏幕外）')
// ★ 2026-11-16 提速：launch 后是 about:blank，可以直接 goto
//   原做法轮询等「页面变成 mms 域名」，实测最多要 7.8s
await sleep(600)
let p = p0
const src = { browser, get p() { return p }, set p(v) { p = v },
  params: product, catId, tpl, log, sleep,
}
const ctx = (extra) => Object.assign({}, extra, { shopKey: realShopKey, catId, tpl, log, sleep })

async function refetch(re = /mms\.pinduoduo\.com/) {
  for (let i = 0; i < 25; i++) {
    try {
      const ps = await browser.pages()
      const hits = ps.filter(x => { try { const u = x.url(); return !x.isClosed() && re.test(u) && !/goods_add\/success/.test(u) } catch { return false } })
      if (hits.length) { p = hits[hits.length - 1]; await p.bringToFront().catch(() => { }); return p }
    } catch { }
    await sleep(250)
  }
  return p
}

async function pick(re = /goods_add|goods\/category|goods_list/) {
  for (let i = 0; i < 20; i++) {
    const ps = await browser.pages()
    const hits = ps.filter(x => { try { const u = x.url(); return !x.isClosed() && !/goods_add\/success/.test(u) && re.test(u) } catch { return false } })
    if (hits.length) { p = hits[hits.length - 1]; await p.bringToFront().catch(() => { }); return p }
    await sleep(250)
  }
  return p
}

const steps = []
try {
  // ── 1 打开发布页 ──
  log('=== 1 打开发布页 ===')
  // ★ 2026-11-16 提速：第1步不需要 pick()
  //   页面刚 launch 时是 about:blank，pick 会白等 20×250ms
  //   直接 goto 就行
  await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded' }).catch(() => { })
  await p.waitForSelector('button[data-tracking-viewid="new_product_releasing"]', { timeout: 25000 }).catch(() => { })
  const tp = browser.waitForTarget(t => /goods\/category/.test(t.url()), { timeout: 25000 }).catch(() => null)
  await p.evaluate(() => {
    const b = document.querySelector('button[data-tracking-viewid="new_product_releasing"]')
    if (b) { b.scrollIntoView({ block: 'center' }); b.click() }
  })
  const tg = await tp
  let pg = tg ? await tg.page().catch(() => null) : null
  if (pg) { await pg.bringToFront(); p = pg }
  if (!pg) throw new Error('打不开发布页')
  steps.push({ step: 1, ok: true })
  log('1 ✅', p.url().slice(0, 70))

  // ── 2 主图 ──
  log('=== 2 主图 ===')
  const imgs = product.images || []
  if (!imgs.length) throw new Error('product.images 为空')
  await refetch(/goods\/category/)
  await sleep(2000)
  await p.waitForSelector('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]', { timeout: 30000 }).catch(() => { })
  let imgOk = false
  for (let k = 0; k < 4 && !imgOk; k++) {
    const fi = await p.$('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]')
    if (!fi) { await sleep(700); continue }
    await p.evaluate(() => { const i = document.querySelector('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]'); if (i) i.value = '' }).catch(() => { })
    await fi.uploadFile(...imgs).catch(() => { })
    await p.evaluate(() => {
      const i = document.querySelector('section[class*="goodsCarousel_uploadImgEnter"] input[type="file"]')
      if (i) { i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })) }
    }).catch(() => { })
    for (let i = 0; i < 60; i++) {
      const c = await p.evaluate(() => {
        const t = document.body.innerText || ''
        const m = t.match(/上传图片\s*[（(]\s*(\d+)\s*\/\s*(\d+)/) || t.match(/已上传\s*(\d+)\s*\/\s*(\d+)/)
        return m ? Number(m[1]) : -1
      }).catch(() => -1)
      if (c > 0) { imgOk = true; break }
      await sleep(300)
    }
  }
  if (!imgOk) throw new Error('主图上传失败（计数为0）')
  await refetch(/goods\/category/)
  steps.push({ step: 2, ok: true, count: imgs.length })
  log('2 ✅', imgs.length, '张')

  // ── 3 标题 ──
  log('=== 3 标题 ===')
  await refetch(/goods\/category/)
  await p.waitForSelector('input[placeholder*="商品标题组成"]', { timeout: 30000 }).catch(() => { })
  const tv = await p.evaluate((t) => {
    const i = document.querySelector('input[placeholder*="商品标题组成"]'); if (!i) return ''
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    i.focus(); if (set) set.call(i, t); else i.value = t
    i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true }))
    document.body.click(); return i.value
  }, product.title || '')
  if (!tv) throw new Error('标题填写失败')
  steps.push({ step: 3, ok: true, value: tv })
  log('3 ✅', tv.slice(0, 20))

  // ── 4 类目 + 下一步 ──
  log('=== 4 类目+下一步 ===')
  await refetch(/goods\/category/)
  await p.waitForSelector('#selectedCateId, [data-tracking-viewid="choose_cate"], #bottomSubmitBtnId', { timeout: 30000 }).catch(() => { })
  const m4 = await loadStep('step4.mjs')
  const cat = await m4.ensureCategory(p, { catId, log: x => log('  ' + x) })
  if (!cat.ok) throw new Error('类目失败: ' + (cat.error || ''))
  let moved = false
  for (let k = 0; k < 5 && !moved; k++) {
    await pick(/goods\/category/)
    const ok = await p.evaluate(() => {
      const el = document.getElementById('bottomSubmitBtnId')
      if (!el || el.disabled) return false
      el.scrollIntoView({ block: 'center' }); el.click(); return true
    }).catch(() => false)
    if (!ok) { await sleep(1200); continue }
    for (let i = 0; i < 70; i++) {
      const ps = await browser.pages()
      if (ps.find(x => /goods_add\/index/.test(x.url()))) { moved = true; break }
      await sleep(250)
    }
  }
  if (!moved) throw new Error('点了下一步但没进第2步')
  steps.push({ step: 4, ok: true })
  log('4 ✅')

  await pick(/goods_add/)
  await p.waitForSelector('#newSpec, #sku', { timeout: 30000 }).catch(() => { })

  // ── 5 白底图 ──
  if (product.whiteBg || product.white_bg) {
    const m5 = await loadStep('step5.mjs')
    const r5 = await m5.default(p, { files: [product.whiteBg || product.white_bg] }).catch(e => ({ ok: false, errors: [e.message] }))
    steps.push({ step: 5, ok: !!r5.ok })
    log('5', r5.ok ? '✅' : '⚠ ' + (r5.errors || []).join(','))
  } else { steps.push({ step: 5, ok: true, skip: true }); log('5 跳过（无白底图）') }

  // ── 6 属性 + 自动补必填 ──
  log('=== 6 属性 ===')
  const m6 = await loadStep('step6.mjs')
  let av = product.attributes || {}
  if (!Object.keys(av).length && tpl?.attributes) {
    av = {}
    for (const at of tpl.attributes) if (at.options?.length) av[at.label] = at.options[0].value
  }
  const r6 = await m6.default(p, { values: av, catId })
  steps.push({ step: 6, ok: !!r6.ok, autoRequired: (r6.autoRequired || []).filter(x => x.ok).map(x => x.label) })
  log('6', r6.ok ? '✅' : '⚠ ' + (r6.errors || []).join(','))
  // ★ 调试：打印每个属性的填写明细
  if (r6.results?.length) {
    const bad = r6.results.filter(x => x.ok === false)
    if (bad.length) log('  未填写:', JSON.stringify(bad.map(x => ({ label: x.label, err: x.error }))))
  }
  if (r6.unmapped?.length) log('  页面找不到:', r6.unmapped.join(','))
  if (r6.droppedAttrs?.length) log('  值被剔除:', JSON.stringify(r6.droppedAttrs))
  if (r6.autoRequired?.length) log('  自动补必填:', r6.autoRequired.filter(x => x.ok).map(x => x.label).join(','))

  // ── 6b 详情图 ──
  const detailImgs = product.detailImages || []
  if (detailImgs.length) {
    log('=== 6b 详情图 (' + detailImgs.length + ' 张) ===')
    const m6b = await loadStep('step6b.mjs')
    const r6b = await m6b.default(p, { files: detailImgs })
    steps.push({ step: '6b', ok: !!r6b.ok, count: r6b.count, locate: r6b.locate?.why })
    log('6b', r6b.ok ? '✅ ' + r6b.count + ' 张' : '⚠ ' + (r6b.errors || []).join(','))
    if (!r6b.ok) {
      // 详情图失败不阻断上架，只记警告
      log('   详情图未上传成功，继续（不影响主流程）')
    }
  } else { steps.push({ step: '6b', ok: true, skip: true }); log('6b 跳过（无详情图）') }

  // ── 11 规格 ──
  const specs = product.specs || []
  if (specs.length) {
    log('=== 11 规格 ===')
    const m11 = await loadStep('step11.mjs')
    const r11 = await m11.default(p, { specs, catId })
    steps.push({ step: 11, ok: !!r11.ok, rows: r11.actualRows })
    log('11', r11.ok ? `✅ ${r11.actualRows} 行` : '❌ ' + (r11.error || ''))
    if (!r11.ok) throw new Error('规格失败: ' + (r11.error || ''))
  } else { steps.push({ step: 11, ok: true, skip: true }); log('11 跳过（无规格）') }

  // ── 12 价格库存 ──
  log('=== 12 价格库存 ===')
  const skus = product.skus || []
  if (!skus.length) throw new Error('product.skus 为空')
  const rows = skus.map(s => ({
    quantity: s.stock ?? s.quantity ?? 100,
    multiPrice: s.multiPrice ?? s.price ?? 0,
    price: s.price ?? s.multiPrice ?? 0,
    skuSn: s.itemNo || s.skuSn || '',
  }))
  const thumbs = skus.map((s, i) => s.thumb || (product.images || [])[i % (product.images || []).length])
  const m12 = await loadStep('step12.mjs')
  const r12 = await m12.default(p, { rows, thumbs, verify: true })
  steps.push({ step: 12, ok: !!r12.ok, filled: r12.filled })
  log('12', r12.ok ? `✅ ${r12.filled} 行` : '❌ ' + (r12.errors || []).join(','))
  if (r12.write?.done) {
    log('   写入明细:', JSON.stringify(r12.write.done.map(d => ({ i: d.i, ok: d.ok, acts: d.acts?.map(a => a[0] + ':' + a[1]).join(' ') }))))
    log('   列号:', JSON.stringify(r12.write.cols))
  }
  if (r12.warnings?.length) log('   警告:', r12.warnings.join('; '))
  if (!r12.ok) throw new Error('价格库存失败: ' + (r12.errors || []).join(','))

  // ── 13 参考价 ──
  if (product.price) {
    const m13 = await loadStep('step13.mjs')
    const r13 = await m13.default(p, { value: product.price })
    steps.push({ step: 13, ok: !!r13.ok })
    log('13', r13.ok ? '✅ ' + r13.value : '⚠')
  }

  // ── 14 折扣 ──
  if (product.discount) {
    const m14 = await loadStep('step14.mjs')
    const r14 = await m14.default(p, { value: product.discount })
    steps.push({ step: 14, ok: !!r14.ok })
    log('14', r14.ok ? '✅' : '⚠')
  }

  // ── 15 发货时间 ──
  const m15 = await loadStep('step15.mjs')
  const r15 = await m15.default(p, { value: product.shipTime || '48小时' })
  steps.push({ step: 15, ok: !!r15.ok })
  log('15', r15.ok ? '✅ ' + r15.selected : '⚠')

  // ── 16 提交（内置必填校验） ──
  log('=== 16 提交 ===')
  const m16 = await loadStep('step16.mjs')
  const r16 = await m16.default(p, { timeoutMs: 180000 })
  steps.push({ step: 16, ok: !!r16.ok, goodsId: r16.goodsId, required: r16.required ? { total: r16.required.total, required: r16.required.required, missing: r16.required.missing } : null })
  log('16', r16.ok ? `✅ goodsId=${r16.goodsId}` : '❌ ' + r16.error)

  emit({
    ok: !!r16.ok,
    goodsId: r16.goodsId,
    url: r16.url,
    successText: r16.successText,
    steps,
    required: r16.required ? { total: r16.required.total, required: r16.required.required, missing: r16.required.missing.map(m => m.label) } : null,
    text: r16.ok ? `上架成功 goodsId=${r16.goodsId}` : r16.error,
  })
} catch (e) {
  emit({ ok: false, failureKind: 'api_error', text: String(e.message).slice(0, 300), steps })
}

