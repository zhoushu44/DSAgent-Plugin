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

import * as fs from 'node:fs'

const SPEC_ROOT = '#goods-spec-sku'
const SKU_TABLE = '#sku table'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ─────────── ① 识别：扫描规格根节点内所有维度 ─────────── */
async function scanDims(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return { found: false, dims: [] }
    const dims = []
    // ★ 2026-10-27：两种容器结构
    //   A. .property-container-v2 —— 预置维度（颜色分类/参考分类/容量）
    //   B. .goods-spec-row —— 「添加规格类型」新建的维度（零食等无预置类目）
    const containers = [
      ...root.querySelectorAll('.property-container-v2'),
      ...root.querySelectorAll('.goods-spec-row'),
    ]
    const seen = new Set()
    containers.forEach(c => { if (!seen.has(c)) seen.add(c) })
    ;[...seen].forEach((c, ci) => {
      // ★ 维度名解析优先级：
      //   1. 「规格类型」输入框的 value（新建维度最可靠）
      //   2. .property-name-title / .sizeStandardWrapper_title 纯文本
      //   3. .goods-spec-row-title 的**第一个文本节点**（避免混入"添加图片/删除规格类型"按钮文本）
      const specTypeVal = c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
      let title = specTypeVal
      if (!title) {
        const t1 = c.querySelector('.property-name-title')
        const t2 = c.querySelector('.sizeStandardWrapper_title__7s9I-')
        const t3 = c.querySelector('.goods-spec-row-title')
        for (const el of [t1, t2, t3]) {
          if (!el) continue
          // 只取直接文本节点，跳过子元素（按钮）
          for (const n of el.childNodes) {
            if (n.nodeType === 3 && n.textContent.trim()) { title = n.textContent.trim(); break }
          }
          if (!title) title = el.textContent?.replace(/添加图片|删除规格类型/g, '').trim()
          if (title) break
        }
      }
      if (!title) title = '(未命名' + ci + ')'
      const colorInput = c.querySelector('input[placeholder*="主色"]')
      const customInputs = [...c.querySelectorAll('input')].filter(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
      })
      const cbItems = [...c.querySelectorAll('.package-item-container')]
      // ★ checkbox 必须有值才算（纸杯「容量」有个空 .package-item-container，
      //   实际靠「自定义容量」输入框填，不能算 checkbox）
      const cbWithText = cbItems.filter(it => (it.querySelector('.check-wrapper')?.textContent?.trim() || ''))
      const addCustomBtn = !![...c.querySelectorAll('a, span, button')]
        .find(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
      dims.push({
        idx: ci,
        dim: title,
        // ★ 2026-10-27 识别优先级（实测修正）：
        //   1. 有「主色」输入框 → color-input
        //   2. 有 checkbox 列表 → checkbox（预置值勾选；用户值不在列表时用自定义输入框兜底）
        //      ★ checkbox 必须优先于 custom-input：参考分类既有 checkbox 又有自定义输入框，
        //        走输入框平台不注册 SKU，走勾选才生成行（实测 4 行 vs 2 行）
        //   3. 有「自定义」输入框 → custom-input
        //   4. 规格类型输入框 → spec-type（新建维度）
        type: colorInput ? 'color-input'
          : (cbWithText.length ? 'checkbox'
            : (customInputs.length ? 'custom-input'
              : (c.querySelector('input[placeholder^="规格类型"]') ? 'spec-type' : 'unknown'))),
        colorInputCount: colorInput ? [...c.querySelectorAll('input[placeholder*="主色"]')].length : 0,
        customInputPhs: customInputs.map(e => e.placeholder),
        addCustomBtn,
        cbCount: cbWithText.length,
        cbTexts: cbWithText.map(it => it.querySelector('.check-wrapper')?.textContent?.trim() || ''),
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
  const u = String(userDim || '').trim()
  if (!u) return null
  // ① 精确同名
  let hit = dims.find(d => d.dim === u)
  if (hit) return hit
  // ② 包含关系（「颜色」↔「颜色分类」、「参考分类」↔「尺码」）
  hit = dims.find(d => {
    const p = d.dim
    return (p.includes(u) || u.includes(p)) && Math.min(p.length, u.length) >= 2
  })
  if (hit) return hit
  // ③ 同类词映射（只认语义等价，不把「款式」匹配到「容量」）
  const EQUIV = [
    [/^(颜色|色彩|花色|配色|颜色分类)$/, ['颜色分类', '颜色', '色彩', '花色', '配色', '色号']],
    [/^(尺码|尺寸|大小|码数|参考分类)$/, ['参考分类', '尺码', '尺寸', '大小', '身高']],
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

/* ─────────── ③ 点「添加规格类型」并选维度 ─────────── */

/** 在下拉里选维度（精确 → 包含 → 同类替代） */
async function pickDimFromDropdown(page, dimName) {
  return page.evaluate((name) => {
    const pick = (cands) => {
      if (!cands.length) return { ok: false, picked: null }
      const picked = cands[cands.length - 1].textContent.trim()
      cands[cands.length - 1].click()
      return { ok: true, picked }
    }
    // 精确
    let cands = [...document.querySelectorAll('li, div, span, a')]
      .filter(e => (e.textContent || '').trim() === name && e.getBoundingClientRect().y > 300 && e.getBoundingClientRect().width > 10)
    if (cands.length) return pick(cands)
    // 包含
    cands = [...document.querySelectorAll('li, div, span, a')]
      .filter(e => {
        const t = (e.textContent || '').trim()
        const r = e.getBoundingClientRect()
        return r.y > 300 && r.width > 10 && t.length <= 12 && (t.includes(name) || name.includes(t))
      })
    if (cands.length) return pick(cands)
    // ★ 同类替代（类目可用维度不同：手机壳没有「颜色分类」只有「色号/花型」）
    const altMap = [
      [/颜色|色|花色|配色/, ['色号', '花型', '颜色']],
      [/款式|样式|版型/, ['型号', '款式', '规格', '类别']],
      [/尺码|尺寸/, ['尺码', '尺寸']],
      [/容量/, ['容量', '重量', '套餐']],
      [/口味/, ['口味', '香型', '类别']],
    ]
    for (const [re, alts] of altMap) {
      if (!re.test(name)) continue
      for (const alt of alts) {
        const hit = [...document.querySelectorAll('li, div, span, a')].find(e => {
          const t = (e.textContent || '').trim()
          const r = e.getBoundingClientRect()
          return t === alt && r.y > 300 && r.width > 10
        })
        if (hit) return pick([hit])
      }
    }
    return { ok: false, picked: null }
  }, dimName)
}

async function addDim(page, dimName) {
  // 点「添加规格类型」
  await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const btn = [...root.querySelectorAll('button')].find(b => /添加规格类型/.test(b.textContent || ''))
    btn?.click()
  }, SPEC_ROOT)
  await sleep(2500)

  // ★ 真实鼠标点「规格类型N」打开下拉（JS click 不触发 React 下拉）
  const pos = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const inputs = [...root.querySelectorAll('input')]
      .filter(e => (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0)
    const inp = inputs[inputs.length - 1]
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, SPEC_ROOT)
  if (pos) { await page.mouse.click(pos.x, pos.y); await sleep(2500) }

  let r = await pickDimFromDropdown(page, dimName)
  if (r.ok && r.picked && r.picked !== dimName) {
    console.log(`[dom-fill-spec] 下拉没有「${dimName}」，用了「${r.picked}」`)
  }
  await sleep(2000)

  // ★ 校验：规格类型输入框是否已选中维度名，为空则重试一次
  const val = await page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const inputs = [...root.querySelectorAll('input')]
      .filter(e => (e.placeholder || '').startsWith('规格类型') && e.getBoundingClientRect().y > 0)
    return inputs[inputs.length - 1]?.value?.trim() || ''
  }, SPEC_ROOT)
  if (!val && r.ok) {
    if (pos) { await page.mouse.click(pos.x, pos.y); await sleep(2000) }
    r = await pickDimFromDropdown(page, dimName)
    await sleep(2000)
  }
  return r.ok
}

/* ─────────── ④ 填颜色输入框（placeholder*="主色"） ─────────── */
async function fillColorInputs(page, dimIdx, values) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    let pos = await page.evaluate((sel, ci, idx) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
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
        const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
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
        const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
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
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      return [...c.querySelectorAll('input[placeholder*="主色"]')][idx]?.value
    }, SPEC_ROOT, dimIdx, i)
    log.push({ v: values[i], ok: !!back })
  }
  return log
}

