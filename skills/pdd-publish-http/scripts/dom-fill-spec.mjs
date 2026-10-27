/**
 * DOM 填规格 v3 —— 以 #goods-spec-sku 为锚点，先识别再填。
 *
 * 流程：
 *   ① 打开类目 → 表单页加载
 *   ② 等 #goods-spec-sku 出现
 *   ③ 在 #goods-spec-sku 内扫描所有维度（.property-container-v2）
 *      → 读维度名
 *      → 识别值类型：输入框 / checkbox / 颜色输入框
 *   ④ 用户 specs 按维度名匹配页面维度
 *      - 匹配到 → 按类型填值
 *      - 没匹配到 → 点「添加规格类型」→ 下拉选维度
 *   ⑤ 逐个值填写（输入框键入 / checkbox 勾选）
 *   ⑥ 填 SKU 价格表 + 参考价
 *   ⑦ 提交由调用方做
 */

const SPEC_ROOT = '#goods-spec-sku'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 扫描 #goods-spec-sku 内的所有维度。
 * 返回 [{dim: '颜色分类', type: 'color-input', container: ...}, ...]
 */
async function scanPageSpecs(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return []

    // 维度容器：.property-container-v2
    const containers = [...root.querySelectorAll('.property-container-v2')]
    return containers.map(c => {
      // 维度名
      const titleEl = c.querySelector('.property-name-title')
        || c.querySelector('.sizeStandardWrapper_title__7s9I- span')
        || c.querySelector('.sizeStandardWrapper_title__7s9I-')
      const dim = titleEl ? titleEl.textContent.trim() : ''

      // 判断值类型
      let type = 'unknown'
      const colorInput = c.querySelector('input[placeholder*="主色"]')
      const customInput = c.querySelector('input[placeholder*="自定义"]')
      const checkboxes = c.querySelectorAll('.package-item-container input[type="checkbox"]')

      if (colorInput) type = 'color-input'
      else if (checkboxes.length > 0) type = 'checkbox'
      else if (customInput) type = 'custom-input'
      else {
        // 可能是新添加的维度（规格类型输入框）
        const specTypeInput = c.querySelector('input[placeholder^="规格类型"]')
        if (specTypeInput) type = 'spec-type'
      }

      // 收集 checkbox 值（如果有）
      const checkboxValues = []
      if (type === 'checkbox') {
        c.querySelectorAll('.package-item-container').forEach(item => {
          const text = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
          const cb = item.querySelector('input[type="checkbox"]')
          if (text) checkboxValues.push({ text, checked: cb?.checked || false })
        })
      }

      return { dim, type, checkboxValues, hasContainer: true }
    }).filter(s => s.dim || s.type !== 'unknown')
  }, SPEC_ROOT)
}

/**
 * 维度名模糊匹配。
 */
function matchDim(userDim, pageDims) {
  // 精确
  let hit = pageDims.find(d => d.dim === userDim)
  if (hit) return { matched: true, dim: hit }

  // 包含
  hit = pageDims.find(d => d.dim.includes(userDim) || userDim.includes(d.dim))
  if (hit) return { matched: true, dim: hit }

  // 同类
  const COLOR = /颜色|色|花色|配色/
  const SIZE = /尺码|尺寸|身高|码|大小|参考分类/
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
 * 点「添加规格类型」并从下拉选维度。
 */
async function addNewDim(page, dimName) {
  // 点「添加规格类型」
  await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return
    const btn = [...root.querySelectorAll('button')].find(b => /添加规格类型/.test(b.textContent || ''))
    btn?.click()
  }, SPEC_ROOT)
  await sleep(3000)

  // 点新出现的「规格类型N」输入框打开下拉
  await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return
    const inputs = [...root.querySelectorAll('input')].filter(e => (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0)
    const inp = inputs[inputs.length - 1]
    if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click() }
  }, SPEC_ROOT)
  await sleep(3000)

  // 在下拉里找并点维度名（下拉可能不在 #goods-spec-sku 内，在 body 上）
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
 * 填一个输入框型的值。
 */
