/**
 * 拼多多店铺经营数据（pdd-shop）—— 只读
 *
 * 数据源：生意参谋（mms.pinduoduo.com/sycm/*），接口统一 /sydney/api/* 前缀。
 * 全部 HTTP，无平台副作用。采用「打开经营页 → hook 页面自己的响应」取数
 * （与 pdd-promo 同思路，规避 sycm 的风控签名）。
 *
 * 能力：
 *   overview   店铺经营总览（流量 + 评分 + 商品数据 + 店铺等级）
 *   flow       店铺流量数据（访客 uv / 浏览量 pv / 粉丝 / 搜索指数）
 *   score      店铺评分（服务数据：退款率/发货/客服响应）
 *   goods      商品数据明细（每商品 访客/支付金额/支付订单/转化率/收藏）
 *
 * 用法：node scripts/shop.mjs --mode overview
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

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


  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) {
    profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
  }
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
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
  const goodsItems = gList.slice(0, limit).map(g => {
    // 先用整表推映射，再逐字段解码（映射对该响应全局有效）
    const d = (v) => decodePua(v, map)
    return {
      goodsId: g.goodsId,
      name: g.goodsName || '',
      date: g.statDate,
      // ── 曝光（隐藏数据，sycm 商品效果页核心指标）──
      imprUsrCnt: d(g.imprUsrCnt),        // 曝光访客数（今日）
      imprUsrCntYtd: d(g.imprUsrCntYtd),  // 曝光访客数（昨日）
      // ── 流量 ──
      uv: d(g.goodsUv),           // 访客
      pv: d(g.goodsPv),           // 浏览量
      uvYtd: d(g.goodsUvYtd),
      pvYtd: d(g.goodsPvYtd),
      // ── 成交 ──
      payAmt: d(g.payOrdrAmt),    // 支付金额
      payCnt: d(g.payOrdrCnt),    // 支付订单
      payQty: d(g.payOrdrGoodsQty),
      payUsers: d(g.payOrdrUsrCnt),
      cfmOrdrCnt: d(g.cfmOrdrCnt),        // 确认订单
      ordrCrtUsrCnt: d(g.ordrCrtUsrCnt),  // 下单人数
      // ── 转化 ──
      vcr: d(g.goodsVcr),         // 转化率
      ordrVstrRto: d(g.ordrVstrRto),      // 下单访客率
      payOrdrRto: d(g.payOrdrRto),        // 支付访客率
      goodsPtHelpRate: d(g.goodsPtHelpRate),  // 商品帮扶率
      // ── 互动 ──
      fav: d(g.goodsFavCnt),      // 收藏
      cnsltUsrQty: d(g.cnsltUsrQty),      // 咨询人数
      // 较上周期参考值（Ppr 明文字段；部分账号返回的是当前值而非差值，仅作参考不用于算环比）
      uvRef: g.goodsUvPpr, pvRef: g.goodsPvPpr, payAmtRef: g.payOrdrAmtPpr,
      vcrRef: g.goodsVcrPpr, favRef: g.goodsFavCntPpr,
      imprRef: g.imprUsrCntPpr,
      // 类目对比 + 指标
      cate3Vcr: d(g.cate3PctGoodsVcr),      // 本店三级类目转化率
      cate3AvgVcr: d(g.cate3AvgGoodsVcr),   // 三级类目均值
      goodsStatus: g.goodsStatus,
      cate1Id: g.cate1Id, cate2Id: g.cate2Id, cate3Id: g.cate3Id,
    }
  })

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

