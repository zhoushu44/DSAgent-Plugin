#!/usr/bin/env node
/** 批量：抓 context.json → 转 product.json */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const SCRAPE = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/ali1688-pick/scripts/scrape_offer.mjs'
const PY = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const CONV = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/dev/context_to_product.py'

const dirs = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'picked.json'))).sort()
console.log(`共 ${dirs.length} 个\n`)

let scraped = 0, converted = 0, failed = 0

for (let i = 0; i < dirs.length; i++) {
  const dir = path.join(ROOT, dirs[i])
  const name = dirs[i]
  const picked = JSON.parse(fs.readFileSync(path.join(dir, 'picked.json'), 'utf8'))
  const offerId = picked.picked?.offerId
  if (!offerId) { console.log(`[${i + 1}] ${name} → 无 offerId`); failed++; continue }

  // ① 抓 context.json（已有则跳过）
  if (!fs.existsSync(path.join(dir, 'context.json'))) {
    console.log(`[${i + 1}/${dirs.length}] ${name} → 抓详情 ${offerId}`)
    try {
      execSync(`node "${SCRAPE}" ${offerId} "${dir}"`, {
        encoding: 'utf8', timeout: 200000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      scraped++
    } catch (e) {
      console.log(`  ❌ 抓取失败: ${String(e.message).slice(0, 90)}`)
      failed++
      continue
    }
  } else {
    console.log(`[${i + 1}/${dirs.length}] ${name} → context 已存在`)
  }

  // ② 转 product.json
  try {
    const out = execSync(`"${PY}" "${CONV}" "${dir}"`, { encoding: 'utf8', timeout: 60000 })
    if (out.includes('✅')) { converted++ }
    console.log('  ' + out.trim().split('\n')[0])
  } catch (e) {
    console.log(`  ❌ 转换失败: ${String(e.message).slice(0, 80)}`)
    failed++
  }

  if (i < dirs.length - 1) await new Promise(r => setTimeout(r, 3000))
}

console.log(`\n=== 完成：抓取 ${scraped} + 已存在 | 转换 ${converted} | 失败 ${failed} ===`)