async function fillInputValue(page, dimName, idx, value) {
  // 找该维度的值输入框
  // 颜色分类：placeholder 含"主色"
  // 款式/自定义：placeholder 含"自定义{维度名}"
  // 新建维度：placeholder 含"自定义{维度名}"
  const pos = await page.evaluate((sel, dn, i) => {
    const root = document.querySelector(sel)
    if (!root) return null

    // 在所有 property-container-v2 里找匹配维度名的容器
    const containers = [...root.querySelectorAll('.property-container-v2')]
    let target = null
    for (const c of containers) {
      const title = c.querySelector('.property-name-title')?.textContent?.trim()
        || c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
        || ''
      if (title === dn || title.includes(dn) || dn.includes(title)) { target = c; break }
    }
    if (!target) {
      // 兜底：全局找 placeholder 含"自定义{dn}"的输入框
      const inp = [...document.querySelectorAll('input')]
        .filter(e => {
          const ph = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return ph.includes('自定义') && ph.includes(dn) && r.y > 0 && r.width > 30
        })[i]
      if (!inp) return null
      inp.scrollIntoView({ block: 'center' })
      const r = inp.getBoundingClientRect()
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
    }

    // 在目标容器内找值输入框
    const colorInput = target.querySelector('input[placeholder*="主色"]')
    const customInputs = [...target.querySelectorAll('input')].filter(e => {
      const ph = e.placeholder || ''
      return ph.includes('自定义') && !ph.includes('排序') && e.getBoundingClientRect().width > 30
    })

    let el
    if (colorInput && i === 0) el = colorInput
    else if (colorInput) {
      // 颜色分类的第 2+ 个值需要点"添加"按钮
      el = null // 后续处理
    }
    if (!el && customInputs.length) el = customInputs[Math.min(i, customInputs.length - 1)]
    if (!el) return null

    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
  }, SPEC_ROOT, dimName, idx)

  if (!pos) {
    // 可能需要补输入框
    await page.evaluate((sel, dn) => {
      const root = document.querySelector(sel)
      if (!root) return
      const links = [...root.querySelectorAll('a, span, button')]
        .filter(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
      links[0]?.click()
    }, SPEC_ROOT, dimName)
    await sleep(1500)
    // 再找一次
    const pos2 = await page.evaluate((sel, dn, i) => {
      const els = [...document.querySelectorAll('input')]
        .filter(e => {
          const ph = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return ph.includes('自定义') && ph.includes(dn) && r.y > 0 && r.width > 30
        })
      if (!els[i]) return null
      els[i].scrollIntoView({ block: 'center' })
      const r = els[i].getBoundingClientRect()
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
    }, SPEC_ROOT, dimName, idx)
    if (!pos2) return false
    return await typeAndBlur(page, pos2, value)
  }
  return await typeAndBlur(page, pos, value)
}

async function typeAndBlur(page, pos, value) {
  await page.mouse.click(pos.x, pos.y)
  await sleep(300)
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace'); await sleep(50)
  await page.keyboard.type(value, { delay: 50 })
  await sleep(100)
  await page.keyboard.press('Enter')
  await sleep(800)
  await page.keyboard.press('Tab')
  await sleep(300)
  return true
}

/**
 * 填 checkbox 型的值（参考分类：勾选身高值）。
 */
async function fillCheckboxValue(page, dimName, values) {
  for (const val of values) {
    await page.evaluate((sel, v) => {
      const root = document.querySelector(sel)
      if (!root) return false
      // 找 checkbox 文本匹配的
      const items = [...root.querySelectorAll('.package-item-container')]
      let target = null
      // 精确匹配
      for (const item of items) {
        const text = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (text === v) { target = item; break }
      }
      // 去单位匹配（110cm → 110）
      if (!target) {
        const cleanV = v.replace(/(cm|厘米)$/i, '').trim()
        for (const item of items) {
          const text = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
          if (text === cleanV) { target = item; break }
        }
      }
      if (!target) return false
      const cb = target.querySelector('input[type="checkbox"]')
      const label = target.querySelector('label')
      if (cb && !cb.checked) {
        // 点 label 或 checkbox
        label?.click() || cb.click()
      }
      return true
    }, SPEC_ROOT, val)
    await sleep(300)
  }
  return true
}

/**
 * 填 SKU 价格表。
 */
async function fillPriceTable(page, price, stock) {
  const rows = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return []
    const table = root.querySelector('.sku-list table, table')
    if (!table) return []
    const trs = [...table.querySelectorAll('tbody tr')]
    return trs.map(tr => {
      const inputs = [...tr.querySelectorAll('input')]
        .filter(e => e.getBoundingClientRect().width > 20)
        .map(e => ({
          ph: e.placeholder || '',
          x: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2),
          y: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2),
        }))
      return inputs
    })
  }, SPEC_ROOT)

  if (!rows.length) return false

  for (const row of rows) {
    for (const inp of row) {
      if (inp.ph.includes('拼单') || inp.ph.includes('拼团')) {
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(price), { delay: 50 })
        await sleep(100); await page.keyboard.press('Tab'); await sleep(200)
      } else if (inp.ph.includes('单买') || inp.ph.includes('单购')) {
        const single = parseFloat(price) + 1
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(single), { delay: 50 })
        await sleep(100); await page.keyboard.press('Tab'); await sleep(200)
      } else if (inp.ph.includes('库存') || inp.ph === '请输入') {
        await page.mouse.click(inp.x, inp.y)
        await sleep(200)
        await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
        await page.keyboard.press('Backspace'); await sleep(50)
        await page.keyboard.type(String(stock), { delay: 50 })
        await sleep(100); await page.keyboard.press('Tab'); await sleep(200)
      }
    }
  }
  return true
}

