/**
 * 发布组件 · 视觉分析填规格（vision-fill.mjs）
 *
 * 思路：
 *   ① 截规格区图
 *   ② 传给视觉模型（cn:glm-5v-turbo）分析：
 *        这个维度是什么控件类型？该用什么填法？失焦点哪里？
 *   ③ 按分析结果执行填写
 *
 * 为什么需要它：
 *   拼多多不同类目的规格区结构完全不同：
 *     服装 → 「颜色分类」色值卡片（输入后必须失焦才提交）
 *     纸杯 → 「容量」纯文本输入
 *     手机壳 → 「型号」下拉/输入
 *     抱枕 → 「尺寸」纯文本输入
 *   写死任何一种都会挂，用视觉分析让模型看着页面决定。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = process.env.PYTHON || 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const ANALYZER = path.join(HERE, 'analyze_spec_ui.py')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 精确截取某个元素的区域（裁剪到元素边界，不截整页）
 *
 * ★ 2026-10-30 用户要求：只截「属性区」和「规格区」，不要全页截图。
 *   实现要点：
 *     1. 先 scrollIntoView，让元素进入视口
 *     2. 取 getBoundingClientRect，用 page.screenshot({ clip }) 精确裁剪
 *     3. 元素高于视口 → 分段滚动拼接（最多 3 段）
 *   绝不回退到整页截图。
 */
async function captureElement(page, selector, outPath, opts = {}) {
  const maxH = opts.maxHeight || 1600

  // ★ 2026-10-30 真机定论：不能自己算 clip！
  //   页面有 sticky header + 内层滚动容器，window.scrollTo / getBoundingClientRect
  //   算出来的 y 跟实际渲染位置对不上（截出来是页面顶部）。
  //
  //   正确做法：用 puppeteer 原生 elementHandle.screenshot() —— 它内部会
  //   自动把元素滚进视口并按元素真实边界裁剪，不依赖我们自己算坐标。
  //   元素比视口高时它会自动分段，这正是我们要的。

  const el = await page.$(selector).catch(() => null)
  if (!el) return null

  // 先确认元素可见且有尺寸
  const size = await el.evaluate(e => {
    const r = e.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }).catch(() => null)
  if (!size || size.w < 40 || size.h < 20) return null

  // 滚到元素（让 sticky header 稳定下来），再截
  await el.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {})
  await sleep(700)

  try {
    await el.screenshot({ path: outPath })
    if (!fs.existsSync(outPath)) return null
    // 校验：截出来的图不能是纯顶部空白（用文件大小粗筛，太小说明截错）
    const kb = fs.statSync(outPath).size / 1024
    if (kb < 3) return null
    return outPath
  } catch {
    return null
  }
}

/**
 * 截图规格区 → 调视觉模型分析
 *
 * ★ 2026-10-30 改为**全视口截图**：
 *   元素截图（elementHandle.screenshot）在长页面上会因滚动/渲染时机失败，
 *   而全视口截图永远成功（页面是稳定的）。
 *   把整个视口交给视觉模型，让它自己找规格区并判断结构。
 */
