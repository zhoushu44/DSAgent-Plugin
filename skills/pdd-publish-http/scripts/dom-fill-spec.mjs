/**
 * DOM 填规格 v4 —— 全类目通用，预置/一维/二维兼容。
 *
 * 实测跑通（2026-10-27）：
 *   童装（童装/婴儿装/亲子装 > 套装 > 套装）：
 *     预置 颜色分类(color-input) + 参考分类(checkbox)
 *     填 2 个自定义颜色 + 勾 2 个尺码 → #sku 表自动生成 4 行
 *     4 行价格库存全填成功
 *   纸杯（餐饮具 > 纸杯）：
 *     预置 容量(custom-input)
 *
 * 关键 DOM 锚点：
 *   规格根节点：#goods-spec-sku
 *   维度容器：.property-container-v2
 *   维度名：.property-name-title / .sizeStandardWrapper_title__7s9I- / input[placeholder^="规格类型"]
 *   值输入框：
 *     · 颜色：input[placeholder*="主色"]
 *     · 自定义：input[placeholder*="自定义"][placeholder*="{维度名}"]
 *   勾选值：.package-item-container 内 input[type=checkbox] + .check-wrapper 文本
 *   SKU 表格：#sku table tbody tr（表头含 库存/拼单价/单买价）
 *   参考价：#goods-spec-sku input[placeholder*="大于"]
 *   添加规格类型：#goods-spec-sku 内 button[含"添加规格类型"]
 *
 * 三种填值路径：
 *   A. 预置维度直接填（颜色输入框 / 自定义输入框 / checkbox 勾选）
 *   B. 预置维度不存在 → 点「添加规格类型」→ 下拉选维度 → 填值
 *   C. 单维（只有 1 个维度）
 */

const SPEC_ROOT = '#goods-spec-sku'
const SKU_TABLE = '#sku table'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ─────────── ① 识别：扫描规格根节点内所有维度 ─────────── */
async function scanDims(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return { found: false, dims: [] }
    const dims = []
    root.querySelectorAll('.property-container-v2').forEach((c, ci) => {
      const title = c.querySelector('.property-name-title')?.textContent?.trim()
        || c.querySelector('.sizeStandardWrapper_title__7s9I- span')?.textContent?.trim()
        || c.querySelector('.sizeStandardWrapper_title__7s9I-')?.textContent?.trim()
        || c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
        || '(未命名' + ci + ')'
      const colorInput = c.querySelector('input[placeholder*="主色"]')
      const customInputs = [...c.querySelectorAll('input')].filter(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
      })
      const cbItems = [...c.querySelectorAll('.package-item-container')]
      const addCustomBtn = !![...c.querySelectorAll('a, span, button')]
        .find(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
      dims.push({
        idx: ci,
        dim: title,
        type: colorInput ? 'color-input'
          : (cbItems.length ? 'checkbox'
            : (customInputs.length ? 'custom-input'
              : (c.querySelector('input[placeholder^="规格类型"]') ? 'spec-type' : 'unknown'))),
        colorInputCount: colorInput ? [...c.querySelectorAll('input[placeholder*="主色"]')].length : 0,
        customInputPhs: customInputs.map(e => e.placeholder),
        addCustomBtn,
        cbCount: cbItems.length,
      })
    })
    const skuTable = root.querySelector('#sku table')
    return {
      found: true,
      dims,
      skuRows: skuTable ? skuTable.querySelectorAll('tbody tr').length : 0,
      hasAddBtn: !![...root.querySelectorAll('button')].find(b => /添加规格类型/.test(b.textContent || '')),
    }
  }, SPEC_ROOT)
}

/* ─────────── ② 维度名匹配（用户维度 → 页面维度） ─────────── */
function matchDim(userDim, dims) {
  let hit = dims.find(d => d.dim === userDim)
  if (hit) return hit
  hit = dims.find(d => d.dim.includes(userDim) || userDim.includes(d.dim))
  if (hit) return hit
  const COLOR = /颜色|色|花色|配色/
  const SIZE = /尺码|尺寸|身高|码|大小|参考分类/
  const STYLE = /款式|型号|规格|样式|版型|风格|系列|口味|容量|重量/
  const cat = n => COLOR.test(n) ? 'color' : SIZE.test(n) ? 'size' : STYLE.test(n) ? 'style' : 'other'
  const uc = cat(userDim)
  if (uc !== 'other') { hit = dims.find(d => cat(d.dim) === uc); if (hit) return hit }
  return null
}