/* ─────────── ⑤ 填自定义输入框 ─────────── */
async function fillCustomInputs(page, dimIdx, phKeyword, values) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    // ★ 2026-10-27 用户确认：原款输入，不新增框
    //   系统建维度时自带 2~4 个空框，依次填「第一个空框」即可
    //   每个填完点页面空白处（平台确认值 → 输入框清空 → 下一个）

    // 定位「第一个空框」
    let pos = await page.evaluate((sel, ci, ph) => {
      const root = document.querySelector(sel)
      const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
      const c = cs[ci]
      if (!c) return null
      let els = [...c.querySelectorAll('input')].filter(e => {
        const p = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return p.includes('自定义') && !p.includes('排序') && r.y > 0 && r.width > 30
      })
      // ★ 兜底：容器内除「规格类型」外的可编辑文本输入框
      //   排除参考价(大于)/折扣(~)/品牌/产地/规格类型
      if (!els.length) {
        els = [...c.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          const r = e.getBoundingClientRect()
          return r.y > 0 && r.width > 30
            && !p.startsWith('规格类型')
            && !/请输入品牌|请选择|大于|~|备注/.test(p)
            && (e.type === 'text' || !e.type)
        })
      }
      const empty = els.find(e => !e.value)
      const el = empty || els[els.length - 1]
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      return { scrollOnly: true }
    }, SPEC_ROOT, dimIdx, phKeyword)

    if (pos?.scrollOnly) {
      await sleep(400)
      pos = await page.evaluate((sel, ci, ph) => {
        const root = document.querySelector(sel)
        const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
        const c = cs[ci]
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
            return r.y > 0 && r.width > 30 && !p.startsWith('规格类型')
              && !/请输入品牌|请选择|大于|~|备注/.test(p) && (e.type === 'text' || !e.type)
          })
        }
        const empty = els.find(e => !e.value)
        const el = empty || els[els.length - 1]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, SPEC_ROOT, dimIdx, phKeyword)
    }

    if (pos?.needAdd) {
      await page.evaluate((sel, ci) => {
        const root = document.querySelector(sel)
        const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
        const c = cs[ci]
        const links = [...c.querySelectorAll('a, span, button')]
          .filter(e => (e.textContent || '').trim() === '添加定制规格' && e.getBoundingClientRect().width > 5)
        links[0]?.click()
      }, SPEC_ROOT, dimIdx)
      await sleep(1500)
      pos = await page.evaluate((sel, ci, ph) => {
        const root = document.querySelector(sel)
        const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
        const c = cs[ci]
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
            return r.y > 0 && r.width > 30 && !p.startsWith('规格类型') && !/请输入品牌|请选择|大于|~|备注/.test(p) && (e.type === 'text' || !e.type)
          })
        }
        const empty = els.find(e => !e.value)
        const el = empty || els[els.length - 1]
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        return { scrollOnly: true }
      }, SPEC_ROOT, dimIdx, phKeyword)
      if (pos?.scrollOnly) {
        await sleep(400)
        pos = await page.evaluate((sel, ci, ph) => {
          const root = document.querySelector(sel)
          const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
          const c = cs[ci]
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
              return r.y > 0 && r.width > 30 && !p.startsWith('规格类型') && !/请输入品牌|请选择|大于|~|备注/.test(p) && (e.type === 'text' || !e.type)
            })
          }
          const empty = els.find(e => !e.value)
          const el = empty || els[els.length - 1]
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        }, SPEC_ROOT, dimIdx, phKeyword)
      }
    }
    if (!pos?.x) { log.push({ v: values[i], ok: false }); continue }

    // ★ 真实键盘键入（平台只认真实输入事件才注册 spec_id）
    //   流程：键入 → 按 Enter 触发平台注册 → 读值 → 被清则重键入
    await page.mouse.click(pos.x, pos.y); await sleep(500)
    await page.keyboard.type(values[i], { delay: 40 }); await sleep(400)
    await page.keyboard.press('Enter'); await sleep(1200)

    const readVal = () => page.evaluate((sel, ci, idx) => {
      const root = document.querySelector(sel)
      const cs = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
      const c = cs[ci]
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
          return r.y > 0 && r.width > 30 && !p.startsWith('规格类型') && !/请输入品牌|请选择|大于|~|备注/.test(p) && (e.type === 'text' || !e.type)
        })
      }
      return els[idx]?.value
    }, SPEC_ROOT, dimIdx, i)

    let back = await readVal()
    if (!back) {
      // React 清了 → 重键入（不按 Enter，这次只保值）
      await page.mouse.click(pos.x, pos.y); await sleep(400)
      await page.keyboard.type(values[i], { delay: 40 }); await sleep(700)
      back = await readVal()
    }
    log.push({ v: values[i], ok: !!back })

    // ★ 2026-10-27 关键修复：填完值必须点页面空白处失焦
    //   不点空白 → 值留在输入框 → 下一次填串到别的维度（实测出现 2112/2121 脏值）
    //   点空白 → 平台确认值 → 输入框清空变 chip
    await page.mouse.click(30, 300)
    await sleep(800)

    // ★ 2026-10-27 实测：新建维度每填一个值，等平台把它提交进 SKU 表
    //   轮询 SKU 行数，不涨就再按一次 Enter 触发
    const before = await readSkuRowCount(page)
    for (let k = 0; k < 6; k++) {
      await sleep(1000)
      const now = await readSkuRowCount(page)
      if (now > before) break
      if (k === 2 || k === 5) {
        await page.mouse.click(pos.x, pos.y); await sleep(300)
        await page.keyboard.press('Enter'); await sleep(1200)
      }
    }
  }
  return log
}

