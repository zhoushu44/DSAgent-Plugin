/**
 * 拼多多店铺经营数据（pdd-shop）—— 只读
 *
 * 数据源：生意参谋（mms.pinduoduo.com/sycm/*），接口统一 /sydney/api/* 前缀。
 * 全部 HTTP，无平台副作用。
 *
 * ★ 双通道（2026-10-23 新增纯 Node）：
 *   --transport http    纯 Node + 本地 anti-content 签名（默认，快 10 倍，不弹滑块）
 *                       实测通过：queryMallFlowData / queryGoodsPageOverviewForMms /
 *                                 queryFinalCredentialNew
 *   --transport browser 页面 hook（兜底，接口改版/签名失效时用）
 *
 * 能力：
 *   overview   店铺经营总览（流量 + 评分 + 商品数据 + 店铺等级）
 *   flow       店铺流量数据（访客 uv / 浏览量 pv / 粉丝 / 搜索指数）
 *   score      店铺评分（服务数据：退款率/发货/客服响应）
 *   goods      商品数据明细（每商品 访客/支付金额/支付订单/转化率/收藏）
 *
 * 用法：node scripts/shop.mjs --mode overview
 *       node scripts/shop.mjs --mode goods --transport browser
 */
import { createRequire } from 'node:module'
const { CHROME_PATH, STEALTH_ARGS, STEALTH_SCRIPT } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))
const TRANSPORT = argOf('transport') || 'http'   // ★ 默认纯 Node

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain, tryAcquireAccountLock, releaseAccountLock, heartbeatAccountLock, throttleRequest } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号，请到「账号连接」添加。' }); process.exit(2) }

  // ★ 风控 L4：冷却期内直接拒绝
  const cd = checkCooldown(SHOP)
  if (cd.cooling) {
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `账号 ${SHOP} 命中平台频控，冷却剩余 ${fmtRemain(cd.remainMs)}（${cd.reason}）。期间请勿重复调用。`,
    })
    process.exit(2)
  }

  // 账号级并发锁：同一时刻只允许一个技能打这个号（等最多 5 分钟）
  const lock = await tryAcquireAccountLock(SHOP, 'pdd-shop', 300000)
  if (!lock.ok) {
    emit({ ok: false, failureKind: 'rate_limit', text: '账号 ' + SHOP + ' 正被其他任务占用' + (lock.holder ? '（' + lock.holder + '）' : '') + '，请稍后再试。' })
    process.exit(2)
  }
  const releaseLock = () => { try { releaseAccountLock(SHOP) } catch (e) {} }
  process.on('exit', releaseLock)
  process.on('SIGINT', () => { releaseLock(); process.exit(130) })
  process.on('SIGTERM', () => { releaseLock(); process.exit(143) })
  const hb = setInterval(() => heartbeatAccountLock(SHOP, 'pdd-shop'), 180000)


  // ══════════════════════════════════════════════════════════════════════
  // ★★★ 纯 Node 通道（默认）★★★
  // 不启浏览器、不弹滑块，速度 ~200ms/请求
  // ══════════════════════════════════════════════════════════════════════
  if (TRANSPORT === 'http') {
    const { call, cookiesOf } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-http.mjs`)
    const acc = store.findByPlatform('pdd_mms', SHOP) || store.listAccounts().find(a => a.shop_key === SHOP)
    if (!acc?.cookies?.['PASS_ID']) {
      emit({ ok: false, failureKind: 'token_expired', text: '账号缺少 PASS_ID，请到「账号连接」重新登录拼多多商家后台。' })
      process.exit(2)
    }
    const COOKIES = cookiesOf(acc)
    const R = 'https://mms.pinduoduo.com/sydney/api'

    /** 统一调用 + 错误归一 */
    const get = async (url, body, referer) => {
      const r = await call({ shopKey: SHOP, cookies: COOKIES, url, body, referer })
      if (!r.ok) {
        const kind = r.kind === 'session_expired' ? 'token_expired'
          : r.kind === 'captcha' ? 'risk_control'
          : r.kind === 'rate_limit' ? 'rate_limit'
          : 'api_error'
        return { ok: false, kind, err: r }
      }
      return { ok: true, data: r.json.result }
    }

    const out = { ok: true, mode, transport: 'http', shopKey: SHOP }

    // ── flow ──
    const flowR = await get(`${R}/mallScore/queryMallFlowData`, {}, 'https://mms.pinduoduo.com/sycm/evaluation')
    if (flowR.ok) out.flow = {
      uv: flowR.data.uv, pv: flowR.data.pv, fans: flowR.data.totalFansCnt,
      srchIndex: flowR.data.srchIndex, orderIndex: flowR.data.orderIndex,
      uvPct: flowR.data.uvPct, pvPct: flowR.data.pvPct,
    }

    // ── goodsOverview（今日/昨日）──
    const ovR = await get(`${R}/goodsDataShow/queryGoodsPageOverviewForMms`, {}, 'https://mms.pinduoduo.com/sycm/goods_effect')
    if (ovR.ok) out.goodsOverview = { today: ovR.data.todayData, yesterday: ovR.data.yesterdayData }

    // ── score ──
    if (mode === 'score' || mode === 'overview') {
      const scR = await get(`${R}/mallScore/queryMallScoreOverView`, {}, 'https://mms.pinduoduo.com/sycm/evaluation')
      if (scR.ok) out.score = scR.data
    }

    // ── goods 明细（需要日期参数，实测该接口参数未完全破解 → 提示走 browser）──
    if (mode === 'goods') {
      out.text = [
        '⚠️ 商品明细接口（queryGoodsDetailVOListForMMS）的参数格式尚未破解（已试 25 种组合全部失败）。',
        '   请用：--mode goods --transport browser',
        '',
        out.goodsOverview ? `可用数据（商品总览）：今日支付 ¥${out.goodsOverview.today?.payOrdrAmt} / ${out.goodsOverview.today?.payOrdrCnt} 单 / ${out.goodsOverview.today?.guv} 访客` : '',
      ].filter(Boolean).join('\n')
      emit(out)
      process.exit(0)
    }

    // ── 汇总文本 ──
    const lines = []
    if (out.flow) lines.push(`店铺流量：访客 ${out.flow.uv} / 浏览 ${out.flow.pv} / 粉丝 ${out.flow.fans} / 搜索指数 ${out.flow.srchIndex}`)
    if (out.goodsOverview?.today) {
      const t = out.goodsOverview.today
      lines.push(`今日：支付 ¥${t.payOrdrAmt} / ${t.payOrdrCnt} 单 / ${t.guv} 访客 / ${t.gpv} 浏览 / 支付转化 ${t.payUvRto}`)
    }
    if (out.goodsOverview?.yesterday) {
      const y = out.goodsOverview.yesterday
      lines.push(`昨日：支付 ¥${y.payOrdrAmt} / ${y.payOrdrCnt} 单 / ${y.guv} 访客 / ${y.gpv} 浏览`)
    }
    if (out.score) {
      const s = out.score
      const parts = []
      if (s.mallScore != null) parts.push(`店铺分 ${s.mallScore}`)
      if (s.serveScore != null) parts.push(`服务分 ${s.serveScore}`)
      if (parts.length) lines.push(parts.join(' / '))
    }
    if (!lines.length) {
      const e = flowR.err || {}
      out.ok = false
      out.failureKind = flowR.kind
      out.text = `取数失败：${e.kind} ${e.ec ?? ''} ${e.msg || e.text?.slice(0, 120) || ''}\n${e.hint || ''}`
    } else {
      out.text = `【纯 Node·${mode}】\n` + lines.join('\n')
    }
    emit(out)
    process.exit(out.ok ? 0 : 2)
  }

  // ══════════════════════════════════════════════════════════════════════
  // 浏览器通道（兜底）
  // ══════════════════════════════════════════════════════════════════════
  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) {
    profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
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
  await page.evaluateOnNewDocument(STEALTH_SCRIPT);
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // ★ 风控 L3：检测到滑块遮罩 → 自动过滑块（yydsocr 识别 + 人类化轨迹）
  const ensureNoSlider = async (label) => {
    if (await detectSlider(page)) {
      console.warn(`[pdd-shop] ${label}：检测到滑块遮罩，尝试自动过滑块...`)
      const solved = await autoSolveSlider(SHOP, page)
      if (!solved.ok) {
        await browser.close()
        emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}\n请手动过验证后重试。` })
        process.exit(2)
      }
      console.warn(`[pdd-shop] 滑块已过：${solved.text}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  /** 跨 frame 安全求值（页面可能在 iframe 里） */
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 12; i++) {
      for (const f of page.frames()) {
        try { return await f.evaluate(fn, arg) } catch { /* 换下一个 frame */ }
      }
      await new Promise(r => setTimeout(r, 1200))
    }
    return null
  }

  // hook 经营数据响应（/sydney/api/* + 等级）
  const byApi = {}
  const APIS = [
    ['flow', 'sydney/api/mallScore/queryMallFlowData'],
    ['score', 'sydney/api/mallScore/queryMallScoreOverView'],
    ['goodsOverview', 'sydney/api/goodsDataShow/queryGoodsPageOverviewForMms'],
    ['goodsList', 'sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS'],
    ['mallLevel', 'rivendell/api/mallLevel/getEntranceInfo'],
  ]
  cdp.on('Network.responseReceived', async (e) => {
    if (e.response.status !== 200) return
    const u = e.response.url
    if (!/mms\.pinduoduo\.com/.test(u)) return
    const hit = APIS.find(([, key]) => u.includes(key))
    if (!hit) return
    try {
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const j = JSON.parse(b.body)
      if (j && (j.errorCode === 1000000 || j.success === true)) byApi[hit[0]] = j.result
    } catch { /* ignore */ }
  })

  // 打开经营页让页面自己发数据请求（先主应用建立会话，再进 sycm 子应用）
  for (const u of [
    'https://mms.pinduoduo.com/goods/goods_list',
    'https://mms.pinduoduo.com/sycm/evaluation',
    'https://mms.pinduoduo.com/sycm/goods_effect',
  ]) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await new Promise(r => setTimeout(r, u.includes('sycm') ? 13000 : 9000))
      await ensureNoSlider(u)   // ★ 风控 L3：每次导航后检测滑块
      if (/\/login/i.test(page.url())) {
        // 主应用跳登录 = 真失效；sycm 跳登录 = 会话未建立，重试一次
        if (!u.includes('sycm')) {
          await browser.close()
          emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
          process.exit(2)
        }
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 12000))
        await ensureNoSlider(u + ' (retry)')
      }
    } catch { /* 单页失败不阻断 */ }
  }

  // ── 解析 ──
  const flow = byApi.flow || null
  const score = byApi.score || null
  const gOverview = byApi.goodsOverview || null
  const gList = byApi.goodsList?.goodsDetailList || []
  const mallLevel = byApi.mallLevel || null

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ DOM 明文优先（2026-10-23 新增）★★★
  //
  // 为什么需要：sycm 用 PUA 字符混淆数字，但实测发现**映射不是全局固定的**
  //   —— 同一码点在不同字段代表不同数字（"每个字段独立偏移"）。
  //   证据：cate3AvgGoodsVcr 的 U+E6EA 对应 0，但 goodsVcr 的 U+E6EA 对应 1。
  //
  // 既然页面能正常显示 26.07% / 124 这些明文（前端解过码），
  // 最可靠的办法是**直接读 DOM 渲染出来的数字**，而不是自己逆向 PUA。
  //
  // 策略：DOM 优先（真实值）→ 接口 PUA 解码兜底（近似值）
  // ══════════════════════════════════════════════════════════════════════
  let domGoods = []
  if (mode === 'goods' || mode === 'overview') {
    domGoods = await safeEval(() => {
      // sycm 的商品表格可能是 div 布局（不是 table），两种都试
      const out = []
      let headers = []

      // ── 方案 1：标准 table ──
      for (const tb of document.querySelectorAll('table')) {
        const headText = (tb.querySelector('thead')?.innerText || '').slice(0, 400)
        if (!/曝光|访客|浏览量|支付|商品/.test(headText)) continue
        headers = Array.from(tb.querySelectorAll('thead th')).map(th => (th.innerText || '').trim().replace(/\s+/g, ''))
        for (const tr of tb.querySelectorAll('tbody tr')) {
          const tds = Array.from(tr.querySelectorAll('td'))
          if (tds.length < 3) continue
          const rec = {}
          tds.forEach((td, i) => { rec[headers[i] || `col${i}`] = (td.innerText || '').trim().replace(/\s+/g, ' ').replace(/,/g, '') })
          const gid = (Object.values(rec).join(' ').match(/\b(\d{11,14})\b/) || [])[1]
          if (gid) rec.__goodsId = gid
          if (Object.keys(rec).length >= 3) out.push(rec)
        }
        if (out.length) return { headers, rows: out, via: 'table' }
      }

      // ── 方案 2：div 布局（找「行」容器：含商品ID 且 含多个数字单元）──
      // 思路：先找所有含 11-14 位商品ID 的元素，再往上找共同父级，读其文本
      const idNodes = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const t = walker.currentNode.nodeValue || ''
        const m = t.match(/\b(\d{11,14})\b/)
        if (m) {
          let el = walker.currentNode.parentElement
          for (let i = 0; i < 6 && el; i++) {
            // 找到含足够多数字的祖先（一行数据）
            const txt = (el.innerText || '').replace(/\s+/g, ' ')
            if (txt.length > 30 && (txt.match(/\d/g) || []).length > 8) { idNodes.push({ el, gid: m[1], txt }); break }
            el = el.parentElement
          }
        }
      }
      if (idNodes.length) {
        // 用第一个元素的文本推断列（按 空格/tab 切）
        return { headers: [], rows: idNodes.map(x => ({ __goodsId: x.gid, __raw: x.txt })), via: 'div' }
      }

      // ── 方案 3：整页文本（最后兜底，让 Node 侧解析）──
      const bodyTxt = (document.body?.innerText || '').slice(0, 20000)
      return { headers: [], rows: [], via: 'text', bodyText: bodyTxt }
    }).catch(() => ({ headers: [], rows: [], via: 'error' }))
    console.error(`[pdd-shop] DOM 抓取：via=${domGoods?.via} rows=${domGoods?.rows?.length || 0} headers=${domGoods?.headers?.length || 0}`)
    if (domGoods?.rows?.length) {
      console.error(`[pdd-shop] DOM 明文读取成功（${domGoods.via}）：${domGoods.rows.length} 行`)
      if (domGoods.headers?.length) console.error(`  表头: ${domGoods.headers.slice(0, 12).join(' | ')}`)
      console.error(`  首行: ${JSON.stringify(domGoods.rows[0]).slice(0, 300)}`)
    } else if (domGoods?.bodyText) {
      // 存整页文本供分析
      console.error(`[pdd-shop] DOM 未读到结构化行，但拿到整页文本 ${domGoods.bodyText.length} 字`)
      try { fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-shop-page.txt'), domGoods.bodyText, 'utf8') } catch { /* ignore */ }
    }
  }

  // ── PUA 数字混淆解码器 ──────────────────────────────────────────
  // 拼多多 sycm 对数字字段用 PUA 私用区字符（U+E000~U+F8FF）混淆反采集，
  // 且码点每次动态变化。但同一响应里 `*Ppr` 字段是明文的「较上周期差值」，
  // 与被混淆字段等长同构 —— 用 (字段, 字段Ppr) 逐字符对齐反推映射。
  //
  // ★ 2026-10-23：保留原 12 组 PAIRS 为主（实测该批字段覆盖最可靠），
  //   额外加「同名前缀扫描」补漏：凡 <X>Ppr 明文字段存在且与 <X> 等长，
  //   都参与对齐（不限 12 组）。不做跨语义交叉（Ytd↔base 会引入错票）。
  const PUASET_RE = /[\uE000-\uF8FF]/
  const PAIRS = [
    ['goodsUv', 'goodsUvPpr'], ['goodsPv', 'goodsPvPpr'], ['payOrdrCnt', 'payOrdrCntPpr'],
    ['goodsFavCnt', 'goodsFavCntPpr'], ['payOrdrAmt', 'payOrdrAmtPpr'], ['cfmOrdrCnt', 'cfmOrdrCntPpr'],
    ['imprUsrCnt', 'imprUsrCntPpr'], ['ordrCrtUsrCnt', 'ordrCrtUsrCntPpr'], ['cnsltUsrQty', 'cnsltUsrQtyPpr'],
    ['payOrdrGoodsQty', 'payOrdrGoodsQtyPpr'], ['payOrdrUsrCnt', 'payOrdrUsrCntPpr'], ['cfmOrdrGoodsQty', 'cfmOrdrGoodsQtyPpr'],
  ]
  /**
   * 构建 PUA 映射。
   * @param list goodsDetailList
   * @returns { map, coverage }
   */
  const buildPuaMap = (list) => {
    const map = {}
    const bump = (pc, ch) => {
      if (pc < 0xE000 || pc > 0xF8FF) return
      if (!ch || !/\S/.test(ch)) return          // ★ 挡空格/空串
      if (!(pc in map)) map[pc] = ch
    }
    const addPair = (pua, plain) => {
      if (!pua || !plain || pua.length !== plain.length) return
      for (let i = 0; i < pua.length; i++) {
        const pc = pua.codePointAt(i)
        if (pc >= 0xE000 && pc <= 0xF8FF) bump(pc, plain[i])
      }
    }
    // ① 12 组核心 PAIRS（先建立最可靠的映射）
    for (const g of list) {
      for (const [f, pf] of PAIRS) addPair(String(g[f] ?? ''), String(g[pf] ?? ''))
    }
    // ② 补漏：同名前缀 <X> ↔ <X>Ppr 等长对齐（如 goodsPtHelpRate、ordrVstrRto）
    for (const g of list) {
      for (const k of Object.keys(g)) {
        if (!k.endsWith('Ppr')) continue
        const base = k.slice(0, -3)
        const bv = g[base]
        if (typeof bv === 'string' && PUASET_RE.test(bv)) addPair(bv, String(g[k] ?? ''))
      }
    }
    return { map, coverage: { total: Object.keys(map).length } }
  }
  const decodePua = (val, map) => {
    if (val == null) return val
    const s = String(val)
    if (!PUASET_RE.test(s)) return s            // 明文，原样返回
    let out = ''
    for (const c of s) {
      const p = c.codePointAt(0)
      out += (p >= 0xE000 && p <= 0xF8FF) ? (map[p] ?? c) : c
    }
    return out
  }

  const pua = buildPuaMap(gList)
  const map = pua.map
  // ★ DOM 明文索引（按 goodsId），用于覆盖 PUA 解码结果
  const domById = new Map()
  for (const r of (domGoods?.rows || [])) {
    if (r.__goodsId) domById.set(String(r.__goodsId), r)
  }
  /** 从 DOM 行里按「表头关键词」取数字（表头名各账号略有差异，用模糊匹配） */
  const domNum = (rec, kws) => {
    if (!rec) return null
    for (const [k, v] of Object.entries(rec)) {
      if (k === '__goodsId') continue
      if (kws.some(kw => k.includes(kw))) {
        // 去掉 % , 空格，取数字
        const m = String(v).replace(/[,%\s]/g, '').match(/-?\d+(\.\d+)?/)
        if (m) return m[0]
      }
    }
    return null
  }
  const goodsItems = gList.slice(0, limit).map(g => {
    // 先用整表推映射，再逐字段解码（映射对该响应全局有效）
    const d = (v) => decodePua(v, map)
    const dom = domById.get(String(g.goodsId))
    // ★ DOM 明文优先；取不到才用 PUA 解码
    const pick = (kws, puaVal) => {
      const dv = domNum(dom, kws)
      return dv != null ? dv : puaVal
    }
    return {
      goodsId: g.goodsId,
      name: g.goodsName || '',
      date: g.statDate,
      src: dom ? 'dom' : 'pua',    // 数据来源标记
      // ── 曝光（隐藏数据，sycm 商品效果页核心指标）──
      imprUsrCnt: pick(['曝光访客', '曝光人数', '曝光'], d(g.imprUsrCnt)),
      imprUsrCntYtd: d(g.imprUsrCntYtd),
      // ── 流量 ──
      uv: pick(['商品访客', '访客数', '访客'], d(g.goodsUv)),
      pv: pick(['浏览量', '浏览'], d(g.goodsPv)),
      uvYtd: d(g.goodsUvYtd),
      pvYtd: d(g.goodsPvYtd),
      // ── 成交 ──
      payAmt: pick(['支付金额', '成交金额'], d(g.payOrdrAmt)),
      payCnt: pick(['支付订单', '订单数'], d(g.payOrdrCnt)),
      payQty: pick(['支付件数', '件数'], d(g.payOrdrGoodsQty)),
      payUsers: pick(['支付人数', '支付买家数'], d(g.payOrdrUsrCnt)),
      cfmOrdrCnt: d(g.cfmOrdrCnt),
      ordrCrtUsrCnt: pick(['下单人数', '下单买家数'], d(g.ordrCrtUsrCnt)),
      // ── 转化 ──
      vcr: pick(['转化率'], d(g.goodsVcr)),
      ordrVstrRto: pick(['下单访客率', '下单转化率'], d(g.ordrVstrRto)),
      payOrdrRto: pick(['支付访客率', '支付转化率', '支付率'], d(g.payOrdrRto)),
      goodsPtHelpRate: d(g.goodsPtHelpRate),
      // ── 互动 ──
      fav: pick(['收藏'], d(g.goodsFavCnt)),
      cnsltUsrQty: pick(['咨询'], d(g.cnsltUsrQty)),
      // 较上周期参考值（Ppr 明文字段；部分账号返回的是当前值而非差值，仅作参考不用于算环比）
      uvRef: g.goodsUvPpr, pvRef: g.goodsPvPpr, payAmtRef: g.payOrdrAmtPpr,
      vcrRef: g.goodsVcrPpr, favRef: g.goodsFavCntPpr,
      imprRef: g.imprUsrCntPpr,
      // 类目对比 + 指标
      cate3Vcr: d(g.cate3PctGoodsVcr),
      cate3AvgVcr: d(g.cate3AvgGoodsVcr),
      goodsStatus: g.goodsStatus,
      cate1Id: g.cate1Id, cate2Id: g.cate2Id, cate3Id: g.cate3Id,
    }
  })

  // ══════════════════════════════════════════════════════════════════════
  // ★ 派生指标（真实点击率等）—— 只有拿到 DOM 明文曝光时才算得准
  // ══════════════════════════════════════════════════════════════════════
  for (const it of goodsItems) {
    const nImpr = parseFloat(it.imprUsrCnt)
    const nUv = parseFloat(it.uv)
    const nPv = parseFloat(it.pv)
    // 真实点击率（曝光→访客）≈ 访客 / 曝光访客
    it.realCtr = (nImpr > 0 && nUv >= 0) ? +(nUv / nImpr * 100).toFixed(2) : null
    // UV 率（访客/浏览，衡量浏览深度，不是点击率）
    it.uvRate = (nPv > 0 && nUv >= 0) ? +(nUv / nPv * 100).toFixed(2) : null
    // 人均浏览页数
    it.pagesPerUv = (nUv > 0 && nPv > 0) ? +(nPv / nUv).toFixed(2) : null
  }

  const out = { ok: true, mode, shopKey: SHOP, items: [] }
  const lines = []

  if (mode === 'overview' || mode === 'flow') {
    out.flow = flow ? {
      uv: flow.uv, pv: flow.pv,
      uvPct: flow.uvPct, pvPct: flow.pvPct,
      srchIndex: flow.srchIndex, orderIndex: flow.orderIndex,
      totalFans: flow.totalFansCnt, weekFans: flow.curWeekFansCnt,
    } : null
    if (mode === 'flow') {
      lines.push('店铺流量：')
      lines.push(`  访客(uv)：${flow?.uv ?? '—'}${flow?.uvPct ? `（环比 ${flow.uvPct}）` : ''}`)
      lines.push(`  浏览量(pv)：${flow?.pv ?? '—'}${flow?.pvPct ? `（环比 ${flow.pvPct}）` : ''}`)
      lines.push(`  搜索指数：${flow?.srchIndex ?? '—'} | 交易指数：${flow?.orderIndex ?? '—'}`)
      lines.push(`  粉丝：总 ${flow?.totalFansCnt ?? '—'} / 本周新增 ${flow?.curWeekFansCnt ?? '—'}`)
      out.text = lines.join('\n')
    }
  }

  if (mode === 'overview' || mode === 'score') {
    out.score = score || null
    if (mode === 'score') {
      const sd = score?.serviceDataVO || {}
      lines.push('店铺评分（服务数据）：')
      lines.push(`  退款率：${sd.rfRto1m ?? '—'}`)
      lines.push(`  平台介入率：${sd.pltInvlRto1m ?? '—'}`)
      lines.push(`  成功退款订单金额：${sd.sucRfOrdrAmt1d ?? '—'}`)
      lines.push(`  平均成功退款处理时长：${sd.avgSucRfProcTime1m ?? '—'}`)
      out.text = lines.join('\n') || '店铺评分：暂无数据'
    }
  }

  if (mode === 'overview' || mode === 'goods') {
    out.goodsOverview = gOverview ? {
      today: gOverview.todayData, yesterday: gOverview.yesData,
    } : null
    out.goods = goodsItems
    out.items = goodsItems
    if (mode === 'goods') {
      out.puaCoverage = pua.coverage
      out.text = goodsItems.length
        ? `商品数据明细（${goodsItems.length} 个商品，${goodsItems[0]?.date || '今日'}；PUA 解码覆盖 ${pua.coverage.agreed}/${pua.coverage.total} 码点）：\n` + goodsItems.map((g, i) =>
            `  ${i + 1}. [${g.goodsId}] ${String(g.name).slice(0, 24)}`
            + `\n     ★曝光访客=${g.imprUsrCnt ?? '—'}（昨日 ${g.imprUsrCntYtd ?? '—'}）`
            + `\n     访客=${g.uv ?? '—'} 浏览=${g.pv ?? '—'} 收藏=${g.fav ?? '—'} 咨询=${g.cnsltUsrQty ?? '—'}`
            + `\n     支付=${g.payAmt ?? '—'}元 订单=${g.payCnt ?? '—'} 件数=${g.payQty ?? '—'} 人数=${g.payUsers ?? '—'}`
            + `\n     转化率=${g.vcr ?? '—'}（类目 ${g.cate3Vcr ?? '—'} / 类目均值 ${g.cate3AvgVcr ?? '—'}）`
            + (g.payOrdrRto ? ` 支付率=${g.payOrdrRto}` : '')
            + (g.ordrVstrRto ? ` 下单访客率=${g.ordrVstrRto}` : '')
          ).join('\n')
        : '商品数据：暂无明细（接口未返回或页面未加载完）'
    }
  }

  if (mode === 'overview') {
    out.mallLevel = mallLevel ? { level: mallLevel.level, gmv: mallLevel.gmv, restGmv: mallLevel.restGmv } : null
    const td = gOverview?.todayData
    const yd = gOverview?.yesData
    lines.length = 0
    lines.push('店铺经营总览：')
    if (mallLevel) lines.push(`  店铺等级：${mallLevel.level ?? '—'}${mallLevel.gmv ? `（当前 GMV ${mallLevel.gmv}）` : ''}`)
    if (flow) lines.push(`  访客 ${flow.uv ?? '—'} | 浏览量 ${flow.pv ?? '—'} | 粉丝 ${flow.totalFansCnt ?? '—'}`)
    if (td) lines.push(`  今日商品数据：支付金额 ${td.payOrdrAmt}元 / 订单 ${td.payOrdrCnt} / 访客商品 ${td.vstGoodsCnt} / 支付转化 ${td.payUvRto}`)
    if (yd) lines.push(`  昨日商品数据：支付金额 ${yd.payOrdrAmt}元 / 订单 ${yd.payOrdrCnt} / 访客商品 ${yd.vstGoodsCnt} / 支付转化 ${yd.payUvRto}`)
    if (goodsItems.length) {
      const top = goodsItems.slice().sort((a, b) => Number(b.payAmt || 0) - Number(a.payAmt || 0))[0]
      lines.push(`  支付金额最高商品：[${top.goodsId}] ${String(top.name).slice(0, 24)}（${top.payAmt}元 / ${top.payCnt}单）`)
    }
    out.text = lines.join('\n')
  }

  if (mode !== 'overview' && mode !== 'flow' && mode !== 'score' && mode !== 'goods') {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：overview / flow / score / goods` })
    await browser.close()
    process.exit(2)
  }
  emit(out)
  clearInterval(hb)
  await browser.close()
})().catch(async (e) => {
  // ★ 风控异常 → 友好提示
  const { checkCooldown, fmtRemain } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`).catch(() => ({}))
  if (e?.riskCode && checkCooldown) {
    const cd = checkCooldown(SHOP)
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `命中平台频控（code=${e.riskCode}${e.riskMsg ? `：${e.riskMsg}` : ''}），已记冷却 ${fmtRemain(cd.remainMs)}。\n期间请勿重复调用（会延长封禁）。\n若急需使用，可在浏览器窗口手动过滑块验证，然后重试。`,
    })
    process.exit(2)
  }
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})

