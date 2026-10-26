/**
 * DOM 填规格 v2 —— 顺着页面自然流程走。
 *
 * 7 步流程（用户提出）：
 *   ① 打开类目 → 表单页加载
 *   ② 等任意规格容器出现（不等"颜色分类"）
 *   ③ 读页面上实际有哪些预置行（颜色分类？款式？尺码？）
 *   ④ 用户传的 specs 按维度名匹配页面上的行
 *      - 匹配到 → 直接往那行填值
 *      - 没匹配到 → 点「添加规格类型」→ 从下拉选最接近的
 *   ⑤ 逐个值：键入 → 失焦 → 等平台分配 spec_id
 *   ⑥ 价格表自动生成 → 逐行填价
 *   ⑦ 点提交 → 页面自己加密 → 落库
 *
 * ★ 全类目通用：不预设维度名，读页面有什么就填什么。
 *   不同类目预置不同维度（纸杯有容量，童装有尺码），
 *   这个方案天然适配。
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 读页面上的规格维度行。
 * 返回 [{dim: '款式', y: 500, values: [{placeholder: '自定义款式', y: 550, x: 400, val: ''}]}]
 */
async function readPageSpecs(page) {
  return page.evaluate(() => {
    // 规格类型输入框（维度名）
    const typeInputs = [...document.querySelectorAll('input')]
      .filter(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return ph.startsWith('规格类型') && r.y > 0 && r.width > 30
      })
      .map(el => ({
        dim: el.value || '',
        y: Math.round(el.getBoundingClientRect().y),
        x: Math.round(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2),
      }))
      .filter(o => o.dim)
      .sort((a, b) => a.y - b.y)

    // 值输入框（placeholder 含"自定义"）
    const valInputs = [...document.querySelectorAll('input')]
      .filter(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
      })
      .map(el => ({
        ph: el.placeholder || '',
        val: el.value || '',
        y: Math.round(el.getBoundingClientRect().y),
        x: Math.round(el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2),
      }))
      .sort((a, b) => a.y - b.y)

    // 按维度分组
    return typeInputs.map((ty, i) => {
      const nextY = typeInputs[i + 1]?.y ?? 1e9
      return {
        dim: ty.dim,
        y: ty.y,
        x: ty.x,
        values: valInputs.filter(v => v.y > ty.y - 40 && v.y < nextY - 40),
      }
    })
  })
}

/**
 * 维度名模糊匹配（用户传的 → 页面上有的）
 */
function matchDim(userDim, pageDims) {
  // 精确
  let hit = pageDims.find(d => d.dim === userDim)
  if (hit) return { matched: true, dim: hit }

  // 包含
  hit = pageDims.find(d => d.dim.includes(userDim) || userDim.includes(d.dim))
  if (hit) return { matched: true, dim: hit }

  // 同类（颜色类/尺码类/款式类）
  const COLOR = /颜色|色|花色|配色/
  const SIZE = /尺码|尺寸|身高|码|大小/
  const STYLE = /款式|型号|规格|样式|版型|风格|系列/
  const cat = (n) => COLOR.test(n) ? 'color' : SIZE.test(n) ? 'size' : STYLE.test(n) ? 'style' : 'other'
  const uc = cat(userDim)
  if (uc !== 'other') {
    hit = pageDims.find(d => cat(d.dim) === uc)
    if (hit) return { matched: true, dim: hit }
  }

  return { matched: false }
}

/**
 * 从下拉里选维度。
 */
async function pickDimFromDropdown(page, dimName) {
  // 点「添加规格类型」
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, span, div')]
      .filter(e => {
        const t = (e.textContent || '').trim()
        return t === '添加规格类型' || (t.includes('添加规格') && t.length <= 10)
      })
    els[0]?.click()
  })
  await sleep(3000)

  // 点「规格类型N」打开下拉（最后新增的那个）
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')]
      .filter(e => (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0)
    const inp = inputs[inputs.length - 1]
    if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click() }
  })
  await sleep(3000)

  // 找并点维度名
  const picked = await page.evaluate((name) => {
    const cands = [...document.querySelectorAll('li, div, span, a')]
      .filter(e => {
        const txt = (e.textContent || '').trim()
        if (txt !== name) return false
        const r = e.getBoundingClientRect()
        return r.width > 10 && r.height > 8 && r.y > 400
      })
    if (!cands.length) return false
    cands[cands.length - 1].click()
    return true
  }, dimName)
  await sleep(3000)
  return picked
}

/**
 * 填一个规格值到指定维度的第 idx 个输入框。
 */
