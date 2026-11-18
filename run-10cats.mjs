/**
 * run-10cats.mjs — 逐个跑 10 个 case，每个独立进程，保留日志
 * ★ 不杀 chrome（每个 case 自己启动/关闭自己的浏览器会话）
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const ACCOUNT = 'pdd_mms_5899994461f5ae40c64d9bcf7e30c2a0'
const DIR = path.join(P, 'artifacts/10cats')

const NAMES = [
  '1 纸杯(1维-容量)',
  '2 T恤(2维-颜色×尺码)',
  '3 连衣裙(2维)',
  '4 休闲裤(2维)',
  '5 牛仔裤(2维)',
  '6 卫衣(2维)',
  '7 跑步鞋(2维-颜色×鞋码)',
  '8 童装家居服(2维)',
  '9 童装家居服(1维)',
  '10 四件套(2维-添加规格)',
]

const args = process.argv.slice(2)
const START = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 2
const END = args.includes('--to') ? Number(args[args.indexOf('--to') + 1]) : 10

const results = []

for (let i = START; i <= END; i++) {
  const pf = path.join(DIR, `case${i}.json`)
  if (!fs.existsSync(pf)) { console.log(`[${i}] 文件不存在，跳过`); continue }

  console.log(`\n${'═'.repeat(56)}`)
  console.log(`▶ [${i}/10] ${NAMES[i - 1]}`)
  console.log('═'.repeat(56))

  let out = '', failed = false
  try {
    out = execFileSync('node', [
      path.join(P, 'skills/pdd-publish-http/steps/index.mjs'),
      '--product-file', pf,
      '--account', ACCOUNT,
      '--confirm', 'true',
    ], { encoding: 'utf8', timeout: 600000, cwd: P, maxBuffer: 20 * 1024 * 1024 })
  } catch (e) {
    out = e.stdout || ''
    failed = true
  }

  fs.writeFileSync(path.join(DIR, `case${i}.log`), out, 'utf8')

  // 只打印关心的行
  for (const line of out.split('\n')) {
    if (/模板预置维度|\[s11\]|→ 走|行数校验|停用尺码|=== 1[012]|=== 16|✅ \d+ 行|❌|goodsId=/.test(line) && !line.includes('__DSAGENT')) {
      console.log('  ' + line.replace(/^\[pdd\]\s*/, '').replace(/^\[s11\]\s*/, '  ').slice(0, 130))
    }
  }

  const m = out.match(/__DSAGENT_RESULT__(.+)/)
  let res = { ok: false, text: '无结果' }
  if (m) { try { res = JSON.parse(m[1]) } catch { } }

  results.push({ i, name: NAMES[i - 1], ok: res.ok, goodsId: res.goodsId || 0, text: (res.text || '').slice(0, 120) })
  console.log(res.ok ? `\n  ✅ 成功 goodsId=${res.goodsId}` : `\n  ❌ ${(res.text || '').slice(0, 150)}`)

  if (i < END) {
    console.log('\n  …等 10 秒')
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 10'])
  }
}

console.log(`\n${'═'.repeat(56)}`)
console.log('  汇总')
console.log('═'.repeat(56))
let pass = 0
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} [${r.i}] ${r.name.padEnd(30)} ${r.ok ? 'goodsId=' + r.goodsId : r.text}`)
  if (r.ok) pass++
}
console.log(`\n  通过 ${pass}/${results.length}`)
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 2), 'utf8')
