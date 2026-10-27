/**
 * 拼多多推广数据 + 推广操作（pdd-promo）
 *
 * 推广域独立：yingxiao.pinduoduo.com（独立子应用，自己的风控签名）。
 * 实测：自己发 fetch 必被 54001 拦（该域的 Anti-Content 与 mms 不同源，
 * 且 crawlerInfo 与页面会话强绑定）—— 故采用「hook 页面自己发的响应」模式：
 * 打开推广页 → 页面自己发数据请求 → 我们拦截响应 → 解析。
 * 这与 pdd-publish-http 的「页面会话 + 拦截」是同源思路。
 *
 * 能力：
 *   overview   推广总览（资金账户 + 日消耗 + 广告组 + 场景）
 *   goods      商品维度报表（每商品 花费/GMV/订单/ROI/点击）
 *   groups     广告组列表
 *   cost       每日消耗
 *   units      推广单元列表（v3/list：adInfos + totalAdNum）
 *   ── 写操作（L2）──
 *   pause      暂停推广单元（global/unit/batchUpdateStatus）
 *   resume     开启推广单元
 *   delete     删除推广单元（goods/promotion/virtual/delete）
 *   create     创建商品推广（promotion/batchCreate）
 *   maxcost    改日限额（goods/promotion/update/max/cost）
 *   roi        改投产比/出价（promotion/batchUpdateBid）
 *
 * 用法：node scripts/promo.mjs --mode overview
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
  const lock = await tryAcquireAccountLock(SHOP, 'pdd-promo', 300000)
  if (!lock.ok) {
    emit({ ok: false, failureKind: 'rate_limit', text: '账号 ' + SHOP + ' 正被其他任务占用' + (lock.holder ? '（' + lock.holder + '）' : '') + '，请稍后再试。' })
    process.exit(2)
  }
  const releaseLock = () => { try { releaseAccountLock(SHOP) } catch (e) {} }
  process.on('exit', releaseLock)
  process.on('SIGINT', () => { releaseLock(); process.exit(130) })
  process.on('SIGTERM', () => { releaseLock(); process.exit(143) })
  const hb = setInterval(() => heartbeatAccountLock(SHOP, 'pdd-promo'), 180000)


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

  // ★ 风控 L3：滑块遮罩自动过
  const ensureNoSlider = async (label) => {
    if (await detectSlider(page)) {
      console.warn(`[pdd-promo] ${label}：检测到滑块遮罩，尝试自动过滑块...`)
      const solved = await autoSolveSlider(SHOP, page)
      if (!solved.ok) {
        await browser.close()
        emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}\n请手动过验证后重试。` })
        process.exit(2)
      }
      console.warn(`[pdd-promo] 滑块已过：${solved.text}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // 收集页面自己发的推广数据响应（按接口分类存最新一条）
  /**
   * ★ labelType 官方枚举（2026-10-27 从前端 bundle 实证挖出）
   *
   *   来源：yingxiao.pinduoduo.com/goods/promotion/list 页面
   *         static/chunks/pages/goods/promotion/list-*.js
   *         枚举对象 eO + 中文映射表 sB + 各 labelType 的渲染文案
   *
   *   注意：labelType 不在 diagnosis 模块顶层，而在**第三层竞争力 VO 内部**：
   *     moduleType=1（出价竞争力）  → bidCompetitiveness.exceptionLabelList[]
   *     moduleType=3（竞争力下滑）  → exposureCompetitiveness.exceptionLabelList[]
   *     moduleType=5（排名过低）    → conversionCompetitive.exceptionLabelList[]
   *   顶层 m.exceptionLabelList 通常是空的（实测 8 单元 35 模块全空）。
   *
   *   严重程度（前端 sT 的 type 字段）：
   *     error   级 = [tooLow(1), impressionLow(4), conversionLow(7)]
   *     warning 级 = 其余
   */
  const LABEL_TYPES = {
    1:  { key: 'tooLow',                      name: '出价过低',           level: 'error',
          tip: '当前推广近 {days} 天综合出价设置过低，低于 {rank}% 相似推广' },
    2:  { key: 'bidDecline',                  name: '近期降价',           level: 'warning',
          tip: '近期推广存在降低出价操作，不利于稳定投放' },
    3:  { key: 'bidCompetitionDecline',       name: '出价竞争力下滑',     level: 'warning',
          tip: '近期推广出价竞争力下滑，不利于流量竞争' },
    4:  { key: 'impressionLow',               name: '曝光过低',           level: 'error',
          tip: '当前推广近 {days} 天综合曝光量过低，低于 {rank}% 相似推广' },
    5:  { key: 'impressionDecline',           name: '曝光掉量',           level: 'warning',
          tip: '近期推广曝光下滑' },
    6:  { key: 'impressionCompetitionDecline',name: '曝光竞争力下滑',     level: 'warning',
          tip: '近期推广曝光竞争力下滑' },
    7:  { key: 'conversionLow',               name: '转化过低',           level: 'error',
          tip: '当前推广近 {days} 天综合订单获取能力过差，低于 {rank}% 相似推广' },
    8:  { key: 'conversionDecline',           name: '转化掉量',           level: 'warning',
          tip: '近期推广存在成交下滑趋势' },
    9:  { key: 'conversionCompetitionDecline',name: '转化竞争力下滑',     level: 'warning',
          tip: '近期推广转化竞争力下滑' },
    10: { key: 'stage2Difficult',             name: '进入二阶段困难',     level: 'warning',
          tip: '推广长期在一阶段，进入二阶段存在困难' },
  }
  /** 把 labelType 数字转成可读标签（含 error 级标记） */
  const labelText = (t) => {
    const d = LABEL_TYPES[t]
    if (!d) return String(t)
    return (d.level === 'error' ? '🔴' : '🟡') + d.name + `(${t})`
  }

  const byApi = {}
  const APIS = [
    ['accountAll', 'reinhardt/homepage/v3/accountAll'],
    ['dailyCost', 'reinhardt/invoice/getAdvertiserDailyCosts'],
    ['adGroups', 'venus/api/goods/promotion/listAdGroupInfo'],
    ['scenes', 'ryze/planIncreaseBudget/queryAllScenesAdList'],
    ['goodsUpgrade', 'venus/api/goods/promotion/queryGoodsMarketingUpgradeInfo'],
    ['entityReport', 'poseidon/api/report/queryEntityReport'],
    ['rangeReport', 'poseidon/api/report/queryRangeReport'],
    ['reportConfig', 'poseidon/report/queryReportCustomConfig'],
    ['unitList', 'goods/promotion/v3/list'],
    // ★ 推广诊断相关（2026-10-23 逆向，见知识库「拼多多推广诊断逆向」）
    ['adDiagnosis', 'smartTool/diagnosis/queryStableCostAdDiagnosis'],
    ['assistInfo', 'smartTool/strategy/mall/guide/queryPromotionAssistantInfo'],
    ['chargeSuggest', 'smartTool/mall/charge/suggest'],
    ['promotionDetail', 'goods/promotion/detail/query'],
    ['chanceGoods', 'traffic/mall/guide/queryChanceGoodsGuide'],
    ['suggestCard', 'caymanSuggestCard/queryCard'],
    ['smartPromotion', 'goods/promotion/smart/promotion/v3/info'],
  ]
  // ★ 主通道：页面内 hook XHR 的 load 事件（CDP getResponseBody 在快跳转时大面积失败，
  //   实测 42 个请求只成功 0 个；页面内 hook 42/42 全拿到）
  await page.evaluateOnNewDocument(() => {
    window.__caps = []
    const O = XMLHttpRequest.prototype.open
    const S = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return O.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function () {
      const self = this
      this.addEventListener('load', () => {
        try {
          const u = String(self.__u || '')
          if (!/mms-gateway/.test(u)) return
          const txt = self.responseText
          if (!txt || txt.length < 20) return
          JSON.parse(txt)   // 只存合法 JSON
          window.__caps.push({ url: u.slice(0, 260), body: txt.slice(0, 300000), len: txt.length })
          if (window.__caps.length > 400) window.__caps.splice(0, 150)
        } catch { /* 非 JSON / 跨域 */ }
      })
      return S.apply(this, arguments)
    }
  })
  cdp.on('Network.responseReceived', async (e) => {
    if (e.response.status !== 200) return
    const u = e.response.url
    if (!/mms-gateway/.test(u)) return
    const hit = APIS.find(([, key]) => u.includes(key))
    if (!hit) return
    try {
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const j = JSON.parse(b.body)
      if (j && (j.errorCode === 1000 || j.error_code === 1000000 || j.success === true)) {
        if (hit[0] === 'rangeReport') {
          // ★ 同一接口会发多次（今日/昨日/近7日），全部留档，用的时候取 dailyReportList 最长的
          byApi.rangeReport = byApi.rangeReport || []
          byApi.rangeReport.push(j.result)
        } else {
          byApi[hit[0]] = j.result
        }
      }
    } catch { /* ignore */ }
  })

  // ★ 签名 hook 必须在导航前注入（evaluateOnNewDocument 只对之后的导航生效）
  //   捕获页面自己发的 mms-gateway 请求的 {Anti-Content 头, crawlerInfo body} 配对
  await page.evaluateOnNewDocument(() => {
    window.__sigPair = null
    const O = window.XMLHttpRequest.prototype.open
    const S = window.XMLHttpRequest.prototype.send
    const SH = window.XMLHttpRequest.prototype.setRequestHeader
    window.XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return O.apply(this, arguments) }
    window.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h[k] = v; return SH.apply(this, arguments) }
    window.XMLHttpRequest.prototype.send = function (b) {
      try {
        if (/mms-gateway/.test(this.__u) && String(b || '').includes('crawlerInfo')) {
          window.__sigPair = { anti: this.__h['Anti-Content'], crawlerInfo: JSON.parse(String(b)).crawlerInfo }
        }
      } catch { /* ignore */ }
      return S.apply(this, arguments)
    }
  })

  // 打开推广各页让页面自己发请求（报表页含商品维度 queryEntityReport）
  const PAGES = [
    'https://yingxiao.pinduoduo.com/mains/promotionOverview',
    'https://yingxiao.pinduoduo.com/goods/report/promotion/overView',
    'https://yingxiao.pinduoduo.com/goods/promotion/list',
  ]
  for (const u of PAGES) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await new Promise(r => setTimeout(r, 13000))
      await ensureNoSlider(u)   // ★ 风控 L3
      if (/\/login/i.test(page.url())) {
        await browser.close()
        emit({ ok: false, failureKind: 'token_expired', text: '推广域登录态失效，请到「账号连接」重新登录拼多多商家后台。' })
        process.exit(2)
      }
    } catch { /* 单页失败不阻断 */ }
  }

  // ★★ diagnose 模式：必须打开「诊断抽屉」URL 才会触发诊断接口
  //   格式：/goods/promotion/list?adId=<推广ID>&drawerTab=promoteDiagnosis
  //   不带 drawerTab 时抽屉不打开，queryStableCostAdDiagnosis 不会发。
  if (mode === 'diagnose' || mode === 'balance' || mode === 'item') {
    // 1) 先从推广列表拿 adId
    let adIds = []
    const ads = byApi.unitList?.adInfos || []
    adIds = ads.map(a => a.adId ?? a.id).filter(Boolean)
    // item 模式：只给 goods-id 时，先反查该商品的推广单元 adId
    if (mode === 'item' && !argOf('ad-id') && argOf('goods-id')) {
      const gid = String(argOf('goods-id'))
      const hit = ads.find(a => String(a.goodsId) === gid)
      if (hit?.adId) adIds = [String(hit.adId)]
      else adIds = []
    }
    // 也接受用户显式指定
    if (argOf('ad-id')) adIds = [String(argOf('ad-id'))]
    const MAX_DIAG = Math.min(adIds.length, parseInt(argOf('limit') || '10', 10) || 10)
    console.warn(`[pdd-promo] diagnose：共 ${adIds.length} 个推广单元，逐个打开诊断抽屉（上限 ${MAX_DIAG}）`)
    for (let i = 0; i < MAX_DIAG; i++) {
      const adId = adIds[i]
      const diagUrl = `https://yingxiao.pinduoduo.com/goods/promotion/list?adId=${adId}&drawerTab=promoteDiagnosis`
      try {
        await page.goto(diagUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await new Promise(r => setTimeout(r, 12000))
        await ensureNoSlider('诊断抽屉')
        if (/\/login/i.test(page.url())) {
          await browser.close()
          emit({ ok: false, failureKind: 'token_expired', text: '推广域登录态失效，请到「账号连接」重新登录拼多多商家后台。' })
          process.exit(2)
        }
        // 从页面内 hook 缓冲里捞诊断响应
        const caps = await page.evaluate(() => window.__caps || []).catch(() => [])
        for (const c of caps) {
          const hit = APIS.find(([, key]) => c.url.includes(key))
          if (!hit) continue
          try {
            const j = JSON.parse(c.body)
            const res = j.result ?? j.data
            if (!res) continue
            if (hit[0] === 'adDiagnosis') {
              byApi.adDiagnosisByAd = byApi.adDiagnosisByAd || {}
              byApi.adDiagnosisByAd[adId] = res
            } else if (hit[0] === 'rangeReport') {
              byApi.rangeReport = byApi.rangeReport || []
              byApi.rangeReport.push(res)
            } else if (!byApi[hit[0]]) byApi[hit[0]] = res
          } catch { /* ignore */ }
        }
        // 该次抽屉的详情
        const detailCaps = caps.filter(c => /goods\/promotion\/detail\/query/.test(c.url))
        if (detailCaps.length) {
          try {
            const j = JSON.parse(detailCaps[detailCaps.length - 1].body)
            byApi.promotionDetailByAd = byApi.promotionDetailByAd || {}
            byApi.promotionDetailByAd[adId] = j.result ?? j.data
          } catch { /* ignore */ }
        }
        console.warn(`[pdd-promo] ${adId} 诊断完成`)
      } catch (e) {
        console.warn(`[pdd-promo] ${adId} 诊断失败：${e.message?.slice(0, 80)}`)
      }
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  // ── 解析 ──
  const yuan = (v) => (v == null ? null : (Number(v) / 100).toFixed(2))
  const acc = byApi.accountAll || null
  const totalDetail = acc?.totalDetail || []
  const main = totalDetail.find(x => x.toAdvertiserFundType === 1) || totalDetail[0] || null
  const costs = (byApi.dailyCost || []).map(x => ({ date: x.date, cost: x.dailyCostForHttp?.value ?? null }))
  const groups = (byApi.adGroups?.adGroupInfoList || []).map(g => ({ id: g.groupId, name: g.groupName, adCount: g.groupAdCount }))
  const scenes = byApi.scenes || null
  const sceneCount = scenes
    ? (scenes.liveAdInfoList || []).length + (scenes.stableCostAdInfoList || []).length + (scenes.starAdInfoList || []).length
    : 0

  // ══════════════════════════════════════════════════════════════════════
  // 速率表工具（goods / item / rates 共用）
  //   设置速率 = 日限额 / 时段小时数（默认 8:00-18:00 = 10h）
  //   真实速率 = 单品今日已花 / 已过小时数
  //   倍数     = 真实速率 / 设置速率
  // ══════════════════════════════════════════════════════════════════════
  const buildRateRows = () => {
    const startH = parseFloat(argOf('start-hour') || '8') || 8
    const targetH = parseFloat(argOf('target-hour') || '18') || 18
    const span = Math.max(0.5, targetH - startH)
    const todayCost = (costs.length ? costs[costs.length - 1] : null)
    const nowTs = todayCost?.date ? new Date(todayCost.date) : new Date()
    const nowHr = nowTs.getHours() + nowTs.getMinutes() / 60
    const elapsed = Math.max(0, nowHr - startH)

    const rows = (byApi.unitList?.adInfos || []).map(u => {
      const num = (v) => (v && typeof v === 'object' && 'value' in v) ? parseFloat(v.value) : (typeof v === 'number' ? v : null)
      return {
        adId: u.adId ?? u.id,
        goodsId: String(u.goodsId ?? ''),
        name: u.adName ?? u.goodsName ?? '',
        status: u.adStatus ?? u.status,
        maxCost: num(u.maxCost),
        today: num(u.dailyCost),
      }
    }).filter(r => r.status === 1 && r.maxCost != null && r.maxCost > 0 && r.maxCost < 1000000)

    for (const r of rows) {
      r.setRate = r.maxCost / span
      r.realRate = (r.today != null && elapsed > 0) ? r.today / elapsed : null
      r.ratio = (r.realRate != null && r.setRate > 0) ? r.realRate / r.setRate : null
    }
    rows.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
    return { rows, startH, targetH, span, elapsed, nowTs }
  }

  /** 渲染速率表文本（compact=只显示有消耗的） */
  const renderRateTable = ({ rows, startH, targetH, span, elapsed, nowTs }, opts = {}) => {
    const { compact = false, limit = 30 } = opts
    const fmt = (v, d = 2) => v == null ? '—' : Number(v).toFixed(d)
    const tag = (r) => r == null ? '' : r >= 1.2 ? '🔴' : r >= 1 ? '🟢' : '🟡'
    const shown = compact ? rows.filter(r => (r.today ?? 0) > 0) : rows
    const L = []
    L.push(`全店速率表（时段 ${startH}:00-${targetH}:00 = ${span}h｜已过 ${elapsed.toFixed(1)}h｜${rows.length} 个在投${compact ? `，${shown.length} 个有消耗` : ''}）`)
    L.push('')
    L.push('倍数    产品ID        设置速率   真实速率  今日花费  日限额  名称')
    L.push('─'.repeat(96))
    for (const r of shown.slice(0, limit)) {
      L.push(
        (tag(r.ratio) + (r.ratio != null ? r.ratio.toFixed(2) + '×' : '—')).padEnd(8)
        + String(r.adId).padEnd(14)
        + (fmt(r.setRate) + '/h').padStart(9) + '  '
        + (fmt(r.realRate) + '/h').padStart(9) + '  '
        + ('¥' + fmt(r.today)).padStart(9) + '  '
        + ('¥' + fmt(r.maxCost, 0)).padStart(7) + '  '
        + String(r.name).slice(0, 24)
      )
    }
    if (shown.length > limit) L.push(`... 还有 ${shown.length - limit} 个`)
    const totSet = rows.reduce((s, r) => s + r.setRate, 0)
    const totToday = rows.reduce((s, r) => s + (r.today ?? 0), 0)
    const totReal = elapsed > 0 ? totToday / elapsed : null
    L.push('─'.repeat(96))
    L.push(`合计：设置 ${fmt(totSet)}/h｜真实 ${fmt(totReal)}/h｜倍数 ${totSet > 0 && totReal != null ? (totReal / totSet).toFixed(2) + '×' : '—'}｜今日已花 ¥${fmt(totToday)}`)
    L.push('🔴 ≥1.2× 烧得快该提 ｜ 🟢 1~1.2× 正常 ｜ 🟡 <1× 偏慢')
    return { text: L.join('\n'), totalSet: totSet, totalReal: totReal, totalToday: totToday, shown }
  }

  const out = {
    ok: true, mode, shopKey: SHOP,
    account: main ? { balance: yuan(main.balance), spendable: yuan(main.spendable), fundType: main.toAdvertiserFundType } : null,
    accounts: totalDetail.map(x => ({ type: x.toAdvertiserFundType, balance: yuan(x.balance), spendable: yuan(x.spendable) })),
    dailyCost: costs,
    groups,
    sceneCount,
    goodsUpgraded: byApi.goodsUpgrade?.isGoodsMarketingUpgraded ?? null,
  }
  const lines = []
  lines.push(`推广总览${out.accounts.length > 1 ? `（${out.accounts.length} 个资金账户）` : ''}：`)
  out.accounts.forEach((a, i) => lines.push(`  账户${i + 1}（type=${a.type}）：余额=${a.balance}元 可用=${a.spendable}元`))
  if (costs.length) {
    const latest = costs[costs.length - 1]
    lines.push(`  最近消耗（${latest.date}）：${latest.cost}元`)
  }
  lines.push(`  广告组：${groups.length} 个${groups.length ? `（${groups.map(g => g.name).join('、')}）` : ''}`)
  lines.push(`  场景推广（直播/全站/明星店）：${sceneCount} 个`)
  lines.push(`  商品推广升级版：${out.goodsUpgraded ? '已升级' : '未升级'}`)
  if (!groups.length && !sceneCount) lines.push('  （店铺当前没有推广计划/场景投放）')
  out.text = lines.join('\n')

  // ── goods 模式：商品维度报表（poseidon queryEntityReport）──
  if (mode === 'goods' || mode === 'overview') {
    const list = byApi.entityReport?.entityReportList || []
    const sum = byApi.entityReport?.pageSumReport
      || (Array.isArray(byApi.rangeReport) ? (byApi.rangeReport.find(r => r?.sumReport) || {}).sumReport : byApi.rangeReport?.sumReport)
      || null
    const num = (v) => (v && typeof v === 'object' ? v.value : (v ?? null))
    out.goodsReport = {
      total: byApi.entityReport?.total ?? list.length,
      items: list.map(x => ({
        goodsId: x.goodsId ?? x.entityId,
        goodsName: x.goodsName ?? x.entityName ?? '',
        spend: num(x.orderSpend ?? x.spend),
        gmv: num(x.gmv),
        orderNum: x.orderNum,
        roi: num(x.orderSpendRoiUnified ?? x.roi),
        click: x.click ?? x.clickNum,
        impression: x.impression ?? x.imprNum,
        ctr: num(x.ctr),
      })),
      sum: sum ? {
        spend: num(sum.orderSpend), gmv: num(sum.gmv), netGmv: num(sum.netGmv),
        orderNum: sum.orderNum, roi: num(sum.orderSpendRoiUnified),
        click: sum.click ?? sum.clickNum, impression: sum.impression ?? sum.imprNum,
        ctr: num(sum.ctr), fav: num(sum.goodsFav ?? sum.multiGoalGoodsFav),
      } : null,
    }
    if (mode === 'goods') {
      const g = out.goodsReport
      out.text = g.items.length
        ? `商品推广报表（${g.items.length}/${g.total} 个商品）：\n` + g.items.slice(0, 30).map((x, i) =>
            `  ${i + 1}. [${x.goodsId}] ${String(x.goodsName).slice(0, 24)} | 花费=${x.spend ?? '—'} GMV=${x.gmv ?? '—'} 订单=${x.orderNum ?? '—'} ROI=${x.roi ?? '—'} 点击=${x.click ?? '—'}`).join('\n')
        : `商品推广报表：暂无商品推广数据（entityReportList 为空，total=0）。\n说明：店铺当前没有正在投放的商品。` +
          (g.sum ? `\n周期汇总：花费=${g.sum.spend} GMV=${g.sum.gmv} 订单=${g.sum.orderNum} ROI=${g.sum.roi} 点击=${g.sum.click} 收藏=${g.sum.fav}` : '')

      // ★ 追加：全店速率表（付费分析的一部分）
      try {
        // unitList 可能没抓到（goods 模式不导航推广列表页），补抓一次
        if (!(byApi.unitList?.adInfos || []).length) {
          await page.goto('https://yingxiao.pinduoduo.com/goods/promotion/list', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
          await new Promise(r => setTimeout(r, 12000))
          const _caps = await page.evaluate(() => window.__caps || []).catch(() => [])
          for (const c of _caps) {
            if (!/goods\/promotion\/v3\/list/.test(c.url)) continue
            try {
              const jj = JSON.parse(c.body)
              const res = jj.result ?? jj.data
              if (res?.adInfos?.length) { byApi.unitList = res; break }
            } catch { /* ignore */ }
          }
        }
        const rd = buildRateRows()
        const rr = renderRateTable(rd, { compact: false })
        out.text += '\n\n' + rr.text
        out.rates = rd.rows.map(r => ({
          adId: r.adId, goodsId: r.goodsId, name: r.name,
          maxCost: r.maxCost, today: r.today,
          setRate: r.setRate, realRate: r.realRate, ratio: r.ratio,
        }))
      } catch (e) { /* 速率表失败不影响主报表 */ }
    }
  }

  // ── rates 模式：全店速率表格 ──
  if (mode === 'rates') {
    const rateData = buildRateRows()
    const rendered = renderRateTable(rateData, { compact: false })
    out.text = rendered.text
    out.rates = rateData.rows.map(r => ({
      adId: r.adId, goodsId: r.goodsId, name: r.name,
      maxCost: r.maxCost, today: r.today,
      setRate: r.setRate, realRate: r.realRate, ratio: r.ratio,
    }))
    out.summary = {
      span: rateData.span, elapsed: rateData.elapsed,
      totalSetRate: rendered.totalSet, totalRealRate: rendered.totalReal, totalToday: rendered.totalToday,
    }
  }

  // ── item 模式：单品推广诊断（商品维度 + 推广单元维度合成一个结论）──
  //   ★ 2026-10-28 新增：配合《外部运营打法验证方法论》的「一个品一个店一起跑」
  //   输入：--goods-id <商品ID> 或 --ad-id <推广单元ID>
  //   输出：一屏结论（能不能放量 / 该提什么）+ 商品数据 + 平台标签 + 调参命令
  if (mode === 'item') {
    const wantGoodsId = argOf('goods-id') ? String(argOf('goods-id')) : null
    const wantAdId = argOf('ad-id') ? String(argOf('ad-id')) : null

    // 1) 定位推广单元
    const allUnits = (byApi.unitList?.adInfos || []).map(u => ({
      adId: u.adId ?? u.id,
      adName: u.adName ?? u.name ?? '',
      goodsId: String(u.goodsId ?? ''),
      goodsName: u.goodsName ?? '',
      status: u.adStatus ?? u.status,
      maxCost: (u.maxCost && typeof u.maxCost === 'object' && 'value' in u.maxCost) ? parseFloat(u.maxCost.value) : (typeof u.maxCost === 'number' ? u.maxCost : null),
      expectedBid: (u.bidAlertInfo?.expectedBid && typeof u.bidAlertInfo.expectedBid === 'object') ? parseFloat(u.bidAlertInfo.expectedBid.value) : null,
      bidAlertType: u.bidAlertInfo?.alertType ?? null,
      bidMin: (u.suggestLimitInfo?.minValue && typeof u.suggestLimitInfo.minValue === 'object') ? parseFloat(u.suggestLimitInfo.minValue.value) : null,
      bidMax: (u.suggestLimitInfo?.maxValue && typeof u.suggestLimitInfo.maxValue === 'object') ? parseFloat(u.suggestLimitInfo.maxValue.value) : null,
      suggestMaxCost: (u.maxCostSuggestVO?.suggestMaxCost && typeof u.maxCostSuggestVO.suggestMaxCost === 'object') ? parseFloat(u.maxCostSuggestVO.suggestMaxCost.value) : null,
      // ★ 单品当天消耗（真实值，不是分摊）
      dailyCost: (u.dailyCost && typeof u.dailyCost === 'object') ? parseFloat(u.dailyCost.value) : (typeof u.dailyCost === 'number' ? u.dailyCost : null),
    }))

    let unit = null
    if (wantAdId) unit = allUnits.find(u => String(u.adId) === wantAdId) || null
    if (!unit && wantGoodsId) unit = allUnits.find(u => u.goodsId === wantGoodsId) || null

    if (!unit) {
      const pool = wantAdId || wantGoodsId
      out.text = `未找到推广单元${pool ? `（${pool}）` : ''}。\n`
        + `请先跑 --mode units 拿 adId / goodsId。\n`
        + (wantGoodsId ? `该商品可能没有在投的推广单元——先用 --mode create 开一个。\n` : '')
        + (wantAdId ? `该推广单元 ID 不存在或已删除。\n` : '')
      out.item = null
    } else {
      const gid = unit.goodsId

      // 2) 商品维度推广数据（entityReport 为空时补抓一次报表页）
      if (!(byApi.entityReport?.entityReportList || []).length) {
        try {
          await page.goto('https://yingxiao.pinduoduo.com/goods/report/promotion/overView', { waitUntil: 'domcontentloaded', timeout: 45000 })
          await new Promise(r => setTimeout(r, 12000))
          const caps2 = await page.evaluate(() => window.__caps || []).catch(() => [])
          for (const c of caps2) {
            if (!/queryEntityReport/.test(c.url)) continue
            const j = JSON.parse(c.body)
            const res = j.result ?? j.data
            if (res?.entityReportList?.length) { byApi.entityReport = res; break }
          }
        } catch { /* 补抓失败就用已有数据 */ }
      }
      const gItems = (byApi.entityReport?.entityReportList || []).map(x => ({
        goodsId: String(x.goodsId ?? x.entityId ?? ''),
        spend: (x.orderSpend && typeof x.orderSpend === 'object') ? parseFloat(x.orderSpend.value) : (x.orderSpend ?? null),
        gmv: (x.gmv && typeof x.gmv === 'object') ? parseFloat(x.gmv.value) : (x.gmv ?? null),
        netGmv: (x.netGmv && typeof x.netGmv === 'object') ? parseFloat(x.netGmv.value) : (x.netGmv ?? null),
        orderNum: x.orderNum ?? null,
        roi: (x.orderSpendRoiUnified && typeof x.orderSpendRoiUnified === 'object') ? parseFloat(x.orderSpendRoiUnified.value) : (x.orderSpendRoiUnified ?? null),
        click: x.click ?? x.clickNum ?? null,
        impression: x.impression ?? x.imprNum ?? null,
        ctr: (x.ctr && typeof x.ctr === 'object') ? parseFloat(x.ctr.value) : (x.ctr ?? null),
        perCost: (x.perNetCost && typeof x.perNetCost === 'object') ? parseFloat(x.perNetCost.value) : (x.perNetCost ?? null),
      }))
      const g = gItems.find(x => x.goodsId === gid) || null
      const gSum = byApi.entityReport?.pageSumReport || null
      const shopAvg = gSum ? {
        ctr: (gSum.ctr && typeof gSum.ctr === 'object') ? parseFloat(gSum.ctr.value) : (gSum.ctr ?? null),
        roi: (gSum.orderSpendRoiUnified && typeof gSum.orderSpendRoiUnified === 'object') ? parseFloat(gSum.orderSpendRoiUnified.value) : (gSum.orderSpendRoiUnified ?? null),
      } : null

      // 3) 平台诊断（该单元的 labelType）
      const diag = byApi.adDiagnosisByAd?.[String(unit.adId)] || null
      const errLabels = []
      const warnLabels = []
      if (diag) {
        for (const m of (diag.competitionDiagnosisList || [])) {
          for (const [voName, vo] of [
            ['出价', m.bidCompetitiveness],
            ['曝光', m.exposureCompetitiveness],
            ['转化', m.conversionCompetitive],
          ]) {
            for (const e of (vo?.exceptionLabelList || [])) {
              if (e.labelType == null) continue
              const def = LABEL_TYPES[e.labelType]
              const item = {
                labelType: e.labelType,
                name: def?.name || `未知(${e.labelType})`,
                level: def?.level || 'warning',
                dim: voName,
                rank: e.competitivenessTooLowVO?.rank ?? vo?.rank ?? null,
                days: e.competitivenessTooLowVO?.referenceDays ?? null,
              }
              if (item.level === 'error') errLabels.push(item)
              else warnLabels.push(item)
            }
          }
        }
      }

      // 4) 一屏结论
      const verdict = []
      const L = []

      const fmtRoi = (v) => v == null ? '—' : Number(v).toFixed(2)
      const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(2) + '%'

      // 判据①：平台 error 级标签（唯一硬判据）
      if (errLabels.length) {
        const worst = errLabels.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0]
        verdict.push('⛔ 先停投/整改，别调参')
        verdict.push(`   平台判：${worst.name}（${worst.dim}）${worst.rank != null ? `，低于 ${worst.rank}% 相似推广` : ''}`)
        verdict.push('   根因大概率在商品侧（详情页/价格/规格/评价），加钱治不了')
      } else {
        // 判据②：看到底该不该调（速率/超时/CTR）
        verdict.push('✅ 平台无 error 级标签')
        if (g?.ctr != null) {
          const lvl = g.ctr >= 12 ? '优' : g.ctr >= 5 ? '健康' : '偏低'
          verdict.push(`   CTR ${fmtPct(g.ctr)}（${lvl}，参考线 5% / 优秀 12%）`)
        }
        if (g?.roi != null) {
          verdict.push(`   ROI ${fmtRoi(g.roi)}（参考线：盈亏平衡 ROI = 1/(1−毛利率)）`)
        }
        // ★ 动态结论：看单品今日消耗和日限额的实际关系
        const _uToday = unit.dailyCost
        const _uMax = unit.maxCost
        const _nowH = (costs.length ? new Date(costs[costs.length - 1].date) : new Date())
        const _nowHr = _nowH.getHours() + _nowH.getMinutes() / 60
        const _sH = parseFloat(argOf('start-hour') || '8') || 8
        const _tH = parseFloat(argOf('target-hour') || '18') || 18
        const _span = Math.max(0.5, _tH - _sH)
        const _elapsed = Math.max(0, _nowHr - _sH)
        if (_uToday != null && _uMax != null) {
          const pct = _uMax > 0 ? _uToday / _uMax * 100 : 0
          const overT = _nowHr > _tH
          if (overT) {
            if (pct >= 95) verdict.push('   🔴 日限额已烧完 → 该提日限额了')
            else if (pct >= 70) verdict.push(`   🟠 已烧 ${pct.toFixed(0)}%，接近跑满 → 可以小幅提`)
            else verdict.push(`   🟡 已过 ${_tH}:00 只烧 ${pct.toFixed(0)}% → 别提限额，先查为什么烧不动`)
          } else if (_elapsed > 0) {
            const curRate = _uToday / _elapsed
            const normRate = _uMax / _span
            const r = normRate > 0 ? curRate / normRate : 0
            if (r >= 1.2) verdict.push(`   🔴 速率偏高 ${r.toFixed(2)}× → 日限额 + 净目标投产比一起提`)
            else if (r >= 1) verdict.push(`   🟢 速率正常 ${r.toFixed(2)}× → 可以提，幅度别大`)
            else verdict.push(`   🟡 速率偏慢 ${r.toFixed(2)}× → 不提，等它跑`)
          }
        }
      }

      // 数据面板
      L.push('┌─ 商品数据 ' + '─'.repeat(56))
      if (g) {
        L.push(`│ 花费 ¥${g.spend ?? '—'}｜GMV ¥${g.gmv ?? '—'}｜净GMV ¥${g.netGmv ?? '—'}`)
        L.push(`│ 订单 ${g.orderNum ?? '—'}｜点击 ${g.click ?? '—'}｜曝光 ${g.impression ?? '—'}`)
        L.push(`│ ROI ${fmtRoi(g.roi)}｜CTR ${fmtPct(g.ctr)}${g.perCost != null ? `｜每笔净成交花费 ¥${g.perCost.toFixed(2)}` : ''}`)
      } else {
        L.push('│ （商品维度无数据——可能尚未产生推广成交）')
      }
      if (shopAvg?.ctr != null || shopAvg?.roi != null) {
        L.push(`│ 全店均值：CTR ${fmtPct(shopAvg.ctr)}｜ROI ${fmtRoi(shopAvg.roi)}`)
      }
      L.push('└' + '─'.repeat(65))

      // 单元配置
      L.push('')
      L.push('┌─ 单元配置 ' + '─'.repeat(56))
      L.push(`│ adId ${unit.adId}｜状态 ${unit.status === 1 ? '推广中' : unit.status === 4 ? '手动暂停' : `状态${unit.status}`}`)
      L.push(`│ 日限额 ¥${unit.maxCost ?? '—'}${unit.suggestMaxCost != null ? `（平台建议上限 ¥${unit.suggestMaxCost}）` : ''}`)
      L.push(`│ 出价区间 ${unit.bidMin ?? '—'} ~ ${unit.bidMax ?? '—'}${unit.expectedBid != null ? `｜平台建议出价 ¥${unit.expectedBid}` : ''}${unit.bidAlertType === 21 ? '（alert 21 出价偏低）' : ''}`)
      L.push('└' + '─'.repeat(65))

      // ★ 烧钱速率（单品真实值）
      //
      //   公式（对齐运营口径）：
      //     目标时段 = startHour ~ targetHour（默认 8:00 ~ 18:00，共 10 小时）
      //     正常速率 = 日限额 / 时段小时数
      //     当前速率 = 单品今日已花 / 已过小时数（从 startHour 起算）
      //
      //   数据源：adInfos[].dailyCost.value = 单品当天已花（真实值，不是分摊）
      //          dailyCost（顶部）= 全店当天已花
      const startHourCfg = parseFloat(argOf('start-hour') || '8') || 8
      const targetHourCfg = parseFloat(argOf('target-hour') || '18') || 18
      const spanHours = Math.max(0.5, targetHourCfg - startHourCfg)   // 时段长度

      // 单品今日已花（真实）
      const unitToday = unit.dailyCost != null ? unit.dailyCost : null
      // 全店今日已花（顶部 dailyCost）
      const todayCost = (costs.length ? costs[costs.length - 1] : null)
      const shopToday = todayCost ? parseFloat(todayCost.cost) : null
      const nowTs = todayCost?.date ? new Date(todayCost.date) : new Date()
      const nowHourOfDay = nowTs.getHours() + nowTs.getMinutes() / 60

      // 已过小时数（从 startHour 起算，不能为负）
      const elapsed = Math.max(0, nowHourOfDay - startHourCfg)
      // 是否已过目标时刻
      const overdue = nowHourOfDay > targetHourCfg

      // 速率
      const unitNormalRate = unit.maxCost != null ? unit.maxCost / spanHours : null
      const unitCurRate = (unitToday != null && elapsed > 0) ? unitToday / elapsed : null
      const unitRatio = (unitCurRate != null && unitNormalRate != null && unitNormalRate > 0)
        ? unitCurRate / unitNormalRate : null

      // 全店（参考）
      const liveUnits = allUnits.filter(u => u.status === 1 && u.maxCost != null && u.maxCost < 1000000)
      const shopMaxCost = liveUnits.reduce((s2, u) => s2 + u.maxCost, 0)
      const unlimitedCnt = allUnits.filter(u => u.status === 1 && u.maxCost != null && u.maxCost >= 1000000).length
      const shopNormalRate = shopMaxCost > 0 ? shopMaxCost / spanHours : null
      const shopCurRate = (shopToday != null && elapsed > 0) ? shopToday / elapsed : null

      // 近 7 天日消耗
      const _all = Array.isArray(byApi.rangeReport) ? byApi.rangeReport : [byApi.rangeReport].filter(Boolean)
      let _rawDay = []
      for (const r of _all) {
        const l = r?.dailyReportList || []
        if (l.length > _rawDay.length) _rawDay = l
      }
      const dayList = _rawDay.map(d => {
        const v = (o) => (o && typeof o === 'object' ? o.value : (o ?? null))
        return {
          date: String(d.date ?? '').slice(0, 10),
          spend: parseFloat(v(d.marketingSpend) ?? v(d.orderMarketingSpend) ?? '0') || 0,
          orderNum: v(d.orderNum),
          gmv: v(d.gmv),
          roi: v(d.orderSpendRoiUnified),
        }
      }).filter(d => d.date).slice(-7)
      const avgSpend = dayList.length
        ? dayList.reduce((s2, d) => s2 + d.spend, 0) / dayList.length : null

      const rateTag = (r) => r >= 1.2 ? '🔴 偏高' : r >= 1 ? '🟢 正常' : '🟡 偏慢'

      // ── 速率面板 ──
      L.push('')
      L.push('┌─ 烧钱速率 ' + '─'.repeat(56))
      L.push(`│ 时段 ${startHourCfg}:00 → ${targetHourCfg}:00（${spanHours} 小时）｜已过 ${elapsed.toFixed(1)} 小时`)
      if (unitToday != null) {
        L.push(`│ 今日已花 ¥${unitToday.toFixed(2)}` + (unit.maxCost != null ? ` / 日限额 ¥${unit.maxCost}` : ''))
        if (unitCurRate != null) L.push(`│ 当前速率 ¥${unitCurRate.toFixed(2)}/小时`)
        if (unitNormalRate != null) {
          L.push(`│ 正常速率 ¥${unitNormalRate.toFixed(2)}/小时（¥${unit.maxCost} ÷ ${spanHours}h）`)
        }
        if (overdue) {
          const pct = unit.maxCost > 0 ? unitToday / unit.maxCost * 100 : 0
          const tag = pct >= 95 ? '🔴 已烧完' : pct >= 70 ? '🟠 差一点' : '🟡 没烧完'
          L.push(`│ 已过目标 ${targetHourCfg}:00 → ${tag}（已烧 ${pct.toFixed(0)}%）`)
          if (pct < 95) L.push('│   没烧完 → 别提限额，先查为什么烧不动')
          else L.push('│   已烧完 → 铁定该提日限额')
        } else if (unitRatio != null) {
          const eta = unitCurRate > 0 ? startHourCfg + unit.maxCost / unitCurRate : null
          L.push(`│ 速率比 ${unitRatio.toFixed(2)}×  ${rateTag(unitRatio)}` + (eta != null ? `｜按此速率 ${eta.toFixed(1)} 点烧完` : ''))
        }
      } else {
        L.push('│ （本单品今日暂无消耗）')
      }
      // 全店参考
      if (shopToday != null) {
        L.push('│')
        L.push(`│ 【全店参考】已花 ¥${shopToday.toFixed(2)}｜${liveUnits.length} 个单元${unlimitedCnt ? `（+${unlimitedCnt} 不限额度）` : ''}`)
        if (shopCurRate != null) L.push(`│   当前速率 ¥${shopCurRate.toFixed(2)}/小时` + (shopNormalRate != null ? `｜正常 ¥${shopNormalRate.toFixed(2)}/小时` : ''))
      }



      // ★ 速率提醒
      const alerts = []
      if (errLabels.length) {
        alerts.push('⛔ 平台有 error 级标签 → 别调参，先停投/整改商品')
      } else if (overdue && unitToday != null && unitToday < unit.maxCost * 0.9) {
        const pct = unit.maxCost > 0 ? (unitToday / unit.maxCost * 100).toFixed(0) : 0
        alerts.push(`🟡 已过目标 ${targetHourCfg}:00，只花了 ¥${unitToday.toFixed(0)} / ¥${unit.maxCost}（${pct}%）→ 日限额跑不满，别提限额，先查为什么烧不动`)
      } else {
        if (unitRatio != null && unitNormalRate > 0) {
          if (unitRatio >= 1.2) {
            alerts.push(`🔴 速率偏高（${unitRatio.toFixed(2)}×）→ 日限额 + 净目标投产比一起提`)
            if (unit.maxCost != null && unit.suggestMaxCost != null && unit.maxCost >= unit.suggestMaxCost) {
              alerts.push(`⚠️ 日限额已达平台建议上限 ¥${unit.suggestMaxCost}，再提要谨慎`)
            }
          } else if (unitRatio >= 1) {
            alerts.push(`🟢 速率正常（${unitRatio.toFixed(2)}×）→ 可以提，幅度别大`)
          } else {
            alerts.push(`🟡 速率偏慢（${unitRatio.toFixed(2)}×）→ 不提，等它跑`)
          }
        }
        if (unitToday != null && unit.maxCost != null && unitToday >= unit.maxCost * 0.98) {
          alerts.push(`🔴 日限额已烧完（¥${unitToday.toFixed(2)} / ¥${unit.maxCost}）→ 铁定该提`)
        }
        if (g?.ctr != null && g.ctr < 5) alerts.push(`🟡 CTR ${fmtPct(g.ctr)} 低于 5% 健康线 → 先换主图再放量`)
        if (dayList.length >= 3 && unitToday != null) {
          const prevAvg = dayList.slice(0, -1).reduce((s, d) => s + d.spend, 0) / Math.max(1, dayList.length - 1)
          if (prevAvg > 0 && unitToday > prevAvg * 1.5 && (g?.orderNum ?? 0) < prevAvg / 20) {
            alerts.push(`⚠️ 今日花费是近日均的 ${(unitToday / prevAvg).toFixed(1)}× 但订单很少 → 检查投产比是否抬过头`)
          }
        }
      }
      if (alerts.length) {
        L.push('')
        L.push('⚠️ 提醒：')
        for (const a of alerts) L.push(`  ${a}`)
      }

      // 平台标签
      if (errLabels.length || warnLabels.length) {
        L.push('')
        L.push('平台异常标签：')
        for (const l of errLabels) {
          const tip = (LABEL_TYPES[l.labelType]?.tip || l.name)
            .replace('{rank}', String(l.rank ?? '?')).replace('{days}', String(l.days ?? '?'))
          L.push(`  ${labelText(l.labelType)}｜${l.dim}｜${tip}`)
        }
        for (const l of warnLabels) {
          L.push(`  ${labelText(l.labelType)}｜${l.dim}${l.rank != null ? `｜rank ${l.rank}` : ''}`)
        }
      } else if (diag) {
        L.push('')
        L.push('平台异常标签：无')
      }

      // 调参命令
      if (!errLabels.length) {
        L.push('')
        L.push('调参命令（速率偏高时才用）：')
        L.push(`  提日限额：--mode maxcost --ad-id ${unit.adId} --max-cost <新限额> --confirm true`)
        L.push(`  提投产比：--mode roi --ad-id ${unit.adId} --roi <新投产比> --confirm true`)
      } else {
        L.push('')
        L.push('处置命令：')
        L.push(`  暂停：--mode pause --ad-id ${unit.adId} --confirm true`)
      }

      // ── 全店速率表（对照本单品排第几）──
      try {
        const rd2 = buildRateRows()
        const rr2 = renderRateTable(rd2, { compact: true, limit: 15 })
        L.push('')
        L.push('─'.repeat(65))
        L.push('📊 ' + rr2.text.split('\n')[0])
        const myIdx = rd2.rows.findIndex(r => String(r.adId) === String(unit.adId))
        const activeRows = rd2.rows.filter(r => (r.today ?? 0) > 0)
        if (myIdx >= 0) {
          const me = rd2.rows[myIdx]
          const myRank = activeRows.findIndex(r => String(r.adId) === String(unit.adId))
          L.push(`   本单品排名 ${myRank >= 0 ? myRank + 1 : '—'}/${activeRows.length}（有消耗的）｜倍数 ${me.ratio != null ? me.ratio.toFixed(2) + '×' : '—'}`)
        }
        L.push('')
        for (const ln of rr2.text.split('\n').slice(2)) L.push(ln)
      } catch (e) { /* 忽略 */ }

      out.item = {
        adId: unit.adId, goodsId: gid, goodsName: unit.goodsName || g?.goodsId,
        unit: { maxCost: unit.maxCost, expectedBid: unit.expectedBid, bidAlertType: unit.bidAlertType, bidMin: unit.bidMin, bidMax: unit.bidMax, suggestMaxCost: unit.suggestMaxCost, status: unit.status },
        promo: g,
        shopAvg,
        errorLabels: errLabels,
        warningLabels: warnLabels,
        verdict: errLabels.length ? 'fix' : 'ok'
      }
      out.text = `单品推广诊断：${unit.adName || unit.goodsName || gid}\n\n`
        + verdict.join('\n') + '\n\n'
        + L.join('\n')
    }
  }
  // ── units 模式：推广单元列表 ──
  const units = (byApi.unitList?.adInfos || []).map(u => {
    // 拆 {value, unit} → number
    const nv = (v) => (v && typeof v === 'object' && 'value' in v) ? parseFloat(v.value) : (typeof v === 'number' ? v : null)
    return {
      adId: u.adId ?? u.id,
      adName: u.adName ?? u.name ?? '',
      goodsId: u.goodsId,
      goodsName: u.goodsName ?? '',
      status: u.adStatus ?? u.status,
      impression: nv(u.impression), click: nv(u.click),
      spend: nv(u.orderSpend ?? u.spend), roi: nv(u.orderSpendRoiUnified ?? u.roi),
      maxCost: nv(u.maxCost),
      // ★ 出价相关（balance 用）
      expectedBid: nv(u.bidAlertInfo?.expectedBid),
      bidAlertType: u.bidAlertInfo?.alertType ?? null,
      bidMin: nv(u.suggestLimitInfo?.minValue),
      bidMax: nv(u.suggestLimitInfo?.maxValue),
      suggestMaxCost: nv(u.maxCostSuggestVO?.suggestMaxCost),
    }
  })
  out.units = units
  out.totalAdNum = byApi.unitList?.totalAdNum ?? units.length
  if (mode === 'units') {
    out.text = units.length
      ? `推广单元 ${units.length}/${out.totalAdNum} 个：\n` + units.slice(0, 30).map((u, i) =>
          `  ${i + 1}. [${u.adId}] ${String(u.adName || u.goodsName).slice(0, 24)} | 状态=${u.status} | 花费=${u.spend ?? '—'} ROI=${u.roi ?? '—'} 商品=${u.goodsId ?? '—'}`).join('\n')
      : `推广单元：0 个（totalAdNum=${out.totalAdNum}）。店铺当前没有推广中的商品——这也是后台「开启推广」按钮置灰的原因。`
  }

  // ── diagnose / balance 模式：推广诊断 + 平衡算法 ──
  //   字段来源：smartTool/diagnosis/queryStableCostAdDiagnosis（见知识库「拼多多推广诊断逆向」）
  //   moduleType 1=出价竞争力 2=投放状态 3=竞争力下滑 4=创意素材 5=排名过低
  const MODULE_NAMES = { 1: '出价竞争力', 2: '投放状态', 3: '竞争力下滑', 4: '创意素材', 5: '排名过低' }
  const numOf = (o) => (o && typeof o === 'object' ? Number(o.value) : (o == null ? null : Number(o)))


  /** 解析单个 adId 的诊断结果 */
  const parseDiagnosis = (adId, res) => {
    const list = res?.competitionDiagnosisList || []
    const modules = list.map(m => {
      const mt = m.moduleType
      const out = {
        moduleType: mt,
        moduleName: MODULE_NAMES[mt] || `未知(${mt})`,
        rank: m.rank ?? null,
        competitionLevel: m.competitionLevel ?? null,
        updatedTime: m.updatedTime || null,
        // moduleType=1：出价建议 + 效果预估
        suggestBid: mt === 1 ? numOf(m.suggestInfo ?? m.suggestValue) : null,
        alertType: m.alertType ?? null,
        effectPredict: null,
        // moduleType=3/5：竞争力异常
        // ★ 2026-10-27 修：labelType 实际在**第三层 VO 内部**，顶层 exceptionLabelList 实测全空。
        //   绑定关系（8 单元 35 模块实证，零例外）：
        //     mt=1 → bidCompetitiveness.exceptionLabelList[]
        //     mt=3 → exposureCompetitiveness.exceptionLabelList[]
        //     mt=5 → conversionCompetitive.exceptionLabelList[]
        labelTypes: (m.exceptionLabelList || []).map(e => e.labelType).filter(x => x != null),
        declines: m.competitivenessDeclinesVO ? {
          rank: m.competitivenessDeclinesVO.rank,
          referenceDays: m.competitivenessDeclinesVO.referenceDays,
        } : null,
        tooLow: m.competitivenessTooLowVO || null,
        // 竞争力三件套
        bidCompetitiveness: m.bidCompetitiveness || null,
        exposureCompetitiveness: m.exposureCompetitiveness || null,
        conversionCompetitive: m.conversionCompetitive || null,
        // 损失
        trafficLoss: numOf(m.trafficLoss),
        orderLoss: numOf(m.orderLoss),
        depositEstimatedGmv: numOf(m.depositEstimatedGmv),
        creativeLabelType: m.creativeLabelType ?? null,
        suggestionType: m.suggestionType ?? null,
        expectedBid: numOf(m.expectedBid),
      }
      if (mt === 1) {
        const e = m.effectIntervalData || {}
        out.effectPredict = {
          orderMinPct: numOf(e.orderCntIntervalMin),
          orderMaxPct: numOf(e.orderCntIntervalMax),
          impressionMinPct: numOf(e.imprCntIntervalMin ?? e.impressionCntIntervalMin),
          impressionMaxPct: numOf(e.imprCntIntervalMax ?? e.impressionCntIntervalMax),
          gmvDiffMaxPct: numOf(e.gmvDiffIntervalMax),
        }
      }

      // ★ 2026-10-27 补：从三个竞争力 VO 内部收集 labelType（顶层实测全空）
      //   并附上每个 label 的 rank / referenceDays，便于渲染官方文案
      const voLabels = []
      for (const [voName, vo] of [
        ['bid', m.bidCompetitiveness],
        ['exposure', m.exposureCompetitiveness],
        ['conversion', m.conversionCompetitive],
      ]) {
        for (const e of (vo?.exceptionLabelList || [])) {
          if (e.labelType == null) continue
          const def = LABEL_TYPES[e.labelType]
          voLabels.push({
            source: voName,                       // bid / exposure / conversion
            labelType: e.labelType,
            name: def?.name || `未知(${e.labelType})`,
            level: def?.level || 'warning',
            rank: e.competitivenessTooLowVO?.rank ?? vo?.rank ?? null,
            referenceDays: e.competitivenessTooLowVO?.referenceDays ?? null,
          })
        }
      }
      out.voLabels = voLabels
      // labelTypes 合并顶层 + VO 内部（去重）
      out.labelTypes = [...new Set([...out.labelTypes, ...voLabels.map(x => x.labelType)])]
      // error 级 label（最需要关注的）
      out.errorLabels = voLabels.filter(x => x.level === 'error')

      return out
    })
    return { adId, modules, updatedAt: modules[0]?.updatedTime || null }
  }

  /**
   * 推广平衡算法：对每个推广单元打分，给出「该加 / 该减 / 该保」。
   *
   * 评分维度（各 0~100）：
   *   出价竞争力 bidScore     30%  → competitionLevel（1~10 → 0~100）
   *   排名 rankScore          25%  → rank（1~100 反向）
   *   下滑风险 declineScore   20%  → labelType error 级扣 30 / warning 扣 12
   *   损失损失 lossScore      15%  → trafficLoss / orderLoss
   *   素材素材 creativeScore  10%  → creativeLabelType
   *
   * ★ labelType 官方枚举见上方 LABEL_TYPES（2026-10-27 前端 bundle 实证）。
   *   error 级 = 1 出价过低 / 4 曝光过低 / 7 转化过低
   *   → 有 error 级标签的单元，即使出价和素材都好，也不该判"healthy"
   *     （实测 9451903287：出价 9/10 + 素材 8/10，但转化 rank 100 error 级）
   *
   * 动作判定（阈值可在调参时改）：
   *   总分 ≥ 70 且无 error 标签 → ✅ 保持（healthy）
   *   50 ≤ 总分 < 70            → ⚠️ 微调（tune）—— 出价低就加 5~10%
   *   总分 < 50 且有建议价      → 🔼 加价（raise）—— 按 suggestBid 提
   *   总分 < 50 且有下滑        → 🔽 降价/止损（cut）
   *   无投放（modules 空）      → ➕ 可开新推广（open）
   *   有 error 级标签           → ⛔ 停投/整改（fix）—— 转化/曝光过低，加钱治不了
   */
  const BALANCE = {
    /**
     * 单模块打分。
     *
     * ★ 关键修正（2026-10-23 实跑发现）：不能把「所有模块」一起平均。
     *   moduleType 3/5（竞争力下滑/排名过低）往往**没有** competitionLevel，
     *   却带 labelType，直接按 0 分算会把「竞争等级 10/10、排名 9/100」的
     *   优质单元拉成 64 分误判为「微调」。
     *   所以：
     *     - 出价竞争力（moduleType=1）单独算「主分」，权重最高
     *     - 下滑/异常只作为**扣分项**（有则减，无则不减）
     *     - 没有数据的模块不参与平均
     */
    scoreModule(m) {
      const parts = {}
      // ① 出价竞争力：competitionLevel 1~10
      if (m.competitionLevel != null) parts.bid = Math.min(100, Math.max(0, (m.competitionLevel - 1) / 9 * 100))
      // ② 排名：rank 1~100（1 最好）
      if (m.rank != null) parts.rank = Math.min(100, Math.max(0, (100 - m.rank) / 99 * 100))
      // ③ 损失（有数值才算）
      if (m.trafficLoss != null || m.orderLoss != null) {
        const loss = Math.max(Math.abs(m.trafficLoss || 0), Math.abs(m.orderLoss || 0))
        parts.loss = loss === 0 ? 100 : (loss < 10 ? 70 : loss < 30 ? 40 : 10)
      }
      // ④ 素材标签
      if (m.moduleType === 4) parts.creative = (m.creativeLabelType === 0 || m.creativeLabelType == null) ? 100 : 60
      // ★ 不加 decline 作为分数，改成独立扣分项
      const base = { bid: 45, rank: 35, loss: 15, creative: 5 }
      let sum = 0, wt = 0
      for (const [k, w] of Object.entries(base)) {
        if (parts[k] == null) continue
        sum += parts[k] * w; wt += w
      }
      let score = wt ? sum / wt : null
      // ★ 扣分项：按平台 level 分级（2026-10-27 修）
      //   原来只筛 4/7 且各扣 20/15 太轻，会把「转化垫底」的单元掩盖成 88 分"健康"
      //   （实测 9451903287：出价 9/10 + 素材 8/10，但转化 rank 100 error 级，却得 88 分）
      //   现在：error 级（1 出价过低 / 4 曝光过低 / 7 转化过低）扣 30，warning 扣 12
      const badLabels = (m.labelTypes || []).filter(t => {
        const def = LABEL_TYPES[t]
        return def ? def.level === 'error' : false
      })
      const warnLabels = (m.labelTypes || []).filter(t => {
        const def = LABEL_TYPES[t]
        return def ? def.level === 'warning' : false
      })
      if (score != null) {
        score -= badLabels.length * 30
        score -= warnLabels.length * 12
        score = Math.max(0, Math.round(score))
      }
      return { score, parts, penalties: badLabels, warnings: warnLabels }
    },

    /** 生成动作建议 */
    decide(mods) {
      if (!mods.length) return { action: 'open', label: '➕ 可开新推广', reason: '无投放数据', score: null }
      const scored = mods.map(m => ({ m, ...BALANCE.scoreModule(m) })).filter(x => x.score != null)
      if (!scored.length) return { action: 'unknown', label: '❔ 数据不足', reason: '模块均无评分依据', score: null }
      // ★ 主分优先取 moduleType=1（出价竞争力，信息最全）
      const primary = scored.find(x => x.m.moduleType === 1) || scored[0]
      const score = primary.score
      const allPenalties = [...new Set(scored.flatMap(x => x.penalties))]
      const allWarnings = [...new Set(scored.flatMap(x => x.warnings || []))]
      const m1 = mods.find(m => m.moduleType === 1)
      const suggestBid = m1?.suggestBid ?? null
      const alert = m1?.alertType ?? null
      const eff = m1?.effectPredict ?? null

      // ★ 2026-10-27：收集平台 error 级 label 的官方文案（含 rank / 统计天数）
      //   labelType 1 出价过低 / 4 曝光过低 / 7 转化过低
      const errorLabels = []
      for (const m of mods) {
        for (const l of (m.errorLabels || [])) {
          errorLabels.push({ ...l, moduleType: m.moduleType, moduleName: m.moduleName })
        }
      }
      const renderTip = (l) => {
        let tip = (LABEL_TYPES[l.labelType]?.tip || l.name)
        if (l.rank != null) tip = tip.replace('{rank}', String(l.rank))
        if (l.referenceDays != null) tip = tip.replace('{days}', String(l.referenceDays))
        return tip.replace(/\{\w+\}/g, '?')
      }
      const why = []
      if (primary.m.competitionLevel != null) why.push(`竞争等级 ${primary.m.competitionLevel}/10`)
      if (primary.m.rank != null) why.push(`排名 ${primary.m.rank}/100`)
      for (const l of errorLabels) why.push(`${labelText(l.labelType)} rank ${l.rank ?? '?'}`)
      for (const t of allWarnings) why.push(`${labelText(t)}`)
      if (alert === 21) why.push('出价偏低(alert 21)')
      if (eff?.orderMaxPct) why.push(`提价可增订单 0~${eff.orderMaxPct}%`)
      const reason = why.join('；')

      // ★ 最高优先：平台 error 级标签 → 停投/整改
      //   转化过低(7)/曝光过低(4)/出价过低(1) 是商品或出价的硬伤，
      //   加预算/提价只会放大浪费，必须先整改商品或暂停。
      if (errorLabels.length) {
        const worst = errorLabels.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0]
        return {
          action: 'fix', label: `⛔ 停投/整改（${worst.name}）`,
          reason: `${reason}\n     平台原文：${renderTip(worst)}`,
          score, suggestBid, errorLabels,
        }
      }
      if (score >= 70) return { action: 'healthy', label: '✅ 保持', reason, score, suggestBid }
      if (score >= 50) return { action: 'tune', label: `⚠️ 微调${suggestBid ? `（建议出价 ¥${suggestBid}）` : ''}`, reason, score, suggestBid }
      if (suggestBid && alert === 21) return { action: 'raise', label: `🔼 加价到 ¥${suggestBid}`, reason, score, suggestBid }
      if (allPenalties.length || allWarnings.length) return { action: 'cut', label: '🔽 降价/止损', reason, score, suggestBid }
      return { action: 'raise', label: `🔼 提价${suggestBid ? `到 ¥${suggestBid}` : ''}`, reason, score, suggestBid }
    },
  }

  if (mode === 'diagnose' || mode === 'balance') {
    const diagMap = byApi.adDiagnosisByAd || {}
    const adIds = Object.keys(diagMap)
    const diagItems = adIds.map(id => parseDiagnosis(id, diagMap[id]))

    // 把诊断和推广单元信息合并
    const unitMap = {}
    for (const u of units) unitMap[String(u.adId)] = u
    const merged = diagItems.map(d => {
      const u = unitMap[String(d.adId)] || {}
      const dec = BALANCE.decide(d.modules)
      // ★ suggestBid 兜底：诊断接口没给时，用 v3/list 的 expectedBid
      let suggestBid = dec.suggestBid
      if (!suggestBid && u.expectedBid) {
        suggestBid = u.expectedBid
        dec.suggestBid = suggestBid
        if (dec.action === 'tune') dec.label = `⚠️ 微调（建议出价 ¥${suggestBid}）`
        if (dec.action === 'healthy') dec.label = `✅ 保持（可提到 ¥${suggestBid}）`
      }
      return {
        adId: d.adId,
        adName: u.adName || u.goodsName || '',
        goodsId: u.goodsId ?? null,
        spend: u.spend ?? null,
        roi: u.roi ?? null,
        maxCost: u.maxCost ?? null,
        bidMin: u.bidMin ?? null,
        bidMax: u.bidMax ?? null,
        suggestMaxCost: u.suggestMaxCost ?? null,
        ...dec,
        modules: d.modules,
        updatedAt: d.updatedAt,
      }
    }).sort((a, b) => (a.score ?? 999) - (b.score ?? 999))   // 分数低的排前面（优先处理）

    out.diagnosis = {
      count: merged.length,
      items: merged,
      // 诊断接口原始字段也给（方便二次分析）
      rawSample: adIds.length ? diagMap[adIds[0]] : null,
    }

    if (mode === 'diagnose') {
      // ★ 一屏结论（2026-10-28）：先说判断，再给细节
      const _fix = merged.filter(x => x.action === 'fix')
      const _head = [`推广诊断（${merged.length} 个推广单元）：`]
      if (merged.length === 1) {
        const x = merged[0]
        const l = x.errorLabels?.[0]
        _head.push(`┌─ 一屏结论 ${'─'.repeat(52)}`)
        _head.push(`│ ${x.label}${x.score != null ? `（总分 ${x.score}）` : ''}`)
        if (l) {
          const tip = (LABEL_TYPES[l.labelType]?.tip || l.name)
            .replace('{rank}', String(l.rank ?? '?')).replace('{days}', String(l.referenceDays ?? '?'))
          _head.push(`│ 平台原文：${tip}`)
          _head.push(`│ 处置：${/转化/.test(l.name) ? '根因在商品侧（详情页/价格/规格），提价治不了，先暂停' : '先暂停或整改，别加钱'}`)
        } else if (x.action === 'healthy') {
          _head.push('│ 处置：保持现状；日限额天天跑满可提 20~30%')
        } else if (x.action === 'tune' || x.action === 'raise') {
          _head.push(`│ 处置：出价调到 ¥${x.suggestBid ?? '?'}${x.action === 'tune' ? '（小步 5~10%，别一次到位）' : ''}`)
        }
        _head.push(`└${'─'.repeat(61)}`)
      } else if (_fix.length) {
        _head.push(`⛔ ${_fix.length}/${merged.length} 个单元被平台标 error 级，建议先停投整改（明细见下）`)
      } else {
        _head.push(`✅ 无平台 error 级异常（明细见下）`)
      }
      if (!merged.length) {
        out.text = '推广诊断：未获取到数据。\n可能原因：\n① 当前店铺没有在投的推广单元（adInfos 为空）\n② 诊断抽屉未成功打开（URL 需带 drawerTab=promoteDiagnosis）\n③ 推广域登录态失效\n\n排查：先用 --mode units 看有没有推广单元，有 ID 后可用 --ad-id <ID> 单独诊断。'
      } else {
        // 单单元：一屏结论已说清，明细只补「平台没说的」维度
        let detail
        if (merged.length === 1) {
          const x = merged[0]
          const ls = [`  维度明细（补充一屏结论没覆盖的）：`]
          for (const m of x.modules) {
            if (m.moduleType === 3 || m.moduleType === 5) continue   // 异常已在上面说过
            ls.push(`     ${m.moduleName}：rank ${m.rank ?? '?'}/100 · 竞争等级 ${m.competitionLevel ?? '?'}/10`
              + (m.suggestBid ? ` · 建议出价 ¥${m.suggestBid}` : ''))
          }
          const cmd = x.action === 'fix' ? `--mode pause --ad-id ${x.adId} --confirm true`
            : (x.action === 'tune' || x.action === 'raise') && x.suggestBid
              ? `--mode roi --ad-id ${x.adId} --bid ${x.suggestBid} --bid-type 2 --confirm true`
            : x.action === 'healthy' ? `--mode maxcost --ad-id ${x.adId} --max-cost <新限额> --confirm true` : null
          if (cmd) ls.push(`  执行命令：${cmd}`)
          detail = ls.join('\n')
        } else {
          // 多单元：逐条列，异常维度压缩成一行
          detail = merged.map((x, i) => {
            const lines = [`  ${i + 1}. [${x.adId}] ${String(x.adName).slice(0, 24)} | ${x.label}${x.score != null ? ` 总分${x.score}` : ''}`]
            if (x.reason) lines.push(`     依据：${x.reason}`)
            const m1 = x.modules.find(m => m.moduleType === 1)
            if (m1) {
              lines.push(`     出价竞争力：竞争等级 ${m1.competitionLevel}/10 · 排名 ${m1.rank}/100${m1.suggestBid ? ` · 建议出价 ¥${m1.suggestBid}` : ''}`)
              if (m1.effectPredict && m1.effectPredict.orderMaxPct) {
                lines.push(`     效果预估：订单 +0~${m1.effectPredict.orderMaxPct}% · 曝光 +0~${m1.effectPredict.impressionMaxPct}%`)
              }
            }
            if (x.errorLabels?.length) {
              for (const l of x.errorLabels) {
                const tip = (LABEL_TYPES[l.labelType]?.tip || l.name)
                  .replace('{rank}', String(l.rank ?? '?')).replace('{days}', String(l.referenceDays ?? '?'))
                lines.push(`     ${labelText(l.labelType)}：${tip}`)
              }
            }
            const _warn = []
            for (const m of x.modules) {
              for (const l of (m.voLabels || [])) {
                if (l.level === 'warning') _warn.push(`${l.name}(${l.labelType})`)
              }
            }
            if (_warn.length) lines.push(`     🟡warning：${[...new Set(_warn)].join('、')}`)
            return lines.join('\n')
          }).join('\n')
        }
        out.text = _head.join('\n') + '\n\n' + detail
      }
    }

    if (mode === 'balance') {
      // 按动作分组
      const byAction = {}
      for (const x of merged) {
        (byAction[x.action] = byAction[x.action] || []).push(x)
      }
      const ACTION_ORDER = ['fix', 'raise', 'cut', 'tune', 'healthy', 'open', 'unknown']
      const ACTION_LABEL = {
        fix: '⛔ 停投/整改（平台 error 级异常）',
        raise: '🔼 建议加价',
        cut: '🔽 建议降价/止损',
        tune: '⚠️ 建议微调',
        healthy: '✅ 保持现状',
        open: '➕ 可开新推广',
        unknown: '❔ 数据不足',
      }
      const lines = [`推广平衡分析（${merged.length} 个推广单元）：`, '']
      let totalSpend = 0
      for (const x of merged) if (x.spend) totalSpend += Number(x.spend)
      if (totalSpend) lines.push(`总花费：¥${totalSpend.toFixed(2)}`)
      lines.push('')

      // ══════════════════════════════════════════════════════════════════
      // ★ 2026-10-28 新增：「一屏结论」——先给人话判断和动作，细节沉到最后
      //   原则：3 行内说完「健不健康、最该干什么、为什么」
      // ══════════════════════════════════════════════════════════════════
      const _cnt = (a) => (byAction[a] || []).length
      const _fixCnt = _cnt('fix'), _cutCnt = _cnt('cut'), _raiseCnt = _cnt('raise')
      const _healthyCnt = _cnt('healthy'), _tuneCnt = _cnt('tune')
      const _fixSpend = (byAction.fix || []).reduce((s, x) => s + (Number(x.spend) || 0), 0)
      const _cutSpend = (byAction.cut || []).reduce((s, x) => s + (Number(x.spend) || 0), 0)
      const _errUnits = (byAction.fix || []).length

      // 健康度：有 error 级 → 差；有 cut → 亚健康；全是 healthy/tune → 好
      let health, healthIcon
      if (_fixCnt > 0) { health = '差'; healthIcon = '🔴' }
      else if (_cutCnt > 0) { health = '亚健康'; healthIcon = '🟡' }
      else if (_healthyCnt + _tuneCnt === merged.length && merged.length) { health = '健康'; healthIcon = '🟢' }
      else { health = '数据不足'; healthIcon = '⚪' }

      lines.push('┌─ 一屏结论 ' + '─'.repeat(52))
      lines.push(`│ ${healthIcon} 健康度：${health}`
        + `（${merged.length} 个单元：⛔停投 ${_fixCnt} · 🔽降 ${_cutCnt} · 🔼加 ${_raiseCnt} · ⚠️微调 ${_tuneCnt} · ✅保持 ${_healthyCnt}）`)
      if (_fixCnt > 0) {
        lines.push(`│ ⛔ 最该做：停投 ${_fixCnt} 个被平台标 error 级的单元`
          + (_fixSpend > 0 ? `（近 7 天白花 ¥${_fixSpend.toFixed(2)}）` : ''))
        const worst = (byAction.fix || []).sort((a, b) => (b.errorLabels?.[0]?.rank ?? 0) - (a.errorLabels?.[0]?.rank ?? 0))[0]
        if (worst) {
          const l = worst.errorLabels?.[0]
          lines.push(`│    头号问题：[${worst.adId}] ${String(worst.adName || worst.goodsId).slice(0, 20)}`
            + ` → ${l?.name ?? '异常'}（低于 ${l?.rank ?? '?'}% 相似推广）`)
        }
        lines.push('│    原因：转化/曝光是平台 error 级，加钱治不了，根因在商品侧')
      } else if (_cutCnt > 0) {
        lines.push(`│ 🔽 最该做：降或停 ${_cutCnt} 个低效单元（日耗 ¥${_cutSpend.toFixed(2)}）`)
      } else if (_raiseCnt > 0) {
        lines.push(`│ 🔼 最该做：给 ${_raiseCnt} 个优质单元加价放量`)
      } else if (_tuneCnt > 0) {
        lines.push(`│ ⚠️ 最该做：${_tuneCnt} 个单元小步微调出价（5~10%）`)
      } else if (merged.length) {
        lines.push('│ ✅ 结构健康，保持现状，天天跑满的单元可提限额 20~30%')
      } else {
        lines.push('│ ❔ 没拿到推广单元数据，先跑 --mode units 确认有没有在投')
      }
      if (_errUnits > 0 && _raiseCnt === 0) {
        lines.push('│ ⚠️ 全店没有可加价的优质单元 —— 先修商品，别急着投')
      }
      lines.push('└' + '─'.repeat(61))
      lines.push('')

      // ★ 每个单元的「当前出价」从 suggestLimitInfo / bidAlertInfo 附近拿
      //   诊断接口给的是「建议出价」，当前出价从 v3/list 的 targetRoi / optimizationBid 推
      //   简化：用 suggestBid 与 alert 21（出价偏低）判断差额
      for (const act of ACTION_ORDER) {
        const group = byAction[act]
        if (!group?.length) continue
        lines.push(`${ACTION_LABEL[act]}（${group.length} 个）`)
        for (const x of group) {
          lines.push(`  · [${x.adId}] ${String(x.adName || x.goodsId).slice(0, 26)}${x.score != null ? ` | 总分${x.score}` : ''}`)
          if (x.reason) lines.push(`     依据：${x.reason}`)
          const m1 = x.modules.find(m => m.moduleType === 1)
          if (m1) {
            lines.push(`     竞争等级 ${m1.competitionLevel ?? '—'}/10 · 排名 ${m1.rank ?? '—'}/100${m1.suggestBid ? ` · 建议出价 ¥${m1.suggestBid}` : ''}`)
            if (m1.effectPredict && (m1.effectPredict.orderMaxPct || m1.effectPredict.impressionMaxPct)) {
              lines.push(`     提价效果预估：订单 +0~${m1.effectPredict.orderMaxPct ?? '?'}% · 曝光 +0~${m1.effectPredict.impressionMaxPct ?? '?'}%`)
            }
            if (x.errorLabels?.length) {
              for (const l of x.errorLabels) {
                const tip = (LABEL_TYPES[l.labelType]?.tip || l.name)
                  .replace('{rank}', String(l.rank ?? '?')).replace('{days}', String(l.referenceDays ?? '?'))
                lines.push(`     ${labelText(l.labelType)}：${tip}`)
              }
            }
          }
          if (x.spend != null || x.roi != null) {
            lines.push(`     当前：花费 ¥${x.spend ?? '—'} · ROI ${x.roi ?? '—'}${x.maxCost != null ? ` · 日限额 ¥${x.maxCost}` : ''}`)
          }
          // ★ 可执行动作 + 命令
          if (act === 'raise' && x.suggestBid) {
            lines.push(`     ▶ 动作：出价提到 ¥${x.suggestBid}`)
            lines.push(`     ▶ 命令：--mode roi --ad-id ${x.adId} --bid ${x.suggestBid} --bid-type 2 --confirm true`)
          } else if (act === 'tune' && x.suggestBid) {
            lines.push(`     ▶ 动作：小步上调 5~10%，目标 ¥${x.suggestBid}（别一次到位）`)
            lines.push(`     ▶ 命令：--mode roi --ad-id ${x.adId} --bid ${x.suggestBid} --bid-type 2 --confirm true`)
          } else if (act === 'cut') {
            lines.push(`     ▶ 动作：降 10~20% 或暂停观察 3 天`)
            lines.push(`     ▶ 暂停：--mode pause --ad-id ${x.adId} --confirm true`)
          } else if (act === 'healthy') {
            lines.push(`     ▶ 动作：不动。若日限额天天跑满，可提限额 20~30%`)
            lines.push(`     ▶ 命令：--mode maxcost --ad-id ${x.adId} --max-cost <新限额> --confirm true`)
          } else if (act === 'fix') {
            // ★ 2026-10-27：平台 error 级异常 → 先停投，别加钱
            const kinds = (x.errorLabels || []).map(l => l.name)
            lines.push(`     ▶ 平台判定：${kinds.join(' + ')}（error 级）`)
            lines.push(`     ▶ 处置：加预算/提价只会放大浪费，先暂停或整改商品`)
            lines.push(`     ▶ 暂停：--mode pause --ad-id ${x.adId} --confirm true`)
            if (kinds.some(k => /转化/.test(k))) {
              lines.push(`     ▶ 根因大概率在商品侧（详情页/价格/规格/评价），不在出价`)
              lines.push(`       建议同时看 pdd-shop --mode goods 的转化率 vs 类目均值`)
            }
            if (kinds.some(k => /出价/.test(k)) && !kinds.some(k => /转化/.test(k))) {
              lines.push(`     ▶ 纯出价问题才考虑提价：--mode roi --ad-id ${x.adId} --bid ${x.suggestBid ?? '<建议价>'} --bid-type 2 --confirm true`)
            }
          }
        }
        lines.push('')
      }

      // 预算分配建议（带金额）
      const raise = byAction.raise || [], cut = byAction.cut || [], tune = byAction.tune || []
      const fix = byAction.fix || []
      const cutSpend = cut.reduce((s, x) => s + (Number(x.spend) || 0), 0)
      // ★ fix（平台 error 级）优先级最高：先止血，再谈调结构
      if (fix.length) {
        const fixSpend = fix.reduce((s, x) => s + (Number(x.spend) || 0), 0)
        lines.push(`⛔ ${fix.length} 个单元被平台标为 error 级（出价过低/曝光过低/转化过低）`)
        if (fixSpend > 0) lines.push(`   近 7 天这些单元花了 ¥${fixSpend.toFixed(2)}，先停再查商品`)
        lines.push(`   处置：加预算/提价只会放大浪费；转化过低(7)的根因在商品侧，不在出价`)
        if (raise.length) lines.push(`   止血后再考虑给 ${raise.length} 个优质单元加价`)
      } else if (raise.length && cut.length) {
        lines.push(`💡 预算重分配：`)
        lines.push(`   从 ${cut.length} 个待降单元腾出 ¥${cutSpend.toFixed(2)}/日`)
        lines.push(`   加到 ${raise.length} 个待加单元（ROI 已证明更好）`)
      } else if (raise.length) {
        lines.push(`💡 建议给 ${raise.length} 个推广单元加价/加预算`)
      } else if (cut.length) {
        lines.push(`💡 建议对 ${cut.length} 个低效单元降价或暂停，避免 ¥${cutSpend.toFixed(2)}/日 无效消耗`)
      } else if (tune.length) {
        lines.push(`💡 ${tune.length} 个单元建议微调，按建议出价小步上调`)
      } else if (merged.length) {
        lines.push('💡 当前推广结构健康，无需大调整')
      }
      // 执行顺序提示
      if (raise.length || cut.length || fix.length) {
        lines.push('')
        lines.push('📋 执行顺序（重要）：')
        if (fix.length) lines.push(`   1. 先停/整改 ${fix.length} 个平台 error 级单元（止血优先）`)
        if (cut.length) lines.push(`   ${fix.length ? 2 : 1}. 再降/停 ${cut.length} 个低效单元`)
        if (raise.length) lines.push(`   ${(fix.length ? 1 : 0) + (cut.length ? 1 : 0) + 1}. 观察 1~2 天，确认 ROI 没掉`)
        if (raise.length) lines.push(`   ${(fix.length ? 1 : 0) + (cut.length ? 1 : 0) + 2}. 最后加价 ${raise.length} 个优质单元（放量）`)
        lines.push('   ⚠️ 一次只改一类，间隔 ≥1 天，否则分不清是哪个动作起的效果')
      }

      // ★ 2026-10-27 新增：平台建议汇总（platform advice）
      //   与上面的「技能建议」分开列，避免混淆两种口径：
      //     平台建议 = 拼多多自己的诊断结论（labelType + rank），只反映竞价维度
      //     技能建议 = 综合平台诊断 + sycm 商品转化率 + ROI 后的动作
      //   ★ 关键差异：平台看到「排名低」就喊提价；技能看到「转化过低(7)」就喊停投
      const platItems = []
      for (const x of merged) {
        const labels = []
        for (const m of x.modules) {
          for (const l of (m.voLabels || [])) {
            labels.push({
              labelType: l.labelType, name: l.name, level: l.level,
              rank: l.rank, days: l.referenceDays, moduleName: m.moduleName,
            })
          }
        }
        if (labels.length) platItems.push({ adId: x.adId, adName: x.adName, goodsId: x.goodsId, labels })
      }
      out.platformAdvice = {
        total: merged.length,
        flagged: platItems.length,
        items: platItems,
      }
      if (platItems.length) {
        lines.push('')
        lines.push('📢 平台异常标签汇总（拼多多官方，仅竞价维度）')
        const errCnt = platItems.reduce((s, p) => s + p.labels.filter(l => l.level === 'error').length, 0)
        const warnCnt = platItems.reduce((s, p) => s + p.labels.filter(l => l.level === 'warning').length, 0)
        lines.push(`   ${platItems.length}/${merged.length} 个单元有标签：🔴error ${errCnt} 个 · 🟡warning ${warnCnt} 个`)
        // 按 labelType 聚类，一行一个类型，不逐单元刷屏
        const byType = {}
        for (const p of platItems) {
          for (const l of p.labels) {
            const k = l.labelType
            if (!byType[k]) byType[k] = { level: l.level, name: l.name, units: [] }
            byType[k].units.push(p)
          }
        }
        for (const t of Object.keys(byType).map(Number).sort((a, b) => a - b)) {
          const g = byType[t]
          const icon = g.level === 'error' ? '🔴' : '🟡'
          const ids = g.units.map(u => u.adId).join(', ')
          lines.push(`   ${icon}${g.name}(${t}) × ${g.units.length} 个：${ids}`)
        }
        lines.push('   ⚠️ 平台只看竞价，看不到详情页承接：转化过低(7)的根因在商品侧，提价治不了')
      }
      out.balance = {
        totalSpend: totalSpend || null,
        byAction: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, v.map(x => ({ adId: x.adId, name: x.adName, score: x.score, suggestBid: x.suggestBid }))])),
      }
      out.text = lines.join('\n')
    }
  }

  // ── 写操作（L2）：pause / resume / delete / create / maxcost / roi ──
  // 签名 pair 从页面 hook 拿（导航前已注入）；没有就主动触发一个页面请求
  let sigPair = await page.evaluate(() => window.__sigPair || null).catch(() => null)
  if (!sigPair) {
    await page.evaluate(() => new Promise((resolve) => {
      const x = new XMLHttpRequest()
      x.open('POST', '/mms-gateway/venus/api/goods/promotion/listAdGroupInfo')
      x.setRequestHeader('Content-Type', 'application/json')
      x.onload = () => resolve(); x.onerror = () => resolve()
      x.send(JSON.stringify({ withAdCount: true }))
    })).catch(() => {})
    await new Promise(r => setTimeout(r, 1500))
    sigPair = await page.evaluate(() => window.__sigPair || null).catch(() => null)
  }
  // ★ --all：自动取全部推广单元 ID（从 hook 到的 unitList）
  if (process.argv.includes('--all')) {
    const all = (byApi.unitList?.adInfos || []).map(u => String(u.adId ?? u.id)).filter(Boolean)
    if (all.length) {
      if (!process.argv.includes('--unit-ids')) process.argv.push('--unit-ids', all.join(','))
    }
  }

  const WRITE_MODES = ['pause', 'resume', 'delete', 'create', 'maxcost', 'roi']
  if (WRITE_MODES.includes(mode)) {
    const unitId = argOf('unit-id') || argOf('ad-id')
    const unitIds = (argOf('unit-ids') || '').split(',').map(s => s.trim()).filter(Boolean)   // 批量：逗号分隔
    const goodsId = argOf('goods-id')
    const maxCostYuan = argOf('max-cost')        // 日限额（元）；'unlimited' 或 0 = 不限
    const roi = argOf('roi')                     // 投产比（如 3 = 1:3）
    const planId = argOf('plan-id') || 0         // 计划 ID（delete 需要，从 units/detail 取）
    if (!unitId && !unitIds.length && !goodsId) {
      emit({ ok: false, failureKind: 'api_error', text: `${mode} 模式必须带 --unit-id / --unit-ids(批量) / --goods-id` })
      await browser.close()
      process.exit(2)
    }
    const ids = unitIds.length ? unitIds : (unitId ? [unitId] : [])
    const verb = { pause: '暂停', resume: '开启', delete: '删除', create: '创建', maxcost: '改日限额', roi: '改投产比' }[mode]
    const detail = mode === 'maxcost' ? `日限额 → ${maxCostYuan || '（未指定，无效）'}` : mode === 'roi' ? `投产比 → ${roi || '（未指定，无效）'}` : ''
    if (!process.argv.includes('--confirm')) {
      emit({
        ok: false, needConfirm: true, mode,
        unitId: unitId || null, unitIds: ids, goodsId: goodsId || null,
        maxCost: maxCostYuan || null, roi: roi || null,
        text: `【推广${verb}预览 · 需用户确认】\n目标：${ids.length ? `${ids.length} 个推广单元（${ids.slice(0, 10).join(', ')}${ids.length > 10 ? '…' : ''}）` : `商品 ${goodsId}`}\n操作：${verb}${detail ? `（${detail}）` : mode === 'create' ? '（稳定成本推广，默认系统建议出价 + 日限额不限）' : ''}\n\n确认无误后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。`,
      })
      await browser.close()
      process.exit(0)
    }
    // 真实执行：在页面上下文里发请求（带 Anti-Content 签名）
    // ★ 取 captcha 通行证（有则带，10 分钟内不再弹滑块）
    const { getCaptchaToken: _getTok, saveCaptchaToken: _saveTok, extractCaptchaToken: _extractTok } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`)
    const vtkToken = _getTok(SHOP)?.token || null
    const r = await page.evaluate(async (m, uid, gid, mcYuan, roiVal, sig, pid, ids, vtk) => {
      const yuanToApi = (y) => Math.round(Number(y) * 100)   // 元 → 分
      const APIs = {
        pause: '/mms-gateway/venus/api/global/unit/batchUpdateStatus',
        resume: '/mms-gateway/venus/api/global/unit/batchUpdateStatus',
        delete: '/mms-gateway/venus/api/goods/promotion/virtual/delete',
        create: '/mms-gateway/venus/api/promotion/batchCreate',
        maxcost: '/mms-gateway/venus/api/goods/promotion/update/max/cost',
        roi: '/mms-gateway/venus/api/promotion/batchUpdateBid',
      }
      const adId = uid ? Number(uid) : 0
      const adIds = (ids || []).map(x => Number(x)).filter(x => x > 0)
      const useIds = adIds.length ? adIds : (adId ? [adId] : [])
      // maxCost/targetRoi 是 {value, unitCode} 对象（unitCode:1=元）
      // 页面实证：不限 = value "1000000.00"
      const UNLIMITED = { value: '1000000.00', unitCode: 1 }
      const bodies = {
        // ★ 实测成功（2026-10-21）：{adIdList, dataOperateStatus}（不是 operateStatus/adStatus）
        pause: { adIdList: useIds, dataOperateStatus: 2 },
        resume: { adIdList: useIds, dataOperateStatus: 1 },
        // 删除：实测 {goodsId, adId, planId} 参数结构正确（部分推广类型返回"不支持删除广告"）
        delete: { goodsId: gid ? Number(gid) : 0, adId, planId: pid || 0 },
        // 创建：adInfoList 数组（真实抓包 2026-10-21），maxCost/targetRoi 为对象
        create: {
          adInfoList: [{
            goodsId: gid ? Number(gid) : 0,
            maxCost: (!mcYuan || mcYuan === 'unlimited') ? UNLIMITED : { value: String(mcYuan), unitCode: 1 },
            bidType: 1,
            targetRoi: roiVal ? { value: String(roiVal), unitCode: 1 } : undefined,
            isAdvertiserEnableAdvanced: true,
          }],
        },
        // 日限额：★ 实测成功 —— {adId, maxCost:{value, unitCode}}（对象，元为单位）
        maxcost: { adId, maxCost: (!mcYuan || mcYuan === 'unlimited') ? UNLIMITED : { value: String(mcYuan), unitCode: 1 } },
        // 投产比：★ 实测抓包（2026-10-21）—— body 是 updateBidList 数组
        roi: {
          updateBidList: [{
            adId,
            targetRoi: { value: String(roiVal || '0'), unitCode: 1 },
            isAdvertiserEnableAdvanced: true,
            optionalOptimizationMessageInfoList: [
              { optimizationGoal: 3, dataOperateStatus: 2 },
              { optimizationGoal: 4, dataOperateStatus: 2 },
              { optimizationGoal: 5, dataOperateStatus: 2 },
            ],
          }],
        },
      }
      const url = APIs[m]
      let body = bodies[m]
      // 注入签名（crawlerInfo 进 body + Anti-Content 进头）
      const headers = { 'Content-Type': 'application/json' }
      if (sig) {
        body = { ...body, crawlerInfo: sig.crawlerInfo }
        headers['Anti-Content'] = sig.anti
      }
      // ★ 带上 captcha 通行证
      if (vtk) headers['VerifyAuthToken'] = vtk
      try {
        const resp = await fetch(url, {
          method: 'POST', credentials: 'include', headers, body: JSON.stringify(body),
        })
        return { status: resp.status, json: await resp.json().catch(() => null) }
      } catch (e) { return { status: -1, json: null, err: e.message } }
    }, mode, unitId, goodsId, maxCostYuan, roi, sigPair, planId, ids, vtkToken)
    const ok = r.json?.success === true || r.json?.errorCode === 1000 || r.json?.error_code === 1000000
    const succ = r.json?.result?.successList || []
    const fail = r.json?.result?.failedList || []
    emit({
      ok, mode, unitId: unitId || null, unitIds: ids, goodsId: goodsId || null,
      maxCost: maxCostYuan || null, roi: roi || null,
      successCount: succ.length, failedCount: fail.length,
      raw: r.json,
      text: ok
        ? `推广${verb}成功${ids.length > 1 ? `（${succ.length} 个单元）` : ids.length ? `（单元 ${ids[0]}）` : `（商品 ${goodsId}）`}${detail ? `，${detail}` : ''}。` +
          (fail.length ? `\n失败 ${fail.length} 个：${JSON.stringify(fail).slice(0, 200)}` : '')
        : `推广${verb}失败：${r.json?.error_msg || r.json?.errorMsg || JSON.stringify(r.json).slice(0, 300)}\n\n可能原因：\n① 单元不存在或已被删\n② 该操作需要页面会话签名（yingxiao 域风控，自己发请求会被 54001 拦）\n③ 参数结构需按实际页面调整（不同出价类型 bidType 不同）\n变通：到 yingxiao.pinduoduo.com 后台手动操作。`,
    })
    await browser.close()
    process.exit(0)
  }

  emit(out)
  clearInterval(hb)
  await browser.close()
})().catch(async (e) => {
  // ★ 风控异常 → 友好提示 + 记账号健康分
  const { checkCooldown, fmtRemain } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`).catch(() => ({}))
  if (e?.riskCode && checkCooldown) {
    const cd = checkCooldown(SHOP)
    try {
      const { recordToAntiban } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-error.mjs`)
      await recordToAntiban(SHOP, e.riskCode, null)
    } catch { /* ignore */ }
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `命中平台频控（code=${e.riskCode}${e.riskMsg ? `：${e.riskMsg}` : ''}），已记冷却 ${fmtRemain(cd.remainMs)}。\n期间请勿重复调用（会延长封禁）。\n若急需使用，可在浏览器窗口手动过滑块验证，然后重试。`,
    })
    process.exit(2)
  }
  // ★ 2026-10-24 补：detached Frame → 风控关页面
  try {
    const { normalizeError, recordToAntiban } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-error.mjs`)
    const n = normalizeError(e, '推广')
    await recordToAntiban(SHOP, null, n.failureKind === 'risk_control' ? 'captcha' : null).catch(() => {})
    emit({ ok: false, failureKind: n.failureKind, text: n.text })
    process.exit(2)
  } catch { /* ignore */ }
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})

