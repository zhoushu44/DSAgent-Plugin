#!/usr/bin/env node
/**
 * 图片压缩工具（拼多多 3MB / 淘宝 5MB 上限）
 *
 * 用法：
 *   node scripts/compress-images.mjs --dir <目录>
 *   node scripts/compress-images.mjs --files a.jpg,b.png
 *   node scripts/compress-images.mjs --dir <目录> --max-mb 5 --out <输出目录>
 *   node scripts/compress-images.mjs --dir <目录> --check      # 只检查不处理
 *
 * 策略：PNG→JPEG(q92) → 降质(85/78/72/68) → 缩尺寸(1440/1200/1000)
 * 实测：3.5MB PNG → 0.37MB JPEG（-89%），q92 画质几乎无损
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { prepareImages, checkImageSizes } from './img-prep.mjs'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const has = n => process.argv.includes(`--${n}`)

const dir = arg('dir', '')
const filesArg = arg('files', '')
const maxMb = parseFloat(arg('max-mb', '3'))
const outDir = arg('out', '')
const checkOnly = has('check')

const maxBytes = Math.round(maxMb * 1024 * 1024)

// ── 收集文件 ──
let files = []
if (filesArg) {
  files = filesArg.split(',').map(f => f.trim()).filter(Boolean)
} else if (dir) {
  if (!fs.existsSync(dir)) {
    console.error(`目录不存在: ${dir}`)
    process.exit(1)
  }
  files = fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => path.join(dir, f))
} else {
  console.error(`用法：
  node compress-images.mjs --dir <目录> [--max-mb 3] [--out <输出目录>] [--check]
  node compress-images.mjs --files a.jpg,b.png [--max-mb 3]`)
  process.exit(1)
}

if (!files.length) {
  console.error('没有找到图片')
  process.exit(1)
}

console.log(`共 ${files.length} 张图片，上限 ${maxMb}MB/张`)
console.log('')

// ── 只检查 ──
if (checkOnly) {
  const r = checkImageSizes(files, maxBytes)
  console.log(`超限 ${r.overCount} / ${r.total} 张`)
  r.items.forEach(x => {
    const name = path.basename(x.file)
    if (x.err) console.log(`  ❌ ${name}: ${x.err}`)
    else {
      const mb = (x.size / 1024 / 1024).toFixed(2)
      console.log(`  ${x.over ? '⚠' : '✅'} ${name}: ${mb}MB`)
    }
  })
  process.exit(r.overCount > 0 ? 1 : 0)
}

// ── 实际压缩 ──
const t0 = Date.now()
const result = await prepareImages(files, {
  maxBytes,
  outDir: outDir || undefined,
  log: console.log,
})
const cost = Date.now() - t0

console.log('')
console.log('=== 结果 ===')
const after = checkImageSizes(result.files, maxBytes)
console.log(`  处理 ${result.stats.compressed} 张，失败 ${result.stats.failed} 张`)
console.log(`  处理后超限 ${after.overCount} 张`)
console.log(`  耗时 ${cost}ms`)

const totalFrom = result.detail.reduce((s, d) => s + (d.from || 0), 0)
const totalTo = result.detail.reduce((s, d) => s + (d.bytes || d.from || 0), 0)
if (totalFrom > 0) {
  console.log(`  总体积 ${(totalFrom / 1024 / 1024).toFixed(1)}MB → ${(totalTo / 1024 / 1024).toFixed(1)}MB（-${Math.round((1 - totalTo / totalFrom) * 100)}%）`)
}

if (result.stats.compressed > 0 && !outDir) {
  const sample = result.detail.find(d => d.strategy !== 'passthrough')
  if (sample) console.log(`\n产物目录: ${path.dirname(sample.out)}`)
}

process.exit(after.overCount > 0 ? 1 : 0)
