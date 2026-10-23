/**
 * SKU 规格值填充 —— 照抄 sku_build.py 的成功做法
 *
 * 来源：E:\360MoveData\Users\Administrator\Desktop\童装\发布技能\sku_build.py
 *   （那份脚本在淘宝上真跑通过，生成过 sku_built.png）
 *
 * ★ 三处和我之前做法的本质差异（这就是我之前全部失败的原因）：
 *
 *   1. **真实鼠标点击**：CDP Input.dispatchMouseEvent(mouseMoved/mousePressed/mouseReleased)
 *      用坐标点，而不是 dispatchEvent(new MouseEvent)。
 *      Ant Design 的 cascader 依赖真实 pointer 事件序列（含 mouseMoved）。
 *
 *   2. **真实键盘输入**：page.keyboard.type(text, {delay})
 *      而不是 set value + dispatchEvent('input')。
 *      React 受控组件的 onChange 只认真实 keydown/keypress/input 事件。
 *
 *   3. **选完点「确定」按钮**：skubuild 里明确有
 *      find button /确定|确认/ in 弹窗 → click
 *      而不是按 Escape 关面板。
 *
 * 对应 Python 原码：
 *   click(cdp, x, y)  → page.mouse.move + down + up
 *   page.keyboard.type(color, delay=60) → page.keyboard.type
 *   conf /确定|确认/ → click(cdp, ...) → 真实点确定
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 读 SKU 状态 */
export async function readSkuState(page) {
  return await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')]
      .find(x => /价格/.test([...x.querySelectorAll('th')].map(h => h.textContent || '').join('')))
    return {
      rows: t ? t.querySelectorAll('tbody tr').length : 0,
      filledRows: t ? [...t.querySelectorAll('tbody tr')].filter(r => {
        const i = r.querySelector('input')
        return i && i.value
      }).length : 0,
      headers: t ? [...t.querySelectorAll('th')].map(h => (h.textContent || '').trim()) : [],
      pickerLabels: [...document.querySelectorAll('.ecom-g-cascader-picker-label')]
        .map(l => (l.textContent || '').trim()).filter(Boolean),
      hasEmptyPicker: [...document.querySelectorAll('.ecom-g-cascader-picker')]
        .some(p => !(p.querySelector('.ecom-g-cascader-picker-label')?.textContent || '').trim()),
    }
  })
}

/**
 * 真实鼠标点击（照抄 sku_build.py 的 click(cdp, x, y)）
 * Python 原码：
 *   mouseMoved → sleep(0.12) → mousePressed → sleep(0.08) → mouseReleased
 *
 * ★ 加视口校验：坐标必须在页面视口内，否则 page.mouse 会点到视口外
 *   （实测踩坑：y=-2111 的「确定 (2)」被点到，等于白点）
 */
async function realClick(page, x, y) {
  try {
    const vp = page.viewport() || { width: 1600, height: 1000 }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    if (x < 0 || y < 0 || x > vp.width || y > vp.height) return false
    await page.mouse.move(Math.round(x), Math.round(y))
    await sleep(120)
    await page.mouse.down()
    await sleep(80)
    await page.mouse.up()
    return true
  } catch { return false }
}

/** 找一个元素并返回其屏幕中心坐标 */
async function centerOf(page, fn) {
  return await page.evaluate(fn)
}

/**
 * 加一个规格值
 * 照抄 sku_build.py 的 [2.x] 段：
 *   ① 点「+」或空 cascader 开面板
 *   ② 点输入框 → keyboard.type
 *   ③ 等候选 → 点匹配项
 *   ④ 找「确定」→ 点
 */
