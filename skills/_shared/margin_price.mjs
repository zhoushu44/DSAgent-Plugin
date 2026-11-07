/**
 * SKU 级「利润 → 涨价安全线」计算器（共享，三平台同口径）
 *
 * ══════════════════════════════════════════════════════════════════
 * 核心口径（务必读，含一处常见公式笔误的纠正）
 * ══════════════════════════════════════════════════════════════════
 * 设：r = SKU 毛利率，p = 涨价比例（如 0.02 = +2%）
 *
 *   ① 保利润红线（最多可掉销量）= p / (r + p)
 *      等价写法：1 - 1/(1 + p/r)      ★ 分母是 1 + p/r，不是 1 + p
 *
 *   ② 底线单量 = 该 SKU 基线日均单量 × (1 - 保利润红线)
 *
 *   ③ 利润变化倍数 = 1 + p/r
 *
 *   ④ 保本投产比   = 1/r
 *
 * ⚠️⚠️ 高频笔误：把①写成 `1 - 1/(1 + p)`。
 *      `1 - 1/(1+p)` 其实是**保成交额（GMV）不掉**的线，不是保利润线——
 *      它严苛得多（r=10%、p=2% 时只有 1.96%，而保利润红线是 16.7%）。
 *      正确写法必须是 `1 - 1/(1 + p/r)`，两者差了一个 /r。
 *      本计算器把这两个数都算出来：`maxDropPct`（保利润红线，主判据）
 *      和 `revenueGuardDropPct`（保成交额预警线，更严，仅作提前预警）。
 *
 * 自检（与运营表格对齐）：r=10% 时
 *   p=2% → 0.02/0.12 = 16.7% ✓
 *   p=3% → 0.03/0.13 = 23.1% ✓
 *   p=5% → 0.05/0.15 = 33.3% ✓
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须按 SKU 单独算（不是按链接）
 * ══════════════════════════════════════════════════════════════════
 * 同一个链接里不同 SKU 的毛利率、单量、角色（引流 / 盈利）都不同，
 * 安全线就不同。混在一起看会出现：
 *   · 盈利 SKU 涨了价，被引流 SKU 的单量波动掩盖，看不出真实跌幅；
 *   · 用一个链接均值算安全线，对低毛利 SKU 过松、对高毛利 SKU 过严。
 * 所以：**每个 SKU 单独算、单独定基线、单独盯数据。**
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   node margin_price.mjs --price 99 --cost 79 --baseline-orders 30 --role profit
 *   node margin_price.mjs --price 99 --cost 79 --baseline-orders 30 --role profit --plan-k 0.05
 *   node margin_price.mjs --price 99 --cost 79 --baseline-orders 30 --role traffic
 *   node margin_price.mjs --price 99 --cost 79 --baseline-orders 30 --role profit --current-orders 18
 *   node margin_price.mjs --price 99 --cost 79 --baseline-orders 30 --steps 0.02,0.03,0.05 --json
 *
 * 也可 import：export { computeSkuAdvice, evaluateSkuTrigger }
 */

const round2 = (v) => Math.round(v * 100) / 100
const round1 = (v) => Math.round(v * 10) / 10
const round4 = (v) => Math.round(v * 10000) / 10000

/**
 * SKU 级涨价安全线计算
 *
 * @param {object} o
 * @param {string} [o.skuId]      SKU 标识（必填建议，便于单独归档）
 * @param {string} [o.skuName]    SKU 名称
 * @param {number} o.price        SKU 售价（元）
 * @param {number} o.cost         SKU 单位成本（元，商家提供，平台取不到）
 * @param {'traffic'|'profit'|'unknown'} [o.role] SKU 角色：引流款 / 盈利款
 * @param {number} [o.baselineOrders] 涨价前 7 天该 SKU 日均单量
 * @param {number} [o.baselineExposure] 涨价前 7 天该 SKU 日均曝光
 * @param {number} [o.baselineConversion] 涨价前 7 天该 SKU 转化率（%）
 * @param {number[]} [o.steps]    要测算的涨价幅度，默认 [0.02,0.03,0.05]
 * @param {number} [o.planK]     本次实际选定要执行的幅度
 * @param {number} [o.netRoi]     当前推广净 ROI（可选，用于和保本线比）
 * @param {boolean} [o.locked]   是否活动锁价（秒杀/百亿补贴等）
 * @param {boolean} [o.isNew]    是否新 SKU（无稳定历史销量/评价）
 * @param {number} [o.currentOrders] 涨价后当前日均单量（给则出跌幅判定）
 */
