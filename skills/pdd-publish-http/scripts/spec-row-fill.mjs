/**
 * 发布组件 · 规格值逐行填写（通用版 v2）
 *
 * ★★ 2026-10-30 真机 dump 定论（改代码前必读）★★
 *
 *   规格区结构（#newSpec）：
 *     <div class="property-container-v2">
 *       <label>容量</label>
 *       <div class="row">
 *         <input type="checkbox" checked>              ← 平台自动勾选
 *         <input placeholder="自定义容量" value="350">   ← 值必须是**纯数字**
 *         <div class="IPT_appendCell">mL</div>         ← 单位，固定不可填
 *         <input placeholder="备注">
 *         <button>本地上传</button>
 *       </div>
 *     </div>
 *
 *   关键规则：
 *     ① **值是纯数字** —— 平台单位（mL/g/cm/码…）是页面固定的 appendCell div，
 *        不能把「250ml」整个填进去，只能填「250」。
 *     ② 单位 div 的识别：`[class*="appendCell"]` / `[class*="Append"]`
 *     ③ 填写流程：在**最后一个空 input** 键入数字 → 点空白失焦 →
 *        平台自动勾选 checkbox + 追加新行 → 继续
 *     ④ 不能按索引依次填（填完一个后平台重排，索引乱）
 *
 *   通用性：单位不写死，从 appendCell 实时读取（支持 mL/g/kg/cm/码/件/包…）
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 从「带单位的值」里剥离出纯数字
 *
 * ★ 2026-10-30 用户指出：「这个是纸杯，拿其他的单位呢」
 *   → 不能用硬编码的单位白名单（mL/g/cm/码…），那样每遇新类目就要加一条。
 *
 *   通用做法：**优先用页面实际单位**（appendCell 里读到的），
 *   页面单位为空时，用「末尾非数字字符」的通用规则剥离。
 *
 *   例：
 *     页面单位 "mL" + 值 "250ml"  → "250"
 *     页面单位 "码" + 值 "110码"  → "110"
 *     页面单位 "W"  + 值 "65W"   → "65"
 *     页面单位 ""   + 值 "250ml" → "250"（末尾非数字一律剥离）
 *     页面单位 ""   + 值 "40x40cm" → "40x40"（保留 x，只剥末尾单位）
 *
 * @param raw 原始值
 * @param unit 页面 appendCell 读到单位（空字符串表示页面无单位）
 * @returns 纯数字（或纯数字+分隔符）字符串
 */
export function stripUnit(raw, unit = '') {
  let v = String(raw || '').trim()
  if (!v) return ''

  // ① 页面有单位 → 精确剥离该单位（大小写不敏感）
  const u = String(unit || '').trim()
  if (u && v.toLowerCase().endsWith(u.toLowerCase())) {
    return v.slice(0, v.length - u.length).trim()
  }

  // ② 页面无单位 → 通用规则：剥离末尾「非数字非小数点非 x/*」的字符
  //    （保留 40x40 这种尺寸表达式里的 x）
  const m = v.match(/^([\d.,\s]+(?:[x*×][\d.,\s]+)*)\s*[^\d.,\s]*$/i)
  if (m && m[1] && /\d/.test(m[1])) {
    return m[1].replace(/\s+/g, '').trim()
  }

  // ③ 兜底：如果整串都是数字（含小数），原样返回
  if (/^[\d.,]+$/.test(v)) return v

  return v
}

/**
 * 读取规格区完整状态（含单位、checkbox、备注）
 */
async function readSpecState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#newSpec')
    if (!root) return { error: 'no #newSpec' }

    // 所有文本输入框（排除备注/排序）
    const all = [...root.querySelectorAll('input[type=text], input:not([type])')]
      .filter(e => {
        const ph = e.placeholder || ''
        if (ph === '备注' || ph.includes('排序')) return false
        const r = e.getBoundingClientRect()
        return r.width > 20 && r.height > 10
      })

    const inputs = all.map((e, i) => {
      const r = e.getBoundingClientRect()

      // 找单位 appendCell（向上找 5 层）
      let unit = ''
      let box = e.parentElement
      for (let d = 0; d < 5 && box; d++) {
        const app = box.querySelector('[class*="appendCell"], [class*="Append"]')
        if (app) { unit = (app.textContent || '').trim(); break }
        box = box.parentElement
      }

      // 找同行 checkbox
      let checked = null
      let cbox = e.parentElement
      for (let d = 0; d < 8 && cbox; d++) {
        const cb = cbox.querySelector('input[type=checkbox]')
        if (cb) { checked = cb.checked; break }
        cbox = cbox.parentElement
      }

      return {
        i,
        ph: e.placeholder || '',
        val: (e.value || '').trim(),
        unit,
        checked,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      }
    })

    return {
      inputs,
      inputCount: inputs.length,
      filledCount: inputs.filter(x => x.val).length,
      emptyCount: inputs.filter(x => !x.val).length,
      checkedCount: inputs.filter(x => x.checked === true).length,
      unit: inputs.find(x => x.unit)?.unit || '',
    }
  }).catch(e => ({ error: e.message }))
}

