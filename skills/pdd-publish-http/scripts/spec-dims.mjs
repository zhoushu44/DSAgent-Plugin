/**
 * SKU 组件 · ① 规格维度填写
 *
 * 职责：把「用户写的维度名 + 值」填进拼多多规格区，按页面真实结构自适应。
 * 不做价格、不做预览图（那两块在 sku-price.mjs / sku-thumb.mjs）。
 *
 * 四类页面结构 → 四种填法（全类目通用）：
 *   ① input[placeholder*="主色"]              颜色输入框   → 真实键盘键入
 *   ② input[placeholder="自定义尺码"]          自定义尺码   → 取最后一个空框键入
 *   ③ .package-item-container checkbox         预设值       → 精确/语义匹配，匹配不到自定义添加
 *   ④ 都没有                                    → 点「添加规格类型」新建维度
 *
 * ★ 铁律：规格值必须 page.keyboard.type（平台只认真实键盘事件才注册 spec_id）
 */
import * as fs from 'node:fs'

const SPEC_ROOT = '#goods-spec-sku'

/* ══════════════ 基础工具 ══════════════ */

export async function jsClick(page, x, y) {
  await page.evaluate((px, py) => {
    const el = document.elementFromPoint(px, py)
    if (!el) return false
    let t = el
    for (let i = 0; i < 5 && t; i++) {
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'LABEL' || tag === 'BUTTON' || tag === 'A') break
      t = t.parentElement
    }
    ;(t || el).click()
    try { (t || el).focus?.() } catch { /* ignore */ }
    return true
  }, x, y).catch(() => {})
}

export async function jsBlur(page) {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
    document.body.click()
  }).catch(() => {})
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ══════════════ 维度扫描 ══════════════ */

/**
 * 扫规格区所有维度：名字 + 类型 + 索引
 * type: color-input | custom-input | checkbox | spec-type
 */
export async function scanDims(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return { dims: [] }
    const containers = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
    const dims = containers.map((c, idx) => {
      // 维度名：优先 .property-name-title / .sizeStandardWrapper_title / 规格类型 input 的 value
      let dim = c.querySelector('.property-name-title')?.textContent?.trim()
        || c.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent?.trim()
        || c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
        || ''
      // 去掉尾部噪声（添加图片/删除规格类型等按钮文字）
      dim = dim.replace(/添加图片|删除规格类型|添加定制规格/g, '').trim()

      // 类型判定优先级：color-input > checkbox（有文本）> custom-input > spec-type
      const hasColorInput = !!c.querySelector('input[placeholder*="主色"]')
      const checkboxes = [...c.querySelectorAll('.package-item-container')]
        .filter(it => (it.querySelector('.check-wrapper')?.textContent?.trim() || '').length > 0)
      const hasCustomInput = [...c.querySelectorAll('input')].some(e => (e.placeholder || '').includes('自定义') && !(e.placeholder || '').includes('排序'))
      const isSpecType = /\d/.test(dim) || dim.startsWith('规格类型') || !!c.querySelector('input[placeholder^="规格类型"]')

      let type = 'spec-type'
      if (hasColorInput) type = 'color-input'
      else if (checkboxes.length) type = 'checkbox'
      else if (hasCustomInput) type = 'custom-input'

      return { idx, dim, type, checkboxCount: checkboxes.length }
    })
    return { dims }
  }, SPEC_ROOT).catch(() => ({ dims: [] }))
}

/**
 * 用户维度名 → 页面维度匹配
 * 精确 → 包含 → 语义等价表（颜色/尺码/款式/型号/容量/口味/材质）
 */
