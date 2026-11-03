#!/usr/bin/env node
/**
 * 下载 1688 图片 URL → 本地文件
 *
 * 用法：node dev/download-images.mjs <商品根目录>
 * 效果：把 product.json 里的 http URL 下载到本地 img/ 目录，并改回写本地路径
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const ROOT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const FORCE = process.argv.includes('--force')   // 删掉已有 img 目录重下

// 并发下载（限制 4 个）
async function download(url, dest) {
  const https = require('https')
  const http = require('http')
  const mod = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://detail.1688.com/' } }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return download(res.headers.location, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const out = fs.createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(dest)))
      out.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .filter(d => fs.existsSync(path.join(ROOT, d, 'product.json')))
  .sort()

console.log(`共 ${dirs.length} 个商品\n`)

let totalOk = 0, totalFail = 0

for (let i = 0; i < dirs.length; i++) {
  const name = dirs[i]
  const dir = path.join(ROOT, name)
  const productFile = path.join(dir, 'product.json')
  const p = JSON.parse(fs.readFileSync(productFile, 'utf8'))
  // ★ 2026-11-03：product.json 的图片可能已被改写成本地路径。
  //   原始 URL 保存在 context.json 的 data.gallery.fields.offerImgList（37 张）。
  //   --force 时无视本地路径，一律从 context.json 重新下载。
  let allUrls = [...(p.images || []), ...(p.detailImages || [])]
  let httpUrls = allUrls.filter(u => String(u).startsWith('http'))

  const ctxFile = path.join(dir, 'context.json')
  let ctxUrls = []
  if (fs.existsSync(ctxFile)) {
    try {
      const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'))
      const gal = ctx?.result?.data?.gallery?.fields || {}
      const imgs = gal.offerImgList || []
      for (const im of imgs) {
        // ★ 2026-11-03：offerImgList 是【字符串数组】（不是对象数组）
        const u = typeof im === 'string' ? im : (im?.originalImageURL || im?.imageURL || im?.url)
        if (u) ctxUrls.push(String(u).startsWith('//') ? 'https:' + u : u)
      }
    } catch {}
  }
  ctxUrls = [...new Set(ctxUrls.filter(u => u.startsWith('http')))]

  // 决定用哪个 URL 列表
  if (FORCE && ctxUrls.length) {
    httpUrls = ctxUrls
    console.log(`[${i + 1}/${dirs.length}] ${name} → 从 context.json 取 ${ctxUrls.length} 个原始 URL（--force）`)
  } else if (!httpUrls.length) {
    // 本地路径但文件缺失 / 或强制重下
    const missing = allUrls.filter(u => !String(u).startsWith('http') && !fs.existsSync(u))
    if (!missing.length && !FORCE) {
      console.log(`[${i + 1}/${dirs.length}] ${name} → 已是本地图片且文件存在，跳过`)
      continue
    }
    if (ctxUrls.length) {
      httpUrls = ctxUrls
      console.log(`[${i + 1}/${dirs.length}] ${name} → 本地文件缺失，从 context.json 重新下载 ${ctxUrls.length} 张`)
    } else {
      console.log(`[${i + 1}/${dirs.length}] ${name} → 无可用 URL，跳过`)
      continue
    }
  }

  if (!httpUrls.length) {
    console.log(`[${i + 1}/${dirs.length}] ${name} → 没有需要下载的图片`)
    continue
  }

  console.log(`[${i + 1}/${dirs.length}] ${name} → 下载 ${httpUrls.length} 张`)
  const imgDir = path.join(dir, 'img')
  if (FORCE && fs.existsSync(imgDir)) {
    fs.rmSync(imgDir, { recursive: true, force: true })
    console.log('  （--force：已清空旧 img 目录）')
  }
  fs.mkdirSync(imgDir, { recursive: true })

  // URL → 本地路径映射
  const map = new Map()
  let ok = 0, fail = 0

  // 并发 4 个
  const queue = [...new Set(httpUrls)]
  const workers = []
  for (let w = 0; w < 4; w++) {
    workers.push((async () => {
      while (queue.length) {
        const url = queue.shift()
        const ext = (url.match(/\.(jpg|jpeg|png|webp|gif)/i) || [, 'jpg'])[1].toLowerCase()
        // ★ 2026-11-03 修复：base64url slice(-16) 会让相似 URL 撞同一个后缀
        //   改用 crypto MD5 全量 hash + 序号保证唯一
        const idx = allUrls.indexOf(url)
        const hash = require('crypto').createHash('md5').update(url).digest('hex').slice(0, 12)
        const dest = path.join(imgDir, `img_${String(idx).padStart(3, '0')}_${hash}.${ext}`)
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
          map.set(url, dest)
          ok++
          continue
        }
        try {
          await download(url, dest)
          map.set(url, dest)
          ok++
        } catch (e) {
          fail++
        }
      }
    })())
  }
  await Promise.all(workers)

  // 回写本地路径（前 5 张主图，最多 15 张详情图）
  const ordered = httpUrls.map(u => map.get(u)).filter(Boolean)
  p.images = ordered.slice(0, 5)
  p.detailImages = ordered.slice(5, 20)
  // SKU 预览图（如果有 imageUrl 字段）
  for (const s of (p.skus || [])) {
    if (s.imageUrl && map.has(s.imageUrl)) s.imageUrl = map.get(s.imageUrl)
  }
  // 保留原始 URL 备份（便于重新下载）
  p.sourceImageUrls = httpUrls
  fs.writeFileSync(productFile, JSON.stringify(p, null, 2), 'utf8')

  console.log(`  ✅ ${ok} 张下载${fail ? `，${fail} 张失败` : ''} → 主图 ${p.images.length} + 详情图 ${p.detailImages.length}`)
  totalOk += ok
  totalFail += fail
}

console.log(`\n=== 完成：下载 ${totalOk} 张，失败 ${totalFail} 张 ===`)
