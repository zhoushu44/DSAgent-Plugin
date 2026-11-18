/**
 * run-20sets.mjs — 童装睡衣 20 套批量上架（带分步耗时统计）
 *
 * 用法：
 *   node run-20sets.mjs              只打印计划
 *   node run-20sets.mjs --run        真跑
 *   node run-20sets.mjs --run --from 2 --to 5
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const DIR = path.join(P, 'artifacts/pajama-20sets')
const ACCOUNT = 'pdd_mms_9cd4b36be23e5c24c3988ea6b70fbff5'

const args = process.argv.slice(2)
const RUN = args.includes('--run')
const FROM = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : 1
const TO = args.includes('--to') ? Number(args[args.indexOf('--to') + 1]) : 20

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
if (!files.length) { console.log('❌ 没有商品文件'); process.exit(1) }

console.log('════════════════════════════════════════════')
console.log('  童装睡衣套装 20 套批量上架')
console.log('════════════════════════════════════════════')
console.log(`账号: ${ACCOUNT}`)
console.log(`范围: S${String(FROM).padStart(2, '0')} ~ S${String(TO).padStart(2, '0')}`)
console.log('')

if (!RUN) {
  files.forEach((f, i) => {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
    console.log(`  [${i + 1}] ${f}  主图${j.images.length} 详情${j.detailImages?.length || 0} SKU${j.skus.length} 属性${Object.keys(j.attributes || {}).length}`)
  })
  console.log('\n（只打印计划。加 --run 才真跑）')
  process.exit(0)
}

const results = []
const t0 = Date.now()

for (let i = FROM - 1; i < Math.min(TO, files.length); i++) {
  const f = files[i]
  const idx = i + 1
  const name = f.replace('.json', '')
  console.log(`\n${'═'.repeat(56)}`)
  console.log(`▶ [${idx}/${files.length}] ${name}`)
  console.log('═'.repeat(56))

  const ts = Date.now()
  let out = ''
  try {
    out = execFileSync('node', [
      path.join(P, 'skills/pdd-publish-http/steps/index.mjs'),
      '--product-file', path.join(DIR, f),
      '--account', ACCOUNT,
      '--confirm', 'true',
    ], { encoding: 'utf8', timeout: 600000, cwd: P, maxBuffer: 30 * 1024 * 1024 })
  } catch (e) {
    out = e.stdout || ''
  }
  const dur = Math.round((Date.now() - ts) / 1000)

  fs.writeFileSync(path.join(DIR, name + '.log'), out, 'utf8')

  // 关键行
  for (const line of out.split('\n')) {
    if (/=== 1$|=== 2 主图|=== 3 标题|=== 4 类目|=== 6 属性|=== 6b|=== 11|=== 12|=== 16|✅ \d+ 张|✅ \d+ 行|goodsId=|❌/.test(line) && !line.includes('__DSAGENT')) {
      console.log('   ' + line.replace(/^\[pdd\]\s*/, '').replace(/^\[s6\]\s*/, '  ').slice(0, 130))
    }
  }

  const m = out.match(/__DSAGENT_RESULT__(.+)/)
  let res = { ok: false, text: '无结果' }
  if (m) { try { res = JSON.parse(m[1]) } catch { } }

  results.push({ idx, name, ok: res.ok, goodsId: res.goodsId || 0, dur, text: (res.text || '').slice(0, 100) })
  console.log(res.ok ? `\n   ✅ ${dur}s  goodsId=${res.goodsId}` : `\n   ❌ ${dur}s  ${(res.text || '').slice(0, 120)}`)

  fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 2), 'utf8')

  if (i < Math.min(TO, files.length) - 1) {
    console.log('   …等 10 秒')
    await new Promise(r => setTimeout(r, 10000))
  }
}

const total = Math.round((Date.now() - t0) / 1000)
console.log(`\n${'═'.repeat(56)}`)
console.log('  汇总')
console.log('═'.repeat(56))
let pass = 0
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(22)} ${String(r.dur).padStart(3)}s  ${r.ok ? 'goodsId=' + r.goodsId : r.text}`)
  if (r.ok) pass++
}
console.log(`\n  通过 ${pass}/${results.length}   总耗时 ${Math.floor(total / 60)}分${total % 60}秒`)
