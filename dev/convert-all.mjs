#!/usr/bin/env node
/** 批量转换 context.json → product.json */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.argv[2] || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20'
const PY = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const CONV = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/dev/context_to_product.py'

const dirs = fs.readdirSync(ROOT)
  .filter(d => fs.existsSync(path.join(ROOT, d, 'context.json')))
  .sort()
  .map(d => path.join(ROOT, d))

console.log(`找到 ${dirs.length} 个 context.json\n`)

// 一次全部传给 Python（避免命令行长度问题，用文件列表）
const listFile = path.join(ROOT, '_list.txt')
fs.writeFileSync(listFile, dirs.join('\n'), 'utf8')

const out = execSync(`"${PY}" "${CONV}" @${listFile}`, { encoding: 'utf8', timeout: 120000 })
console.log(out)

// 统计
let ok = 0
for (const d of dirs) {
  if (fs.existsSync(path.join(d, 'product.json'))) ok++
}
console.log(`\n=== product.json: ${ok}/${dirs.length} ===`)
fs.unlinkSync(listFile)
