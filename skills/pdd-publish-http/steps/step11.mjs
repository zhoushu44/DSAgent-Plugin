/**
 * step11.mjs — 步骤 11：商品规格
 *
 * ══════════════════════════════════════════════════════════════
 *  核心原则：模板定「能不能填」，页面定「怎么填」
 * ══════════════════════════════════════════════════════════════
 *
 *  模板字段（templates/index.mjs → loadTemplate）：
 *    specs.mode          none | preset | custom | mixed
 *    specs.maxDims       实际维度数
 *    specs.dimensions[]  {
 *        name              维度名（容量/尺码/颜色分类）
 *        controlType       0=输入框  3=勾选网格
 *        valueType         0=文本/枚举  1=数值
 *        unit              单位（mL）
 *        precision         小数位
 *        minValue/maxValue 数值范围
 *        inputMaxNum       最多几个值
 *        canNote           值可加备注
 *        uploadPic         值可配图
 *        isAllValue        允许任意值
 *        presetValues[]    预设值
 *    }
 *
 * ══════════════════════════════════════════════════════════════
 *  页面结构（实测）
 * ══════════════════════════════════════════════════════════════
 *  <div id="stand_spec">
 *    <div id="newSpec">
 *      <div class="goods-sku-box">
 *        <div class="property-container-v2">          ← 每个维度一块
 *          <div class="property-name-title">容量</div>
 *          <input placeholder="自定义容量">            ← controlType=0
 *          或
 *          <div class="package-item-container">        ← controlType=3
 *            <input type="checkbox">
 *            <div class="check-wrapper">250</div>
 *          </div>
 *        </div>
 *        <button>添加规格类型</button>                  ← 加第 2 维
 *      </div>
 *    </div>
 *  </div>
 *
 * ══════════════════════════════════════════════════════════════
 *  执行流程
 * ══════════════════════════════════════════════════════════════
 *  IF 1  !specs.length              → 跳过整步
 *  IF 2  无模板                      → 走页面自适应
 *  IF 3  mode === 'none'            → 报错（该类目不能加规格）
 *  IF 4  validateSpecs 失败          → 报错
 *  然后逐维度：
 *    ① 第 1 维：点「初始类型」下拉选名
 *       第 2+ 维：点「添加规格类型」再选名
 *    ② 选完探测真实控件类型（此时才渲染）
 *    ③ controlType=0 → 填输入框（数值型只收数字）
 *       controlType=3 → 点勾选网格
 *  IF 10 SKU 行数 ≠ 各维度值数乘积   → 报错
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { fillByGroup } from './helpers/fill-by-group.mjs'
import { fillSizeTable as fillSizeTableGeneric } from './helpers/size-table-fill.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')

const MOD = path.join(__dirname, '..', 'modules')
const TPL = path.join(__dirname, '..', 'templates')

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return {
    B: await load('03-button/index.mjs'),
    S: await load('04-select/index.mjs'),
  }
}

async function loadTplModule() {
  return import(pathToFileURL(path.join(TPL, 'index.mjs')).href)
}

// ═══════════════════════════════════════════════════════════════════
//  读页面状态
// ═══════════════════════════════════════════════════════════════════

/** 读规格区当前有哪些维度、每维什么控件 */
export async function readSpecState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#stand_spec') || document.querySelector('#newSpec')
    if (!root) return { found: false, dims: [], skuRows: 0 }

    const dims = []
    for (const c of root.querySelectorAll('.property-container-v2')) {
      const nameEl = c.querySelector('.property-name-title')
      const name = (nameEl?.innerText || '').trim()

      // 勾选网格项
      const items = [...c.querySelectorAll('.package-item-container')]
        .map(it => (it.querySelector('.check-wrapper')?.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 30)

      // 输入框
      const inputs = [...c.querySelectorAll('input')].filter(e => {
        const type = (e.type || '').toLowerCase()
        if (type === 'checkbox' || type === 'radio') return false
        const r = e.getBoundingClientRect()
        return r.width > 20
      }).map(e => ({
        placeholder: e.placeholder || '',
        value: e.value || '',
      }))

      // 已选中的值（chip）
      const chips = [...c.querySelectorAll('[class*="tag"] [class*="content"], [class*="value-item"], [class*="selected"]')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 30)

      dims.push({
        name,
        itemCount: items.length,
        items: items.slice(0, 200),
        inputCount: inputs.length,
        inputs,
        chips: [...new Set(chips)],
        controlGuess: items.length ? 'checkbox' : (inputs.length ? 'input' : 'unknown'),
      })
    }

    // SKU 行数
    const tbl = document.querySelector('#sku') || document.querySelector('[data-e2e-id="e2e-sku-table"]')
    const skuRows = tbl ? tbl.querySelectorAll('tbody tr').length : 0

    return { found: true, dims, skuRows }
  }).catch(() => ({ found: false, dims: [], skuRows: 0 }))
}

