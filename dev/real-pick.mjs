#!/usr/bin/env node
/**
 * 真实选品：用 ali1688-pick 按多个关键词各选 1 款
 * 生成素材包 → 转 PDD 商品 JSON → AI 生图 → 批量上架
 *
 * 用法：node dev/real-pick.mjs --count 20 --out <dir>
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}

const COUNT = parseInt(getArg('count', '20'), 10)
const OUT = getArg('out', 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20')
const PICK = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/ali1688-pick'

// 20 个不同类目的关键词（避免同款重复）
const KEYWORDS = [
  '儿童睡衣', '抱枕靠垫', '毛巾浴巾', '保温杯', '收纳箱',
  '手机壳', '数据线', '厨房湿巾', '洗衣袋', '拖鞋',
  '保温袋', '收纳盒', '纸巾盒', '洗碗巾', '隔热垫',
  '牙刷架', '垃圾桶', '衣架', '收纳凳', '脏衣篮',
]

fs.mkdirSync(OUT, { recursive: true })

let ok = 0, fail = 0
const failed = []

for (let i = 0; i < Math.min(COUNT, KEYWORDS.length); i++) {
  const kw = KEYWORDS[i]
  const dir = path.join(OUT, `item-${String(i + 1).padStart(3, '0')}-${kw}`)
  console.log(`\n[${i + 1}/${COUNT}] 选品：${kw}`)

  if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'product.json'))) {
    console.log('  已存在，跳过')
    ok++
    continue
  }

  try {
    // ali1688-pick：搜关键词 → 打分选第 1 款 → 抓详情 → 素材包
    // ★ Windows 用完整 Python 路径
    const PY = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
    const cmd = `"${PY}" "${PICK}/scripts/run.py" --keywords "${kw}" --index 1 --out "${dir}"`
    console.log(`  执行: ${cmd.slice(0, 120)}...`)
    execSync(cmd, {
      cwd: PICK,
      encoding: 'utf8',
      timeout: 300000,   // 5 分钟
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (fs.existsSync(path.join(dir, 'product.json'))) {
      console.log('  ✅ 素材包已生成')
      ok++
    } else {
      console.log('  ⚠ product.json 未生成')
      fail++
      failed.push(kw)
    }
  } catch (e) {
    console.log(`  ❌ ${String(e.message).slice(0, 120)}`)
    fail++
    failed.push(kw)
  }

  // 风控间隔
  if (i < COUNT - 1) {
    console.log('  等待 8s（风控）...')
    await new Promise(r => setTimeout(r, 8000))
  }
}

console.log(`\n=== 选品完成 ===`)
console.log(`成功: ${ok} / ${COUNT}`)
console.log(`失败: ${fail}`)
if (failed.length) console.log(`失败关键词: ${failed.join(', ')}`)
