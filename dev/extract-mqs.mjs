/**
 * 从觅千手 pageHooks.js 提取函数体 / 标识符上下文。
 * 用法：
 *   node dev/extract-mqs.mjs fn <name> [name2 ...]     # 按 function <name> 提取
 *   node dev/extract-mqs.mjs ctx <keyword> [before] [after]   # 按关键词提取上下文
 *   node dev/extract-mqs.mjs grep <regex>                       # 全文正则找命中行上下文
 */
import { readFileSync, existsSync } from 'node:fs'

const SRC = 'E:\\360MoveData\\Users\\Administrator\\Desktop\\觅千手\\source\\pageHooks.js'
if (!existsSync(SRC)) { console.error('源文件不存在：' + SRC); process.exit(1) }
const s = readFileSync(SRC, 'utf8')
const mode = process.argv[2]

function extractFn(fname) {
  const idx = s.indexOf('function ' + fname)
  if (idx < 0) return null
  let depth = 0, end = -1, started = false
  for (let i = idx; i < s.length; i++) {
    if (s[i] === '{') { depth++; started = true }
    if (s[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break } }
  }
  return s.slice(idx, end)
}

if (mode === 'fn') {
  for (const n of process.argv.slice(3)) {
    console.log(`\n${'='.repeat(70)}\n### function ${n}\n${'='.repeat(70)}`)
    const b = extractFn(n)
    console.log(b ? b.replace(/;/g, ';\n').replace(/\{/g, '{\n') : '(未找到)')
  }
} else if (mode === 'ctx') {
  const kw = process.argv[3]
  const before = Number(process.argv[4] || 300)
  const after = Number(process.argv[5] || 300)
  let idx = -1, n = 0
  while ((idx = s.indexOf(kw, idx + 1)) >= 0 && n < 30) {
    console.log(`\n--- 命中 @${idx} ---`)
    console.log(s.slice(Math.max(0, idx - before), idx + after))
    n++
  }
  if (!n) console.log('(无命中)')
} else if (mode === 'grep') {
  const re = new RegExp(process.argv[3], 'g')
  let m, n = 0
  while ((m = re.exec(s)) && n < 40) {
    console.log(`\n--- @${m.index} ---`)
    console.log(s.slice(Math.max(0, m.index - 200), m.index + 400))
    n++
  }
  if (!n) console.log('(无命中)')
} else {
  console.error('用法：fn|ctx|grep')
  process.exit(1)
}
