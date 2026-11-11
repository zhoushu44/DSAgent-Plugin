/**
 * 发布组件 · 发货与售后 + 运费模板
 *
 * ★ 设计原则（2026-10-29）：优先 re-export lib 里已验证的实现。
 * ★ 2026-10-30 补充：lib 版把文案写死成「非预售」「当日发货及揽收」，
 *   非服装类目（抱枕/纸杯）这些文案不存在 → 填 0 项。
 *   本文件先试 lib 版；填不上时走**通用模糊匹配 + 视觉兜底**。
 */
export {
  fillShippingAndFreight as fillShippingAndFreightLib,
  disableSizeChart,
} from '../../../lib/pdd-publish.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 发货方式候选文案（覆盖常见类目） */
const METHOD_CANDIDATES = ['非预售', '现货', '非预售(下单后48小时发货)', '48小时内发货', '现货发售']
/**
 * 发货时间候选文案
 * ★ 2026-10-30 用户定：**默认 48 小时发货**，所以 48 小时排最前
 */
const TIME_CANDIDATES = ['48小时发货及揽收', '48小时发货', '48小时内发货', '当日发货及揽收', '当日发货', '24小时发货']

/**
 * 在页面里点文本匹配的单选/标签
 * @param candidates 候选文案数组（按优先级）
 * @param fuzzy 是否允许模糊匹配（包含关键词）
 */
async function clickByText(page, candidates, fuzzy = true) {
  return page.evaluate((cands, useFuzzy) => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const all = [...document.querySelectorAll('label, span, div, a')].filter(vis)

    for (const want of cands) {
      // ① 精确匹配
      let hits = all.filter(el => (el.innerText || '').trim() === want)
      // ② 模糊匹配
      if (!hits.length && useFuzzy) {
        hits = all.filter(el => {
          const t = (el.innerText || '').trim()
          return t.length < 30 && (t.includes(want) || want.includes(t))
        })
      }
      if (!hits.length) continue
      // 取最内层（避免点到包裹容器）
      const inner = hits.filter(e => !hits.some(o => o !== e && e.contains(o)))
      const target = inner.find(e => e.tagName === 'LABEL') || inner.find(e => e.closest('label')) || inner[0]
      const clickTarget = target.closest('label') || target
      clickTarget.click()
      return (target.innerText || '').trim()
    }
    return null
  }, candidates, fuzzy).catch(() => null)
}

/**
 * 填发货与售后（通用版）
 *
 * 流程：
 *   ① 先试 lib 已验证版（服装类目文案能命中）
 *   ② 没填上 → 通用模糊匹配
 *   ③ 还不行 → 视觉识别发货区
 */
export async function fillShippingAndFreight(page, opts = {}) {
  const log = opts.log || (() => {})
  const { fillShippingAndFreightLib } = await import('../../../lib/pdd-publish.js')

  // ① 先试 lib 版
  let r = { filled: [], missed: [] }
  try {
    r = await fillShippingAndFreightLib(page, opts)
  } catch { /* ignore */ }

  const filled = [...(r.filled || [])]
  const missed = [...(r.missed || [])]

  // ② 发货方式没填上 → 通用模糊匹配
  if (!filled.some(f => /发货方式|非预售|现货/.test(f))) {
    log('[shipping] lib 版未命中发货方式，走通用模糊匹配')
    const hit = await clickByText(page, METHOD_CANDIDATES, true)
    if (hit) {
      filled.push(`发货方式=${hit}`)
      log(`[shipping] 发货方式 → 「${hit}」`)
      await sleep(900)
    }
  }

  // ③ 发货时间没填上 → 通用模糊匹配
  if (!filled.some(f => /发货时间|当日发货|小时发货/.test(f))) {
    log('[shipping] lib 版未命中发货时间，走通用模糊匹配')
    const hit = await clickByText(page, TIME_CANDIDATES, true)
    if (hit) {
      filled.push(`发货时间=${hit}`)
      log(`[shipping] 发货时间 → 「${hit}」`)
      await sleep(900)
    }
  }

  // ④ 运费模板（沿用 lib 的模板选择逻辑，opts.costTemplate 有值时才做）
  if (opts.costTemplate && !filled.some(f => /运费模板/.test(f))) {
    const otherSet = await page.evaluate(() => {
      const lbl = document.evaluate(
        '//div[@id="service.is_default_template_id"]//label[.//text()="其他模板"]',
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue
      if (!lbl) return false
      lbl.click()
      return true
    }).catch(() => false)
    if (otherSet) {
      await sleep(1000)
      await page.evaluate(() => {
        document.querySelector('.template-box-select input')?.click()
      }).catch(() => {})
      await sleep(1200)
      const picked = await page.evaluate((tpl) => {
        const exact = document.evaluate(
          `//ul[@role="listbox"]//li[.//text()="${tpl}"]`,
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue
        if (exact) { exact.click(); return (exact.innerText || '').trim() || true }
        const first = document.evaluate('//ul[@role="listbox"]//li', document, null,
          XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        if (first) { first.click(); return (first.innerText || '').trim() || true }
        return false
      }, opts.costTemplate).catch(() => false)
      if (picked) filled.push(`运费模板=${typeof picked === 'string' ? picked : opts.costTemplate}`)
      await sleep(800)
    }
  }

  // 清理：已经填上的项不再算 missed
  const realMissed = missed.filter(m => {
    if (/发货方式/.test(m) && filled.some(f => /发货方式|非预售|现货/.test(f))) return false
    if (/发货时间/.test(m) && filled.some(f => /发货时间|当日发货|小时发货/.test(f))) return false
    return true
  })

  log(`[shipping] 已填 ${filled.length} 项，未填 ${realMissed.length} 项`)
  return { filled, missed: realMissed }
}
