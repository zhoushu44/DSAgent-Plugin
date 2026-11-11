/**
 * preflight.mjs —— 上架前置处理（图片规整 + 品牌兜底 + 规格预览图）
 *
 * 【为什么需要】
 * 2026-11-09 实测：publish.mjs 引用了 ./preflight.mjs，但这个文件**从没被提交**，
 * 于是每次发布都走 catch 分支 —— 图片**根本没有规整**（详情图超宽/超高、主图非正方形
 * 都会被拼多多驳回），品牌也没兜底。
 *
 * 【职责】
 *   ① prepImages(parsed, opts)  → 图片规整
 *      平台硬规则（imgprep.py 里有完整实现）：
 *        · 详情图：宽 480~1200px，高 ≤1500px，**逐张单图**（超高要切分，不是压扁）
 *        · 主图：1:1 正方形，≥800×800
 *        · 规格预览图：1:1，≥480×480
 *        · 单张 ≤3MB
 *      主实现 = imgprep.py（PIL + numpy，维度感知）；
 *      没有 Python/PIL 时降级 = img-prep.mjs 的 prepareImages（只压体积，不管尺寸）。
 *   ② ensureBrand(parsed) → 品牌缺省填「无」
 *      拼多多类目把品牌列为必填，不填会在属性区卡住发不出去。
 *
 * 【返回结构】
 *   { main: string[], detail: string[], spec: string[], actions: [{file, action, before, after}] }
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAX_BYTES = 3 * 1024 * 1024

/* ────────────────────────── Python 探测 ────────────────────────── */

const PY_CANDIDATES = [
  'C:/Users/Administrator/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe',
  'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe',
  'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe',
]

let _py = null
let _pyChecked = false

function findPython() {
  if (_pyChecked) return _py
  _pyChecked = true
  // ① 捆绑 Python（一定带 numpy + Pillow）
  for (const p of PY_CANDIDATES) {
    if (!fs.existsSync(p)) continue
    try {
      execFileSync(p, ['-c', 'import PIL, numpy'], { stdio: 'ignore', timeout: 20000 })
      _py = p
      return _py
    } catch { /* 下一个 */ }
  }
  // ② PATH 上的 python
  for (const name of ['python', 'python3']) {
    try {
      execFileSync(name, ['-c', 'import PIL, numpy'], { stdio: 'ignore', timeout: 20000 })
      _py = name
      return _py
    } catch { /* 下一个 */ }
  }
  return null
}

/* ────────────────────────── 品牌兜底 ────────────────────────── */

/**
 * 品牌缺省填「无」。
 * 已是 attributes 数组 / 对象两种形态都支持。
 */
export function ensureBrand(parsed) {
  const p = { ...parsed }
  const attrs = Array.isArray(p.attributes) ? p.attributes.slice() : []
  const has = (name) => attrs.some(a => String(a?.name || '').trim() === name)

  if (!has('品牌') && !has('品牌名称') && !p.brand) {
    attrs.push({ name: '品牌', value: '无' })
  }
  if (attrs.length) p.attributes = attrs
  return p
}

/* ────────────────────────── 图片规整 ────────────────────────── */

/**
 * @param {object} parsed 统一商品数据 { images, detailImages?, specs? }
 * @param {object} opts { scriptDir? }
 * @returns {{main:string[], detail:string[], spec:string[], actions:Array}}
 */
export async function prepImages(parsed, opts = {}) {
  const scriptDir = opts.scriptDir || HERE
  const main = (parsed.images || []).map(String).filter(Boolean)
  const detail = (parsed.detailImages || []).map(String).filter(Boolean)
  const spec = []
  // 规格预览图（第一维的值上带 image 的）
  for (const dim of (parsed.specs || [])) {
    for (const v of (dim?.values || [])) {
      if (v?.image) spec.push(String(v.image))
    }
  }

  const fallback = { main, detail, spec, actions: [], degraded: true }
  if (!main.length && !detail.length && !spec.length) return fallback

  const py = findPython()
  if (py) {
    try {
      const out = runImgprep(py, { main, detail, spec }, scriptDir)
      if (out) return out
    } catch (e) {
      console.warn(`[preflight] imgprep.py 执行失败（降级到体积压缩）：${String(e?.message || e).slice(0, 120)}`)
    }
  }

  // 降级：只压体积，尺寸规则交给平台报错
  try {
    const { prepareImages } = await import(path.join(scriptDir, 'img-prep.mjs'))
    const all = [...main, ...detail, ...spec]
    const r = await prepareImages(all, { maxBytes: MAX_BYTES, log: (m) => console.warn(m) })
    const map = new Map((r.detail || []).map(d => [d.src, d.out || d.src]))
    const fix = (arr) => arr.map(f => map.get(f) || f)
    const actions = (r.detail || [])
      .filter(d => d.ok && d.out && d.out !== d.src)
      .map(d => ({ file: d.src, action: '压缩', before: `${d.from}B`, after: `${d.bytes}B` }))
    return { main: fix(main), detail: fix(detail), spec: fix(spec), actions, degraded: true }
  } catch (e) {
    console.warn(`[preflight] img-prep 降级也失败：${String(e?.message || e).slice(0, 120)}`)
    return fallback
  }
}

/** 调 imgprep.py（job.json → report.json） */
function runImgprep(py, files, scriptDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-pre-'))
  const job = path.join(tmp, 'job.json')
  const rep = path.join(tmp, 'report.json')
  fs.writeFileSync(job, JSON.stringify({ ...files, maxBytes: MAX_BYTES }), 'utf8')
  const pyScript = path.join(scriptDir, 'imgprep.py')
  if (!fs.existsSync(pyScript)) return null
  execFileSync(py, [pyScript, '--job', job, '--report', rep], {
    stdio: ['ignore', 'ignore', 'pipe'], timeout: 180000,
  })
  if (!fs.existsSync(rep)) return null
  const r = JSON.parse(fs.readFileSync(rep, 'utf8'))
  const clean = (arr) => (arr || []).map(String).filter(f => fs.existsSync(f))
  return {
    main: clean(r.main),
    detail: clean(r.detail),
    spec: clean(r.spec),
    actions: r.actions || [],
    degraded: false,
  }
}

export default { prepImages, ensureBrand }