export async function analyzeSpecArea(page, dimName, values, opts = {}) {
  const log = opts.log || (() => {})
  const tmp = path.join(process.env.TEMP || '/tmp', `spec_${Date.now()}.png`)

  // ① 把规格区滚进视口（滚到容器顶部对齐）
  await page.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    if (box) box.scrollIntoView({ block: 'start' })
  }).catch(() => {})
  await sleep(900)

  // ② 全视口截图（不裁剪，最可靠）
  await page.screenshot({ path: tmp }).catch(() => {})
  if (!fs.existsSync(tmp)) {
    log('[vision] 截图失败')
    return { ok: false, error: 'screenshot failed' }
  }
  log(`[vision] 已截图 ${Math.round(fs.statSync(tmp).size / 1024)}KB（全视口）`)

  // ③ 调 Python 分析
  let out = ''
  try {
    out = execFileSync(PY, [ANALYZER, tmp, dimName, values.join(',')], {
      encoding: 'utf8',
      timeout: 150000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    return { ok: false, error: `analyzer failed: ${(e.message || '').slice(0, 150)}` }
  }

  // ④ 解析 JSON
  const line = String(out).trim().split('\n').filter(Boolean).pop() || ''
  try {
    const res = JSON.parse(line)
    log(`[vision] 「${dimName}」分析结果：type=${res.dim_type} strategy=${res.strategy} `
      + `confidence=${res.confidence} hints=${JSON.stringify(res.element_hints || [])}`)
    return res
  } catch {
    return { ok: false, error: 'parse output failed', raw: line.slice(0, 300) }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }
}

/**
 * 截图属性区 → 调视觉模型分析（只截属性区，不截整页）
 * @returns { ok, groups: [{ title, control, hint }], confidence }
 */
export async function analyzeAttrArea(page, opts = {}) {
  const log = opts.log || (() => {})
  const tmp = path.join(process.env.TEMP || '/tmp', `attr_${Date.now()}.png`)

  // ★ 2026-10-30 真机实测的容器选择器优先级：
  //   #property        [1626×378]  ← 真正的属性区（含所有下拉属性）✅
  //   #property-list-*  [731×69]   ← 单个属性行（太窄）
  //   .goods-propertys [1495×225]  ← 类目路径栏（错的！）
  //   #goods-propertys              ← 不存在
  const CANDIDATES = ['#property', '.goods-propertys', '#property-list']
  let shot = null
  let usedSel = ''
  for (const sel of CANDIDATES) {
    shot = await captureElement(page, sel, tmp, { maxHeight: 1400 })
    if (shot) { usedSel = sel; break }
  }
  if (!shot) {
    log('[vision] 属性区截图失败（所有候选选择器都无效）')
    return { ok: false, error: 'attr area screenshot failed' }
  }
  log(`[vision] 属性区容器：${usedSel}`)

  const prompt = `这是拼多多商品发布页的「商品属性」区域截图。

请观察并回答（只输出 JSON，不要解释）：

{
  "groups": [
    {
      "title": "属性名（如：材质成分/安全等级/适用季节）",
      "control": "控件类型：dropdown(下拉选择) / ingredient(材质成分多选弹窗) / input(文本输入) / unknown",
      "hint": "该控件当前显示的 placeholder 或按钮文字，如'请选择'/'添加材质成分(0/7)'"
    }
  ],
  "confidence": "high / medium / low"
}

只列出截图里**能看到的**属性项，不要编造。`

  let out = ''
  try {
    out = execFileSync(PY, [ANALYZER, tmp, '__ATTR_MODE__', prompt], {
      encoding: 'utf8',
      timeout: 150000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    return { ok: false, error: `analyzer failed: ${(e.message || '').slice(0, 150)}` }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }

  const line = String(out).trim().split('\n').filter(Boolean).pop() || ''
  try {
    const res = JSON.parse(line)
    log(`[vision] 属性区分析：${(res.groups || []).length} 项 confidence=${res.confidence}`)
    return res
  } catch {
    return { ok: false, error: 'parse output failed', raw: line.slice(0, 300) }
  }
}

/**
 * 点「添加规格类型」建出一个新维度行，并选中指定维度名
 *
 * ★ 2026-10-30：二维类目（手机壳：型号+颜色）页面**没有预置规格行**，
 *   只有「添加规格类型(0/2)」按钮。必须先建行，才能截图分析 / 填值。
 *
 * @returns { ok, picked } picked = 实际选中的维度名
 */
export async function addSpecDimension(page, dimName, opts = {}) {
  const log = opts.log || (() => {})

  // ① 点「添加规格类型」（真实鼠标坐标，React 忽略 JS .click()）
  //   ★ 2026-10-30：按钮常在视口外（y 超出 innerHeight），
  //     必须先 scrollIntoView 再重新取坐标，不能直接要求 r.y 在视口内。
  const btnPos = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, div, span, a')]
      .filter(e => {
        const t = (e.innerText || '').trim()
        if (!/^添加规格类型|^添加规格/.test(t)) return false
        const r = e.getBoundingClientRect()
        return r.width > 20 && r.height > 10
      })
    if (!btns.length) return null
    const b = btns[btns.length - 1]
    b.scrollIntoView({ block: 'center' })
    return { found: true }
  }).catch(() => null)
  if (!btnPos) { log('[vision] 找不到「添加规格类型」按钮'); return { ok: false } }

  await sleep(700)
  const btnPt = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, div, span, a')]
      .filter(e => {
        const t = (e.innerText || '').trim()
        if (!/^添加规格类型|^添加规格/.test(t)) return false
        const r = e.getBoundingClientRect()
        return r.width > 20 && r.height > 10
      })
    const b = btns[btns.length - 1]
    if (!b) return null
    const r = b.getBoundingClientRect()
    if (r.y < 0 || r.y > window.innerHeight - 5) return null
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!btnPt) { log('[vision] 滚动后按钮仍不可见'); return { ok: false } }

  await page.mouse.click(btnPt.x, btnPt.y).catch(() => {})
  await sleep(3000)

  // ② 打开新行的「规格类型」下拉
  const trigger = await page.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    if (!box) return null
    const rows = [...box.querySelectorAll('.property-container-v2, .goods-spec-row')]
    const last = rows[rows.length - 1]
    if (!last) return null
    const inp = last.querySelector('input[placeholder^="规格类型"]')
      || last.querySelector('[class*="ST_selectValueSingle"]')
    if (!inp) return null
    inp.scrollIntoView({ block: 'center' })
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!trigger) { log('[vision] 新建维度后找不到「规格类型」下拉'); return { ok: false } }

  await page.mouse.click(trigger.x, trigger.y).catch(() => {})
  await sleep(1800)

  // ③ 读候选 —— ★ 2026-10-30：不再自己猜，**先截图让视觉模型看下拉里有什么**
  let candidates = await page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const items = []
    const seen = new Set()
    // 下拉面板可能挂在 body 下（portal），所以全局找
    for (const p of [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"], [role="listbox"]')].filter(vis)) {
      for (const e of p.querySelectorAll('li, [role="option"], [class*="ST_item"]')) {
        if (!vis(e)) continue
        const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
        if (!t || t.length > 20 || seen.has(t)) continue
        seen.add(t)
        items.push(t)
      }
    }
    return items
  }).catch(() => [])

  let picked = null

  if (candidates.length) {
    // DOM 能读到候选 → 精确/包含匹配；匹配不上再交给视觉
    picked = candidates.find(c => c === dimName)
      || candidates.find(c => c.includes(dimName) || dimName.includes(c))
      || null
    log(`[vision] 下拉候选 ${candidates.length} 个：${candidates.slice(0, 12).join('/')}`)
  } else {
    log('[vision] DOM 读不到下拉候选，改用视觉识别')
  }

  // ★ 视觉兜底：DOM 读不到 or 匹配不上 → 截图给视觉模型，让它从截图里挑
  if (!picked) {
    try {
      // 下拉是浮层（portal 挂 body 下），元素截图抓不到 → 只能整页截图
      const tmp2 = path.join(process.env.TEMP || '/tmp', `dd_${Date.now()}.png`)
      await page.screenshot({ path: tmp2 }).catch(() => {})

      if (fs.existsSync(tmp2)) {
        const prompt = `这是拼多多商品发布页，我刚点了「添加规格类型」，下拉面板已展开。

我要选规格维度名「${dimName}」。

请从截图里找出下拉面板的候选列表，回答（只输出 JSON）：
{
  "dim_name": "下拉里与「${dimName}」最匹配的那一项的**完整原文**（必须严格照抄截图里的文字）",
  "all_options": ["截图里能看到的全部候选，最多15个"],
  "found": true/false
}

注意：候选可能是「颜色」「颜色分类」「颜色常用」等不同写法，选最接近「${dimName}」的那个。如果截图里没有下拉面板，found 设为 false。`
        const raw = execFileSync(PY, [ANALYZER, tmp2, '__ATTR_MODE__', prompt], {
          encoding: 'utf8', timeout: 120000,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        })
        const line = String(raw).trim().split('\n').filter(Boolean).pop() || ''
        const res = JSON.parse(line)
        if (res.found && res.dim_name) {
          picked = res.dim_name
          log(`[vision] 视觉选中维度名：「${picked}」（候选 ${(res.all_options || []).length} 个）`)
        } else {
          log(`[vision] 视觉未在下拉里找到「${dimName}」`)
        }
        try { fs.unlinkSync(tmp2) } catch { /* ignore */ }
      }
    } catch (e) {
      log(`[vision] 视觉识别候选失败：${e.message.slice(0, 80)}`)
    }
  }

  // ④ 点击选中（DOM 点击；picked 来自视觉时按文本找）
  if (picked) {
    const clicked = await page.evaluate((name) => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      for (const p of [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"], [role="listbox"]')].filter(vis)) {
        for (const e of p.querySelectorAll('li, [role="option"], [class*="ST_item"]')) {
          if (!vis(e)) continue
          const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
          if (t === name) { e.click(); return true }
        }
      }
      // 兜底：全局按文本找
      for (const e of [...document.querySelectorAll('li, [role="option"], [class*="ST_item"]')].filter(vis)) {
        const t = (e.innerText || '').replace(/\s+/g, ' ').trim()
        if (t === name) { e.click(); return true }
      }
      return false
    }, picked).catch(() => false)

    if (!clicked) log(`[vision] ⚠ 点击「${picked}」失败`)
    await sleep(1500)
  }
  const confirmed = await page.evaluate((name) => {
    const box = document.querySelector('#goods-spec-sku')
    if (!box) return false
    const rows = [...box.querySelectorAll('.property-container-v2, .goods-spec-row')]
    const last = rows[rows.length - 1]
    const v = (last?.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
    return v && (v.includes(name) || name.includes(v))
  }, dimName).catch(() => false)

  log(`[vision] 建维度「${dimName}」→ 选中「${picked || '?'}」${confirmed ? ' ✅' : ' ⚠ 未确认'}`)
  return { ok: !!picked, picked, confirmed }
}

