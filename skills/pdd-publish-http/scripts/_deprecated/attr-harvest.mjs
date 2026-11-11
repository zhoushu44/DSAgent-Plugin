/**
 * 发布组件 · 属性采集入库（attr-harvest.mjs）
 *
 * ★ 用户要求：「第一次发布的新的类目的时候，属性都要拔下来存库，能选什么属性怎么操作」
 *
 *   做法：第一次进某类目表单页时，把**所有下拉型属性**的：
 *     · 属性名（id/name）
 *     · 是否必填
 *     · 控件类型（dropdown / ingredient / input）
 *     · **全部候选值**（打开下拉，读真实选项）
 *   全部拔下来存成 JSON。下次同类目直接用，不用重新探测。
 *
 *   这样：
 *     · 第 1 次：慢（要开每个下拉读候选），但能拿到完整属性地图
 *     · 第 2 次起：快（直接用库里的候选值，不用开下拉）
 *
 * 存哪：skills/pdd-publish-http/assets/attr-schema.json
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const STORE = path.join(PLUGIN_ROOT, 'skills', 'pdd-publish-http', 'assets', 'attr-schema.json')

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 读全部模板 */
export function loadSchema() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'))
  } catch {
    return {}
  }
}

/** 按类目关键词找 schema */
export function findSchema(categoryKeyword) {
  const all = loadSchema()
  const kw = String(categoryKeyword || '').trim()
  if (!kw) return null
  if (all[kw]) return all[kw]
  for (const [k, v] of Object.entries(all)) {
    if (k.includes(kw) || kw.includes(k)) return v
    if ((v.catePath || '').includes(kw)) return v
  }
  return null
}

/** 保存 schema */
export function saveSchema(categoryKeyword, info) {
  const all = loadSchema()
  const kw = String(categoryKeyword || '').trim()
  if (!kw) return false
  const prev = all[kw] || {}
  all[kw] = {
    ...prev,
    ...info,
    updatedAt: new Date().toISOString(),
    harvestCount: (prev.harvestCount || 0) + 1,
  }
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2), 'utf8')
  return true
}

/**
 * 打开 beast-core Select 下拉（复用 lib 逻辑）
 */
async function openDropdown(page, id) {
  // 先按 Escape 关掉残留面板
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(200)

  return page.evaluate((fid) => {
    const fi = document.getElementById(fid)
    if (!fi) return false
    const head = fi.querySelector('[data-testid="beast-core-select-header"]')
      || fi.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (!head) return false
    head.scrollIntoView({ block: 'center' })
    try { fi.querySelector('input')?.focus() } catch { /* ignore */ }
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return true
  }, id).catch(() => false)
}

/** 读当前展开面板的候选 */
async function readOptions(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')]
      .filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out = []
    const seen = new Set()
    for (const n of panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')) {
      const t = (n.innerText || '').trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => [])
}

/** 关下拉 */
async function closeDropdown(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(300)
}

/**
 * 采集当前页面**所有下拉型属性**的完整 schema（含候选值）
 *
 * @param page 表单页
 * @param opts { log?, onProgress? }
 * @returns { attrs: [{ id, name, required, type, options, filled }], count }
 */
export async function harvestAttrSchema(page, opts = {}) {
  const log = opts.log || (() => {})

  // ① 读所有下拉型属性项
  const items = await page.evaluate(() => {
    const out = []
    const containers = [...document.querySelectorAll('.goods-propertys .property-item, .property-item')]
    for (const it of containers) {
      const fi = it.querySelector('[id^="basic.propertys."]') || it
      if (!fi) continue
      const inp = fi.querySelector('input[data-testid="beast-core-select-htmlInput"]')
      if (!inp) continue
      const labelEl = fi.querySelector('label') || it.querySelector('label')
      const name = (labelEl?.innerText || '').replace(/重要|必填|[*＊]/g, '').replace(/\s+/g, '')
      if (!name) continue
      out.push({
        id: fi.id || it.id || '',
        name,
        required: /重要|必填|[*＊]/.test((labelEl?.innerText || '') + (it.innerText || '')),
        filled: !!(inp.value || '').trim(),
        placeholder: inp.placeholder || '',
      })
    }
    return out
  }).catch(() => [])

  log(`[harvest] 发现 ${items.length} 个下拉型属性`)

  const attrs = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    log(`[harvest] ${i + 1}/${items.length} 「${it.name}」${it.required ? '（必填）' : ''}`)

    const opened = await openDropdown(page, it.id)
    await sleep(600)
    const options = await readOptions(page)
    await closeDropdown(page)
    await sleep(400)

    // 判断控件类型
    let type = 'dropdown'
    if (/添加材质成分/.test(it.placeholder)) type = 'ingredient'
    else if (!options.length && /请输入/.test(it.placeholder)) type = 'input'

    attrs.push({
      ...it,
      type,
      options,
    })

    if (opts.onProgress) opts.onProgress(i + 1, items.length, it.name, options.length)
  }

  log(`[harvest] 采集完成：${attrs.length} 个属性，共 ${attrs.reduce((s, a) => s + a.options.length, 0)} 个候选值`)
  return { attrs, count: attrs.length }
}

/**
 * 完整采集流程：进入类目页 → 采集 → 存库
 *
 * @param page 表单页（已选好类目）
 * @param category 类目关键词
 * @param catePath 类目路径
 * @param catId 类目 ID
 * @param opts { log? }
 */
export async function harvestAndSave(page, category, opts = {}) {
  const log = opts.log || (() => {})
  const { attrs, count } = await harvestAttrSchema(page, opts)

  if (!count) {
    log('[harvest] 未发现可采集的属性')
    return { ok: false, count: 0 }
  }

  const info = {
    catePath: opts.catePath || '',
    catId: opts.catId || '',
    attrs,
    attrCount: count,
    totalOptions: attrs.reduce((s, a) => s + a.options.length, 0),
  }
  saveSchema(category, info)
  log(`[harvest] 已存库「${category}」：${count} 个属性，${info.totalOptions} 个候选值`)
  return { ok: true, count, attrs }
}