export function computeSkuAdvice({
  skuId = null, skuName = null,
  price, cost,
  role = 'unknown',
  baselineOrders = null, baselineExposure = null, baselineConversion = null,
  steps = [0.02, 0.03, 0.05],
  planK = null,
  netRoi = null,
  locked = false, isNew = false,
  currentOrders = null,
}) {
  const P = Number(price)
  const C = Number(cost)
  if (!Number.isFinite(P) || P <= 0) throw new Error('price 必须是正数（SKU 售价，元）')
  if (!Number.isFinite(C) || C < 0) throw new Error('cost 必须是非负数（SKU 单位成本，元）')
  if (C >= P) throw new Error(`单位成本 ${C} ≥ 售价 ${P}，毛利率 ≤ 0，没有涨价空间可言`)

  const m = (P - C) / P
  const unitProfit = P - C
  const breakevenRoi = 1 / m

  const rows = steps.map((k) => {
    const kk = Number(k)
    if (!Number.isFinite(kk) || kk <= 0) throw new Error(`涨价幅度 ${k} 无效`)
    // ① 保利润红线：p/(r+p)  —— 等价 1 - 1/(1+p/r)
    const maxDrop = kk / (m + kk)
    // ② 保成交额预警线：1 - 1/(1+p)（更严，只作提前预警，不是主判据）
    const revenueGuard = 1 - 1 / (1 + kk)
    const floor = baselineOrders != null && Number.isFinite(Number(baselineOrders))
      ? Math.floor(Number(baselineOrders) * (1 - maxDrop))
      : null
    return {
      k: kk,
      kPct: `+${(kk * 100).toFixed(kk * 100 % 1 === 0 ? 0 : 1)}%`,
      newPrice: round2(P * (1 + kk)),
      newUnitProfit: round2(P * (1 + kk) - C),
      profitChangePct: round1((kk / m) * 100),
      equivRevenuePct: round1((kk / m) * 100),
      maxDropPct: round1(maxDrop * 100),                 // 保利润红线（主判据）
      revenueGuardDropPct: round1(revenueGuard * 100),   // 保成交额预警线（更严）
      floorOrders: floor,                                 // 底线日均单量
    }
  })

  const out = {
    sku: { skuId, skuName, role },
    inputs: { price: P, cost: C },
    margin: {
      rate: round4(m),
      ratePct: round2(m * 100),
      unitProfit: round2(unitProfit),
      breakevenRoi: round2(breakevenRoi),
    },
    baseline: {
      days: 7,
      avgDailyOrders: baselineOrders != null ? Number(baselineOrders) : null,
      exposure: baselineExposure != null ? Number(baselineExposure) : null,
      conversion: baselineConversion != null ? Number(baselineConversion) : null,
    },
    steps: rows,
  }

  // 本次选定幅度 → 对应安全线与底线单量
  if (planK != null && Number.isFinite(Number(planK))) {
    const kk = Number(planK)
    const maxDrop = kk / (m + kk)
    const row = rows.find(r => Math.abs(r.k - kk) < 1e-9) || null
    const floor = out.baseline.avgDailyOrders != null
      ? Math.floor(out.baseline.avgDailyOrders * (1 - maxDrop)) : null
    out.plan = {
      k: kk,
      kPct: `+${(kk * 100).toFixed(kk * 100 % 1 === 0 ? 0 : 1)}%`,
      maxDropPct: round1(maxDrop * 100),
      floorOrders: floor,
      newPrice: round2(P * (1 + kk)),
      profitChangePct: round1((kk / m) * 100),
    }
  }

  // 涨价后实际跌幅判定
  if (currentOrders != null && Number.isFinite(Number(currentOrders))
      && out.baseline.avgDailyOrders != null && out.baseline.avgDailyOrders > 0) {
    const base = out.baseline.avgDailyOrders
    const cur = Number(currentOrders)
    const drop = (base - cur) / base
    const redLine = out.plan ? out.plan.maxDropPct / 100 : rows[0] ? rows[0].maxDropPct / 100 : null
    const profitRatio = cur > 0 ? (cur * (P * (1 + (out.plan ? out.plan.k : 0)) - C)) / (base * (P - C)) : null
    out.monitor = {
      baselineOrders: base,
      currentOrders: cur,
      actualDropPct: round1(drop * 100),
      redLinePct: redLine == null ? null : round1(redLine * 100),
      aboveFloor: out.plan?.floorOrders != null ? cur >= out.plan.floorOrders : null,
      profitRatioVsBefore: profitRatio == null ? null : round2(profitRatio),
      verdict: redLine == null ? 'unknown'
        : drop < redLine * 0.8 ? 'safe'      // 明显在线内
        : drop <= redLine ? 'near_line'      // 接近红线
        : 'breached',                        // 已破红线
    }
  }

  if (netRoi != null && Number.isFinite(Number(netRoi))) {
    const r = Number(netRoi)
    out.roiCheck = {
      netRoi: r,
      breakevenRoi: round2(breakevenRoi),
      aboveBreakeven: r >= breakevenRoi,
      gapPct: round1((r / breakevenRoi - 1) * 100),
    }
  }
  return out
}

