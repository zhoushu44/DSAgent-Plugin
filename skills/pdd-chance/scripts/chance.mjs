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
 * 拼多多机会商品（chance-goods）数据采集
 *
 * 入口：商家后台 → 商品管理 → 机会商品（/goods/goods_list/chance）
 *
 * ★ 2026-10-23 逆向发现：全新域 `/opportunity-goods/*`，
 *   不在官方风控 SDK 的 antiCrawlerApiList 白名单里（风控宽松）。
 *
 * 接口清单：
 *   POST /opportunity-goods/chance-goods/home_list        主列表（分页 + banner_type）
 *   POST /opportunity-goods/chance-goods/my_list          我的机会商品
 *   POST /opportunity-goods/chance-goods/collection/list  收藏列表
 *   POST /opportunity-goods/chance-goods/mission_info     任务信息（礼物/考试/图片任务）
 *   POST /opportunity-goods/chance-goods/get_filters      筛选项
 *   POST /opportunity-goods/chance-goods/cate_info        类目信息（全量机会类目树）
 *   POST /opportunity-goods/chance-goods/default_category      默认类目
 *   POST /opportunity-goods/chance-goods/default_category_general  通用默认类目（{type:2}）
 *   POST /opportunity-goods/chance-goods/mall_gray       灰度开关
 *   POST /opportunity-goods/chance-goods/oversea         跨境
 *
 * 用法：
 *   node scripts/chance.mjs --mode labels                                      ★ 查本店铺可用标签（含实时商机数）
 *   node scripts/chance.mjs --mode pick --labels home_page_new,thousand_rec    ★ 按标签选商机
 *   node scripts/chance.mjs --mode list [--page 1] [--size 35] [--cat-id 16548]
 *   node scripts/chance.mjs --mode detail --chance-id <id>      ★ 单商机详情（只读）
 *   node scripts/chance.mjs --mode publish --chance-id <id> --product-file <json>            ★ 发布预览
 *   node scripts/chance.mjs --mode publish --chance-id <id> --product-file <json> --confirm true  ★ 真建草稿
 *   node scripts/chance.mjs --mode mine       我的机会商品（已跟款）
 *   node scripts/chance.mjs --mode collection 收藏列表
 *   node scripts/chance.mjs --mode mission    任务信息
 *   node scripts/chance.mjs --mode follow-check   ★ 一键验证跟款是否成功
 *   node scripts/chance.mjs --mode filters    筛选项（含 51 个站内热搜/缺货词）
 *   node scripts/chance.mjs --mode cates      机会类目树（259 个，看哪些类目开了机会池）
 *
 * ★ --labels（2026-11-05 新增）：实测 550 条样本验证
 *   - 必须是数组（传字符串报 4000000）
 *   - 多标签 = OR 并集
 *   - 不能与 cat_id_1:-1 共存（返回 0）
 *   - 各标签 total：当季新品 2000 / 首页流量 2000 / 热门收藏 1719 / 潜力商品 1525 / 热门跟款 1507 / 全网热销 1500
 *   - low_price（低价跟款）不可用作 labels 值
 *
 * ★ --cat-id：按一级类目查机会商品（默认 = 店铺主营类目）。
 *   实测：只有 `cat_id_1` 参数生效（cate_id_1/category_id/opt_id 都无效，会返回默认池）。
 *   已开放机会池的一级类目共 19 个（用 --mode cates 看），未开放的返回 total=0。
 */
const { CHROME_PATH, STEALTH_ARGS, STEALTH_SCRIPT } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))
const require = createRequire(PKG_BASE)

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'list'
const pageNo = Math.max(1, parseInt(argOf('page') || '1', 10) || 1)
const size = Math.min(100, Math.max(1, parseInt(argOf('size') || '35', 10) || 35))
// ★ --cat-id：按一级类目查机会商品。空 = 店铺主营类目（平台推荐）
const catId = argOf('cat-id') ? Number(argOf('cat-id')) : null

/**
 * ★ 2026-11-05 新增：--labels 标签筛选
 *
 * 实测（爱绿森旗舰店，550 条样本验证）：
 *   labels 必须是**数组**，传字符串会报 4000000「请求method,argument,body错误」
 *   多标签之间是 **OR**（并集），不是 AND
 *   绝不能同时传 cat_id_1: -1（会返回 0 条）——不传 cat_id 时平台自动用主营类目
 *
 * 可用值（来自 get_filters 的 labels 组，6 个）：
 *   newinfashion_new  当季新品      total≈2000
 *   hot_follow        热门跟款      total≈1507
 *   wide_popular      全网热销      total≈1500
 *   home_page_new     首页流量      total≈2000
 *   thousand_rec      潜力商品      total≈1525
 *   hot_favorites_goods 热门收藏    total≈1719
 *
 * ⚠️ low_price（低价跟款）**不能**作为 labels 值（返回 0 条）——
 *    它只存在于 hide_labels 组，是排除项。
 */
const LABEL_ALIAS = {
  '当季新品': 'newinfashion_new', '热门跟款': 'hot_follow', '全网热销': 'wide_popular',
  '首页流量': 'home_page_new', '潜力商品': 'thousand_rec', '热门收藏': 'hot_favorites_goods',
  // 兼容 hide_labels 组里的旧值写法
  'newinfashion': 'newinfashion_new', 'home_page': 'home_page_new',
}
const VALID_LABELS = new Set(['newinfashion_new', 'hot_follow', 'wide_popular', 'home_page_new', 'thousand_rec', 'hot_favorites_goods'])
const rawLabels = argOf('labels')
const labels = rawLabels
  ? String(rawLabels).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).map(s => LABEL_ALIAS[s] || s).filter(s => {
      if (!VALID_LABELS.has(s)) { console.error(`[chance] ⚠ 未知标签「${s}」，已忽略。可用：${[...VALID_LABELS].join(', ')}`); return false }
      return true
    })
  : null
const chanceId = argOf('chance-id')
const confirm = process.argv.includes('--confirm') && argOf('confirm') !== 'false'