async function fillValue(page, dimObj, idx, value) {
  // 检查够不够
  const cnt = dimObj.values.length
  if (cnt <= idx) {
    // 补输入框
    await page.evaluate(() => {
      [...document.querySelectorAll('a, span')]
        .filter(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
        [0]?.click()
    })
    await sleep(1500)
    // 重新读维度
    const specs = await readPageSpecs(page)
    const dim = specs.find(d => d.dim === dimObj.dim)
    if (dim) dimObj = dim
  }

  if (!dimObj.values[idx]) return false

  const pos = { x: dimObj.values[idx].x, y: dimObj.values[idx].y }
  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace'); await sleep(50)
  await page.keyboard.type(value, { delay: 50 })
  await sleep(100)
  // 失焦 → 触发平台注册 spec_id
  await page.keyboard.press('Tab')
  await sleep(800)

  return true
}

/**
 * 填价格表。
 */
async function fillPriceTable(page, price, stock) {
  const rows = await page.evaluate(() => {
    const out = []
    for (const tb of document.querySelectorAll('table')) {
      if (!/拼单价|库存/.test(tb.innerText)) continue
      const trs = [...tb.querySelectorAll('tbody tr')]
      for (const tr of trs) {
        const inputs = [...tr.querySelectorAll('input')]
          .filter(e => e.getBoundingClientRect().width > 20)
          .map(e => ({
            ph: e.placeholder || '',
            x: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2),
            y: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2),
          }))
        if (inputs.length) out.push(inputs)
      }
      if (out.length) break
    }
    return out
  })

  if (!rows.length) return false

  for (const row of rows) {
    for (const inp of row) {
      if (inp.ph.includes('拼单') || inp.ph.includes('拼团')) {
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(price), { delay: 50 })
        await sleep(100)
        await page.keyboard.press('Tab')
        await sleep(200)
      } else if (inp.ph.includes('单买') || inp.ph.includes('单购')) {
        const single = parseFloat(price) + 1
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(single), { delay: 50 })
        await sleep(100)
        await page.keyboard.press('Tab')
        await sleep(200)
      } else if (inp.ph.includes('库存') || inp.ph === '') {
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(stock), { delay: 50 })
        await sleep(100)
        await page.keyboard.press('Tab')
        await sleep(200)
      }
    }
  }
  return true
}

/**
 * 主入口：在页面上填规格 + 价格，然后让页面自然提交。
 *
 * @param {import('puppeteer').Page} page 已打开表单页
 * @param {Array<{name: string, values: Array<{value: string, image?: string}>}>} specs
 * @param {{price: string, stock: string}} defaults
 * @returns {Promise<{ok: boolean, message: string, skuRows: number}>}
 */
export async function fillSpecsOnPage(page, specs, defaults = {}) {
  const log = (...a) => console.log('[dom-fill-spec] ' + new Date().toTimeString().slice(0, 8) + ' ' + a.join(' '))

  if (!specs || !specs.length) {
    return { ok: true, skuRows: 0, message: '无规格维度，跳过' }
  }

  const price = defaults.price || '29.9'
  const stock = defaults.stock || '999'

  // ② 等任意规格容器出现
  log('② 等规格区…')
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const ready = await page.evaluate(() => /商品规格|添加规格类型/.test(document.body.innerText)).catch(() => false)
    if (ready) break
  }

  // ③ 读页面实际有哪些预置行
  log('③ 读页面预置维度')
  let pageSpecs = await readPageSpecs(page)
  log('  页面有: ' + (pageSpecs.length ? pageSpecs.map(s => s.dim + '(' + s.values.length + ')').join(', ') : '无'))

  // ④ 用户 specs 匹配页面行
  for (const userSpec of specs) {
    const userDim = userSpec.name
    const userValues = userSpec.values.map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()).filter(Boolean)

    log('④ 匹配「' + userDim + '」')
    const m = matchDim(userDim, pageSpecs)

    let targetDim
    if (m.matched) {
      log('  → 匹配到页面「' + m.dim.dim + '」，直接填')
      targetDim = m.dim
    } else {
      log('  → 没匹配到，添加新维度「' + userDim + '」')
      const ok = await pickDimFromDropdown(page, userDim)
      if (!ok) {
        // 下拉没有这个名字，用最接近的
        log('  → 下拉没有「' + userDim + '」，找最接近的')
        // 这里可以加更智能的匹配逻辑
        return { ok: false, message: '下拉里没有「' + userDim + '」' , skuRows: 0 }
      }
      // 重新读页面
      pageSpecs = await readPageSpecs(page)
      targetDim = pageSpecs.find(d => d.dim === userDim)
      if (!targetDim) {
        log('  → 添加后仍找不到')
        return { ok: false, message: '添加「' + userDim + '」失败', skuRows: 0 }
      }
    }

    // ⑤ 逐个值：键入 → 失焦 → 等平台分配 spec_id
    log('⑤ 填 ' + userValues.length + ' 个值')
    for (let i = 0; i < userValues.length; i++) {
      const ok = await fillValue(page, targetDim, i, userValues[i])
      if (!ok) {
        log('  ' + (i + 1) + '. 失败')
      } else {
        log('  ' + (i + 1) + '. "' + userValues[i] + '"')
      }
    }

    // 重新读，更新 pageSpecs（因为填值后页面可能变化）
    pageSpecs = await readPageSpecs(page)
  }

  await sleep(2000)

  // ⑥ 价格表自动生成 → 逐行填价
  log('⑥ 填价格表')
  const priceOk = await fillPriceTable(page, price, stock)
  if (priceOk) {
    log('  价格表填完')
  } else {
    log('  ⚠ 价格表未找到')
  }

  // 读 SKU 行数
  const skuRows = await page.evaluate(() => {
    for (const tb of document.querySelectorAll('table')) {
      if (/拼单价|库存/.test(tb.innerText)) {
        const rows = tb.querySelectorAll('tbody tr').length
        if (rows) return rows
      }
    }
    return 0
  })
  log('  SKU 行数: ' + skuRows)

  // ⑦ 提交由调用方做（模式2改包或自然提交）
  // 这里只负责填规格和价格，不点提交

  return {
    ok: skuRows > 0,
    skuRows,
    message: 'DOM 填规格完成：' + skuRows + ' 行 SKU' + (priceOk ? '，价格已填' : '，价格未填'),
  }
}
