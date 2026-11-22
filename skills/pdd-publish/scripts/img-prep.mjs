/**
 * 发布组件 · 图片预处理（尺寸归一 + 压缩到平台上限）
 *
 * ★ 为什么需要
 *   拼多多主图要求单张 ≤ 3MB，淘宝 5MB。AI 生成的 PNG 常在 3-4MB，
 *   直接上传会被平台拒绝或让 lib 层直接报错退出。
 *   与其报错让用户手工压，不如自动处理：超过阈值就降质/缩放。
 *
 * ★ 策略（按顺序尝试，直到达标）
 *   ① 原图已达标 → 直接返回原路径
 *   ② PNG → JPEG（quality 92）：通常能降 60-80%
 *   ③ JPEG quality 85 → 78 → 70
 *   ④ 尺寸缩小到 1440 / 1200 / 1000（长边）
 *   ⑤ 仍超标 → 报错（附实际大小，建议手工处理）
 *
 * ★ 保持原图不动，产物写到 <dir>/.publish-ready/ 下
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let _sharp = null
const getSharp = () => {
  if (_sharp !== null) return _sharp
  try {
    // sharp 若可用，优先用它（速度快、质量好）
    _sharp = require('sharp')
  } catch {
    _sharp = false
  }
  return _sharp
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 找可用的 Python（PIL 兜底） */
let _py = null
function findPython() {
  if (_py !== null) return _py
  const cands = [
    'python',
    'python3',
    process.env.PYTHON,
    'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe',
    'C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe',
  ].filter(Boolean)
  for (const p of cands) {
    try {
      execFileSync(p, ['-c', 'import PIL'], { stdio: 'ignore', timeout: 10000 })
      _py = p
      return p
    } catch { /* next */ }
  }
  _py = false
  return false
}

/**
 * 用 sharp 压缩
 */
async function compressWithSharp(sharp, src, dst, maxBytes, opts = {}) {
  const log = opts.log || (() => {})
  const img = sharp(src)
  const meta = await img.metadata()

  // 候选参数：先降质，再缩尺寸
  const attempts = [
    { fmt: 'jpeg', quality: 92, maxSide: 0 },
    { fmt: 'jpeg', quality: 85, maxSide: 0 },
    { fmt: 'jpeg', quality: 78, maxSide: 0 },
    { fmt: 'jpeg', quality: 78, maxSide: 1440 },
    { fmt: 'jpeg', quality: 72, maxSide: 1440 },
    { fmt: 'jpeg', quality: 72, maxSide: 1200 },
    { fmt: 'jpeg', quality: 68, maxSide: 1000 },
  ]

  for (const a of attempts) {
    let pipe = sharp(src)
    if (a.maxSide && Math.max(meta.width || 0, meta.height || 0) > a.maxSide) {
      pipe = pipe.resize({ width: a.maxSide, height: a.maxSide, fit: 'inside', withoutEnlargement: true })
    }
    // 统一转 JPEG（PNG 转 JPEG 体积骤降；白底不会有透明损失）
    const out = await pipe.flatten({ background: '#FFFFFF' }).jpeg({ quality: a.quality, mozjpeg: true }).toBuffer()
    if (out.length <= maxBytes) {
      fs.writeFileSync(dst, out)
      return { ok: true, strategy: `jpeg q=${a.quality}${a.maxSide ? ` ${a.maxSide}px` : ''}`, bytes: out.length, from: fs.statSync(src).size }
    }
  }
  return { ok: false, bytes: 0 }
}

/**
 * 用 Python PIL 压缩（sharp 不可用时兜底）
 */