/** 数 SKU 行数 */
export async function countSkuRows(page) {
  return page.evaluate(() => {
    const tbl = document.querySelector('#sku') || document.querySelector('[data-e2e-id="e2e-sku-table"]')
    return tbl ? tbl.querySelectorAll('tbody tr').length : 0
  }).catch(() => 0)
}

// ═══════════════════════════════════════════════════════════════════
//  选维度名
// ═══════════════════════════════════════════════════════════════════

/**
 * 选维度名
 * @param {boolean} isFirst  第 1 维点「初始类型」，后续维点「添加规格类型」
 */
async function pickDimensionName(page, dimName, isFirst) {
  const { B } = await loadModules()

  // ① 打开下拉
  if (isFirst) {
    // 第 1 维：页面上有个 placeholder="初始类型" 的空下拉
    const opened = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('input')]
        .find(e => /初始类型|规格类型/.test(e.placeholder || ''))
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click(); return { ok: true, via: 'initial-input' } }

      const trig = document.querySelector('#stand_spec [class*="select-header"], #stand_spec [class*="Select"]')
      if (trig) { trig.click(); return { ok: true, via: 'select-header' } }

      return { ok: false, reason: '找不到「初始类型」下拉' }
    }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))

    if (!opened.ok) {
      // 兜底：点「添加规格类型」按钮
      const clicked = await B.clickButton(page, { text: '添加规格类型', anyTag: true })
        .catch(() => ({ ok: false }))
      if (!clicked?.ok) return { ok: false, error: opened.reason }
    }
  } else {
    // 第 2 维：点「添加规格类型」
    const clicked = await B.clickButton(page, { text: '添加规格类型', anyTag: true })
      .catch(e => ({ ok: false, error: String(e.message).slice(0, 100) }))
    if (!clicked?.ok) return { ok: false, error: '点不到「添加规格类型」: ' + (clicked?.error || '') }
  }
  // ★ 等选项面板真正出现（元素出现即返回，不固定等）
  await page.waitForFunction(() => {
    const cands = [...document.querySelectorAll('[class*="option"], [class*="Option"], [role="option"], [class*="dropdown"] li')]
    return cands.some(e => {
      const r = e.getBoundingClientRect()
      return r.width > 20 && r.height > 10 && (e.innerText || '').trim().length > 0
    })
  }, { timeout: 6000 }).catch(() => { })
  const picked = await page.evaluate((name) => {
    const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()

    // 找可见的选项元素
    const cands = [
      ...document.querySelectorAll('[class*="option"], [class*="Option"], [role="option"], [class*="dropdown"] li, [class*="Dropdown"] li'),
    ]
    for (const it of cands) {
      const r = it.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) continue
      const t = norm(it.innerText)
      if (t === name || t.startsWith(name)) {
        it.click()
        return { ok: true, matched: t }
      }
    }

    // 兜底：扫可见小元素
    for (const el of document.querySelectorAll('div,span,li,a')) {
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.height < 12) continue
      const t = norm(el.innerText)
      if (t === name && el.children.length <= 2) {
        el.click()
        return { ok: true, matched: t, fallback: true }
      }
    }

    // 列出可见备选
    const visible = cands
      .map(it => norm(it.innerText))
      .filter(t => t && t.length <= 20)
      .slice(0, 30)
    return { ok: false, reason: `下拉里找不到「${name}」`, visible }
  }, dimName).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (!picked?.ok) {
    const extra = picked.visible?.length ? `（页面可选：${picked.visible.join(' / ')}）` : ''
    return { ok: false, error: (picked.reason || '选维度失败') + extra }
  }

  // ★ 等规格输入框/勾选框渲染出来（元素出现即返回）
  await page.waitForFunction(() => {
    const box = [...document.querySelectorAll('.property-container-v2')].find(c => {
      const t = (c.querySelector('.property-name-title')?.innerText || '').trim()
      if (!t) return false
      return c.querySelector('input') !== null
    })
    return !!box
  }, { timeout: 6000 }).catch(() => { })
  return { ok: true, matched: picked.matched }
}

// ═══════════════════════════════════════════════════════════════════
//  按控件类型填值
// ═══════════════════════════════════════════════════════════════════