/** 读 SKU 表行数（表头含「拼单价」的那个 table） */
async function readSkuRowCount(page) {
  return page.evaluate(() => {
    for (const tb of document.querySelectorAll('#sku table')) {
      const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
      if (heads.some(h => /拼单价|库存/.test(h))) return tb.querySelectorAll('tbody tr').length
    }
    return 0
  }).catch(() => 0)
}

/* ─────────── ⑥ 勾选 checkbox 值（不在列表则用自定义输入框） ─────────── */
async function checkBoxes(page, dimIdx, values) {
  const log = []
  for (const v of values) {
    // 先试 checkbox 列表匹配
    const hit = await page.evaluate((sel, ci, val) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return { found: false }
      const clean = val.replace(/(cm|厘米|ml|mL|L|l|g|kg|G|KG)$/i, '').trim()
      for (const item of c.querySelectorAll('.package-item-container')) {
        const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
        if (txt === val || txt === clean) {
          const cb = item.querySelector('input[type="checkbox"]')
          if (cb && !cb.checked) item.querySelector('label')?.click()
          return { found: true, txt }
        }
      }
      return { found: false }
    }, SPEC_ROOT, dimIdx, v)

    if (hit.found) { log.push({ v, ok: true, via: 'checkbox', txt: hit.txt }); await sleep(300); continue }

    // checkbox 没有 → 填自定义输入框 → 等平台在 checkbox 列表新增 → 勾选它
    const customOk = await page.evaluate((sel, ci, val) => {
      const root = document.querySelector(sel)
      const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
      if (!c) return false
      const inp = [...c.querySelectorAll('input')].find(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        return ph.includes('自定义') && !ph.includes('排序') && r.y > 0 && r.width > 30
      })
      if (!inp) return false
      inp.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(inp, val)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      inp.blur()
      return true
    }, SPEC_ROOT, dimIdx, v)

    if (customOk) {
      await sleep(1500)
      // ★ 等平台在 checkbox 列表新增这个值，然后勾选它
      const checkNew = await page.evaluate((sel, ci, val) => {
        const root = document.querySelector(sel)
        const c = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')][ci]
        if (!c) return false
        for (const item of c.querySelectorAll('.package-item-container')) {
          const txt = item.querySelector('.check-wrapper')?.textContent?.trim() || ''
          if (txt === val || txt === val.replace(/(cm|厘米|ml|mL|L|l|g|kg|G|KG)$/i, '').trim()) {
            const cb = item.querySelector('input[type="checkbox"]')
            if (cb && !cb.checked) item.querySelector('label')?.click()
            return true
          }
        }
        return false
      }, SPEC_ROOT, dimIdx, v)
      log.push({ v, ok: checkNew, via: 'custom-input' + (checkNew ? '+勾选' : '') })
    } else {
      log.push({ v, ok: false, via: 'none' })
    }
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

  // ★ 2026-10-28：JS setter 一次性填全表（比鼠标逐格快 10 倍）
  //   价格/库存是纯数字输入，React setter + input 事件能更新状态。
  //   逐格回读，setter 没生效的用真实键盘兜底。
  let filled = 0
  for (let r = 0; r < rows; r++) {
    // 滚动到位（虚拟滚动需要）
    await page.evaluate(ri => {
      const trs = [...document.querySelectorAll('#sku table tbody tr')]
      trs[ri]?.scrollIntoView({ block: 'center' })
    }, r)
    await sleep(150)

    // ① JS setter 填该行前 3 格（库存/拼单价/单买价）
    const setRes = await page.evaluate((ri, stockV, priceV, singleV) => {
      const trs = [...document.querySelectorAll('#sku table tbody tr')]
      const tr = trs[ri]
      if (!tr) return { total: 0, ok: 0 }
      const inputs = [...tr.querySelectorAll('input')]
      const vals = [stockV, priceV, singleV]
      let ok = 0
      inputs.forEach((el, i) => {
        if (i > 2) return
        const v = vals[i]
        if (!v) return
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        if (!setter) return
        setter.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
        ok++
      })
      return { total: Math.min(3, inputs.length), ok }
    }, r, String(stock), String(price), single).catch(() => ({ total: 0, ok: 0 }))
    await sleep(200)

    // ② 回读，没生效的格子用真实键盘兜底
    for (let i = 0; i < setRes.total; i++) {
      const back = await page.evaluate((ri, ii) => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        return trs[ri]?.querySelectorAll('input')[ii]?.value
      }, r, i).catch(() => '')
      if (back) { filled++; continue }
      // 键盘兜底
      const pos = await page.evaluate((ri, ii) => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        const el = trs[ri]?.querySelectorAll('input')[ii]
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r2 = el.getBoundingClientRect()
        return { x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) }
      }, r, i).catch(() => null)
      if (!pos) continue
      await sleep(150)
      const pos2 = await page.evaluate((ri, ii) => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        const el = trs[ri]?.querySelectorAll('input')[ii]
        if (!el) return null
        const r2 = el.getBoundingClientRect()
        return { x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) }
      }, r, i).catch(() => null)
      if (!pos2) continue
      const val = i === 0 ? String(stock) : (i === 1 ? String(price) : single)
      await page.mouse.click(pos2.x, pos2.y); await sleep(200)
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
      await page.keyboard.press('Backspace'); await sleep(50)
      await page.keyboard.type(val, { delay: 40 }); await sleep(200)
      await page.keyboard.press('Enter'); await sleep(400)
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

