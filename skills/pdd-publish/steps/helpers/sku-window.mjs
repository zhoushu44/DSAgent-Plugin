/**
 * sku-window.mjs — 价格库存表「先画一部分、收到通知再补画」的处理
 *
 * 背景（2026-11-26 实测，类目 15021，5 色 × 6 码 = 30 行）：
 *   拼多多发布页的价格库存表在 #sku 里一次只画前 18 行，剩下的行先用空白撑着
 *      div  overflow-y:scroll   内容高 = 总行数 × 行高（30 行 = 2067）
 *        div  padding-bottom = 未画行数 × 行高（12 行 = 827）
 *          table  只有画出来的 18 行
 *   所以 #sku tbody tr 的个数（18）≠ 总行数（30），按「页面上第几行」对位填写会数不够、也填不到后面的行。
 *
 *   让它补画（实测 3/3 可靠，少任何一步都不行）：
 *     ① 滚动区滚到浏览器窗口中间  ② 滚动区滚到中段  ③ 页面上下微滚 30 像素
 *     ④ 给 滚动区 / 上一层 / 再上一层 / window / document 依次发 scroll 事件
 *
 * 行数一次画得下（≤ 18 行）时：没有「未画」的行，ensureAllSkuRowsRendered 直接返回，行为与以前完全一致。
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 当前画出来的行数与总行数（不滚动、不发事件） */
export async function readSkuWindow(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#sku') || document.querySelector('[data-e2e-id="e2e-sku-table"]')
    if (!root) return { found: false, rendered: 0, total: 0 }
    const trs = [...root.querySelectorAll('tbody tr')]
    let total = trs.length
    if (trs[0]) {
      const rowH = trs[0].getBoundingClientRect().height
      let el = trs[0].parentElement
      while (el && el !== document.body) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 5) {
          if (rowH > 0) total = Math.round(el.scrollHeight / rowH)
          break
        }
        el = el.parentElement
      }
    }
    return { found: true, rendered: trs.length, total }
  }).catch(e => ({ found: false, rendered: 0, total: 0, error: String(e.message).slice(0, 120) }))
}

/** 总行数（不滚动页面） */
export async function countSkuRowsAll(page) {
  const w = await readSkuWindow(page)
  return w.found ? w.total : 0
}

/**
 * 让页面把价格库存表的行全部画出来。已经全部画出时什么也不做。
 * @returns {Promise<{ok:boolean, rendered:number, total:number, reason?:string}>}
 */
export async function ensureAllSkuRowsRendered(page, opts = {}) {
  const log = opts.log || (() => { })
  const attempts = opts.attempts || 4
  let w = await readSkuWindow(page)
  if (!w.found) return { ok: false, rendered: 0, total: 0, reason: '找不到价格库存表' + (w.error ? '：' + w.error : '') }

  for (let n = 0; n < attempts && w.rendered < w.total; n++) {
    const info = await page.evaluate(() => {
      const root = document.querySelector('#sku') || document.querySelector('[data-e2e-id="e2e-sku-table"]')
      const tr0 = root?.querySelector('tbody tr')
      if (!tr0) return { err: '表格没有行' }
      let el = tr0.parentElement, scroller = null
      while (el && el !== document.body) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 5) { scroller = el; break }
        el = el.parentElement
      }
      if (!scroller) return { err: '表格没有自己的滚动区' }
      scroller.scrollIntoView({ block: 'center' })
      scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2)
      window.scrollBy(0, 30)
      window.scrollBy(0, -30)
      for (const t of [scroller, scroller.parentElement, scroller.parentElement.parentElement, window, document]) {
        t.dispatchEvent(new Event('scroll', { bubbles: false }))
      }
      const r = scroller.getBoundingClientRect()
      return { scrollTop: Math.round(scroller.scrollTop), 区在窗口: `${Math.round(r.top)}~${Math.round(r.bottom)}`, 窗口高: window.innerHeight }
    }).catch(e => ({ err: String(e.message).slice(0, 80) }))
    await sleep(1500)
    w = await readSkuWindow(page)
    if (!w.found) return { ok: false, rendered: 0, total: 0, reason: '补画后读不到价格库存表' }
    log(`   补画第 ${n + 1} 次：已画 ${w.rendered}/${w.total} 行  ${JSON.stringify(info)}`)
  }

  if (w.rendered < w.total) return { ok: false, rendered: w.rendered, total: w.total, reason: `页面只画出 ${w.rendered}/${w.total} 行，补画失败` }
  // ★ 2026-11-26：这里绝对不能再滚动（实测滚回顶部会让表格收缩回 18 行）
  return { ok: true, rendered: w.rendered, total: w.total }
}