/**
 * 判断规格区当前有几个维度行
 */
export async function countSpecRows(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    if (!box) return 0
    return [...box.querySelectorAll('.property-container-v2, .goods-spec-row')].length
  }).catch(() => 0)
}

/**
 * 按视觉分析结果填规格维度
 *
 * @param page
 * @param dimName 维度名（容量/型号/尺寸/颜色分类…）
 * @param values  [{ value, image? }] 或字符串数组
 * @param opts { log?, analysis?, autoAddDim? }
 * @returns { filled: [...], missed: [...], analysis }
 */
export async function fillDimByVision(page, dimName, values, opts = {}) {
  const log = opts.log || (() => {})
  const vals = (values || [])
    .map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim())
    .filter(Boolean)
  if (!vals.length) return { filled: [], missed: [], analysis: null }

  // ① 先确认页面有没有对应这个维度名的行 —— **不依赖视觉判断**
  //    ★ 2026-10-30：视觉模型看到「添加规格类型」按钮时，仍可能返回 text-input，
  //      导致直接去填一个不存在的输入框。所以必须先查 DOM 有没有这个维度的行。
  const hasDimRow = await page.evaluate((name) => {
    const box = document.querySelector('#goods-spec-sku')
    if (!box) return false
    const rows = [...box.querySelectorAll('.property-container-v2, .goods-spec-row')]
    return rows.some(r => {
      const t = (r.querySelector('.property-name-title')?.textContent
        || r.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent
        || r.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
      return t && (t === name || t.includes(name) || name.includes(t))
    })
  }, dimName).catch(() => false)

  if (!hasDimRow && opts.autoAddDim !== false) {
    log(`[vision] 页面没有「${dimName}」维度行，先建维度`)
    let added = await addSpecDimension(page, dimName, { log })
    // ★ 建维度失败 → 重试一次（第一次常因页面重渲染错过下拉时机）
    if (!added.ok) {
      log(`[vision] 建维度失败，5 秒后重试一次`)
      await sleep(5000)
      added = await addSpecDimension(page, dimName, { log })
    }
    if (added.ok) {
      await sleep(1800)
    } else {
      log(`[vision] ⚠ 建维度「${dimName}」两次都失败，仍尝试继续填值`)
    }
  }

  // ★★ 2026-10-30 用户指出：规格区若是「自定义输入框 + checkbox」结构（#newSpec），
  //    必须走「填最后空框 → 点空白 → 平台追加新行 → 继续填」的流程。
  //    不能按索引依次填（填完第一个后平台重排，索引全乱 → 值互相覆盖）。
  try {
    const isRowStyle = await page.evaluate(() => {
      const root = document.querySelector('#newSpec')
      if (!root) return false
      const inputs = [...root.querySelectorAll('input')].filter(e => {
        const ph = e.placeholder || ''
        if (!ph.includes('自定义')) return false
        if (ph.includes('排序')) return false
        const r = e.getBoundingClientRect()
        return r.width > 20 && r.height > 10
      })
      return inputs.length > 0
    }).catch(() => false)

    if (isRowStyle) {
      log(`[vision] 检测到「自定义输入框 + checkbox」结构（#newSpec）→ 走逐行填写`)
      const { fillSpecValuesRowByRow } = await import('./spec-row-fill.mjs')
      const r = await fillSpecValuesRowByRow(page, dimName, vals, { log })
      return { ...r, analysis: { ok: true, dim_type: 'row-input', strategy: 'row-by-row' } }
    }
  } catch (e) {
    log(`[vision] 逐行填写异常：${e.message.slice(0, 80)}，回退通用策略`)
  }

  // ② 查视觉缓存（同类目第 2 单起直接用，省 8s）
  let analysis = opts.analysis || null
  if (!analysis) {
    try {
      const { getVisionCache, setVisionCache, bumpVisionHit } = await import('./vision-cache.mjs')
      const cached = getVisionCache(opts.category || '', dimName)
      if (cached) {
        log(`[vision] 命中缓存「${dimName}」：${cached.dim_type}/${cached.strategy}（已用 ${cached.hitCount || 0} 次）`)
        analysis = { ok: true, ...cached, fromCache: true }
        bumpVisionHit(opts.category || '', dimName)
      }
    } catch { /* ignore */ }
  }

  // ③ 缓存没命中 → 截图分析
  if (!analysis) {
    analysis = await analyzeSpecArea(page, dimName, vals, { log })
    // 存缓存（仅当分析成功且置信度不是 low）
    if (analysis?.ok && analysis.confidence !== 'low') {
      try {
        const { setVisionCache } = await import('./vision-cache.mjs')
        setVisionCache(opts.category || '', dimName, analysis)
      } catch { /* ignore */ }
    }
  }

  if (!analysis?.ok) {
    log(`[vision] 分析失败：${analysis?.error || 'unknown'}，回退到通用输入`)
  }

  const strategy = analysis?.strategy || 'type-and-blur'
  const dimType = analysis?.dim_type || 'text-input'
  log(`[vision] 执行策略：${strategy}（维度类型 ${dimType}）${analysis?.fromCache ? ' [缓存]' : ''}`)

  const filled = []
  const missed = []

  // ② 复选框策略
  if (strategy === 'click-checkbox' || dimType === 'checkbox') {
    for (const v of vals) {
      const ok = await clickCheckboxByText(page, dimName, v)
      if (ok) filled.push(`${dimName}=${v}`)
      else missed.push(`${dimName}=${v}（复选框未找到）`)
    }
    return { filled, missed, analysis }
  }

  // ③ 输入型策略（type-and-blur / type-and-enter）
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    let ok = false

    // ★ 2026-10-30：单值失败时换策略重试（不只重试同一套动作）
    //   strategy 顺序：分析的策略 → type-and-enter → type-and-blur → Tab 失焦
    const strategies = [
      strategy,
      'type-and-enter',
      'type-and-blur',
    ].filter((s, idx, arr) => s && arr.indexOf(s) === idx)

    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const useStrategy = strategies[attempt % strategies.length]

      // ★ 2026-10-30 提速：**JS setter 优先**（比键盘快 5-10 倍）
      //   规格值输入框是普通 text input，React 受控组件用原生 setter + input/change 事件即可。
      //   JS 不生效时才退回真实键盘（键盘慢但最保险）。
      const jsDone = await page.evaluate((dn, idx, val) => {
        const root = document.querySelector('#goods-spec-sku')
        if (!root) return false
        const rows = [...root.querySelectorAll('.property-container-v2, .goods-spec-row')]
        let target = null
        for (const r of rows) {
          const t = (r.querySelector('.property-name-title')?.textContent
            || r.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent
            || r.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
          if (t && (t === dn || t.includes(dn) || dn.includes(t))) { target = r; break }
        }
        if (!target) target = rows[0]
        if (!target) return false
        const inputs = [...target.querySelectorAll('input')].filter(e => {
          const p = e.placeholder || ''
          if (p.startsWith('规格类型')) return false
          if (/排序|备注|搜索/.test(p)) return false
          if (e.type && e.type !== 'text') return false
          const r = e.getBoundingClientRect()
          return r.width > 20 && r.height > 10
        })
        const empty = inputs.filter(e => !(e.value || '').trim())
        const el = empty[Math.min(idx, empty.length - 1)] || inputs[Math.min(idx, inputs.length - 1)]
        if (!el) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (!setter) return false
        el.focus()
        setter.call(el, val)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, dimName, i, v).catch(() => false)

      if (jsDone) {
        await sleep(300)
        // JS 填完立即触发提交动作（Enter 最快）
        await page.keyboard.press('Enter').catch(() => {})
        await sleep(600)
        ok = await dimHasValue(page, dimName, v)
        if (ok) continue
        // JS 没生效 → 走键盘兜底
      }

      // 键盘兜底（真实事件，最保险）
      const pos = await findInputInDim(page, dimName, i, analysis?.element_hints || [])
      if (!pos) {
        log(`[vision] 「${v}」第 ${attempt + 1} 次：找不到输入框`)
        await sleep(800)
        continue
      }

      await page.mouse.click(pos.x, pos.y).catch(() => {})
      await sleep(250)
      await page.keyboard.down('Control').catch(() => {})
      await page.keyboard.press('KeyA').catch(() => {})
      await page.keyboard.up('Control').catch(() => {})
      await page.keyboard.press('Backspace').catch(() => {})
      await sleep(80)
      // ★ 提速：delay 从 80 降到 20
      await page.keyboard.type(v, { delay: 20 }).catch(() => {})
      await sleep(350)

      if (useStrategy === 'type-and-enter') {
        await page.keyboard.press('Enter').catch(() => {})
      } else {
        await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {})
        await sleep(150)
        await clickBlankInSpecArea(page).catch(() => {})
        await sleep(150)
        await page.keyboard.press('Tab').catch(() => {})
      }
      await sleep(800)

      ok = await dimHasValue(page, dimName, v)
      if (!ok) log(`[vision] 「${v}」第 ${attempt + 1} 次未成功（策略 ${useStrategy}）`)
    }

    if (ok) filled.push(`${dimName}=${v}`)
    else missed.push(`${dimName}=${v}（4 次未提交成功）`)
  }

  // ★ 2026-10-31：填完后**补勾所有「有值但未勾选」的规格行**
  //   实测收纳盒：3 尺寸 × 2 颜色应 6 项，实际只填 5 项 —— 少一个是因为某行 checkbox 没勾
  try {
    const fixed = await page.evaluate(() => {
      const root = document.querySelector('#goods-spec-sku') || document.querySelector('#newSpec')
      if (!root) return 0
      let n = 0
      for (const row of root.querySelectorAll('.package-item-container, [class*="package-item"]')) {
        const cb = row.querySelector('input[type=checkbox]')
        if (!cb || cb.checked || cb.disabled) continue
        // 只勾「有值」的行
        const hasVal = [...row.querySelectorAll('input[type=text], input:not([type])')]
          .some(e => (e.value || '').trim() && !(e.placeholder || '').includes('备注'))
        if (hasVal) { cb.click(); n++ }
      }
      // ★ 也用 beast-core 的 data-checked 判断
      for (const wrapper of root.querySelectorAll('[data-testid="beast-core-checkbox"][data-checked="0"]')) {
        const cb = wrapper.querySelector('input[type=checkbox]')
        if (cb && !cb.disabled) {
          const row = wrapper.closest('.package-item-container') || wrapper.parentElement
          const hasVal = row ? [...row.querySelectorAll('input')].some(e => (e.value || '').trim() && !(e.placeholder || '').includes('备注')) : false
          if (hasVal) { wrapper.click(); n++ }
        }
      }
      return n
    }).catch(() => 0)
    if (fixed > 0) {
      log(`[vision] 补勾 ${fixed} 个未勾选的规格行`)
      await sleep(500)
    }
  } catch { /* ignore */ }

  return { filled, missed, analysis }
}