/**
 * 输入框型 / 点选型都按「组」操作
 *
 * 页面结构（实测 2026-11-10，每行一个规格值）：
 *   #newSpec ... /div/div/div[N]/div[1]/div/label/div/div        ← 勾选框（div，不是 input）
 *   ... /div[N]/div[1]/div/div[1]/span/div/div/div[1]/div/div/input  ← 规格名输入框
 *
 * ★ 用户明确要求：**先输值，再勾选**，顺序不能反
 * ★ 每行独立配对，第 i 个值只用第 i 行的勾选框 + 第 i 行的输入框
 */
async function fillByInput(page, dimName, values, dim) {
  const results = []

  for (let idx = 0; idx < values.length; idx++) {
    const v = values[idx]
    const r = await page.evaluate(async (args) => {
      const { name, val, isNumber, index } = args
      const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))

      // 维度容器
      let box = null
      for (const c of document.querySelectorAll('.property-container-v2')) {
        if (norm(c.querySelector('.property-name-title')?.innerText) === norm(name)) { box = c; break }
      }
      if (!box) return { ok: false, reason: `找不到维度「${name}」` }

      // ★ 规格名输入框：placeholder 含「自定义」或含维度名；排除备注框
      const allText = [...box.querySelectorAll('input')].filter(e =>
        ['text', '', 'number'].includes((e.type || 'text').toLowerCase()))
      const isNote = e => /备注|说明|note/i.test(e.placeholder || '')
      let pickInputs = allText.filter(e => !isNote(e) && /自定义/.test(e.placeholder || ''))
      if (!pickInputs.length) pickInputs = allText.filter(e => !isNote(e) && (e.placeholder || '').includes(name))
      if (!pickInputs.length) pickInputs = allText.filter(e => !isNote(e))
      const inp = pickInputs[index]
      if (!inp) return { ok: false, reason: `第 ${index + 1} 个规格名输入框不存在（共 ${pickInputs.length} 个）`, inputCount: pickInputs.length, placeholders: allText.map(e => e.placeholder) }

      // ★ 勾选框：真身是 input[type=checkbox]（class CBX_input_）
      const pickChecks = [...box.querySelectorAll('input[type="checkbox"]')]

      const write = isNumber ? String(val).replace(/[^\d.\-]/g, '') : String(val)
      if (!write) return { ok: false, reason: `值「${val}」不是合法数字` }

      // ── ① 先输值 ──
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      inp.focus()
      if (setter) setter.call(inp, write); else inp.value = write
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      await sleepIn(150)
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
      await sleepIn(200)
      inp.dispatchEvent(new Event('blur', { bubbles: true }))
      await sleepIn(200)

      // ── ② 再勾选第 index 个 checkbox ──
      let cbState = null
      const cbEl = pickChecks[index]
      if (cbEl) {
        if (!cbEl.checked) { cbEl.click(); await sleepIn(250) }
        cbState = cbEl.checked
      }

      return {
        ok: true, wrote: write, rowIndex: index,
        cbChecked: cbState, valueNow: inp.value,
        inputCount: pickInputs.length, checkCount: pickChecks.length,
      }
    }, { name: dimName, val: v, isNumber: dim.valueType === 1, index: idx })
      .catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

    if (!r.ok) { results.push({ value: v, ok: false, error: r.reason }); continue }
    results.push({
      value: v, ok: r.valueNow === r.wrote && r.cbChecked !== false,
      wrote: r.wrote, rowIndex: r.rowIndex, cbChecked: r.cbChecked, valueNow: r.valueNow,
    })
  }

  return { ok: results.every(r => r.ok), results }
}

/**
 * 勾选网格型（controlType=3）
 *
 * 同样按「组」操作：
 *   .package-item-container
 *     ☐ checkbox                ← 点选这一项
 *     .check-wrapper（规格名）   ← 预设文字，一般不写
 *     [规格名输入框]             ← 点选后若出现，写组内第 1 个 text input
 *     [备注输入框]               ← 组内第 2 个，不写
 *
 * 预设值：按文字找到对应项，点 checkbox
 * 自定义值：点「自定义」项，在组内第 1 个输入框写值
 */
