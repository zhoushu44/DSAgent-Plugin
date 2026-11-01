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
    // ★ 2026-11-01：先滚到视口中央，确保点击坐标不被遮挡
    b.scrollIntoView({ block: 'center' })
    const r = b.getBoundingClientRect()
    const x = Math.round(r.x + r.width / 2)
    const y = Math.round(r.y + r.height / 2)
    // 检查该坐标下的最上层元素是不是这个按钮（或其子孙）
    const top = document.elementFromPoint(x, y)
    const reachable = !!top && (top === b || b.contains(top) || top.closest('button') === b)
    return {
      x, y,
      disabled: b.disabled || /BTN_disabled|disabled/i.test((b.className || '').toString()),
      reachable,
      topTag: top?.tagName || '',
      topCls: (top?.className || '').toString().slice(0, 40),
      text: (b.innerText || '').trim(),
    }
  })
  if (!bp) return { ok: false, errors: ['找不到「提交并上架」按钮'] }
  if (bp.disabled) log('  ⚠ 按钮是 disabled 状态，仍尝试点击')
  if (!bp.reachable) log(`  ⚠ 按钮被遮挡（最上层=${bp.topTag}.${bp.topCls}），仍尝试点击`)

  // ★ 2026-11-01：点击前必须等 goods-loading-contain 遮罩消失
  //   实测：这个全屏 loading 层会吞掉所有点击（mouse.click / dispatchEvent / .click() / Enter 全无效）
  {
    let waited = 0
    for (let w = 0; w < 40; w++) {
      const blocking = await page.evaluate(() => {
        const el = document.querySelector('.goods-loading-contain')
        if (!el) return false
        const r = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        // 可见且有尺寸才算遮挡
        return r.width > 100 && r.height > 100 && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.01
      }).catch(() => false)
      if (!blocking) break
      if (w === 0) log('  ⚠ 检测到 goods-loading-contain 遮罩，等待消失…')
      await sleep(500)
      waited += 500
    }
    if (waited > 0) log(`  遮罩等待 ${waited}ms 后${waited >= 20000 ? '仍存在（继续尝试）' : '已消失'}`)
  }

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

    // ★ 2026-11-01：补点判断严格化
    //   实测踩坑两个方向：
    //     A. 检测太松 → 第 1 次点击后平台已在处理，补点变重复提交 → 「错误（0）」
    //     B. 检测太严 → 页面有无关的 [class*=loading] 元素，被误判成「提交中」
    //        导致永远不补点，而第一次点击其实没生效 → 卡死
    //   正确判据：只认「提交按钮自己」的 disabled/loading 状态，不看全页 loading 元素。
    if (!retried && Date.now() - (deadline - timeoutMs) > 18000) {
      const probe = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find(x => /提交并上架/.test(x.innerText || ''))
        if (!b) return { hasBtn: false }
        const cls = (b.className || '').toString()
        const btnDisabled = b.disabled || /BTN_disabled|disabled/i.test(cls)
        // ★ 2026-11-01：判断「提交中」只看 goods-loading-contain 遮罩（实测这才是真信号）
        const ld = document.querySelector('.goods-loading-contain')
        let covering = false
        if (ld) {
          const lr = ld.getBoundingClientRect()
          const style = window.getComputedStyle(ld)
          covering = lr.width > 100 && lr.height > 100 && style.display !== 'none' && style.visibility !== 'hidden'
        }
        const r = b.getBoundingClientRect()
        return {
          hasBtn: true,
          btnDisabled,
          btnLoading: covering,
          btnText: (b.innerText || '').trim(),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
        }
      }).catch(() => null)

      if (probe && probe.hasBtn && !probe.btnDisabled && !probe.btnLoading) {
        log(`  18s 未跳转，按钮可点（${probe.btnText}），补点一次提交`)
        await page.mouse.click(probe.x, probe.y)
        retried = true
      } else if (probe?.btnDisabled || probe?.btnLoading) {
        log('  提交按钮处于 disabled/loading（平台处理中），不补点')
      } else if (!probe?.hasBtn) {
        log('  找不到提交按钮（可能已跳转），不补点')
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
  if (!title) return null
  // ★ 2026-11-01：加超时保护，避免批量场景下卡死
  let newPage = null
  try {
    newPage = await Promise.race([
      page.browser().newPage(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('newPage timeout')), 10000)),
    ])
  } catch {
    return null
  }
  if (!newPage) return null
  try {
    // ★ 2026-11-01 关键修复：商品列表是 SPA，domcontentloaded 时只有导航栏。
    //   实测：domcontentloaded + 4s 拿到的是「商家后台 | 搜索功能 | 客户端...」导航文本，
    //   列表数据要 networkidle2 + 12s 才渲染出来。
    //   原实现因此永远「查不到新商品」，把成功判成失败。
    await newPage.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 45000 })
    await sleep(12000)
    const found = await newPage.evaluate((wantTitle) => {
      const text = document.body.innerText || ''
      // ★ 2026-11-01 真机格式（商品列表表格）：
      //   行文本形如：「\t | 女童珊瑚绒睡衣... | ID: 1023974144424 | 商品编码: 暂无编码 | ... | 91.98～93.98 | ...」
      //   所以按「ID: 数字」+ 同行标题匹配，不是「商品ID：xxx 商品标题：xxx」
      const norm = s => String(s || '').replace(/\s+/g, '')

      // 逐个表格行找
      const rows = [...document.querySelectorAll('tr, [class*="goods-item"], [class*="table-row"]')]
      for (const row of rows) {
        const rowText = (row.innerText || '')
        const idMatch = rowText.match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
        if (!idMatch) continue
        const cleanRow = rowText.replace(/\n/g, ' ').replace(/\t/g, ' ')
        // 标题 = ID 之前那段最长的文本
        const beforeId = cleanRow.split(/(?:商品)?ID\s*[:：]/)[0] || ''
        let title = ''
        for (const seg of beforeId.split('|')) {
          const t = seg.trim()
          if (t.length > (title?.length || 0) && !/商品信息|批量修改|价格|库存/.test(t)) title = t
        }
        // 也接受整行包含目标标题
        const match = (wantTitle && (
          (title && (norm(title).includes(norm(wantTitle).slice(0, 8)) || norm(wantTitle).includes(norm(title).slice(0, 8))))
          || norm(cleanRow).includes(norm(wantTitle).slice(0, 8))
        ))
        if (match) {
          // 找驳回原因（可能在同一行或紧邻）
          const rejectMatch = rowText.match(/驳回原因[：:]\s*([^\n]+)/)
          // 找价格区间
          const priceMatch = rowText.match(/([\d.]+)\s*[～~]\s*([\d.]+)/)
          return {
            goodsId: idMatch[1],
            title: (title || wantTitle).slice(0, 50),
            status: rejectMatch ? `驳回：${rejectMatch[1].slice(0, 80)}` : '已创建',
            price: priceMatch ? `${priceMatch[1]}~${priceMatch[2]}` : '',
          }
        }
      }

      // 兜底：全文按 ID 序列找
      const ids = [...text.matchAll(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/g)].map(m => m[1])
      const titleNorm = norm(wantTitle).slice(0, 8)
      if (titleNorm && text.includes(wantTitle.slice(0, 8)) && ids.length) {
        // 找标题和 ID 同时出现的位置
        const idx = text.indexOf(wantTitle.slice(0, 8))
        const around = text.slice(Math.max(0, idx - 200), idx + 300)
        const idIn = around.match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
        if (idIn) return { goodsId: idIn[1], title: wantTitle.slice(0, 50), status: '已创建' }
      }
      return null
    }, title).catch(() => null)
    return found ? { ok: true, ...found } : null
  } finally {
    await newPage.close().catch(() => {})
  }
}
