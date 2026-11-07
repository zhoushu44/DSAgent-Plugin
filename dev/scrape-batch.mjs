#!/usr/bin/env node
/**
 * 批量抓 1688 详情页素材包
 * 读 picked.json → scrape_offer.mjs <offerId> <outDir>
 *
 * 用法：node dev/scrape-batch.mjs <picked根目录>
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const SCRAPE = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/ali1688-pick/scripts/scrape_offer.mjs'

const dirs = fs.readdirSync(ROOT).filter(d => {
  const p = path.join(ROOT, d, 'picked.json')
  return fs.existsSync(p)
}).sort()

console.log(`找到 ${dirs.length} 个选品目录\n`)

let ok = 0, fail = 0
const failed = []

for (let i = 0; i < dirs.length; i++) {
  const dir = dirs[i]
  const pickedFile = path.join(ROOT, dir, 'picked.json')
  const productJson = path.join(ROOT, dir, 'product.json')

  // 已抓过就跳过
  if (fs.existsSync(productJson)) {
    console.log(`[${i + 1}/${dirs.length}] ${dir} → 已存在，跳过`)
    ok++
    continue
  }

  let offerId = ''
  try {
    const p = JSON.parse(fs.readFileSync(pickedFile, 'utf8'))
    offerId = p.picked?.offerId || ''
  } catch (e) {
    console.log(`[${i + 1}/${dirs.length}] ${dir} → picked.json 解析失败`)
    fail++
    failed.push(dir)
    continue
  }

  if (!offerId) {
    console.log(`[${i + 1}/${dirs.length}] ${dir} → 无 offerId`)
    fail++
    failed.push(dir)
    continue
  }

  console.log(`[${i + 1}/${dirs.length}] ${dir} → offerId=${offerId}`)
  try {
    execSync(`node "${SCRAPE}" ${offerId} "${path.join(ROOT, dir)}"`, {
      encoding: 'utf8',
      timeout: 180000,   // 3 分钟
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    if (fs.existsSync(productJson)) {
      const p = JSON.parse(fs.readFileSync(productJson, 'utf8'))
      console.log(`  ✅ ${(p.title || '').slice(0, 40)} | SKU ${(p.skus || []).length} | 图 ${(p.images || []).length}`)
      ok++
    } else {
      console.log('  ⚠ product.json 未生成')
      fail++
      failed.push(dir)
    }
  } catch (e) {
    console.log(`  ❌ ${String(e.message).slice(0, 120)}`)
    fail++
    failed.push(dir)
  }

  if (i < dirs.length - 1) await new Promise(r => setTimeout(r, 5000))
}

console.log(`\n=== 抓取完成：成功 ${ok}/${dirs.length} ===`)
if (failed.length) console.log(`失败：${failed.join(', ')}`)
