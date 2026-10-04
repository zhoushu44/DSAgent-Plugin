/**
 * ESM 纯度检查 —— 防止 CommonJS 的 `require()` 混进 ESM 产物。
 *
 * 背景（真实生产事故，2026-10-04）：
 *   src/taobao-publish.ts 与 src/pdd-publish.ts 里写了
 *     const p = require('node:path')
 *   而本项目是 `"type": "module"`（纯 ESM），`require` 在 ESM 作用域下**不存在**。
 *
 *   后果不是「淘宝发布不可用」这么局部 —— 这两个文件被 src/index.ts 静态 import，
 *   于是 `lib/index.js` 在模块求值阶段就抛
 *     ReferenceError: require is not defined in ES module scope
 *   **整个 host 半区加载失败**，插件的所有工具全部不可用。
 *
 *   更隐蔽的是：`tsc` 对这种写法**不报错**（它在类型层面把 require 当作可用的全局），
 *   所以 typecheck 通过、build 通过，直到运行时才炸。
 *   本项目因此需要一个独立的静态检查来补上这个盲区。
 *
 * 检查范围刻意保守：只看**代码**里是否出现裸 `require(`，跳过注释与字符串。
 * 合法的 `createRequire(import.meta.url)` 不会被误报（它前面有标识符限定）。
 *
 * 用法：node dev/check-esm-purity.mjs
 *   退出码 0 = 干净；1 = 发现违规（可直接接进 CI）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
/** 检查 src/**\/*.ts（源）与 lib/**\/*.js（产物）两层 —— 源码对了产物才可能对，
 *  但产物是真正被加载的东西，两者都验才能挡住「构建工具引入 require」这类问题。 */
const TARGETS = ['src', 'lib']
const EXT = new Set(['.ts', '.js', '.mjs'])

/**
 * 豁免清单 —— 这些文件里的 `require` 是合法的，不是缺陷。
 *
 *   lib/client.js：browser 半区由 **esbuild 打包**，产物内部含 CJS↔ESM 互操作垫片
 *   （如 `let react = require("react")`），那是 bundler 的正常输出，
 *   且该文件作为 DSH ModuleLoader 工厂被加载，不按 ESM 顶层作用域求值。
 *   host 半区（lib/index.js 及其依赖）才是 tsc 直出的 ESM，需要严格检查。
 */
const EXEMPT = new Set(['lib/client.js'])

/** 逐行剥离注释与字符串，避免把说明文字里的 require 当违规 */
function stripCommentsAndStrings(line) {
  let out = ''
  let i = 0
  const n = line.length
  while (i < n) {
    const c = line[i]
    const c2 = line[i + 1]
    // 行注释
    if (c === '/' && c2 === '/') break
    // 块注释（单行内）
    if (c === '/' && c2 === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }
    // 字符串 / 模板串
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < n) {
        if (line[i] === '\\') { i += 2; continue }
        if (line[i] === quote) { i++; break }
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

const problems = []
function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    const dot = e.name.lastIndexOf('.')
    if (dot < 0 || !EXT.has(e.name.slice(dot))) continue

    const rel = relative(root, p).replace(/\\/g, '/')
    if (EXEMPT.has(rel)) continue

    let text
    try { text = readFileSync(p, 'utf8') } catch { continue }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const code = stripCommentsAndStrings(lines[i])
      // 裸 require( —— 前面不能是标识符字符或点号（排除 createRequire / foo.require）
      if (/(?<![A-Za-z0-9_$.])require\s*\(/.test(code)) {
        problems.push({
          file: rel,
          line: i + 1,
          text: lines[i].trim(),
        })
      }
    }
  }
}

for (const t of TARGETS) {
  const abs = join(root, t)
  try { if (statSync(abs).isDirectory()) walk(abs) } catch { /* 目录不存在（如未构建）跳过 */ }
}

if (!problems.length) {
  console.log('[esm-purity] ✓ 未发现裸 require()（ESM 纯度检查通过）')
  process.exit(0)
}

console.error(`[esm-purity] ✗ 发现 ${problems.length} 处裸 require() —— 本项目是 ESM（package.json "type": "module"）`)
console.error('            require 在 ESM 作用域下不存在，会在运行时报 ReferenceError；')
console.error('            若该文件被入口静态 import，将导致整个 host 半区加载失败。\n')
for (const p of problems) {
  console.error(`  ${p.file}:${p.line}`)
  console.error(`      ${p.text}`)
}
console.error('\n修法：改用 ESM import（如 `import { join } from \'node:path\'`）。')
console.error('      确需加载 CJS 模块时用 `createRequire(import.meta.url)`（不会被本检查误报）。')
process.exit(1)
