/**
 * 02-form-input/index.mjs — 拼多多「通用输入模块」
 *
 * 所有 beast-core 表单输入统一走这里（标题/价格/库存/编码/规格值/属性搜索…）
 *
 * ════════════════════════════════════════════════════════════════
 *  页面结构（实测）
 *
 *   <div data-testid="beast-core-form-item" id="goods_name">     ← 表单项，id 即字段名
 *     <div data-testid="beast-core-input">
 *       <input placeholder="商品标题组成：..." type="text"
 *              class="IPT_input_5-194-0"
 *              data-testid="beast-core-input-htmlInput" value="">
 *       <span class="IPT_length">0 / 60</span>                    ← 字数计数
 *
 *  ★ React 受控组件：直接 input.value='x' 无效
 *    必须 native setter + dispatchEvent('input')
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { fillInput, readInput, countLimit, fillFields } from './02-form-input/index.mjs'
 *
 *   // ① 按表单项 id（最稳，推荐）
 *   await fillInput(page, { formItemId: 'goods_name', value: '双层中空纸杯...' })
 *
 *   // ② 按 placeholder 模糊匹配
 *   await fillInput(page, { placeholder: '商品标题组成', value: '...' })
 *
 *   // ③ 按 CSS 选择器
 *   await fillInput(page, { selector: '#goods_name input', value: '...' })
 *
 *   // ④ 按附近文案
 *   await fillInput(page, { nearText: '商品标题', value: '...' })
 *
 *   // ⑤ 批量
 *   await fillFields(page, [
 *     { formItemId: 'goods_name', value: 'xxx' },
 *     { nearText: '商品编码', value: 'SN001' },
 *   ])
 *
 *   // ⑥ 清空
 *   await fillInput(page, { formItemId: 'goods_name', value: '', verify: true })
 */

/** ─────────────────────────────────────────────
 *  页面内辅助函数（一次性注入，幂等）
 *  ───────────────────────────────────────────── */
const HELPERS = `
(function () {
  if (window.__pddForm) return;

  // React 安全赋值（兼容普通 input / inputNumber）
  function setValue(el, value) {
    if (!el) return { ok: false, error: '元素不存在' };
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    const isNumber = el.getAttribute('data-testid') === 'beast-core-inputNumber-htmlInput'
      || !!el.closest('[data-testid="beast-core-inputNumber"]');

    try { el.focus(); } catch (e) { }

    let v = String(value);
    // ★ inputNumber：按 min/max 夹取
    if (isNumber && v !== '') {
      const min = el.getAttribute('min');
      const max = el.getAttribute('max');
      let n = Number(v);
      if (!isNaN(n)) {
        if (min !== null && n < Number(min)) n = Number(min);
        if (max !== null && n > Number(max)) n = Number(max);
        v = String(n);
      }
    }

    if (setter) setter.call(el, v);
    else el.value = v;

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try { el.blur(); } catch (e) { }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, now: el.value, isNumber };
  }

  // 定位 input
  function find(opts) {
    opts = opts || {};
    if (opts.selector) {
      const el = document.querySelector(opts.selector);
      if (el) return el;
    }
    // ★ 按 data-tracking-viewid（如 count_discount）
    if (opts.trackingId) {
      const el = document.querySelector('[data-tracking-viewid="' + opts.trackingId + '"]')
        || document.querySelector('[data-tracking-click-viewid="' + opts.trackingId + '"]');
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return el;
    }
    // ★ 按 data-testid 类型 + 序号（inputNumber / input）
    if (opts.testId) {
      const all = [...document.querySelectorAll('[data-testid="' + opts.testId + '"]')]
        .filter(e => e.tagName === 'INPUT' || e.tagName === 'TEXTAREA');
      return all[opts.testIdIndex || 0] || null;
    }
    if (opts.formItemId) {
      const item = document.getElementById(opts.formItemId)
        || document.querySelector('[data-testid="beast-core-form-item"][id="' + opts.formItemId + '"]');
      if (item) {
        const el = item.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
        if (el) return el;
      }
    }
    // ★ SKU 表格内输入：按行号 + 列名
    if (opts.skuRow != null) {
      const rows = [...document.querySelectorAll('tbody[data-testid="beast-core-table-middle-tbody"] tr')];
      const tr = rows[opts.skuRow];
      if (!tr) return null;
      const tds = [...tr.querySelectorAll('td[data-testid="beast-core-table-td"]')];
      let td = null;
      if (opts.skuCol === 'quantity') td = tds.find(x => /quantity/.test(String(x.className || '')));
      else if (opts.skuCol === 'price' || opts.skuCol === 'groupPrice') {
        const cands = tds.filter(x => /sku-input/.test(String(x.className || '')) && x.querySelector('[data-testid="beast-core-inputNumber"]'));
        td = cands[opts.priceIndex || 0];
      }
      else if (typeof opts.skuColIndex === 'number') td = tds[opts.skuColIndex];
      if (!td) return null;
      return td.querySelector('input:not([type="hidden"])');
    }
    if (opts.placeholder) {
      const all = [...document.querySelectorAll('input:not([type="hidden"]), textarea')];
      return all.find(e => (e.placeholder || '').includes(opts.placeholder)) || null;
    }
    if (opts.nearText) {
      const cands = [...document.querySelectorAll('div,span,label')];
      for (const el of cands) {
        const t = (el.innerText || '').trim();
        if (!t || !t.includes(opts.nearText)) continue;
        if (t.length > opts.nearText.length + 40) continue;
        const scope = el.closest('[data-testid="beast-core-form-item"], div[class*="Form_item"]') || el.parentElement;
        const inp = scope && scope.querySelector('input:not([type="hidden"]), textarea');
        if (inp) return inp;
      }
    }
    return null;
  }

  window.__pddForm = { setValue, find };
})();
true;
`