async function fillByClick(page, dimName, values, dim) {
  const results = []

  for (const v of values) {
    const r = await page.evaluate(async (args) => {
      const { name, val } = args
      const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))

      let box = null
      for (const c of document.querySelectorAll('.property-container-v2')) {
        if (norm(c.querySelector('.property-name-title')?.innerText) === norm(name)) { box = c; break }
      }
      if (!box) return { ok: false, reason: `找不到维度「${name}」` }

      // ★ 大列表（如鞋码 111 个）可能虚拟滚动 → 先滚动加载，收集全部候选
      const collect = () => [...box.querySelectorAll('.package-item-container')]
      let items = collect()
      const wantNorm = norm(val)
      let hit = items.find(it => {
        const t = norm(it.querySelector('.check-wrapper')?.innerText || it.innerText)
        return t === wantNorm || t.includes(wantNorm)
      })

      // 没找到 → 逐段滚动容器再找
      if (!hit) {
        const scrollers = [box, ...box.querySelectorAll('div')]
          .filter(e => e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 40)
          .slice(0, 3)
        for (const sc of scrollers) {
          for (let step = 0; step < 12 && !hit; step++) {
            sc.scrollTop = Math.floor((sc.scrollHeight - sc.clientHeight) * (step / 11))
            await sleepIn(180)
            items = collect()
            hit = items.find(it => {
              const t = norm(it.querySelector('.check-wrapper')?.innerText || it.innerText)
              return t === wantNorm || t.includes(wantNorm)
            })
          }
          if (hit) break
        }
      }

      let target = hit

      // ② 没匹配 → 找「自定义」项
      if (!target && (args.allowCustom || args.isAllValue)) {
        target = items.find(it => /自定义/.test(it.innerText || ''))
      }
      if (!target) {
        const avail = items.map(it => norm(it.querySelector('.check-wrapper')?.innerText || '')).filter(Boolean)
        return { ok: false, reason: `「${val}」不在可选范围`, available: avail.slice(0, 60), total: avail.length }
      }

      // ③ 点这一项的 checkbox
      const cb = target.querySelector('input[type="checkbox"]')
      if (cb) { if (!cb.checked) cb.click() }
      else {
        const lab = target.querySelector('label')
        if (lab) lab.click(); else target.click()
      }
      await sleepIn(300)

      // ④ 组内第 1 个 text input（点选后出现的规格名/自定义值框）
      const textInputs = [...target.querySelectorAll('input')].filter(e => {
        const t = (e.type || 'text').toLowerCase()
        return t === 'text' || t === '' || t === 'number'
      })
      let wrote = null
      if (textInputs.length) {
        const inp = textInputs[0]   // ★ 第 1 个 = 规格名，不碰第 2 个（备注）
        // 自定义值才写；预设值框若为空也写
        if (!inp.value || /自定义/.test(target.innerText || '')) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          inp.focus()
          if (setter) setter.call(inp, String(val)); else inp.value = String(val)
          inp.dispatchEvent(new Event('input', { bubbles: true }))
          inp.dispatchEvent(new Event('change', { bubbles: true }))
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
          inp.dispatchEvent(new Event('blur', { bubbles: true }))
          wrote = String(val)
        }
      }

      return { ok: true, checked: cb ? cb.checked : null, via: cb ? 'checkbox' : 'label', wrote, inputCount: textInputs.length }
    }, { name: dimName, val: v, allowCustom: dim?.allowCustom !== false, isAllValue: dim?.isAllValue })
      .catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

    if (!r.ok) {
      const extra = r.available?.length ? `（可选 ${r.total} 个：${r.available.slice(0, 10).join('/')}…）` : ''
      results.push({ value: v, ok: false, error: (r.reason || '点击失败') + extra })
    } else {
      results.push({ value: v, ok: true, via: r.via, wrote: r.wrote, inputCount: r.inputCount })
    }
  }

  return { ok: results.every(r => r.ok), results }
}

// ═══════════════════════════════════════════════════════════════════
//  尺码表（身高/体重）填写 —— 读取模板内置 size-chart.json 的通用值
// ═══════════════════════════════════════════════════════════════════
async function readSizeChart(catId) {
  try {
    const T = await loadTplModule()
    const root = T.baseDir ? T.baseDir() : null
    const dir = path.join(PLUGIN, 'artifacts', 'pdd-templates')
    const fs = await import('node:fs')
    if (!fs.existsSync(dir)) return null
    const hit = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.endsWith(`-${catId}`))[0]
    if (!hit) return null
    const f = path.join(dir, hit.name, 'size-chart.json')
    if (!fs.existsSync(f)) return null
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch { return null }
}

/** 按尺码值取身高/体重区间；没有就走 fallback 递推 */
function intervalOf(chart, sizeVal) {
  if (!chart) return null
  const k = String(sizeVal).trim()
  if (chart.intervals?.[k]) return chart.intervals[k]
  // 大小写兼容
  const key = Object.keys(chart.intervals || {}).find(x => x.toLowerCase() === k.toLowerCase())
  if (key) return chart.intervals[key]
  return null
}

