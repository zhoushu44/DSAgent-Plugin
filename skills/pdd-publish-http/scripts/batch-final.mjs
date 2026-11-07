/**
 * batch-final.mjs — 纯 HTTP 批量发布验证（5 单）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = 'E:\\360MoveData\\Users\\Administrator\\Desktop\\DSAgent-Plugin'
const WORK = 'E:\\360MoveData\\Users\\Administrator\\Desktop\\童装\\pdd_js_analysis'
const SHOP = 'pdd_mms_4420074eaa258a49b1fedbf198b7b5f9'
const SCRIPT = path.join(ROOT, 'skills', 'pdd-publish-http', 'scripts', 'publish-by-copy.mjs')
const SOURCES = ['988073400752', '1005477037535', '988966764679', '988087060954', '988086692789', '988073442224', '988490564425', '1023076228462', '1005456642979']

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const results = []

for (let n = 1; n <= 5; n++) {
  const pf = path.join(WORK, 'products', 'batch', `final-${n}.json`)
  if (!fs.existsSync(pf)) { log(`⚠ final-${n} 缺数据`); continue }
  const src = SOURCES[(n - 1) % SOURCES.length]

  log('')
  log('━'.repeat(46))
  log(`▶ 第 ${n}/5 单 | 源 ${src}`)
  log('━'.repeat(46))

  const t0 = Date.now()
  const r = spawnSync('node', [SCRIPT, '--shop', SHOP, '--product', pf, '--source', src, '--confirm'], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  const out = (r.stdout || '') + (r.stderr || '')
  const secs = Math.round((Date.now() - t0) / 1000)
  const m = out.match(/✅ 上架成功 goods_id=(\d+)/)
  const goodsId = m ? m[1] : ''
  const ok = !!goodsId
  let reason = ''
  if (!ok) {
    const mm = out.match(/(commit\/submit|action\/edit|copyGoodsCommit) → [^\n]*❌[^\n]*/) || out.match(/❌[^\n]{0,80}/)
    reason = mm ? mm[0] : ''
  }
  log(`${ok ? '✅' : '❌'} 第${n}单 | ${secs}s${goodsId ? ' | ' + goodsId : ''}${reason ? ' | ' + reason.slice(0, 100) : ''}`)
  results.push({ n, ok, goodsId, secs, reason: reason.slice(0, 150) })
  fs.writeFileSync(path.join(WORK, 'reports', 'batch-final-results.json'), JSON.stringify(results, null, 2))

  if (n < 5) { log('   间隔 30s…'); await new Promise(x => setTimeout(x, 30000)) }
}

log('')
log('══════ 汇总 ══════')
for (const r of results) log(`${r.ok ? '✅' : '❌'} 第${r.n}单 ${r.secs}s${r.goodsId ? ' ' + r.goodsId : ''}${r.reason ? ' | ' + r.reason : ''}`)
const okN = results.filter(r => r.ok).length
log(`成功 ${okN}/${results.length}`)
const times = results.filter(r => r.ok).map(r => r.secs)
if (times.length) log(`耗时 min=${Math.min(...times)}s max=${Math.max(...times)}s avg=${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}s`)
