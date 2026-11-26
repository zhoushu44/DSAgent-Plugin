#!/usr/bin/env node
/**
 * run-to-submit.mjs — 自己上架用：填完停在提交前，自己在页面上点「提交并上架」。
 *
 * ★ 这是一个薄壳：真正的实现只有一套 —— skills/pdd-publish/steps/index.mjs。
 *   以前这里自己 load step4/6/6b/11/12/13 一步步拼，等于第二套编排，会和技能入口漂移；
 *   2026-11-26 起改成转调技能入口（带 --confirm true --stop-before-submit），本文件不再包含任何填表逻辑。
 *
 * 用法：
 *   node run-to-submit.mjs <商品JSON> [shopKey]
 *     shopKey 缺省 = pdd_mms_800050996（空空商行），也可用环境变量 PDD_SHOP 覆盖
 *
 * 行为：
 *   · 真开浏览器，把 1→15 步全填完
 *   · 跑一遍提交前必填校验当作交付证据
 *   · **绝不提交**，浏览器也不关（你直接在窗口里点提交）
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.join(HERE, 'skills', 'pdd-publish', 'steps', 'index.mjs')

const args = process.argv.slice(2)
const productFile = args[0]
if (!productFile) {
  console.log('用法：node run-to-submit.mjs <商品JSON> [shopKey]')
  process.exit(1)
}
const resolved = path.resolve(productFile)
if (!existsSync(resolved)) {
  console.log(`找不到商品 JSON：${resolved}`)
  process.exit(1)
}
if (!existsSync(ENTRY)) {
  console.log(`找不到技能入口：${ENTRY}`)
  process.exit(1)
}

const SHOP = args[1] || process.env.PDD_SHOP || 'pdd_mms_800050996'

console.log('='.repeat(60))
console.log('  上架（填完停在提交前，不提交）')
console.log(`  商品：${path.basename(resolved)}`)
console.log(`  店铺：${SHOP}`)
console.log(`  实现：skills/pdd-publish/steps/index.mjs（唯一入口）`)
console.log('='.repeat(60))

// stdio: 'inherit' —— 沙箱不允许 capture 匿名管道，直接继承终端即可实时看日志
const child = spawn(
  process.execPath,
  [ENTRY, '--product-file', resolved, '--account', SHOP, '--confirm', 'true', '--stop-before-submit'],
  { stdio: 'inherit', cwd: HERE, env: { ...process.env, PDD_SHOP: SHOP } },
)

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`\n子进程被信号终止：${signal}`)
    process.exit(1)
  }
  if (code === 0) {
    console.log('\n★ 已填完，停在提交前。浏览器保持打开，请在页面上点「提交并上架」。')
  }
  process.exit(code ?? 1)
})
