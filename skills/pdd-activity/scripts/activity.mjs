/**
 * 拼多多活动报名（pdd-activity）
 *
 * 数据源：营销活动子应用（mms.pinduoduo.com/act/* + /leekmms/* + /lakemms/*）。
 * 采用「打开活动页 → hook 页面自己发的响应」取数（与 pdd-promo / pdd-shop 同思路，
 * 规避该子应用的风控签名）。
 *
 * 能力：
 *   overview   活动总览（可报名活动 + 统计 + 主题推荐）
 *   list       活动列表（activityListV3，54 个活动类型）
 *   types      活动类型清单（含说明）
 *   forbid     禁止报名原因（哪些活动报不了 + 原因）
 *   stats      活动商品统计
 *   enroll     报名（L2，body 结构已从 chunk 提取，需实测校准）
 *
 * 用法：node scripts/activity.mjs --mode overview
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
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain, tryAcquireAccountLock, releaseAccountLock, heartbeatAccountLock, throttleRequest } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`)
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
  const lock = await tryAcquireAccountLock(SHOP, 'pdd-activity', 300000)
  if (!lock.ok) {
    emit({ ok: false, failureKind: 'rate_limit', text: '账号 ' + SHOP + ' 正被其他任务占用' + (lock.holder ? '（' + lock.holder + '）' : '') + '，请稍后再试。' })
    process.exit(2)
  }
  const releaseLock = () => { try { releaseAccountLock(SHOP) } catch (e) {} }
  process.on('exit', releaseLock)
  process.on('SIGINT', () => { releaseLock(); process.exit(130) })
  process.on('SIGTERM', () => { releaseLock(); process.exit(143) })
  const hb = setInterval(() => heartbeatAccountLock(SHOP, 'pdd-activity'), 180000)


  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) {
    // 回退：找任意 pdd_mms profile
    const dir = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts')
    const alt = fs.readdirSync(dir).find(d => d.startsWith('pdd_mms_'))
    if (alt) profile = path.join(dir, alt)
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
      console.warn(`[pdd-activity] ${label}：检测到滑块遮罩，尝试自动过滑块...`)
      const solved = await autoSolveSlider(SHOP, page)
      if (!solved.ok) {
        await browser.close()
        emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}\n请手动过验证后重试。` })
        process.exit(2)
      }
      console.warn(`[pdd-activity] 滑块已过：${solved.text}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // hook 活动相关响应 + 签名配对（报名需要）
  await page.evaluateOnNewDocument(() => {
    window.__sigPair = null
    const O = window.XMLHttpRequest.prototype.open
    const S = window.XMLHttpRequest.prototype.send
    const SH = window.XMLHttpRequest.prototype.setRequestHeader
    window.XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return O.apply(this, arguments) }
    window.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h[k] = v; return SH.apply(this, arguments) }
    window.XMLHttpRequest.prototype.send = function (b) {
      try {
        if (/mms-gateway|\/lakemms\/|\/leekmms\//.test(this.__u) && String(b).includes('crawlerInfo')) {
          window.__sigPair = { anti: this.__h['Anti-Content'], crawlerInfo: JSON.parse(String(b)).crawlerInfo }
        }
        // mallId 从 boost factor 里抠（uyrhleur-<mallId>-<ts>）
        const bf = String(b).match(/behavior_collection_v1_cas_boost_factor[^a-zA-Z]*"?([A-Za-z0-9+/=]{20,})/)
        if (bf) { try { const d = atob(bf[1]); const m = d.match(/uyrhleur-(\d+)-/); if (m) window.__mallId = m[1] } catch { /* ignore */ } }
      } catch { /* ignore */ }
      return S.apply(this, arguments)
    }
  })

  const byApi = {}
  const APIS = [
    ['activityList', 'activityLabelAudit/query/activityListV3'],
    ['labelList', 'activityLabelAudit/query/labelList'],
    ['types', 'announce/getActivityTypeDescriptions'],
    ['forbid', 'activity/query/forbidEnroll/reason'],
    ['stats', 'lakemms/activityGoods/statics'],
    ['theme', 'theme/activity/recommend/theme'],
    ['recommend', 'quick_enroll/recommended_module'],
    ['quickCard', 'quick_enroll/quickmultigoodscard'],
    ['storeEnroll', 'full_store_enroll/need_show_sidenav_tab'],
    ['agreement', 'full_store_enroll/agreement_detail'],
    ['records', 'lakemms/activityGoods/list'],
    ['effect', 'data_board/query/activity_effect_data'],
    ['eligible', 'eligible/goods/list'],
    ['invite', 'invite/activity_batch_tab_v2'],
    ['recommendList', 'activity/query/recommend/list'],
    ['subsidy', 'brand_subsidy/merchant/query'],
    ['outerPrice', 'activity/outer_activity_price_info'],
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
      if (j && (j.errorCode === 1000000 || j.error_code === 1000000 || j.success === true)) byApi[hit[0]] = j.result
    } catch { /* ignore */ }
  })
  // 页面内 fetch 兜底：直接抓 effect 接口原始数据（避免 CDP 大响应体截断）
  if (mode === 'effect') {
    try {
      const fetched = await page.evaluate(async () => {
        for (const qt of [0, 1]) {
          try {
            const resp = await fetch('https://mms.pinduoduo.com/lakemms/data_board/query/activity_effect_data', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query_type: qt }),
            })
            const j = await resp.json()
            if (j?.result?.activity_effect_data_volist?.length) return j.result
          } catch { /* 下一个 */ }
        }
        return null
      }).catch(() => null)
      if (fetched) byApi.effect = fetched
    } catch { /* 兜底失败就用 hook 数据 */ }
  }

  // 打开营销活动首页 + 报名记录页（records 模式要后者）
  for (const u of [
    'https://mms.pinduoduo.com/act/index?SourceType=MMSActicon',
    ...(mode === 'records' || mode === 'quit' ? ['https://mms.pinduoduo.com/act/register_record'] : []),
  ]) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 50000 })
      await new Promise(r => setTimeout(r, 14000))
      await ensureNoSlider(u)   // ★ 风控 L3
      if (/\/login/i.test(page.url())) {
        await browser.close()
        emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
        process.exit(2)
      }
    } catch { /* 单页失败不阻断 */ }
  }

  const out = { ok: true, mode, shopKey: SHOP }
  const lines = []

  // 活动类型
  const types = (byApi.types?.list || []).map(t => ({
    typeId: t.activityTypeId, name: t.subject, keywords: t.keyWords || [],
  }))
  out.activityTypes = types

  // 活动列表（按大类分组）
  const typeGroups = byApi.activityList?.mms_activity_type_vo?.activity_type_list || []
  const activities = []
  for (const g of typeGroups) {
    for (const sub of (g.type_list || [])) {
      activities.push({ groupId: g.id, groupName: g.name, typeId: sub, tags: g.activity_tag_list || [] })
    }
  }
  out.activityGroups = typeGroups.map(g => ({ id: g.id, name: g.name, types: g.type_list, tags: g.activity_tag_list || [], hot: g.hot_activity }))
  out.activityCount = activities.length

  // 禁止报名原因
  const forbid = byApi.forbid || null
  out.forbid = forbid

  // 统计
  const stats = byApi.stats || null
  out.stats = stats

  // 主题推荐
  const themes = byApi.theme || null
  out.themes = themes

  // 推荐模块（百亿补贴等）
  const recs = byApi.recommend?.recommended_module_card_list || []
  out.recommended = recs.map(r => ({
    scene: r.scene_type,
    majorActivityId: r.major_activity_id,
    title: r.multi_activity_card_display_vo?.title,
    benefits: (r.multi_activity_card_display_vo?.benefit_point_list || []).map(b => b.benefit_text),
    estConversion: r.multi_activity_card_display_vo?.est_conversion_rate,
  })).filter(r => r.majorActivityId)   // 过滤掉无 ID 的占位卡片

  // 快速报名活动
  const quick = byApi.quickCard?.query_by_scene_activity_info_list || []
  out.quickEnroll = quick.map(q => ({
    activityId: q.activity_id, name: q.activity_name, type: q.activity_type, scene: q.scene_type,
  }))

  // 全店报名入口
  out.storeEnroll = byApi.storeEnroll ? { showTab: !!byApi.storeEnroll.need_show_sidenav_tab } : null

  if (mode === 'overview') {
    lines.push('拼多多活动总览：')
    lines.push(`  活动类型：${types.length} 种（${types.slice(0, 12).map(t => t.name).join('、')}${types.length > 12 ? '…' : ''}）`)
    lines.push(`  活动大类：${typeGroups.length} 组（${typeGroups.map(g => g.name).join('、')}）`)
    if (out.recommended.length) {
      lines.push('  推荐活动：')
      out.recommended.slice(0, 5).forEach(r => lines.push(`    · ${r.title}（ID ${r.majorActivityId}）${r.benefits.length ? ` — ${r.benefits.join('/')}` : ''}`))
    }
    if (out.quickEnroll.length) {
      lines.push('  快速报名：')
      out.quickEnroll.slice(0, 5).forEach(q => lines.push(`    · [${q.activityId}] ${q.name}`))
    }
    if (forbid) {
      const fk = Object.keys(forbid).filter(k => Array.isArray(forbid[k]) && forbid[k].length)
      if (fk.length) lines.push(`  禁止报名：${fk.join('、')}（详见 forbid 字段）`)
    }
    out.text = lines.join('\n')
  } else if (mode === 'list') {
    out.text = activities.length
      ? `活动列表（${activities.length} 项，按 ${typeGroups.length} 个大类）：\n` + typeGroups.map(g =>
          `  ${g.name}（ID ${g.id}）：${(g.type_list || []).join(', ')}${g.activity_tag_list?.length ? ` [${g.activity_tag_list.join('/')}]` : ''}`).join('\n')
      : '活动列表：暂无数据'
  } else if (mode === 'types') {
    out.text = types.length
      ? `活动类型（${types.length} 种）：\n` + types.map(t => `  [${t.typeId}] ${t.name}${t.keywords.length ? ` — ${t.keywords.join('/')}` : ''}`).join('\n')
      : '活动类型：暂无数据'
  } else if (mode === 'forbid') {
    out.text = forbid
      ? `禁止报名原因：\n${JSON.stringify(forbid, null, 2).slice(0, 1200)}`
      : '禁止报名：无（所有活动均可报名）'
  } else if (mode === 'stats') {
    out.text = stats ? `活动商品统计：\n${JSON.stringify(stats, null, 2).slice(0, 1000)}` : '活动统计：暂无数据'
  } else if (mode === 'effect') {
    // 活动效果看板：资源位商品数 + 24h 逐时趋势 + 环比 + 待处理
    const eff = byApi.effect || null
    const stat = byApi.stats || null
    // 卡片字段 → 中文名 + 单位（value 单位：分→元 仅 pay 类）
    // extra_value = 对比值（昨日同期）的字符串形式，不是比率
    const CARD_DEFS = [
      ['act_goods_data_card', '资源位商品数', '个', false],
      ['pay_price_data_card', '支付金额', '元', true],
      ['ag_visitor_data_card', '商品访客', '人', false],
      ['goods_visitor_data_card', '商品访客(去重)', '人', false],
      ['activity_order_data_card', '活动订单', '单', false],
      ['goods_collection_data_card', '商品收藏', '次', false],
      ['visited_goods_data_card', '被访商品数', '个', false],
      ['customer_data_card', '客户数', '人', false],
    ]
    const cards = []
    for (const item of (eff?.activity_effect_data_volist || [])) {
      const rt = item.resource_type_vo || {}
      for (const [field, name, unit, isCents] of CARD_DEFS) {
        const card = item[field]
        if (card == null || typeof card !== 'object') continue
        const cur = card.trend_value?.current_data || []
        const hist = card.trend_value?.history_data || card.trend_value?.hist_data || []
        const vals = cur.map(p => p.value).filter(v => typeof v === 'number')
        const histVals = hist.map(p => p.value).filter(v => typeof v === 'number')
        const rawValue = typeof card.value === 'number' ? card.value : null
        // extra_value = 对比值（昨日同期），字符串数字；空串/非数字 → null
        let prev = null
        if (typeof card.extra_value === 'string' && card.extra_value.trim() !== '') {
          const n = Number(card.extra_value)
          if (Number.isFinite(n)) prev = n
        } else if (typeof card.extra_value === 'number' && Number.isFinite(card.extra_value)) {
          prev = card.extra_value
        }
        const chgPct = rawValue != null && prev != null && prev !== 0
          ? +(((rawValue - prev) / prev) * 100).toFixed(2) : null
        cards.push({
          resourceType: rt.business_type_str || String(rt.business_type ?? ''),
          metric: name,
          value: rawValue,
          valueDisplay: rawValue != null && isCents ? (rawValue / 100).toFixed(2) : rawValue,
          prevValue: prev,
          prevDisplay: prev != null && isCents ? (prev / 100).toFixed(2) : prev,
          changePct: chgPct,
          unit,
          spec: card.card_specification_text || null,
          trend: cur.map(p => ({ hour: p.time, value: p.value })),
          trendSum: vals.reduce((a, b) => a + b, 0),
          trendMax: vals.length ? Math.max(...vals) : null,
          trendMin: vals.length ? Math.min(...vals) : null,
          historySum: histVals.length ? histVals.reduce((a, b) => a + b, 0) : null,
        })
      }
    }
    out.effect = {
      statDate: eff?.stat_date || null,
      onSaleGoodsCnt: eff?.on_sale_goods_cnt ?? null,
      todoRecordNum: eff?.todo_record_num ?? null,
      resourceTypes: (eff?.resource_type_volist || []).map(r => ({ id: r.business_type, name: r.business_type_str })),
      cards,
      stats: stat ? {
        all: stat.status_group_statics?.all ?? null,
        ongoing: stat.status_group_statics?.ongoing ?? null,
        over: stat.status_group_statics?.over ?? null,
        pending: stat.status_group_statics?.pending ?? null,
        auditing: stat.status_group_statics?.auditing ?? null,
        urgeAudit: stat.can_urge_audit_count ?? null,
        resourceTodo: stat.resource_todo_num ?? null,
        priceBlocked: stat.activity_price_blocked_num ?? null,
        endangered: stat.xing_pan_endangered_data_num ?? null,
      } : null,
    }
    const L = ['活动效果看板：']
    if (eff?.stat_date) L.push(`  统计日期：${eff.stat_date}`)
    if (out.effect.onSaleGoodsCnt != null) L.push(`  在售商品：${out.effect.onSaleGoodsCnt} 个`)
    if (out.effect.todoRecordNum != null) L.push(`  待处理记录：${out.effect.todoRecordNum}`)
    if (cards.length) {
      L.push(`  资源位效果（${cards.length} 项指标）：`)
      cards.forEach(c => {
        if (c.value == null && c.prevValue == null) return   // 平台没这项数据，跳过
        const chg = c.changePct != null
          ? ` 昨日 ${c.prevDisplay ?? '-'}（${c.changePct > 0 ? '+' : ''}${c.changePct}%）`
          : (c.prevDisplay != null ? ` 昨日 ${c.prevDisplay}` : '')
        const span = c.trendMax != null && c.trendMin != null ? ` [${c.trendMin}~${c.trendMax}]` : ''
        L.push(`    · ${c.resourceType} ${c.metric}：${c.valueDisplay ?? '-'}${c.unit ? ' ' + c.unit : ''}${chg}${span}`)
      })
    }
    if (out.effect.stats) {
      const s = out.effect.stats
      L.push(`  报名统计：历史 ${s.all} | 进行中 ${s.ongoing} | 待审核 ${s.pending} | 已结束 ${s.over}`)
      if (s.priceBlocked) L.push(`  ⚠️ ${s.priceBlocked} 个商品活动价被屏蔽`)
      if (s.resourceTodo) L.push(`  ⚠️ ${s.resourceTodo} 个待处理资源位`)
      if (s.urgeAudit) L.push(`  ⚠️ ${s.urgeAudit} 个可催审`)
    }
    out.text = L.join('\n')
  } else if (mode === 'records') {
    // 报名记录列表（含 activity_goods_id —— 取消操作的必需参数）
    const list = byApi.records?.result || []
    const total = byApi.records?.total ?? list.length
    out.records = list.map(r => ({
      activityGoodsId: r.activity_goods_id,
      activityId: r.activity_id,
      activityName: r.activity_name,
      activityType: r.activity_type,
      businessType: r.business_type_str,
      goodsId: r.goods_id,
      goodsName: r.goods_name,
      status: r.status,
      enrollTime: r.enroll_time ? new Date(r.enroll_time).toLocaleString('zh-CN') : null,
      minPrice: r.min_on_sale_group_price, maxPrice: r.max_on_sale_group_price,
      soldQty: r.sold_quantity, goodsQty: r.goods_quantity,
      cancelType: r.cancel_type,
      refuseReason: r.refuse_reason,
    }))
    out.total = total
    out.text = out.records.length
      ? `报名记录（${out.records.length}/${total} 条）：\n` + out.records.slice(0, 30).map(r =>
          `  [agid ${r.activityGoodsId}] ${r.activityName} | ${String(r.goodsName).slice(0, 22)} | 状态=${r.status} | ${r.enrollTime || ''}`).join('\n')
        + `\n\n取消报名：--mode quit --activity-goods-id <agid>`
      : '报名记录：暂无（未报过任何活动）'
  } else if (mode === 'advice') {
    // 活动分析 + 建议
    const eff = byApi.effect || null
    const forbidList = Array.isArray(byApi.forbid) ? byApi.forbid : (byApi.forbid ? [byApi.forbid] : [])
    const sg = byApi.stats?.status_group_statics || {}
    out.advice = {
      effect: eff,
      forbid: forbidList,
      stats: byApi.stats ? {
        total: byApi.stats.total, pending: byApi.stats.status_statics,
        groups: sg, resourceTodo: byApi.stats.resource_todo_num,
        priceBlocked: byApi.stats.activity_price_blocked_num,
        urgeAudit: byApi.stats.can_urge_audit_count,
      } : null,
      recommended: out.recommended || [],
    }
    const lines = ['活动分析与建议：']
    if (sg.all != null) {
      lines.push(`  活动统计：历史 ${sg.all} | 进行中 ${sg.ongoing} | 待审核 ${sg.pending} | 已结束 ${sg.over}`)
      if (byApi.stats?.resource_todo_num) lines.push(`  ⚠️ 有待处理资源位 ${byApi.stats.resource_todo_num} 个`)
      if (byApi.stats?.can_urge_audit_count) lines.push(`  ⚠️ 有 ${byApi.stats.can_urge_audit_count} 个可催审`)
      if (byApi.stats?.activity_price_blocked_num) lines.push(`  ⚠️ ${byApi.stats.activity_price_blocked_num} 个商品活动价被屏蔽`)
    }
    if (forbidList.length) {
      lines.push('  禁止报名原因：')
      forbidList.forEach(f => lines.push(`    · ${f.reason}（code=${f.code}）`))
    } else {
      lines.push('  ✅ 无禁止报名项')
    }
    if (out.recommended?.length) {
      lines.push('  建议报名（按预估转化率降序）：')
      out.recommended.slice().sort((a, b) => (b.estConversion || 0) - (a.estConversion || 0))
        .slice(0, 5).forEach(r => lines.push(`    · ${r.title}（ID ${r.majorActivityId}）预估转化 ${r.estConversion}%`))
    }
    if (eff) lines.push(`  活动效果数据：${JSON.stringify(eff).slice(0, 300)}`)
    out.text = lines.join('\n')
  } else if (mode === 'quit') {
    // L2 取消报名（activity_goods_id 为必需参数）
    const agid = argOf('activity-goods-id')
    const aid = argOf('activity-id')
    const gid = argOf('goods-id')
    if (!agid) {
      emit({
        ok: false, failureKind: 'api_error',
        text: 'quit 模式必须带 --activity-goods-id（报名记录主键）。\n先用 --mode records 拿到 activityGoodsId。',
      })
      await browser.close(); process.exit(2)
    }
    if (!process.argv.includes('--confirm')) {
      emit({
        ok: false, needConfirm: true, mode, activityGoodsId: agid, activityId: aid || null, goodsId: gid || null,
        text: `【取消报名预览 · 需用户确认】\n报名记录：agid=${agid}${aid ? ` 活动=${aid}` : ''}${gid ? ` 商品=${gid}` : ''}\n接口：POST /lakemms/activityGoods/cancelEnroll\n\n确认后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。`,
      })
      await browser.close(); process.exit(0)
    }
    const sig = await page.evaluate(() => window.__sigPair || null).catch(() => null)
    const mallId0 = await page.evaluate(() => window.__mallId || null).catch(() => null)
    const variants = [
      ['全参', { activity_goods_id: Number(agid), activity_id: aid ? Number(aid) : undefined, goods_id: gid ? Number(gid) : undefined }],
      ['仅主键', { activity_goods_id: Number(agid) }],
    ]
    let last = null
    for (const [name, body] of variants) {
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
      const r = await page.evaluate(async (bd, s, mall) => {
        const payload = s ? { ...bd, crawlerInfo: s.crawlerInfo } : bd
        try {
          const resp = await fetch('https://mms.pinduoduo.com/lakemms/activityGoods/cancelEnroll', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(s ? { 'Anti-Content': s.anti } : {}) },
            body: JSON.stringify(payload),
          })
          return { status: resp.status, json: await resp.json().catch(() => null) }
        } catch (e) { return { status: -1, json: null, err: e.message } }
      }, clean, sig, mallId0).catch(() => ({ status: -1, json: null }))
      last = { name, ...r }
      if (r.json?.success === true) break
      await new Promise(r2 => setTimeout(r2, 2000))
    }
    const ok = last?.json?.success === true
    out.text = ok
      ? `取消报名成功（agid=${agid}）。返回：${JSON.stringify(last.json).slice(0, 300)}`
      : `取消报名失败：${JSON.stringify(last?.json).slice(0, 350)}\n\n可能原因：\n① 命中频控（100001 请2小时后重试）——该账号今日操作过密\n② 缺签名（页面未触发带 crawlerInfo 的请求）\n③ 该状态不允许取消（如活动已开始）`
    out.ok = ok
    out.raw = last?.json
  } else if (mode === 'enroll') {
    // L2 报名（真实 body 结构已实测校准 2026-10-21）
    const activityId = argOf('activity-id')
    const goodsId = argOf('goods-id')
    if (!activityId || !goodsId) {
      emit({ ok: false, failureKind: 'api_error', text: 'enroll 模式必须带 --activity-id 和 --goods-id' })
      await browser.close(); process.exit(2)
    }
    if (!process.argv.includes('--confirm')) {
      emit({
        ok: false, needConfirm: true, mode, activityId, goodsId,
        text: `【活动报名预览 · 需用户确认】\n活动：${activityId}\n商品：${goodsId}\n\n链路：enrollPopups → lowPriceCheckV3（低价校验）→ enrollV2（提交）\n\n确认后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。`,
      })
      await browser.close(); process.exit(0)
    }

    // ★ 真实执行：在活动页上下文里按页面同款链路发请求
    // ① enrollPopups ② lowPriceCheckV3 ③ enrollV2
    // 签名：该子应用用 Anti-Content 头（值 == body.crawlerInfo）
    const sig = await page.evaluate(() => window.__sigPair || null).catch(() => null)
    const r = await page.evaluate(async (activityId, goodsId, sig) => {
      const mallId = String(window.__mallId || '')
      const boost = 'uyrhleur-' + mallId + '-' + Date.now()
      const boostB64 = btoa(boost)
      const headers = { 'Content-Type': 'application/json' }
      if (sig) headers['Anti-Content'] = sig.anti

      const call = async (path, body) => {
        const payload = sig ? { ...body, crawlerInfo: sig.crawlerInfo } : body
        const resp = await fetch('https://mms.pinduoduo.com' + path, {
          method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload),
        })
        return { status: resp.status, json: await resp.json().catch(() => null) }
      }

      // ① 报名弹窗查询（拿活动要求/协议）
      const pop = await call('/leekmms/activity/query/enrollPopups', {
        activity_id: Number(activityId), goods_id_list: [Number(goodsId)], query_dimension: 2,
      })

      // ② 低价校验（用商品当前 SKU 价）
      //    真实链路里 sku_activity_price 由 price_calculation 算出的活动价，
      //    此处需调用方通过 --sku-prices 提供（JSON: [{sku_id, price}]）
      const skuPrices = window.__skuPrices || []
      const lowBody = {
        activity_id: Number(activityId),
        low_price_check_source_type: 1,
        goods_list: [{
          goods_id: Number(goodsId),
          sku_type_list: [{
            sku_activity_price_type: 'activity_price',
            sku_activity_price_list: skuPrices.map(s => ({ sku_activity_price: s.price, sku_id: s.sku_id })),
          }],
        }],
      }
      const low = await call('/lakemms/activityGoods/lowPriceCheckV3', lowBody)

      // ③ 报名提交
      const enrollBody = {
        activity_id: Number(activityId),
        goods_volist: [{
          goods_id: Number(goodsId),
          create_material_vo: { create_goods_image_vo: {} },
          view_confirmed_goods_protocol_vo: { confirm_hit_cut_price: true },
          create_activity_price_vo: {
            create_quantity_vo: {},
            create_sku_vos: skuPrices.map(s => ({
              sku_front_ctx_vo: { filling_sku_price: s.price, gear_rule: 100, require_price: s.price },
              sku_activity_price: s.price,
              sku_id: s.sku_id,
            })),
          },
        }],
        create_protocol_vo: {},
        create_outer_activity_price_ratio_vo: { merchant_confirm_outer_activity_price_ratio: true },
        enroll_source_ctx: {
          enroll_type: 26,
          scene_type: 'PROMO-OwnHome_SpecificMallRecommendMMS',
          scene_full_coverage: 'mmsActHomeSimpleMultiQuickEnrollV1',
          source_type: 'MMS_SpecificMallRecommend',
        },
        behavior_collection_v1_cas_boost_factor: boostB64,
      }
      const enroll = await call('/lakemms/enrollV2', enrollBody)
      return { pop, low, enroll, boostB64 }
    }, activityId, goodsId, sig)
    const ok = r.enroll?.json?.success === true
    out.text = ok
      ? `报名成功！活动 ${activityId} + 商品 ${goodsId}\n返回：${JSON.stringify(r.enroll.json).slice(0, 300)}`
      : `报名失败：${JSON.stringify(r.enroll?.json).slice(0, 400)}\n低价校验：${JSON.stringify(r.low?.json).slice(0, 200)}\n\n常见原因：\n① sku_activity_price 不满足活动折扣（需先用 price_calculation 算活动价）\n② 未勾选协议 / 命中砍价确认\n③ 活动已满 / 商品不符门槛`
  } else {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：overview / list / types / forbid / stats / enroll` })
    await browser.close(); process.exit(2)
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

