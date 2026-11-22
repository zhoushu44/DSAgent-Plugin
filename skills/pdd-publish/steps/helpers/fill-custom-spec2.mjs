/**
 * fill-custom-spec2.mjs — 「定制规格」界面填充（按实测三步流程）
 *
 * ★ 每个维度重复：
 *   ① 点 #spec 里的「添加规格类型(N/2)」button
 *   ② 等 input[placeholder="规格类型N"] 出现
 *   ③ 下拉 ul[role="listbox"] li[role="option"] 选维度名
 *
 *   ★ 值：input[placeholder="请输入规格名称"]，不够就点「添加定制规格」
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function clickAddDimensionBtn(page, log) {
  const r = await page.evaluate(() => {
    const norm = s => String(s || '').replace(/\s+/g, '')
    // ★ 按钮文字可能是「添加规格类型(0/2)」「添加规格类型(1/2)」等，用包含匹配
    const match = (e) => {
      const t = norm(e.innerText)
      if (!/添加规格类型/.test(t)) return false
      if (/AI/.test(t)) return false
      const r = e.getBoundingClientRect()
      return r.width > 5 && r.height > 5
    }
    const scope = document.querySelector('#spec') || document
    let b = [...scope.querySelectorAll('button')].find(match)
    let via = '#spec button'
    if (!b) { b = [...document.querySelectorAll('button')].find(match); via = 'global' }
    if (!b) {
      // 兜底：任何元素
      b = [...document.querySelectorAll('a, span, div')].find(match)
      via = 'fallback'
    }
    if (!b) return { ok: false, reason: '找不到「添加规格类型」按钮' }
    b.scrollIntoView({ block: 'center' })
    b.click()
    return { ok: true, via, text: (b.innerText || '').replace(/\s+/g, '') }
  }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
  log(`   ① 点添加规格类型 → ${JSON.stringify(r)}`)
  return r
}

async function waitDimNameInput(page, n, log) {
  const sel = `input[placeholder="规格类型${n}"]`
  let found = false
  for (let i = 0; i < 50; i++) {
    found = await page.evaluate(s => !!document.querySelector(s), sel).catch(() => false)
    if (found) break
    await sleep(200)
  }
  log(`   ② 规格类型${n} ${found ? '✅ 出现' : '❌ 未出现'}`)
  if (!found) return false

  // ★ 关键：必须点这个输入框才会弹下拉
  const clicked = await page.evaluate((s) => {
    const inp = document.querySelector(s)
    if (!inp) return false
    inp.scrollIntoView({ block: 'center' })
    inp.focus()
    inp.click()
    // 补发鼠标事件，确保下拉触发
    inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    inp.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    inp.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, sel).catch(() => false)
  log(`   ② 点规格类型${n} 输入框 → ${clicked ? '✅' : '❌'}`)
  await sleep(600)
  return true
}

async function pickDimension(page, want, log) {
  for (let i = 0; i < 50; i++) {
    const has = await page.evaluate(() => !!document.querySelector('ul[role="listbox"]')).catch(() => false)
    if (has) break
    await sleep(200)
  }
  const r = await page.evaluate((wantName) => {
    const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
    const lb = document.querySelector('ul[role="listbox"]')
    if (!lb) return { ok: false, reason: '下拉未出现' }
    const opts = [...lb.querySelectorAll('li[role="option"]')].filter(it => {
      const rr = it.getBoundingClientRect()
      return rr.width > 10 && rr.height > 5
    })
    if (!opts.length) return { ok: false, reason: '无可见选项' }
    const pureOf = (el) => {
      const w = el.querySelector('div')
      if (w) {
        for (const n of w.childNodes) {
          if (n.nodeType === 3) { const t = norm(n.textContent); if (t) return t }
        }
      }
      return norm(el.textContent).replace(/(常用|热门|推荐)$/, '')
    }
    let hit = opts.find(it => pureOf(it) === wantName)
    if (!hit) hit = opts.find(it => pureOf(it).startsWith(wantName))
    if (!hit) hit = opts.find(it => pureOf(it).includes(wantName))
    if (!hit) hit = opts[0]
    const pure = pureOf(hit)
    hit.click()
    return { ok: true, picked: pure, total: opts.length, first8: opts.slice(0, 8).map(pureOf) }
  }, want).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
  log(`   ③ 下拉选「${want}」→ ${JSON.stringify(r)}`)
  return r
}

async function fillValuesInBlock(page, dimIdx, values, log) {
  const results = []
  for (let vi = 0; vi < values.length; vi++) {
    const v = String(values[vi])
    const r = await page.evaluate(async (args) => {
      const { dimIdx, valIdx, val } = args
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))
      const norm = s => String(s || '').replace(/[\s\u3000]/g, ' ').trim()

      const anchors = [...document.querySelectorAll('a, span, button, div')].filter(e =>
        /^删除规格类型$/.test(norm(e.innerText)) && e.getBoundingClientRect().width > 10)
      const blocks = []
      for (const a of anchors) {
        let box = a.parentElement
        for (let d = 0; d < 8 && box; d++) {
          if (/添加定制规格|开始排序/.test(box.innerText || '')) break
          box = box.parentElement
        }
        if (box && !blocks.some(x => x === box || x.contains(box) || box.contains(x))) blocks.push(box)
      }
      const box = blocks[dimIdx]
      if (!box) return { ok: false, reason: `第 ${dimIdx + 1} 块不存在（共 ${blocks.length}）` }

      const getVals = () => [...box.querySelectorAll('input[placeholder="请输入规格名称"]')]
      let ins = getVals()

      if (valIdx >= ins.length) {
        const addBtn = [...box.querySelectorAll('a, span, button, div')].find(e => {
          const t = norm(e.innerText)
          return /^添加定制规格$/.test(t) && e.getBoundingClientRect().width > 10
        })
        if (!addBtn) return { ok: false, reason: '找不到「添加定制规格」', existing: ins.length }
        addBtn.scrollIntoView({ block: 'center' })
        addBtn.click()
        await sleepIn(900)
        ins = getVals()
      }

      const inp = ins[valIdx]
      if (!inp) return { ok: false, reason: `第 ${valIdx + 1} 个值框不存在（共 ${ins.length}）` }

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      inp.focus()
      if (setter) setter.call(inp, val); else inp.value = val
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      await sleepIn(200)
      inp.dispatchEvent(new Event('blur', { bubbles: true }))
      await sleepIn(300)

      // ★ 每写一个值就点一次空白（这是实测能生成 4 行的版本）
      try {
        const label = document.querySelector('.Form_itemLabelWrapper_5-194-0, label.Form_itemLabelContent_5-194-0')
        if (label) { label.scrollIntoView({ block: 'center' }); label.click() }
        else document.body.click()
        await sleepIn(700)
      } catch { }

      const nowVals = [...box.querySelectorAll('input[placeholder="请输入规格名称"]')].map(e => e.value)
      return { ok: true, valueNow: inp.value, total: ins.length, allVals: nowVals }
    }, { dimIdx, valIdx: vi, val: v }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

    results.push({ value: v, ...r })
    log(`   值「${v}」→ ${r.ok ? '✅ ' + r.valueNow : '❌ ' + r.reason}`)
    await sleep(150)
  }

  return results
}

export async function fillCustomSpec(page, specs, opts = {}) {
  const log = opts.log || (() => { })
  const result = { ok: false, mode: 'custom-spec', dims: [], errors: [] }

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    log(`── 维度 ${i + 1}/${specs.length}「${spec.name}」──`)

    const clicked = await clickAddDimensionBtn(page, log)
    if (!clicked.ok) {
      result.errors.push(`维度${i + 1}: ${clicked.reason}`)
      result.dims.push({ name: spec.name, values: [], ok: false })
      continue
    }

    await waitDimNameInput(page, i + 1, log)

    let picked = await pickDimension(page, spec.name, log)
    if (!picked.ok) {
      log('   重试：点维度名输入框重开下拉')
      await page.evaluate((n) => {
        const inp = document.querySelector(`input[placeholder="规格类型${n}"]`)
        if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click() }
      }, i + 1).catch(() => { })
      await sleep(1200)
      picked = await pickDimension(page, spec.name, log)
    }
    if (!picked.ok) result.errors.push(`维度${i + 1} ${spec.name}: 选维度失败`)

    await sleep(1500)

    const vals = await fillValuesInBlock(page, i, spec.values, log)
    const ok = vals.every(x => x.ok)
    result.dims.push({ name: spec.name, values: vals, ok })
    if (!ok) result.errors.push(`${spec.name}: ` + vals.filter(x => !x.ok).map(x => x.reason).join('; '))

    await sleep(300)
  }

  result.ok = result.dims.length === specs.length && result.dims.every(d => d.ok)
  return result
}

export default fillCustomSpec