/**
 * SKU 级触发判定
 *
 * ⚠️ 口径（2026-10-28 修正）：**毛利薄不是门槛，只决定优先级。**
 *    常见误区是把"利润低"当触发条件——后期优化利润时，任何毛利率的 SKU
 *    都该算安全线：高毛利 SKU 红线更小（掉量容忍度低），低毛利 SKU 红线更大但更需要涨。
 *
 * 硬性排除（命中即不给涨价建议）：
 *   · 新 SKU / 无稳定历史销量与评价
 *   · 活动锁价 SKU（秒杀 / 百亿补贴）
 *   · 平台有 error 级异常标签（商品承接有问题，涨价放大问题）
 */
export function evaluateSkuTrigger({
  role = 'unknown',
  baselineOrders = null,
  locked = false, isNew = false,
  marginRate = null, netRoi = null,
  hasErrorLabel = false, wantProfit = true,
}) {
  const hasBaseline = baselineOrders != null && Number(baselineOrders) > 0
  const lateStage = hasBaseline            // 有稳定单量基线 = 已过测款/冷启动
  const blockedByLock = Boolean(locked)
  const blockedByNew = Boolean(isNew)
  const blockedByLabel = Boolean(hasErrorLabel)
  const isTraffic = role === 'traffic'
  const lowMargin = marginRate != null && marginRate <= 0.20
  const roiBelow = netRoi != null && marginRate != null && marginRate > 0 && netRoi < 1 / marginRate

  // 引流 SKU：不建议动一口价（改用满减/店铺券变相调整），但仍给测算结果供参考
  const recommendDirectPrice = Boolean(lateStage && wantProfit && !blockedByLock && !blockedByNew && !blockedByLabel && !isTraffic)
  const priority = (!lateStage || blockedByLock || blockedByNew || blockedByLabel)
    ? 'none'
    : (lowMargin || roiBelow) ? 'high' : 'normal'

  return {
    role, isTraffic,
    hasBaseline, lateStage,
    blockedByNew, blockedByLock, blockedByErrorLabel: blockedByLabel,
    lowMargin: Boolean(lowMargin),
    roiBelowBreakeven: Boolean(roiBelow),
    priority,
    recommendDirectPrice,
    shouldAdvise: Boolean(lateStage && wantProfit && !blockedByLock && !blockedByNew && !blockedByLabel),
  }
}

