/**
 * template.mjs — 类目模板系统（基座版·定稿）
 *
 * ══════════════════════════════════════════════════════════════
 *  唯一的正确来源：基座 request() 调 template/mall
 * ══════════════════════════════════════════════════════════════
 *
 *  ★ 为什么必须走基座
 *    Node 直连 fetch      → 40002 操作太过频繁
 *    页面内 fetch         → 40002
 *    request() 基座       → ✅ 成功（自动签名 + 正确通道）
 *
 *  ★ 一个接口拿全
 *    GET /draco-ms/mms/template/mall?catId=<类目id>
 *    → {
 *        id, name, cat_ids,
 *        input_max_spec_num,     // 0=不能加规格, 1/2=最多几维
 *        max_sku_num,            // 最多 SKU 数
 *        modules: [{ id, propertys: [...] }],   // ★ 属性 + 全部选项
 *        spec_module: { id, properties: [...] } // 规格维度
 *      }
 *
 *  ★ 属性结构
 *    propertys[]: {
 *      id,                 // template_pid ★ 提交时用
 *      name_alias,         // 属性名（中文）★
 *      pid,                // ref_pid
 *      required,           // 必填
 *      values: { content: [{ vid, value }] }   // ★ 全部可选值
 *    }
 *
 * ══════════════════════════════════════════════════════════════
 *  用法
 * ══════════════════════════════════════════════════════════════
 *  import { buildTemplate, loadTemplate, validateAttrValues, validateSpecs }
 *    from './template.mjs'
 *
 *  await buildTemplate({ catId: 16675, categoryName: '纸杯' })
 *  const tpl = loadTemplate(16675)
 *  validateAttrValues(tpl, { '品牌': '爱绿森' })
 *  validateSpecs(tpl, [{ name:'款式', values:['A'] }])
 *
 *  CLI:
 *  node template.mjs list
 *  node template.mjs build --cat 16675 [--name 纸杯]
 *  node template.mjs show --cat 16675
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const TPL_ROOT = path.join(PLUGIN, 'artifacts', 'pdd-templates')
const BASE = 'https://mms.pinduoduo.com'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════
//  账号
// ═══════════════════════════════════════════════════════════════════
async function getAccount(shopKey) {
  const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN, 'lib/services/credential-store.js')).href)
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const all = store.listAccounts().filter(a => a.platform === 'pdd_mms')
  if (shopKey) {
    const a = all.find(x => x.shop_key === shopKey || x.shop_key.includes(shopKey))
    if (!a) throw new Error(`找不到账号 ${shopKey}`)
    return a
  }
  const a = all.find(x => x.display_label === '空空商行') || all[0]
  if (!a) throw new Error('无拼多多账号')
  return a
}

// ═══════════════════════════════════════════════════════════════════
//  目录
// ═══════════════════════════════════════════════════════════════════
function dirOf(name, catId) {
  // ★ 完整路径做目录名：> 换成 _，去掉 Windows 非法字符
  const safe = String(name)
    .replace(/\s*>\s*/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '')
    .trim()
  return path.join(TPL_ROOT, `${safe}-${catId}`)
}

function findDir(catId) {
  if (!fs.existsSync(TPL_ROOT)) return null
  const d = fs.readdirSync(TPL_ROOT, { withFileTypes: true })
    .filter(x => x.isDirectory() && x.name.endsWith(`-${catId}`))
    .map(x => path.join(TPL_ROOT, x.name))[0]
  return d || null
}

/** 列出所有模板 */
export function listTemplates() {
  if (!fs.existsSync(TPL_ROOT)) return []
  return fs.readdirSync(TPL_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const f = path.join(TPL_ROOT, d.name, 'template.json')
      if (!fs.existsSync(f)) return null
      try {
        const t = JSON.parse(fs.readFileSync(f, 'utf8'))
        return {
          dir: d.name,
          category: t.category?.name || '',
          catId: t.category?.catId || 0,
          templateId: t.templateId || 0,
          attrCount: (t.attributes || []).length,
          maxDims: t.specs?.maxDims ?? 0,
          specDimCount: (t.specs?.dimensions || []).length,
          capturedAt: t.capturedAt || '',
        }
      } catch { return null }
    })
    .filter(Boolean)
}