async function addOneSpecValue(page, keyword, log) {
  // ① 找空 cascader / 「+」按钮，真实点击
  const target = await centerOf(page, () => {
    // 优先：空 cascader 的 picker 本体
    const all = [...document.querySelectorAll('.ecom-g-cascader-picker')]
    const empty = all.filter(p => {
      const r = p.getBoundingClientRect()
      if (r.width <= 0) return false
      return !(p.querySelector('.ecom-g-cascader-picker-label')?.textContent || '').trim()
    })
    if (empty.length) {
      const p = empty[empty.length - 1]
      p.scrollIntoView({ block: 'center' })
      const r = p.getBoundingClientRect()
      return { kind: 'picker', x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    // 退化：规格区里的 + 按钮
    const box = document.querySelector('[class*="specValueContent"],[class*="skuValueBox"]')
    if (box) {
      const btn = [...box.querySelectorAll('button,[role="button"],span')].find(e => {
        const r = e.getBoundingClientRect()
        if (r.width <= 0 || r.width > 40) return false
        const cls = (e.className || '').toString()
        return /add|plus/i.test(cls) || (e.textContent || '').trim() === '+'
      })
      if (btn) {
        btn.scrollIntoView({ block: 'center' })
        const r = btn.getBoundingClientRect()
        return { kind: 'plus', x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
    }
    return null
  })
  if (!target) { log.push(`  「${keyword}」找不到入口`); return { ok: false, reason: '无入口' } }
  await realClick(page, target.x, target.y)
  await sleep(2500)

  // ② 点输入框 + 真实键盘输入
  const inp = await centerOf(page, () => {
    const els = [...document.querySelectorAll('.ecom-g-cascader-input')].filter(i => i.getBoundingClientRect().width > 0)
    const e = els[els.length - 1]
    if (!e) {
      // 退化：任何可见的规格值输入
      const any = [...document.querySelectorAll('input')].filter(i => {
        const r = i.getBoundingClientRect()
        return r.width > 0 && /规格值|填写并新增/.test(i.placeholder || '')
      })
      if (!any.length) return null
      const a = any[any.length - 1]
      a.scrollIntoView({ block: 'center' })
      const r = a.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    e.scrollIntoView({ block: 'center' })
    const r = e.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!inp) { log.push(`  「${keyword}」找不到输入框`); return { ok: false, reason: '无输入框' } }
  await realClick(page, inp.x, inp.y)
  await sleep(500)
  // ★ 真实键盘输入（不是 set value）
  await page.keyboard.type(keyword, { delay: 60 })
  await sleep(1800)

  // ③ 点第一个匹配的候选（排除空态项）
  const opt = await centerOf(page, (kw) => {
    const EMPTY = /暂无|没有|重新选择|无匹配|no data/i
    const items = [...document.querySelectorAll('.ecom-g-cascader-menu-item')]
      .filter(e => {
        const r = e.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return false
        const t = (e.textContent || '').trim()
        if (!t || EMPTY.test(t)) return false
        return true
      })
    if (!items.length) return { hasPanel: false, count: 0 }
    const hit = items.find(o => (o.textContent || '').includes(kw)) || items[0]
    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    return { hit: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text: (hit.textContent || '').trim().slice(0, 30), count: items.length }
  }, keyword)
  log.push(`  「${keyword}」候选: ${JSON.stringify(opt)}`)

  if (opt?.hit) {
    await realClick(page, opt.x, opt.y)
    await sleep(1200)
  } else {
    // 没候选 → 回车（sku_build.py 里的 fallback）
    await page.keyboard.press('Enter')
    await sleep(1200)
  }

  // ④ ★ 找「确定」按钮并真实点击
  //    照抄 sku_build.py 129-142 行的定位逻辑（原码）：
  //      els = [...document.querySelectorAll('body > div, body > div > div')].filter(e => {
  //          const cs = getComputedStyle(e);
  //          if (!e.offsetParent && cs.position !== 'fixed') return false;   // 必须可见
  //          const r = e.getBoundingClientRect();
  //          return r.width > 250 && r.height > 150 && (e.innerText||'').trim();
  //      });
  //      const m = els[els.length-1];                                        // 最上层弹窗
  //      const b = [...m.querySelectorAll('button')].find(e => e.offsetParent && /确定|确认/...)
  //
  //    ★ 我之前扫全页 button，命中了页面底部发布栏的「确定 (2)」（y=-2111 视口外），
  //      所以规格值永远没生效。必须严格限定在弹窗浮层内。
  const conf = await centerOf(page, () => {
    // 第一层：body 直属的浮层（弹窗/下拉都挂这里）
    const layers = [...document.querySelectorAll('body > div, body > div > div')]
      .filter(e => {
        const cs = getComputedStyle(e)
        // 必须可见：有 offsetParent 或 position:fixed
        if (!e.offsetParent && cs.position !== 'fixed') return false
        const r = e.getBoundingClientRect()
        return r.width > 250 && r.height > 150 && (e.innerText || '').trim()
      })
    // 从最上层（最后插入的）往前找
    for (let i = layers.length - 1; i >= 0; i--) {
      const m = layers[i]
      // 只在这个浮层里找确定/确认/完成
      const btns = [...m.querySelectorAll('button,[role="button"]')]
        .filter(e => {
          if (!e.offsetParent) return false
          const r = e.getBoundingClientRect()
          if (r.width <= 0 || r.height <= 0) return false
          // ★ 排除带括号计数的（那是发布栏的「确定 (2)」）
          const txt = (e.textContent || '').trim()
          if (/\(\d+\)|（\d+）/.test(txt)) return false
          // ★ 排除在视口外的
          if (r.y < 0 || r.y > window.innerHeight) return false
          return /确定|确认|完成|OK/i.test(txt)
        })
      if (btns.length) {
        const b = btns[btns.length - 1]
        const r = b.getBoundingClientRect()
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          text: (b.textContent || '').trim(),
          layerCls: (m.className || '').toString().slice(0, 50),
        }
      }
    }
    return null
  })
  if (conf) {
    log.push(`  「${keyword}」点弹窗内「${conf.text}」 (${Math.round(conf.x)},${Math.round(conf.y)}) [${conf.layerCls}]`)
    await realClick(page, conf.x, conf.y)
    await sleep(2000)
  } else {
    log.push(`  「${keyword}」弹窗内无确定按钮（可能自动确认）`)
    await sleep(1500)
  }

  return { ok: true, picked: opt?.text || null }
}

/**
 * 填 SKU 表（规格值 + 价格库存）
 * @param {Object} sku { values:[], price, stock, totalStock, itemNo }
 */
export async function fillSkuTable(page, sku = {}) {
  const log = []
  const before = await readSkuState(page)
  log.push(`SKU 表：${before.rows} 行；已有规格值 [${(before.pickerLabels || []).join(', ')}]；空入口=${before.hasEmptyPicker}`)

  const values = sku.values || []
  if (!values.length) return { ok: false, before, after: before, log: [...log, '未提供 sku.values'] }

  // ★ 照抄 sku_build.py：每个颜色单独一轮「点+ → 输入 → 选候选 → 点确定」
  const filled = []
  for (const v of values) {
    const r = await addOneSpecValue(page, v, log)
    if (r.ok) filled.push({ value: v, picked: r.picked })
    await sleep(1500)
    const st = await readSkuState(page)
    log.push(`  加完「${v}」→ ${st.rows} 行，规格值 [${(st.pickerLabels || []).join(', ')}]`)
  }

  let after = await readSkuState(page)
  log.push(`全部加完：${after.rows} 行，规格值 [${(after.pickerLabels || []).join(', ')}]`)

  // 若仍无行 → refetchSchema
  if (after.rows === 0 && (after.pickerLabels || []).length > 0) {
    log.push('表格 0 行 → 调 refetchSchema')
    const rf = await page.evaluate(async () => {
      try {
        const r = await fetch('/product/tproduct/refetchSchema?action=spec_detail_refresh', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'spec_detail_refresh' }),
        })
        const t = await r.text()
        let j = null
        try { j = JSON.parse(t) } catch { /* ignore */ }
        return { http: r.status, st: j?.st, msg: j?.msg }
      } catch (e) { return { err: String(e).slice(0, 100) } }
    }).catch(() => null)
    log.push(`refetchSchema → ${JSON.stringify(rf)}`)
    await sleep(5000)
    after = await readSkuState(page)
    log.push(`refetch 后：${after.rows} 行`)
  }

  // 填价格库存
  if (after.rows > 0) {
    for (let i = 0; i < after.rows; i++) {
      await page.evaluate((idx, price, stock) => {
        const pi = [...document.querySelectorAll('table tbody input')].filter(x => /价格/.test(x.placeholder || ''))[idx]
        const si = [...document.querySelectorAll('table tbody input')].filter(x => /库存/.test(x.placeholder || ''))[idx]
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        if (pi && price) { set.call(pi, price); for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) pi.dispatchEvent(new Event(t, { bubbles: true })) }
        if (si && stock) { set.call(si, stock); for (const t of ['input', 'compositionend', 'change', 'keyup', 'blur']) si.dispatchEvent(new Event(t, { bubbles: true })) }
      }, i, String(sku.price || ''), String(sku.stock || '')).catch(() => {})
      await sleep(700)
    }
    if (sku.totalStock) {
      await page.evaluate((v) => {
        const inp = [...document.querySelectorAll('input')].find(i => /请输入库存/.test(i.placeholder || ''))
        if (inp) { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(inp, v); for (const t of ['input','compositionend','change','keyup','blur']) inp.dispatchEvent(new Event(t, { bubbles: true })) }
      }, String(sku.totalStock)).catch(() => {})
    }
    const final = await readSkuState(page)
    log.push(`价格库存填完：${final.rows} 行，${final.filledRows} 行有值`)
    return { ok: final.filledRows > 0, before, after: final, log }
  }

  return { ok: false, before, after, log }
}
