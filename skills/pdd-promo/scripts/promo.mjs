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
  ]
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
  for (const u of [
    'https://yingxiao.pinduoduo.com/mains/promotionOverview',
    'https://yingxiao.pinduoduo.com/goods/report/promotion/overView',
    'https://yingxiao.pinduoduo.com/goods/promotion/list',
  ]) {
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
    const r = await page.evaluate(async (m, uid, gid, mcYuan, roiVal, sig, pid, ids) => {
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
      try {
        const resp = await fetch(url, {
          method: 'POST', credentials: 'include', headers, body: JSON.stringify(body),
        })
        return { status: resp.status, json: await resp.json().catch(() => null) }
      } catch (e) { return { status: -1, json: null, err: e.message } }
    }, mode, unitId, goodsId, maxCostYuan, roi, sigPair, planId, ids)
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