// 页面内执行的小工具（供 evaluate 用）
const RUN = function (opts, action, value) {
  const F = window.__pddForm
  if (!F) return { ok: false, error: 'helper 未注入' }
  const el = F.find(opts)
  if (!el) return { ok: false, error: 'NOT_FOUND', probe: {
    formItemId: opts.formItemId || '',
    placeholder: opts.placeholder || '',
    selector: opts.selector || '',
    nearText: opts.nearText || '',
  } }
  if (action === 'read') {
    return { ok: true, value: el.value || '', placeholder: el.placeholder || '', tag: el.tagName }
  }
  if (action === 'write') {
    const before = el.value || ''
    const r = F.setValue(el, value)
    return { ok: !!r.ok, before, after: r.now, error: r.error || '' }
  }
  return { ok: false, error: 'unknown action' }
}

async function ensureHelpers(page) {
  const ok = await page.evaluate(() => !!window.__pddForm).catch(() => false)
  if (!ok) await page.evaluate(HELPERS).catch(() => { })
}

/**
 * 填输入框
 * @param {object} page
 * @param {object} opts { formItemId?, placeholder?, selector?, nearText?, value, verify?, timeoutMs? }
 * @returns {Promise<{ok:boolean,before:string,after:string,error:string}>}
 */
export async function fillInput(page, opts = {}) {
  const res = { ok: false, before: '', after: '', error: '' }
  await ensureHelpers(page)

  const target = {
    formItemId: opts.formItemId,
    placeholder: opts.placeholder,
    selector: opts.selector,
    nearText: opts.nearText,
    // ★ 新增定位方式
    trackingId: opts.trackingId,
    testId: opts.testId,
    testIdIndex: opts.testIdIndex,
    skuRow: opts.skuRow,
    skuCol: opts.skuCol,
    skuColIndex: opts.skuColIndex,
    priceIndex: opts.priceIndex,
  }

  // 最多等 5 秒让元素出现
  const timeout = opts.timeoutMs ?? 5000
  const t0 = Date.now()
  let w = null
  while (Date.now() - t0 < timeout) {
    w = await page.evaluate(RUN, target, 'write', String(opts.value ?? '')).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))
    if (w && w.ok) break
    if (w && w.error !== 'NOT_FOUND') break
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)))
  }

  if (!w || !w.ok) {
    res.error = w?.error === 'NOT_FOUND'
      ? `找不到输入框 ${JSON.stringify(target)}`
      : (w?.error || '写入失败')
    return res
  }
  res.before = w.before || ''
  res.after = w.after || ''

  // 校验
  if (opts.verify !== false) {
    await page.evaluate(() => new Promise(r => setTimeout(r, 250)))
    const rr = await readInput(page, target)
    res.after = rr.value
    const want = String(opts.value ?? '')
    // ★ 数字字段用数值比较（inputNumber 会把 "19.90" 归一化成 "19.9"）
    const isNumLike = want !== '' && !isNaN(Number(want)) && !isNaN(Number(rr.value)) && rr.value !== ''
    if (isNumLike) {
      res.ok = rr.found && Number(rr.value) === Number(want)
    } else {
      res.ok = rr.found && rr.value === want
    }
    if (!res.ok) res.error = `读回不一致：期望 "${want}"，实际 "${rr.value}"`
  } else {
    res.ok = true
  }
  return res
}

