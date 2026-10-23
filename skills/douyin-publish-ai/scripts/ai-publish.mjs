#!/usr/bin/env node
/**
 * 抖音小店 · AI 发品物料准备（douyin-publish-ai）
 *
 * 思路：抖店发布页是「上传材料 → AI 识别 → 生成商品信息」的两级流程。
 * 本技能把第一级（AI 识别）跑通，产出**物料包**（推荐标题/类目/主图 URL），
 * 交给 douyin-publish-mqs 做真实提交（L2 门禁在那个技能）。
 *
 * 为什么不走 HTTP 改包（对标 pdd-publish-http）：
 *   抖店的会话是 publish_id 有状态链路，材料每次变更都要
 *   notify_material_change 上报，服务端推进度；标题/类目由 AI 从图片提取。
 *   绕过 DOM 会丢状态机，且要同时逆向 a_bogus + AI 协议，成本远高于收益。
 *
 * 用法：
 *   node ai-publish.mjs --mode material --images D:\a.jpg,D:\b.jpg
 *   node ai-publish.mjs --mode config
 *   node ai-publish.mjs --mode check
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

const MODE = (ARGS.mode || 'material').trim()
const IMAGES = (ARGS.images || '').split(',').map((s) => s.trim()).filter(Boolean)
const EXCEL = (ARGS.excel || '').trim()
const TITLE_OVERRIDE = (ARGS.title || '').trim()
const OUT_DIR = (ARGS.out || '').trim() || join(process.cwd(), 'artifacts', 'douyin-publish-ai')
const ACCOUNT = (ARGS.account || '').trim()

// 必须是**单行** JSON：宿主按行读取 __DSAGENT_RESULT__ 协议
function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (msg) => console.error('[douyin-publish-ai] ' + msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 账号选择 ──────────────────────────────────────────────
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
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop，需有抖店商家权限）。')
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

const dir = profileDir('douyin_shop', account.shop_key)
if (!tryAcquireProfile(dir, 'douyin-publish-ai')) {
  fail('api_error', '抖店的浏览器环境正被其他任务占用，请稍后重试。')
}
clearProfileLocks(dir)

// ── 参数前置校验（未过校验不必起浏览器）──────────────────
const MAX_IMAGES = 50
const MAX_IMG_MB = 5
const MAX_FILE_MB = 1

function validateLocalFiles(paths, maxCount, maxMB, label) {
  if (!paths.length) return
  if (paths.length > maxCount) fail('api_error', `${label}超过 ${maxCount} 个（当前 ${paths.length} 个）`)
  for (const p of paths) {
    if (!existsSync(p)) fail('api_error', `${label}文件不存在：${p}`)
    const mb = statSync(p).size / 1024 / 1024
    if (mb > maxMB) fail('api_error', `${label}文件超过 ${maxMB}MB：${p}（${mb.toFixed(2)}MB）`)
  }
}

if (MODE === 'material') {
  if (!IMAGES.length) {
    releaseProfile(dir)
    fail('api_error', 'material 模式需要 --images 参数（本地图片路径，英文逗号分隔）。例：--images D:\\a.jpg,D:\\b.jpg')
  }
  validateLocalFiles(IMAGES, MAX_IMAGES, MAX_IMG_MB, '图片')
  if (EXCEL) validateLocalFiles([EXCEL], 1, MAX_FILE_MB, 'Excel')

  // ★ 主图宽高比必须是 1:1（实测：非 1:1 图上传后页面出「长宽比需为1:1」按钮，
  //   AI 流程直接卡住，不返回推荐标题/类目）。这里前置读图片尺寸拦截，
  //   避免白跑一轮浏览器（一次约 40s）。
  //   用 PNG/JPEG 头解析，无需图像库。
  const ratioWarn = []
  const smallWarn = []
  for (const p of IMAGES) {
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
      if (w && h) {
        const r = w / h
        // 容差 2%：平台前端按四舍五入判断，1:1 边界图偶有 1.001 的比例
        if (Math.abs(r - 1) > 0.02) {
          ratioWarn.push(`${p}（${w}×${h}，比例 ${r.toFixed(3)}）`)
        } else if (w < 600 || h < 600) {
          // 平台原文：「至少包含一张不小于600*600的商品图」
          smallWarn.push(`${p}（${w}×${h}）`)
        }
      }
    } catch { /* 读不了尺寸不拦截，交给平台报错 */ }
  }
  if (ratioWarn.length) {
    releaseProfile(dir)
    fail('api_error',
      '主图宽高比必须为 1:1，以下图片不符：\n  ' + ratioWarn.join('\n  ')
      + '\n\n平台在上传后会用「长宽比需为1:1」拦住 AI 流程（不返回推荐标题/类目），'
      + '所以这里前置拦截。请先把图片裁成正方形（≥600×600）再试。',
      { badRatio: ratioWarn })
  }
  if (smallWarn.length) {
    releaseProfile(dir)
    fail('api_error',
      '商品图需不小于 600×600（平台原文），以下图片偏小：\n  ' + smallWarn.join('\n  ')
      + '\n请换高清图（建议 ≥800×800）再试。',
      { tooSmall: smallWarn })
  }
} else if (!['config', 'check'].includes(MODE)) {
  releaseProfile(dir)
  fail('api_error', `未知 mode：${MODE}。可用：material / config / check`, { mode: MODE })
}

