/**
 * DOM 填规格模块 —— 在发布页面上自动选维度 + 填规格值。
 *
 * 按逆向笔记 pdd_上架HTTP链路完整逆向.md 的正确流程：
 *   ② 页面 DOM 填规格 → 页面 JS 注册 → 平台分配 spec_id
 *   ③ 拦截 edit → 改包只改价/图/名，不碰 spec
 *
 * 关键发现（实测）：
 *   · 「规格类型1」是下拉触发器，点它打开维度选项列表
 *   · 下拉里有 款式/型号/尺寸/容量/口味 等自由维度
 *   · 选完后值输入框的 placeholder 是「自定义{维度名}」（如「自定义款式」）
 *   · 填入值后页面自动建 SKU 行，平台分配 spec_id
 *
 * 用法：
 *   import { fillSpecsOnPage } from './dom-fill-spec.mjs'
 *   await fillSpecsOnPage(page, [
 *     { name: '款式', values: ['14盎司小熊咖啡杯', '12盎司纯白纸杯'] },
 *     { name: '尺寸', values: ['100', '110'] },
 *   ])
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 在发布表单页上填写规格。
 *
 * @param {import('puppeteer').Page} page 已打开发布表单页的 Puppeteer 页面对象
 * @param {Array<{name: string, values: string[]}>} specs 规格维度列表（1~2 个）
 * @returns {Promise<{ok: boolean, skuRows: number, message: string}>}
 */
export async function fillSpecsOnPage(page, specs) {
  const log = (...a) => console.log('[dom-fill-spec] ' + new Date().toTimeString().slice(0, 8) + ' ' + a.join(' '))

  if (!specs || !specs.length) {
    return { ok: true, skuRows: 0, message: '无规格维度，跳过 DOM 填规格' }
  }

  // 等规格区就绪
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const ready = await page.evaluate(() =>
      /商品规格/.test(document.body.innerText)).catch(() => false)
    if (ready) { log('规格区就绪'); break }
  }

  for (let dimIdx = 0; dimIdx < specs.length; dimIdx++) {
    const { name: dimName, values } = specs[dimIdx]
    log(`维度 ${dimIdx + 1}/${specs.length}: 「${dimName}」(${values.length} 个值)`)

    // ① 点「添加规格类型」
    if (dimIdx > 0 || await page.evaluate(() =>
      [...document.querySelectorAll('input')].filter(e =>
        (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0
      ).length === 0
    )) {
      log('  点「添加规格类型」')
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('button, a, span, div')]
          .filter(e => {
            const t = (e.textContent || '').trim()
            return t === '添加规格类型' || (t.includes('添加规格') && t.length <= 10)
          })
        els[0]?.click()
      })
      await sleep(3000)
    }

    // ② 点「规格类型N」打开下拉
    log('  打开维度下拉')
    await page.evaluate((idx) => {
      const inputs = [...document.querySelectorAll('input')]
        .filter(e => (e.placeholder || '').startsWith('规格类型'))
        .filter(e => e.getBoundingClientRect().y > 0)
      const inp = inputs[idx]
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click() }
    }, dimIdx)
    await sleep(3000)

    // ③ 在下拉里找并点维度名
    log(`  选「${dimName}」`)
    const picked = await page.evaluate((name) => {
      const cands = [...document.querySelectorAll('li, div, span, a')]
        .filter(e => {
          const txt = (e.textContent || '').trim()
          if (txt !== name) return false
          const r = e.getBoundingClientRect()
          return r.width > 10 && r.height > 8 && r.y > 400
        })
      if (!cands.length) return false
      const r = cands[cands.length - 1].getBoundingClientRect()
      cands[cands.length - 1].click()
      return true
    }, dimName)

    if (!picked) {
      return { ok: false, skuRows: 0, message: `下拉里没找到「${dimName}」` }
    }
    await sleep(3000)
    log('  已选中')

    // ④ 填规格值 — placeholder 是「自定义{dimName}」
    for (let valIdx = 0; valIdx < values.length; valIdx++) {
      const val = values[valIdx]

      // 检查当前有几个值输入框
      const cnt = await page.evaluate((dn) => {
        return [...document.querySelectorAll('input')].filter(e => {
          const ph = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return ph.includes('自定义') && ph.includes(dn) && r.y > 0 && r.width > 30
        }).length
      }, dimName)

      // 如果不够，点「添加定制规格」
      if (cnt <= valIdx) {
        log('  补输入框')
        await page.evaluate(() => {
          [...document.querySelectorAll('a, span')]
            .filter(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
            [0]?.click()
        })
        await sleep(1500)
      }

      // 找第 valIdx 个值输入框
      const pos = await page.evaluate((dn, idx) => {
        const els = [...document.querySelectorAll('input')].filter(e => {
          const ph = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return ph.includes('自定义') && ph.includes(dn) && r.y > 0 && r.width > 30
        })
        if (!els[idx]) return null
        els[idx].scrollIntoView({ block: 'center' })
        const r = els[idx].getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, dimName, valIdx)

      if (!pos) { log(`  ${valIdx + 1}. 找不到输入框`); continue }

      // 用 CDP 真实键盘输入
      await page.mouse.click(pos.x, pos.y)
      await sleep(300)
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await sleep(50)
      await page.keyboard.type(val, { delay: 50 })
      await sleep(400)

      // 读回验证
      const actual = await page.evaluate((dn, idx) => {
        const els = [...document.querySelectorAll('input')].filter(e => {
          const ph = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return ph.includes('自定义') && ph.includes(dn) && r.y > 0 && r.width > 30
        })
        return els[idx]?.value
      }, dimName, valIdx)
      log(`  ${valIdx + 1}. "${val}" → "${actual}"`)
    }
  }

  await sleep(3000)

  // ⑤ 读回 SKU 行数
  const skuRows = await page.evaluate(() => {
    for (const tb of document.querySelectorAll('table')) {
      if (/拼单价|库存/.test(tb.innerText)) {
        const rows = tb.querySelectorAll('tbody tr').length
        if (rows) return rows
      }
    }
    return 0
  })

  log(`SKU 行数: ${skuRows}`)

  if (skuRows > 1) {
    log('✅ 页面已建规格，平台已分配 spec_id')
    return { ok: true, skuRows, message: `DOM 填规格成功，${skuRows} 行 SKU` }
  } else if (skuRows === 1 && specs.every(s => s.values.length === 1)) {
    log('✅ 单规格商品，1 行 SKU')
    return { ok: true, skuRows: 1, message: 'DOM 填规格成功（单规格）' }
  } else {
    log('⚠ SKU 行数偏少，可能需要更多时间')
    await sleep(5000)
    const skuRows2 = await page.evaluate(() => {
      for (const tb of document.querySelectorAll('table')) {
        if (/拼单价|库存/.test(tb.innerText)) {
          const rows = tb.querySelectorAll('tbody tr').length
          if (rows) return rows
        }
      }
      return 0
    })
    log(`再查 SKU 行数: ${skuRows2}`)
    return { ok: skuRows2 > 0, skuRows: skuRows2, message: skuRows2 > 0 ? 'DOM 填规格成功' : 'SKU 行数异常' }
  }
}