/**
 * 读输入框当前值
 * @returns {Promise<{found:boolean,value:string,placeholder:string}>}
 */
export async function readInput(page, opts = {}) {
  await ensureHelpers(page)
  const r = await page.evaluate(RUN, {
    formItemId: opts.formItemId, placeholder: opts.placeholder,
    selector: opts.selector, nearText: opts.nearText,
    // ★ 补齐其余定位参数，否则读不到 SKU 表格
    trackingId: opts.trackingId, testId: opts.testId, testIdIndex: opts.testIdIndex,
    skuRow: opts.skuRow, skuCol: opts.skuCol, skuColIndex: opts.skuColIndex, priceIndex: opts.priceIndex,
  }, 'read', '').catch(() => ({ ok: false }))
  return { found: !!r?.ok, value: r?.value || '', placeholder: r?.placeholder || '' }
}

/**
 * 读字数限制（如 0/60）
 * @returns {Promise<{current:number,max:number,text:string}>}
 */
export async function countLimit(page, opts = {}) {
  await ensureHelpers(page)
  return page.evaluate((o) => {
    const el = window.__pddForm.find(o)
    if (!el) return { current: -1, max: -1, text: '' }
    const scope = el.closest('[data-testid="beast-core-form-item"], div[class*="Form_item"]') || el.parentElement
    if (!scope) return { current: -1, max: -1, text: '' }
    // ★ 计数 span 是 visibility:hidden，innerText 读不到，必须用 textContent
    const raw = (scope.textContent || '').replace(/\s+/g, '')
    const m = raw.match(/(\d+)\/(\d+)/)
    if (m) return { current: Number(m[1]), max: Number(m[2]), text: raw.slice(0, 50) }
    // 兜底：直接找 .IPT_length 类
    const lenEl = scope.querySelector('[class*="IPT_length"]')
    if (lenEl) {
      const t = (lenEl.textContent || '').replace(/\s+/g, '')
      const m2 = t.match(/(\d+)\/(\d+)/)
      if (m2) return { current: Number(m2[1]), max: Number(m2[2]), text: t }
    }
    return { current: -1, max: -1, text: raw.slice(0, 50) }
  }, {
    formItemId: opts.formItemId, placeholder: opts.placeholder,
    selector: opts.selector, nearText: opts.nearText,
  }).catch(() => ({ current: -1, max: -1, text: '' }))
}

/**
 * 批量填
 * @param {Array<{formItemId?,placeholder?,selector?,nearText?,value}>} fields
 * @returns {Promise<Array>}
 */
export async function fillFields(page, fields = []) {
  const out = []
  for (const f of fields) {
    const r = await fillInput(page, f)
    out.push({ ...f, ...r })
    if (!r.ok) break
    await page.evaluate(() => new Promise(r => setTimeout(r, 200)))
  }
  return out
}

/**
 * 列出页面上所有可填输入框（调试用，帮你找 formItemId）
 * @returns {Promise<Array<{formItemId,placeholder,value,type,tag}>>}
 */
export async function listInputs(page) {
  await ensureHelpers(page)
  return page.evaluate(() => {
    const out = []
    const inputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea')]
    for (const el of inputs) {
      const item = el.closest('[data-testid="beast-core-form-item"]')
      const skuRow = el.closest('tbody[data-testid="beast-core-table-middle-tbody"] tr')
      const rowIdx = skuRow ? [...skuRow.parentElement.children].indexOf(skuRow) : -1
      out.push({
        formItemId: item ? (item.id || '') : '',
        testId: el.getAttribute('data-testid') || '',
        trackingId: el.getAttribute('data-tracking-viewid') || el.getAttribute('data-tracking-click-viewid') || '',
        placeholder: (el.placeholder || '').slice(0, 40),
        value: (el.value || '').slice(0, 30),
        type: el.type || el.tagName.toLowerCase(),
        skuRow: rowIdx,
        visible: el.offsetParent !== null,
      })
    }
    return out
  }).catch(() => [])
}

