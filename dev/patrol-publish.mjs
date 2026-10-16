/**
 * 发布链路巡检脚本（PUBLISH-SPEC §4 第 8 步 / §5 验收 5）
 *
 * 用法：
 *   node dev/patrol-publish.mjs <pdd|taobao|xianyu> [类目关键词] [账号过滤]
 *   node dev/patrol-publish.mjs --selftest     # 只跑内置自检（不启动浏览器）
 *
 * 做什么：
 *   复刻 verify-pdd-newflow.mjs 蓝本启动链（生产 Profile + Cookie 注入 + 分段导航），
 *   到达各平台「发布表单页」后，遍历 publish-config/<platform>.json 的 anchors 逐个打点，
 *   再做类目属性 schema 指纹比对（只读 snapshot，不落盘），最后输出三级报告：
 *
 *     ① 全绿      —— 所有非条件型锚点命中（报告每个锚点命中候选 L 几），指纹一致/首记
 *     ② 指纹变化  —— 锚点全命中但类目属性结构与缓存指纹不一致（提示缓存自动失效机制会触发）
 *     ③ 失联+证据 —— 有锚点全部候选未命中：formatAnchorFailure 明细 + 截图 + DOM 片段 + URL
 *
 * ★ 安全边界（与蓝本一致）：只读巡检，不点任何「提交」按钮、不上传图片、不填表单字段。
 *   唯一例外：taobao 类目页「确认，下一步」在必填属性（品牌）填全前禁用——巡检选品牌下拉
 *   第一项作为「导航过路费」以到达发布页（与生产 selectCategory 同款交互，不提交无真实副作用）。
 *
 * ★ 依赖：npm run build:host 先编译 lib/（本脚本 import lib/ 编译产物）。
 *   dev/ 不进插件包（package.json files 只有 lib/publish-config/cordis.patch.yml）。
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = resolve(dirnameOf(import.meta.url), '..')
const LIB = join(PLUGIN_ROOT, 'lib')

/** Windows 下动态 import 必须是 file:// URL（绝对路径 e:... 会报 ERR_UNSUPPORTED_ESM_URL_SCHEME） */
const libImport = (rel) => import(pathToFileURL(join(LIB, rel)).href)