async function fillSizeChartTable(page, sizeVals, chart) {
  if (!chart) return { ok: false, error: '没有 size-chart.json' }
  const fb = chart.fallback || { baseHeight: 150, baseWeight: 40, heightStep: 5, weightStep: 5 }
  const rows = []
  sizeVals.forEach((sv, i) => {
    const iv = intervalOf(chart, sv) || {
      height: `${fb.baseHeight + i * fb.heightStep}-${fb.baseHeight + (i + 1) * fb.heightStep}`,
      weight: `${fb.baseWeight + i * fb.weightStep}-${fb.baseWeight + (i + 1) * fb.weightStep}`,
    }
    rows.push({ size: String(sv).trim(), ...iv })
  })

  const r = await page.evaluate(async (rowsData) => {
    const sleepIn = ms => new Promise(x => setTimeout(x, ms))
    // 找尺码表：表头有「身高」「体重」
    const tables = [...document.querySelectorAll('[data-testid="beast-core-table"]')]
    const tbl = tables.find(t => /身高/.test(t.innerText || '') && /体重/.test(t.innerText || ''))
      || document.querySelector('#sizeTable [data-testid="beast-core-table"]')
      || document.querySelector('#sizeTable table')
    if (!tbl) return { ok: false, error: '找不到尺码表（身高/体重）' }

    // ★ 先勾「区间值」（表头 身高/体重 各一个），勾完每行变两个输入框
    const headerCbs = [...tbl.querySelectorAll('thead input[type="checkbox"]')]
    const cbInfo = []
    for (const cb of headerCbs) {
      const on = cb.checked
      if (!on) { cb.click(); await sleepIn(400) }
      cbInfo.push({ on: cb.checked })
    }
    await sleepIn(600)

    const trs = [...tbl.querySelectorAll('tbody tr')]
    const done = []
    for (const rd of rowsData) {
      const tr = trs.find(t => {
        const first = (t.querySelector('td')?.innerText || '').replace(/\s+/g, '').trim()
        return first === String(rd.size).replace(/\s+/g, '')
      })
      if (!tr) { done.push({ size: rd.size, ok: false, reason: '表里没有该尺码行' }); continue }
      const tds = [...tr.querySelectorAll('td')]
      const setCellRange = (tdIdx, rangeStr) => {
        const td = tds[tdIdx]; if (!td) return false
        const inps = [...td.querySelectorAll('input')].filter(e => ['text', 'number', ''].includes((e.type || 'text').toLowerCase()))
        if (!inps.length) return false
        // 区间值：两个输入框（下限 / 上限）
        const parts = String(rangeStr).split(/[-~—]/).map(s => s.trim()).filter(Boolean)
        const vals = parts.length >= 2 ? [parts[0], parts[1]] : [parts[0], parts[0]]
        let n = 0
        for (let k = 0; k < inps.length && k < vals.length; k++) {
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          const inp = inps[k]
          inp.focus()
          if (set) set.call(inp, vals[k]); else inp.value = vals[k]
          inp.dispatchEvent(new Event('input', { bubbles: true }))
          inp.dispatchEvent(new Event('change', { bubbles: true }))
          inp.dispatchEvent(new Event('blur', { bubbles: true }))
          n++
        }
        return n > 0
      }
      const a = setCellRange(1, rd.height)
      const b = setCellRange(2, rd.weight)
      await sleepIn(150)
      done.push({ size: rd.size, ok: a && b, height: rd.height, weight: rd.weight })
    }
    return { ok: done.every(d => d.ok), ranges: cbInfo, done }
  }, rows).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))

  return { ...r, rows }
}