/**
 * ★ 填一整个 SKU 表格的价格 / 库存 / 编码
 *
 * 表格结构（实测）：
 *   <tbody data-testid="beast-core-table-middle-tbody">
 *     <tr>
 *       <td class="... sku-input quantity ..."><input placeholder="请输入"></td>       ← 库存
 *       <td class="... sku-input"><div data-testid="beast-core-inputNumber"><input></td> ← 拼单价
 *       <td class="... sku-input"><div data-testid="beast-core-inputNumber"><input></td> ← 单买价
 *       <td class="... sku-input"><input placeholder="请输入"></td>                    ← 编码
 *       <td class="... sku-input"><input placeholder="请输入"></td>                    ← 其他
 *   </tr>
 *   </tbody>
 *
 * @param {object} page
 * @param {Array<{quantity?, groupPrice?, singlePrice?, outSkuSn?}>} rows
 * @returns {Promise<{ok:boolean, done:number, total:number, results:Array, errors:Array}>}
 */
export async function fillSkuTable(page, rows = [], opts = {}) {
  await ensureHelpers(page)
  const res = { ok: false, done: 0, total: rows.length, results: [], errors: [] }
  if (!rows.length) { res.errors.push('rows 为空'); return res }

  // ★ 批量模式（默认）：单次 page.evaluate 填完整个表格
  //   逐个填需要 N 行 × 4 列 次 CDP 往返（6 行 = 24 次，约 3-5 秒）
  //   批量只需 1 次往返（同样 6 行约 100-300ms）
  if (opts.batch !== false) {
    const t0 = Date.now()
    const r = await page.evaluate((payload) => {
      const F = window.__pddForm
      if (!F) return { ok: false, error: 'helper 未注入' }

      const rowsEls = [...document.querySelectorAll('tbody[data-testid="beast-core-table-middle-tbody"] tr')]
      if (!rowsEls.length) return { ok: false, error: 'SKU 表格未渲染' }

      const out = []
      let done = 0

      for (let i = 0; i < payload.length; i++) {
        const data = payload[i]
        const tr = rowsEls[i]
        const one = { row: i, ok: true, filled: {}, errors: [] }
        if (!tr) { one.ok = false; one.errors.push('行不存在'); out.push(one); continue }

        const tds = [...tr.querySelectorAll('td[data-testid="beast-core-table-td"]')]

        // 定位每一列
        const quantityTd = tds.find(x => /quantity/.test(String(x.className || '')))
        const priceTds = tds.filter(x => /sku-input/.test(String(x.className || '')) && x.querySelector('[data-testid="beast-core-inputNumber"]'))
        // 编码列：sku-input 但不是 quantity、且不是 inputNumber
        const textTds = tds.filter(x => /sku-input/.test(String(x.className || ''))
          && !/quantity/.test(String(x.className || ''))
          && !x.querySelector('[data-testid="beast-core-inputNumber"]'))

        const setOne = (el, val, key) => {
          if (!el) { one.ok = false; one.errors.push(key + ': 找不到元素'); return }
          try {
            const r = F.setValue(el, String(val))
            if (r && r.ok) one.filled[key] = r.now
            else { one.ok = false; one.errors.push(key + ': ' + ((r && r.error) || '赋值失败')) }
          } catch (e) {
            one.ok = false; one.errors.push(key + ': ' + String(e.message || e).slice(0, 40))
          }
        }

        if (data.quantity != null && quantityTd) {
          setOne(quantityTd.querySelector('input:not([type="hidden"])'), data.quantity, 'quantity')
        }
        if (data.groupPrice != null) {
          setOne(priceTds[0] && priceTds[0].querySelector('input:not([type="hidden"])'), data.groupPrice, 'groupPrice')
        }
        if (data.singlePrice != null) {
          setOne(priceTds[1] && priceTds[1].querySelector('input:not([type="hidden"])'), data.singlePrice, 'singlePrice')
        }
        if (data.outSkuSn != null) {
          setOne(textTds[0] && textTds[0].querySelector('input:not([type="hidden"])'), data.outSkuSn, 'outSkuSn')
        }

        if (one.ok) done++
        out.push(one)
      }

      return { ok: true, done, total: payload.length, results: out }
    }, rows).catch(e => ({ ok: false, error: String(e.message).slice(0, 150) }))

    res.ms = Date.now() - t0
    res.method = 'batch'

    if (!r.ok) { res.errors.push(r.error); return res }
    res.done = r.done
    res.results = r.results
    for (const one of r.results) {
      if (!one.ok) res.errors.push(`第 ${one.row} 行: ${one.errors.join('; ')}`)
    }
    res.ok = res.done === res.total
    return res
  }

  // 逐个模式（batch:false）：慢但能拿到每步详细错误
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const one = { row: i, ok: true, filled: {} }

    // 库存
    if (row.quantity != null) {
      const r = await fillInput(page, { skuRow: i, skuCol: 'quantity', value: row.quantity })
      if (r.ok) one.filled.quantity = r.after
      else { one.ok = false; one.error = 'quantity: ' + r.error }
    }
    // 拼单价（第 1 个 inputNumber）
    if (row.groupPrice != null) {
      const r = await fillInput(page, { skuRow: i, skuCol: 'price', priceIndex: 0, value: row.groupPrice })
      if (r.ok) one.filled.groupPrice = r.after
      else { one.ok = false; one.error = (one.error || '') + ' groupPrice: ' + r.error }
    }
    // 单买价（第 2 个 inputNumber）
    if (row.singlePrice != null) {
      const r = await fillInput(page, { skuRow: i, skuCol: 'price', priceIndex: 1, value: row.singlePrice })
      if (r.ok) one.filled.singlePrice = r.after
      else { one.ok = false; one.error = (one.error || '') + ' singlePrice: ' + r.error }
    }
    // 编码（第 4 列，index 3）
    if (row.outSkuSn != null) {
      const r = await fillInput(page, { skuRow: i, skuColIndex: 3, value: row.outSkuSn })
      if (r.ok) one.filled.outSkuSn = r.after
      else { one.ok = false; one.error = (one.error || '') + ' outSkuSn: ' + r.error }
    }

    if (one.ok) res.done++
    else res.errors.push(`第 ${i} 行: ${one.error}`)
    res.results.push(one)
    await page.evaluate(() => new Promise(r => setTimeout(r, 150)))
  }

  res.ok = res.done === res.total
  return res
}