/* ─────────── ③ 点「添加规格类型」并选维度 ─────────── */
async function addDim(page, dimName) {
  await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const btn = [...root.querySelectorAll('button')].find(b => /添加规格类型/.test(b.textContent || ''))
    btn?.click()
  }, SPEC_ROOT)
  await sleep(2500)
  await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const inputs = [...root.querySelectorAll('input')]
      .filter(e => (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0)
    inputs[inputs.length - 1]?.click()
  }, SPEC_ROOT)
  await sleep(2500)
  const ok = await page.evaluate((name) => {
    let cands = [...document.querySelectorAll('li, div, span, a')]
      .filter(e => (e.textContent || '').trim() === name && e.getBoundingClientRect().y > 400 && e.getBoundingClientRect().width > 10)
    if (!cands.length) {
      // 模糊：包含
      cands = [...document.querySelectorAll('li, div, span, a')]
        .filter(e => {
          const t = (e.textContent || '').trim()
          const r = e.getBoundingClientRect()
          return r.y > 400 && r.width > 10 && t.length <= 12 && (t.includes(name) || name.includes(t))
        })
    }
    if (!cands.length) return false
    cands[cands.length - 1].click()
    return true
  }, dimName)
  await sleep(2500)
  return ok
}

/* ─────────── ④ 填颜色输入框（placeholder*="主色"） ─────────── */
async function fillColorInputs(page, dimIdx, values) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    let pos = await page.evaluate((sel, ci, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2')][ci]
      if (!c) return null
      const els = [...c.querySelectorAll('input[placeholder*="主色"]')]
      if (els.length <= idx) return { needAdd: true }
      els[idx].scrollIntoView({ block: 'center' })
      const r = els[idx].getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, SPEC_ROOT, dimIdx, i)

    if (pos?.needAdd) {
      // 补框：找容器内"添加颜色/添加/+"
      await page.evaluate((sel, ci) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2')][ci]
        const cands = [...c.querySelectorAll('a, span, button, div, i')].filter(e => {
          const txt = (e.textContent || '').trim()
          const r = e.getBoundingClientRect()
          return r.width > 5 && r.width < 100 && (txt === '添加' || txt === '+' || /添加颜色/.test(txt))
        })
        cands[cands.length - 1]?.click()
      }, SPEC_ROOT, dimIdx)
      await sleep(1500)
      pos = await page.evaluate((sel, ci, idx) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2')][ci]
        const els = [...c.querySelectorAll('input[placeholder*="主色"]')]
        if (els.length <= idx) return null
        els[idx].scrollIntoView({ block: 'center' })
        const r = els[idx].getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, SPEC_ROOT, dimIdx, i)
    }
    if (!pos?.x) { log.push({ v: values[i], ok: false }); continue }

    await page.mouse.click(pos.x, pos.y); await sleep(200)
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
    await page.keyboard.press('Backspace'); await sleep(50)
    await page.keyboard.type(values[i], { delay: 40 }); await sleep(150)
    await page.keyboard.press('Enter'); await sleep(500)
    await page.keyboard.press('Tab'); await sleep(250)

    const back = await page.evaluate((sel, ci, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2')][ci]
      return [...c.querySelectorAll('input[placeholder*="主色"]')][idx]?.value
    }, SPEC_ROOT, dimIdx, i)
    log.push({ v: values[i], ok: !!back })
  }
  return log
}