async function fillBySizeTable(page, dimName, values) {
  // ① 找尺码维度块：标题含「尺码」，或第2个空标题块（女装尺码区标题未渲染）
  const found = await page.evaluate((name) => {
    const dims = [...document.querySelectorAll('.property-container-v2')]
    for (let i = 0; i < dims.length; i++) {
      const t = (dims[i].querySelector('.property-name-title')?.innerText || '').trim()
      if (t.includes(name)) return { ok: true, idx: i, why: 'title' }
    }
    // 兜底：第2个块（索引>=1）里有尺码表特征文字
    for (let i = 1; i < dims.length; i++) {
      const txt = dims[i].innerText || ''
      if (/尺码表|全选以下规格值|\d{3}\/\d{2}[A-Z]/.test(txt)) return { ok: true, idx: i, why: 'content' }
    }
    return { ok: false, count: dims.length }
  }, dimName).catch(e => ({ ok: false, error: String(e.message).slice(0, 80) }))

  if (!found.ok) return { ok: false, error: `找不到尺码维度块（共 ${found.count || 0} 个维度块）` }

  // ①.5 先切尺码表（默认「通用」是 150/72A 那种，M/L/XL 在「中国码」）
  //      目标值里有纯字母码（S/M/L/XL/XXL…）→ 切中国码
  const needLetter = values.some(v => /^(XXS|XS|S|M|L|XL|XXL|XXXL|均码)$/i.test(String(v).trim()))
  if (needLetter) {
    const switched = await page.evaluate(async (idx) => {
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))
      const dims = [...document.querySelectorAll('.property-container-v2')]
      const box = dims[idx]
      if (!box) return { ok: false }
      const tabs = [...box.querySelectorAll('label[class*="RD_outerWrapper"]')]
      const want = tabs.find(l => /中国码/.test(l.innerText || ''))
      if (!want) return { ok: false, reason: '没有「中国码」标签', all: tabs.map(t => (t.innerText || '').trim()) }
      const radio = want.querySelector('input[type="radio"]')
      if (radio && !radio.checked) radio.click(); else want.click()
      await sleepIn(800)
      return { ok: true }
    }, found.idx).catch(e => ({ ok: false, reason: String(e.message).slice(0, 80) }))
    if (!switched.ok) return { ok: false, error: '切尺码表失败: ' + (switched.reason || '') }
    // 切表提示写进结果里（本模块无 log 依赖）
    found.switchedTo = '中国码'
  }

  // ② 逐个值勾选（在该维度块内按文字匹配 package-item-container / label）
  const results = []
  for (const v of values) {
    const r = await page.evaluate(async (args) => {
      const { name, val, idx } = args
      const norm = s => String(s || '').replace(/[\s\u3000]/g, '').trim()
      const sleepIn = ms => new Promise(x => setTimeout(x, ms))

      const dims = [...document.querySelectorAll('.property-container-v2')]
      const box = dims[idx]
      if (!box) return { ok: false, reason: `维度块 ${idx} 不存在` }

      const cands = [...box.querySelectorAll('label, li, div, span')].filter(e => {
        const t = norm(e.innerText)
        if (t !== norm(val)) return false
        const r = e.getBoundingClientRect()
        return r.width > 8 && r.height > 8
      })
      if (!cands.length) {
        const sample = [...box.querySelectorAll('label,div,span')].map(e => norm(e.innerText)).filter(t => t && t.length < 12).slice(0, 20)
        return { ok: false, reason: `找不到「${val}」`, sample }
      }
      const el = cands[cands.length - 1]
      let cb = el.querySelector('input[type="checkbox"]')
      if (!cb) { const lab = el.closest('label'); if (lab) cb = lab.querySelector('input[type="checkbox"]') }
      if (cb) {
        if (!cb.checked) { cb.click(); await sleepIn(150) }
        return { ok: true, via: 'checkbox', checked: cb.checked }
      }
      el.click(); await sleepIn(150)
      return { ok: true, via: 'div-click' }
    }, { name: dimName, val: v, idx: found.idx }).catch(e => ({ ok: false, reason: String(e.message).slice(0, 100) }))
    results.push({ value: v, ...r })
  }

  const ok = results.every(x => x.ok)
  return {
    ok, results, dimIdx: found.idx, why: found.why, switchedTo: found.switchedTo || '',
    error: ok ? '' : results.filter(x => !x.ok).map(x => `${x.value}:${x.reason}${x.sample ? '(' + x.sample.join('|') + ')' : ''}`).join('; '),
  }
}