function dirnameOf(u) {
  return fileURLToPath(new URL('.', u)).replace(/[\\/]$/, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// ════════════════════════════════════════════════════════════════════════
// 一、纯函数区（自检/回归测试覆盖：--selftest 或 import）
// ════════════════════════════════════════════════════════════════════════

/** 平台元信息：账号过滤（生产原话）、Cookie 双域、Profile 平台键、默认类目关键词 */
export const PLATFORM_META = {
  pdd: {
    /** 生产过滤：a.platform === 'pdd_mms'（src/pdd-publish.ts） */
    accountFilter: (a) => a.platform === 'pdd_mms',
    cookieDomains: ['.pinduoduo.com', 'mms.pinduoduo.com'],
    /** attr-cache 的 PLATFORM 键（src/pdd-publish.ts L273） */
    cachePlatform: 'pdd_mms',
    /** profileDir 的 platform 参数（pdd-publish.ts L3495 用 'pdd_mms'） */
    profilePlatform: 'pdd_mms',
    defaultKeyword: '童装',
  },
  taobao: {
    /** 生产过滤（src/taobao-publish.ts L333-335）：status 前置 + 精确平台优先 + credential_platform 兜底 */
    accountFilter: (a) => a.status !== 'invalid' && (a.platform === 'taobao'
      || (a.platform !== 'taobao' && a.credential_platform === 'taobao')),
    cookieDomains: ['.taobao.com', '.tmall.com'],
    cachePlatform: 'taobao',
    profilePlatform: 'taobao',
    defaultKeyword: '手机壳',
  },
  xianyu: {
    /** 生产过滤（src/xianyu-publish.ts）：platform + status 联合 */
    accountFilter: (a) => a.platform === 'xianyu' && a.status !== 'invalid',
    cookieDomains: ['.goofish.com', '.taobao.com'], // SSO 票据在 taobao 域
    cachePlatform: 'xianyu', // 闲鱼无属性缓存，仅占位
    profilePlatform: 'xianyu',
    defaultKeyword: '', // 闲鱼无类目选择
  },
}

/**
 * 条件型锚点表：未命中 ≠ 改版（下拉展开才存在 / 提交后才出现 / 风控触发才有）。
 * value 为「未触发原因」，进报告但不计失联。
 */
export const CONDITIONAL_ANCHORS = {
  pdd: {
    attrDropdownPanel: '下拉展开才存在（body 级 portal）',
    attrDropdownOption: '下拉展开才存在',
    freightTemplateOption: '运费下拉展开才存在',
    skuSpecColorInput: '部分类目无「主色」规格',
    submitErrorsToast: '提交后才出现',
    submitErrorsFormItem: '提交校验后才出现',
    optimizationPanel: '提交后才出现（优化建议面板）',
    optimizationTabLabel: '提交后才出现',
    optimizationTabContent: '提交后才出现',
    optimizationItem: '提交后才出现',
    optimizationItemHeader: '提交后才出现',
    sliderCaptcha: '风控触发才出现',
    guideBubbleDismissText: '新手引导气泡才出现',
  },
  taobao: {
    baxiaDialog: '风控（Baxia）触发才出现',
    sliderHandle: '风控滑块触发才出现',
    successContainer: '提交成功后才出现',
  },
  xianyu: {},
}

/** 占位符默认值（与生产消费点一致） */
export const PLACEHOLDER_DEFAULTS = {
  // pdd fillShipping：shipmentLimitText ∈ {当日发货, 24小时发货, 48小时发货...}
  '{shipmentLimitText}': '当日发货',
  // pdd 运费模板精确匹配失败兜底选第一个 → 巡检用样例占位（fallback:"first"）
  '{templateName}': '巡检样例模板',
  // taobao specInputById：salePropDefaults.propId（类目「AI软件订阅」颜色分类实测 ID）
  '{propId}': '1627207',
}

/**
 * 字符串简写锚点（loader anchorSpec 会归一为 {candidates:[{level:2, selector}]}，
 * 但语义实为正则/文案/选择器集合，由平台层按各自方式消费）→ 巡检单列一节报告，不逐个打点。
 */
export const SHORTHAND_KIND = {
  pdd: {
    guideBubbleDismissText: '文案正则（知道了按钮）',
    uploadCountRe: '上传计数正则（已上传 x/y 张）',
    skuTableHeaderRe: 'SKU 表头文案（拼单价）',
    listReadyBodyRe: '列表就绪文案（发布新商品）',
    listReadyTitleRe: '标题就绪文案（商品列表）',
    navExclusionSelector: '导航排除选择器集合',
  },
  taobao: {
    uploadCountRe: '上传计数正则（已上传|上传成功）',
  },
  xianyu: {
    priceAncestorLabelRe: '价格框祖先文案正则',
    categoryBlockedRe: '分类封禁文案正则',
    categoryStateRe: '分类状态正则',
    categoryFallbackName: '兜底分类名（其他闲置）',
    loginRequiredRe: '登录判定正则',
  },
}

/**
 * 拆分锚点候选：`text:` 前缀候选（生产在平台层单独消费，anchor-engine 不认识）
 * vs 其余候选（走 resolveAnchor）。
 * 生产消费原话：pdd-publish.ts L247-248 / taobao-publish.ts L203。
 */
export function splitTextCandidates(spec) {
  const candidates = spec?.candidates || []
  const css = candidates.filter((c) => !String(c.selector || '').startsWith('text:'))
  const texts = candidates
    .filter((c) => String(c.selector || '').startsWith('text:'))
    .map((c) => String(c.selector).slice('text:'.length))
  return { css, texts }
}

/** 占位符代入：{shipmentLimitText} / {templateName} / {propId} 等 */
export function substitutePlaceholders(selector) {
  let out = String(selector || '')
  for (const [ph, val] of Object.entries(PLACEHOLDER_DEFAULTS)) {
    out = out.split(ph).join(val)
  }
  return out
}

/**
 * 从原始 JSON（未经 loader 归一）判断某锚点是否字符串简写。
 * loader 的 anchorSpec() 会把字符串归一为 candidates，但巡检需要原始形态来分流。
 */
export function isShorthandAnchor(rawAnchor) {
  return typeof rawAnchor === 'string'
}

/** 三级判定：绿 / 黄（指纹变化）/ 红（失联）。红 > 黄 > 绿。 */
export function verdictOf(results) {
  const lost = results.filter((r) => r.status === 'lost')
  if (lost.length) return 'red'
  if (results.some((r) => r.status === 'fingerprint-changed')) return 'yellow'
  return 'green'
}

export function verdictLabel(v) {
  return { green: '全绿', yellow: '指纹变化', red: '失联' }[v] || v
}

// ════════════════════════════════════════════════════════════════════════
// 二、自检（--selftest：不启动浏览器，纯函数不变量 + 配置完整性）
// ════════════════════════════════════════════════════════════════════════

export async function selftest() {
  const { loadPublishConfig, anchorSpec } = await libImport('services/publish-config-loader.js')
  const cases = []
  const test = (name, fn) => cases.push({ name, fn })
  let failed = 0

  // splitTextCandidates：pdd cateConfirmButton（含 text: 候选）
  test('splitTextCandidates 拆 pdd cateConfirmButton', () => {
    const cfg = loadPublishConfig('pdd')
    const spec = anchorSpec(cfg, 'cateConfirmButton')
    const { css, texts } = splitTextCandidates(spec)
    if (css.length !== 2) throw new Error(`期望 2 个 CSS 候选，实际 ${css.length}`)
    if (texts.length !== 1 || texts[0] !== '确认发布该类商品') throw new Error(`text: 拆分错误：${JSON.stringify(texts)}`)
  })

  // splitTextCandidates：纯 CSS 锚点（taobao formReady）
  test('splitTextCandidates 纯 CSS 锚点不受影响', () => {
    const cfg = loadPublishConfig('taobao')
    const spec = anchorSpec(cfg, 'formReady')
    const { css, texts } = splitTextCandidates(spec)
    if (css.length !== 2) throw new Error(`期望 2 个 CSS 候选，实际 ${css.length}`)
    if (texts.length !== 0) throw new Error(`不该有 text: 候选：${JSON.stringify(texts)}`)
  })

  // substitutePlaceholders：三个占位符
  test('substitutePlaceholders 三占位符代入', () => {
    if (substitutePlaceholders('//label[.//text()="{shipmentLimitText}"]') !== '//label[.//text()="当日发货"]') throw new Error('shipmentLimitText 未代入')
    if (substitutePlaceholders('//li[.//text()="{templateName}"]').includes('{templateName}')) throw new Error('templateName 未代入')
    if (substitutePlaceholders('#struct-p-{propId}') !== '#struct-p-1627207') throw new Error('propId 未代入')
    if (substitutePlaceholders('#goods-category') !== '#goods-category') throw new Error('无占位符选择器被误改')
  })

  // 条件型表与简写表覆盖校验：表里的键必须存在于对应 JSON anchors
  for (const platform of ['pdd', 'taobao', 'xianyu']) {
    test(`条件型/简写表键全部存在于 ${platform}.json anchors`, () => {
      const cfg = loadPublishConfig(platform)
      const anchors = cfg.anchors || {}
      const cond = CONDITIONAL_ANCHORS[platform] || {}
      const short = SHORTHAND_KIND[platform] || {}
      for (const k of [...Object.keys(cond), ...Object.keys(short)]) {
        if (!(k in anchors)) throw new Error(`${platform} 表引用了不存在的锚点 "${k}"`)
      }
      // 反向：JSON 里的字符串简写锚点必须全部登记在 SHORTHAND_KIND
      for (const [k, v] of Object.entries(anchors)) {
        if (isShorthandAnchor(v) && !(k in short)) {
          throw new Error(`${platform}.json 简写锚点 "${k}" 未登记 SHORTHAND_KIND（会被误当 CSS 打点）`)
        }
      }
    })
  }

  // verdictOf 三级判定
  test('verdictOf 三级判定（红 > 黄 > 绿）', () => {
    if (verdictOf([{ status: 'ok' }]) !== 'green') throw new Error('全 ok 应绿')
    if (verdictOf([{ status: 'ok' }, { status: 'conditional' }]) !== 'green') throw new Error('ok+条件型应绿')
    if (verdictOf([{ status: 'ok' }, { status: 'fingerprint-changed' }]) !== 'yellow') throw new Error('指纹变化应黄')
    if (verdictOf([{ status: 'ok' }, { status: 'lost' }]) !== 'red') throw new Error('失联应红')
  })

  for (const c of cases) {
    try {
      await c.fn()
      console.log(`  ✓ ${c.name}`)
    } catch (e) {
      failed++
      console.error(`  ✗ ${c.name}\n      ${e?.message || e}`)
    }
  }
  console.log(`\n[selftest] ${cases.length - failed}/${cases.length} 通过`)
  return failed === 0
}

// ════════════════════════════════════════════════════════════════════════
// 三、巡检主体（启动浏览器）
// ════════════════════════════════════════════════════════════════════════

/** 巡检上下文：逐锚点结果收集器 */
function createReporter() {
  const results = []
  const evidence = [] // 失联锚点的现场证据（截图路径/DOM 片段）
  return {
    results,
    evidence,
    add(r) {
      results.push(r)
    },
  }
}

/**
 * 在指定页面上打点一个锚点：
 * - `text:` 候选 → evaluate 内文本匹配检查（找 innerText 匹配的可见按钮，与生产消费语义对齐）
 * - 其余候选 → substitutePlaceholders 后逐个 resolveAnchor
 * 返回 {key, status: 'ok'|'lost', level?, selector?, textHit?, note?}
 */
async function probeAnchor(page, key, spec) {
  const { css, texts } = splitTextCandidates(spec)
  const attempts = []

  // text: 候选 → 页内文本匹配
  for (const t of texts) {
    try {
      const hit = await page.evaluate((txt) => {
        const all = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'))
          .filter((el) => {
            const r = el.getBoundingClientRect()
            if (r.width <= 0 || r.height <= 0) return false
            return (el.innerText || '').trim() === txt
          })
        return all.length > 0
      }, t)
      if (hit) {
        return { key, status: 'ok', textHit: t, note: `text: 候选命中「${t}」` }
      }
      attempts.push({ selector: `text:${t}`, level: 3, reason: '未命中（无可见元素文本匹配）' })
    } catch (err) {
      attempts.push({ selector: `text:${t}`, level: 3, reason: `evaluate 失败：${err?.message || err}` })
    }
  }

  // CSS/XPath 候选 → resolveAnchor（占位符先代入）
  const substSpec = { ...spec, candidates: css.map((c) => ({ ...c, selector: substitutePlaceholders(c.selector) })) }
  if (substSpec.candidates.length) {
    const { resolveAnchor } = await libImport('services/anchor-engine.js')
    const r = await resolveAnchor(page, key, substSpec)
    if (r.ok) {
      await r.handle?.dispose?.().catch?.(() => {})
      return { key, status: 'ok', level: r.level, selector: r.selector, candidateIndex: r.candidateIndex }
    }
    attempts.push(...r.attempts)
  }

  if (!attempts.length) attempts.push({ selector: '(空候选)', level: '?', reason: '该锚点无候选' })
  return { key, status: 'lost', attempts }
}

/** 失联锚点采集证据：截图 + DOM 片段 + URL（PUBLISH-SPEC §3.5 三件套） */
async function captureEvidence(page, reporter, key) {
  const dir = join(PLUGIN_ROOT, 'dev', 'patrol-evidence')
  mkdirSync(dir, { recursive: true })
  const base = join(dir, `${now()}-${key}`)
  const shot = `${base}.png`
  try {
    await page.screenshot({ path: shot, fullPage: false })
  } catch { /* 截图失败不致命 */ }
  let domSnippet = ''
  let url = ''
  try {
    url = page.url()
    domSnippet = await page.evaluate(() => {
      const body = document.body
      const html = body ? body.innerHTML : ''
      return html.replace(/\s+/g, ' ').slice(0, 800)
    })
  } catch { /* 页面可能已关闭 */ }
  writeFileSync(`${base}.txt`, [
    `锚点: ${key}`,
    `URL: ${url}`,
    `时间: ${new Date().toISOString()}`,
    '',
    'DOM 片段（前 800 字）：',
    domSnippet,
  ].join('\n'), 'utf8')
  reporter.evidence.push({ key, screenshot: shot, domFile: `${base}.txt`, url })
}

/**
 * 遍历平台 anchors 打点（在正确的页面上）。
 * anchorsOnPage: { [anchorKey]: page } —— 平台导航函数返回每类锚点应打点的页面。
 */
async function probeAllAnchors(platform, anchorsRaw, anchorSpecOf, pages, reporter) {
  const cond = CONDITIONAL_ANCHORS[platform] || {}
  const short = SHORTHAND_KIND[platform] || {}

  for (const [key, raw] of Object.entries(anchorsRaw)) {
    // 简写锚点 → 单列报告节，不打点
    if (isShorthandAnchor(raw)) {
      reporter.add({ key, status: 'shorthand', note: short[key] || '字符串简写锚点' })
      continue
    }
    // 找该锚点应打点的页面（默认表单页）
    const page = pages(key)
    if (!page) {
      reporter.add({ key, status: 'skipped', note: '导航未到达该锚点所在页面' })
      continue
    }
    let spec
    try {
      spec = anchorSpecOf(key)
    } catch (e) {
      reporter.add({ key, status: 'lost', note: `anchorSpec 解析失败：${e?.message || e}` })
      continue
    }
    const r = await probeAnchor(page, key, spec)
    if (r.status === 'ok') {
      reporter.add(r)
    } else if (cond[key]) {
      reporter.add({ ...r, status: 'conditional', note: `条件型-未触发：${cond[key]}` })
    } else {
      reporter.add(r)
      await captureEvidence(page, reporter, key)
    }
  }
}

/** 类目属性 schema 指纹比对（只读：snapshot 读缓存指纹 vs 现场计算，不落盘） */
async function compareFingerprint(platform, cachePlatform, keyword, readNames) {
  const { createAttrCache, schemaFingerprint } = await libImport('services/attr-cache.js')
  const cache = createAttrCache(join(homedir(), '.dsh', '.attr-cache.json'))
  const names = await readNames()
  if (!names || !names.length) return { status: 'no-data', note: '现场未读到属性项（类目无属性或读取失败）' }
  const live = schemaFingerprint(names)
  const map = await cache.snapshot()
  const bucketKey = `${cachePlatform}:${String(keyword || '').trim().toLowerCase()}:schema`
  const prev = map[bucketKey]?.fp?.value
  if (!prev) return { status: 'first', note: `首记（无基线）：${live}`, names: names.length, live }
  if (prev === live) return { status: 'ok', note: `指纹一致：${live}`, names: names.length, live }
  return { status: 'fingerprint-changed', note: `指纹变化：${prev} → ${live}`, names: names.length, live, prev }
}

// ─── pdd：复刻 verify-pdd-newflow 三段走查，返回 { categoryPage, formPage, keyword } ───
async function patrolPdd(browser, page, cfg, keyword) {
  const { configString, configTimeout } = await libImport('services/publish-config-loader.js')
  const goodsListUrl = configString(cfg, 'urls', 'goodsList', 'https://mms.pinduoduo.com/goods/goods_list')
  const listWaitMs = configTimeout(cfg, 'listWaitMs', 60_000)
  const formWaitMs = configTimeout(cfg, 'formWaitMs', 150_000)

  // 段 1：商品列表 → 点「发布新商品」（蓝本原样）
  console.log('[patrol-pdd] 段 1 打开商品列表…')
  await page.goto(goodsListUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(4000)
  const t0 = Date.now()
  let listReady = false
  while (Date.now() - t0 < listWaitMs) {
    listReady = await page.evaluate(() =>
      /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')).catch(() => false)
    if (listReady) break
    await sleep(2000)
  }
  if (!listReady) throw new Error(`段 1 失败：${listWaitMs}ms 内商品列表未就绪（可能登录失效/滑块）URL=${page.url()}`)

  const navExclusion = configString(cfg, 'anchors', '__navExclusion__')
    || String(cfg.anchors?.navExclusionSelector || 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]')
  const entryClicked = await page.evaluate((NAV_SEL) => {
    const all = (Array.from(document.querySelectorAll('button, a, div, span')))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        if ((el.innerText || '').trim() !== '发布新商品') return false
        return !el.closest(NAV_SEL)
      })
    if (!all.length) return false
    const innermost = all.filter((e) => !all.some((o) => o !== e && e.contains(o)))
    const el = innermost.find((e) => e.tagName === 'BUTTON') || innermost[innermost.length - 1]
    el.click()
    return true
  }, navExclusion).catch(() => false)
  if (!entryClicked) throw new Error('段 1 失败：未找到「发布新商品」入口')
  console.log('[patrol-pdd] 段 1 ✓ 已点「发布新商品」，等类目选择页…')

  // 段 2：类目页（新标签页）
  const waitForPage = async (re, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const pages = await browser.pages()
      const hit = pages.find((p) => re.test(String(p.url() || '')))
      if (hit) return hit
      await sleep(1000)
    }
    return null
  }
  const step1 = await waitForPage(/\/goods\/category\?/, 60_000)
  if (!step1) throw new Error('段 2 失败：60s 内未出现类目选择页（/goods/category）')
  await step1.bringToFront().catch(() => {})
  await step1.setViewport({ width: 1440, height: 900 }).catch(() => {})
  console.log('[patrol-pdd] 段 2 ✓ 类目选择页:', step1.url())

  // 类目页就绪 + 搜索选类目（蓝本原样）
  const { anchorSpec } = await libImport('services/publish-config-loader.js')
  const searchSpec = anchorSpec(cfg, 'cateSearchInput')
  const searchSel = substitutePlaceholders(searchSpec.candidates[0].selector)
  const t1 = Date.now()
  let step1Ready = false
  while (Date.now() - t1 < formWaitMs) {
    step1Ready = await step1.evaluate((sel) => !!document.querySelector(sel), searchSel).catch(() => false)
    if (step1Ready) break
    await sleep(2000)
  }
  if (!step1Ready) throw new Error(`段 2 失败：${formWaitMs}ms 内类目搜索框未出现 URL=${step1.url()}`)

  const inputHandle = await step1.$(searchSel).catch(() => null)
  if (!inputHandle) throw new Error('段 2 失败：拿不到类目搜索框句柄')
  await inputHandle.click({ delay: 30 }).catch(() => {})
  await step1.keyboard.type(keyword, { delay: 120 })
  await sleep(3500)

  const picked = await step1.evaluate((kw) => {
    const items = (Array.from(document.querySelectorAll('li, span, div')))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const t = (el.innerText || '').trim()
        return (t === kw || t.includes(kw)) && t.length < 35 && t.split('\n').length === 1
          && !/教程|课程|已学习/.test(t)
      })
    if (!items.length) return ''
    const inner = items.filter((e) => !items.some((o) => o !== e && e.contains(o)))
    const el = inner.find((e) => /cate/i.test(e.className)) || inner[0]
    el.click()
    return (el.innerText || '').trim().slice(0, 60)
  }, keyword).catch(() => '')
  if (!picked) throw new Error(`段 2 失败：关键词「${keyword}」无匹配类目搜索结果`)
  console.log(`[patrol-pdd] 段 2 ✓ 已点选类目：${picked}`)
  await sleep(800)

  // 确认按钮：与生产同款（text: 候选拆出来做文本匹配，CSS 候选逐个试）
  const confirmSpec = anchorSpec(cfg, 'cateConfirmButton')
  const { css: confirmCss, texts: confirmTexts } = splitTextCandidates(confirmSpec)
  const confirmText = confirmTexts[0] || '确认发布该类商品'
  const confirmed = await step1.evaluate((btnText, sels) => {
    for (const sel of sels) {
      const b = document.querySelector(sel)
      if (b && !b.disabled) { b.click(); return sel }
    }
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.innerText || '').trim() === btnText)
    if (!btn || btn.disabled) return null
    btn.click()
    return `text:${btnText}`
  }, confirmText, confirmCss.map((c) => substitutePlaceholders(c.selector))).catch(() => null)
  if (!confirmed) throw new Error('段 2 失败：「确认发布该类商品」按钮不可点')
  console.log(`[patrol-pdd] 段 2 ✓ 已点确认（${confirmed}），等同页跳转表单页…`)

  // 段 3：同页跳转表单页
  const step2 = await waitForPage(/\/goods\/goods_add\//, 25_000)
  if (!step2) throw new Error(`段 3 失败：25s 内未跳到表单页。类目页 URL=${step1.url()}`)
  await step2.bringToFront().catch(() => {})
  const step2Spec = anchorSpec(cfg, 'step2Ready')
  const step2Sel = step2Spec.candidates.map((c) => substitutePlaceholders(c.selector)).join(', ')
  const t2 = Date.now()
  let step2Ready = false
  while (Date.now() - t2 < formWaitMs) {
    step2Ready = await step2.evaluate((sel) => !!document.querySelector(sel), step2Sel).catch(() => false)
    if (step2Ready) break
    await sleep(2000)
  }
  if (!step2Ready) throw new Error(`段 3 失败：表单页 ${formWaitMs}ms 内未就绪 URL=${step2.url()}`)
  console.log('[patrol-pdd] 段 3 ✓ 表单页就绪:', step2.url())

  return { categoryPage: step1, formPage: step2, keyword, picked }
}

