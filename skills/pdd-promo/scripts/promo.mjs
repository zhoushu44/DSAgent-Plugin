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
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
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
      if (j && (j.errorCode === 1000 || j.error_code === 1000000 || j.success === true)) byApi[hit[0]] = j.result
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
  if (mode === 'diagnose' || mode === 'balance') {
    // 1) 先从推广列表拿 adId
    let adIds = []
    const ads = byApi.unitList?.adInfos || []
    adIds = ads.map(a => a.adId ?? a.id).filter(Boolean)
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
    const sum = byApi.entityReport?.pageSumReport || byApi.rangeReport?.sumReport || null
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
    }
  }
  // ── units 模式：推广单元列表 ──
  const units = (byApi.unitList?.adInfos || []).map(u => ({
    adId: u.adId ?? u.id,
    adName: u.adName ?? u.name ?? '',
    goodsId: u.goodsId,
    goodsName: u.goodsName ?? '',
    status: u.adStatus ?? u.status,
    impression: u.impression, click: u.click,
    spend: u.orderSpend ?? u.spend, roi: u.orderSpendRoiUnified ?? u.roi,
    maxCost: u.maxCost,
  }))
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
          impressionMinPct: numOf(e.impressionCntIntervalMin),
          impressionMaxPct: numOf(e.impressionCntIntervalMax),
          gmvDiffMaxPct: numOf(e.gmvDiffIntervalMax),
        }
      }
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
   *   下滑风险 declineScore   20%  → labelType=4/7 扣分
   *   损失损失 lossScore      15%  → trafficLoss / orderLoss
   *   素材素材 creativeScore  10%  → creativeLabelType
   *
   * 动作判定（阈值可在调参时改）：
   *   总分 ≥ 70            → ✅ 保持（healthy）
   *   50 ≤ 总分 < 70       → ⚠️ 微调（tune）—— 出价低就加 5~10%
   *   总分 < 50 且有建议价  → 🔼 加价（raise）—— 按 suggestBid 提
   *   总分 < 50 且有下滑    → 🔽 降价/止损（cut）
   *   无投放（modules 空）  → ➕ 可开新推广（open）
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
      // ★ 扣分项：labelType 4（下滑）/ 7（排名过低）
      const badLabels = (m.labelTypes || []).filter(t => t === 4 || t === 7)
      if (score != null) {
        if (badLabels.includes(4)) score -= 20   // 竞争力下滑，扣 20
        if (badLabels.includes(7)) score -= 15   // 排名过低，扣 15
        score = Math.max(0, Math.round(score))
      }
      return { score, parts, penalties: badLabels }
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
      const hasDecline = allPenalties.includes(4)
      const hasTooLow = allPenalties.includes(7)
      const m1 = mods.find(m => m.moduleType === 1)
      const suggestBid = m1?.suggestBid ?? null
      const alert = m1?.alertType ?? null
      const eff = m1?.effectPredict ?? null
      const why = []
      if (primary.m.competitionLevel != null) why.push(`竞争等级 ${primary.m.competitionLevel}/10`)
      if (primary.m.rank != null) why.push(`排名 ${primary.m.rank}/100`)
      if (hasDecline) why.push('竞争力下滑(label 4)')
      if (hasTooLow) why.push('排名过低(label 7)')
      if (alert === 21) why.push('出价偏低(alert 21)')
      if (eff?.orderMaxPct) why.push(`提价可增订单 0~${eff.orderMaxPct}%`)

      if (score >= 70) return { action: 'healthy', label: '✅ 保持', reason: why.join('；'), score, suggestBid }
      if (score >= 50) return { action: 'tune', label: `⚠️ 微调${suggestBid ? `（建议出价 ¥${suggestBid}）` : ''}`, reason: why.join('；'), score, suggestBid }
      if (suggestBid && alert === 21) return { action: 'raise', label: `🔼 加价到 ¥${suggestBid}`, reason: why.join('；'), score, suggestBid }
      if (hasDecline || hasTooLow) return { action: 'cut', label: '🔽 降价/止损', reason: why.join('；'), score, suggestBid }
      return { action: 'raise', label: `🔼 提价${suggestBid ? `到 ¥${suggestBid}` : ''}`, reason: why.join('；'), score, suggestBid }
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
      return {
        adId: d.adId,
        adName: u.adName || u.goodsName || '',
        goodsId: u.goodsId ?? null,
        spend: u.spend ?? null,
        roi: u.roi ?? null,
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
      out.text = merged.length
        ? `推广诊断（${merged.length} 个推广单元）：\n` + merged.map((x, i) => {
            const lines = [`  ${i + 1}. [${x.adId}] ${String(x.adName).slice(0, 24)} | ${x.label}${x.score != null ? ` 总分${x.score}` : ''}`]
            if (x.reason) lines.push(`     依据：${x.reason}`)
            if (x.spend != null || x.roi != null) lines.push(`     花费=${x.spend ?? '—'} ROI=${x.roi ?? '—'}`)
            const m1 = x.modules.find(m => m.moduleType === 1)
            if (m1) {
              lines.push(`     出价竞争力：竞争等级 ${m1.competitionLevel}/10 · 排名 ${m1.rank}/100${m1.suggestBid ? ` · 建议出价 ¥${m1.suggestBid}` : ''}`)
              if (m1.effectPredict && m1.effectPredict.orderMaxPct) {
                lines.push(`     效果预估：订单 +0~${m1.effectPredict.orderMaxPct}% · 曝光 +0~${m1.effectPredict.impressionMaxPct}%`)
              }
            }
            const bad = x.modules.filter(m => m.labelTypes.some(t => t === 4 || t === 7))
            if (bad.length) lines.push(`     异常：${bad.map(m => `${m.moduleName}(label ${m.labelTypes.join('/')})`).join('，')}`)
            return lines.join('\n')
          }).join('\n')
        : `推广诊断：未获取到数据。\n可能原因：\n① 当前店铺没有在投的推广单元（adInfos 为空）\n② 诊断抽屉未成功打开（URL 需带 drawerTab=promoteDiagnosis）\n③ 推广域登录态失效\n\n排查：先用 --mode units 看有没有推广单元，有 ID 后可用 --ad-id <ID> 单独诊断。`
    }

    if (mode === 'balance') {
      // 按动作分组
      const byAction = {}
      for (const x of merged) {
        (byAction[x.action] = byAction[x.action] || []).push(x)
      }
      const ACTION_ORDER = ['raise', 'cut', 'tune', 'healthy', 'open', 'unknown']
      const ACTION_LABEL = {
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
      for (const act of ACTION_ORDER) {
        const group = byAction[act]
        if (!group?.length) continue
        lines.push(`${ACTION_LABEL[act]}（${group.length} 个）`)
        for (const x of group) {
          lines.push(`  · [${x.adId}] ${String(x.adName || x.goodsId).slice(0, 26)}${x.score != null ? ` | 总分${x.score}` : ''}`)
          if (x.reason) lines.push(`      ${x.reason}`)
          if (act === 'raise' && x.suggestBid) lines.push(`      → 出价提到 ¥${x.suggestBid}`)
          if (act === 'cut') lines.push(`      → 降 10~20% 或暂停观察 3 天`)
        }
        lines.push('')
      }
      // 预算分配建议
      const raise = byAction.raise || [], cut = byAction.cut || []
      if (raise.length && cut.length) {
        lines.push(`💡 预算重分配：从「${cut.length} 个待降」腾出的预算，加到「${raise.length} 个待加」上`)
      } else if (raise.length) {
        lines.push(`💡 建议给 ${raise.length} 个推广单元加价/加预算`)
      } else if (cut.length) {
        lines.push(`💡 建议对 ${cut.length} 个低效单元降价或暂停，避免无效消耗`)
      } else if (merged.length) {
        lines.push('💡 当前推广结构健康，无需大调整')
      }
      out.text = lines.join('\n')
      out.balance = {
        totalSpend: totalSpend || null,
        byAction: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, v.map(x => ({ adId: x.adId, name: x.adName, score: x.score, suggestBid: x.suggestBid }))])),
      }
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