export function matchDim(userDim, dims) {
  const u = String(userDim || '').trim()
  if (!u) return null
  let hit = dims.find(d => d.dim === u)
  if (hit) return hit
  hit = dims.find(d => {
    const p = d.dim
    return (p.includes(u) || u.includes(p)) && Math.min(p.length, u.length) >= 2
  })
  if (hit) return hit
  const EQUIV = [
    [/^(颜色|色彩|花色|配色|颜色分类)$/, ['颜色分类', '颜色', '色彩', '花色', '配色', '色号', '色号分类']],
    [/^(尺码|尺寸|大小|码数|参考分类)$/, ['参考分类', '尺码', '尺寸', '大小', '身高', '适合身高']],
    [/^(款式|样式|版型|风格|系列|外观)$/, ['款式', '样式', '版型', '风格', '系列', '花型']],
    [/^(型号|规格|型号规格)$/, ['型号', '规格']],
    [/^(容量|净含量|体积)$/, ['容量', '净含量', '重量']],
    [/^(口味|味道|风味)$/, ['口味', '香型', '味道']],
    [/^(材质|材料|面料)$/, ['材质', '材料', '面料']],
  ]
  for (const [re, names] of EQUIV) {
    if (!re.test(u)) continue
    hit = dims.find(d => names.includes(d.dim))
    if (hit) return hit
  }
  return null
}

/* ══════════════ ① 颜色输入框 ══════════════ */

export async function fillColorInputs(page, dimIdx, values) {
  const log = []
  for (const v of values) {
    // 取第一个空的主色输入框
    let pos = await page.evaluate((sel, ci) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      const inps = [...c.querySelectorAll('input[placeholder*="主色"]')]
      const inp = inps.find(e => !(e.value || '').trim()) || inps[inps.length - 1]
      if (!inp) return null
      inp.scrollIntoView({ block: 'center' })
      const r = inp.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, SPEC_ROOT, dimIdx)
    if (!pos) { log.push({ v, ok: false, via: 'no-box' }); continue }

    await sleep(300)
    pos = await page.evaluate((sel, ci) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      const inps = [...c.querySelectorAll('input[placeholder*="主色"]')]
      const inp = inps.find(e => !(e.value || '').trim()) || inps[inps.length - 1]
      if (!inp) return null
      const r = inp.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, SPEC_ROOT, dimIdx)
    if (!pos) { log.push({ v, ok: false, via: 'no-box-2' }); continue }

    await jsClick(page, pos.x, pos.y)
    await sleep(400)
    await page.keyboard.type(String(v), { delay: 45 })
    await sleep(300)
    await jsBlur(page)
    await sleep(1200)

    const back = await page.evaluate((sel, ci, val) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      return [...(c?.querySelectorAll('input[placeholder*="主色"]') || [])].some(e => (e.value || '').trim() === val)
    }, SPEC_ROOT, dimIdx, String(v))
    log.push({ v, ok: !!back, via: 'color-input' })
  }
  return log
}

/* ══════════════ ② 自定义输入框（新维度 / 自定义尺码） ══════════════ */

export async function fillCustomInputs(page, dimIdx, phKeyword, values) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    // 定位第一个空框
    let pos = await page.evaluate((sel, ci) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      let els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && !p.includes('排序') && r.y > 0 && r.width > 30
      })
      if (!els.length) {
        els = [...c.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return r.y > 0 && r.width > 30
            && !p.startsWith('规格类型') && !p.startsWith('规格名称')
            && !/请输入品牌|请选择|大于|~|备注/.test(p)
            && (e.type === 'text' || !e.type)
        })
      }
      const empty = els.find(e => !e.value)
      const el = empty || els[els.length - 1]
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      return { scrollOnly: true }
    }, SPEC_ROOT, dimIdx)
    if (!pos?.scrollOnly) { log.push({ v: values[i], ok: false, via: 'no-box' }); continue }

    await sleep(400)
    pos = await page.evaluate((sel, ci) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      let els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && !p.includes('排序') && r.y > 0 && r.width > 30
      })
      if (!els.length) {
        els = [...c.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return r.y > 0 && r.width > 30
            && !p.startsWith('规格类型') && !p.startsWith('规格名称')
            && !/请输入品牌|请选择|大于|~|备注/.test(p)
            && (e.type === 'text' || !e.type)
        })
      }
      const empty = els.find(e => !e.value)
      const el = empty || els[els.length - 1]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, SPEC_ROOT, dimIdx)
    if (!pos?.x) { log.push({ v: values[i], ok: false, via: 'no-pos' }); continue }

    // 真实键盘键入 → Enter → blur
    await jsClick(page, pos.x, pos.y)
    await sleep(500)
    await page.keyboard.type(String(values[i]), { delay: 40 })
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(1200)

    // 读回；被清则重键入一次
    const readVal = () => page.evaluate((sel, ci, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return ''
      let els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && !p.includes('排序') && r.y > 0 && r.width > 30
      })
      if (!els.length) {
        els = [...c.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return r.y > 0 && r.width > 30 && !p.startsWith('规格类型') && !p.startsWith('规格名称')
            && !/请输入品牌|请选择|大于|~|备注/.test(p) && (e.type === 'text' || !e.type)
        })
      }
      return els[idx]?.value || ''
    }, SPEC_ROOT, dimIdx, i).catch(() => '')

    let back = await readVal()
    if (!back) {
      await jsClick(page, pos.x, pos.y)
      await sleep(300)
      await page.keyboard.type(String(values[i]), { delay: 40 })
      await sleep(400)
      await page.keyboard.press('Enter')
      await sleep(1000)
      back = await readVal()
    }
    await jsBlur(page)
    await sleep(1200)
    log.push({ v: values[i], ok: !!back, via: 'custom-input' })
  }
  return log
}