/**
 * ★ 填规格自定义值（如「自定义容量」「自定义尺寸」）
 *
 * 场景：规格维度选完后，下方出现输入框让你填自定义规格值
 *
 * @param {object} page
 * @param {object} opts
 * @param {string} [opts.placeholder]  placeholder 匹配（如 '自定义容量'）
 * @param {string[]} opts.values       要填的多个值（多个输入框时按顺序）
 * @returns {Promise<{ok:boolean, filled:number, total:number, errors:Array}>}
 */
export async function fillCustomSpecValues(page, opts = {}) {
  await ensureHelpers(page)
  const res = { ok: false, filled: 0, total: 0, errors: [] }
  const values = (opts.values || []).filter(v => v != null)
  if (!values.length) { res.errors.push('values 为空'); return res }

  const ph = opts.placeholder || ''
  // 找出所有匹配 placeholder 的输入框
  const count = await page.evaluate((p) => {
    const all = [...document.querySelectorAll('input:not([type="hidden"])')]
      .filter(e => e.offsetParent !== null && (!p || (e.placeholder || '').includes(p)))
    all.forEach((e, i) => e.setAttribute('data-pdd-spec-idx', String(i)))
    return all.length
  }, ph).catch(() => 0)

  res.total = Math.min(count, values.length)
  if (!count) { res.errors.push(`没找到 placeholder 含「${ph}」的输入框`); return res }

  for (let i = 0; i < res.total; i++) {
    const r = await fillInput(page, { selector: `[data-pdd-spec-idx="${i}"]`, value: values[i] })
    if (r.ok) res.filled++
    else res.errors.push(`第 ${i} 个: ${r.error}`)
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-pdd-spec-idx]').forEach(e => e.removeAttribute('data-pdd-spec-idx'))
    return true
  }).catch(() => { })

  res.ok = res.filled > 0
  return res
}

export { HELPERS }


