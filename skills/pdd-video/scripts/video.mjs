import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

// ★ 路径推导（替代原硬编码绝对路径）：本文件在 skills/<name>/scripts/ 下，上推三层到插件根
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const PKG_BASE = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
].find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-script-base.json')
/**
 * 拼多多 · 多多视频（pdd-video）
 *
 * 域：live.pinduoduo.com/n-creator/video/home?from=mms
 *     （独立域，mms 扫码后 SSO 自动打通，不用单独登录）
 *
 * ══════════════════════════════════════════════════════════════════
 * 上传链路（2026-10-24 逆向，已实证跑通）
 * ══════════════════════════════════════════════════════════════════
 *   ★ 上传必须走 DOM 注入（input[type=file].uploadFile）
 *     直接调 /live/galerie/signature 会 48143「非法请求」——
 *     该接口依赖页面 SDK 的请求上下文，page.evaluate fetch 复刻不了。
 *     DOM 注入后页面自己走完整 10 步：
 *       ① prePublish/clear            清空待发布队列
 *       ② publish/page/query          发布页配置 + 内容声明清单
 *       ③ galerie/signature           视频上传票据（bucket_tag=backbone-video-sign）
 *       ④ upload_init                 {content_type, create_media, sign}
 *       ⑤ upload_part × N             multipart/form-data
 *       ⑥ upload_complete             {sign: 文件MD5, large_file_size}
 *       ⑦ meta/query                  拿 vid
 *       ⑧ galerie/signature           封面票据（bucket_tag=backbone-cover-b）
 *       ⑨ store_image                 封面上传
 *       ⑩ prePublish/add              加入待发布队列
 *
 * ══════════════════════════════════════════════════════════════════
 * 发布链路（2026-10-24 逆向，参数结构已实证正确）
 * ══════════════════════════════════════════════════════════════════
 *   POST /api/backbone/video/publish
 *   body: { feeds: [feed, ...] }
 *
 *   feed 字段：desc, scheduleTime, goodsIdList, outVideoUrl,
 *     useRecRelatedGoods, anchorDeclarationType, cover,
 *     cutStartTime, cutEndTime, vid, topicId, syncVideo,
 *     needCreateCoverUrl, newPushPxq
 *
 *   anchorDeclarationType: 11=内容无需标注 1=含AI生成 5=含虚构演绎
 *                          7=内容含营销   3=内容为转载 8=个人观点
 *
 * ══════════════════════════════════════════════════════════════════
 * 数据链路（2026-10-24 逆向，已实证）
 * ══════════════════════════════════════════════════════════════════
 *   POST /api/backbone/goods/stats/overview  {dateType, moduleType}
 *        ★ moduleType=1 有数据（商家自营），2 全 null（达人带货）
 *        ★ totalGMVOrigin 单位是「分」，要 /100
 *   POST /api/backbone/goods/stats/trend     {dateType}
 *   GET  /api/backbone/goods/mall/weekly_report
 *   GET  /api/backbone/goods/mall/diagnosis_and_suggest
 *   GET  /api/backbone/goods/show/case
 *   GET  /api/backbone/goods/mall/reject/reason/list
 *
 *   删除：POST /mms/amco/prePublish/delete  {urlList, vidList}
 *         （{videoId}/{vid} 不生效）
 */
const require = createRequire(PKG_BASE)

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

/**
 * 收尾退出。
 *
 * ★ 不要直接用 process.exit()：Node 24 + undici keep-alive socket 还挂着时，
 *   进程退出会撞 libuv 断言（"Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"），
 *   退出码变成 -1073740791 —— 上层会当成崩溃，即使结果已经正常打印。
 *   → 设 exitCode，主动关掉 undici agent，让事件循环自己空掉；1.5s 兜底硬退。
 */
const finish = async (code) => {
  process.exitCode = code
  try {
    const { getGlobalDispatcher } = await import('undici').catch(() => ({}))
    await getGlobalDispatcher?.()?.close?.()
  } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 1500).unref()
}

/**
 * ★ 2026-11-12：**早退必须真正中断**。
 *
 *   背景（d86f088 引入的回归）：那一轮把 `process.exit(0)` 批量换成了 `await finish(0)`，
 *   目的是绕开「undici keep-alive 未关 → 进程退出撞 libuv 断言」。
 *   但 finish() 只做两件事：设 exitCode + 挂一个 **unref** 的 1.5s 定时器 ——
 *   它 **不终止执行流**。unref 的定时器甚至不能保证进程存活到那一刻。
 *
 *   后果（L2 安全门禁失效，实测复现）：
 *     `--mode upload` 不带 --confirm 时，打印完「上传预览 · 需用户确认」后，
 *     代码继续往下跑 → 拉起浏览器 → 真的把视频传上去了。
 *     预览门禁形同虚设 —— 用户没确认也照发。
 *
 *   现在：早退一律走 halt() —— 先关连接池（拿到 finish 的防断言收益），
 *   再 process.exit() 真断。调用点必须自己保证浏览器已关（现有早退点均已 closeBrowser）。
 */