function compressWithPIL(py, src, dst, maxBytes, opts = {}) {
  const log = opts.log || (() => {})
  const script = `
import sys, json, io
from PIL import Image
src, dst, max_bytes = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(src)
if img.mode in ('RGBA', 'LA', 'P'):
    bg = Image.new('RGB', img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[-1] if img.mode in ('RGBA','LA') else None)
    img = bg
else:
    img = img.convert('RGB')

attempts = [(92,0),(85,0),(78,0),(78,1440),(72,1440),(72,1200),(68,1000)]
for q, side in attempts:
    im = img.copy()
    if side and max(im.size) > side:
        im.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format='JPEG', quality=q, optimize=True, progressive=True)
    data = buf.getvalue()
    if len(data) <= max_bytes:
        with open(dst, 'wb') as f:
            f.write(data)
        print(json.dumps({'ok': True, 'strategy': 'jpeg q=%d%s' % (q, (' %dpx' % side) if side else ''), 'bytes': len(data)}))
        sys.exit(0)
print(json.dumps({'ok': False}))
sys.exit(1)
`
  try {
    const out = execFileSync(py, ['-c', script, src, dst, String(maxBytes)], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    }).trim()
    const r = JSON.parse(out)
    r.from = fs.statSync(src).size
    return r
  } catch (e) {
    // 失败时可能已经把 JSON 打到 stdout
    try {
      const r = JSON.parse(String(e.stdout || '').trim())
      return r
    } catch {
      return { ok: false, err: String(e.message).slice(0, 120) }
    }
  }
}

/**
 * 预处理一批图片（达标直接复用，超标自动压缩）
 *
 * @param files     本地图片绝对路径数组
 * @param opts { maxBytes?, log?, outDir? }
 * @returns { files: 处理后的路径数组, detail: [{src, out, ok, strategy, from, bytes}], stats }
 */
export async function prepareImages(files, opts = {}) {
  const log = opts.log || (() => {})
  const maxBytes = opts.maxBytes || 3 * 1024 * 1024

  const list = (Array.isArray(files) ? files : []).map(f => String(f || '').trim()).filter(Boolean)
  if (!list.length) return { files: [], detail: [], stats: { total: 0, compressed: 0, failed: 0 } }

  const detail = []
  const out = []
  let compressed = 0
  let failed = 0

  const sharp = getSharp()
  const py = sharp ? null : findPython()

  if (!sharp && !py) {
    log('[img-prep] ⚠ 既没有 sharp 也没有 PIL，跳过压缩（超限图片会由平台拒绝）')
    return { files: list, detail: [], stats: { total: list.length, compressed: 0, failed: 0, noTool: true } }
  }

  for (let i = 0; i < list.length; i++) {
    const src = list[i]
    if (!fs.existsSync(src)) {
      detail.push({ src, ok: false, err: 'not-found' })
      out.push(src)
      failed++
      continue
    }

    const size = fs.statSync(src).size
    if (size <= maxBytes) {
      detail.push({ src, out: src, ok: true, strategy: 'passthrough', from: size, bytes: size })
      out.push(src)
      continue
    }

    // 需要压缩
    const dir = opts.outDir || path.join(path.dirname(src), '.publish-ready')
    fs.mkdirSync(dir, { recursive: true })
    const base = path.basename(src).replace(/\.[^.]+$/, '')
    const dst = path.join(dir, `${base}.jpg`)

    let r
    if (sharp) {
      r = await compressWithSharp(sharp, src, dst, maxBytes, { log })
    } else {
      r = compressWithPIL(py, src, dst, maxBytes, { log })
    }

    if (r.ok) {
      compressed++
      out.push(dst)
      detail.push({ src, out: dst, ok: true, strategy: r.strategy, from: r.from || size, bytes: r.bytes })
      log(`[img-prep] ${path.basename(src)} ${(size / 1024 / 1024).toFixed(2)}MB → ${(r.bytes / 1024 / 1024).toFixed(2)}MB（${r.strategy}）`)
    } else {
      failed++
      out.push(src)
      detail.push({ src, out: src, ok: false, err: r.err || 'compress-failed', from: size })
      log(`[img-prep] ⚠ ${path.basename(src)} 压缩失败，保留原图（${(size / 1024 / 1024).toFixed(2)}MB）`)
    }
  }

  const stats = { total: list.length, compressed, failed }
  if (compressed) log(`[img-prep] 共压缩 ${compressed} 张（上限 ${(maxBytes / 1024 / 1024).toFixed(1)}MB/张）`)
  return { files: out, detail, stats }
}

/**
 * 只检查不处理（预览用）
 */
export function checkImageSizes(files, maxBytes = 3 * 1024 * 1024) {
  const res = (Array.isArray(files) ? files : []).map(f => {
    if (!fs.existsSync(f)) return { file: f, ok: false, err: 'not-found' }
    const size = fs.statSync(f).size
    return { file: f, size, ok: size <= maxBytes, over: size > maxBytes }
  })
  return {
    items: res,
    total: res.length,
    overCount: res.filter(x => x.over).length,
    maxBytes,
  }
}
