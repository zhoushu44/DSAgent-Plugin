/**
 * fill-ingredient-list.mjs — 成分列表组件（如「材质成分」）
 *
 * 页面结构（实测 童装家居服 catId=15021）：
 *
 *   <div data-testid="beast-core-form-item" id="basic.propertys.15.value">
 *     <span class="Form_itemRequired">*</span><label>材质成分</label>
 *     <button data-testid="beast-core-button">
 *       <span class="IngredientList_addBtn__2njWF">
 *         <svg data-testid="beast-core-icon-plus"/>
 *         添加材质成分(0/7)
 *       </span>
 *     </button>
 *   </div>
 *
 *   点按钮 → 弹出面板：
 *   <div class="IngredientList_checkItem__1BYPY">
 *     <label data-testid="beast-core-checkbox" data-checked="false">
 *       <input type="checkbox">
 *       <div class="CBX_textWrapper"><div>棉</div></div>
 *     </label>
 *   </div>
 *   ...
 *   <button data-testid="beast-core-button"><span>确定(1/7)</span></button>
 *
 * 流程：
 *   ① 点「添加XXX(N/M)」按钮
 *   ② 等弹出面板（IngredientList_checkItem 出现）
 *   ③ 按文字点对应 checkbox 的 label
 *   ④ 点「确定(N/M)」按钮
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 判断某个 form-item 是不是成分列表组件
 * @returns {Promise<{ok:boolean, selected?:number, max?:number, btnText?:string}>}
 */
export async function probeIngredientList(page, formItemId) {
  return page.evaluate((fid) => {
    const el = document.getElementById(fid)
    if (!el) return { ok: false }
    const btn = [...el.querySelectorAll('button')].find(b => /添加.*\(\d+\/\d+\)/.test((b.innerText || '').replace(/\s+/g, '')))
    if (!btn) return { ok: false }
    const t = (btn.innerText || '').replace(/\s+/g, '')
    const m = t.match(/\((\d+)\/(\d+)\)/)
    return { ok: true, selected: m ? Number(m[1]) : 0, max: m ? Number(m[2]) : 0, btnText: t }
  }, formItemId).catch(() => ({ ok: false }))
}

/**
 * 填成分列表
 * @param {object} page
 * @param {string} formItemId   如 basic.propertys.15.value
 * @param {string[]} values     要勾选的成分名，如 ['涤纶（聚酯纤维）']
 * @param {object} [log]
 */
export async function fillIngredientList(page, formItemId, values, log = () => { }) {
  const res = { ok: false, mode: 'ingredient', picked: [], missing: [] }

  // ① 点「添加XXX(N/M)」
  const opened = await page.evaluate((fid) => {
    const el = document.getElementById(fid)
    if (!el) return { ok: false, reason: '找不到 form-item' }
    const btn = [...el.querySelectorAll('button')].find(b => /添加.*\(\d+\/\d+\)/.test((b.innerText || '').replace(/\s+/g, '')))
    if (!btn) return { ok: false, reason: '找不到「添加XX(N/M)」按钮' }
    btn.scrollIntoView({ block: 'center' })
    btn.click()
    return { ok: true, btnText: (btn.innerText || '').replace(/\s+/g, '') }
  }, formItemId).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
  log(`      ① 点「${opened.btnText || '?'}」→ ${opened.ok ? '✅' : '❌ ' + opened.reason}`)
  if (!opened.ok) return { ...res, error: opened.reason }

  // ② 等面板出现
  let panelOk = false
  for (let i = 0; i < 30; i++) {
    panelOk = await page.evaluate(() => document.querySelectorAll('[class*="IngredientList_checkItem"]').length > 0).catch(() => false)
    if (panelOk) break
    await sleep(200)
  }
  if (!panelOk) return { ...res, error: '成分面板未出现' }

  // ③ 逐个勾选
  for (const v of values) {
    const picked = await page.evaluate((want) => {
      const items = [...document.querySelectorAll('[class*="IngredientList_checkItem"]')]
      for (const it of items) {
        const box = it.querySelector('[data-testid="beast-core-checkbox"]')
        if (!box) continue
        // 文字在 CBX_textWrapper 里
        const txt = (box.innerText || '').replace(/\s+/g, '').trim()
        if (txt === want || txt.includes(want) || want.includes(txt)) {
          const already = box.getAttribute('data-checked') === 'true'
          if (already) return { ok: true, already: true, text: txt }
          box.click()
          return { ok: true, text: txt }
        }
      }
      const all = items.map(it => (it.innerText || '').replace(/\s+/g, '').trim()).filter(Boolean)
      return { ok: false, available: all.slice(0, 30) }
    }, v).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

    if (picked.ok) {
      res.picked.push(picked.text)
      log(`      ③ 勾选「${picked.text}」${picked.already ? '（已选）' : ''} ✅`)
    } else {
      res.missing.push(v)
      log(`      ③ 勾选「${v}」❌ 可选: ${(picked.available || []).slice(0, 8).join('/')}`)
    }
    await sleep(300)
  }

  // ④ 点「确定(N/M)」
  const confirmed = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /^确定\(\d+\/\d+\)$/.test((b.innerText || '').replace(/\s+/g, '')))
    const enabled = btns.find(b => !b.disabled)
    if (!enabled) return { ok: false, texts: btns.map(b => (b.innerText || '').replace(/\s+/g, '')) }
    enabled.scrollIntoView({ block: 'center' })
    enabled.click()
    return { ok: true, text: (enabled.innerText || '').replace(/\s+/g, '') }
  }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
  log(`      ④ 点「${confirmed.text || '?'}」→ ${confirmed.ok ? '✅' : '❌'}`)

  if (!confirmed.ok) return { ...res, error: '点不到「确定」按钮' }
  await sleep(1200)

  // ⑤ 回读：按钮计数应变成 (N/M)
  const after = await probeIngredientList(page, formItemId)
  res.ok = res.picked.length > 0 && !res.missing.length && after.selected > 0
  res.after = after
  log(`      ⑤ 回读：已选 ${after.selected}/${after.max}`)
  return res
}

export default fillIngredientList
