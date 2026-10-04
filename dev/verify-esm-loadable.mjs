/**
 * 回归测试：host 半区必须能被真实加载，且不得混入 CommonJS 的 require()。
 *
 * 背景（真实生产事故，2026-10-04）：
 *   src/taobao-publish.ts:94 与 src/pdd-publish.ts:148 写了
 *     const p = require('node:path')
 *   而本项目是纯 ESM（"type": "module"），require 在 ESM 作用域下不存在。
 *
 *   这两个文件被 src/index.ts 静态 import，于是：
 *     · tsc 编译通过（它不检查 require 在 ESM 下是否可用）
 *     · build 通过
 *     · **运行时** `lib/index.js` 在模块求值阶段抛
 *       ReferenceError: require is not defined in ES module scope
 *     · 整个 host 半区加载失败 → 插件的全部工具不可用
 *
 *   typecheck 与 build 双双漏过，说明这条链路存在检测盲区，
 *   因此需要「真实 import 一次产物」作为独立回归。
 *
 * 本套件做两件事：
 *   ① 静态：扫描 src/ 与 lib/ 里是否有裸 require()（跳过注释/字符串/合法 createRequire）
 *   ② 动态：**真实 import** host 入口与所有被修复过的模块，确认能完成求值
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert'

let pass = 0, fail = 0
const ok = (n, c, extra) => {
  if (c) { console.log(`  ✓ ${n}`); pass++ }
  else { console.log(`  ✗ ${n}${extra ? `\n      ${extra}` : ''}`); fail++ }
}

const root = process.cwd()

/* ══════════ 1. 静态扫描：裸 require() ══════════ */
console.log('\n[1] 静态扫描：不得有裸 require()（ESM 纯度）')

function stripCommentsAndStrings(line) {
  let out = ''
  let i = 0
  const n = line.length
  while (i < n) {
    const c = line[i], c2 = line[i + 1]
    if (c === '/' && c2 === '/') break
    if (c === '/' && c2 === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < n) {
        if (line[i] === '\\') { i += 2; continue }
        if (line[i] === q) { i++; break }
        i++
      }
      out += '""'
      continue
    }
    out += c
    i++
  }
  return out
}

/** lib/client.js 由 esbuild 打包，内含合法的 CJS 互操作垫片，豁免 */
const EXEMPT = new Set(['lib/client.js'])

function scan(dir, ext, hits) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { scan(p, ext, hits); continue }
    const dot = e.name.lastIndexOf('.')
    if (dot < 0 || !ext.has(e.name.slice(dot))) continue
    const rel = relative(root, p).replace(/\\/g, '/')
    if (EXEMPT.has(rel)) continue
    let text
    try { text = readFileSync(p, 'utf8') } catch { continue }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (/(?<![A-Za-z0-9_$.])require\s*\(/.test(stripCommentsAndStrings(lines[i]))) {
        hits.push(`${rel}:${i + 1}`)
      }
    }
  }
}

{
  const hits = []
  scan(join(root, 'src'), new Set(['.ts']), hits)
  scan(join(root, 'lib'), new Set(['.js', '.mjs']), hits)
  ok('src/ 与 lib/ 均无裸 require()', hits.length === 0,
    hits.length ? `违规位置：\n      ${hits.join('\n      ')}` : '')
}