/** pdd 现场读类目属性名（复刻 readAttrItems 的 name 提取，src/pdd-publish.ts L2555-2575） */
async function pddReadAttrNames(page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.goods-propertys .property-item'))
    return items.map((it) => {
      const fi = it.querySelector('[id^="basic.propertys."]')
      if (!fi) return ''
      const name = (fi.querySelector('label')?.innerText || '')
        .replace(/重要/g, '').replace(/[*＊]/g, '').replace(/\s+/g, '')
      return name
    }).filter(Boolean)
  }).catch(() => [])
}

// ─── taobao：category.htm → 搜索 → 点结果 → 品牌过路费 → 确认下一步 → 发布页 ───
async function patrolTaobao(browser, page, cfg, keyword) {
  const { configString, configTimeout, anchorSpec } = await libImport('services/publish-config-loader.js')
  const categoryUrl = configString(cfg, 'urls', 'taobaoCategory', 'https://item.upload.taobao.com/sell/ai/category.htm?force=true')
  const formWaitMs = configTimeout(cfg, 'formWaitMs', 150_000)

  console.log('[patrol-taobao] 打开类目选择页…')
  await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

  // 搜索框就绪（生产：30×1s 轮询）
  const boxSel = substitutePlaceholders(anchorSpec(cfg, 'cateSearchInput').candidates[0].selector)
  let boxReady = await page.evaluate((s) => !!document.querySelector(s), boxSel).catch(() => false)
  for (let i = 0; i < 30 && !boxReady; i++) { await sleep(1000); boxReady = await page.evaluate((s) => !!document.querySelector(s), boxSel).catch(() => false) }
  if (!boxReady) throw new Error(`类目页搜索框 30s 未出现 URL=${page.url()}`)

  // 原生 setter + input 事件写词 + Enter（生产同款）
  const typed = await page.evaluate((kw, sel) => {
    const inp = document.querySelector(sel)
    if (!inp) return false
    inp.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(inp, kw); else inp.value = kw
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, keyword, boxSel).catch(() => false)
  if (!typed) throw new Error('写入类目关键词失败')
  await page.keyboard.press('Enter')
  console.log(`[patrol-taobao] 已搜索「${keyword}」，等结果…`)
  await sleep(3000)

  // 点第一个类目结果（真实鼠标，生产同款 nextCategoryCandidate 语义）
  const resultSel = substitutePlaceholders(anchorSpec(cfg, 'cateResultItem').candidates[0].selector)
  let cand = null
  for (let i = 0; i < 10 && !cand; i++) {
    cand = await page.evaluate((sel) => {
      const pool = Array.from(document.querySelectorAll(sel))
      const el = pool.find((e) => (e.offsetWidth || e.offsetHeight) && e.dataset.dsTried !== '1')
      if (!el) return null
      el.dataset.dsTried = '1'
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) }
    }, resultSel).catch(() => null)
    if (!cand) await sleep(1000)
  }
  if (!cand) throw new Error(`关键词「${keyword}」无类目搜索结果 URL=${page.url()}`)
  await page.mouse.move(cand.x, cand.y).catch(() => {})
  await sleep(300)
  await page.mouse.click(cand.x, cand.y).catch(() => {})
  console.log(`[patrol-taobao] ✓ 已点选类目：${cand.text}`)

  // 等属性面板（品牌必填渲染）
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() =>
      document.querySelectorAll('.sell-catProp-item-common .label.required').length).catch(() => 0)
    if (n > 0) break
    await sleep(500)
  }

  // 「确认，下一步」可用则直接点；不可用 → 选品牌下拉第一项作「导航过路费」再点（不提交，无真实副作用）
  const submitReady = () => page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find((x) => /^(确认，下一步|确认下一步|下一步|确认)$/.test((x.innerText || '').trim()) && (x.offsetWidth || x.offsetHeight))
    return !!b && b.disabled !== true
  }).catch(() => false)

  let ready = false
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    ready = await submitReady()
    if (ready) break
    await sleep(500)
  }
  if (!ready) {
    console.log('[patrol-taobao] 「确认，下一步」禁用（必填属性未填）→ 选品牌下拉第一项作导航过路费…')
    const brandSel = substitutePlaceholders(anchorSpec(cfg, 'brandOptionItem').candidates[0].selector)
    let brandOpts = []
    for (let attempt = 0; attempt < 4 && !brandOpts.length; attempt++) {
      brandOpts = await page.evaluate((sel) => {
        const w = document.querySelector('.next-overlay-wrapper.opened')
        if (!w) return []
        return Array.from(w.querySelectorAll(sel))
          .filter((e) => e.offsetWidth || e.offsetHeight)
          .map((e) => (e.getAttribute('title') || e.innerText || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      }, brandSel).catch(() => [])
      if (brandOpts.length) break
      const br = await page.evaluate(() => {
        const it = Array.from(document.querySelectorAll('.sell-catProp-item-common'))
        const hit = it.find((x) => /品牌/.test(x.querySelector('.label')?.textContent || '') && (x.offsetWidth || x.offsetHeight))
        const inp = hit?.querySelector('input')
        if (!inp) return null
        inp.scrollIntoView({ block: 'center' })
        const r = inp.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }).catch(() => null)
      if (!br) break
      await page.mouse.move(br.x, br.y).catch(() => {})
      await sleep(300)
      await page.mouse.click(br.x, br.y).catch(() => {})
      await sleep(1000)
    }
    if (!brandOpts.length) throw new Error('品牌下拉候选 4 轮均未拉到，「确认，下一步」无法解锁')
    const pick = brandOpts[0]
    const pr = await page.evaluate((sel, t) => {
      const w = document.querySelector('.next-overlay-wrapper.opened')
      if (!w) return null
      const el = Array.from(w.querySelectorAll(sel))
        .find((e) => ((e.getAttribute('title') || e.innerText || '').replace(/\s+/g, ' ').trim() === t) && (e.offsetWidth || e.offsetHeight))
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, brandSel, pick).catch(() => null)
    if (!pr) throw new Error(`品牌候选「${pick}」坐标获取失败`)
    await page.mouse.move(pr.x, pr.y).catch(() => {})
    await sleep(300)
    await page.mouse.click(pr.x, pr.y).catch(() => {})
    await sleep(1500)
    console.log(`[patrol-taobao] ✓ 已选品牌（过路费）：${pick}`)

    ready = false
    const d2 = Date.now() + 20_000
    while (Date.now() < d2) {
      ready = await submitReady()
      if (ready) break
      await sleep(500)
    }
    if (!ready) throw new Error('选完品牌后「确认，下一步」仍禁用（可能还有其他必填属性）')
  }

  // 点「确认，下一步」（真实鼠标，生产同款）
  const btn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const b = btns.find((x) => /^(确认，下一步|确认下一步|下一步|确认)$/.test((x.innerText || '').trim()) && (x.offsetWidth || x.offsetHeight) && x.disabled !== true)
    if (!b) return null
    b.scrollIntoView({ block: 'center' })
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }).catch(() => null)
  if (!btn) throw new Error('「确认，下一步」按钮不可点')
  await page.mouse.move(btn.x, btn.y).catch(() => {})
  await sleep(200)
  await page.mouse.click(btn.x, btn.y).catch(() => {})
  console.log('[patrol-taobao] ✓ 已点「确认，下一步」，等发布页新标签页…')

  // waitForPublishTab（生产同款：排除原页）
  let formPage = null
  const wDeadline = Date.now() + formWaitMs
  while (Date.now() < wDeadline) {
    const pages = await browser.pages().catch(() => [])
    formPage = pages.find((p) => {
      try { return p !== page && /sell\/v2\/publish\.htm\?.*catId=/i.test(String(p.url() || '')) } catch { return false }
    })
    if (formPage) break
    await sleep(1000)
  }
  if (!formPage) throw new Error(`发布页标签页 ${formWaitMs}ms 未出现。当前页 URL=${page.url()}`)
  await formPage.bringToFront().catch(() => {})
  await formPage.setViewport({ width: 1440, height: 900 }).catch(() => {})

  // formReady 就绪轮询
  const formSel = anchorSpec(cfg, 'formReady').candidates.map((c) => substitutePlaceholders(c.selector)).join(', ')
  const fDeadline = Date.now() + formWaitMs
  let formReady = false
  while (Date.now() < fDeadline) {
    formReady = await formPage.evaluate((s) => !!document.querySelector(s), formSel).catch(() => false)
    if (formReady) break
    await sleep(2000)
  }
  if (!formReady) throw new Error(`发布页 ${formWaitMs}ms 未就绪 URL=${formPage.url()}`)
  console.log('[patrol-taobao] ✓ 发布页就绪:', formPage.url())

  return { categoryPage: page, formPage, keyword, picked: cand.text }
}

