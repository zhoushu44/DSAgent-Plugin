/**
 * 发布组件 · 提交（点「提交并上架」+ 判定结果）
 *
 * 从已验证的 test_components.mjs 抽取，并补上错误诊断。
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 点提交并判定结果
 * @param page 表单页
 * @param opts { log?, timeoutMs? }
 * @returns { ok, goodsId, url, errors, panelText }
 */
export async function submitAndVerify(page, opts = {}) {
  const log = opts.log || (() => {})
  const timeoutMs = opts.timeoutMs || 30000

  log('点提交…')

  const bp = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /提交并上架/.test(x.innerText || ''))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled }
  })
  if (!bp) return { ok: false, errors: ['找不到「提交并上架」按钮'] }
  if (bp.disabled) log('  ⚠ 按钮是 disabled 状态，仍尝试点击')

  await page.mouse.click(bp.x, bp.y)

  // 轮询等成功页或**真实错误**出现
  // ★ 注意：页面上常有「错误（0）」字样（表示无错误），不能当成失败信号
  const deadline = Date.now() + timeoutMs
  let lastUrl = ''
  let retried = false
  while (Date.now() < deadline) {
    await sleep(1000)
    lastUrl = String(page.url() || '')
    if (/goods_add\/success/.test(lastUrl)) break
    // 只有「错误（N）」且 N > 0 才算真错误
    const errCount = await page.evaluate(() => {
      const m = (document.body?.innerText || '').match(/错误（(\d+)）/)
      return m ? parseInt(m[1], 10) : 0
    }).catch(() => 0)
    if (errCount > 0) break

    // ★ 兜底：过了 15 秒还在同一页且无错误 → 可能第一次点击没生效，再点一次
    if (!retried && Date.now() - (deadline - timeoutMs) > 15000) {
      const again = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /提交并上架/.test(x.innerText || ''))
        if (!b) return null
        const r = b.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }).catch(() => null)
      if (again) {
        log('  15s 未跳转，补点一次提交')
        await page.mouse.click(again.x, again.y)
        retried = true
      }
    }
  }

  const finalUrl = String(page.url() || '')
  const goodsId = (finalUrl.match(/goods_id=(\d+)/) || [])[1] || ''

  if (/goods_add\/success/.test(finalUrl)) {
    log(`  ✅ 上架成功 goods_id=${goodsId}`)
    return { ok: true, goodsId, url: finalUrl, errors: [] }
  }

  // 失败：抓错误详情
  const diag = await page.evaluate(() => {
    const bodyText = document.body?.innerText || ''
    const errs = (bodyText.match(/错误（\d+）/g) || []).slice(0, 3)
    // 「商品填写建议」面板
    const panel = [...document.querySelectorAll('div')]
      .find(d => /商品填写建议/.test(d.innerText || '') && d.innerText.length < 1200)
    return {
      errors: errs,
      panelText: (panel?.innerText || '').replace(/\n+/g, ' | ').slice(0, 600),
      url: location.href,
    }
  }).catch(() => ({ errors: [], panelText: '', url: finalUrl }))

  log(`  ⚠ 未跳成功页`)
  if (diag.errors?.length) log(`  错误: ${JSON.stringify(diag.errors)}`)
  if (diag.panelText) log(`  填写建议: ${diag.panelText}`)

  return { ok: false, goodsId, url: finalUrl, errors: diag.errors || [], panelText: diag.panelText }
}