/** 在指定维度里找第 idx 个空输入框（按 placeholder hint 优先） */
async function findInputInDim(page, dimName, idx, hints = []) {
  return page.evaluate((dn, i, hs) => {
    const root = document.querySelector('#goods-spec-sku')
    if (!root) return null

    // 找维度容器：按标题文字匹配，否则按索引
    const rows = [...root.querySelectorAll('.property-container-v2, .goods-spec-row')]
    let target = null
    for (const r of rows) {
      const t = (r.querySelector('.property-name-title')?.textContent
        || r.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent
        || r.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
      if (t && (t === dn || t.includes(dn) || dn.includes(t))) { target = r; break }
    }
    if (!target) target = rows[0]
    if (!target) return null

    // 该维度内的候选输入框（排除备注/排序/规格类型/搜索）
    let inputs = [...target.querySelectorAll('input')].filter(e => {
      const p = e.placeholder || ''
      if (p.startsWith('规格类型')) return false
      if (/排序|备注|搜索/.test(p)) return false
      if (e.type && e.type !== 'text') return false
      const r = e.getBoundingClientRect()
      return r.width > 20 && r.height > 10
    })

    // 优先用视觉给的 hint 缩小范围
    if (hs?.length) {
      const byHint = inputs.filter(e => hs.some(h => h && (e.placeholder || '').includes(h)))
      if (byHint.length) inputs = byHint
    }

    const empty = inputs.filter(e => !(e.value || '').trim())
    const el = empty[Math.min(i, empty.length - 1)] || inputs[Math.min(i, inputs.length - 1)]
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, dimName, idx, hints).catch(() => null)
}

/** 点规格区空白（失焦用） */
async function clickBlankInSpecArea(page) {
  const pt = await page.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku')
    if (!box) return null
    const r = box.getBoundingClientRect()
    if (r.width < 30) return null
    return { x: Math.round(r.x + 8), y: Math.round(r.y + 8) }
  }).catch(() => null)
  if (!pt) return false
  await page.mouse.click(pt.x, pt.y).catch(() => {})
  return true
}