/** taobao 现场读类目属性名（复刻 readCatPropItems，src/taobao-publish.ts L1013-1040） */
async function taobaoReadAttrNames(page) {
  return page.evaluate(() => {
    const root = document.getElementById('struct-catProp')
    if (!root) return []
    const items = Array.from(root.querySelectorAll('[id^="struct-p-"]'))
    return items.map((it) => {
      const field = document.getElementById('sell-field-' + it.id.replace(/^struct-/, ''))
      const name = (field?.querySelector('.sell-component-info-wrapper-label')?.innerText || '')
        .replace(/[*＊]/g, '').replace(/\s+/g, '')
      return name
    }).filter(Boolean)
  }).catch(() => [])
}

// ─── xianyu：直接打开发布页 + 登录判定 ───
async function patrolXianyu(browser, page, cfg) {
  const { configString, anchorSpec } = await libImport('services/publish-config-loader.js')
  const publishUrl = configString(cfg, 'urls', 'publish', 'https://www.goofish.com/publish')
  const loginRe = new RegExp(String(cfg.anchors?.loginRequiredRe || '立即登录|登录后可以'))

  console.log('[patrol-xianyu] 打开发布页…')
  await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(3000)

  // 登录判定（生产同款：未登录不跳转，原地渲染「立即登录」）
  const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
  if (loginRe.test(bodyText)) throw new Error(`闲鱼登录失效（命中 loginRequiredRe）URL=${page.url()}`)

  // 等发布页就绪（imageInput）
  const imgSel = substitutePlaceholders(anchorSpec(cfg, 'imageInput').candidates[0].selector)
  let ready = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    ready = await page.evaluate((s) => !!document.querySelector(s), imgSel).catch(() => false)
    if (ready) break
    await sleep(2000)
  }
  if (!ready) throw new Error(`闲鱼发布页 30s 未就绪（无 ${imgSel}）URL=${page.url()}`)
  console.log('[patrol-xianyu] ✓ 发布页就绪:', page.url())
  return { categoryPage: null, formPage: page }
}