// ═══════════════════════════════════════════════════════════════════
//  加一个维度（选名 + 探测 + 填值）
// ═══════════════════════════════════════════════════════════════════
async function addDimension(page, tplDim, spec, isFirst) {
  const warnings = []

  // ① 选维度名
  const picked = await pickDimensionName(page, spec.name, isFirst)
  if (!picked.ok) return { ok: false, name: spec.name, error: picked.error || picked.reason || '选维度名失败', detail: picked }

  // ② 探测真实控件
  const st = await readSpecState(page)
  const ui = st.dims.find(d => d.name.includes(spec.name) || spec.name.includes(d.name))
  if (!ui) return { ok: false, name: spec.name, error: `选了「${spec.name}」但页面上找不到该维度块` }

  // ③ 模板 vs 页面类型对比
  const tplKind = tplDim.controlType === 3 ? 'checkbox' : 'input'
  if (tplKind !== ui.controlGuess) {
    warnings.push(`模板说「${spec.name}」是 ${tplKind}，页面是 ${ui.controlGuess}，按页面处理`)
  }

  // ④ 按页面实际类型填
  let filled
  if (ui.controlGuess === 'checkbox') {
    filled = await fillByClick(page, spec.name, spec.values, tplDim)
  } else if (ui.controlGuess === 'input') {
    filled = await fillByInput(page, spec.name, spec.values, tplDim)
  } else {
    return { ok: false, name: spec.name, error: `维度「${spec.name}」控件类型未知` }
  }

  return {
    ok: filled.ok,
    name: spec.name,
    uiType: ui.controlGuess,
    tplType: tplKind,
    filled: filled.results,
    warnings,
    ...(filled.ok ? {} : { error: filled.results.filter(r => !r.ok).map(r => r.error).join('; ') }),
  }
}

// ═══════════════════════════════════════════════════════════════════
//  主函数
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {object} page
 * @param {object} opts
 * @param {Array<{name:string, values:string[]}>} opts.specs
 * @param {number} [opts.catId]       用模板校验
 * @param {boolean} [opts.strict=true]
 * @returns {Promise<{
 *   ok:boolean, skipped?:boolean, mode?:string,
 *   results?:Array, warnings?:string[], error?:string,
 *   expectedRows?:number, actualRows?:number
 * }>}
 */
