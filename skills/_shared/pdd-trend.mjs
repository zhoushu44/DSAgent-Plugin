/**
 * PDD 商品趋势分析（基于 *Ppr 上期值）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么用 *Ppr
 * ══════════════════════════════════════════════════════════════════
 *
 * sycm 商品明细接口（queryGoodsDetailVOListForMMS）有**数据延迟**：
 *
 *   goodsUv       = ""        ← 今日数据未生成（空）
 *   goodsUvPpr    = 218       ← 上期值（= 昨日），有数据
 *
 * 实测：今日请求时，17 个当前值字段全空，但 17 个 *Ppr 全有值。
 * 所以趋势分析只能建立在 *Ppr 上。
 *
 * ══════════════════════════════════════════════════════════════════
 * 可做的分析
 * ══════════════════════════════════════════════════════════════════
 *
 * ① 商品分层（访客 / 转化 / 客单价三维）
 * ② 机会识别：低访客但高转化 → 值得投流放量
 * ③ 问题识别：高访客低转化 → 详情页/价格有问题
 * ④ 长尾识别：零访客零支付 → 可下架或重新发布
 * ⑤ 店铺整体健康度
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 单商品指标（*Ppr 口径） */
export function metricsOf(g) {
  const uv = num(g.goodsUvPpr)
  const pv = num(g.goodsPvPpr)
  const payAmt = num(g.payOrdrAmtPpr)
  const payCnt = num(g.payOrdrCntPpr)
  const payUsers = num(g.payOrdrUsrCntPpr)
  const payQty = num(g.payOrdrGoodsQtyPpr)
  const fav = num(g.goodsFavCntPpr)
  const impr = num(g.imprUsrCntPpr)
  const ordrCrtUsr = num(g.ordrCrtUsrCntPpr)
  return {
    goodsId: g.goodsId,
    name: String(g.goodsName || '').slice(0, 40),
    uv, pv, payAmt, payCnt, payUsers, payQty, fav, impr, ordrCrtUsr,
    vcr: uv > 0 ? +(payCnt / uv * 100).toFixed(2) : null,        // 转化率
    ordrVcr: uv > 0 ? +(ordrCrtUsr / uv * 100).toFixed(2) : null, // 下单转化率
    aov: payCnt > 0 ? +(payAmt / payCnt).toFixed(2) : null,      // 客单价
    upv: uv > 0 ? +(pv / uv).toFixed(2) : null,                  // 人均浏览
    favRate: uv > 0 ? +(fav / uv * 100).toFixed(2) : null,       // 收藏率
    cate: [g.cate1Id, g.cate2Id, g.cate3Id].filter(Boolean),
    status: g.goodsStatus,
  }
}

/** 商品分层 */
export function segment(m) {
  if (m.uv === 0 && m.payAmt === 0) return 'dead'          // 死款
  if (m.uv === 0) return 'no-traffic'                      // 有成交但零访客（数据异常或自然单）
  if (m.uv < 20) return 'long-tail'                        // 长尾
  if (m.vcr != null && m.vcr >= 10) return 'star'          // 明星款（高转化）
  if (m.vcr != null && m.vcr < 3) return 'problem'         // 问题款（低转化）
  return 'normal'
}

/**
 * 全店趋势分析
 * @param {Array} goodsList sycm 返回的 goodsDetailList
 */