// ─── 报告输出（三级判定） ───
function printReport(platform, keyword, reporter, fpResult) {
  const { results, evidence } = reporter
  const lines = []
  lines.push('══════════════════════════════════════════════')
  lines.push(`巡检报告：${platform}${keyword ? `（类目：${keyword}）` : ''}  ${new Date().toISOString()}`)

  // 锚点结果
  const ok = results.filter((r) => r.status === 'ok')
  const conditional = results.filter((r) => r.status === 'conditional')
  const shorthand = results.filter((r) => r.status === 'shorthand')
  const skipped = results.filter((r) => r.status === 'skipped')
  const lost = results.filter((r) => r.status === 'lost')
  lines.push('')
  lines.push(`── 锚点命中（${ok.length}）──`)
  for (const r of ok) {
    const how = r.textHit ? `text:「${r.textHit}」` : `L${r.level} ${r.selector}`
    lines.push(`  ✓ ${r.key}  ←  ${how}`)
  }
  if (conditional.length) {
    lines.push('')
    lines.push(`── 条件型-未触发（${conditional.length}，未命中≠改版）──`)
    for (const r of conditional) lines.push(`  ○ ${r.key}  ${r.note}`)
  }
  if (shorthand.length) {
    lines.push('')
    lines.push(`── 字符串简写锚点（${shorthand.length}，未打点）──`)
    for (const r of shorthand) lines.push(`  · ${r.key}  ${r.note}`)
  }
  if (skipped.length) {
    lines.push('')
    lines.push(`── 未到达页面（${skipped.length}）──`)
    for (const r of skipped) lines.push(`  - ${r.key}  ${r.note}`)
  }
  if (lost.length) {
    lines.push('')
    lines.push(`── 失联锚点（${lost.length}）── 疑似平台改版，按提示改 JSON ──`)
    for (const r of lost) {
      lines.push(`  ✗ ${r.key}`)
      for (const a of r.attempts || []) lines.push(`      候选(L${a.level}): ${a.selector} —— ${a.reason}`)
    }
  }

  // 指纹比对
  lines.push('')
  lines.push('── 类目属性 schema 指纹（只读比对，不落盘）──')
  if (!fpResult) {
    lines.push('  · 本平台无属性缓存链路，跳过')
  } else {
    const icon = { ok: '✓', first: '◇', 'fingerprint-changed': '⚠', 'no-data': '·' }[fpResult.status] || '·'
    lines.push(`  ${icon} ${fpResult.status}：${fpResult.note}`)
    if (fpResult.status === 'fingerprint-changed') {
      lines.push('      （生产发布时会自动失效该类目属性缓存桶，属性走模型重填——无需人工处理）')
    }
  }

  // 证据
  if (evidence.length) {
    lines.push('')
    lines.push(`── 失联证据（截图 + DOM 片段）──`)
    for (const e of evidence) lines.push(`  📸 ${e.key}: ${e.screenshot} / ${e.domFile}`)
  }

  // 三级判定收尾
  const verdict = verdictOf([...results, ...(fpResult?.status === 'fingerprint-changed' ? [{ status: 'fingerprint-changed' }] : [])])
  lines.push('')
  lines.push('══════════════════════════════════════════════')
  if (verdict === 'green') {
    lines.push('✅ 三级判定：全绿 —— 锚点全部命中，指纹一致/首记')
  } else if (verdict === 'yellow') {
    lines.push('🟡 三级判定：指纹变化 —— 锚点全命中，但类目属性结构变了（缓存失效机制会自动处理）')
  } else {
    lines.push(`🔴 三级判定：失联 —— ${lost.length} 个锚点全部候选未命中，疑似平台改版`)
    lines.push('   → 修复路径：PUBLISH-SPEC §3.5 —— 打开失联证据截图/DOM，在 publish-config/ 补新候选，5 分钟改一行 JSON')
  }
  lines.push('══════════════════════════════════════════════')
  console.log(lines.join('\n'))
  return verdict
}