/* ══════════════ ③ 自定义尺码 ══════════════ */

export async function fillCustomSize(page, dimIdx, value) {
  await page.evaluate((sel, ci) => {
    const root = document.querySelector(sel)
    const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
    c?.querySelector('input[placeholder="自定义尺码"]')?.scrollIntoView({ block: 'center' })
  }, SPEC_ROOT, dimIdx)
  await sleep(400)

  const pos = await page.evaluate((sel, ci) => {
    const root = document.querySelector(sel)
    const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
    if (!c) return null
    const inps = [...c.querySelectorAll('input[placeholder="自定义尺码"]')]
    const inp = inps.find(i => !(i.value || '').trim()) || inps[inps.length - 1]
    if (!inp) return null
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, SPEC_ROOT, dimIdx)
  if (!pos) return false

  await jsClick(page, pos.x, pos.y)
  await sleep(400)
  await page.keyboard.type(String(value), { delay: 50 })
  await sleep(300)
  await jsBlur(page)
  await sleep(1500)

  const back = await page.evaluate((sel, ci, val) => {
    const root = document.querySelector(sel)
    const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
    return [...(c?.querySelectorAll('input[placeholder="自定义尺码"]') || [])].some(i => (i.value || '').trim() === val)
  }, SPEC_ROOT, dimIdx, String(value))
  return !!back
}

/* ══════════════ ④ 预设 checkbox ══════════════ */

export async function checkBoxes(page, dimIdx, values) {
  const log = []
  for (const v of values) {
    const clean = String(v).replace(/(cm|厘米|ml|mL|L|l|g|kg|G|KG)$/i, '').trim()

    // ① 精确匹配（原值 / 去单位）
    const hit = await page.evaluate((sel, ci, val, cleanV) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return { found: false, cands: [] }
      const cands = []
      for (const item of c.querySelectorAll('.package-item-container')) {
        const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (!txt) continue
        cands.push(txt)
        if (txt === val || txt === cleanV) {
          const cb = item.querySelector('input[type="checkbox"]')
          if (cb && !cb.checked) item.querySelector('label')?.click()
          return { found: true, txt, cands }
        }
      }
      return { found: false, cands }
    }, SPEC_ROOT, dimIdx, v, clean)
    if (hit.found) { log.push({ v, ok: true, via: 'checkbox', txt: hit.txt }); await sleep(400); continue }

    // ② 语义匹配（含单位/区间/字母码）
    const semHit = await page.evaluate((sel, ci, val, cleanV) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      const num = cleanV.match(/\d+/)?.[0]
      const letterMap = { S: ['S', '小码', 's'], M: ['M', '中码', 'm'], L: ['L', '大码', 'l'], XL: ['XL', '加大', 'xl'] }
      for (const item of c.querySelectorAll('.package-item-container')) {
        const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (!txt) continue
        let match = false
        if (num && txt.replace(/(cm|厘米|ml|mL|L|g|kg|码)$/i, '') === num) match = true
        else if (num && /[-~/]/.test(txt) && txt.includes(num)) match = true
        else if (letterMap[val]?.includes(txt)) match = true
        if (match) {
          const cb = item.querySelector('input[type="checkbox"]')
          if (cb && !cb.checked) item.querySelector('label')?.click()
          return txt
        }
      }
      return null
    }, SPEC_ROOT, dimIdx, v, clean)
    if (semHit) { log.push({ v, ok: true, via: 'semantic', txt: semHit }); await sleep(400); continue }

    // ③ 自定义输入添加
    const added = await addCustomCheckbox(page, dimIdx, v)
    if (added) { log.push({ v, ok: true, via: 'custom-add', txt: added }); await sleep(400); continue }

    log.push({ v, ok: false, via: 'none', cands: (hit.cands || []).slice(0, 20) })
  }
  return log
}