/** 校验：该维度内是否有这个值 */
async function dimHasValue(page, dimName, value) {
  return page.evaluate((dn, v) => {
    const root = document.querySelector('#goods-spec-sku')
    if (!root) return false
    const rows = [...root.querySelectorAll('.property-container-v2, .goods-spec-row')]
    let target = null
    for (const r of rows) {
      const t = (r.querySelector('.property-name-title')?.textContent
        || r.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent
        || r.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
      if (t && (t === dn || t.includes(dn) || dn.includes(t))) { target = r; break }
    }
    if (!target) target = rows[0]
    if (!target) return false
    // 输入框值里有 OR 已勾选的复选框里有
    const inInput = [...target.querySelectorAll('input')].some(e => (e.value || '').trim() === v)
    if (inInput) return true
    const inCheckbox = [...target.querySelectorAll('.package-item-container')].some(it => {
      const txt = (it.querySelector('.check-wrapper')?.textContent || '').trim()
      const cb = it.querySelector('input[type="checkbox"]')
      return txt === v && cb?.checked
    })
    return inCheckbox
  }, dimName, value).catch(() => false)
}

/** 点复选框（预设值） */
async function clickCheckboxByText(page, dimName, value) {
  return page.evaluate((dn, v) => {
    const root = document.querySelector('#goods-spec-sku')
    if (!root) return false
    const rows = [...root.querySelectorAll('.property-container-v2, .goods-spec-row')]
    let target = null
    for (const r of rows) {
      const t = (r.querySelector('.property-name-title')?.textContent
        || r.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent
        || r.querySelector('input[placeholder^="规格类型"]')?.value || '').trim()
      if (t && (t === dn || t.includes(dn) || dn.includes(t))) { target = r; break }
    }
    if (!target) target = rows[0]
    if (!target) return false
    for (const it of target.querySelectorAll('.package-item-container')) {
      const txt = (it.querySelector('.check-wrapper')?.textContent || '').trim()
      if (txt !== v) continue
      const cb = it.querySelector('input[type="checkbox"]')
      if (cb && cb.checked) return true
      ;(it.querySelector('label') || it).click()
      return true
    }
    return false
  }, dimName, value).catch(() => false)
}
