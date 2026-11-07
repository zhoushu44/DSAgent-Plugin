#!/usr/bin/env node
/** 批量从 DOM 抓属性 + 合并进 product.json */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const SCRAPE = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/dev/scrape-attrs.mjs'

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .filter(d => fs.existsSync(path.join(ROOT, d, 'picked.json')))
  .sort()

console.log(`共 ${dirs.length} 个\n`)

let ok = 0, fail = 0
const failed = []

for (let i = 0; i < dirs.length; i++) {
  const name = dirs[i]
  const dir = path.join(ROOT, name)
  const attrsFile = path.join(dir, 'attrs.json')
  const productFile = path.join(dir, 'product.json')

  // ① 已有 attrs.json 就跳过抓取
  if (!fs.existsSync(attrsFile)) {
    const picked = JSON.parse(fs.readFileSync(path.join(dir, 'picked.json'), 'utf8'))
    const offerId = picked.picked?.offerId
    if (!offerId) { console.log(`[${i + 1}] ${name} → 无 offerId`); fail++; failed.push(name); continue }

    console.log(`[${i + 1}/${dirs.length}] ${name} → 抓属性 ${offerId}`)
    try {
      execSync(`node "${SCRAPE}" ${offerId} "${dir}"`, {
        encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
    } catch (e) {
      console.log(`  ❌ ${String(e.message).slice(0, 90)}`)
      fail++
      failed.push(name)
      continue
    }
  }

  // ② 合并进 product.json
  if (fs.existsSync(attrsFile) && fs.existsSync(productFile)) {
    try {
      const attrs = JSON.parse(fs.readFileSync(attrsFile, 'utf8'))
      const p = JSON.parse(fs.readFileSync(productFile, 'utf8'))
      if (attrs.length) {
        p.attributes = attrs
        fs.writeFileSync(productFile, JSON.stringify(p, null, 2), 'utf8')
        console.log(`  ✅ 合并 ${attrs.length} 个属性`)
        ok++
      } else {
        console.log('  ⚠ attrs.json 为空')
        fail++
        failed.push(name)
      }
    } catch (e) {
      console.log(`  ❌ 合并失败: ${String(e.message).slice(0, 80)}`)
      fail++
      failed.push(name)
    }
  }

  if (i < dirs.length - 1) await new Promise(r => setTimeout(r, 3000))
}

console.log(`\n=== 完成：成功 ${ok}/${dirs.length} ===`)
if (failed.length) console.log(`失败：${failed.join(', ')}`)