async function addCustomCheckbox(page, dimIdx, value) {
  const pos = await page.evaluate((sel, ci) => {
    const root = document.querySelector(sel)
    const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
    if (!c) return null
    const inp = [...c.querySelectorAll('input')].find(e => {
      const ph = e.placeholder || ''
      const r = e.getBoundingClientRect()
      return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
    })
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, SPEC_ROOT, dimIdx)
  if (!pos) return null

  await sleep(300)
  const pos2 = await page.evaluate((sel, ci) => {
    const root = document.querySelector(sel)
    const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
    if (!c) return null
    const inp = [...c.querySelectorAll('input')].find(e => {
      const ph = e.placeholder || ''
      const r = e.getBoundingClientRect()
      return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
    })
    if (!inp) return null
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, SPEC_ROOT, dimIdx)
  if (!pos2) return null

  await jsClick(page, pos2.x, pos2.y)
  await sleep(400)
  await page.keyboard.type(String(value), { delay: 50 })
  await sleep(200)
  await page.keyboard.press('Enter')
  await sleep(1500)

  const clean = String(value).replace(/(cm|厘米|ml|mL|L|l|g|kg|G|KG)$/i, '').trim()
  for (let w = 0; w < 8; w++) {
    await sleep(800)
    const checked = await page.evaluate((sel, ci, val, cleanV) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return null
      for (const item of c.querySelectorAll('.package-item-container')) {
        const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (txt === val || txt === cleanV) {
          const cb = item.querySelector('input[type="checkbox"]')
          if (cb && !cb.checked) item.querySelector('label')?.click()
          return txt
        }
      }
      return null
    }, SPEC_ROOT, dimIdx, value, clean)
    if (checked) return checked
  }
  return null
}

/* ══════════════ ⑤ 新建维度 ══════════════ */

export async function addDim(page, dimName) {
  const NEW_SPEC_BTN_XPATH = '//*[@id="newSpec"]/div[2]/div/div/div/div[4]/button/div'

  const clicked = await page.evaluate((xp) => {
    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const el = r.singleNodeValue
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, NEW_SPEC_BTN_XPATH).catch(() => false)
  if (!clicked) {
    // 兜底：按文本找「添加规格类型」
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /添加规格类型/.test(x.innerText || ''))
      b?.scrollIntoView({ block: 'center' })
      b?.click()
    }).catch(() => {})
  }
  await sleep(2500)

  // 新维度行尾的「规格类型」input，点开下拉选维度名
  const pos = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return null
    const rows = [...root.querySelectorAll('.goods-spec-row')]
    const last = rows[rows.length - 1]
    const inp = last?.querySelector('input[placeholder^="规格类型"]')
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, SPEC_ROOT)
  if (!pos) return false

  await jsClick(page, pos.x, pos.y)
  await sleep(1500)

  // 下拉里选维度名（精确 → 包含 → 常用后缀 → 第一个）
  const picked = await page.evaluate((name) => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')].filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return null
    const items = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
      .map(e => ({ el: e, t: (e.innerText || '').trim() }))
      .filter(x => x.t)
    if (!items.length) return null
    let hit = items.find(x => x.t === name)
      || items.find(x => x.t.includes(name) || name.includes(x.t))
      || items.find(x => x.t === name + '常用')
      || items.find(x => x.t.startsWith(name))
    if (!hit) hit = items[0]
    hit.el.click()
    return hit.t
  }, dimName).catch(() => null)

  await sleep(1500)
  const ok = await page.evaluate((sel, name) => {
    const root = document.querySelector(sel)
    if (!root) return false
    const rows = [...root.querySelectorAll('.goods-spec-row')]
    const last = rows[rows.length - 1]
    const v = last?.querySelector('input[placeholder^="规格类型"]')?.value || ''
    return v.includes(name) || name.includes(v)
  }, SPEC_ROOT, dimName).catch(() => false)
  return !!picked && ok
}