ok('注释里的 require 不被误报（两个修复点都有说明文字）', (() => {
  const t = readFileSync(join(root, 'src/taobao-publish.ts'), 'utf8')
  return t.includes('不能用 `require()`') && !/(?<![A-Za-z0-9_$.])require\s*\(/.test(
    t.split(/\r?\n/).map(stripCommentsAndStrings).join('\n'),
  )
})())

ok('合法的 createRequire 不被误报', (() => {
  const line = "const esmRequire = createRequire(import.meta.url)"
  return !/(?<![A-Za-z0-9_$.])require\s*\(/.test(stripCommentsAndStrings(line))
})())

/* ══════════ 2. 动态：真实 import 产物 ══════════ */
console.log('\n[2] 动态：真实 import 产物必须完成求值')

/**
 * 用子进程真实 import 一个模块。
 *
 * ★ 两个实现约束（都踩过）：
 *   1. 脚本内容**写进临时 .mjs 文件**再由 node 执行，不用 `-e` 传字符串。
 *      因为本机外壳（pwsh）会把 `=>` 里的 `>` 当重定向符，把 `-e` 的实参截断，
 *      表现为 SyntaxError: Unexpected token ')' —— 那是外壳问题，不是被测代码的问题。
 *   2. 用 spawnSync 且 stdio 不用匿名管道（受限沙箱会拦），改重定向到临时文件。
 */
function canImport(relPath) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'esm-load-'))
  const runner = join(tmpDir, 'run.mjs')
  const resultFile = join(tmpDir, 'result.txt')
  const targetUrl = pathToFileURL(join(root, relPath)).href

  // 子进程自己把结论写进结果文件 —— 不依赖捕获 stdout/stderr（受限沙箱会拦匿名管道）
  writeFileSync(runner, [
    `import { writeFileSync } from 'node:fs'`,
    `const R = ${JSON.stringify(resultFile)}`,
    `try {`,
    `  await import(${JSON.stringify(targetUrl)})`,
    `  writeFileSync(R, 'OK', 'utf8')`,
    `} catch (e) {`,
    `  writeFileSync(R, 'ERR: ' + (e && e.message ? e.message : String(e)), 'utf8')`,
    `}`,
    '',
  ].join('\n'), 'utf8')

  const r = spawnSync(process.execPath, [runner], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 60_000,
  })
  let result = ''
  try { result = readFileSync(resultFile, 'utf8').trim() } catch { /* 未生成 */ }
  const loaded = r.status === 0 && result === 'OK'
  return {
    ok: loaded,
    err: result.startsWith('ERR:')
      ? result.slice(5)
      : `exit=${r.status} result=${result || '(空)'}`,
  }
}

const ENTRY = 'lib/index.js'
const FIXED = ['lib/taobao-publish.js', 'lib/pdd-publish.js']

if (!existsSync(join(root, ENTRY))) {
  ok(`${ENTRY} 存在（需先 build）`, false, '请先跑 npm run build:host')
} else {
  const r = canImport(ENTRY)
  ok('★ lib/index.js 可加载（本次事故的崩溃点）', r.ok, r.err)
}

for (const m of FIXED) {
  if (!existsSync(join(root, m))) { ok(`${m} 存在`, false); continue }
  const r = canImport(m)
  ok(`${m} 可加载`, r.ok, r.err)
}

/* ══════════ 3. 回归：注入违规必须被静态检查抓到 ══════════ */
console.log('\n[3] 注入验证（确保检查本身有效，不是空跑）')

{
  const target = join(root, 'src/pdd-publish.ts')
  const backup = readFileSync(target, 'utf8')
  try {
    const injected = backup.replace(/^const attrCache: AttrCache/m, "const _probe = require('node:path')\nconst attrCache: AttrCache")
    assert.notEqual(injected, backup, '注入失败：未匹配到目标行')
    // 用与 check-esm-purity 相同的扫描逻辑验证能抓到
    const hits = []
    for (let i = 0; i < injected.split(/\r?\n/).length; i++) {
      const line = injected.split(/\r?\n/)[i]
      if (/(?<![A-Za-z0-9_$.])require\s*\(/.test(stripCommentsAndStrings(line))) hits.push(i + 1)
    }
    ok('注入裸 require() 后能被扫描逻辑抓到', hits.length > 0)
  } finally {
    // 必须还原，否则会污染工作区
    writeFileSync(target, backup, 'utf8')
  }
}

{
  const after = readFileSync(join(root, 'src/pdd-publish.ts'), 'utf8')
  ok('注入验证后源文件已还原（无残留）', !after.includes('_probe'))
}

console.log(`\n${'═'.repeat(56)}`)
console.log(`  通过 ${pass}　失败 ${fail}`)
console.log(`${'═'.repeat(56)}\n`)
process.exit(fail ? 1 : 0)