/**
 * 触发失焦（真实鼠标点「商品规格」label 的安全空白区）
 */
async function triggerBlur(page) {
  const pt = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(e => (e.innerText || '').trim() === '商品规格')
    if (label) {
      const r = label.getBoundingClientRect()
      if (r.width > 10) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }
    const root = document.querySelector('#newSpec')
    if (root) {
      const r = root.getBoundingClientRect()
      return { x: Math.round(r.x + 8), y: Math.round(r.y + 8) }
    }
    return null
  }).catch(() => null)

  if (pt) {
    await Promise.race([
      page.mouse.click(pt.x, pt.y).catch(() => {}),
      new Promise(r => setTimeout(r, 2500)),
    ]).catch(() => {})
  }
  await sleep(600)
}

/**
 * 逐行填规格值（通用版）
 *
 * @param page
 * @param dimName 维度名（容量/型号/尺寸…）
 * @param values  原始值数组（可带单位，如 ['250ml','350ml'] 或 ['250','350']）
 * @param opts { log? }
 * @returns { filled, missed, stripped }
 */
export async function fillSpecValuesRowByRow(page, dimName, values, opts = {}) {
  const log = opts.log || (() => {})
  const rawVals = (values || [])
    .map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim())
    .filter(Boolean)

  if (!rawVals.length) return { filled: [], missed: [], stripped: [] }

  const filled = []
  const missed = []
  const stripped = []

  // 初始状态
  let state = await readSpecState(page)
  if (state.error) {
    log(`[spec-row] 读取规格区失败：${state.error}`)
    return { filled: [], missed: rawVals.map(v => `${dimName}=${v}（规格区读取失败）`), stripped: [] }
  }
  const pageUnit = state.unit || ''
  log(`[spec-row] 初始：${state.inputCount} 个输入框（${state.filledCount} 已填 / ${state.emptyCount} 空），页面上单位「${pageUnit || '无'}」`)

  for (let vi = 0; vi < rawVals.length; vi++) {
    const raw = rawVals[vi]
    // ★ 关键：剥离单位，只填数字
    const v = stripUnit(raw, pageUnit)
    if (v !== raw) {
      stripped.push(`${raw} → ${v}`)
      log(`[spec-row] 值「${raw}」剥离单位 → 「${v}」（页面单位「${pageUnit}」）`)
    }

    let ok = false

    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      // ① 重新读状态
      state = await readSpecState(page)
      if (state.error || !state.inputs.length) break

      // ② 找「最后一个空框」
      const emptyInputs = state.inputs.filter(x => !x.val)
      const target = emptyInputs.length
        ? emptyInputs[emptyInputs.length - 1]
        : state.inputs[state.inputs.length - 1]

      // ③ 真实鼠标点击 + 键盘输入
      //    ★ 2026-10-30 用户提供精确 XPath：
      //      //*[@id="newSpec"]/div[2]/div/div/div/div[1]/div[2]/div[1]/div/div[2]/div/div/div/span/div/div/div[1]/div/div/input
      //      用 XPath 精确聚焦，比坐标点击可靠
      const focused = await page.evaluate((idx) => {
        const root = document.querySelector('#newSpec')
        if (!root) return false
        // 用 XPath 精确定位所有「自定义」输入框
        const xpath = './/input[contains(@placeholder,"自定义")]'
        const result = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        const elems = []
        for (let i = 0; i < result.snapshotLength; i++) {
          const el = result.snapshotItem(i)
          const r = el.getBoundingClientRect()
          if (r.width > 20 && r.height > 10) elems.push(el)
        }
        // 找最后一个空的
        const empties = elems.filter(e => !(e.value || '').trim())
        const target = empties.length ? empties[empties.length - 1] : elems[elems.length - 1]
        if (!target) return false
        target.scrollIntoView({ block: 'center' })
        target.focus()
        target.click()
        return true
      }, target.i).catch(() => false)

      if (!focused) {
        // 兜底：坐标点击
        await Promise.race([
          page.mouse.click(target.x, target.y).catch(() => {}),
          new Promise(r => setTimeout(r, 2500)),
        ]).catch(() => {})
      }
      await sleep(350)

      // 确认焦点已在输入框上
      const focusOk = await page.evaluate(() => {
        const a = document.activeElement
        return a && a.tagName === 'INPUT' && (a.placeholder || '').includes('自定义')
      }).catch(() => false)
      if (!focusOk) {
        // 再试一次坐标点击
        await Promise.race([
          page.mouse.click(target.x, target.y).catch(() => {}),
          new Promise(r => setTimeout(r, 2500)),
        ]).catch(() => {})
        await sleep(300)
      }

      await page.keyboard.down('Control').catch(() => {})
      await page.keyboard.press('KeyA').catch(() => {})
      await page.keyboard.up('Control').catch(() => {})
      await page.keyboard.press('Backspace').catch(() => {})
      await sleep(120)
      await page.keyboard.type(v, { delay: 50 }).catch(() => {})
      await sleep(500)

      // 立刻回读：确认值真的进去了
      const typedIn = await page.evaluate(() => {
        const root = document.querySelector('#newSpec')
        if (!root) return ''
        const xpath = './/input[contains(@placeholder,"自定义")]'
        const result = document.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        for (let i = 0; i < result.snapshotLength; i++) {
          const el = result.snapshotItem(i)
          const r = el.getBoundingClientRect()
          if (r.width > 20 && r.height > 10 && (el.value || '').trim()) return el.value.trim()
        }
        return ''
      }).catch(() => '')
      if (!typedIn) {
        log(`[spec-row] ⚠ 键入后输入框为空（焦点可能没进）`)
      }

      // ④ 触发提交：多种方式依次尝试（真实键盘 + 失焦）
      //    ★ 2026-10-30 实测：单靠失焦不稳定，Enter 才是 beast-core 的提交键
      await page.keyboard.press('Enter').catch(() => {})
      await sleep(500)
      let after = await readSpecState(page)
      let strip1 = s => stripUnit(String(s || '').trim(), after.unit || pageUnit)
      let accepted = (after.inputs || []).some(x => {
        const xv = String(x.val || '').trim()
        return xv === v || strip1(xv) === v || xv === raw
      })
      if (!accepted) {
        // Enter 没生效 → 点空白失焦
        await triggerBlur(page)
        await sleep(800)
        after = await readSpecState(page)
        strip1 = s => stripUnit(String(s || '').trim(), after.unit || pageUnit)
        accepted = (after.inputs || []).some(x => {
          const xv = String(x.val || '').trim()
          return xv === v || strip1(xv) === v || xv === raw
        })
      }
      if (!accepted) {
        // 还不行 → Tab 失焦
        await page.keyboard.press('Tab').catch(() => {})
        await sleep(700)
        after = await readSpecState(page)
        strip1 = s => stripUnit(String(s || '').trim(), after.unit || pageUnit)
        accepted = (after.inputs || []).some(x => {
          const xv = String(x.val || '').trim()
          return xv === v || strip1(xv) === v || xv === raw
        })
      }
      ok = accepted

      if (ok) {
        log(`[spec-row] 「${v}」✅（${after.inputCount} 框 / ${after.filledCount} 已填 / ${after.checkedCount} 勾选）`)
      } else {
        log(`[spec-row] 「${v}」第 ${attempt + 1} 次未成功（${after.inputCount} 框 / ${after.filledCount} 已填 / ${after.checkedCount} 勾选，当前值：${(after.inputs || []).map(x => x.val || '空').join('/')}）`)
        await sleep(700)
      }
    }

    if (ok) filled.push(`${dimName}=${v}`)
    else missed.push(`${dimName}=${v}（3 次未提交成功）`)
  }

  // ★ 2026-10-30 真机定论：**最后一个值的 checkbox 经常不自动勾选**，
  //   导致 SKU 表少 1 行（3 个规格值只生成 2 行）。
  //   所以填完后必须**把所有未勾选的规格行勾上**。
  const checked = await page.evaluate(() => {
    const root = document.querySelector('#newSpec')
    if (!root) return 0
    let n = 0
    for (const row of root.querySelectorAll('.package-item-container, [class*="package-item"]')) {
      const cb = row.querySelector('input[type=checkbox]')
      if (cb && !cb.checked) {
        // 只勾**有值**的行（空行不勾）
        const hasValue = [...row.querySelectorAll('input[type=text], input:not([type])')]
          .some(e => (e.value || '').trim() && !(e.placeholder || '').includes('备注'))
        if (hasValue) {
          cb.click()
          n++
        }
      }
    }
    return n
  }).catch(() => 0)
  if (checked > 0) {
    log(`[spec-row] 补勾 ${checked} 个未勾选的规格行`)
    await sleep(800)
  }

  return { filled, missed, stripped }
}
