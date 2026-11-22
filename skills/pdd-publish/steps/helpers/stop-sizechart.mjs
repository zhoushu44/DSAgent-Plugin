/**
 * stop-sizechart.mjs — 停用尺码表（通用）
 *
 * 页面结构（2026-11-15 实测）：
 *   <a data-tracking-click-viewid="disable_size_chart"><span>停用尺码表</span></a>
 *   点后弹确认框：button 内含「确认停用」
 *
 * 三个类目（童装/运动鞋/女装）实测都有此按钮
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 检查页面上有没有「停用尺码表」按钮
 */
export async function hasStopButton(page) {
  return page.evaluate(() => {
    const a = document.querySelector('a[data-tracking-click-viewid="disable_size_chart"]')
    if (!a) return { found: false }
    const r = a.getBoundingClientRect()
    return { found: true, visible: r.width > 0 && r.height > 0, text: (a.innerText || '').replace(/\s+/g, '') }
  }).catch(() => ({ found: false }))
}

/**
 * 停用尺码表
 * @returns {{ok:boolean, skipped?:boolean, reason?:string}}
 */
export async function stopSizeChart(page) {
  const has = await hasStopButton(page)
  if (!has.found) {
    // 没有按钮 = 本来就没有尺码表，视为成功
    return { ok: true, skipped: true, reason: '没有尺码表' }
  }

  // ① 点停用
  const clicked = await page.evaluate(() => {
    const a = document.querySelector('a[data-tracking-click-viewid="disable_size_chart"]')
    if (!a) return false
    a.scrollIntoView({ block: 'center' })
    a.click()
    return true
  }).catch(() => false)
  if (!clicked) return { ok: false, reason: '点不到停用按钮' }

  // ② 等确认框
  let confirm = null
  for (let i = 0; i < 30; i++) {
    confirm = await page.evaluate(() => {
      // 找含「确认停用」的按钮
      for (const b of document.querySelectorAll('button')) {
        const t = (b.innerText || '').replace(/\s+/g, '')
        if (/确认停用/.test(t)) {
          const r = b.getBoundingClientRect()
          return { found: true, visible: r.width > 0 && r.height > 0, text: t }
        }
      }
      return { found: false }
    }).catch(() => ({ found: false }))
    if (confirm.found) break
    await sleep(250)
  }
  if (!confirm?.found) return { ok: false, reason: '没等到「确认停用」按钮' }

  // ③ 点确认
  const confirmed = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.innerText || '').replace(/\s+/g, '')
      if (/确认停用/.test(t)) { b.click(); return true }
    }
    return false
  }).catch(() => false)
  if (!confirmed) return { ok: false, reason: '点不到确认按钮' }

  // ④ 等尺码表消失
  let gone = false
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({
      hasBtn: !!document.querySelector('a[data-tracking-click-viewid="disable_size_chart"]'),
      hasTable: !!document.querySelector('#sizeTable'),
      hasChart: !!document.querySelector('[class*="sizeChart_sizeTable"]'),
    })).catch(() => ({}))
    if (!st.hasBtn) { gone = true; break }
    await sleep(250)
  }

  return { ok: true, gone, reason: gone ? '' : '点确认后按钮仍在（可能未生效）' }
}

export default stopSizeChart