export async function step11_fillSpecs(page, opts = {}) {
  const specs = Array.isArray(opts.specs) ? opts.specs : []

  // ── IF 1：没传 specs → 跳过
  if (!specs.length) {
    return { ok: true, skipped: true, reason: '未提供 specs' }
  }

  // ── 读模板
  let tpl = null
  if (opts.catId) {
    try {
      const T = await loadTplModule()
      tpl = T.loadTemplate(Number(opts.catId))
    } catch { /* 模板读失败不阻断 */ }
  }

  // ── IF 2：无模板 → 页面自适应
  if (!tpl) {
    const results = []
    for (let i = 0; i < specs.length; i++) {
      const r = await addDimension(page, { controlType: -1, valueType: 0 }, specs[i], i === 0)
      results.push(r)
      if (!r.ok) break
    }
    return { ok: results.every(r => r.ok), mode: 'unknown', results }
  }

  // ── IF 3：模板说不能加规格
  if (tpl.specs?.mode === 'none') {
    return {
      ok: false,
      mode: 'none',
      error: `类目「${tpl.category?.name}」不开放规格（is_spec=false），不能填 specs`,
    }
  }

  // ── IF 4：预校验
  const T = await loadTplModule()
  const v = T.validateSpecs(tpl, specs)
  if (!v.ok) {
    return { ok: false, mode: tpl.specs.mode, error: v.errors.join('; '), errors: v.errors }
  }

  // ── 逐维度
  const results = []
  const warnings = [...(v.warnings || [])]

  for (let i = 0; i < specs.length; i++) {
    const tplDim = (tpl.specs.dimensions || []).find(d => d.name === specs[i].name) || {}

    // ★★ 核心分派：以模板里的 type 为准（text / checkbox / size-table / size-code）
    //     模板没标 type 时才回退到现场探测
    const dimType = tplDim.type || ''

    // ★ 维度块是否存在（轮询最多 6 秒，等页面渲染完；选完第一维后第二维常自动出现）
    const waitDim = async (name, maxMs = 6000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < maxMs) {
        const ok = await page.evaluate((n) => {
          const dims = [...document.querySelectorAll('.property-container-v2')]
          if (dims.some(c => (c.querySelector('.property-name-title')?.innerText || '').includes(n))) return true
          const root = document.querySelector('#newSpec')
          if (root && (root.innerText || '').includes(n)) return true
          // 尺码表特征（标题可能为空）
          if (/尺码/.test(n)) {
            for (let k = 1; k < dims.length; k++) {
              if (/尺码表|全选以下规格值|\d{3}\/\d{2}[A-Z]/.test(dims[k].innerText || '')) return true
            }
          }
          return false
        }, name).catch(() => false)
        if (ok) return true
        await new Promise(r => setTimeout(r, 250))
      }
      return false
    }

    const autoExists = await waitDim(specs[i].name, i === 0 ? 3000 : 6000)

    let r
    switch (dimType) {
      // ── 尺码表型（女装：标签页 + 值网格 + 身高体重区间）──
      case 'size-table': {
        if (!autoExists) {
          const added = await addDimension(page, tplDim, specs[i], i === 0)
          if (!added.ok) { r = added; break }
          await waitDim(specs[i].name, 4000)
        }
        // ★ 通用尺码表填充（兼容服装尺码 与 运动鞋码）
        r = await fillSizeTableGeneric(page, specs[i].name, specs[i].values, {
          tabHint: tplDim.tabHint || '',
        })
        r.name = specs[i].name
        r.mode = 'size-table(generic)'
        // 只有服装尺码才需要填身高/体重
        if (r.ok && /尺码/.test(specs[i].name) && !/鞋码/.test(specs[i].name)) {
          const chart = await readSizeChart(opts.catId || 0)
          const sc = await fillSizeChartTable(page, specs[i].values, chart)
          r.sizeChart = sc
          if (!sc.ok) warnings.push('尺码表身高/体重未全填: ' + (sc.error || ''))
        }
        break
      }
      // ── 勾选型（颜色/鞋码：预设值点选）──
      case 'checkbox': {
        if (!autoExists) {
          const added = await addDimension(page, tplDim, specs[i], i === 0)
          if (added.ok) await waitDim(specs[i].name, 4000)
          if (!added.ok) { r = added; break }
        }
        // ★ 通用：勾选框 + 输入框按组配对（预设值/自定义都走这里）
        r = fillByGroup
          ? await fillByGroup(page, specs[i].name, specs[i].values, tplDim)
          : await fillByClick(page, specs[i].name, specs[i].values, tplDim)
        r.name = specs[i].name
        r.mode = 'group(tpl)'
        break
      }
      // ── 输入型（纸杯容量：checkbox + 输入框组合）──
      case 'text': {
        if (!autoExists) {
          const added = await addDimension(page, tplDim, specs[i], i === 0)
          if (added.ok) await waitDim(specs[i].name, 4000)
          if (!added.ok) { r = added; break }
        }
        // ★ 通用：勾选框 + 输入框按组配对
        r = fillByGroup
          ? await fillByGroup(page, specs[i].name, specs[i].values, tplDim)
          : await fillByInput(page, specs[i].name, specs[i].values, tplDim)
        r.name = specs[i].name
        r.mode = 'group(tpl)'
        break
      }
      // ── 模板没标 type → 回退现场探测 ──
      default: {
        const isSizeLike = /尺码|码数|size/i.test(specs[i].name)
        if (i > 0 && autoExists && isSizeLike) {
          r = await fillBySizeTable(page, specs[i].name, specs[i].values)
          r.name = specs[i].name
          r.mode = 'size-table(auto)'
          if (r.ok) {
            const chart = await readSizeChart(opts.catId || 0)
            r.sizeChart = await fillSizeChartTable(page, specs[i].values, chart)
          }
        } else if (i > 0 && autoExists) {
          const st = await readSpecState(page)
          const ui = st.dims.find(d => d.name.includes(specs[i].name))
          r = ui?.controlGuess === 'checkbox'
            ? await fillByClick(page, specs[i].name, specs[i].values, tplDim)
            : await fillByInput(page, specs[i].name, specs[i].values, tplDim)
          r.name = specs[i].name
          r.mode = 'auto-dim'
        } else {
          r = await addDimension(page, tplDim, specs[i], i === 0)
        }
      }
    }
    results.push(r)
    if (r.warnings?.length) warnings.push(...r.warnings)
    if (!r.ok) {
      return { ok: false, mode: tpl.specs.mode, results, warnings, error: r.error || '未知失败', failedStep: r.name, failedDetail: r.detail, failedResults: r.results }
    }
  }

  // ── IF 10：SKU 行数（等行数达到预期，最多 8 秒）
  const expectedRows = specs.reduce((n, s) => n * s.values.length, 1)
  let actualRows = 0
  for (let i = 0; i < 40; i++) {
    actualRows = await countSkuRows(page)
    if (actualRows >= expectedRows) break
    await new Promise(r => setTimeout(r, 200))
  }

  if (actualRows !== expectedRows) {
    return {
      ok: false,
      mode: tpl.specs.mode,
      results,
      warnings,
      expectedRows,
      actualRows,
      error: `SKU 行数不符：预期 ${expectedRows}（${specs.map(s => s.values.length).join('×')}），实际 ${actualRows}`,
    }
  }

  return { ok: true, mode: tpl.specs.mode, results, warnings, expectedRows, actualRows }
}

export default step11_fillSpecs