// ── 渲染 ────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)

export function renderSkuText(res) {
  const L = []
  const skuLabel = [res.sku?.skuName, res.sku?.skuId ? `(${res.sku.skuId})` : null].filter(Boolean).join(' ')
  L.push(`【SKU 涨价规划】${skuLabel || ''}`.trim())
  const roleText = res.sku?.role === 'traffic' ? '引流款' : res.sku?.role === 'profit' ? '盈利款' : '未标注'
  L.push(`SKU 角色：${roleText}`)

  const b = res.baseline
  const baseParts = [`日均 ${b.avgDailyOrders ?? '—'} 单`]
  if (b.exposure != null) baseParts.push(`曝光 ${b.exposure}`)
  if (b.conversion != null) baseParts.push(`转化率 ${b.conversion}%`)
  L.push(`基线（涨价前 ${b.days} 天，只看这个 SKU）：${baseParts.join('｜')}`)
  L.push(`售价 ¥${res.inputs.price}｜单位成本 ¥${res.inputs.cost}｜毛利率 ${res.margin.ratePct}%｜单件利润 ¥${res.margin.unitProfit}｜保本投产比 ${res.margin.breakevenRoi}`)
  L.push('')
  L.push('单 SKU 涨价幅度   新单价   单件利润   利润变化   保利润红线(最多可掉)   底线日均单量   保成交额预警线')
  for (const r of res.steps) {
    L.push(
      `${pad(r.kPct, 15)} ¥${pad(String(r.newPrice), 7)} ¥${pad(String(r.newUnitProfit), 7)} ` +
      `${pad('+' + r.profitChangePct + '%', 9)} ${pad(r.maxDropPct + '%', 19)} ` +
      `${pad(r.floorOrders == null ? '—' : r.floorOrders + ' 单', 13)} ${r.revenueGuardDropPct}%`
    )
  }
  L.push('')
  L.push('口径：保利润红线 = p/(毛利率+p)（等价 1−1/(1+p/毛利率)）；保成交额预警线 = 1−1/(1+p)，更严，仅作提前预警')

  if (res.plan) {
    L.push('')
    L.push(`本次选定 ${res.plan.kPct} → 新价 ¥${res.plan.newPrice}｜安全红线 ${res.plan.maxDropPct}%` +
      (res.plan.floorOrders != null ? `｜底线单量 ${res.plan.floorOrders} 单/天` : ''))
    if (res.plan.floorOrders != null && b.avgDailyOrders != null) {
      L.push(`👉 这个 SKU 只要每天 ≥${res.plan.floorOrders} 单（基线 ${b.avgDailyOrders} 单），它本身的利润不会比涨价前差`)
    }
  }

  if (res.roiCheck) {
    L.push('')
    L.push(`投产比判定：当前净ROI ${res.roiCheck.netRoi} vs 保本线 ${res.roiCheck.breakevenRoi} → ` +
      `${res.roiCheck.aboveBreakeven ? '高于保本线' : '低于保本线'}` +
      `（差 ${res.roiCheck.gapPct > 0 ? '+' : ''}${res.roiCheck.gapPct}%）`)
  }

  if (res.monitor) {
    const mo = res.monitor
    const vText = { safe: '✅ 跌幅在线内，利润提升，稳住继续观察', near_line: '⚠️ 接近红线，盯紧', breached: '❌ 已破红线，这个 SKU 要处理', unknown: '—' }[mo.verdict]
    L.push('')
    L.push(`涨价后监控：基线 ${mo.baselineOrders} 单 → 当前 ${mo.currentOrders} 单，实际跌幅 ${mo.actualDropPct}% vs 红线 ${mo.redLinePct}%`)
    L.push(`  判定：${vText}`)
    if (mo.profitRatioVsBefore != null) L.push(`  利润相当于涨价前的 ${(mo.profitRatioVsBefore * 100).toFixed(0)}%`)
  }
  return L.join('\n')
}