// ─── 主流程 ───
async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--selftest') {
    const ok = await selftest()
    process.exit(ok ? 0 : 1)
  }

  const platform = args[0]
  if (!platform || !PLATFORM_META[platform]) {
    console.error('用法：node dev/patrol-publish.mjs <pdd|taobao|xianyu> [类目关键词] [账号过滤]')
    console.error('      node dev/patrol-publish.mjs --selftest   # 内置自检（不启动浏览器）')
    process.exit(1)
  }
  const meta = PLATFORM_META[platform]
  const keyword = args[1] || meta.defaultKeyword
  const accountFilterText = args[2] || ''

  // ── 配置与依赖加载 ──
  const { loadPublishConfig, anchorSpec } = await libImport('services/publish-config-loader.js')
  const cfg = loadPublishConfig(platform)

  // ── 选账号（生产同款过滤） ──
  const storeMod = await libImport('services/credential-store.js').catch(() => null)
  if (!storeMod?.CredentialStore) {
    console.error('❌ 无法加载 lib/services/credential-store.js —— 请先 npm run build:host')
    process.exit(1)
  }
  const cs = new storeMod.CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
  let accounts = []
  try { accounts = cs.listAccounts().filter(meta.accountFilter) } catch (e) {
    console.error('listAccounts 调用失败:', e?.message || e)
  }
  if (!accounts.length) {
    console.error(`❌ 凭证库里没有 ${platform} 可用账号`)
    process.exit(1)
  }
  if (accountFilterText) accounts = accounts.filter((a) => String(a.shop_key || '').includes(accountFilterText))
  if (!accounts.length) {
    console.error(`❌ 没有匹配「${accountFilterText}」的 ${platform} 账号`)
    process.exit(1)
  }
  const account = accounts[0]
  const profileDir = join(homedir(), '.dsh', 'browser-profiles', 'accounts', account.shop_key)
  console.log(`[patrol] 平台=${platform} 账号=${account.display_label || account.account_id}（${account.shop_key}）`)
  console.log(`[patrol] Profile=${profileDir}（存在=${existsSync(profileDir)}）`)

  // ── 启动（蓝本同款 + xianyu 清锁重试先例） ──
  const require = createRequire(import.meta.url)
  const puppeteer = require('puppeteer-core')
  const { findChromePath, clearProfileLocks } = await libImport('browser-login.js')
  const chromePath = findChromePath()
  if (!chromePath) { console.error('❌ 未找到 Chrome/Edge'); process.exit(1) }

  const launchOpts = {
    headless: false,
    executablePath: chromePath,
    userDataDir: profileDir,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  }
  let browser
  try {
    browser = await puppeteer.launch(launchOpts)
  } catch (e) {
    // 生产先例（xianyu-publish.ts L392-399）：launch 失败清锁重试一次
    console.warn(`[patrol] launch 失败（${e?.message || e}），清 Profile 锁重试一次…`)
    clearProfileLocks?.(profileDir)
    await sleep(2000)
    browser = await puppeteer.launch(launchOpts)
  }
  console.log(`[patrol] Chrome 已启动（${chromePath}）`)

  const reporter = createReporter()
  let verdict = 'red'
  let navError = null

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // Cookie 注入（生产同款双域 flatMap）
    const cookieList = Object.entries(account.cookies || {})
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => meta.cookieDomains.map((domain) => ({ name, value: String(value), domain, path: '/' })))
    if (cookieList.length) await page.setCookie(...cookieList)
    console.log(`[patrol] 已注入 ${cookieList.length} 个 Cookie（双域 × ${meta.cookieDomains.length}）`)

    // ── 平台导航 ──
    let nav
    if (platform === 'pdd') nav = await patrolPdd(browser, page, cfg, keyword)
    else if (platform === 'taobao') nav = await patrolTaobao(browser, page, cfg, keyword)
    else nav = await patrolXianyu(browser, page, cfg)

    // ── 锚点逐个打点（按锚点→页面映射） ──
    // pdd：类目页锚点 {cateSearchInput, step1Ready, cateConfirmButton}（走查时已验，这里复验）→ 其余在表单页
    // taobao：类目页锚点 {cateSearchInput, cateResultItem, brandPropItem, brandOptionItem} → 其余在发布页
    // xianyu：全在发布页
    const categoryPageAnchors = {
      pdd: ['cateSearchInput', 'step1Ready', 'cateConfirmButton'],
      taobao: ['cateSearchInput', 'cateResultItem', 'brandPropItem', 'brandOptionItem'],
      xianyu: [],
    }[platform] || []
    const pages = (key) => (categoryPageAnchors.includes(key) ? nav.categoryPage : nav.formPage)

    console.log(`[patrol] 开始逐锚点打点（${Object.keys(cfg.anchors || {}).length} 个）…`)
    await probeAllAnchors(platform, cfg.anchors || {}, (k) => anchorSpec(cfg, k), pages, reporter)

    // ── 指纹比对（pdd/taobao；xianyu 无属性缓存链路） ──
    let fpResult = null
    if (platform === 'pdd') {
      fpResult = await compareFingerprint(platform, meta.cachePlatform, keyword, () => pddReadAttrNames(nav.formPage))
    } else if (platform === 'taobao') {
      fpResult = await compareFingerprint(platform, meta.cachePlatform, keyword, () => taobaoReadAttrNames(nav.formPage))
    }
    verdict = printReport(platform, keyword, reporter, fpResult)
  } catch (e) {
    navError = e
    console.error(`\n❌ 巡检中断：${e?.message || e}`)
    if (e?.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'))
    // 导航失败也输出已收集的部分报告（锚点打点可能已部分完成）
    if (reporter.results.length) {
      console.log('[patrol] 导航失败，输出已收集的部分锚点结果：')
      printReport(platform, keyword, reporter, null)
    }
  } finally {
    console.log('[patrol] 关闭浏览器…')
    await browser.close().catch(() => {})
    await sleep(2000) // 还 SingletonLock（蓝本同款）
  }

  if (navError) process.exit(2)
  process.exit(verdict === 'green' ? 0 : verdict === 'yellow' ? 3 : 4)
}

// 直接执行时跑 main；被 import（回归测试）时不跑
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((e) => {
    console.error('❌ 未捕获异常:', e)
    process.exit(1)
  })
}