/**
 * 平台价格档位（2026-10-23 从 35 个样本实测算出，价格带几乎不重叠）：
 *   0 = 品质档，中位 83.50 元（范围 10.70 ~ 257.45）
 *   1 = 主流档，中位 14.47 元（范围 5.90 ~ 79.63）
 *   2 = 引流档，中位  5.58 元（范围 1.01 ~ 12.50）
 * 定价 ≤ refer_price 可打上 low_price「低价跟款」标签，获得搜索流量倾斜。
 */
const PRICE_LABEL_NAMES = { 0: '品质档', 1: '主流档', 2: '引流档' }

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/lib/services/credential-store.js')))
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain, getCaptchaToken, saveCaptchaToken, extractCaptchaToken, tryAcquireAccountLock, releaseAccountLock, heartbeatAccountLock } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs')))
  const getTok = getCaptchaToken, saveTok = saveCaptchaToken, extractTok = extractCaptchaToken
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 2026-11-05：多账号时必须让用户选，不能静默取第一个（写错店的代价不可逆）
  const { pickAccount, toEmit } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/account-picker.mjs')))
  const _pick = pickAccount(store, {
    platform: 'pdd_mms',
    want: argOf('account'),
    wantName: argOf('shop-name') || argOf('shopName'),
    skill: 'pdd-chance',
  })
  if (!_pick.ok) { emit(toEmit(_pick)); process.exit(2) }
  const SHOP = _pick.shopKey

  // ★ 2026-11-04 迁移到统一风控闸门（pdd-guard）
  //   原实现是手写四件套（checkCooldown + tryAcquireAccountLock + heartbeat + release）。
  //   ⚠️ 闸门内部已持锁，**不要保留旧的 tryAcquireAccountLock**（会自己锁死自己）。
  const { openTask, getVerifyAuthToken } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-guard.mjs')))
  const { api: pddApi } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-api.mjs')))
  const guard = await openTask('pdd-chance', SHOP, { lockWaitMs: 300_000 })
  if (guard.blocked) {
    emit({ ok: false, failureKind: 'rate_limit', text: `账号 ${SHOP} 当前不可执行：${guard.reason}。期间请勿重复调用。` })
    process.exit(2)
  }
  guard.startHeartbeat()
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })

  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  // ★ 2026-11-04 修（安全）：原来这里有个硬编码兜底
  //     if (!fs.existsSync(profile)) profile = path.join(base, 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
  //   会把「本账号 profile 缺失」静默变成「借用另一个账号的登录态」——
  //   采到的可能是别家店的数据。改为用 pdd-launch 的统一候选链（找不到就抛错）。
  if (!fs.existsSync(profile)) {
    try {
      const { profileCandidates } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))
      const cands = profileCandidates(SHOP)
      const hit = cands.find(d => fs.existsSync(path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', d)))
      if (!hit) throw new Error(`找不到账号 ${SHOP} 的浏览器 Profile，请先到「账号连接」重新登录`)
      profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', hit)
    } catch (e) {
      emit({ ok: false, failureKind: 'not_bound', text: e.message })
      process.exit(2)
    }
  }

  // ★ 2026-10-24：凭证库 Cookie 有效 ≠ Profile Cookie 有效（实测踩坑）。
  //   凭证库里 3b39d748 的 PASS_ID 是好的，但它自己的 profile 目录里是旧票，
  //   直接打开会跳登录页 → 误报 token_expired。
  //   解法：先用凭证库 Cookie 覆盖注入（见下方 page.setCookie）。
  const storeAcc = store.listAccounts().find(a => a.shop_key === SHOP)
  const storePid = storeAcc?.cookies?.['PASS_ID']

  // ★ 自动清理 Cookie 域污染（2026-10-28）：同名 Cookie 分散在

  //   .pinduoduo.com / mms.pinduoduo.com / yingxiao.pinduoduo.com 时，

  //   浏览器优先发子域旧值 → 推广域反复掉登录。删子域同名项即恢复。

  //   跳过：--no-cookie-clean

  if (process.argv.includes('--cookie-clean')) {

    try {

      const { cleanCookiePollution } = await import(pathToFileURL('e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-promo/scripts/cookie-clean.mjs').href)

      const r = await cleanCookiePollution(profile, { log: (m) => console.warn('[pdd] ' + m) })

      if (r.ok && r.deleted > 0) console.warn('[pdd] ✅ 清理 ' + r.deleted + ' 条域污染 Cookie')

    } catch (e) {

      console.warn('[pdd] Cookie 清理跳过：' + String(e.message).slice(0, 60))

    }

  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    userDataDir: profile,
    headless: false,
    defaultViewport: null,        // ★ 用真实窗口尺寸（SDK 会采集 innerWidth/screen.*）
    ignoreDefaultArgs: ['--enable-automation'],
    args: STEALTH_ARGS,
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  // ★ 注入反检测（webdriver / plugins / languages / chrome.runtime）
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)

  // ★ 凭证库有 PASS_ID 就注入，覆盖 profile 里的旧票
  if (storePid) {
    try {
      const jar = Object.entries(storeAcc.cookies).filter(([, v]) => v !== '' && v != null)
      const cookieList = jar.flatMap(([name, value]) => ([
        { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
        { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
      ]))
      await page.setCookie(...cookieList)
      console.error(`[chance] 已从凭证库注入 ${cookieList.length} 个 Cookie（PASS_ID ${storePid.length} 字符）`)
    } catch (e) {
      console.error(`[chance] Cookie 注入失败: ${e.message?.slice(0, 80)}`)
    }
  }
  await page.evaluateOnNewDocument(STEALTH_SCRIPT);
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 15; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  const safeGoto = async (url, opts) => {
    for (let k = 0; k < 4; k++) {
      try { return await page.goto(url, opts) } catch (e) {
        if (/detached Frame|Session closed/i.test(e.message) && k < 3) { await new Promise(r => setTimeout(r, 2000)); continue }
        throw e
      }
    }
  }

  // ① 商品列表建会话（机会商品页需要 mms 会话）
  await safeGoto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 12000))
  if (/\/login/i.test(page.url())) {
    // ★ 2026-10-24：区分「真未登录」与「接口要签名但页面没跳登录」
    //   机会商品页需要 mms 会话，但 /opportunity-goods/* 本身不要签名。
    //   若页面跳登录页，说明该 profile 的票据确实失效。
    await browser.close()
    emit({
      ok: false, failureKind: 'token_expired',
      text: [
        '拼多多商家后台登录态失效（打开商品列表跳到了登录页）。',
        '',
        '排查：',
        '  1. 该账号的浏览器 Profile 票据已过期（凭证库的可能还有效）',
        '  2. 已尝试从凭证库注入 Cookie，但仍被跳登录 → 服务端已判定过期',
        '',
        '处理：到「账号连接」对该账号重新扫码登录（会同时刷新 Profile 和凭证库）。',
      ].join('\n'),
    })
    process.exit(2)
  }
  // 滑块自动过
  if (await detectSlider(page)) {
    console.error('[chance] 检测到滑块遮罩，尝试自动过滑块...')
    const solved = await autoSolveSlider(SHOP, page)
    console.error(`[chance] ${solved.text}`)
    if (!solved.ok) {
      await browser.close()
      emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}` })
      process.exit(2)
    }
    await new Promise(r => setTimeout(r, 2000))
    await safeGoto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 10000))
  }

  // ② hook 签名（Anti-Content + crawlerInfo）
  //    ★ 2026-10-23 实测：/opportunity-goods/* 不在风控白名单，不需要签名也能返回全量数据
  //    （带/不带签名都是 total:455）。仍保留 hook 作为兜底——某些接口可能后续加风控。
  await page.evaluateOnNewDocument(() => {
    window.__sig = null
    const O = window.XMLHttpRequest.prototype.open
    const S = window.XMLHttpRequest.prototype.send
    const SH = window.XMLHttpRequest.prototype.setRequestHeader
    window.XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return O.apply(this, arguments) }
    window.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h[k] = v; return SH.apply(this, arguments) }
    window.XMLHttpRequest.prototype.send = function (b) {
      try { if (String(b).includes('crawlerInfo')) window.__sig = { anti: this.__h['Anti-Content'], crawlerInfo: JSON.parse(String(b)).crawlerInfo } } catch { /* ignore */ }
      return S.apply(this, arguments)
    }
  }).catch(() => { /* ignore */ })

  // ③ 打开机会商品页（建立会话 + 让页面自己发请求）
  await safeGoto('https://mms.pinduoduo.com/goods/goods_list/chance', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 14000))
  // 机会商品页滑块
  if (await detectSlider(page)) {
    console.error('[chance] 机会商品页滑块 → 自动过...')
    const solved = await autoSolveSlider(SHOP, page)
    console.error(`[chance] ${solved.text}`)
    if (solved.ok) {
      await new Promise(r => setTimeout(r, 2000))
      await safeGoto('https://mms.pinduoduo.com/goods/goods_list/chance', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
      await new Promise(r => setTimeout(r, 12000))
    }
  }
  const sig = await page.evaluate(() => window.__sig).catch(() => null)
  console.error(`[chance] 签名: ${sig ? '有' : '无（该域不需要，无影响）'}`)

  // ★ 2026-11-04：节流已统一由 pdd-guard 的 beforeCall 负责（内部就是 reserveSlot）。
  //   原来的进程内 `lastHit` Map + MIN_GAP 兜底已删除 —— 它曾经是"假节流"的证据，
  //   留着只会让后来者以为还有第二套节流。
  await new Promise(r => setTimeout(r, 0))

  const call = async (apiPath, body) => {
    // ★ 2026-11-04：节流统一走闸门 beforeCall（内部即 reserveSlot，账号级落盘跨进程）。
    //   闸门不可用时 fail-open（allow=true），不阻断业务。
    // ★ 2026-11-05：优先走基座注册表；未登记的路径回退到原来的直发逻辑
    const regName = CHANCE_API_MAP[apiPath]
    if (regName) {
      const rr = await pddApi(page, regName, body, { shopKey: SHOP, guard, raw: true })
      return rr.raw ?? null
    }
    const pre = await guard.beforeCall('https://mms.pinduoduo.com' + apiPath)
    if (!pre.allow) throw Object.assign(new Error(`账号不可用：${pre.reason}`), { __cooling: true })

    // 该域不需要 crawlerInfo/Anti-Content；有签名就带上（兜底未来加风控）
    const payload = sig ? { ...body, crawlerInfo: sig.crawlerInfo } : body
    // ★ 带上 captcha 通行证（有则带，10 分钟内不再弹滑块）
    // ★ 2026-11-05：统一入口（页面 cookie 优先，pdd-risk 存储兜底）
    const vtk = await getVerifyAuthToken(page, SHOP)
    // ★ puppeteer 的 frame.evaluate 只接受「一个」arg —— 多参数会被丢，
    //   导致 fetch 拿到 undefined → 平台报 4000000「请求method,argument,body错误」。
    //   必须打包成单对象传入。
    const argObj = { p: apiPath, bd: payload, av: sig?.anti || null, vt: vtk || null }
    let r = await safeEval(async (o) => {
      const resp = await fetch('https://mms.pinduoduo.com' + o.p, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(o.av ? { 'Anti-Content': o.av } : {}), ...(o.vt ? { VerifyAuthToken: o.vt } : {}) },
        body: JSON.stringify(o.bd),
      })
      return await resp.json().catch(() => null)
    }, argObj)
    // ★ 43001 → 凭证库 Cookie 过期，用浏览器页面的 Cookie 重试一次
    if (r && (r.error_code === 43001 || r.errorCode === 43001)) {
      try {
        const s = await page.target().createCDPSession()
        await s.send('Network.enable')
        const cr = await s.send('Network.getCookies', { urls: ['https://mms.pinduoduo.com/'] })
        const map = {}
        for (const x of cr.cookies || []) map[x.name] = x.value
        const fresh = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ')
        if (fresh && map['PASS_ID']) {
          console.error('[chance] 凭证库 Cookie 过期，已切换页面 Cookie 重试')
          // ★ 显式带 cookie header（credentials:'include' 在某些情况不带）
          const argObj2 = { ...argObj, ck: fresh }
          r = await safeEval(async (o) => {
            const resp = await fetch('https://mms.pinduoduo.com' + o.p, {
              method: 'POST', credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...(o.ck ? { cookie: o.ck } : {}),
                ...(o.av ? { 'Anti-Content': o.av } : {}),
                ...(o.vt ? { VerifyAuthToken: o.vt } : {}),
              },
              body: JSON.stringify(o.bd),
            })
            return await resp.json().catch(() => null)
          }, argObj2)
        }
      } catch { /* ignore */ }
    }
    // ★ 54001 → 提取新 token 存起来
    if (r && (r.error_code === 54001 || r.errorCode === 54001)) {
      const nt = extractTok(r)
      if (nt) { saveTok(SHOP, nt); console.error('[chance] 已提取新 captcha 通行证（10 分钟有效）') }
    }
    // ★ 40002 高频 → 明确提示 + 记健康分
    if (r && (r.error_code === 40002 || r.errorCode === 40002)) {
      console.error('[chance] ⚠️ 40002 高频限流，稍后重试')
      try {
        const { recordToAntiban } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
        await recordToAntiban(SHOP, 40002, 'rate_limit')
      } catch (e) {
        // ★ 2026-10-27 修：原为 catch { ignore }，命中风控却不记健康分 →
        //   账号风控记忆丢失，下次仍全速打（"盲目重试"的温床）。改为告警。
        console.error(`[chance] ⚠ 记录风控健康分失败（40002）：${String(e && e.message || e).slice(0, 120)}`)
      }
    }
    // ★ 54001 → 记健康分（该域一般不踩，兜底）
    if (r && (r.error_code === 54001 || r.errorCode === 54001)) {
      try {
        const { recordToAntiban } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
        await recordToAntiban(SHOP, 54001, 'captcha')
      } catch (e) {
        // ★ 同上：健康分记录失败必须可见
        console.error(`[chance] ⚠ 记录风控健康分失败（54001）：${String(e && e.message || e).slice(0, 120)}`)
      }
    }
    return r
  }

  // ★ 2026-11-05：路径由基座注册表管理（PDD 升级只改 _shared/pdd-api.mjs）
  //   保留 BASE 仅用于拼接子路径展示，实际请求走注册表
  // 路径 → 注册表逻辑名
  const CHANCE_API_MAP = {
    '/opportunity-goods/chance-goods/home_list': 'chance.home',
    '/opportunity-goods/chance-goods/my_list': 'chance.my',
    '/opportunity-goods/chance-goods/collection/list': 'chance.collection',
    '/opportunity-goods/chance-goods/cate_info': 'chance.cateInfo',
    '/opportunity-goods/chance-goods/mission_info': 'chance.missionInfo',
    '/opportunity-goods/chance-goods/get_filters': 'chance.filters',
    '/opportunity-goods/chance-goods/default_category': 'chance.defaultCategory',
    '/opportunity-goods/chance-goods/get_keywords_recommend': 'chance.keywordsRecommend',
    '/opportunity-goods/chance-goods/get_hot_search_goods': 'chance.getHotSearchGoods',
    '/opportunity-goods/chance-goods/quick_release': 'chance.quickRelease',
  }
  const BASE = '/opportunity-goods/chance-goods'

  if (mode === 'list' || mode === 'pick' || mode === 'mine' || mode === 'collection') {
    const api = (mode === 'list' || mode === 'pick') ? `${BASE}/home_list` : mode === 'mine' ? `${BASE}/my_list` : `${BASE}/collection/list`
    // ★ cat_id_1 才会筛选类目；cate_id_1/category_id/opt_id 都无效（实测）
    // ★ 2026-11-05：labels 只在 home_list 生效，且**不能**与 cat_id_1:-1 共存（实测返回 0）
    let body
    if (mode === 'list' || mode === 'pick') {
      body = { size, page: pageNo, banner_type: 0 }
      if (catId) body.cat_id_1 = catId
      if (labels?.length) body.labels = labels
    } else {
      body = { size, page: pageNo, ...(catId ? { cat_id_1: catId } : {}) }
    }
    const r = await call(api, body)
    const res = r?.result || {}
    const list = res.list || []
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', `${mode}-p${pageNo}.json`), JSON.stringify(r, null, 2), 'utf8')
    const items = list.map(g => ({
      chanceId: g.chance_id,
      keywords: g.keywords || '',
      // ★ refer_price 单位是「分」，price_label 是平台价格档位（0/1/2）
      //   0=品质档(中位83.5元) 1=主流档(中位14.5元) 2=引流档(中位5.6元)
      //   定价 ≤ refer_price 可拿 low_price「低价跟款」标签 → 搜索流量倾斜
      referPrice: g.refer_price,
      referPriceYuan: typeof g.refer_price === 'number' ? +(g.refer_price / 100).toFixed(2) : null,
      priceLabel: g.price_label,
      priceLabelName: PRICE_LABEL_NAMES[g.price_label] ?? '',
      hotIndex: g.hot_index,
      mmsHotIndex: g.mms_hot_index,
      oprtyIndex: g.mms_oprty_index,
      indexTarget: g.mms_index_target,
      potentialIndex: g.potential_index,
      labels: (g.labels || []).map(l => l.title).filter(Boolean),
      cats: [g.cat_id_1, g.cat_id_2, g.cat_id_3].filter(Boolean),
      pics: (g.gallery_img_url_list || []).length,
      collected: !!g.is_collection,
      pic: g.pic_url || '',
    }))
    emit({
      ok: true, mode, shopKey: SHOP,
      catId, labels, total: res.total ?? items.length, page: pageNo, count: items.length,
      items,
      text: items.length
        ? `机会商品（${catId ? `类目 ${catId} · ` : ''}${labels?.length ? `标签 ${labels.join('+')} · ` : ''}第 ${pageNo} 页，共 ${res.total ?? '?'} 条，本页 ${items.length}）：\n` + items.slice(0, 15).map((g, i) =>
            `  ${i + 1}. [${g.chanceId.slice(0, 12)}] ${g.keywords}\n`
            + `     建议价 ¥${g.referPriceYuan ?? '—'}${g.priceLabelName ? `（${g.priceLabelName}）` : ''} | 热度 ${g.hotIndex} | 潜力 ${g.potentialIndex} | ${g.pics} 图\n`
            + `     标签：${g.labels.join(' / ') || '—'} | 类目 ${g.cats.join('>')}${g.collected ? ' | 已收藏' : ''}`
          ).join('\n') + (items.length > 15 ? `\n  ...（其余 ${items.length - 15} 条见 JSON）` : '')
          + `\n\n💡 定价 ≤ 建议价可拿「低价跟款」标签 → 搜索流量倾斜`
        : catId
          ? `类目 ${catId} 暂无机会商品（total=${res.total ?? 0}）。\n可能：①该类目未开放机会池（当前仅 19 个一级类目开放，用 --mode cates 查看）\n②平台正在补录。建议隔天再试。`
          : labels?.length
            ? `标签 ${labels.join('+')} 下暂无机会商品（total=${res.total ?? 0}）。\n★ 已实测：labels 不能与 cat_id_1:-1 共存，且 low_price 不可用。试试不传 --cat-id，或换 --labels hot_follow / wide_popular / thousand_rec。`
            : '机会商品：本页无数据',
    })
  } else if (mode === 'detail') {
    // ★ 2026-11-05 新增：单个商机详情（只读）
    //   组合 3 个只读接口：热词推荐 + 热搜关联商品 + 类目信息
    if (!chanceId) {
      emit({ ok: false, failureKind: 'api_error', text: '--mode detail 需要 --chance-id' })
      await browser.close(); process.exit(2)
    }
    // ★ 2026-11-05 修：`get_keywords_recommend` 本身就是**商机详情接口**，
    //   实测返回 { chance_id, image_url, goods_name, group_price, hot_index,
    //             goods_name_length_limit, hot_keywords[], related_goods_info[] }
    //   —— 不需要再靠 home_list 回捞（那个池子有分页/排序漂移，第6页才找得到）。
    const safeCall = async (p, b) => { try { return await call(p, b) } catch (e) { console.error(`[chance] ${p} 失败：${String(e.message).slice(0, 80)}`); return null } }
    const kw = await safeCall(`${BASE}/get_keywords_recommend`, { chance_id: chanceId })
    const d = kw?.result || {}
    if (!d.chance_id) {
      emit({ ok: false, failureKind: 'api_error', text: `商机 ${chanceId} 查不到详情（可能已过期/已下架）。请用 --mode pick 重新选。原始：${JSON.stringify(kw).slice(0, 200)}` })
      await browser.close(); process.exit(2)
    }
    const hotKeywords = (d.hot_keywords || []).map(k => k.keyword).filter(Boolean)
    const hotList = (d.hot_keywords || []).filter(k => k.hot)
    // labels 需要从 home_list 补（详情接口不返回）；找不到就留空，不阻断
    let card = null
    const findIn = async (body, maxPage) => {
      for (let p = 1; p <= maxPage && !card; p++) {
        const hl = await safeCall(`${BASE}/home_list`, { ...body, size: 50, page: p, banner_type: 0 })
        const list = hl?.result?.list || []
        const hit = list.find(x => x.chance_id === chanceId)
        if (hit) { card = hit; return }
        if (list.length === 0) return
      }
    }
    await findIn({}, 12)
    if (!card && labels?.length) await findIn({ labels }, 4)
    const priceYuan = typeof d.group_price === 'number' ? +(d.group_price / 100).toFixed(2) : null
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', `detail-${chanceId.slice(0, 12)}.json`), JSON.stringify({ detail: d, card }, null, 2), 'utf8')
    emit({
      ok: true, mode, shopKey: SHOP, chanceId,
      detail: {
        goodsName: d.goods_name,
        groupPrice: d.group_price,
        groupPriceYuan: priceYuan,
        hotIndex: d.hot_index,
        nameLengthLimit: d.goods_name_length_limit,
        image: d.image_url,
        relatedGoodsNum: d.related_goods_num,
      },
      hotKeywords,
      hotMarked: hotList.map(k => k.keyword),
      card: card ? {
        keywords: card.keywords,
        referPriceYuan: +(card.refer_price / 100).toFixed(2),
        priceLabelName: PRICE_LABEL_NAMES[card.price_label] ?? '',
        labels: (card.labels || []).map(l => ({ title: l.title, name: l.name, priority: l.priority, essay: l.short_essay, tip: l.hover_title })),
        cats: [card.cat_id_1, card.cat_id_2, card.cat_id_3].filter(Boolean),
        gallery: card.gallery_img_url_list || [],
      } : null,
      text: `商机详情 [${chanceId.slice(0, 12)}]\n`
        + `  参考商品名：${d.goods_name || '—'}（限 ${d.goods_name_length_limit ?? 60} 字）\n`
        + `  建议价：¥${priceYuan ?? '—'}${card && PRICE_LABEL_NAMES[card.price_label] ? `（${PRICE_LABEL_NAMES[card.price_label]}）` : ''}\n`
        + `  热度：${d.hot_index ?? '—'}${card ? ` | 潜力：${card.potential_index ?? '—'}` : ''}\n`
        + (card ? `  标签：${(card.labels || []).map(l => `${l.title}${l.short_essay ? `(${l.short_essay})` : ''}`).join(' / ') || '—'}\n` : '  标签：—（该商机已不在首页池，仅详情可用）\n')
        + (card ? `  类目：${[card.cat_id_1, card.cat_id_2, card.cat_id_3].filter(Boolean).join('>')} | 图片：${(card.gallery_img_url_list || []).length} 张\n` : '')
        + (hotKeywords.length ? `  热词推荐（${hotKeywords.length}）：${hotKeywords.slice(0, 15).join('、')}\n` : '')
        + (hotList.length ? `  其中热门词：${hotList.map(k => k.keyword).join('、')}\n` : '')
        + `\n💡 下一步：--mode publish --chance-id ${chanceId} --product-file <你的商品JSON>`,
    })
  } else if (mode === 'publish') {
    /**
     * ★ 2026-11-05 新增：发布同款（L2 写操作，两步门禁）
     *
     * 链路（从 chance.bcbbcdc7.chunk 逆向）：
     *   ① POST /opportunity-goods/chance-goods/quick_release { chance_id }
     *      → 返回 draft_id / goods_commit_id / is_home_page
     *      ★ 这一步就已经在平台侧创建草稿了（写操作）
     *   ② 跳 /goods/goods_add/index?type=add&from=chance&homePage=&id=<draft_id>
     *   ③ 填表提交（交给 pdd-publish-http）
     *
     * 门禁设计：
     *   不带 --confirm → 只做「选品校验 + 物料预览」，**不调 quick_release**
     *   带 --confirm   → 调 quick_release 建草稿 → 输出 draft_id 与后续命令
     */
    if (!chanceId) {
      emit({ ok: false, failureKind: 'api_error', text: '--mode publish 需要 --chance-id' })
      await browser.close(); process.exit(2)
    }
    const productFile = argOf('product-file')
    let product = null
    if (productFile) {
      try { product = JSON.parse(fs.readFileSync(productFile, 'utf8')) }
      catch (e) { emit({ ok: false, failureKind: 'api_error', text: `读取 product-file 失败：${e.message}` }); await browser.close(); process.exit(2) }
    }
    // 校验商机有效性：**用详情接口**（get_keywords_recommend），不用 home_list 回捞
    //   ★ 2026-11-05 修：home_list 有分页/排序漂移，目标商机可能在第 6 页之后 → 误判"不在池中"
    const pubCatch = async (p, b) => { try { return await call(p, b) } catch (e) { console.error(`[chance] ${p} 失败：${String(e.message).slice(0, 80)}`); return null } }
    const pubKw = await pubCatch(`${BASE}/get_keywords_recommend`, { chance_id: chanceId })
    console.error(`[chance] publish 商机校验返回：${JSON.stringify(pubKw).slice(0, 300)}`)
    const pubDetail = pubKw?.result || pubKw || {}
    if (!pubDetail.chance_id) {
      emit({ ok: false, failureKind: 'api_error', text: `商机 ${chanceId} 无效或已下架（详情接口查不到）。请用 --mode pick 重新选。原始：${JSON.stringify(pubKw).slice(0, 200)}` })
      await browser.close(); process.exit(2)
    }
    // labels 尽量从 home_list 补（找不到不影响发布，只是预览少一行）
    let pubCard = null
    for (let p = 1; p <= 12 && !pubCard; p++) {
      const hl = await pubCatch(`${BASE}/home_list`, { size: 50, page: p, banner_type: 0 })
      const list = hl?.result?.list || []
      const hit = list.find(x => x.chance_id === chanceId)
      if (hit) pubCard = hit
      if (list.length === 0) break
    }
    const srcPrice = pubCard?.refer_price ?? pubDetail.group_price
    const srcTitle = pubDetail.goods_name || pubCard?.keywords || ''
    const srcLabels = (pubCard?.labels || []).map(l => l.title)
    const srcPics = (pubCard?.gallery_img_url_list || []).length || 1
    const priceWarn = product?.price != null && (Number(product.price) * 100) > srcPrice
    const preview = {
      chanceId,
      sourceTitle: srcTitle,
      sourceReferPriceYuan: +(srcPrice / 100).toFixed(2),
      sourceLabels: srcLabels,
      sourcePics: srcPics,
      product: product ? {
        title: product.title, price: product.price, stock: product.stock,
        images: (product.images || []).length, skus: (product.skus || []).length,
      } : null,
      priceWarning: priceWarn ? `你定价 ¥${product.price} 高于商机建议价 ¥${(srcPrice / 100).toFixed(2)}，可能拿不到「首页流量」入选资格` : null,
    }
    if (!confirm) {
      emit({
        ok: true, mode, shopKey: SHOP, dryRun: true, preview,
        text: `【发布预览 · 未执行任何写操作】\n`
          + `商机：[${chanceId.slice(0, 12)}] ${preview.sourceTitle}\n`
          + `  建议价 ¥${preview.sourceReferPriceYuan} | 标签 ${preview.sourceLabels.join('/') || '—'} | ${preview.sourcePics} 张参考图\n`
          + (product
              ? `你的商品：${product.title}\n  定价 ¥${product.price} | 库存 ${product.stock} | 主图 ${preview.product.images} 张 | SKU ${preview.product.skus} 行\n`
              : `⚠️ 未提供 --product-file，仅能预览商机侧信息\n`)
          + (preview.priceWarning ? `\n⚠️ ${preview.priceWarning}\n` : '\n')
          + `\n确认无误后带 --confirm true 重新调用。\n`
          + `★ 带 confirm 会真正调 quick_release 创建草稿（L2 写操作）。`,
      })
    } else {
      const qr = await call(`${BASE}/quick_release`, { chance_id: chanceId })
      if (!qr?.success && qr?.error_code !== 1000000) {
        emit({ ok: false, failureKind: 'api_error', text: `quick_release 失败：${qr?.error_msg || JSON.stringify(qr).slice(0, 200)}` })
        await browser.close(); process.exit(1)
      }
      const resQr = qr?.result && typeof qr.result === 'object' ? qr.result : qr
      const draftId = resQr?.draft_id || resQr?.goods_commit_id || resQr?.draftId || resQr?.goodsCommitId
      const isHomePage = resQr?.is_home_page || resQr?.isHomePage || false
      const entryUrl = draftId ? `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=chance&homePage=${isHomePage}&id=${draftId}` : null
      fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
      fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', `publish-${chanceId.slice(0, 12)}.json`), JSON.stringify({ chanceId, preview, raw: qr }, null, 2), 'utf8')
      emit({
        ok: !!draftId, mode, shopKey: SHOP, dryRun: false,
        chanceId, draftId, isHomePage, preview, entryUrl,
        text: draftId
          ? `✅ 草稿已创建\n`
            + `  chance_id：${chanceId}\n`
            + `  draft_id：${draftId}\n`
            + `  是否首页候选：${isHomePage}\n`
            + `  填表入口：${entryUrl}\n\n`
            + `★ 下一步：用 pdd-publish-http 填入商品信息并提交\n`
            + `★ 若放弃该草稿，须到「草稿箱」手动删除，否则会留下脏数据。`
          : `quick_release 返回成功但未拿到 draft_id，原始返回：${JSON.stringify(qr).slice(0, 300)}`,
      })
    }
  } else if (mode === 'follow-check') {
    //   判定标准（平台侧）：
    //     ① my_list 里出现该 chance_id = 跟款成功（最直接）
    //     ② mission_info.follow_goods_cnt / follow_goods_cnt_1m 递增 = 跟款计数
    //   注意：商品「发布成功」≠「跟款成功」——必须从机会商品页「发布同款」入口进，
    //        提交体才会带 chance_id；直接走「发布新商品」不算跟款。
    const [mine, mission] = await Promise.all([
      call(`${BASE}/my_list`, { size: 50, page: 1 }),
      call(`${BASE}/mission_info`, {}),
    ])
    const mineList = mine?.result?.list || []
    const mineTotal = mine?.result?.total ?? mineList.length
    const mi = mission?.result || {}
    const followCnt = mi.follow_goods_cnt ?? 0
    const follow1m = mi.follow_goods_cnt_1m ?? 0
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'follow-check.json'), JSON.stringify({ mine, mission }, null, 2), 'utf8')

    const items = mineList.map(g => ({
      chanceId: g.chance_id,
      keywords: g.keywords || '',
      referPrice: g.refer_price,
      labels: (g.labels || []).map(l => l.title).filter(Boolean),
      cats: [g.cat_id_1, g.cat_id_2, g.cat_id_3].filter(Boolean),
      collected: !!g.is_collection,
    }))
    const ok = mineTotal > 0 || followCnt > 0
    emit({
      ok: true, mode, shopKey: SHOP,
      followed: ok,
      myTotal: mineTotal, followCnt, follow1m,
      items,
      text: ok
        ? `✅ 已跟款 ${mineTotal} 个机会商品（任务计数 ${followCnt}，近 1 月 ${follow1m}）\n`
          + (items.length ? items.slice(0, 10).map((g, i) =>
              `  ${i + 1}. [${g.chanceId.slice(0, 12)}] ${g.keywords} | 参考价 ${g.referPrice} | ${g.labels.join('/') || '—'}`
            ).join('\n') + (items.length > 10 ? `\n  ...（共 ${items.length} 条，见 follow-check.json）` : '') : '')
        : `❌ 尚未跟款（my_list total=0，follow_goods_cnt=0）\n\n`
          + `跟款流程：\n`
          + `  1. node chance.mjs --mode list                    选机会商品（看 labels/refer_price）\n`
          + `  2. 后台 → 商品管理 → 机会商品 → 点该商品「发布同款」  ← 必须从此入口进\n`
          + `  3. 标题/主图保持与原款相似；定价 ≤ refer_price 可吃「低价跟款」搜索倾斜\n`
          + `  4. 提交发布后再跑 --mode follow-check 验证\n\n`
          + `判定标准：my_list 出现该 chance_id = 跟款成功（商品发布成功 ≠ 跟款成功）`,
    })
  } else if (mode === 'mission') {
    const r = await call(`${BASE}/mission_info`, {})
    const m = r?.result || {}
    emit({
      ok: true, mode, shopKey: SHOP, mission: m,
      text: `机会商品任务：\n`
        + `  礼物任务：${m.show_gift_mission ? `进行中（${m.gift_mission_condition_cnt} 条件，已领 ${m.received_gift}）${m.is_gift_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  考试任务：${m.show_exam_mission ? `进行中（${m.exam_mission_condition_cnt} 条件，奖励 ${m.exam_mission_reward_cnt}）${m.is_exam_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  图片任务：${m.show_pic_mission ? `进行中（${m.pic_mission_condition_cnt} 条件）${m.is_pic_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  跟款商品数：${m.follow_goods_cnt}（近 1 月 ${m.follow_goods_cnt_1m}）`,
    })
  } else if (mode === 'filters') {
    const r = await call(`${BASE}/get_filters`, {})
    const groups = r?.result || []
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'filters.json'), JSON.stringify(r, null, 2), 'utf8')
    const lines = []
    const hotWords = []
    for (const g of groups) {
      const key = g.params_key || ''
      const opts = g.option_info_list || []
      if (key === 'mall_chance_words') {
        // 站内热搜/缺货词——选品金矿，单独提取
        for (const o of opts) hotWords.push({ word: (o.option_key || o.title || '').trim(), tag: o.short_essay || '' })
        lines.push(`${key}（${opts.length} 个站内热搜/缺货词）：${opts.slice(0, 15).map(o => `${(o.option_key || o.title || '').trim()}${o.short_essay ? '[' + o.short_essay + ']' : ''}`).join('、')}${opts.length > 15 ? ' ...' : ''}`)
      } else {
        lines.push(`${key}（${opts.length} 项）：${opts.map(o => `${o.title || o.option_key || ''}${o.short_essay ? '（' + o.short_essay + '）' : ''}`).filter(Boolean).join(' / ') || '—'}`)
      }
    }
    emit({
      ok: true, mode, shopKey: SHOP, groups, hotWords,
      text: `机会商品筛选项（${groups.length} 组）：\n` + lines.join('\n')
        + (hotWords.length ? `\n\n★ 站内热搜/缺货词（${hotWords.length} 个，选品参考）：\n` + hotWords.slice(0, 25).map(w => `  ${w.word}${w.tag ? ' [' + w.tag + ']' : ''}`).join('\n') : ''),
    })
  } else if (mode === 'cates') {
    // ★ cate_info 必须带 size/page，空 body 返回 result:null
    const r = await call(`${BASE}/cate_info`, { size: 100, page: 1 })
    const res = r?.result || {}
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'cates.json'), JSON.stringify(r, null, 2), 'utf8')
    // cate_info 的 result 是数组（259 个），字段 cate_id/cate_name/cate1_id/cate_lvl...
    const arr = Array.isArray(res) ? res : Object.values(res)
    const norm = arr.map(c => ({
      cateId: c.cate_id ?? c.id,
      name: c.cate_name ?? c.name ?? '',
      lvl: c.cate_lvl ?? null,
      parentId: c.parent_id ?? null,
      cate1Id: c.cate1_id ?? null,
      cate1Name: c.cate1_name ?? '',
      desc: c.cate_desc ?? '',
    }))
    const lvl1 = norm.filter(c => c.lvl === 1 || (c.cate1Id && c.cateId === c.cate1Id))
    emit({
      ok: true, mode, shopKey: SHOP, count: norm.length, lvl1Count: lvl1.length,
      cates: norm,
      text: `机会类目树：${norm.length} 个类目（一级 ${lvl1.length} 个）\n`
        + (lvl1.length ? lvl1.slice(0, 30).map(c => `  [${c.cateId}] ${c.name}`).join('\n')
           : norm.slice(0, 30).map(c => `  [${c.cateId}] ${c.name}（lvl ${c.lvl}，上级 ${c.parentId}）`).join('\n')),
    })
  } else if (mode === 'labels') {
    /**
     * ★ 2026-11-05 新增：列出「本店铺当前可用的标签」+ 每个标签的实时商机数
     *
     * 为什么要单独一个 mode：
     *   标签值是平台服务端下发的，不同店铺/类目/时期可能变。
     *   写死在文档里会过期，用户也不该背 6 个英文常量。
     *
     * 数据来源：`get_filters` 的 labels 组（不是 hide_labels 组）
     *   - labels 组 = 可筛选的标签
     *   - hide_labels 组 = 排除项（含 low_price 低价跟款，不可用于筛选）
     *
     * 然后对每个标签各调一次 home_list（size=1）拿真实 total。
     */
    const fr = await call(`${BASE}/get_filters`, {})
    const groups = fr?.result || []
    const labelGroup = groups.find(g => g.params_key === 'labels')
    const hideGroup = groups.find(g => g.params_key === 'hide_labels')
    if (!labelGroup) {
      emit({ ok: false, failureKind: 'api_error', text: 'get_filters 未返回 labels 组，平台结构可能已变更。' })
      await browser.close(); process.exit(2)
    }
    // 中文名映射（服务端只给 title，英文 name 要靠实测枚举）
    const NAME_HINTS = {
      '当季新品': 'newinfashion_new', '热门跟款': 'hot_follow', '全网热销': 'wide_popular',
      '首页流量': 'home_page_new', '潜力商品': 'thousand_rec', '热门收藏': 'hot_favorites_goods',
    }
    const opts = (labelGroup.option_info_list || [])
    const rows = []
    for (const o of opts) {
      const title = o.title || o.option_key
      const value = o.option_key || NAME_HINTS[title] || ''
      // 实时统计该标签下的商机数（size=1 只为拿 total）
      let total = null, err = null
      if (value) {
        const rr = await call(`${BASE}/home_list`, { size: 1, page: 1, banner_type: 0, labels: [value] })
        if (rr && (rr.success || rr.error_code === 1000000)) total = rr.result?.total ?? 0
        else err = rr?.error_msg || `ec=${rr?.error_code}`
        await new Promise(r => setTimeout(r, 1600))   // 标签间节流，避免 54001
      }
      rows.push({
        value,
        title,
        essay: o.short_essay || '',
        total,
        error: err,
        usable: value ? VALID_LABELS.has(value) : false,
      })
    }
    // hide_labels 组：只展示，明确标注"不可用于筛选"
    const hidden = (hideGroup?.option_info_list || []).map(o => ({ value: o.option_key, title: o.title }))
    // ★ 平台全量 6 个标签 vs 本店铺实际可用的差集
    //   实测：爱绿森（餐饮具）labels 组 6 个全有；空空商行（家居饰品）只有 5 个，缺「首页流量」
    const ALL_LABELS = [
      { value: 'newinfashion_new', title: '当季新品' }, { value: 'hot_follow', title: '热门跟款' },
      { value: 'wide_popular', title: '全网热销' }, { value: 'home_page_new', title: '首页流量' },
      { value: 'thousand_rec', title: '潜力商品' }, { value: 'hot_favorites_goods', title: '热门收藏' },
    ]
    const haveSet = new Set(rows.map(r => r.value))
    const missing = ALL_LABELS.filter(x => !haveSet.has(x.value))
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'labels.json'), JSON.stringify({ rows, hidden, missing, raw: fr }, null, 2), 'utf8')
    const usable = rows.filter(x => x.usable)
    emit({
      ok: true, mode, shopKey: SHOP,
      labels: usable, excluded: hidden, unavailable: missing,
      text: `本店铺可用标签（${usable.length} 个，含实时商机数）：\n`
        + usable.map((x, i) =>
            `  ${i + 1}. ${x.title}（${x.value}）${x.total != null ? ` — ${x.total} 条商机` : ' — 数量查询失败'}${x.essay ? `\n     ${x.essay}` : ''}`
          ).join('\n')
        + `\n\n用法：--mode pick --labels ${usable.slice(0, 2).map(x => x.value).join(',')}`
        + `\n（多标签用逗号分隔 = OR 并集；中文名也可）`
        + (missing.length ? `\n\n⚠️ 本店铺没有这 ${missing.length} 个标签：${missing.map(x => `${x.title}(${x.value})`).join('、')}`
            + `\n   原因：平台按店铺主营类目下发标签池，不同类目可见标签不同。` : '')
        + (hidden.length ? `\n\nℹ️ hide_labels 组（排除项，不可用于筛选）：${[...new Set(hidden.map(h => h.title))].join('、')}` : '')
        + `\n\n💡 数字为当前类目下实时商机总数，会随时间变化。`,
    })
  } else {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：pick / labels / list / detail / publish / mine / collection / follow-check / mission / filters / cates` })
    await browser.close(); process.exit(2)
  }
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})