export function analyze(goodsList) {
  const items = (goodsList || []).map(metricsOf)
  const tot = items.reduce((s, m) => ({
    uv: s.uv + m.uv, pv: s.pv + m.pv,
    payAmt: s.payAmt + m.payAmt, payCnt: s.payCnt + m.payCnt,
    payUsers: s.payUsers + m.payUsers, fav: s.fav + m.fav,
    impr: s.impr + m.impr, ordrCrtUsr: s.ordrCrtUsr + m.ordrCrtUsr,
  }), { uv: 0, pv: 0, payAmt: 0, payCnt: 0, payUsers: 0, fav: 0, impr: 0, ordrCrtUsr: 0 })

  const summary = {
    goodsCount: items.length,
    activeCount: items.filter(m => m.uv > 0).length,
    payingCount: items.filter(m => m.payAmt > 0).length,
    uv: tot.uv, pv: tot.pv,
    payAmt: +tot.payAmt.toFixed(2), payCnt: tot.payCnt,
    vcr: tot.uv > 0 ? +(tot.payCnt / tot.uv * 100).toFixed(2) : null,
    ordrVcr: tot.uv > 0 ? +(tot.ordrCrtUsr / tot.uv * 100).toFixed(2) : null,
    aov: tot.payCnt > 0 ? +(tot.payAmt / tot.payCnt).toFixed(2) : null,
    upv: tot.uv > 0 ? +(tot.pv / tot.uv).toFixed(2) : null,
    favRate: tot.uv > 0 ? +(tot.fav / tot.uv * 100).toFixed(2) : null,
    perGoodsUv: items.length ? +(tot.uv / items.length).toFixed(1) : null,
  }

  // 分层
  const bySeg = { star: [], normal: [], 'long-tail': [], problem: [], dead: [], 'no-traffic': [] }
  for (const m of items) bySeg[segment(m)].push(m)
  for (const k of Object.keys(bySeg)) bySeg[k].sort((a, b) => b.uv - a.uv)

  // 帕累托：多少商品贡献 80% 成交
  const sorted = [...items].sort((a, b) => b.payAmt - a.payAmt)
  let acc = 0, paretoCount = 0
  for (const m of sorted) {
    if (acc >= tot.payAmt * 0.8) break
    acc += m.payAmt
    paretoCount++
  }
  summary.paretoCount = paretoCount
  summary.paretoPct = items.length ? +(paretoCount / items.length * 100).toFixed(1) : null

  // 机会与问题
  const opportunities = []
  const problems = []
  for (const m of items) {
    // 机会：转化 ≥10% 但访客 <50 → 值得投流
    if (m.vcr != null && m.vcr >= 10 && m.uv < 50 && m.uv > 0) {
      opportunities.push({
        goodsId: m.goodsId, name: m.name, type: 'low-traffic-high-conversion',
        uv: m.uv, vcr: m.vcr, aov: m.aov, payAmt: m.payAmt,
        advice: `转化 ${m.vcr}% 但只有 ${m.uv} 访客 → 建议投流放量`,
      })
    }
    // 机会：有成交、转化尚可、客单价高 → 主力款
    if (m.payAmt > 0 && m.vcr != null && m.vcr >= 5 && m.aov != null && m.aov >= 30) {
      opportunities.push({
        goodsId: m.goodsId, name: m.name, type: 'high-value',
        uv: m.uv, vcr: m.vcr, aov: m.aov, payAmt: m.payAmt,
        advice: `客单价 ¥${m.aov} + 转化 ${m.vcr}% → 主力款，优先保曝光`,
      })
    }
    // 问题：访客 ≥50 但转化 <3%
    if (m.uv >= 50 && m.vcr != null && m.vcr < 3) {
      problems.push({
        goodsId: m.goodsId, name: m.name, type: 'high-traffic-low-conversion',
        uv: m.uv, vcr: m.vcr, aov: m.aov, payAmt: m.payAmt,
        advice: `${m.uv} 访客只转化 ${m.vcr}% → 查价格/详情页/评价`,
      })
    }
    // 问题：人均浏览 >3（看得多不走）→ 详情页问题
    if (m.upv != null && m.upv >= 3 && m.uv >= 20 && m.vcr != null && m.vcr < 5) {
      problems.push({
        goodsId: m.goodsId, name: m.name, type: 'high-depth-low-conversion',
        uv: m.uv, upv: m.upv, vcr: m.vcr,
        advice: `人均浏览 ${m.upv} 页但转化仅 ${m.vcr}% → 详情页有硬伤`,
      })
    }
  }

  return { summary, segments: bySeg, opportunities, problems, items }
}

/** 生成可读文本报告 */
export function report(a) {
  const s = a.summary
  const L = []
  L.push('═'.repeat(78))
  L.push('商品趋势分析（上期值口径）')
  L.push('═'.repeat(78))
  L.push('')
  L.push('【店铺整体】')
  L.push(`  商品数        ${s.goodsCount}（有访客 ${s.activeCount}，有成交 ${s.payingCount}）`)
  L.push(`  访客 / 浏览    ${s.uv} / ${s.pv}（人均 ${s.upv} 页）`)
  L.push(`  支付金额      ¥${s.payAmt}（${s.payCnt} 单，客单价 ¥${s.aov}）`)
  L.push(`  转化率        ${s.vcr}%（下单转化 ${s.ordrVcr}%）`)
  L.push(`  收藏率        ${s.favRate}%`)
  L.push(`  帕累托       ${s.paretoCount} 个商品贡献 80% 成交（占 ${s.paretoPct}%）`)
  L.push('')

  const SEG_LABEL = {
    star: '⭐ 明星款（转化 ≥10%）',
    normal: '● 常规款',
    'long-tail': '○ 长尾款（访客 <20）',
    problem: '⚠️ 问题款（转化 <3%）',
    dead: '✗ 死款（零访客零成交）',
    'no-traffic': '? 零访客有成交',
  }
  for (const [k, label] of Object.entries(SEG_LABEL)) {
    const arr = a.segments[k]
    if (!arr?.length) continue
    L.push(`【${label}】${arr.length} 个`)
    for (const m of arr.slice(0, 8)) {
      L.push(`  ${m.name.padEnd(30)} 访客${String(m.uv).padStart(5)} 转化${String(m.vcr ?? '—').padStart(6)}% 客单¥${String(m.aov ?? '—').padStart(7)} 支付¥${String(m.payAmt).padStart(8)}`)
    }
    if (arr.length > 8) L.push(`  …还有 ${arr.length - 8} 个`)
    L.push('')
  }

  if (a.opportunities.length) {
    L.push('【🔥 机会】')
    for (const o of a.opportunities.slice(0, 10)) {
      L.push(`  ${o.name.padEnd(30)} ${o.advice}`)
    }
    L.push('')
  }
  if (a.problems.length) {
    L.push('【🛑 问题】')
    for (const p of a.problems.slice(0, 10)) {
      L.push(`  ${p.name.padEnd(30)} ${p.advice}`)
    }
    L.push('')
  }
  return L.join('\n')
}

// CLI
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const file = process.argv[2] || 'artifacts/pdd-re/goods-final.json'
  if (!fs.existsSync(file)) {
    console.error(`❌ 文件不存在: ${file}`)
    process.exit(1)
  }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const list = Array.isArray(d) ? d : (d.result?.goodsDetailList || d.goods || [])
  console.log(report(analyze(list)))
}