/** 按 catId 或类目名读模板 */
export function loadTemplate(catIdOrName) {
  const key = String(catIdOrName || '')
  let dir = null
  if (/^\d+$/.test(key)) dir = findDir(key)
  if (!dir) {
    const all = listTemplates()
    const hit = all.find(t => t.category === key) || all.find(t => key && t.dir.includes(key))
    if (hit) dir = path.join(TPL_ROOT, hit.dir)
  }
  if (!dir) return null
  const f = path.join(dir, 'template.json')
  if (!fs.existsSync(f)) return null
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

// ═══════════════════════════════════════════════════════════════════
//  采集（基座）
// ═══════════════════════════════════════════════════════════════════

/**
 * 用基座拉 template/mall 原始数据
 * @returns {Promise<object>} 模板树
 */
export async function fetchMallTemplate(catId, opts = {}) {
  const { callApi } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-request.mjs')).href)
  const acc = await getAccount(opts.shopKey)

  // ★ 2026-11-10 纯 Node 化：走**注册表接口**（mms.mallTemplate），
  //   路径/方法/查询参数都在基座里声明，这里不再手拼 URL。
  const r = await callApi('mms.mallTemplate', { catId: Number(catId) }, {
    account: acc,
    shopKey: acc.shop_key,
    page: opts.page || undefined,
  })

  if (!r.ok) {
    throw new Error(`template/mall 失败: ${r.ec || r.failureKind || ''} ${JSON.stringify(r.data || {}).slice(0, 200)}`)
  }
  if (!r.data || typeof r.data !== 'object') throw new Error('template/mall 返回空')
  return r.data
}

/** 把 template/mall 原始树转成标准模板 */
export function normalizeMall(raw) {
  // ① 属性
  const attributes = []
  for (const mod of (raw.modules || [])) {
    for (const p of (mod.propertys || [])) {
      const vals = p.values?.content || p.values || []
      const a = {
        templatePid: p.id,
        label: String(p.name_alias || p.name || '').trim(),
        refPid: p.pid,
        moduleId: mod.id,
        required: !!(p.required ?? p.is_required),
        mode: (p.multi_select || p.multiSelect) ? 'multiple' : 'single',
        unit: p.value_unit || '',
        topTip: p.top_tip || '',
        bottomTip: p.bottom_tip || '',
        options: (Array.isArray(vals) ? vals : []).map(v => ({
          vid: v.vid ?? v.id,
          value: String(v.value ?? v.content ?? ''),
        })).filter(o => o.value),
      }
      a.optionCount = a.options.length
      if (a.label) attributes.push(a)
    }
  }

  // ② 规格维度
  //    ★ 三种模式，必须分清：
  //      is_spec=false + 0 维度  → 该类目不开放规格（门贴/餐垫）
  //      is_spec=true + 维度有值 → 平台预设点选型（服饰：颜色分类/尺码）
  //      is_spec=true + 维度无值 → 自定义输入型（纸杯：容量）
  const specProps = raw.spec_module?.properties || []
  const dimensions = specProps.map(p => {
    const vals = (p.values || []).map(v => ({
      vid: v.vid ?? v.id,
      value: String(v.value ?? ''),
      ...(v.spec_id ? { specId: v.spec_id } : {}),
      ...(v.group ? { group: v.group.name } : {}),
      ...(v.extend_info ? { extra: v.extend_info } : {}),
    })).filter(v => v.value)

    // ★ 每个维度同时支持两种填法：
    //    ① 从预设值里点选（presetValues）
    //    ② 自己输入名字（input_max_num > 0 时允许）
    //    canNote=true 时还能给值加备注（如「偏深」「偏亮」）
    const allowCustom = (p.input_max_num ?? 0) > 0 || vals.length === 0

    return {
      // ── 标识 ──────────────────────────────────
      name: String(p.name_alias || p.name || '').trim(),
      id: p.id,
      refPid: p.pid,
      specId: p.spec_id ?? 0,

      // ── 控件行为（★ 原样保留，页面全靠这些）──
      controlType: p.control_type ?? -1,      // 0=输入框  3=勾选网格
      valueType: p.value_type ?? 0,          // 0=文本/枚举  1=数值
      unit: p.value_unit || '',              // 如 "mL"
      precision: p.value_precision ?? 0,     // 小数位
      minValue: p.min_value === '' || p.min_value == null ? null : Number(p.min_value),
      maxValue: p.max_value === '' || p.max_value == null ? null : Number(p.max_value),
      inputMaxNum: p.input_max_num ?? 0,     // 最多几个值
      canNote: !!p.can_note,                 // 值可否加备注
      uploadPic: !!p.upload_pic,             // 值可否配图
      isAllValue: !!p.is_all_value,          // 是否允许任意值
      chooseMaxNum: p.choose_max_num ?? 0,   // 最多选几个
      valueCanSort: !!p.value_can_sort,
      required: !!p.required,

      // ── 预设值 ────────────────────────────────
      presetValues: vals,
      presetCount: vals.length,

      // ── 兼容旧字段（type 由 controlType + valueType 推导）──
      type: (p.control_type === 3) ? 'checkbox'
          : (p.value_type === 1) ? 'number'
          : 'text',
      allowCustom: allowCustom,
      maxCustomValues: p.input_max_num ?? 0,

      tip: p.bottom_tip || '',
    }
  }).filter(d => d.name)

  // ★ 规格模式判定
  const specMode =
    raw.is_spec === false || dimensions.length === 0
      ? 'none'                                              // 不开放规格
      : dimensions.every(d => d.presetCount > 0 && !d.allowCustom)
        ? 'preset'                                          // 只能点选
        : dimensions.every(d => d.presetCount === 0)
          ? 'custom'                                        // 只能手写
          : 'mixed'                                         // 点选 + 手写都能

  return {
    templateId: raw.id || 0,
    category: {
      name: String(raw.name || '').replace(/\(.*\)$/, '').trim(),
      catId: (raw.cat_ids || [])[0] || 0,
      cats: raw.cats || [],
    },
    attributes,
    specs: {
      isSpec: raw.is_spec !== false,               // ★ 是否开放规格
      mode: specMode,                              // ★ none | preset | custom | mixed
      maxDims: dimensions.length,                  // ★ 实际维度数（不是 input_max_spec_num）
      customDimsLimit: raw.input_max_spec_num ?? 0, // 自定义输入维度上限（服饰=0）
      singleSpecValueNum: raw.single_spec_value_num ?? 0,
      dimensions,
    },
    limits: {
      maxSku: raw.max_sku_num ?? 0,
      chooseAllQualifySpec: !!raw.choose_all_qualify_spec,
    },
  }
}

/**
 * 查类目完整路径（纯 Node 直连即可，不需要浏览器）
 *
 * GET /vodka/v2/mms/search/categories/v2?keyword=<关键词>
 * → cat_info_v2_lists[] 里按叶子 cat_id 匹配，取 cat_name_1..4
 *
 * @param {number} catId  叶子类目 id
 * @param {object} opts   { shopKey?, keywords? }
 * @returns {Promise<{ok:boolean, path:string[], pathIds:number[], fullName:string, keyword?:string}>}
 */
export async function fetchCategoryPath(catId, opts = {}) {
  const { callApi } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-request.mjs')).href)
  const acc = await getAccount(opts.shopKey)

  // 关键词候选：调用方给的 > 平台叶子名 > 类目名
  const kws = (opts.keywords?.length ? opts.keywords : []).slice()
  if (opts.platformLeafName) kws.push(opts.platformLeafName)
  if (opts.categoryName) kws.push(opts.categoryName)
  const uniqKws = [...new Set(kws.filter(Boolean))]

  for (const kw of uniqKws) {
    try {
      // ★ 2026-11-10 纯 Node 化：走注册表接口 mms.categorySearch
      //   （原来这里是裸 fetch 手拼 URL —— 绕过基座就没节流、没 Cookie 自愈、
      //    没统一 UA/Referer，账号一旦漂移就 40001）
      const r = await callApi('mms.categorySearch', { keyword: kw }, {
        account: acc,
        shopKey: acc.shop_key,
      })
      const j = r.data
      // ★ 2026-11-10 实测：该接口的返回**直接就是 cat_info_v2_lists**（顶层），
      //   不是文档里写的 result.cat_info_v2_lists。两种都兼容。
      const list = j?.cat_info_v2_lists
        || j?.result?.cat_info_v2_lists
        || (Array.isArray(j?.result) ? j.result : [])
        || (Array.isArray(j) ? j : [])
      for (const c of list) {
        const names = [c.cat_name_1, c.cat_name_2, c.cat_name_3, c.cat_name_4].filter(Boolean)
        const ids = [c.cat_id_1, c.cat_id_2, c.cat_id_3, c.cat_id_4].filter(Boolean)
        if (!ids.includes(Number(catId))) continue
        return { ok: true, path: names, pathIds: ids, fullName: names.join(' > '), keyword: kw }
      }
    } catch { /* 换下一个关键词 */ }
    await sleep(600)
  }
  return { ok: false, path: [], pathIds: [], fullName: '' }
}

/**
 * 采集并保存模板
 * @param {object} opts { catId, categoryName?, shopKey?, page?, keywords? }
 */
export async function buildTemplate(opts = {}) {
  const catId = Number(opts.catId || 0)
  if (!catId) throw new Error('缺 catId')

  const raw = await fetchMallTemplate(catId, opts)
  const tpl = normalizeMall(raw)

  // ★ 补完整类目路径（纯 Node 直连，不依赖浏览器）
  const leafName = (raw.cats || [])[0]?.cat_name || ''
  let fullName = ''
  try {
    const pathInfo = await fetchCategoryPath(catId, {
      shopKey: opts.shopKey,
      categoryName: opts.categoryName || tpl.category.name,
      platformLeafName: leafName,
      keywords: opts.keywords,
    })
    if (pathInfo.ok) {
      tpl.category.path = pathInfo.path
      tpl.category.pathIds = pathInfo.pathIds
      tpl.category.fullName = pathInfo.fullName
      tpl.category.pathKeyword = pathInfo.keyword
      fullName = pathInfo.fullName
    } else {
      tpl.category.path = [leafName].filter(Boolean)
      tpl.category.pathIds = [catId]
      tpl.category.fullName = leafName || opts.categoryName || tpl.category.name
      tpl.category.pathWarning = '类目搜索接口未匹配到完整路径，仅保留叶子名'
    }
  } catch (e) {
    tpl.category.pathWarning = '路径采集失败: ' + String(e.message).slice(0, 80)
  }

  // ★ 模板名统一用完整类目路径（如「餐饮具 > 一次性餐桌用品 > 纸杯」）
  let categoryName = opts.categoryName || fullName || tpl.category.fullName || tpl.category.name || `类目${catId}`
  if (fullName) categoryName = fullName          // 有完整路径就以路径为准
  tpl.category.name = categoryName
  tpl.category.catId = catId
  tpl.category.leafName = leafName || tpl.category.name

  tpl.capturedAt = new Date().toISOString()
  tpl.source = 'base request() → /draco-ms/mms/template/mall'

  const dir = dirOf(categoryName, catId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify(tpl, null, 2), 'utf8')
  fs.writeFileSync(path.join(dir, 'attributes.json'), JSON.stringify(tpl.attributes, null, 2), 'utf8')
  fs.writeFileSync(path.join(dir, 'specs.json'), JSON.stringify(tpl.specs, null, 2), 'utf8')

  return { ok: true, dir, template: tpl }
}

// ═══════════════════════════════════════════════════════════════════
//  校验
// ═══════════════════════════════════════════════════════════════════

/**
 * 校验属性值
 * @returns {{ok:boolean, errors:string[], warnings:string[], resolved:Array}}
 */
export function validateAttrValues(tpl, values = {}, opts = {}) {
  const out = { ok: false, errors: [], warnings: [], resolved: [] }
  if (!tpl?.attributes) { out.errors.push('模板无 attributes'); return out }

  const byLabel = new Map(tpl.attributes.map(a => [a.label, a]))

  for (const k of Object.keys(values)) {
    if (!byLabel.has(k)) out.warnings.push(`模板里没有属性「${k}」`)
  }

  if (opts.strictRequired !== false) {
    for (const a of tpl.attributes) {
      if (!a.required) continue
      const v = values[a.label]
      const empty = v === undefined || v === null || (Array.isArray(v) ? !v.length : String(v).trim() === '')
      if (empty) out.errors.push(`必填属性未提供：${a.label}`)
    }
  }

  for (const [label, raw] of Object.entries(values)) {
    const a = byLabel.get(label)
    if (!a) continue
    const vals = Array.isArray(raw) ? raw.map(String) : [String(raw)]
    if (a.options?.length) {
      const allowed = new Map(a.options.map(o => [o.value, o.vid]))
      for (const v of vals) {
        if (!allowed.has(v)) {
          out.errors.push(`${label}「${v}」不在可选范围（共 ${a.options.length} 个：${[...allowed.keys()].slice(0, 6).join('/')}…）`)
        } else {
          out.resolved.push({ label, templatePid: a.templatePid, value: v, vid: allowed.get(v), moduleId: a.moduleId, refPid: a.refPid })
        }
      }
    } else {
      out.warnings.push(`${label} 模板里没有选项（数值型或需现场拉取）`)
      for (const v of vals) out.resolved.push({ label, templatePid: a.templatePid, value: v, vid: null, moduleId: a.moduleId, refPid: a.refPid })
    }
  }

  out.ok = out.errors.length === 0
  return out
}

/**
 * 校验规格
 * @returns {{ok:boolean, errors:string[], maxDims:number}}
 */
export function validateSpecs(tpl, specs = []) {
  const sp = tpl?.specs || {}
  const out = {
    ok: false, errors: [], warnings: [],
    mode: sp.mode || 'none',
    maxDims: sp.maxDims ?? 0,
  }

  // 该类目不开放规格
  if (out.mode === 'none') {
    if (specs.length) out.errors.push('该类目不开放规格（is_spec=false），不能填 specs')
    else out.ok = true
    return out
  }

  if (!specs.length) { out.ok = true; return out }

  if (specs.length > out.maxDims) {
    out.errors.push(`规格最多 ${out.maxDims} 维，当前 ${specs.length} 维`)
    return out
  }

  const dims = sp.dimensions || []
  const byName = new Map(dims.map(d => [d.name, d]))

  for (const s of specs) {
    if (!s?.name) { out.errors.push('规格缺 name'); continue }

    const d = byName.get(s.name)
    if (!d) {
      out.errors.push(`规格维度「${s.name}」不在模板内（可用：${dims.map(x => x.name).join('/')}）`)
      continue
    }

    const vals = Array.isArray(s.values) ? s.values.map(String) : []
    if (!vals.length) { out.errors.push(`规格「${s.name}」没有值`); continue }

    // 值数量上限
    if (d.inputMaxNum > 0 && vals.length > d.inputMaxNum) {
      out.errors.push(`「${s.name}」最多 ${d.inputMaxNum} 个值，当前 ${vals.length} 个`)
      continue
    }

    // ★ 按 controlType + valueType 校验
    if (d.controlType === 0) {
      // 输入框型
      if (d.valueType === 1) {
        // 数值型：必须是数字，且在 min/max 之间
        for (const v of vals) {
          const n = Number(v)
          if (!String(v).trim() || Number.isNaN(n)) {
            out.errors.push(`「${s.name}」必须是数字，「${v}」不是${d.unit ? `（单位 ${d.unit}）` : ''}`)
            continue
          }
          if (d.minValue != null && n < d.minValue) {
            out.errors.push(`「${s.name}」${v} 小于最小值 ${d.minValue}${d.unit}`)
          }
          if (d.maxValue != null && n > d.maxValue) {
            out.errors.push(`「${s.name}」${v} 大于最大值 ${d.maxValue}${d.unit}`)
          }
          if (d.precision === 0 && !Number.isInteger(n)) {
            out.errors.push(`「${s.name}」${v} 必须是整数（精度 ${d.precision}）`)
          }
        }
      } else {
        // 文本型：只校验长度
        if (d.maxValue != null) {
          for (const v of vals) {
            if (v.length > d.maxValue) out.errors.push(`「${s.name}」值「${v}」超过 ${d.maxValue} 字符`)
          }
        }
      }
    } else if (d.controlType === 3) {
      // 勾选网格型
      const presetSet = new Set((d.presetValues || []).map(v => v.value))
      const notInPreset = vals.filter(v => !presetSet.has(v))

      if (notInPreset.length) {
        // ★ is_all_value=true → 任意值都能输
        if (d.isAllValue || d.inputMaxNum > 0) {
          out.warnings.push(`「${s.name}」自定义值 ${notInPreset.slice(0, 3).join('、')}（不在 ${d.presetCount} 个预设里）`)
        } else {
          out.errors.push(`「${s.name}」${notInPreset.slice(0, 3).join('、')} 不在预设范围（共 ${d.presetCount} 个：${[...presetSet].slice(0, 6).join('/')}…）`)
        }
      }
    } else {
      out.warnings.push(`「${s.name}」controlType=${d.controlType} 未知，跳过校验`)
    }
  }

  out.ok = out.errors.length === 0
  return out
}

// ═══════════════════════════════════════════════════════════════════
//  CLI
// ═══════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('template.mjs')) {
  const argv = process.argv.slice(2)
  const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
  const cmd = argv[0] || 'list'

  if (cmd === 'list') {
    const all = listTemplates()
    if (!all.length) { console.log('暂无模板'); process.exit(0) }
    console.log('已存模板：')
    for (const t of all) {
      console.log(`  ${t.category.padEnd(14)} catId=${String(t.catId).padEnd(14)} 属性${String(t.attrCount).padStart(3)}  最多${t.maxDims}维  维度${String(t.specDimCount).padStart(3)}`)
    }
    process.exit(0)
  }

  if (cmd === 'build') {
    const catId = Number(arg('cat', 0))
    if (!catId) { console.error('需 --cat <catId>'); process.exit(1) }
    console.log(`采集模板 catId=${catId}…`)
    const r = await buildTemplate({
      catId,
      categoryName: arg('name', ''),
      shopKey: arg('shop', ''),
      keywords: arg('keywords', '') ? arg('keywords', '').split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
    })
    const t = r.template
    console.log(`✅ ${r.dir}`)
    console.log(`  类目路径: ${t.category.fullName || '(未取到)'}`)
    console.log(`  模板 ${t.category.name} (id=${t.templateId})`)
    console.log(`  属性 ${t.attributes.length} 个 | 最多规格 ${t.specs.maxDims} 维 | 规格维度 ${t.specs.dimensions.length} 个`)
    for (const a of t.attributes) {
      console.log(`    ${a.label.padEnd(12)} ${String(a.optionCount).padStart(3)} 选项 ${a.required ? '[必填]' : ''}`)
    }
    process.exit(0)
  }

  if (cmd === 'show') {
    const t = loadTemplate(arg('cat', '') || arg('name', ''))
    if (!t) { console.log('找不到模板'); process.exit(1) }
    console.log(JSON.stringify(t, null, 2))
    process.exit(0)
  }

  console.log('用法:')
  console.log('  node template.mjs list')
  console.log('  node template.mjs build --cat 16675 [--name 纸杯] [--shop xxx]')
  console.log('  node template.mjs show --cat 16675')
}