/* ─────────── ⑤ 填自定义输入框（placeholder*="自定义{维度名}"） ─────────── */
async function fillCustomInputs(page, dimIdx, phKeyword, values) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    let pos = await page.evaluate((sel, ci, ph, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2')][ci]
      if (!c) return null
      const els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && p.includes(ph) && !p.includes('排序') && r.y > 0 && r.width > 30
      })
      if (els.length <= idx) return { needAdd: true }
      els[idx].scrollIntoView({ block: 'center' })
      const r = els[idx].getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, SPEC_ROOT, dimIdx, phKeyword, i)

    if (pos?.needAdd) {
      await page.evaluate((sel, ci) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2')][ci]
        const links = [...c.querySelectorAll('a, span, button')]
          .filter(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
        links[0]?.click()
      }, SPEC_ROOT, dimIdx)
      await sleep(1500)
      pos = await page.evaluate((sel, ci, ph, idx) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2')][ci]
        const els = [...c.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return p.includes('自定义') && p.includes(ph) && !p.includes('排序') && r.y > 0 && r.width > 30
        })
        if (els.length <= idx) return null
        els[idx].scrollIntoView({ block: 'center' })
        const r = els[idx].getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, SPEC_ROOT, dimIdx, phKeyword, i)
    }
    if (!pos?.x) { log.push({ v: values[i], ok: false }); continue }

    await page.mouse.click(pos.x, pos.y); await sleep(200)
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
    await page.keyboard.press('Backspace'); await sleep(50)
    await page.keyboard.type(values[i], { delay: 40 }); await sleep(150)
    await page.keyboard.press('Enter'); await sleep(500)
    await page.keyboard.press('Tab'); await sleep(250)

    const back = await page.evaluate((sel, ci, ph, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2')][ci]
      const els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        return p.includes('自定义') && p.includes(ph) && !p.includes('排序') && e.getBoundingClientRect().y > 0
      })
      return els[idx]?.value
    }, SPEC_ROOT, dimIdx, phKeyword, i)
    log.push({ v: values[i], ok: !!back })
  }
  return log
}

/* ─────────── ⑥ 勾选 checkbox 值 ─────────── */
async function checkBoxes(page, dimIdx, values) {
  const log = []
  for (const v of values) {
    const ok = await page.evaluate((sel, ci, val) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2')][ci]
      if (!c) return false
      const clean = val.replace(/(cm|厘米|ml|mL|L|l|g|kg|G|KG)$/i, '').trim()
      for (const item of c.querySelectorAll('.package-item-container')) {
        const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (txt === val || txt === clean) {
          const cb = item.querySelector('input[type="checkbox"]')
          if (cb && !cb.checked) item.querySelector('label')?.click()
          return true
        }
      }
      return false
    }, SPEC_ROOT, dimIdx, v)
    log.push({ v, ok })
    await sleep(300)
  }
  return log
}

/* ─────────── ⑦ 填 #sku 价格表（库存/拼单价/单买价） ─────────── */
async function fillSkuTable(page, price, stock) {
  const single = (parseFloat(price) + 1).toFixed(1)
  // 等表格生成
  let rows = 0
  for (let i = 0; i < 12; i++) {
    await sleep(1000)
    rows = await page.evaluate(() => document.querySelectorAll('#sku table tbody tr').length).catch(() => 0)
    if (rows > 0) break
  }
  if (!rows) return { rows: 0, filled: 0 }

  let filled = 0
  for (let r = 0; r < rows; r++) {
    // 滚动到位
    await page.evaluate(ri => {
      const trs = [...document.querySelectorAll('#sku table tbody tr')]
      trs[ri]?.scrollIntoView({ block: 'center' })
    }, r)
    await sleep(300)

    const inputs = await page.evaluate(ri => {
      const trs = [...document.querySelectorAll('#sku table tbody tr')]
      const tr = trs[ri]
      if (!tr) return []
      return [...tr.querySelectorAll('input')].map((e, i) => ({
        i, ph: e.placeholder || '',
        x: Math.round(e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2),
        y: Math.round(e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2),
      }))
    }, r)

    for (const inp of inputs) {
      let val = null
      if (inp.ph === '请输入' || inp.ph === '') {
        if (inp.i === 0) val = String(stock)      // 库存
        else if (inp.i === 1) val = String(price) // 拼单价
        else if (inp.i === 2) val = single        // 单买价
      }
      if (!val) continue
      await page.mouse.click(inp.x, inp.y); await sleep(200)
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
      await page.keyboard.press('Backspace'); await sleep(50)
      await page.keyboard.type(val, { delay: 40 }); await sleep(200)
      await page.keyboard.press('Enter'); await sleep(400)
      // 回读，React 清了就用 setter 兜底
      const back = await page.evaluate((ri, ii) => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        return trs[ri]?.querySelectorAll('input')[ii]?.value
      }, r, inp.i)
      if (!back) {
        await page.evaluate((ri, ii, v) => {
          const trs = [...document.querySelectorAll('#sku table tbody tr')]
          const el = trs[ri]?.querySelectorAll('input')[ii]
          if (!el) return
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(el, v)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
        }, r, inp.i, val)
        await sleep(200)
      }
      filled++
    }
  }
  return { rows, filled }
}