const halt = async (code) => {
  await finish(code)
  process.exit(code)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mode = argOf('mode') || 'list'
const HOME = 'https://live.pinduoduo.com/n-creator/video/home?from=mms'
const has = (n) => process.argv.includes(`--${n}`)
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))
  const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/lib/services/credential-store.js')))
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 默认账号：取最近更新的、有 PASS_ID 的 pdd_mms 账号
  //   不能简单 slice(-1) —— 凭证库顺序不稳定，可能取到没登录 live 域的号
  const mmsAccs = store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.cookies?.['PASS_ID'])
  let SHOP = argOf('account') || mmsAccs.slice(-1)[0]?.shop_key
  if (!SHOP) {
    const any = store.listAccounts().filter(a => a.platform === 'pdd_mms')
    SHOP = argOf('account') || any.slice(-1)[0]?.shop_key
  }
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); await halt(2) }
  if (mmsAccs.length > 1 && !argOf('account')) {
    console.error(`[pdd-video] 多个账号可用，默认取 ${SHOP}；可用 --account 指定：\n` + mmsAccs.map(a => `  ${a.shop_key}  ${a.display_label || ''}`).join('\n'))
  }

  // ★ 2026-11-07：构造统一账号对象（供 pdd-request 走 Node 通道）
  //   有种子时 Node 优先，失败自动降级浏览器；无种子则纯浏览器。
  let ACC = null
  try {
    const accRec = store.listAccounts().find(a => String(a.shop_key) === String(SHOP))
    if (accRec?.cookies) {
      const seedStore = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-seed-store.mjs')).href)
      const seed = seedStore.readSeed(SHOP)
      ACC = { cookies: accRec.cookies, localStorage: seed?.localStorage || {} }
    }
  } catch { /* 无种子也能跑（走浏览器） */ }

  // ★ 2026-11-04 迁移到统一风控闸门（pdd-guard）
  //   原实现只有账号锁，**入口没有冷却检查**（只在出错后的提示里读一次冷却剩余时间），
  //   所以账号已经在 54001/40002 冷却中时，仍会照常启动浏览器、打开页面、
  //   甚至发上传请求——然后才发现被风控，等于白白多打一次风控分。
  //   闸门把「冷却检查 + 健康分 + 账号锁」收敛成一次 openTask，且顺序正确（先判后开）。
  //   ⚠️ 闸门内部已经持有账号锁，**不要再自己 tryAcquireAccountLock**（会自己锁死自己）。
  const { openTask, getVerifyAuthToken } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-guard.mjs')).href)
  const { API: PDD_API } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-api.mjs')).href)
  // 原字面路径 → 注册表逻辑名
  const VIDEO_PATH_MAP = {
    '/mms/amco/prePublish/query': 'video.list',
    '/mms/amco/prePublish/delete': 'video.prePublishDelete',
    '/api/backbone/video/query': 'video.query',
    '/api/backbone/video/publish': 'video.publish',
    '/api/backbone/video/publish_qualification': 'video.publishQualification',
    '/api/backbone/video/publish/page/query': 'video.publishPage',
    '/api/backbone/video/signed_contract/query': 'video.signedContract',
    '/api/backbone/goods/stats/overview': 'video.statsOverview',
    '/api/backbone/goods/stats/trend': 'video.statsTrend',
    '/api/backbone/goods/mall/weekly_report': 'video.weeklyReport',
    '/api/backbone/goods/mall/diagnosis_and_suggest': 'video.mallDiagnosis',
    '/api/orpheus-obs/topic/list': 'video.topicList',
  }
  const guard = await openTask('pdd-video', SHOP, { lockWaitMs: 300_000 })
  if (guard.blocked) {
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `账号 ${SHOP} 当前不可执行：${guard.reason}。期间请勿重复调用（会延长封禁）。`,
    })
    await halt(2)
  }
  guard.startHeartbeat()
  // 收尾统一走 guard.close()（放锁 + 打印汇总）
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })

  // ── upload：文件校验（不启浏览器）──
  const file = argOf('file')
  if (mode === 'upload') {
    if (!file) { emit({ ok: false, failureKind: 'api_error', text: 'upload 模式必须带 --file <视频路径>' }); await halt(2) }
    if (!fs.existsSync(file)) { emit({ ok: false, failureKind: 'api_error', text: `文件不存在：${file}` }); await halt(2) }
    const sizeMB = fs.statSync(file).size / 1024 / 1024
    const ext = path.extname(file).toLowerCase()
    if (!['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.m4v'].includes(ext)) {
      emit({ ok: false, failureKind: 'api_error', text: `不支持的格式 ${ext}（支持 mp4/mov/mkv/webm/avi/flv/wmv/m4v）` }); await halt(2)
    }
    if (sizeMB > 500) { emit({ ok: false, failureKind: 'api_error', text: `文件 ${sizeMB.toFixed(1)}MB 超过 500MB` }); await halt(2) }
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'upload', file,
        text: `【多多视频上传预览 · 需用户确认】\n文件：${path.basename(file)}\n大小：${sizeMB.toFixed(2)}MB\n格式：${ext}\n\n链路（DOM 注入，页面自己走 10 步）：\n  ① prePublish/clear → ② publish/page/query\n  ③ galerie/signature（视频票据）\n  ④ upload_init → ⑤ upload_part × N → ⑥ upload_complete\n  ⑦ meta/query（拿 vid）→ ⑧ 封面票据 → ⑨ store_image → ⑩ prePublish/add\n\n确认后请带 --confirm true 重新调用。\n加 --publish true 可上传后直接发布。`,
      })
      await halt(0)
    }
  }

  // ── delete：预览 ──
  if (mode === 'delete') {
    let vid = argOf('video-id')
    if (!vid && !has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'delete',
        text: `【多多视频删除预览 · 需用户确认】\n\n未指定 --video-id，将删除待发布队列里的**第一个**视频。\n\n用 --mode list 查看队列里的 vid。\n\n确认后请带 --confirm true 重新调用（可加 --video-id 指定）。`,
      })
      await halt(0)
    }
    if (!has('confirm')) {
      emit({
        ok: false, needConfirm: true, mode: 'delete', videoId: vid,
        text: `【多多视频删除预览 · 需用户确认】\n视频 vid：${vid}\n\n删除后不可恢复。\n\n确认后请带 --confirm true 重新调用。`,
      })
      await halt(0)
    }
  }

  // ★ 2026-11-10：**按需开浏览器**。
  //   live 域纯 Node 已打通（anti-content 签名 + live 域专属 L_PASS_ID 票据），
  //   读类模式（list / anchor / qualify / topics）优先不启动浏览器。
  //   只有「上传视频」这种必须走页面 DOM 注入的模式才**启动即开**。
  const NEED_BROWSER = ['upload', 'delete'].includes(mode)
  const BROWSER_ARGS = [
    '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ]
  let browser = null
  let page = null
  // ★ 2026-11-12：读类模式的**懒加载浏览器兜底**。
  //   原实现里 NEED_BROWSER 只有 upload/delete，读类模式 page 恒为 null；
  //   而 pdd-request 的「Node 失败 → 降级浏览器」分支要求传入 page（hasPage），
  //   于是 Node 一旦 40001，直接报错，**一点兜底都没有**。
  //   现在：Node 先跑；只有失败且属于「可兜底错误」时才按需拉浏览器重试一次。
  let ensurePagePromise = null
  let nodeDead = false          // Node 通道已确认不可用 → 本进程后续直接走浏览器，避免每次重撞
  /**
   * 按需拉起浏览器。
   * @param {boolean} navigate 是否顺便打开多多视频首页并等就绪。
   *   upload/delete 走主流程里既有的 goto + waitReady，所以传 false 避免重复等待；
   *   读类兜底需要页面停在 live 域（fetch 的 credentials:'include' 要同源），传 true。
   */
  async function ensurePage(navigate = true) {
    if (page) return page
    if (ensurePagePromise) return ensurePagePromise
    ensurePagePromise = (async () => {
      console.error('[pdd-video] 拉起浏览器…')
      const b = await puppeteer.launch(launchOptions(SHOP, { args: BROWSER_ARGS }))
      const pg = (await b.pages())[0] || await b.newPage()
      await pg.evaluateOnNewDocument(STEALTH_SCRIPT)
      browser = b
      page = pg
      if (navigate) {
        await pg.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
        await waitReady(400, 30000)
      }
      return pg
    })().catch((e) => { ensurePagePromise = null; throw e })
    return ensurePagePromise
  }

  if (NEED_BROWSER || process.argv.includes('--browser')) {
    await ensurePage(false)
  }

  /** 安全关闭浏览器（纯 Node 模式下 browser 为 null，直接跳过） */
  async function closeBrowser() {
    if (!browser) return
    try { await browser.close() } catch { /* ignore */ }
    browser = null
    page = null
    ensurePagePromise = null
  }

  /** 带重试的 evaluate（避开偶发 detached Frame） */
  async function ev(fn, ...args) {
    for (let i = 0; i < 6; i++) {
      try { return await page.evaluate(fn, ...args) }
      catch (e) {
        if (/detached Frame|Target closed|Session closed/i.test(String(e))) { await sleep(2000); continue }
        throw e
      }
    }
    return null
  }
  /** 等页面有内容（★ 不要长等：SSO 会改 URL，等太久页面会空） */
  async function waitReady(minLen = 400, maxMs = 30000) {
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      try {
        const len = await ev(() => (document.body?.innerText || '').length)
        const isLogin = await ev(() => /\/login|\/sso/i.test(location.href))
        if (len > minLen && !isLogin) return true
      } catch { /* ignore */ }
      await sleep(2000)
    }
    return false
  }
  /** 等上传 input 就绪（实测 2 秒内出现） */
  async function waitUploadInput(maxSec = 40) {
    for (let i = 0; i < maxSec / 2; i++) {
      try { const n = await page.$$('input[type="file"]'); if (n.length) return n } catch { /* ignore */ }
      await sleep(2000)
    }
    return []
  }
  /** 统一 POST（走页面会话） */
  // ★ 2026-11-04：接入闸门的 beforeCall —— 每次真实请求前做账号级节流（落盘跨进程）。
  //   原来这两个函数是裸发：没有任何间隔，连续调 N 次就是 N 次连发。
  //   闸门不可用时会 fail-open（allow=true），不阻断业务。
  // ★ 2026-11-05 补 VerifyAuthToken：credentials:'include' 只带 Cookie，
  //   而 VerifyAuthToken 是**请求头**。page.evaluate 的 fetch 绕过了 msfe 插件链，
  //   所以必须手动从页面 cookie 读出来塞进头 —— 否则 cookie 有票但请求不带 = 票白拿。
  // ★ 2026-11-05：路径由基座注册表管理。调用方仍传原字面路径，
  //   这里统一查表替换 —— 这样 PDD 改版只改 pdd-api.mjs，17 个调用点都不用动。
  const resolvePath = (p) => {
    const hit = VIDEO_PATH_MAP[p]
    if (!hit) return p
    const spec = PDD_API[hit]
    return spec ? spec.path : p
  }
  /**
   * ★ 2026-11-07：改走基座统一入口 pdd-request.mjs
   *
   * 好处：
   *   · 自动识别域（live / yingxiao / mms）
   *   · 有 account 时先试纯 Node，失败自动降级浏览器
   *   · 签名位置（header/body）由基座决定，skill 不再关心
   *
   * ★ 2026-11-12：**补齐真正的浏览器兜底**。
   *   基座的降级分支要求传 page（hasPage）；之前读类模式 page 恒为 null，
   *   所以「自动降级浏览器」从来没生效过 —— Node 一失败就是硬失败。
   *   现在按下面的顺序走：
   *     ① page 已存在（upload/delete/--browser）→ 正常传，基座自己降级
   *     ② 纯 Node 调用 → 成功就用
   *     ③ Node 失败且是「可能因为通道问题」的错误 → ensurePage() 拉浏览器重试一次
   *     ④ 浏览器也失败 → 如实报错（不再重试，避免加重风控）
   *
   *   哪些错误值得兜底：40001/43001（票据不在 Node 侧）、54001/54003（签名被拒）、
   *   HTTP 429/430（网关限流，浏览器有时能过）、以及 node 通道异常。
   *   ★ 40002/100001 是接口级持久频控，**不兜底**（重试只会延长封禁）。
   *   ★ 2026-11-22 补：40032（live 域）实证是「凭证库 L_PASS_ID 过期」——
   *      浏览器 Profile 里的 live 票已被 SSO 轮换，凭证库快照没跟上。
   *      实验：凭证库 Cookie → 40032；浏览器当前 Cookie（无签名）→ success:true。
   *      live 域的浏览器兜底用的是页面上下文（新鲜票据），所以 40032 **必须兜底**，
   *      且仅限 live 域（mms 域的 40002 语义不变）。
   */
  const FALLBACK_EC = new Set([40001, 43001, 54001, 54003])
  const shouldFallback = (r, url = '', domain = '') => {
    if (!r) return true                                   // Node 抛异常
    if (r.status === 0) return true                       // 通道层失败（no_channel / 网络）
    if (r.status === 429 || r.status === 430) return true // 网关限流
    const ec = r.raw?.errorCode ?? r.raw?.error_code
    // live 域 40032 = live 票过期（浏览器兜底可自愈）；其余域维持原判
    if (ec === 40032 && (domain === 'live' || /live\.pinduoduo/.test(String(url)))) return true
    return FALLBACK_EC.has(ec)
  }
  let __request = null
  const getRequest = async () => {
    if (!__request) ({ request: __request } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-request.mjs')).href))
    return __request
  }
  const callWithFallback = async (p, bd, opts = {}) => {
    const request = await getRequest()
    const baseOpts = { account: ACC, shopKey: SHOP, guard, domain: 'live', ...opts }

    // ① 已经有页面 → 交给基座（内部就是 Node 优先、失败降级浏览器）
    if (page) {
      return request(p, bd || {}, { ...baseOpts, page })
    }
    // Node 已确认不可用 → 直接浏览器，不再白撞一次
    if (nodeDead) {
      return request(p, bd || {}, { ...baseOpts, page: await ensurePage(), forceBrowser: true })
    }

    // ② 纯 Node
    let r
    try {
      r = await request(p, bd || {}, baseOpts)
    } catch (e) {
      r = { ok: false, status: 0, raw: null, ec: 'node_throw', hint: String(e?.message).slice(0, 120) }
    }
    if (r.ok || !shouldFallback(r, p, baseOpts.domain)) return r

    // ③ 兜底：拉浏览器重试一次
    const why = r.ec ?? r.status ?? 'unknown'
    try {
      const pg = await ensurePage()
      const r2 = await request(p, bd || {}, { ...baseOpts, page: pg, forceBrowser: true })
      if (r2.ok) {
        nodeDead = true
        console.error(`[pdd-video] Node 失败（${why}）→ 浏览器兜底成功`)
      }
      return r2
    } catch (e) {
      // 浏览器也起不来 → 把原始错误如实返回（提示里带上兜底失败原因）
      if (r && typeof r === 'object') {
        r.hint = `${r.hint ? r.hint + '；' : ''}浏览器兜底不可用：${String(e?.message).slice(0, 100)}`
      }
      return r
    }
  }
  const api = async (p, bd, opts = {}) => {
    p = resolvePath(p)
    const r = await callWithFallback(p, bd, opts)
    // ★ 2026-11-12：把 ec / hint / channel 一并带出。
    //   原来只回 {status, json}，上层拿不到「为什么失败」（典型：兜底也起不来时
    //   status=0 / json=null → getQueue 只能报「取数失败：0」，真正原因全丢了）。
    return { status: r.status, json: r.raw, ec: r.ec, hint: r.hint, channel: r.channel }
  }
  /** 统一 GET */
  const apiGet = async (p) => {
    p = resolvePath(p)
    const r = await callWithFallback(p, {}, { method: 'GET' })
    return { status: r.status, json: r.raw, ec: r.ec, hint: r.hint, channel: r.channel }
  }
  /** 取待发布队列
   *
   *  ★ 2026-11-11：**失败必须抛错，不能返回 []**。
   *    原实现 `return r.json?.result?.result?.list || []` —— 接口失败时
   *    `result` 是 undefined → 返回 [] → list 模式报「0 个视频」，
   *    把「没取到」伪装成「本来就没有」，用户完全看不出问题。
   */
  const getQueue = async () => {
    const r = await api('/mms/amco/prePublish/query', { pageSize: 50, pageNum: 1 })
    const j = r?.json
    if (!r || r.status !== 200 || (j && j.success === false)) {
      const code = j?.errorCode ?? j?.error_code ?? r?.ec ?? (r?.status || 'unknown')
      // 通道层失败（status=0，通常 = 浏览器兜底也起不来）时，hint 才是真正原因
      const detail = j?.errorMsg || (r?.status === 0 ? r?.hint : '')
      const e = new Error(
        `待发布队列取数失败：${code}`
        + (detail ? `（${String(detail).slice(0, 160)}）` : '')
        + (r?.channel === 'browser' ? '［已尝试浏览器兜底］' : '')
      )
      e.__apiFail = true
      e.ec = code
      throw e
    }
    return j?.result?.result?.list || j?.result?.list || []
  }

  const out = { ok: true, mode, shopKey: SHOP }

  try {
    // ★ 纯 Node 模式（读类）不需要页面，跳过就绪检查
    if (page) {
      await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
      const ready = await waitReady(400, 30000)
      if (!ready) {
      const url = await ev(() => location.href) || ''
      const len = await ev(() => (document.body?.innerText || '').length) || 0
      out.ok = false; out.failureKind = 'token_expired'
      out.text = [
        '多多视频页面未就绪（30s 内无内容）。',
        `  当前 URL: ${url}`,
        `  页面文本长度: ${len}`,
        '',
        /\/login|\/sso/i.test(url)
          ? '账号在 live.pinduoduo.com（推广/视频域）未登录。\n请到「账号连接」重新扫码登录 pdd_mms（会自动打通 live 域）。'
          : '可能账号选错了。可用 --account <shopKey> 指定已登录的账号。',
        '',
        '可用账号：',
        ...mmsAccs.map(a => `  ${a.shop_key}  ${a.display_label || ''}`),
      ].join('\n')
      await closeBrowser(); emit(out); await halt(2)
      }
      await sleep(6000)
    }

    // ══════════════════ upload（DOM 注入）══════════════════
    if (mode === 'upload') {
      const title = argOf('title') || path.basename(file).replace(/\.[^.]+$/, '')
      const goodsId = argOf('goods-id') ? Number(argOf('goods-id')) : null

      const inputs = await waitUploadInput(40)
      if (!inputs.length) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = '页面找不到上传 input（input[type=file]）'
        await closeBrowser(); emit(out); await halt(2)
      }
      console.error('[pdd-video] DOM 注入文件，页面自己走上传链路...')
      await inputs[0].uploadFile(file)

      // 等上传完成：必须看到「发布面板」出现（内容声明 + 一键发布）
      // ★ 先记录上传前的页面状态，避免被残留面板误导
      const beforeTxt = await ev(() => document.body?.innerText || '') || ''
      const hadPanelBefore = /内容声明/.test(beforeTxt) && /一键发布/.test(beforeTxt)
      console.error(`[pdd-video] 上传前面板状态: ${hadPanelBefore ? '已有面板（可能是上次残留）' : '无面板'}`)

      let uploaded = false
      let panelUp = false   // ★ 上传完成瞬间捕获的「一键发布面板」状态（面板 ~10s 后会被页面收起）
      // ★ 2026-11-23 重大修正：发布面板（内容声明+一键发布）是上传页的【静态表单】，
      //   页面加载完就存在 —— 旧逻辑看到面板就立即判"上传完成"（实测 3s），
      //   导致 0.6MB 视频还在上传中浏览器就被关闭，上传中途被杀 → 队列永远查不到 vid。
      //   真完成信号：出现「上传成功/上传完成」提示，或「上传中/xx%」出现后消失。
      //   都没有时 30s 兜底放行（小文件秒传场景可能不显示进度）。
      let sawProgress = false
      for (let k = 0; k < 40; k++) {
        await sleep(3000)
        const txt = await ev(() => document.body?.innerText || '') || ''
        const prog = /上传中|上传进度|\d+%/.test(txt)
        if (prog) sawProgress = true
        const doneTip = /上传成功|上传完成|发布成功/.test(txt)
        if (doneTip || (sawProgress && !prog) || (!sawProgress && k >= 9)) {
          // ★ 诊断 + 立即捕获面板状态（面板可见窗口只有 ~10s，gate 时再查已消失）
          const pageState = await ev(() => ({ url: location.href.slice(0, 110), title: document.title.slice(0, 40), panel: /一键发布/.test(document.body?.innerText || ''), body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400) })).catch(e => ({ err: String(e.message).slice(0, 60) }))
          panelUp = pageState.panel === true
          console.error(`[pdd-video][页面诊断] ${JSON.stringify(pageState)}`)
          uploaded = true
          console.error(`[pdd-video] 上传等待结束（${(k + 1) * 3}s）sawProgress=${sawProgress} doneTip=${doneTip} len=${txt.length}`)
          break
        }
        if (k % 4 === 0) console.error(`[pdd-video] 等待上传… ${(k + 1) * 3}s len=${txt.length} 进度=${prog}`)
      }
      if (!uploaded) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `上传超时（180s）。页面文本长度 ${beforeTxt.length}，未见发布面板刷新。`
        await closeBrowser(); emit(out); await halt(2)
      }

      // ★ 2026-11-23 重构：绑商品/声明/发布必须在上传完成瞬间（面板存活窗口 ~10-20s）内完成，
      //   队列 vid 查询挪到发布之后（发布成败用 publish 接口响应判定，不依赖 vid 落库）。
      //   旧顺序（先 24s 轮询 vid 再发布）实测把面板窗口耗光 → 绑定/声明/发布全部落空。
      let vid = ''
      let item = null
      const wantPublish = has('publish') && argOf('publish') !== 'false'
      console.error(`[pdd-video][gate] panelUp=${panelUp} wantPublish=${wantPublish} hasPublish=${has('publish')}`)
      if (panelUp && wantPublish) {
        const L = ['', '▶ 执行发布（CDP 点击，绕过 anti-content 强校验）...']

        // ══════════════════════════════════════════════════════════════
        // ★★ 2026-11-06 重大修正：publish 必须走「页面真实点击」，不能用 fetch 直调
        //
        //   根因（已逆向确认）：/api/backbone/video/publish 是强校验接口，
        //   页面点「发布」时浏览器拦截器会注入 anti-content 头（SDK 实时指纹+时间戳），
        //   而 page.evaluate + fetch 走不到那条链路 → 稳定 2000000「账号被判定不适合发布」。
        //
        //   实测对比（同一 vid / 同一 body / 同一 cookie）：
        //     UI 点击  → 带 anti-content: 0aqWfxUk... → ✅ success
        //     fetch 直调 → 无 anti-content             → ❌ 2000000
        //
        //   已验证 3 次成功：7042181647350667660 / 7042221151805764909 / 7042234237740759493
        //
        //   另外两个必要前置（也在此修正）：
        //     ① prePublish/add 绑商品：goodsList:[{goodsId:"字符串", specialType:2}]
        //        ★ specialType=2 对应「商品ID」tab；用 1 或 null 会导致 goodsItemList 仍为空
        //     ② 内容声明必须选（anchorDeclarationType 11=无无需标注）
        // ══════════════════════════════════════════════════════════════
        const declaration = Number(argOf('declaration') || 11)
        const DECL_TEXT = {
          11: '内容无需标注',
          1: '含AI生成内容',
          5: '含虚构演绎内容',
          7: '内容含营销信息',
          3: '内容为转载',
          8: '个人观点，仅供参考',
        }[declaration] || '内容无需标注'

        const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms))
        /** evaluate 带重试（页面重渲染会销毁执行上下文） */
        const ev = async (fn, ...a) => {
          for (let i = 0; i < 12; i++) {
            try { return await page.evaluate(fn, ...a) } catch (e) {
              if (/Execution context|detached|Target closed|Cannot find context/i.test(String(e))) { await sleep2(2500); continue }
              throw e
            }
          }
          return null
        }
        const mouseClick = async (x, y) => { await page.mouse.click(x, y) }

        try {
          await ev(() => { document.querySelectorAll('textarea').forEach((t) => t.blur()) })
          await sleep2(1500)

          // ① 关遮罩/弹窗
          await ev(() => {
            const masks = [...document.querySelectorAll('[class*=mask]')]
            masks.forEach((m) => { if (m.style) m.style.display = 'none' })
            const cls = [...document.querySelectorAll('[class*=close]')].filter((e) => e.offsetParent)
            cls.slice(0, 3).forEach((e) => { try { e.click() } catch {} })
          })
          await sleep2(1500)

          // ② 填描述
          if (argOf('desc')) {
            await ev((d) => {
              const ta = document.querySelector('textarea')
              if (ta) {
                Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, d)
                ta.dispatchEvent(new Event('input', { bubbles: true }))
                ta.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }, argOf('desc'))
            await sleep2(1200)
          }

          // ③ 绑定商品（走「商品ID」tab → specialType 2）
          if (goodsId) {
            L.push(`  绑定商品 ${goodsId}…`)
            await ev(() => {
              const c = [...document.querySelectorAll('*')].filter((e) => (e.innerText || '').trim() === '添加商品' && e.children.length <= 3)
              if (c.length) c[c.length - 1].click()
            })
            await sleep2(1500)
            // 切到「商品ID」tab
            await ev(() => {
              const t = [...document.querySelectorAll('*')].filter((e) => (e.innerText || '').trim() === '商品ID' && e.children.length <= 2)
              if (t.length) t[0].click()
            })
            await sleep2(800)
            // 填商品ID
            await ev((g) => {
              const ins = [...document.querySelectorAll('input')].filter((i) => i.offsetParent && !i.readOnly)
              const t = ins.find((i) => /商品|ID|请输入/i.test(i.placeholder || '')) || ins[0]
              if (t) {
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(t, String(g))
                t.dispatchEvent(new Event('input', { bubbles: true }))
                t.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }, goodsId)
            await sleep2(800)
            // 查询
            await ev(() => {
              const b = [...document.querySelectorAll('button,span,div')].filter((e) => /^(查询|搜索)$/.test((e.innerText || '').trim()) && !e.children.length)
              if (b.length) b[0].click()
            })
            await sleep2(800)
            // 勾选
            await ev(() => {
              const r = [...document.querySelectorAll('input[type=radio]')].filter((x) => x.offsetParent)
              if (r.length) r[0].click()
            })
            await sleep2(600)
            // 下一步
            await ev(() => {
              const b = [...document.querySelectorAll('button,span,div')].filter((e) => (e.innerText || '').trim() === '下一步' && !e.children.length)
              if (b.length) b[0].click()
            })
            await sleep2(1500)
            // 验证绑定
            const q2 = await api('/mms/amco/prePublish/query', { pageSize: 20, pageNum: 1 }).catch(() => null)
            const l2 = q2?.json?.result?.result?.list || q2?.json?.result?.list || []
            const bound = (l2[0]?.goodsItemList || []).length > 0
            L.push(bound ? `  ✅ 商品已绑定（${l2[0].goodsItemList.map((g) => g.goodsId).join(',')}）` : '  ⚠ 商品绑定未生效')
          }

          // ④ 选内容声明（必须，否则发布按钮点不动）
          //   ★ 2026-11-07 加固：选择器会因页面改版/滚动偏移失效，改成
          //     ① 多轮重试（每次重新取坐标）
          //     ② 选完必须校验 input.value / 容器文字真的变了
          //     ③ 兜底用键盘（点开后 ArrowDown + Enter）
          let declOk = false
          for (let tryN = 0; tryN < 4 && !declOk; tryN++) {
            const declPos = await ev(() => {
              const ph = [...document.querySelectorAll('input')].find((i) => /请选择/.test(i.placeholder || '') && i.offsetParent)
              if (!ph) return null
              ph.scrollIntoView({ block: 'center' })
              const r = ph.getBoundingClientRect()
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            })
            if (!declPos) { await sleep2(1500); continue }

            await mouseClick(declPos.x, declPos.y)
            await sleep2(2500)

            // 方式 A：JS 事件点击选项
            await ev((txt) => {
              const c = [...document.querySelectorAll('div,li,span')].filter((e) => {
                const t = (e.innerText || '').trim()
                const r = e.getBoundingClientRect()
                return t.startsWith(txt) && r.width > 100
              })
              if (!c.length) return null
              const el = c[c.length - 1]
              const o = { bubbles: true, cancelable: true, view: window }
              el.dispatchEvent(new MouseEvent('mousedown', o))
              el.dispatchEvent(new MouseEvent('mouseup', o))
              el.dispatchEvent(new MouseEvent('click', o))
              return true
            }, DECL_TEXT)
            await sleep2(1800)

            // 校验
            declOk = await ev((txt) => {
              const ins = [...document.querySelectorAll('input')].filter((i) => i.offsetParent)
              if (ins.some((i) => (i.value || '').includes(txt) || (i.value || '').length > 0 && !/请选择/.test(i.value))) {
                if (ins.some((i) => (i.value || '').includes(txt))) return true
              }
              const all = [...document.querySelectorAll('*')]
              const lab = all.find((e) => (e.innerText || '').trim() === '内容声明')
              if (lab) {
                let p = lab.parentElement
                for (let k = 0; k < 5 && p; k++) {
                  if ((p.innerText || '').includes(txt)) return true
                  p = p.parentElement
                }
              }
              return false
            }, DECL_TEXT)

            // 方式 B：键盘兜底
            if (!declOk) {
              await mouseClick(declPos.x, declPos.y)
              await sleep2(1200)
              await page.keyboard.press('ArrowDown')
              await sleep2(600)
              await page.keyboard.press('Enter')
              await sleep2(1800)
              declOk = await ev((txt) => {
                const all = [...document.querySelectorAll('*')]
                const lab = all.find((e) => (e.innerText || '').trim() === '内容声明')
                if (lab) {
                  let p = lab.parentElement
                  for (let k = 0; k < 5 && p; k++) {
                    if ((p.innerText || '').includes(txt)) return true
                    p = p.parentElement
                  }
                }
                return [...document.querySelectorAll('input')].some((i) => (i.value || '').includes(txt))
              }, DECL_TEXT)
            }

            L.push(declOk ? `  内容声明: ${DECL_TEXT} ✅` : `  ⚠ 内容声明第 ${tryN + 1} 次未选中`)
          }
          if (!declOk) L.push('  ⚠⚠ 内容声明最终未选中，发布大概率无响应')

          // ⑤ ★ 点「发布」—— 必须真实鼠标点击，触发 anti-content 注入
          const pubPos = await ev(() => {
            // ★ 只认文字正好是「发布」或「一键发布」的元素，且可见
            //   不能用 !children.length 过滤（真实按钮内部有 span）
            //   也不能取最后一个（可能点到「取消发布」）
            const cands = [...document.querySelectorAll('button,div,span,a')].filter((e) => {
              const t = (e.innerText || '').trim()
              if (t !== '发布' && t !== '一键发布') return false
              const r = e.getBoundingClientRect()
              if (r.width <= 0 || r.height <= 0) return false
              const st = getComputedStyle(e)
              if (st.display === 'none' || st.visibility === 'hidden') return false
              return true
            })
            if (!cands.length) return null
            // 优先「一键发布」，其次「发布」；同文本取最靠下的（在页面底部按钮区）
            const ones = cands.filter((e) => (e.innerText || '').trim() === '一键发布')
            const pool = ones.length ? ones : cands
            pool.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)
            const el = pool[0]
            el.scrollIntoView({ block: 'center' })
            const r = el.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').trim(), count: cands.length }
          })
          if (!pubPos) throw new Error('找不到发布按钮')

          // 监听 publish 响应
          let pubResp = null
          const onResp = async (res) => {
            if (/backbone\/video\/publish$/.test(res.url())) {
              try { pubResp = await res.json() } catch { /* ignore */ }
            }
          }
          page.on('response', onResp)

          await mouseClick(pubPos.x, pubPos.y)
          L.push(`  已点击「${pubPos.text}」，等待结果…`)
          // 等响应（最多 30s）
          for (let i = 0; i < 30 && !pubResp; i++) await sleep2(1000)
          page.off('response', onResp)

          out.publish = pubResp?.result ?? pubResp
          out.publishCode = pubResp?.errorCode
          out.publishMsg = pubResp?.errorMsg
          out.feedIds = pubResp?.result?.feedIds || []

          if (pubResp?.success) {
            out.ok = true   // ★ 发布成败以 publish 接口响应为准，不再依赖 vid 落库
            L.push(`✅ 发布成功！feedId: ${out.feedIds.join(',')}`)
            L.push('   视频已提交审核，通过后对外展示。')
            try { await api('/mms/amco/prePublish/delete', { urlList: [], vidList: [vid] }) } catch { /* ignore */ }
          } else {
            L.push(`⚠️ 发布返回：errorCode=${out.publishCode ?? '?'} ${out.publishMsg || '(无响应)'}`)
            out.ok = false
            out.failureKind = out.publishCode === 2000000 ? 'no_permission' : 'api_error'
          }
        } catch (e) {
          L.push(`❌ 发布流程异常: ${String(e.message || e).slice(0, 200)}`)
          out.ok = false
          out.failureKind = 'exception'
        }
        out.text += '\n' + L.join('\n')
      } else if (panelUp && !wantPublish) {
        out.text += '\n\n提示：加 --publish true 可上传后直接发布。'
      } else if (!panelUp) {
        out.text += '\n\n⚠️ 发布面板已收起（上传后 ~10-20s），本次无法自动发布——视频需在多多视频后台手动发布，或重跑本次流程。'
      }

      // 队列 vid 查询（发布后落库，仅用于报告与清理；成败判定不依赖它）
      for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(4000)
        const list = await getQueue().catch(() => [])
        console.error(`[pdd-video] 队列查询第 ${attempt + 1} 次：${list.length} 个`)
        if (list.length) {
          item = list.find(v => String(v.title || '').includes(path.basename(file).slice(0, 20))) || list[0]
          vid = item.vid
          break
        }
      }
      out.upload = { vid, via: 'dom-inject', size: fs.statSync(file).size, title: item?.title || title, coverUrl: item?.coverUrl || '' }
      if (vid) out.text += `\n  vid: ${vid}（已入待发布队列）`
      if (!out.ok) process.exitCode = 2
    }

    // ══════════════════ delete ═══════════════════
    else if (mode === 'delete') {
      let vid = argOf('video-id')
      const list = await getQueue()
      if (!vid) {
        if (!list.length) {
          out.ok = false; out.failureKind = 'api_error'
          out.text = '待发布队列已空，没有可删除的视频'
          await closeBrowser(); emit(out); await halt(2)
        }
        vid = list[0].vid
        out.autoPicked = true
      }
      const url = list.find(v => v.vid === vid)?.url || ''
      const r = await api('/mms/amco/prePublish/delete', { urlList: url ? [url] : [], vidList: [vid] })
      out.ok = !!r.json?.success
      out.endpoint = '/mms/amco/prePublish/delete'
      out.request = { urlList: url ? [url] : [], vidList: [vid] }
      const remain = await getQueue()
      out.remaining = remain.length
      if (out.ok && remain.length === 0) {
        out.text = `✅ 已删除（队列已清空）\n  vid: ${vid}${out.autoPicked ? '（自动选取队列第一个）' : ''}`
      } else if (out.ok) {
        out.text = `⚠️ 接口返回成功，但队列还剩 ${remain.length} 个\n` + remain.slice(0, 5).map((v, i) => `  剩 [${i}] ${v.vid}`).join('\n')
      } else {
        out.text = `❌ 删除失败：${JSON.stringify(r.json).slice(0, 250)}`
      }
      if (!out.ok) process.exitCode = 2
    }

    // ══════════════════ list（待发布队列）══════════════════
    else if (mode === 'list') {
      const list = await getQueue()
      out.videos = list.slice(0, limit).map(v => ({
        videoId: v.vid ?? v.videoId,
        title: String(v.title ?? '').slice(0, 80),
        desc: String(v.desc ?? '').slice(0, 120),
        url: v.url ?? '',
        coverUrl: v.coverUrl ?? '',
        cutStartTime: v.cutStartTime ?? null,
        scheduleTime: v.scheduleTime ?? null,
        goodsList: (v.goodsItemList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
      }))
      out.count = list.length
      out.text = out.videos.length
        ? `多多视频待发布队列（${out.videos.length} 个）：\n` + out.videos.map((v, i) =>
            [`  ${i + 1}. ${v.title.slice(0, 50)}`, `     vid: ${v.videoId}`, v.url ? `     ${v.url.slice(0, 90)}` : '', v.goodsList.length ? `     商品 ${v.goodsList.length} 个` : ''].filter(Boolean).join('\n')).join('\n')
        : '多多视频待发布队列：0 个。\n店铺还没发过带货视频。'
    }

    // ══════════════════ published（已发布）══════════════════
    else if (mode === 'published') {
      const status = argOf('status') != null ? Number(argOf('status')) : 1
      const end = Date.now()
      const start = argOf('start') ? new Date(argOf('start')).getTime() : end - 30 * 86400000
      const r = await api('/api/backbone/video/query', { status, pageSize: limit, page: 1, startTime: start, endTime: end })
      const res = r.json?.result
      const feeds = res?.feeds || []
      out.feeds = feeds.map(f => ({
        feedId: f.feedId ?? f.id,
        title: String(f.title ?? f.desc ?? '').slice(0, 80),
        cover: f.cover ?? f.coverUrl ?? '',
        vid: f.vid ?? null,
        status: f.status ?? null,
        playCnt: f.playCnt ?? f.viewCnt ?? f.playCount ?? null,
        likeCnt: f.likeCnt ?? f.likeCount ?? null,
        commentCnt: f.commentCnt ?? f.commentCount ?? null,
        goodsList: (f.goodsList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
      }))
      out.count = feeds.length
      out.total = res?.total ?? null
      out.text = out.feeds.length
        ? `已发布视频（status=${status}，${out.feeds.length} 个${out.total != null ? ` / total ${out.total}` : ''}）：\n` +
          out.feeds.map((f, i) => [`  ${i + 1}. [${f.feedId}] ${f.title.slice(0, 45)}`, `     播放=${f.playCnt ?? '—'} 点赞=${f.likeCnt ?? '—'} 评论=${f.commentCnt ?? '—'}`, f.goodsList.length ? `     商品: ${f.goodsList.map(g => g.name || g.goodsId).slice(0, 3).join('、')}` : ''].filter(Boolean).join('\n')).join('\n')
        : `已发布视频（status=${status}）：0 个\n\nstatus 取值：0~4 有效（5 报 BAD_PARAMS），-1 = 全部`
    }

    // ══════════════════ data（带货数据）══════════════════
    else if (mode === 'data' || mode === 'goods-data') {
      const dateType = Number(argOf('date-type') || 2)      // 1=昨日 2=近7日 3=近30日
      const moduleType = Number(argOf('module-type') || 1)  // 1=商家自营(有数据) 2=达人带货(空)
      const [ovR, trR, wkR, sgR] = await Promise.all([
        api('/api/backbone/goods/stats/overview', { dateType, moduleType }),
        api('/api/backbone/goods/stats/trend', { dateType }),
        apiGet('/api/backbone/goods/mall/weekly_report'),
        apiGet('/api/backbone/goods/mall/diagnosis_and_suggest'),
      ])
      const ov = ovR.json?.result
      const tr = trR.json?.result
      const wk = wkR.json?.result
      const sg = sgR.json?.result
      out.data = { dateType, moduleType, overview: ov, trend: tr, weekly: wk, suggest: sg }

      const DT = { 1: '昨日', 2: '近7日', 3: '近30日' }
      const L = [`多多视频 · 带货数据（${DT[dateType] || dateType}，moduleType=${moduleType}${moduleType === 1 ? ' 商家自营' : ' 达人带货'}）`, '']

      if (ov && ov.totalGMV != null) {
        const pct = (r) => (r == null ? '' : `  较前30日 ${r > 0 ? '+' : ''}${(r * 100).toFixed(2)}%`)
        L.push(`【数据总览】${ov.startPt || ''} ~ ${ov.endPt || ''}`)
        L.push(`  支付金额      ¥${ov.totalGMV}${pct(ov.totalGMVRate)}`)
        L.push(`  支付订单数    ${ov.orderCount}${pct(ov.orderCountRate)}`)
        L.push(`  支付人数      ${ov.orderUV}${pct(ov.orderUVRate)}`)
        L.push(`  发布视频数    ${ov.feedCount}${pct(ov.feedCountRate)}`)
        L.push(`  视频播放次数  ${ov.videoViewCnt}${pct(ov.videoViewCntRate)}`)
        L.push(`  商品曝光次数  ${ov.goodsClkCnt}${pct(ov.goodsClkCntGrowthRate)}`)
        L.push(`  已讲解商品    ${ov.hasExplainGoodsTotal}（覆盖率 ${ov.explainCoverRate || '—'}）`)
        // ★ totalGMVOrigin 单位是「分」
        const gmv = Number(ov.totalGMVOrigin || 0) / 100 || Number(ov.totalGMV || 0)
        const ord = Number(ov.orderCountOrigin || ov.orderCount || 0)
        const uv = Number(ov.orderUVOrigin || ov.orderUV || 0)
        const view = Number(ov.videoViewCntOrigin || ov.videoViewCnt || 0)
        if (ord > 0) L.push(`  客单价        ¥${(gmv / ord).toFixed(2)}`)
        if (uv > 0) L.push(`  人均订单      ${(ord / uv).toFixed(2)}`)
        if (view > 0) L.push(`  千次播放成交  ¥${(gmv / view * 1000).toFixed(2)}`)
      } else {
        L.push('【数据总览】无数据（moduleType 选错？1=商家自营有数据，2=达人带货为空）')
      }

      const items = tr?.items || []
      if (items.length) {
        L.push('')
        L.push(`【趋势】${items.length} 天`)
        for (const d of items.slice(0, 15)) {
          L.push(`  ${d.statDate}  GMV¥${String(d.totalGMV ?? 0).padStart(7)}  订单${String(d.orderCount ?? 0).padStart(3)}  播放${String(d.videoViewCnt ?? 0).padStart(5)}  商品点击${String(d.goodsClkCnt ?? 0).padStart(4)}  发视频${d.feedCount ?? 0}`)
        }
        if (items.length > 15) L.push(`  …还有 ${items.length - 15} 天`)
        const sum = items.reduce((s, d) => ({
          gmv: s.gmv + (d.totalGMV || 0), ord: s.ord + (d.orderCount || 0),
          view: s.view + (d.videoViewCnt || 0), clk: s.clk + (d.goodsClkCnt || 0),
          feed: s.feed + (d.feedCount || 0),
        }), { gmv: 0, ord: 0, view: 0, clk: 0, feed: 0 })
        L.push('')
        L.push(`  合计：GMV ¥${sum.gmv.toFixed(2)} / 订单 ${sum.ord} / 播放 ${sum.view} / 商品点击 ${sum.clk} / 发视频 ${sum.feed}`)
        const best = [...items].sort((a, b) => (b.totalGMV || 0) - (a.totalGMV || 0)).slice(0, 3)
        L.push(`  GMV Top3: ${best.map(d => `${d.statDate} ¥${d.totalGMV}`).join(' | ')}`)
      }

      const sl = sg?.suggestList || []
      if (sl.length) {
        L.push('')
        L.push('【诊断建议】')
        for (const s of sl.slice(0, 5)) {
          const title = Array.isArray(s.title) ? s.title.map(x => x.text).join('') : (s.title || '')
          const content = String(s.content || '').replace(/<[^>]+>/g, '')
          L.push(`  · ${title}${content ? ' — ' + content.slice(0, 60) : ''}${s.buttonText ? ` [${s.buttonText}]` : ''}`)
        }
      }

      if (wk && wk.startPt) {
        L.push('')
        L.push(`【带货周报】${wk.startPt} ~ ${wk.endPt}`)
        const g = wk.publishWeeklyReportGoodsGmv
        if (g) L.push(`  发布视频数 ${g.feedCount ?? '—'} | 支付金额 ¥${g.totalOrderAmount ?? '—'}`)
      }
      out.text = L.join('\n')
    }

    // ══════════════════ permission ═══════════════════
    else if (mode === 'permission') {
      const [cR, fR, gR] = await Promise.all([
        api('/api/backbone/video/signed_contract/query', {}),
        api('/element/obs/video_flow_card/entrance', {}),
        api('/carllive/replay/mall_promotion_config', {}),
      ])
      const c = cR.json?.result, f = fR.json?.result, g = gR.json?.result
      out.permission = { contract: c, flowCard: f, cfg: g }
      const L = ['多多视频 · 权限与奖励', '', '【带货/内容权限】',
        `  商品带货权限   ${c?.goodsFeedPermission ? '✅ 已开通' : '❌ 未开通'}`,
        `  普通内容权限   ${c?.commonFeedPermission ? '✅ 已开通' : '❌ 未开通'}`]
      if (c?.commonFeedPermissionUrl) L.push(`  协议: ${c.commonFeedPermissionUrl}（v${c.commonFeedPermissionVer || '?'}）`)
      L.push('', '【流量卡奖励】',
        `  入口显示       ${f?.showEntry ? '✅' : '❌'}`,
        `  审核奖励       ${f?.auditVideoFlowCardReward ?? '—'} 张流量卡`,
        `  批量投放灰度   ${f?.grayResult?.video_batch_flow_limit ? '✅' : '❌'}`,
        '', '【带货配置】',
        `  入口           ${g?.show_entrance ? '✅ 显示' : '❌ 隐藏'}`,
        `  有流量标签     ${g?.has_stream_tag ? '✅' : '❌'}`,
        `  切片视频奖励   ${g?.hit_slice_video_reward_qualified ? '✅ 符合' : '❌ 不符合'}`)
      out.text = L.join('\n')
    }

    // ══════════════════ anchor ═══════════════════
    else if (mode === 'anchor') {
      // /kiwi/obs/anchor/info 是 GET（POST 会 405）
      const r = await apiGet('/kiwi/obs/anchor/info')
      const a = r.json?.result ?? r.json
      const valid = a && typeof a === 'object' && (a.anchorUid || a.anchorName || a.name)
      out.anchor = a
      out.text = valid
        ? `主播信息：\n  anchorUid:  ${a.anchorUid ?? '—'}\n  anchorName: ${a.anchorName ?? a.name ?? '—'}\n  roomId:      ${a.roomId ?? '—'}\n  fansNum:     ${a.fansNumTip ?? a.fansNumDataTip ?? '—'}${a.fansNumSuffixTip ?? ''}\n  showNum:     ${a.showNum ?? '—'}\n  goodsLimit:  ${a.goodsLimit ?? '—'}`
        : `主播信息：接口返回异常（${JSON.stringify(a).slice(0, 150)}）`
    }

    // ══════════════════ qualify ═══════════════════
    else if (mode === 'qualify') {
      const r = await api('/api/backbone/video/publish_qualification', {})
      const q = r.json?.result
      out.qualify = q
      out.text = q
        ? `发布资格：${q.hasQualification ? '✅ 有资格' : '❌ 无资格'}${q.reason ? `（${q.reason}）` : ''}${q.disableGoodsTab ? '\n⚠️ 商品带货 tab 被禁用' : ''}`
        : '发布资格：未获取到'
    }

    // ══════════════════ topics ═══════════════════
    else if (mode === 'topics') {
      const r = await api('/api/orpheus-obs/topic/list', { page_size: 20, page: 1 })
      const arr = r.json?.result?.topic_volist || []
      out.topics = r.json?.result
      if (arr.length) {
        out.text = `话题 ${arr.length} 个：\n` + arr.slice(0, 20).map(x => `  · ${x.name || x.title || x.topicName}（${x.id || x.topicId || '—'}）`).join('\n')
      } else {
        const pc = await api('/api/backbone/video/publish/page/query', {})
        const decl = pc.json?.result?.anchorDeclarationList || []
        out.declarations = decl
        out.text = `话题：0 个（topic_volist 空）\n\n发布必填 · 内容声明（anchorDeclarationType）：\n` +
          (decl.length ? decl.map(d => `  · type=${d.type}  ${d.name}`).join('\n') : '  （未获取到）')
      }
    }

    // ══════════════════ detail（单个视频数据）══════════════════
    else if (mode === 'detail') {
      // 单视频数据来源：POST /api/backbone/video/query
      //   字段来自 chunk 3973-d417d75a06c76a22.js 的卡片组件：
      //     {label:"点赞", key:"likes"}  {label:"评论", key:"comments"}
      //     {label:"分享", key:"shares"}  {label:"播放量", key:"views"}
      //     {label:"7日推荐有效vv", key:"vv"}
      //   另有 feedId / feedType / coverUrl / mediaUrl / pictureUrls /
      //        audioInfo / desc / title / isHotTag / publishTime / status / goodsList
      const feedId = argOf('feed-id') || argOf('video-id') || argOf('id')
      const end = Date.now()
      const start = argOf('start') ? new Date(argOf('start')).getTime() : end - 90 * 86400000

      // 不指定 feedId → 返回全部（让用户挑）
      const status = argOf('status') != null ? Number(argOf('status')) : -1
      const r = await api('/api/backbone/video/query', {
        status, pageSize: Math.min(100, limit), page: 1, startTime: start, endTime: end,
      })
      // ★ 2026-11-10：**接口报错不能被当成「0 个视频」**。
      //   之前 40002 时 r.json.result 为空 → feeds=[] → 走待发布兜底 → 报「已发布视频 0 个」，
      //   看起来一切正常，实际接口已经失败了。这种假成功比直接报错更危险。
      if (r.status !== 200 || (r.json && r.json.success === false)) {
        const code = r.json?.errorCode
        const msg = r.json?.errorMsg || ''
        if (code === 40002) {
          throw new Error(
            `video/query 被频控（40002 ${msg || '系统异常'}）。`
            + '该接口参数组合尚未摸清（实测页面内直发同样 40002），且失败会连带账号冷却。'
            + '先用 --mode list（待发布队列，纯 Node 稳定可用）。'
          )
        }
        throw new Error(`video/query 失败：${code || r.status} ${msg}`)
      }
      const res = r.json?.result
      const feeds = res?.feeds || []

      // ★ 没有已发布视频时，兜底用待发布队列（至少有元数据）
      let source = 'published'
      let items = feeds
      if (!items.length) {
        const queue = await getQueue()
        if (queue.length) {
          source = 'queue'
          items = queue.map(v => ({
            feedId: v.vid,
            vid: v.vid,
            feedType: 1,
            title: v.title || '',
            desc: v.desc || '',
            coverUrl: v.coverUrl || '',
            mediaUrl: v.url || '',
            isHotTag: false,
            status: 0,                       // 0 = 待发布
            publishTime: null,
            likes: null, comments: null, shares: null, views: null, vv: null,
            goodsList: (v.goodsItemList || []).map(g => ({ goodsId: g.goodsId, name: g.goodsName })),
          }))
        }
      }
      out.source = source

      if (!items.length) {
        out.ok = false; out.failureKind = 'api_error'
        out.count = 0
        out.text = [
          '没有视频数据（已发布 + 待发布队列都是空）。',
          '',
          '店铺当前状态：',
          '  · 带货/内容权限未开通 → 发布会被 2000000 拦截',
          '',
          '先上传一条：',
          '  --mode upload --file x.mp4 --confirm true',
        ].join('\n')
        await closeBrowser(); emit(out); await halt(2)
      }

      // 指定了 feedId 就过滤
      let target = feeds
      if (feedId) {
        target = items.filter(f => String(f.feedId ?? f.id ?? f.vid ?? '') === feedId)
        if (!target.length) {
          out.ok = false; out.failureKind = 'api_error'
          out.text = `未找到 feedId=${feedId} 的视频。\n\n当前有 ${feeds.length} 个：\n` +
            items.slice(0, 10).map((f, i) => `  [${i}] feedId=${f.feedId ?? f.id ?? '—'} ${String(f.desc || f.title || '').slice(0, 40)}`).join('\n')
          await closeBrowser(); emit(out); await halt(2)
        }
      }

      const fmt = (v) => {
        if (v == null || v === '') return '—'
        if (typeof v === 'number' && v >= 10000) return v.toLocaleString()
        return String(v)
      }
      const fmtTime = (t) => {
        if (!t) return '—'
        try {
          const d = new Date(typeof t === 'number' ? t : Number(t))
          return isNaN(d.getTime()) ? String(t) : d.toLocaleString('zh-CN', { hour12: false })
        } catch { return String(t) }
      }

      out.videos = target.map(f => ({
        feedId: f.feedId ?? f.id ?? null,
        vid: f.vid ?? null,
        feedType: f.feedType ?? null,             // 1=视频 2=图文?
        title: String(f.title ?? '').slice(0, 100),
        desc: String(f.desc ?? '').slice(0, 300),
        coverUrl: f.coverUrl ?? f.cover ?? '',
        mediaUrl: f.mediaUrl ?? f.url ?? '',
        pictureUrls: f.pictureUrls ?? null,
        isHotTag: !!f.isHotTag,
        status: f.status ?? null,
        publishTime: f.publishTime ?? null,
        // 互动数据（卡片字段）
        likes: f.likes ?? null,
        comments: f.comments ?? null,
        shares: f.shares ?? null,
        views: f.views ?? null,
        vv: f.vv ?? null,
        // 带货
        goodsList: (f.goodsList || []).map(g => ({ goodsId: g.goodsId ?? g.id, name: g.goodsName ?? g.name })),
        // 原始
        raw: f,
      }))

      const L = []
      if (feedId) {
        const f = out.videos[0]
        L.push('═'.repeat(78))
        L.push('单个视频数据')
        L.push('═'.repeat(78))
        L.push('')
        L.push(`  feedId       ${f.feedId ?? '—'}`)
        L.push(`  vid          ${f.vid ?? '—'}`)
        L.push(`  类型         ${f.feedType === 2 ? '图文' : '视频'}`)
        L.push(`  标题/描述    ${f.desc || f.title || '(无)'}`)
        L.push(`  封面         ${f.coverUrl ? f.coverUrl.slice(0, 80) : '—'}`)
        L.push(`  视频地址     ${f.mediaUrl ? f.mediaUrl.slice(0, 80) : '—'}`)
        L.push(`  热门标签     ${f.isHotTag ? '🔥 热门' : '—'}`)
        L.push(`  状态         ${f.status ?? '—'}`)
        L.push(`  发布时间     ${fmtTime(f.publishTime)}`)
        L.push('')
        L.push('  【互动数据】')
        L.push(`    播放量            ${fmt(f.views)}`)
        L.push(`    7日推荐有效 vv    ${fmt(f.vv)}`)
        L.push(`    点赞              ${fmt(f.likes)}`)
        L.push(`    评论              ${fmt(f.comments)}`)
        L.push(`    分享              ${fmt(f.shares)}`)
        // 派生
        const v = Number(f.views) || 0
        if (v > 0) {
          const lk = Number(f.likes) || 0, cm = Number(f.comments) || 0, sh = Number(f.shares) || 0
          L.push(`    点赞率            ${(lk / v * 100).toFixed(2)}%`)
          L.push(`    互动率            ${((lk + cm + sh) / v * 100).toFixed(2)}%`)
        }
        L.push('')
        if (f.goodsList.length) {
          L.push('  【带货商品】')
          f.goodsList.forEach((g, i) => L.push(`    ${i + 1}. [${g.goodsId}] ${g.name}`))
        } else {
          L.push('  【带货商品】无')
        }
        L.push('')
        L.push('═'.repeat(78))
      } else {
        if (source === 'queue') {
          L.push(`待发布队列 ${out.videos.length} 个（暂无已发布视频，以下只有元数据，无互动数据）：`)
          L.push('')
          for (const f of out.videos) {
            L.push(`  [${String(f.feedId).slice(0, 50)}] ${(f.desc || f.title || '(无标题)').slice(0, 45)}`)
            L.push(`     封面 ${f.coverUrl ? f.coverUrl.slice(0, 70) : '—'}`)
            L.push(`     视频 ${f.mediaUrl ? f.mediaUrl.slice(0, 70) : '—'}`)
            if (f.goodsList.length) L.push(`     商品 ${f.goodsList.length} 个`)
          }
          L.push('')
          L.push('要拿互动数据（播放/点赞/评论），需先成功发布视频。')
          L.push('当前发布被 2000000 拦截（带货/内容权限未开通）→ 用 --mode permission 查。')
        } else {
          L.push(`已发布视频 ${out.videos.length} 个（未指定 --feed-id，全部列出）：`)
          L.push('')
          for (const f of out.videos) {
            L.push(`  [${f.feedId ?? '—'}] ${(f.desc || f.title || '(无标题)').slice(0, 50)}`)
            L.push(`     播放=${fmt(f.views)} 点赞=${fmt(f.likes)} 评论=${fmt(f.comments)} 分享=${fmt(f.shares)} vv=${fmt(f.vv)}`)
            L.push(`     发布=${fmtTime(f.publishTime)}${f.isHotTag ? ' 🔥热门' : ''}${f.goodsList.length ? ` 商品${f.goodsList.length}个` : ''}`)
          }
          L.push('')
          L.push('用 --feed-id <id> 看单个视频完整数据。')
        }
      }
      out.text = L.join('\n')
    }

    else {
      out.ok = false; out.failureKind = 'api_error'
      out.text = `未知 mode：${mode}\n\n可用：\n  list        待发布队列\n  published   已发布视频\n  upload      上传视频（L2 写）\n  delete      删除视频（L2 写）\n  data        带货数据\n  permission  权限与流量卡奖励\n  anchor      主播信息\n  qualify     发布资格\n  topics      话题/内容声明`
      process.exitCode = 2
    }
  } catch (e) {
    // ★ 错误归一 + 冷却提示 + 账号健康分（2026-10-24 补）
    const { normalizeError, recordToAntiban } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
    const n = normalizeError(e, `多多视频 ${mode}`)
    await recordToAntiban(SHOP, null, n.failureKind === 'risk_control' ? 'captcha' : null).catch(() => {})
    // 附加冷却剩余
    try {
      const { checkCooldown, fmtRemain } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs')))
      const cd = checkCooldown(SHOP)
      if (cd?.remainMs > 0) {
        n.text += `\n\n账号冷却剩余 ${fmtRemain(cd.remainMs)}，期间请勿重复调用（会延长封禁）。`
      }
    } catch { /* ignore */ }
    out.ok = false
    out.failureKind = n.failureKind
    out.text = n.text
    await closeBrowser(); emit(out); await halt(2)
  } finally {
    // ★ 2026-11-10：**必须关浏览器**。
    //   不关的话 Chrome 进程会残留并占着 Profile 锁，
    //   下一个技能（或常驻签名服务）就起不来，报
    //   "Failed to launch the browser process" —— 而且看不出真正原因。
    //   实测残留 31 个 chrome.exe 后，守护进程的 /domaincookies 直接 500。
    await closeBrowser()
  }

  await closeBrowser(); emit(out)
  await halt(out.ok ? 0 : 2)
})().catch(async (e) => {
  const { normalizeError } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs'))).catch(() => ({}))
  const n = normalizeError ? normalizeError(e, '多多视频') : { failureKind: 'exception', text: `异常：${e?.message?.slice(0, 200)}` }
  emit({ ok: false, failureKind: n.failureKind, text: n.text })
  await halt(2)
})
