// ★ 2026-11-05：页面 URL 从基座注册表取
const { pageUrl: _purl } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-api.mjs')
const GOODS_ADD_URL = _purl('page.goodsAdd')
const GOODS_LIST_URL = _purl('page.goodsList')
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

  // ★ 2026-10-31 重要修复：`错误（0）` = **没有错误**，商品可能已提交成功但页面未跳转。
  //   实测毛巾：提交后停在同一页，弹窗显示「错误（0）| 建议 | 商品属性 填写属性，获取流量」，
  //   但商品列表里确实出现了新商品（1023496708207，因内容问题被驳回）。
  //   所以「错误（0）」时必须再查一次商品列表确认。
  const errCount = await page.evaluate(() => {
    const m = (document.body?.innerText || '').match(/错误（(\d+)）/)
    return m ? parseInt(m[1], 10) : 0
  }).catch(() => 0)

  if (errCount === 0) {
    // 查商品列表最近商品，看是否创建成功
    log('  错误（0）：页面未跳转但无校验错误，查商品列表确认…')
    const check = await verifyCreatedInList(page, opts).catch(() => null)
    if (check?.ok) {
      log(`  ✅ 商品已创建 goods_id=${check.goodsId}${check.status ? `（${check.status}）` : ''}`)
      return { ok: true, goodsId: check.goodsId, url: finalUrl, errors: [], note: check.status }
    }
    log('  ⚠ 商品列表未找到新商品，判定为未成功')
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

/**
 * 查商品列表，确认商品是否创建成功
 * @returns { ok, goodsId, status }
 */
async function verifyCreatedInList(page, opts = {}) {
  const title = String(opts.productTitle || opts.title || '').trim()
  const newPage = await page.browser().newPage().catch(() => null)
  if (!newPage) return null
  try {
    await newPage.goto(GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(4000)
    const found = await newPage.evaluate((wantTitle) => {
      const text = document.body.innerText || ''
      // 找「商品ID：xxx」+「商品标题：xxx」的组合
      const m = text.match(/商品ID\s*[：:]\s*(\d+)\s*商品标题\s*[：:]\s*([^\n]+)/g) || []
      for (const line of m) {
        const idMatch = line.match(/商品ID\s*[：:]\s*(\d+)/)
        const titleMatch = line.match(/商品标题\s*[：:]\s*([^\n]+)/)
        if (!idMatch) continue
        const t = (titleMatch?.[1] || '').trim()
        // 标题前 8 个字匹配即可
        if (wantTitle && t && (t.includes(wantTitle.slice(0, 8)) || wantTitle.includes(t.slice(0, 8)))) {
          // 找该商品的状态/驳回原因
          const idx = text.indexOf(line)
          const after = text.slice(idx, idx + 400)
          const rejectMatch = after.match(/驳回原因[：:]\s*([^\n]+)/)
          return {
            goodsId: idMatch[1],
            title: t,
            status: rejectMatch ? `驳回：${rejectMatch[1].slice(0, 80)}` : '已创建',
          }
        }
      }
      return null
    }, title).catch(() => null)
    return found ? { ok: true, ...found } : null
  } finally {
    await newPage.close().catch(() => {})
  }
}