/**
 * 主入口。
 */
export async function fillSpecsOnPage(page, specs, defaults = {}) {
  const log = (...a) => console.log('[dom-fill-spec] ' + new Date().toTimeString().slice(0, 8) + ' ' + a.join(' '))

  if (!specs || !specs.length) {
    return { ok: true, skuRows: 0, message: '无规格维度，跳过' }
  }

  const price = defaults.price || '29.9'
  const stock = defaults.stock || '999'

  // ② 等 #goods-spec-sku 出现
  log('② 等 #goods-spec-sku…')
  for (let i = 0; i < 30; i++) {
    await sleep(2000)
    const ready = await page.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)
    if (ready) break
  }

  // ③ 扫描页面维度
  log('③ 扫描页面维度')
  let pageDims = await scanPageSpecs(page)
  log('  页面有: ' + (pageDims.length ? pageDims.map(d => d.dim + '(' + d.type + ')').join(', ') : '无'))

  // ④ 用户 specs 匹配 + 填值
  for (let dimIdx = 0; dimIdx < specs.length; dimIdx++) {
    const userSpec = specs[dimIdx]
    const userDim = userSpec.name
    const userValues = userSpec.values.map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()).filter(Boolean)

    // 每次重新扫描（前一个维度填完后页面变了）
    pageDims = await scanPageSpecs(page)
    log('④[' + (dimIdx + 1) + '/' + specs.length + '] 匹配「' + userDim + '」(' + userValues.length + ' 个值)')
    log('  页面维度: ' + pageDims.map(d => d.dim).join(', '))

    const m = matchDim(userDim, pageDims)

    if (m.matched) {
      log('  → 匹配到页面「' + m.dim.dim + '」type=' + m.dim.type)

      if (m.dim.type === 'checkbox') {
        // checkbox 型（参考分类）：勾选
        log('  → 勾选 ' + userValues.length + ' 个值')
        await fillCheckboxValue(page, m.dim.dim, userValues)
      } else {
        // 输入框型：逐个键入
        log('  → 键入 ' + userValues.length + ' 个值')
        for (let i = 0; i < userValues.length; i++) {
          const ok = await fillInputValue(page, m.dim.dim, i, userValues[i])
          log('  ' + (i + 1) + '. "' + userValues[i] + '" → ' + (ok ? 'OK' : '失败'))
        }
      }
    } else {
      // 没匹配到 → 添加新维度
      log('  → 没匹配到，添加新维度「' + userDim + '」')
      const ok = await addNewDim(page, userDim)
      if (!ok) {
        log('  → 下拉没有「' + userDim + '」')
        return { ok: false, message: '下拉里没有「' + userDim + '」', skuRows: 0 }
      }
      // 重新扫描
      pageDims = await scanPageSpecs(page)
      // 新维度是输入框型
      log('  → 键入 ' + userValues.length + ' 个值')
      for (let i = 0; i < userValues.length; i++) {
        const ok2 = await fillInputValue(page, userDim, i, userValues[i])
        log('  ' + (i + 1) + '. "' + userValues[i] + '" → ' + (ok2 ? 'OK' : '失败'))
      }
    }
  }

  await sleep(2000)

  // ⑥ 填价格表
  log('⑥ 填价格表')
  const priceOk = await fillPriceTable(page, price, stock)
  log('  ' + (priceOk ? '价格表填完' : '⚠ 价格表未找到'))

  // 填参考价
  const refPrice = parseFloat(price) + 20
  const refOk = await page.evaluate((sel, rp) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const inp = root.querySelector('input[placeholder*="大于"]') || root.querySelector('#market_price input')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, String(rp))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
    return true
  }, SPEC_ROOT, refPrice)
  log('  参考价: ' + (refOk ? refPrice : '未找到'))

  // 读 SKU 行数
  const skuRows = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return 0
    const table = root.querySelector('.sku-list table, table')
    if (!table) return 0
    return table.querySelectorAll('tbody tr').length
  }, SPEC_ROOT)
  log('  SKU 行数: ' + skuRows)

  return {
    ok: skuRows > 0,
    skuRows,
    message: 'DOM 填规格完成：' + skuRows + ' 行 SKU' + (priceOk ? '，价格已填' : '，价格未填'),
  }
}