mkdirSync(OUT_DIR, { recursive: true })

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
  await injectRiskBypass(page)   // 风控绕过：拦掉检测请求，不过滑块

  await page.setCookie(...Object.entries(account.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => [
      { name: n, value: String(v), domain: '.jinritemai.com', path: '/' },
      { name: n, value: String(v), domain: '.douyin.com', path: '/' },
    ]))

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // ── hook AI 链路接口（key = path 片段）──────────────────
  // 判据：抖店域 st===0
  // ★ 2026-10 深挖结论：AI 标题的真正来源是「预测任务」两接口，不是 getRecommendTitle。
  //   submitPredictTask(scene=5) → task_id → getPredictTask 轮询（1s 间隔，30s 超时）
  //   → data.product_info.title_candidates[] 即 AI 推荐标题。
  //   getRecommendTitle 是页面「AI 推荐/换一批」按钮的手动刷新（action_type=manual），
  //   自动流程不触发它（action_type=auto 那条是误判，实测不返回）。
  const APIS = [
    ['uploadConfig',  '/product/tproduct/ai_publish/get_config'],
    ['batchUpload',   '/product/img/batchupload'],
    ['traceId',       '/product/tproduct/material/generateMaterialTraceId'],
    ['notifyChange',  '/product/tproduct/ai_publish/notify_material_change'],
    ['submitPredict', '/product/tproduct/submitPredictTask'],
    ['getPredict',    '/product/tproduct/getPredictTask'],
    ['recommendTitle','/product/tproduct/getRecommendTitle'],
    ['badWordHint',   '/product/tproduct/getBadWordHint'],
    ['canCreate',     '/product/tproduct/canCreateGood'],
    ['allowlist',     '/product/tproduct/isInAllowlist'],
    ['toolsSchema',   '/product/tproduct/material/imageTextVideo/getOptimizationToolsSchema'],
  ]
  const byApi = {}
  const rawBodies = []
  const predictPolls = []   // getPredictTask 的历次响应（看进度推进）

  cdp.on('Network.responseReceived', async (e) => {
    try {
      const u = e.response.url
      if (!/jinritemai\.com/.test(u)) return
      if (!/json|text|plain/.test(e.response.mimeType || '')) return
      if (e.response.status !== 200) return
      const hit = APIS.find(([, frag]) => u.includes(frag))
      if (!hit) return
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const body = b.body || ''
      let j = null
      try { j = JSON.parse(body) } catch { /* ignore */ }
      if (!j) return
      rawBodies.push({ key: hit[0], url: u.slice(0, 300), body: body.slice(0, 4000) })
      if (j.st === 0 || j.code === 0 || j.code === '0' || j.success === true) {
        byApi[hit[0]] = j.data ?? j
        // getPredictTask 会被轮询多次，保留最后一次 success 的（title_candidates 在里面）
        if (hit[0] === 'getPredict') {
          predictPolls.push(j.data ?? j)
          const d = j.data ?? j
          if (d?.task_status === 'success') byApi.predictResult = d
        }
      }
    } catch { /* 单条失败不阻断 */ }
  })

  log('open https://fxg.jinritemai.com/ffa/g/create')
  await page.goto('https://fxg.jinritemai.com/ffa/g/create', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(13000)
  if (/\/login|passport/i.test(page.url())) {
    fail('token_expired', '抖店后台登录态已失效，请到「账号连接」页面对该账号重新登录后重试。')
  }

  // ── mode: config ────────────────────────────────────────
  if (MODE === 'config') {
    const cfg = byApi.uploadConfig?.pub_by_pic_pc?.upload_config || null
    emit({
      ok: true, mode: MODE, shopKey: account.shop_key,
      uploadConfig: cfg ? {
        fileTypes: cfg.file_types || [],
        maxCount: cfg.max_count ?? null,
        maxImgMB: cfg.max_size_for_img_mb ?? null,
        maxFileMB: cfg.max_size_for_file_mb ?? null,
      } : null,
      canCreate: byApi.canCreate?.can_create ?? null,
      grays: byApi.allowlist ? byApi.allowlist.map((x) => ({ name: x.list_name, allow: x.is_allow })) : [],
      text: cfg
        ? `AI 发品上传配置：\n  支持类型：${(cfg.file_types || []).join(' / ')}\n`
          + `  最多 ${cfg.max_count ?? '?'} 个文件 | 图片 ≤${cfg.max_size_for_img_mb ?? '?'}MB | Excel ≤${cfg.max_size_for_file_mb ?? '?'}MB\n`
          + `  可发品：${byApi.canCreate?.can_create === 1 ? '是' : '否'}`
        : 'AI 发品上传配置：暂无数据（接口未返回）',
    })
  } else if (MODE === 'check') {
    // ── mode: check ───────────────────────────────────────
    emit({
      ok: true, mode: MODE, shopKey: account.shop_key,
      canCreate: byApi.canCreate?.can_create ?? null,
      banner: byApi.canCreate?.banner_reason ?? null,
      grays: byApi.allowlist ? byApi.allowlist.map((x) => ({ name: x.list_name, allow: x.is_allow })) : [],
      text: byApi.canCreate
        ? `发品检查：${byApi.canCreate.can_create === 1 ? '✅ 可以发品' : '❌ 不可发品'}\n`
          + (byApi.canCreate.banner_reason?.top_error_tips ? `  错误提示：${byApi.canCreate.banner_reason.top_error_tips}\n` : '')
          + (byApi.canCreate.banner_reason?.top_warning_tips ? `  警告提示：${byApi.canCreate.banner_reason.top_warning_tips}\n` : '')
        : '发品检查：暂无数据（接口未返回）',
    })
  } else {
    // ── mode: material ────────────────────────────────────
  log(`上传 ${IMAGES.length} 张图${EXCEL ? ' + 1 个 Excel' : ''}`)
  try {
    const fi = await page.$('input[type=file]')
    if (!fi) fail('api_error', '未找到上传控件（input[type=file]）——页面可能已改版')
    // 图片与 Excel 可一并上传（accept 同时包含图片与表格类型）
    const files = EXCEL ? [...IMAGES, EXCEL] : IMAGES
    await fi.uploadFile(...files)
    log('已上传，等待 AI 识别…')
    await sleep(15000)
  } catch (e) {
    fail('api_error', `上传失败：${e?.message || String(e)}`)
  }

  // ★ 点「下一步，生成商品」→ 页面发起 submitPredictTask(scene=5) 拿 task_id，
  //   然后按 1s 间隔轮询 getPredictTask，直到 task_status=success。
  //   推荐标题在最后一次 success 的 data.product_info.title_candidates[] 里。
  //   （上传后先等是没用的——预测任务由点下一步触发，这是实测结论。）
  const nextClicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent || '').includes('下一步'))
    if (el) { el.click(); return true }
    return false
  })
  log(`点「下一步，生成商品」：${nextClicked ? '成功' : '未找到按钮'}`)

  // 等预测任务出结果（页面侧轮询，我们只 hook 响应；最多等 45s）
  const PREDICT_WAIT_MS = 45000
  const deadline = Date.now() + PREDICT_WAIT_MS
  let predictResult = byApi.predictResult || null
  while (Date.now() < deadline && !predictResult) {
    await sleep(1500)
    predictResult = byApi.predictResult || null
  }
  log(`AI 预测任务：${predictResult ? `✅ success（task_id=${predictResult.task_id}）` : '⏳ 未拿到 success 结果'}`)

  // 抓页面上的 AI 推荐结果（标题候选 + 类目）
  const pageState = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')]
      .map((i) => ({ ph: i.placeholder || '', val: (i.value || '').slice(0, 80) }))
      .filter((x) => x.val || /标题|字符/.test(x.ph))
    const titleInput = inputs.find((x) => /请输入2-60个字符|标题/.test(x.ph))
    return {
      url: location.href,
      titleInput: titleInput || null,
      buttons: [...document.querySelectorAll('button,[role=button]')]
        .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, 25),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1500),
    }
  })

  // AI 推荐标题：**三路取证**（按优先级）
  //   ① 预测任务 getPredictTask 的 product_info.title_candidates[]（权威，主路径）
  //   ② 接口 getRecommendTitle 的 recommend_titles[]（页面「AI 推荐/换一批」手动刷新才有）
  //   ③ 页面文本里「AI 推荐」附近的候选（兜底）
  const productInfo = predictResult?.product_info || {}
  const titlesFromPredict = Array.isArray(productInfo.title_candidates) ? productInfo.title_candidates : []
  const titlesFromApi = byApi.recommendTitle
    ? (byApi.recommendTitle.recommend_titles || byApi.recommendTitle.titles || [])
    : []
  const titlesFromPage = ((pageState.bodyText.match(/AI推荐\s*(.+?)(换一批|确认信息|$)/) || [])[1] || '')
    .split(/\s{2,}|\n/).map((s) => s.trim()).filter((s) => s.length > 4)
  const titleCandidates = [...new Set([
    ...titlesFromPredict, ...titlesFromApi, ...titlesFromPage,
  ])].filter(Boolean).slice(0, 5)

  // 标题输入框里的值（AI 可能已自动填入第一个候选）
  const aiTitle = pageState.titleInput?.val || TITLE_OVERRIDE || titleCandidates[0] || null

  // 预测任务产出的其它结构化信息（比页面文本可靠）
  const mainPics = Array.isArray(productInfo.main_pics) ? productInfo.main_pics : []
  const detailMaterials = Array.isArray(productInfo.detail_materials) ? productInfo.detail_materials : []
  const predictNodes = (predictResult?.loading_info?.nodes || []).map((n) => ({
    label: n.label, status: n.status, key: n.key,
  }))

  // 类目识别：优先预测任务产物，其次页面文本
  const categoryFromPage = (pageState.bodyText.match(/(?:商品类目|类目)\s*([^\n]{2,60}?)(?:\s{2,}|手动选择|确认信息|$)/) || [])[1]?.trim() || null

  // 主图 CDN URL（batchUpload 返回）
  const uploadedUrls = Array.isArray(byApi.batchUpload) ? byApi.batchUpload : []
  const traceId = byApi.traceId?.trace_id || null

  // 组装物料包
  const material = {
    createdAt: new Date().toISOString(),
    shopKey: account.shop_key,
    source: 'douyin-publish-ai',
    images: { local: IMAGES, uploadedUrls },
    excel: EXCEL || null,
    traceId,
    // ── AI 预测任务产物（权威来源）──
    predict: predictResult ? {
      taskId: predictResult.task_id ?? null,
      taskStatus: predictResult.task_status ?? null,
      taskType: predictResult.task_type ?? null,
      titleCandidates: titlesFromPredict,
      mainPics,
      detailMaterials,
      nodes: predictNodes,
    } : null,
    aiTitle,
    aiCategory: categoryFromPage,
    titleCandidates,
    finalTitle: TITLE_OVERRIDE || aiTitle || null,
    badWordHint: byApi.badWordHint || null,
    pageState: { url: pageState.url, buttons: pageState.buttons },
    rawApis: rawBodies,
  }

  const outFile = join(OUT_DIR, `material-${Date.now()}.json`)
  writeFileSync(outFile, JSON.stringify(material, null, 2))

  const lines = []
  lines.push('AI 发品物料包已生成：')
  lines.push(`  上传图片：${IMAGES.length} 张${EXCEL ? ` + Excel ${EXCEL}` : ''}`)
  lines.push(`  主图 CDN：${(uploadedUrls[0] || mainPics[0] || '（未拿到）').slice(0, 80)}`)
  lines.push(`  材料追踪 ID：${traceId || '（未拿到）'}`)
  if (predictResult) {
    lines.push(`  AI 预测任务：${predictResult.task_status}（task_id=${predictResult.task_id}）`)
  } else {
    lines.push('  AI 预测任务：未拿到 success 结果（可重试或换更清晰的图）')
  }
  if (titlesFromPredict.length) {
    lines.push('  AI 推荐标题：')
    for (const t of titlesFromPredict.slice(0, 5)) lines.push(`    · ${t}`)
  } else {
    lines.push(`  AI 推荐标题：${aiTitle || '（未识别到）'}`)
  }
  if (categoryFromPage) lines.push(`  AI 推荐类目：${categoryFromPage}`)
  if (detailMaterials.length) {
    lines.push(`  识别到的详情图素材：${detailMaterials.length} 个`)
  }
  lines.push('')
  lines.push('下一步（L2，需你确认）：用 douyin-publish-mqs 提交，')
  lines.push('  标题用上面 AI 推荐的，或你指定一个；类目/SKU/属性在弹出窗口内确认。')
  lines.push(`物料包文件：${outFile}`)

  emit({
    ok: true,
    mode: MODE,
    shopKey: account.shop_key,
    material: {
      finalTitle: material.finalTitle,
      titleCandidates: material.titleCandidates,
      aiCategory: material.aiCategory,
      uploadedUrls,
      mainPics,
      traceId,
      predict: material.predict,
      localImages: IMAGES,
      excel: EXCEL || null,
    },
    materialFile: outFile,
    text: lines.join('\n'),
  })
  }
} catch (err) {
  fail('api_error', `AI 发品物料准备异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  releaseProfile(dir)
}
