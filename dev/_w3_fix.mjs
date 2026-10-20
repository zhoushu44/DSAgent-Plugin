import fs from 'node:fs'
const p = 'dev/verify-mqs-tools.mjs'
let t = fs.readFileSync(p, 'utf8')

// 1) 平台词检查前先剥掉工具名 / 锚点集路径（dsagent_jd_* 里的 jd 不算平台词）
const oldWord = `  if (expected) {
    const lower = body.toLowerCase()`
const newWord = `  if (expected) {
    const prose = body.replace(/dsagent_[a-z0-9_]+/g, ' ').replace(/publish-config\\/[A-Za-z0-9_.-]+\\.json/g, ' ')
    const lower = prose.toLowerCase()`
if (!t.includes(oldWord)) throw new Error('word block not found')
t = t.replace(oldWord, newWord)

// 2) selftest 里的 run() 静音，别把 JSON 输出糊到自测日志里
const oldQuiet = `  const srcIndex = o.srcIndex || loadSourceIndex(srcRoot)`
const newQuiet = `  const quiet = !!o.quiet
  const srcIndex = o.srcIndex || loadSourceIndex(srcRoot)`
if (!t.includes(oldQuiet)) throw new Error('quiet anchor not found')
t = t.replace(oldQuiet, newQuiet)

const oldJson = `  if (asJson) {
    console.log(`
const newJson = `  if (asJson && !quiet) {
    console.log(`
if (!t.includes(oldJson)) throw new Error('json anchor not found')
t = t.replace(oldJson, newJson)

const oldConsole = `  console.log('=== mqs 技能 ↔ 宿主实现一致性门禁 ===')`
const newConsole = `  if (!quiet) console.log('=== mqs 技能 ↔ 宿主实现一致性门禁 ===')`
if (!t.includes(oldConsole)) throw new Error('console anchor not found')
t = t.replace(oldConsole, newConsole)

// 3) selftest 的两处 run() 调用改成 quiet
const oldA = `run(tmp, { strict: true, json: true, srcIndex: TAOBAO_INDEX })`
t = t.replace(oldA, `run(tmp, { strict: true, json: true, quiet: true, srcIndex: TAOBAO_INDEX })`)
const oldB = `run(tmp, { json: true, srcIndex: TAOBAO_INDEX })`
t = t.replace(oldB, `run(tmp, { json: true, quiet: true, srcIndex: TAOBAO_INDEX })`)

// 4) 未命中时的打印全部加 quiet 保护
for (const line of [
  "console.log('技能目录：' + root)",
  "console.log('源码目录：' + srcRoot + '（已注册 ' + srcIndex.tools.size + ' 个 dsagent_* 工具）')",
  "console.log('命中技能：' + results.length + ' / 期望 ' + EXPECTED.length + (missing.length ? '（缺：' + missing.join(', ') + '）' : ''))",
]) {
  if (t.includes('  ' + line)) t = t.replace('  ' + line, '  if (!quiet) ' + line)
}
const oldLoop = `    console.log('')
    console.log('[' + flag + '] ' + r.id + st)
    for (const e of r.errors) console.log('    ERROR ' + e.code + ': ' + e.msg)
    for (const w of r.warns) console.log('    warn  ' + w.code + ': ' + w.msg)`
const newLoop = `    if (!quiet) console.log('')
    if (!quiet) console.log('[' + flag + '] ' + r.id + st)
    for (const e of r.errors) if (!quiet) console.log('    ERROR ' + e.code + ': ' + e.msg)
    for (const w of r.warns) if (!quiet) console.log('    warn  ' + w.code + ': ' + w.msg)`
if (!t.includes(oldLoop)) throw new Error('loop anchor not found')
t = t.replace(oldLoop, newLoop)

const oldTail = `  console.log('')
  if (strict) {`
const newTail = `  if (!quiet) console.log('')
  if (!quiet && strict) {`
if (!t.includes(oldTail)) throw new Error('tail anchor not found')
t = t.replace(oldTail, newTail)
t = t.replace(`  } else {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn')
  }`, `  } else if (!quiet) {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn')
  }`)
t = t.replace(`  console.log(failed === 0 ? '✅ 门禁通过' :`, `  if (!quiet) console.log(failed === 0 ? '✅ 门禁通过' :`)

fs.writeFileSync(p, t, 'utf8')
console.log('patched bytes', t.length)