/** 固定的 SKU 监控清单 + 分级处置（不随参数变，抽成常量便于各技能复用） */
export const SKU_MONITOR_PLAN = [
  '涨价后监控（3–7 天，只看这个 SKU，别被链接其他 SKU 的单量干扰）：',
  '  1. 该 SKU 曝光有没有掉（价格力卡流量）',
  '  2. 该 SKU 转化率有没有下滑',
  '  3. 该 SKU 实际跌幅 VS 它自己的安全红线',
  '  4. 该 SKU 的净利润（最核心）',
  '',
  '单个 SKU 出问题怎么办（不连累整个链接）：',
  '  · 轻度（跌幅接近红线、曝光没崩）→ 只给这个 SKU 单独加券/赠品，不动链接其他 SKU',
  '  · 重度（该 SKU 转化崩、掉量超红线、价格力标红）→ 只回调这个 SKU 价格，其他 SKU 保持不动',
  '  · 避坑：不要频繁来回改同一个 SKU 价格；引流 SKU 翻车对全链接权重伤害最大',
  '',
  '假设：单位成本不变、成本随销量等比例变动；掉量还受客户流失与竞品比价影响',
]

// ── CLI ─────────────────────────────────────────────────────────
import { pathToFileURL as _pathToFileURL } from 'node:url'
const _isMain = process.argv[1] != null && import.meta.url === _pathToFileURL(process.argv[1]).href

if (_isMain) {
  const argv = process.argv.slice(2)
  const argOf = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined }
  try {
    const stepsArg = argOf('steps')
    const steps = stepsArg ? stepsArg.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n) && n > 0) : undefined
    const res = computeSkuAdvice({
      skuId: argOf('sku-id') ?? null,
      skuName: argOf('sku-name') ?? null,
      price: parseFloat(argOf('price')),
      cost: parseFloat(argOf('cost')),
      role: argOf('role') || 'unknown',
      baselineOrders: argOf('baseline-orders') != null ? parseFloat(argOf('baseline-orders')) : null,
      baselineExposure: argOf('baseline-exposure') != null ? parseFloat(argOf('baseline-exposure')) : null,
      baselineConversion: argOf('baseline-conversion') != null ? parseFloat(argOf('baseline-conversion')) : null,
      steps: steps && steps.length ? steps : undefined,
      planK: argOf('plan-k') != null ? parseFloat(argOf('plan-k')) : null,
      netRoi: argOf('net-roi') != null ? parseFloat(argOf('net-roi')) : null,
      locked: String(argOf('locked') || '') === 'true',
      isNew: String(argOf('is-new') || '') === 'true',
      currentOrders: argOf('current-orders') != null ? parseFloat(argOf('current-orders')) : null,
    })
    const trigger = evaluateSkuTrigger({
      role: res.sku.role,
      baselineOrders: res.baseline.avgDailyOrders,
      locked: String(argOf('locked') || '') === 'true',
      isNew: String(argOf('is-new') || '') === 'true',
      marginRate: res.margin.rate,
      netRoi: argOf('net-roi') != null ? parseFloat(argOf('net-roi')) : null,
      hasErrorLabel: String(argOf('error-label') || '') === 'true',
      wantProfit: String(argOf('want-profit') || 'true') !== 'false',
    })

    const blocks = [renderSkuText(res)]

    if (trigger.isTraffic) {
      blocks.push([
        '',
        '⚠️ 这是【引流 SKU】：不建议动一口价。',
        '  引流 SKU 保价格力，用满减 / 店铺券变相调整，别直接改售价。',
        '  上面的测算仅供了解——真要提利润，优先拿盈利款 / 高配 SKU 去测。',
      ].join('\n'))
    } else if (trigger.blockedByLock) {
      blocks.push(['', '⛔ 活动锁价 SKU（秒杀 / 百亿补贴等）：价格改不动，不做涨价规划。'].join('\n'))
    } else if (trigger.blockedByNew) {
      blocks.push(['', '⛔ 新 SKU / 无稳定历史销量与评价：先养基线，不做涨价规划。'].join('\n'))
    } else if (trigger.blockedByErrorLabel) {
      blocks.push(['', '⛔ 平台有 error 级异常标签：根因在商品侧（详情页/价格/规格/评价），涨价只会放大问题，先整改。'].join('\n'))
    } else if (trigger.recommendDirectPrice) {
      const prio = trigger.priority === 'high'
        ? '🔴 高（毛利率 ≤20% 或 净ROI 低于保本线 → 优先动价格）'
        : '🟡 常规（利润率尚可；红线更小 = 掉量容忍度低，幅度更小、观察更密）'
      blocks.push(['', `优先级：${prio}`, '', SKU_MONITOR_PLAN.join('\n')].join('\n'))
    }

    emit_result({ ok: true, mode: 'sku-margin', ...res, trigger, text: blocks.join('\n') })
  } catch (e) {
    emit_result({ ok: false, failureKind: 'bad_input', message: e.message, text: e.message })
    process.exit(1)
  }
}