/* ══════════════ 主入口：只填维度 ══════════════ */

/**
 * 填规格维度（不填价格/预览图）
 * @param page Puppeteer page
 * @param specs [{ name, values: [string] }]
 * @param opts { onLog }
 * @returns { ok, dims: [{ user, page, type, values: [{v, ok, via}] }] }
 */
export async function fillSpecDims(page, specs, opts = {}) {
  const log = opts.onLog || (() => {})
  const result = { ok: false, dims: [] }

  if (!specs?.length) return { ok: true, dims: [] }

  // 等规格根节点
  log('等 #goods-spec-sku…')
  for (let i = 0; i < 20; i++) {
    await sleep(1500)
    if (await page.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)) break
    if (i === 19) return { ok: false, dims: [], message: '规格区超时' }
  }

  for (let di = 0; di < specs.length; di++) {
    const userSpec = specs[di]
    const userDim = userSpec.name
    const values = (userSpec.values || [])
      .map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim())
      .filter(Boolean)
    if (!values.length) continue

    let info = await scanDims(page)
    log(`[${di + 1}/${specs.length}] 「${userDim}」(${values.length} 值)  页面维度: ${info.dims.map(d => d.dim + '(' + d.type + ')').join(', ')}`)

    let target = matchDim(userDim, info.dims)

    // 匹配不到 → 新建
    if (!target) {
      log(`  预置没有「${userDim}」→ 点「添加规格类型」`)
      const ok = await addDim(page, userDim)
      if (!ok) {
        log(`  ❌ 下拉没有「${userDim}」`)
        result.dims.push({ user: userDim, page: '', type: '', values: values.map(v => ({ v, ok: false, via: 'add-dim-fail' })) })
        continue
      }
      info = await scanDims(page)
      target = matchDim(userDim, info.dims) || info.dims[info.dims.length - 1]
      if (target && /^规格类型/.test(target.dim)) {
        await sleep(2000)
        info = await scanDims(page)
        target = matchDim(userDim, info.dims) || info.dims[info.dims.length - 1]
      }
      log(`  新建后维度: ${info.dims.map(d => d.dim).join(', ')}`)
    }

    if (!target) { log('  ❌ 找不到目标维度'); continue }
    log(`  → 填到「${target.dim}」(${target.type})`)

    // 等输入框渲染（新建维度需要时间）
    if (target.type === 'spec-type') {
      for (let w = 0; w < 8; w++) {
        await sleep(1000)
        const hasBox = await page.evaluate((sel, ci) => {
          const root = document.querySelector(sel)
          const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
          const c = cs[ci]
          if (!c) return false
          return [...c.querySelectorAll('input')].some(e => {
            const ph = e.placeholder || ''
            const r = e.getBoundingClientRect()
            return r.y > 0 && r.width > 30 && !ph.startsWith('规格类型') && (e.type === 'text' || !e.type)
          })
        }, SPEC_ROOT, target.idx).catch(() => false)
        if (hasBox) break
      }
    }

    let vals = []
    if (target.type === 'checkbox') {
      // 有「自定义尺码」输入框 → 走自定义尺码（不勾预设）
      const hasCustomSize = await page.evaluate((sel, ci) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
        return !!c?.querySelector('input[placeholder="自定义尺码"]')
      }, SPEC_ROOT, target.idx).catch(() => false)

      if (hasCustomSize) {
        log('   有「自定义尺码」输入框 → 走自定义（不勾预设）')
        for (const v of values) {
          const ok = await fillCustomSize(page, target.idx, v)
          vals.push({ v, ok, via: 'custom-size' })
        }
      } else {
        vals = await checkBoxes(page, target.idx, values)
      }
    } else if (target.type === 'color-input') {
      vals = await fillColorInputs(page, target.idx, values)
    } else {
      vals = await fillCustomInputs(page, target.idx, target.dim, values)
    }

    vals.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}${x.via ? ' (' + x.via + ')' : ''}`))
    result.dims.push({ user: userDim, page: target.dim, type: target.type, values: vals })
    await sleep(1200)
  }

  result.ok = result.dims.every(d => d.values.every(v => v.ok))
  return result
}

export { SPEC_ROOT, sleep }