/* ─────────── ⑧ 填参考价 ─────────── */
async function fillRefPrice(page, refPrice) {
  return page.evaluate((sel, rp) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const inp = root.querySelector('input[placeholder*="大于"]')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, String(rp))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
    return true
  }, SPEC_ROOT, refPrice)
}

/* ─────────── 主入口 ─────────── */
export async function fillSpecsOnPage(page, specs, defaults = {}) {
  const log = (...a) => console.log('[dom-fill-spec] ' + new Date().toTimeString().slice(0, 8) + ' ' + a.join(' '))
  const price = defaults.price || '29.9'
  const stock = defaults.stock || '999'

  if (!specs?.length) return { ok: true, skuRows: 0, message: '无规格维度' }

  // 等规格根节点
  log('等 #goods-spec-sku…')
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    if (await page.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)) break
    if (i === 19) return { ok: false, skuRows: 0, message: '规格区超时' }
  }

  // 逐维度处理
  for (let di = 0; di < specs.length; di++) {
    const userSpec = specs[di]
    const userDim = userSpec.name
    const values = userSpec.values
      .map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim())
      .filter(Boolean)
    if (!values.length) continue

    // 每次重新扫描（前一个维度填完后页面结构会变）
    let info = await scanDims(page)
    log(`[${di + 1}/${specs.length}] 「${userDim}」(${values.length} 值)  页面维度: ` +
      info.dims.map(d => `${d.dim}(${d.type})`).join(', '))

    let target = matchDim(userDim, info.dims)

    if (!target) {
      // 预置没有 → 添加规格类型
      log(`  预置没有「${userDim}」→ 点「添加规格类型」`)
      const ok = await addDim(page, userDim)
      if (!ok) {
        log(`  ❌ 下拉没有「${userDim}」`)
        return { ok: false, skuRows: 0, message: `下拉里没有「${userDim}」` }
      }
      info = await scanDims(page)
      target = matchDim(userDim, info.dims) || info.dims[info.dims.length - 1]
      log(`  新建后维度: ${info.dims.map(d => d.dim).join(', ')}`)
    }

    if (!target) { log(`  ❌ 找不到目标维度`); continue }
    log(`  → 填到「${target.dim}」(${target.type})`)

    if (target.type === 'checkbox') {
      const r = await checkBoxes(page, target.idx, values)
      r.forEach(x => log(`    "${x.v}" → ${x.ok ? '勾了' : '没找到'}`))
    } else if (target.type === 'color-input') {
      const r = await fillColorInputs(page, target.idx, values)
      r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}`))
    } else {
      // custom-input / spec-type：用维度名做 placeholder 关键词
      const r = await fillCustomInputs(page, target.idx, target.dim, values)
      r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}`))
    }
    await sleep(1500)
  }

  // 填 SKU 价格表
  log('填 #sku 价格表…')
  const skuRes = await fillSkuTable(page, price, stock)
  log(`  ${skuRes.rows} 行，填了 ${skuRes.filled} 格`)

  // 参考价
  const refPrice = (parseFloat(price) + 15).toFixed(1)
  const refOk = await fillRefPrice(page, refPrice)
  log(`参考价 ${refPrice} → ${refOk ? 'OK' : '未找到输入框'}`)

  return {
    ok: skuRes.rows > 0,
    skuRows: skuRes.rows,
    message: `DOM 填规格完成：${skuRes.rows} 行 SKU，价格已填`,
  }
}
