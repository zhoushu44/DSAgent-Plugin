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
 * 拼多多商品查询（pdd-works）—— 只读，无平台副作用
 *
 * 能力（全部 HTTP，复用 pdd-mode2 的 Anti-Content 签名注入）：
 *   overview   商品列表汇总（在售/仓库/草稿 计数 + 前 N 条）
 *   list       商品列表明细（ goods_id / 标题 / 类目 / 价格带 / SKU 数 / 在售状态 ）
 *   detail     单商品 SKU 全量（spec/spec_id/价格/库存/预览图）
 *   sku        同 detail（别名，兼容 works 系列习惯）
 *   commit     单商品「提交体快照」（on_shop/detail，170 字段，三层复用的数据源）
 *   spec-pool  全店规格池（规格值 → spec_id）
 *
 * 用法：
 *   node scripts/query.mjs --mode list
 *   node scripts/query.mjs --mode detail --goods-id 1018993401073
 *   node scripts/query.mjs --mode spec-pool
 */
const { CHROME_PATH, STEALTH_ARGS, STEALTH_SCRIPT } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))

const require = createRequire(PKG_BASE)
const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const goodsId = argOf('goods-id')
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))
const wantCsv = process.argv.includes('--csv')

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { ensureAntiContent, getAntiContent } = await import(`file:///${PLUGIN_ROOT}/lib/pdd-mode2.js`)
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain, tryAcquireAccountLock, releaseAccountLock, heartbeatAccountLock, throttleRequest, detectRiskCode, getCaptchaToken, saveCaptchaToken, extractCaptchaToken } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs')))
  // 简写
  const getTok = getCaptchaToken, saveTok = saveCaptchaToken, extractTok = extractCaptchaToken

  // 账号选择：优先 --account，否则按平台自动找
  const { CredentialStore } = await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 2026-11-05：多账号时必须让用户选，不能静默取第一个（写错店的代价不可逆）
  const { pickAccount, toEmit } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/account-picker.mjs')))
  const _pick = pickAccount(store, {
    platform: 'pdd_mms',
    want: argOf('account'),
    wantName: argOf('shop-name') || argOf('shopName'),
    skill: 'pdd-works',
  })
  if (!_pick.ok) { emit(toEmit(_pick)); process.exit(2) }
  const SHOP = _pick.shopKey

  // ★ 2026-11-04 迁移到统一风控闸门（pdd-guard）
  //   原实现是手写四件套（checkCooldown + tryAcquireAccountLock + heartbeat + release 钩子）。
  //   ⚠️ 闸门内部已持锁，**不要保留旧的 tryAcquireAccountLock**（会自己锁死自己）。
  const { openTask, getVerifyAuthToken } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-guard.mjs')))
  // ★ 2026-11-05：接口路径与签名由基座管理，PDD 升级只改 _shared/pdd-api.mjs
  const { api: pddApi } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-api.mjs')))
  const guard = await openTask('pdd-works', SHOP, { lockWaitMs: 300_000 })
  if (guard.blocked) {
    emit({ ok: false, failureKind: 'rate_limit', text: `账号 ${SHOP} 当前不可执行：${guard.reason}。期间请勿重复调用。` })
    process.exit(2)
  }
  guard.startHeartbeat()
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })


  // ★ 2026-10-27 修：改用 pdd-launch 的统一 profile 解析，删掉硬编码兜底。
  //
  //   原代码：
  //     let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  //     if (!fs.existsSync(profile)) {
  //       profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e...')
  //     }
  //
  //   问题：shopKey 目录缺失时会静默落到那个固定目录 → 用未知账号的登录态操作，
  //   查到的可能是别的店铺数据。现在 launchOptions 内建「显式候选链」，
  //   找不到就抛 PDD_PROFILE_MISSING，绝不静默借用。
  // ★ 2026-11-08：Node 优先 —— 先探测凭证库 Cookie + 种子能否纯 Node 工作
  //   能通就完全不开浏览器（overview/list/detail/sku 全部走 Node）
  //   不通才启动浏览器（写操作仍需浏览器）
  const WRITE_MODES = new Set(['offsale', 'onsale', 'delete', 'commit', 'edit', 'batch'])
  const isWriteMode = WRITE_MODES.has(mode)

  const acc0 = store.listAccounts().find(a => a.shop_key === SHOP)
  let ACC0 = null
  if (acc0?.cookies) {
    try {
      const seedFile = path.join(homedir(), '.dsh', 'pdd-risk-seeds', String(SHOP).replace(/[^\w.-]/g, '_') + '.json')
      let ls = {}
      if (fs.existsSync(seedFile)) ls = JSON.parse(fs.readFileSync(seedFile, 'utf8')).localStorage || {}
      if (Object.keys(ls).length) ACC0 = { cookies: acc0.cookies, localStorage: ls }
    } catch { }
  }

  let nodeOK = false
  if (ACC0 && !isWriteMode) {
    try {
      const { request: probeReq } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-request.mjs')).href)
      const pr = await probeReq('/glide/v2/mms/addProperties/goodsList', {
        page_num: 1, page_size: 1, only_query_no_props_goods: false, only_query_un_auth_brand: false,
      }, { account: ACC0, shopKey: SHOP })
      nodeOK = pr.ok
      if (nodeOK) console.warn('[pdd-works] 纯 Node 可用，不启动浏览器')
    } catch { }
  }

  const { launchOptions } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-launch.mjs`)
  let browser = null
  if (!nodeOK) {
    try {
      browser = await puppeteer.launch(launchOptions(SHOP))
    } catch (e) {
  if (process.env.PDD_DEBUG_STACK) { console.error('=== STACK ==='); console.error(e.stack); }
      if (e?.code === 'PDD_PROFILE_MISSING') {
        emit({ ok: false, failureKind: 'not_bound', text: e.message })
        process.exit(2)
      }
      throw e
    }
  }
  const page = browser ? ((await browser.pages())[0] || await browser.newPage()) : null
  // ★ 注入反检测（webdriver / plugins / languages / chrome.runtime）
  if (page) await page.evaluateOnNewDocument(STEALTH_SCRIPT);
  // safeEval：页面跳转会导致 frame detached，重试遍历所有 frame
  const safeEval = async (fn, arg) => {
    if (!page) return null
    for (let i = 0; i < 12; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换下一个 frame */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  if (page) {
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 9000))
  if (/\/login/i.test(page.url())) {
    // ★ 2026-11-08：不再直接退出
    //   浏览器 profile 里的 Cookie 可能过期，但凭证库里的 Cookie + 种子仍可纯 Node 工作。
    //   先探测一次 Node 通道：通了就继续（后续请求走 Node，不需要页面）；
    //   不通才判定真的掉登录。
    let nodeUsable = false
    try {
      const probeAcc = store.listAccounts().find(a => a.shop_key === SHOP)
      if (probeAcc?.cookies) {
        const seedFile = path.join(homedir(), '.dsh', 'pdd-risk-seeds', String(SHOP).replace(/[^\w.-]/g, '_') + '.json')
        let ls = {}
        if (fs.existsSync(seedFile)) ls = JSON.parse(fs.readFileSync(seedFile, 'utf8')).localStorage || {}
        const { request: probeReq } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-request.mjs')).href)
        const pr = await probeReq('/earth/api/mallInfo/commonMallInfo', {}, {
          account: { cookies: probeAcc.cookies, localStorage: ls },
          shopKey: SHOP,
          method: 'GET',
        })
        nodeUsable = pr.ok
        if (pr.ok) {
          console.warn('[pdd-works] 浏览器 profile 已过期，但凭证库 Cookie 有效 → 继续（走纯 Node）')
        }
      }
    } catch { /* ignore */ }

    if (!nodeUsable) {
      await browser?.close()
      emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
      process.exit(2)
    }
  }
  }
  if (!page) console.warn('[pdd-works] 无浏览器（纯 Node 模式），跳过页面交互')
  // ★ 风控 L3：滑块遮罩检测（有则中止，避免无效点击加重风控）
  const hasSlider = async () => !page ? false : await safeEval(() => {
    const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"], [class*="mask"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
      .map(m => (m.innerText || '').replace(/\n/g, ' ').slice(0, 40))
    return ms.some(t => /滑块|拼图|安全验证/.test(t))
  })
  if (await hasSlider()) {
    await browser?.close()
    emit({
      ok: false, failureKind: 'risk_control',
      text: '页面出现滑块验证（拼图），账号已被平台风控。\n'
        + '请打开浏览器窗口手动完成验证后重试；期间请勿重复调用（会延长封禁）。',
    })
    process.exit(2)
  }
  // ★ 风控 L3：滑块遮罩检测 + 自动过（detectSlider/autoSolveSlider 已在顶部 import）
  //   纯 Node 模式没有 page，跳过所有页面级风控检测
  if (page && await detectSlider(page)) {
    console.warn('[pdd-works] 检测到滑块遮罩，尝试自动过滑块...')
    const solved = await autoSolveSlider(SHOP, page)
    if (!solved.ok) {
      await browser?.close()
      emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}\n请手动过验证后重试。` })
      process.exit(2)
    }
    console.warn(`[pdd-works] 滑块已过：${solved.text}`)
    await new Promise(r => setTimeout(r, 2000))
  }
  // 纯 Node 模式没有 page，ensureAntiContent 只能在浏览器里跑
  if (page) await ensureAntiContent(page)

  // ★ 风控 L1：接口级节流（落盘跨进程）+ L2：遇控即停
  //   2026-10-24：切到 pdd-client 统一入口（t1 简化签名 / t2 真签名自动选）
  const { call: clientCall, createSession, ERR: CLIENT_ERR } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-client.mjs')))
  const accForT1 = store.listAccounts().find(a => a.shop_key === SHOP)
  let COOKIES_T1 = accForT1 ? Object.entries(accForT1.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ') : ''

  // ★ 2026-11-08：构造统一账号对象（供 pdd-request 纯 Node 通道）
  let ACC = null
  try {
    if (accForT1?.cookies) {
      const seedFile = path.join(homedir(), '.dsh', 'pdd-risk-seeds', String(SHOP).replace(/[^\w.-]/g, '_') + '.json')
      let ls = {}
      if (fs.existsSync(seedFile)) ls = JSON.parse(fs.readFileSync(seedFile, 'utf8')).localStorage || {}
      ACC = { cookies: accForT1.cookies, localStorage: ls }
    }
  } catch { /* 无种子走浏览器 */ }

  // ★ 2026-10-24：43001 时用当前浏览器页面的 Cookie 兜底
  //   凭证库快照可能是几天前的旧票，而浏览器 Profile 里的是新的（实测 5 个账号全踩）
  async function freshCookiesFromPage() {
    if (!page) return null
    try {
      const s = await page.target().createCDPSession()
      await s.send('Network.enable')
      const r = await s.send('Network.getCookies', { urls: ['https://mms.pinduoduo.com/'] })
      const map = {}
      for (const x of r.cookies || []) map[x.name] = x.value
      if (map['PASS_ID']) return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ')
    } catch { /* ignore */ }
    return null
  }
  let sessForT2 = null

  /**
   * ★ 2026-10-25：t2 会话健康检查 + detached 自动重建。
   *
   * 踩坑实录：createSession → goto → 页面被风控关掉 → 签名器取不到，
   * 报「真签名失败: Attempted to use detached Frame」。
   * 根因是建会话后没确认页面真的活着。
   *
   * 做法：每次调用前探活（一次极轻 evaluate），挂了就关掉重建（最多 2 次）；
   * 新建时必须验证「页面能 evaluate」且「没跳登录页」。
   */
  async function ensureT2Session() {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (sessForT2) {
        try {
          const alive = await sessForT2.evaluate(() => !!document.body)
          if (alive) return sessForT2
        } catch { /* 挂了，重建 */ }
        try { await sessForT2.close() } catch { /* ignore */ }
        sessForT2 = null
      }
      try {
        console.warn('[pdd-works] 建立 t2 会话（真签名）第 ' + attempt + ' 次...')
        const s = await createSession(SHOP)
        await s.goto('https://mms.pinduoduo.com/goods/goods_list', 15000)
        // 等 webpack 模块 eDaA（签名器）就绪
        await new Promise(r => setTimeout(r, 4000))
        const url = await s.url?.().catch(() => '') || ''
        if (/\/login/i.test(url)) { await s.close().catch(() => {}); continue }
        const alive = await s.evaluate(() => !!document.body).catch(() => false)
        if (!alive) { await s.close().catch(() => {}); continue }
        sessForT2 = s
        return s
      } catch (e) {
        console.warn('[pdd-works] t2 会话建立失败（第 ' + attempt + ' 次）：' + (e.message || '').slice(0, 100))
        try { await sessForT2?.close() } catch { /* ignore */ }
        sessForT2 = null
        if (attempt < 2) await new Promise(r => setTimeout(r, 5000))
      }
    }
    return null
  }

  /**
   * 统一请求
   *
   * ★ 2026-11-08：改走基座 pdd-request（Node 优先）
   *   有 account → 纯 Node（0.06~2.6s）；失败且有 page → 自动降级浏览器
   *   实测：店铺信息 57ms、店铺流量（补日期后）通过
   */

  // ★ 顶层导入：call() 和 overview/list 分支都要用
  const { request } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-request.mjs')).href)

  const call = async (url, body) => {
    const nodeAccount = ACC ? { cookies: ACC.cookies, localStorage: ACC.localStorage || {} } : null
    const r = await request(url, body, {
      page,
      account: nodeAccount || undefined,
      shopKey: SHOP,
      guard,
      extraHeaders: { referer: 'https://mms.pinduoduo.com/goods/goods_list' },
    })
    if (r.ok) return r.raw
    // 失败时按原逻辑抛错（保持 skill 的错误提示不变）
    const code = r.ec
      throw Object.assign(new Error(`接口失败 ec=${code}`), { ec: code, __raw: r.raw, __hint: r.hint })
  }
  const _oldCallUnused = async (url, body) => {
    // ★ 通道选择：vodka/glide 走 t2（真签名），其余 t1（简化签名）
    const needT2 = /\/vodka\/|\/glide\//.test(url)
    // ★ 2026-11-04：节流统一走闸门 beforeCall（账号级时间槽，落盘跨进程）。
    //   原来用 throttleRequest（频率上限 20/60 次每分钟），与 reserveSlot 是不同维度；
    //   现在 beforeCall 内部已包含 reserveSlot，throttleRequest 仅作兜底保留在 import 里。
    const pre = await guard.beforeCall(url)
    if (!pre.allow) throw Object.assign(new Error(`账号不可用：${pre.reason}`), { __blocked: true })
    try {
      const r = needT2
        ? await (async () => {
            const s = await ensureT2Session()
            if (!s) return { ok: false, kind: 'signature_error', hint: 't2 会话建立失败（页面被风控关掉或未登录）' }
            return await clientCall({ shopKey: SHOP, session: s, url, body, referer: 'https://mms.pinduoduo.com/goods/goods_list' })
          })()
        : await clientCall({ shopKey: SHOP, cookies: COOKIES_T1, url, body })

      // ★ 43001 → 用浏览器 Cookie 重试一次
      if (!r.ok && (r.ec === 43001 || r.kind === 'session_expired') && !needT2) {
        const fresh = await freshCookiesFromPage()
        if (fresh && fresh !== COOKIES_T1) {
          COOKIES_T1 = fresh
          console.warn('[pdd-works] 凭证库 Cookie 过期，已切换浏览器 Cookie 重试')
          r = await clientCall({ shopKey: SHOP, cookies: COOKIES_T1, url, body })
        }
      }

      // 成功 → 直接返回 json
      if (r.ok) return r.json
      const code = r.ec

      // 54001 → pdd-client 已内建自愈重试；这里只归一错误
      if (code === 54001) {
        markCooldown(SHOP, 54001, r.hint || '54001 需人工过一次滑块验证')
        const err = new Error(`RISK_54001`)
        err.riskCode = 54001
        err.riskMsg = r.hint || ''
        err.needManualCaptcha = true
        throw err
      }
      if (code === 43001 || r.kind === 'session_expired') {
        const err = new Error(`RISK_43001`); err.riskCode = 43001; err.riskMsg = '会话已过期'
        throw err
      }
      if (code === 40002) {
        // ★ 2026-10-27 修：40002 现已补进 pdd-risk 的 RISK_CODES（240s），
        //   不再被 markCooldown 的 `if (!base) return` 静默吞掉。
        markCooldown(SHOP, 40002, '40002 高频限流（官方实测无法本地修复，只能降级或等待）')
        const err = new Error(`RISK_40002`); err.riskCode = 40002; err.riskMsg = r.hint || ''
        throw err
      }
      // 业务错误：原样返回（调用方自行判断 success）
      return r.json || { success: false, error_code: code, error_msg: r.msg || r.hint }
    } catch (e) {
      if (e.riskCode) throw e
      const err = new Error('RISK_NETWORK'); err.riskCode = 0; err.riskMsg = e.message
      throw err
    }
  }

  const LIST_URL = 'https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList'
  const listBody = { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, size: 50 }

  const rows = []
  if (mode === 'overview' || mode === 'list') {
    /**
     * ★ 2026-11-08：改用 listGoodsFull（纯 Node）
     *
     *   原实现调 mall/goodsList —— 该接口长期 54001「操作太过频繁」，
     *   浏览器也进不去（页面重定向），导致 overview 长期不可用。
     *
     *   新方案：glide/goodsList（稳定 289ms）+ 并发 skuInfo 补价格
     *   实测：180 个商品 5.6 秒拿全（含价格/库存/在售/SKU数/销量）
     */
    const { listGoodsFull } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-goods-full.mjs')).href)
    let full
    try {
      full = await listGoodsFull(
        (p, b, o) => request(p, b, { page, account: ACC || undefined, shopKey: SHOP, guard, ...o }),
        ACC || { cookies: {}, localStorage: {} },
        SHOP,
        { max: limit > 0 ? Math.max(limit, 50) : 0, concurrency: 5, useCache: true }
      )
    } catch (e) {
      emit({ ok: false, failureKind: 'api_error', text: `商品列表获取失败：${String(e.message).slice(0, 120)}` })
      await browser?.close(); process.exit(2)
    }

    const goods = full.goods || []
    const onSale = goods.filter(g => g.isOnSale === true)
    const offSale = goods.filter(g => g.isOnSale !== true)

    for (const g of goods.slice(0, limit || goods.length)) {
      rows.push({
        goods_id: g.id,
        title: g.title,
        cat: (g.catIds || []).join('>'),
        sku_count: g.skuCount ?? 0,
        price_range: g.price != null
          ? (g.priceMax && g.priceMax !== g.price ? `${g.price}~${g.priceMax}元` : `${g.price}元`)
          : '—',
        stock: g.stock ?? null,
        sold: g.soldQty ?? null,
        is_onsale: g.isOnSale,
        thumb: g.thumb || '',
      })
    }

    const summary = mode === 'overview'
      ? { on_sale: onSale.length, not_on_sale: offSale.length, total_shown: goods.length }
      : undefined

    emit({
      ok: true, mode, shopKey: SHOP,
      summary,
      total: goods.length,
      items: rows,
      text: mode === 'overview'
        ? `拼多多商品总览：在售 ${onSale.length} 个、未在售 ${offSale.length} 个（共 ${full.total} 个）。最新 ${rows.length} 条：\n` + rows.slice(0, 10).map((r, i) => `  ${i + 1}. [${r.goods_id}] ${r.title.slice(0, 30)} | ${r.sku_count}SKU | ${r.price_range} | 库存${r.stock ?? '-'}`).join('\n')
        : `拼多多商品列表：共 ${goods.length} 个，返回前 ${rows.length} 条。\n` + rows.map((r, i) => `  ${i + 1}. [${r.goods_id}] ${r.title.slice(0, 30)} | ${r.sku_count}SKU | ${r.price_range} | 库存${r.stock ?? '-'}`).join('\n'),
    })
    if (wantCsv) {
      const dir = path.join(process.cwd(), 'artifacts', 'pdd-works')
      fs.mkdirSync(dir, { recursive: true })
      const csv = ['goods_id,title,cat,sku_count,price_range,stock,sold,is_onsale', ...rows.map(r => [r.goods_id, `"${r.title.replace(/"/g, '""')}"`, `"${r.cat}"`, r.sku_count, `"${r.price_range}"`, r.stock, r.sold, r.is_onsale].join(','))].join('\n')
      fs.writeFileSync(path.join(dir, `pdd-goods-${mode}-${Date.now()}.csv`), csv, 'utf8')
    }
  } else if (mode === 'detail' || mode === 'sku') {
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: 'detail/sku 模式必须带 --goods-id' }); await browser?.close(); process.exit(2) }
    const r = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', { goodsId: Number(goodsId) })
    const skus = r?.result || []
    const items = skus.map(s => ({
      sku_id: s.sku_id,
      spec: (s.spec || []).map(x => `${x.spec_key || ''}:${x.spec_value}`).join(' / '),
      group_price: s.group_price, normal_price: s.normal_price,
      quantity: s.quantity, sold: s.sold_quantity,
      thumb: s.thumb_url ? '✅' : '—', is_onsale: s.is_onsale,
    }))
    emit({
      ok: true, mode: 'detail', goodsId, skuCount: skus.length, items,
      text: `商品 ${goodsId} 共 ${skus.length} 个 SKU：\n` + items.map((x, i) => `  ${i + 1}. ${x.spec} | 拼单=${x.group_price} 单买=${x.normal_price} | 库存=${x.quantity} | 预览图=${x.thumb}`).join('\n'),
    })
  } else if (mode === 'offsale' || mode === 'onsale' || mode === 'delete') {
    // ── 写操作（L2）：下架 / 上架 / 删除 ──
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: `${mode} 模式必须带 --goods-id` }); await browser?.close(); process.exit(2) }
    if (!process.argv.includes('--confirm')) {
      const verb = mode === 'offsale' ? '下架' : mode === 'onsale' ? '上架' : '删除'
      emit({
        ok: false, needConfirm: true, mode, goodsId,
        text: `【${verb}预览 · 需用户确认】\n商品：${goodsId}\n操作：${verb}${mode === 'delete' ? '（删除需先下架；接口直删可能被服务端会话绑定拦截，下架 100% 可靠）' : ''}\n\n确认无误后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。`,
      })
      await browser?.close()
      process.exit(0)
    }
    const gid = Number(goodsId)
    if (mode === 'offsale') {
      // ① 前置校验（页面同款：resourceValidate）
      await call('https://mms.pinduoduo.com/vodka/v2/mms/pc/resourceValidate', { goodsIdList: [gid], checkItem: ['if_in_bidding_check', 'if_in_goods_decoration', 'if_in_combine_buy'] }).catch(() => null)
      // ② 下架
      // ★ 2026-11-05：改走基座（路径 / 签名头 / 节流 / 错误归因全由 pdd-api 负责）
      const rr = await pddApi(page, 'goods.offSale', { goodsId: gid }, { shopKey: SHOP, guard })
      const ok = rr.ok
      emit({
        ok, mode: 'offsale', goodsId,
        text: ok
          ? `商品 ${gid} 已下架。可在「已下架」列表确认。`
          : `下架失败：${rr.ec || ''} ${(rr.hint || '').slice(0, 160)}`,
      })
    } else if (mode === 'onsale') {
      // ★ 2026-11-05：改走基座
      const rr = await pddApi(page, 'goods.onSale', { goodsId: gid }, { shopKey: SHOP, guard })
      const ok = rr.ok
      emit({
        ok, mode: 'onsale', goodsId,
        text: ok
          ? `商品 ${gid} 已上架（在售）。`
          : `上架失败：${r?.error_msg || JSON.stringify(r).slice(0, 200)}`,
      })
    } else {
      // delete：create_by_sn 拿 commit_id → delete
      const sn = await call('https://mms.pinduoduo.com/glide/v2/mms/edit/commit/create_by_sn', { goods_id: gid }).catch(() => null)
      const cid = String(sn?.result?.goods_commit_id || '')
      const del = await call('https://mms.pinduoduo.com/glide/v2/mms/edit/commit/delete', { goods_id: gid, goods_commit_id: cid }).catch(() => null)
      const ok = del?.success === true
      // 验证
      await new Promise(r => setTimeout(r, 3000))
      const off = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, size: 50, is_onsale: 0 }).catch(() => null)
      const list = off?.result?.goods_list || []
      const still = list.find(g => String(g.id) === String(gid))
      emit({
        ok: ok && !still, mode: 'delete', goodsId, commitId: cid,
        text: ok && !still
          ? `商品 ${gid} 已彻底删除（已不在「已下架」列表）。`
          : `接口已返回 success 但商品仍在列表——服务端会话绑定导致未落库。\n变通方案：先 offsale 下架，再到「已下架」列表页面点删除。`,
      })
    }
  } else if (mode === 'commit') {
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: 'commit 模式必须带 --goods-id' }); await browser?.close(); process.exit(2) }
    const r = await call('https://mms.pinduoduo.com/glide/v2/mms/query/commit/on_shop/detail', { goods_id: Number(goodsId) })
    const res = r?.result || {}
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-works'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-works', `commit-${goodsId}.json`), JSON.stringify(r, null, 2), 'utf8')
    emit({
      ok: true, mode: 'commit', goodsId,
      fields: Object.keys(res).length,
      skus: (res.skus || []).length, gallery: (res.gallery || []).length,
      properties: (res.goods_properties || []).length,
      cat_id: res.cat_id, cat_path: (res.cats || []).filter(Boolean).join('>'),
      text: `商品 ${goodsId} 提交体快照：${Object.keys(res).length} 字段 | ${(res.skus || []).length} SKU | ${(res.gallery || []).length} 图 | ${(res.goods_properties || []).length} 属性\n类目：${(res.cats || []).filter(Boolean).join('>')}\n已存 artifacts/pdd-works/commit-${goodsId}.json`,
    })
  } else if (mode === 'edit') {
    // 编辑商品原先走旧发布引擎的 hijack 模式（lib/pdd-publish2.js），该引擎已移除，此模式停用。
    emit({
      ok: false, failureKind: 'skill_error', mode: 'edit', goodsId,
      text: 'edit 模式已停用：它依赖的旧发布引擎已移除。请用 pdd-publish 技能上架，或在商家后台手动编辑。',
    })
    process.exit(2)
  } else if (mode === 'spec-pool') {
    const r = await call(LIST_URL, listBody)
    const goods = r?.result?.goods_list || []
    const pool = {}
    for (const g of goods) {
      await new Promise(res => setTimeout(res, 1200))
      const sku = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', { goodsId: g.id })
      for (const s of sku?.result || []) {
        for (const sp of s.spec || []) {
          if (sp.spec_value == null || sp.spec_id == null) continue
          const dim = sp.spec_key || '规格'
          if (!pool[dim]) pool[dim] = {}
          if (!pool[dim][sp.spec_value]) pool[dim][sp.spec_value] = { spec_id: sp.spec_id, parent_spec_id: sp.parent_spec_id ?? 0 }
        }
      }
    }
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-re'), { recursive: true })
    const out = { pool, collectedAt: new Date().toISOString(), goodsScanned: goods.length }
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-re', 'spec-pool.json'), JSON.stringify(out, null, 2), 'utf8')
    const dims = Object.entries(pool).map(([k, v]) => `${k}(${Object.keys(v).length})`).join('、')
    emit({
      ok: true, mode: 'spec-pool', goodsScanned: goods.length, dims,
      text: `规格池采集完成：扫描 ${goods.length} 个商品 → ${dims}\n已存 artifacts/pdd-re/spec-pool.json`,
    })
  } else {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：overview / list / detail / sku / commit / edit / spec-pool` })
  }
  if (typeof hb !== 'undefined' && hb) clearInterval(hb)
  if (sessForT2) await sessForT2.close().catch(() => {})
  await browser?.close()
})().catch(async (e) => {
  if (typeof sessForT2 !== 'undefined' && sessForT2) await sessForT2.close().catch(() => {})
  // ★ 风控异常 → 友好提示（而不是裸的 RISK_54001）
  // ★ 2026-10-27 修：原来所有 riskCode 一律标成 failureKind='rate_limit'，
  //   导致 54001（需过滑块）与 40002（限流）在模型眼里是同一种错误，
  //   模型只能盲目重试。现在按错误码分开：
  //     54001 → risk_control：引导人工过一次滑块，**不要**重新登录、不要立即重试
  //     43001 → token_expired：会话过期，重新登录
  //     40002 → rate_limit：官方实测无法本地修复，降级或等待
  const { checkCooldown, fmtRemain } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-risk.mjs`).catch(() => ({}))
  if (e?.riskCode && checkCooldown) {
    const cd = checkCooldown(SHOP)
    const remain = cd?.remainMs > 0 ? fmtRemain(cd.remainMs) : ''
    if (e.riskCode === 54001) {
      emit({
        ok: false, failureKind: 'risk_control',
        text: `账号命中平台风控（54001：操作太过频繁）${e.riskMsg ? `：${e.riskMsg}` : ''}${remain ? `，已记冷却 ${remain}` : ''}。\n`
          + '★ 这不是登录态失效，**不要**去「账号连接」重新登录（那只会刷新风控基线）。\n'
          + '★ 也不要在冷却期内反复调用（会延长封禁）。\n'
          + '正确做法：打开浏览器窗口手动完成滑块/拼图验证；通过后会拿到 10 分钟通行证，届时重试即可。',
      })
      process.exit(2)
    }
    if (e.riskCode === 43001) {
      emit({
        ok: false, failureKind: 'token_expired',
        text: `会话已过期（43001）。请到「账号连接」页面重新扫码登录拼多多商家后台。\n`
          + '注：凭证库里的 Cookie 快照可能是旧的，重新登录会同步刷新。',
      })
      process.exit(2)
    }
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `命中平台频控（code=${e.riskCode}${e.riskMsg ? `：${e.riskMsg}` : ''}）${remain ? `，已记冷却 ${remain}` : ''}。\n`
        + '★ 40002 是接口级限流，官方实测无法本地修复，重试无效、只会延长封禁。\n'
        + '请等待冷却结束，或换用其他数据来源。',
    })
    process.exit(2)
  }
  // ★ 2026-10-24 补：detached Frame → 风控关页面 + 记账号健康分
  try {
    const { normalizeError, recordToAntiban } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
    const n = normalizeError(e, '商品管理')
    // ★ 2026-10-27 修：原为 .catch(() => {}) 静默吞掉，健康分丢失无人知晓
    await recordToAntiban(SHOP, null, n.failureKind === 'risk_control' ? 'captcha' : null)
      .catch((e2) => console.error(`[pdd-works] ⚠ 记录风控健康分失败：${String(e2 && e2.message || e2).slice(0, 120)}`))
    emit({ ok: false, failureKind: n.failureKind, text: n.text })
    process.exit(2)
  } catch { /* ignore */ }
  if (process.env.PDD_DEBUG_STACK) console.error('=== OUTER STACK ===\n' + (e?.stack || String(e)))
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
}).then(() => {
  // ★ 2026-11-10：**统一收尾退出**。
  //   各模式分支 emit 之后都没有 exit，代码跑到末尾但进程不退出：
  //   纯 Node 通道下 jsdom / undici 的句柄要等 GC，事件循环不空 →
  //   调用方 WaitForExit 超时，把「成功」误判成「卡死」。
  //   这里统一硬退（emit 用的是 process.stdout.write 同步写，已 flush）。
  process.exit(0)
})


