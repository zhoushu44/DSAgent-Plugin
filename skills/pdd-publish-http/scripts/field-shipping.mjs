/**
 * 发布组件 · 运费模板 + 发货与售后
 *
 * 全类目通用（不随类目变化；只有模板名可能因店铺不同）。
 *   · fillShippingAndFreight  发货方式 + 发货时间 + 运费模板
 *
 * 锚点：//div[@id="service.is_default_template_id"] 里的「其他模板」单选 + .template-box-select 下拉
 */
import { jsClick, sleep } from './spec-dims.mjs'

/**
 * @param page
 * @param opts {
 *   deliveryMethod?: '非预售',
 *   deliveryTime?:   '当日发货及揽收',
 *   costTemplate?:   '模板名'（可空 → 用店铺缓存或首个）
 * }
 * @returns { filled: string[], missed: string[] }
 */
export async function fillShippingAndFreight(page, opts = {}) {
  const filled = []
  const missed = []

  const deliveryMethod = opts.deliveryMethod || '非预售'
  const deliveryTime = opts.deliveryTime || '当日发货及揽收'
  const costTemplate = String(opts.costTemplate || '').trim()

  // ① 发货方式（非预售）
  const methodSet = await page.evaluate((txt) => {
    const all = [...document.querySelectorAll('label, span, div')]
      .filter(e => e.offsetParent !== null && (e.innerText || '').trim() === txt)
    if (!all.length) return false
    const inner = all.filter(e => !all.some(o => o !== e && e.contains(o)))
    const t = inner.find(e => e.tagName === 'LABEL') || inner.find(e => e.closest('label')) || inner[0]
    ;(t.closest('label') || t).click()
    return true
  }, deliveryMethod).catch(() => false)
  if (methodSet) filled.push(`发货方式=${deliveryMethod}`)
  else missed.push(`发货方式（未找到「${deliveryMethod}」）`)
  await sleep(600)

  // ② 发货时间
  const timeSet = await page.evaluate((txt) => {
    const all = [...document.querySelectorAll('label, span, div')]
      .filter(e => e.offsetParent !== null && (e.innerText || '').trim() === txt)
    if (!all.length) return false
    const inner = all.filter(e => !all.some(o => o !== e && e.contains(o)))
    const t = inner.find(e => e.tagName === 'LABEL') || inner.find(e => e.closest('label')) || inner[0]
    ;(t.closest('label') || t).click()
    return true
  }, deliveryTime).catch(() => false)
  if (timeSet) filled.push(`发货时间=${deliveryTime}`)
  else missed.push(`发货时间（未找到「${deliveryTime}」）`)
  await sleep(800)

  // ③ 运费模板
  if (costTemplate) {
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
      // 打开下拉
      await page.evaluate(() => {
        document.querySelector('.template-box-select input')?.click()
      }).catch(() => {})
      await sleep(1200)
      // 选模板（精确 → 首个）
      const picked = await page.evaluate((tpl) => {
        const exact = document.evaluate(
          `//ul[@role="listbox"]//li[.//text()="${tpl}"]`,
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue
        if (exact) { exact.click(); return (exact.innerText || '').trim() || true }
        const first = document.evaluate(
          '//ul[@role="listbox"]//li',
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue
        if (first) { first.click(); return (first.innerText || '').trim() || true }
        return false
      }, costTemplate).catch(() => false)
      if (picked) filled.push(`运费模板=${typeof picked === 'string' ? picked : costTemplate}`)
      else missed.push(`运费模板（未找到「${costTemplate}」）`)
    } else {
      missed.push('运费模板（未找到「其他模板」单选项）')
    }
    await sleep(800)
  }

  return { filled, missed }
}

/**
 * 停用尺码表（如果存在）
 * 全类目通用：只有服装类目才有，没有就跳过。
 */
export async function disableSizeChart(page) {
  const found = await page.evaluate(() => {
    let link = document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]')
    if (!link) {
      const st = document.querySelector('#sizeTable')
      if (st) link = st.querySelector('div a')
    }
    if (link) { link.click(); return true }
    return false
  }).catch(() => false)
  if (!found) return false
  await sleep(800)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /确认停用/.test(b.textContent || ''))
    btn?.click()
  }).catch(() => {})
  await sleep(1000)
  return true
}