function emit_result(obj) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n')
}

// ══════════════════════════════════════════════════════════════════════
// 兼容层：链接级 API（computeMarginAdvice / evaluateTrigger / renderText）
//
//   SKU 级改造后，pdd-promo / taobao-promo / douyin-uni-prom 三个技能会逐步
//   切到 computeSkuAdvice。此层把旧的链接级调用转成 SKU 级实现（把整个链接
//   当成一个"SKU"算），保证改造期间三个技能不会 import 失败。
//   改造完成后此层可删。
// ══════════════════════════════════════════════════════════════════════
export function computeMarginAdvice({ price, cost, steps = [0.01, 0.02, 0.03, 0.05], netRoi = null }) {
  const r = computeSkuAdvice({ price, cost, steps, netRoi })
  return {
    inputs: r.inputs,
    margin: { ...r.margin, costRatio: round4(Number(cost) / Number(price)) },
    steps: r.steps.map(s => ({
      k: s.k, kPct: s.kPct, newPrice: s.newPrice, newUnitProfit: s.newUnitProfit,
      profitChangePct: s.profitChangePct, equivRevenuePct: s.equivRevenuePct,
      maxVolumeDropPct: s.maxDropPct, revenueGuardDropPct: s.revenueGuardDropPct,
    })),
    roiCheck: r.roiCheck || null,
  }
}

export function evaluateTrigger(o = {}) {
  const t = evaluateSkuTrigger(o)
  return {
    lateStage: t.lateStage,
    hasPromoSpend: true,
    lowMargin: t.lowMargin,
    roiBelowBreakeven: t.roiBelowBreakeven,
    blockedByErrorLabel: t.blockedByErrorLabel,
    priority: t.priority,
    shouldAdvise: t.shouldAdvise,
  }
}

export function renderText(res) {
  return renderSkuText({
    sku: { skuId: null, skuName: null, role: 'unknown' },
    inputs: res.inputs,
    margin: res.margin,
    baseline: { days: 7, avgDailyOrders: null, exposure: null, conversion: null },
    steps: res.steps.map(s => ({
      k: s.k, kPct: s.kPct, newPrice: s.newPrice, newUnitProfit: s.newUnitProfit,
      profitChangePct: s.profitChangePct, equivRevenuePct: s.equivRevenuePct,
      maxDropPct: s.maxVolumeDropPct ?? s.maxDropPct,
      revenueGuardDropPct: s.revenueGuardDropPct,
      floorOrders: s.floorOrders ?? null,
    })),
    plan: null,
    roiCheck: res.roiCheck || null,
    monitor: null,
  })
}