/* ─────────── ⑨ 停用尺码表（勾选后占住 SKU 表，导致 rows=0） ─────────── */
async function disableSizeChart(page) {
  // 两种入口：a[data-tracking-impr-viewid="disable_size_chart"] / #sizeTable > div > a
  const found = await page.evaluate(() => {
    let link = document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]')
    if (!link) {
      const st = document.querySelector('#sizeTable')
      if (st) link = st.querySelector('div a')
    }
    if (link) { link.click(); return true }
    return false
  }).catch(() => false)
  if (!found) return false
  await sleep(800)
  // 确认弹窗
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /确认停用/.test(b.textContent || ''))
    btn?.click()
  }).catch(() => {})
  await sleep(1000)
  return true
}

/* ─────────── ⑩ 填 SKU 预览图（逐行传 + 行级验证 + 重试） ─────────── */
async function fillSkuThumbs(page, thumbMap) {
  if (!thumbMap || !Object.keys(thumbMap).length) return { filled: 0, total: 0 }

  // 读所有行（规格值文本 + 预览图列是否已传）
  const readRows = () => page.evaluate(() => {
    const out = []
    for (const tb of document.querySelectorAll('#sku table')) {
      const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
      if (!heads.some(h => /拼单价/.test(h))) continue
      const thumbIdx = heads.findIndex(h => /预览图/.test(h))
      const trs = [...tb.querySelectorAll('tbody tr')]
      trs.forEach((tr, ri) => {
        const tds = [...tr.querySelectorAll('td')]
        const specText = tds[0]?.textContent?.trim() || ''
        const thumbTd = thumbIdx >= 0 ? tds[thumbIdx] : null
        const thumbText = thumbTd?.textContent?.trim() || ''
        const done = thumbIdx >= 0 && !/本地上传/.test(thumbText)
        out.push({ row: ri, specText: specText.slice(0, 40), done })
      })
      break
    }
    return out
  })

  const initial = await readRows()
  if (!initial.length) return { filled: 0, total: 0 }

  let filled = 0
  for (const r of initial) {
    if (r.done) { filled++; continue }
    const key = Object.keys(thumbMap).find(k => r.specText.includes(k))
    if (!key) continue
    const imgPath = thumbMap[key]
    if (!imgPath || !fs.existsSync(imgPath)) continue

    // 该行最多重试 2 次（上传异步，首次可能没生效）
    for (let attempt = 0; attempt < 2; attempt++) {
      // 滚动到该行
      await page.evaluate(ri => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        trs[ri]?.scrollIntoView({ block: 'center' })
      }, r.row)
      await sleep(400)

      // 取该行预览图 td 的 file input（每次重新取，上传后 DOM 重建）
      const fileHandle = await page.evaluateHandle(ri => {
        const trs = [...document.querySelectorAll('#sku table tbody tr')]
        const tr = trs[ri]
        if (!tr) return null
        const heads = [...document.querySelectorAll('#sku table thead th')].map(th => th.textContent.trim())
        const thumbIdx = heads.findIndex(h => /预览图/.test(h))
        const tds = [...tr.querySelectorAll('td')]
        const td = thumbIdx >= 0 ? tds[thumbIdx] : null
        return td?.querySelector('input[type="file"]') || null
      }, r.row).catch(() => null)

      const el = fileHandle?.asElement?.()
      if (!el) break

      await el.uploadFile(imgPath).catch(() => {})
      // 等上传完成（文字消失）
      let ok = false
      for (let w = 0; w < 10; w++) {
        await sleep(1000)
        const rows = await readRows()
        const cur = rows.find(x => x.row === r.row)
        if (cur?.done) { ok = true; break }
      }
      if (ok) { filled++; break }
      // 没生效 → 重试（DOM 已重建，重新取 file input）
    }
  }

  // 最终验证
  await sleep(2000)
  const final = await readRows()
  const doneCount = final.filter(r => r.done).length
  return { filled: doneCount, total: initial.length }
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

  // ★ 先停用尺码表（勾选后会占住 SKU 表，导致 rows=0）
  if (defaults.disableSizeChart !== false) {
    const disabled = await disableSizeChart(page)
    if (disabled) log('已停用尺码表')
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

    // ★ 2026-10-27：用户维度匹配不到预置时，只有「颜色类/尺码类」才改预置承载
    //   「款式/型号/容量」等不该硬塞到预置维度（纸杯「款式」塞「容量」→ 值全乱）
    //   匹配不上就 addDim 新建（走 AI 辅助填）
    if (!target) {
      const COLOR = /^(颜色|色彩|花色|配色|颜色分类)$/
      const SIZE = /^(尺码|尺寸|大小|码数|参考分类)$/
      if (COLOR.test(userDim)) target = info.dims.find(d => d.type === 'color-input')
      if (!target && SIZE.test(userDim)) target = info.dims.find(d => d.type === 'checkbox')
      if (target) {
        log(`  预置没有「${userDim}」→ 改用预置「${target.dim}」承载`)
      }
    }

    if (!target) {
      // 预置确实没有 → 才新建规格类型
      log(`  预置没有「${userDim}」→ 点「添加规格类型」`)
      const ok = await addDim(page, userDim)
      if (!ok) {
        log(`  ❌ 下拉没有「${userDim}」`)
        return { ok: false, skuRows: 0, message: `下拉里没有「${userDim}」` }
      }
      info = await scanDims(page)
      target = matchDim(userDim, info.dims) || info.dims[info.dims.length - 1]
      // ★ 新建维度的「规格类型」value 可能还没渲染完，等 2 秒重扫
      if (target && /^规格类型/.test(target.dim)) {
        await sleep(2000)
        info = await scanDims(page)
        target = matchDim(userDim, info.dims) || info.dims[info.dims.length - 1]
      }
      log(`  新建后维度: ${info.dims.map(d => d.dim).join(', ')}`)
    }

    if (!target) { log(`  ❌ 找不到目标维度`); continue }
    log(`  → 填到「${target.dim}」(${target.type})`)

    // ★ 新建维度后等页面渲染完（规格值输入框出现）再填
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

    if (target.type === 'checkbox') {
      // checkbox 型：先试勾选，没中用自定义输入框
      const r = await checkBoxes(page, target.idx, values)
      r.forEach(x => log(`    "${x.v}" → ${x.ok ? ('勾了' + (x.via === 'custom-input' ? '(自定义输入框)' : '')) : '没找到'}`))
    } else if (target.type === 'color-input') {
      const r = await fillColorInputs(page, target.idx, values)
      r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}`))
    } else {
      // custom-input / spec-type
      // ★ 2026-10-27：spec-type（新建维度）走 AI 视觉辅助选框
      //   纯选择器搞不定：新建维度的空框/已填框混在一起、类目间结构有差异
      if (target.type === 'spec-type' && defaults.useAi !== false) {
        log(`  → AI 辅助填「${target.dim}」(${values.length} 值)`)
        try {
          const { aiFillDim } = await import('./ai-fill.mjs')
          const r = await aiFillDim(page, target.dim, values, { dimIdx: target.idx })
          r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'} (${x.via}${x.reason ? ': ' + x.reason : ''})`))
        } catch (e) {
          log(`  AI 填失败，回退普通填: ${e?.message || e}`)
          const r = await fillCustomInputs(page, target.idx, '', values)
          r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}`))
        }
      } else {
        // custom-input：用维度名做 placeholder 关键词
        const kw = target.dim
        const r = await fillCustomInputs(page, target.idx, kw, values)
        r.forEach(x => log(`    "${x.v}" → ${x.ok ? 'OK' : '失败'}`))
      }
    }
    await sleep(1500)
  }

  // 填 SKU 价格表（默认跳过，由模式2改包注入 price/stock）
  if (defaults.fillPriceTable) {
    log('填 #sku 价格表…')
    const skuRes = await fillSkuTable(page, price, stock)
    log(`  ${skuRes.rows} 行，填了 ${skuRes.filled} 格`)
  } else {
    log('跳过价格表 DOM 填写（由模式2改包注入）')
  }

  // 参考价（同理，改包会注入；但页面校验可能需要，留着可选）
  if (defaults.fillRefPrice) {
    const refPrice = (parseFloat(price) + 15).toFixed(1)
    const refOk = await fillRefPrice(page, refPrice)
    log(`参考价 ${refPrice} → ${refOk ? 'OK' : '未找到输入框'}`)
  }

  // 读 SKU 行数（验证规格是否建成功）
  // ★ 必须读表头含「拼单价」的那个 table（#sku 内可能有多个 table）
  const readSkuRows = () => page.evaluate(() => {
    for (const tb of document.querySelectorAll('#sku table')) {
      const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
      if (heads.some(h => /拼单价|库存/.test(h))) {
        return tb.querySelectorAll('tbody tr').length
      }
    }
    return 0
  }).catch(() => 0)

  let skuRows = 0
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    skuRows = await readSkuRows()
    if (skuRows > 1) break
  }

  // ★ 填 SKU 预览图（不传 → 平台报「请上传第1行规格的预览图」拦提交）
  if (defaults.thumbMap && Object.keys(defaults.thumbMap).length) {
    log('填 SKU 预览图…')
    const thumbRes = await fillSkuThumbs(page, defaults.thumbMap)
    log(`  预览图: ${thumbRes.filled}/${thumbRes.total} 行`)
  }

  return {
    ok: skuRows > 0,
    skuRows,
    message: `DOM 填规格完成：${skuRows} 行 SKU`,
  }
}
