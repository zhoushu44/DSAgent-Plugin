#!/usr/bin/env node
/**
 * check-pdd-guard.mjs —— 拼多多技能风控闸门合规检查（CI 门禁）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要这个脚本
 * ══════════════════════════════════════════════════════════════════
 * 「后续新加的技能也要走闸门」这句话，光写进 rule 是没用的 ——
 * rule 是给模型看的软约束，换模型、换会话、上下文被压缩都可能忘。
 * 而风控漏接的代价是**真金白银**：账号被封、误发到别人店铺、不可逆的写操作。
 *
 * 所以必须有**可执行的检查**：新增技能时跑一次，缺了就 fail。
 *
 * ══════════════════════════════════════════════════════════════════
 * 检查项（任一不过 → exit 1）
 * ══════════════════════════════════════════════════════════════════
 *   [1] 有 scripts/*.mjs 的 pdd-* 技能，入口脚本必须 import pdd-guard
 *   [2] 必须调用 openTask（准入：冷却 / 健康分 / 账号锁）
 *   [3] 必须调用 beforeCall（节流：账号级时间槽）
 *   [4] 不得残留 tryAcquireAccountLock 的**实际调用**（会与闸门重复加锁 → 自锁）
 *   [5] 不得残留 reserveSlot / throttleRequest 的**实际调用**（应统一走闸门）
 *   [6] 不得在 page.evaluate 内部调用 Node 侧函数（跨上下文必失效）
 *
 * 用法：
 *   node skills/_shared/check-pdd-guard.mjs            # 检查全部 pdd-* 技能
 *   node skills/_shared/check-pdd-guard.mjs pdd-xxx    # 只查一个
 *
 * 退出码：0 = 全部通过；1 = 有违规；2 = 脚本自身错误
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = path.resolve(HERE, '..')

// 接口注册表（用于 [8] 检查）
let REGISTRY = new Set()
let PAGE_URLS = new Set()
try {
  const apiMod = await import(pathToFileURL(path.join(HERE, 'pdd-api.mjs')).href)
  REGISTRY = new Set(Object.values(apiMod.API).map(v => v.path))
  PAGE_URLS = new Set(Object.values(apiMod.PAGES).map(v => v.url))
} catch (e) {
  // ★ 不静默：注册表加载失败会让 [8] 全部误报，必须让人看见
  console.error(`[check-pdd-guard] 警告: pdd-api.mjs 加载失败，[8] 检查不可用 —— ${String(e && e.message || e).slice(0, 120)}`)
}

/** 已知豁免：有正当理由不走闸门的技能 */
const EXEMPT = {
  // ★ 2026-11-05：pdd-crawl 已接入 pdd-guard（TS 侧 src/pdd-crawl.ts），
  //   但它是 TypeScript 实现、不在 skills/*.mjs 扫描范围内，
  //   所以这里仍标记为「豁免扫描」——不代表它没接，而是本检查器只看 .mjs。
  //   它的闸门接入情况需用 tsc + 阅读源码确认（已确认：openTask + beforeCall + close 齐全）。
  'pdd-crawl': 'TS 实现（src/pdd-crawl.ts），已接入闸门但不在 .mjs 扫描范围',
}

/** 入口脚本候选（按优先级找第一个存在的） */
const ENTRY_NAMES = [
  'publish-v2.mjs', 'batch-publish.mjs',   // pdd-publish-http
  'promo.mjs', 'activity.mjs', 'chance.mjs',
  'video.mjs', 'shop.mjs', 'query.mjs', 'matrix.mjs',
  'crawl.mjs', 'index.mjs',
]

function findEntries(skillDir) {
  const scripts = path.join(skillDir, 'scripts')
  if (!fs.existsSync(scripts)) return []
  const all = fs.readdirSync(scripts).filter(f => f.endsWith('.mjs'))
  // 优先按候选名找；找不到则把所有 mjs 当作入口（保守）
  const named = all.filter(f => ENTRY_NAMES.includes(f))
  if (named.length) return named
  // 排除明显是子模块的（field-/sku-/spec-/attr-/stage-/vision-/img- 等）
  const SUB = /^(field-|sku-|spec-|attr-|stage-|vision-|img-|compress-|category-|publish-flow|analyze_|imgprep)/
  const mains = all.filter(f => !SUB.test(f))
  return mains.length ? mains : all
}

/**
 * 去掉注释，避免把注释里的字样当成真实调用
 *
 * ⚠️ 不能用简单正则：`file:///...` 里有两个 `//`，第二个前面是 `/`，
 * 会被 `(^|[^:])//` 判成行注释，把整行后面的内容（含 import 路径）全吞掉。
 * 这里做逐字符扫描，正确区分「字符串内」「模板串内」「行注释」「块注释」。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let mode = 'code'   // code | line | block | single | double | template
  while (i < n) {
    const c = src[i], c2 = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; i += 2; continue }
      if (c === '/' && c2 === '*') { mode = 'block'; i += 2; continue }
      if (c === '"') { mode = 'double'; out += c; i++; continue }
      if (c === "'") { mode = 'single'; out += c; i++; continue }
      if (c === '`') { mode = 'template'; out += c; i++; continue }
      out += c; i++; continue
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c }
      i++; continue
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; i += 2; continue }
      if (c === '\n') out += c   // 保留换行，行号不偏
      i++; continue
    }
    if (mode === 'double' || mode === 'single') {
      if (c === '\\') { out += c + (c2 || ''); i += 2; continue }
      if ((mode === 'double' && c === '"') || (mode === 'single' && c === "'")) mode = 'code'
      out += c; i++; continue
    }
    if (mode === 'template') {
      if (c === '\\') { out += c + (c2 || ''); i += 2; continue }
      if (c === '`') mode = 'code'
      out += c; i++; continue
    }
  }
  // ★ 兜底清理：逐字符扫描在「注释行里出现反引号」时会失衡
  //   （例：`// 原来那行 `throttleRequest(SHOP)` 无效` —— 反引号让扫描器进了 template 模式，
  //    后续所有 // 都不再被识别为注释）。
  //   这里再按行做一次纯注释行清理：整行以 // 开头的直接丢弃。
  //   对「检测调用」这个用途足够，且不会误伤代码（代码行不会以 // 开头）。
  return out.split('\n').map(l => /^\s*\/\//.test(l) ? '' : l).join('\n')
}

/** 判断某个标识符是否有「实际调用」（排除 import 解构与注释） */
function hasRealCall(code, ident) {
  // ★ 支持成员调用：guard.beforeCall(url) 里的 beforeCall 前面是 "."，
  //   原正则 `(^|[^.\w])ident\(` 会把它判为「没有调用」（false negative）。
  //   这里改成：匹配「ident(」但不要求前面不是点，改为排除「定义/解构/import」。
  const re = new RegExp(`(^|[^.\\w])${ident}\\s*\\(|\\b${ident}\\s*\\(`, 'm')
  const lines = code.split('\n')
  for (const line of lines) {
    if (/^\s*import\b/.test(line)) continue
    if (/^\s*const\s*\{[^}]*\}\s*=/.test(line)) continue  // 解构赋值
    // 排除函数定义： function beforeCall( / beforeCall(...) { 前面有 function
    if (new RegExp(`function\\s+${ident}\\b`).test(line)) continue
    // 排除对象方法定义：  beforeCall(url) {   （前面是 { 或 , 且行尾是 {）
    if (new RegExp(`(^|[,{])\\s*${ident}\\s*\\([^)]*\\)\\s*\\{`).test(line)) continue
    if (re.test(line)) return true
  }
  return false
}

/** 检查 page.evaluate 内部是否引用了 Node 侧标识符 */
const NODE_ONLY = ['throttleRequest', 'reserveSlot', 'checkCooldown', 'guard', 'SHOP', 'PLUGIN_ROOT', 'fs', 'path']
function findEvalLeaks(code) {
  const leaks = []
  const re = /page\.evaluate\s*\(\s*(async\s*)?\(([^)]*)\)\s*=>\s*\{/g
  let m
  while ((m = re.exec(code))) {
    const params = new Set((m[2] || '').split(',').map(s => s.trim()).filter(Boolean))
    // 从 { 开始做括号配平，取出函数体
    let i = code.indexOf('{', m.index)
    let depth = 0, start = i
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') { depth--; if (depth === 0) break }
    }
    const body = code.slice(start, i + 1)
    for (const id of NODE_ONLY) {
      if (params.has(id)) continue           // 是参数，安全
      const callRe = new RegExp(`(^|[^.\\w])${id}\\s*[.(]`, 'm')
      if (callRe.test(body)) leaks.push({ id, at: code.slice(0, m.index).split('\n').length })
    }
  }
  return leaks
}

// ── 主流程 ──────────────────────────────────────────────────────────
const only = process.argv[2]
const skills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && /^pdd-/.test(d.name))
  .map(d => d.name)
  .filter(n => !only || n === only)

if (!skills.length) {
  console.error(only ? `找不到技能：${only}` : '没有找到任何 pdd-* 技能')
  process.exit(2)
}

const results = []
for (const skill of skills) {
  const dir = path.join(SKILLS_DIR, skill)
  if (EXEMPT[skill]) {
    results.push({ skill, status: 'exempt', note: EXEMPT[skill], issues: [] })
    continue
  }
  const entries = findEntries(dir)
  if (!entries.length) {
    results.push({ skill, status: 'skip', note: '无 scripts/*.mjs', issues: [] })
    continue
  }

  const issues = []
  for (const f of entries) {
    const raw = fs.readFileSync(path.join(dir, 'scripts', f), 'utf8')
    const code = stripComments(raw)
    const where = `${skill}/scripts/${f}`

    if (!code.includes('pdd-guard')) issues.push(`[1] ${where}: 未引用 pdd-guard`)
    if (!hasRealCall(code, 'openTask')) issues.push(`[2] ${where}: 未调用 openTask（准入缺失）`)
    // [3] 节流：两条合法路径
    //   a) 直接 guard.beforeCall(...)
    //   b) 通过基座统一入口 pdd-request.mjs 转发（它内部调 opts.guard.beforeCall/afterCall）
    const usesRequestGateway = /pdd-request\.mjs/.test(code)
    if (!hasRealCall(code, 'beforeCall') && !usesRequestGateway) {
      issues.push(`[3] ${where}: 未调用 beforeCall（节流失效）`)
    }
    if (hasRealCall(code, 'tryAcquireAccountLock')) issues.push(`[4] ${where}: 残留 tryAcquireAccountLock 实际调用（会与闸门重复加锁）`)
    if (hasRealCall(code, 'reserveSlot')) issues.push(`[5] ${where}: 残留 reserveSlot 实际调用（应走闸门）`)
    if (hasRealCall(code, 'throttleRequest')) issues.push(`[5] ${where}: 残留 throttleRequest 实际调用（应走闸门）`)

    // [7] 有 page.evaluate(fetch) 的，必须带 VerifyAuthToken
    //     credentials:'include' 只带 Cookie，VerifyAuthToken 是**请求头**，不会自动带上。
    //     evaluate 的 fetch 绕过 msfe 插件链 → cookie 有票也白拿。
    //
    // ★ 2026-11-07 修：原实现只要文件里同时有 fetch( 和 page.evaluate( 就报警，
    //   但多数文件是「Node 侧 fetch + 另一个无关的 page.evaluate」，
    //   属于 false positive。改为**只在 page.evaluate 的实参块内找到 fetch** 才判定。
    const evalFetch = (() => {
      const re = /page\.evaluate\s*(?:<[^>]*>)?\s*\(/g
      let m
      while ((m = re.exec(code))) {
        // 从 evaluate( 开始，向后扫到配对的右括号
        let i = m.index + m[0].length - 1
        let depth = 0
        const start = i
        for (; i < code.length; i++) {
          const ch = code[i]
          if (ch === '(') depth++
          else if (ch === ')') { depth--; if (depth === 0) break }
        }
        const block = code.slice(start, i + 1)
        if (/fetch\s*\(/.test(block)) return true
      }
      return false
    })()
    if (evalFetch && !code.includes('VerifyAuthToken')) {
      issues.push(`[7] ${where}: page.evaluate 内有 fetch 但未带 VerifyAuthToken（cookie 有票不会自动进头）`)
    }

    // [8] 硬编码接口路径必须在 API 注册表里（便于 PDD 升级时统一改基座）
    //     允许 skill 里出现路径，但必须在 _shared/pdd-api.mjs 的 API 表中有对应项。
    //     新代码应直接用 pddApi(page, '逻辑名', body) 而不是硬编码。
    for (const m of code.matchAll(/['\"`](\/?(?:mms-gateway|vodka|glide|sydney|mangkhut|mercury|lakemms|leekmms|opportunity-goods|api|earth|janus|mms)\/[A-Za-z0-9_\-/.]+)['\"`]/g)) {
      const p2 = m[1].startsWith('/') ? m[1] : '/' + m[1]
      if (/\.(js|css|png|jpg|json)$/i.test(p2)) continue
      if (!REGISTRY.has(p2)) issues.push(`[8] ${where}: 接口路径 \`${p2}\` 不在 pdd-api.mjs 注册表里（升级时会漏改）`)
    }

    // [9] 禁止裸 fetch 硬编码完整 URL（必须通过基座取路径）
    //     允许保留字面路径作为 key/兜底，但 fetch 的第一个参数不能是硬编码 https://.../api路径
    const rawFetch = code.match(/fetch\(\s*['\"`]https:\/\/[^'\"`]*\/(?:mms-gateway|vodka|glide|sydney|lakemms|leekmms|opportunity-goods|api|mms)\//g)
    if (rawFetch && rawFetch.length > 0) {
      issues.push(`[9] ${where}: 有 ${rawFetch.length} 处裸 fetch 硬编码完整 URL（应改为基座 apiPath/P()/resolvePath）`)
    }

    // [10] 页面 URL 必须在 PAGES 注册表里（DOM 驱动型 skill 用）
    for (const m of code.matchAll(/['\"`](https:\/\/[a-z.]*pinduoduo\.com\/(?:goods|act|sycm|n-creator|mains)\/[^'\"`]*)['\"`]/g)) {
      const u = m[1]
      // ★ 只比对路径部分，允许查询参数 / 模板变量变化
      const basePath = u.split('?')[0].split('#')[0]
      const hit = [...PAGE_URLS].some(x => x.split('?')[0].split('#')[0] === basePath)
      if (!hit) issues.push(`[10] ${where}: 页面 URL \`${basePath}\` 不在 PAGES 注册表里（升级时会漏改）`)
    }

    // [11] 禁止静默取第一个账号（多账号时写错店代价不可逆）
    //     必须走 account-picker 的 need_account_choice
    // 注意：code 已 stripComments，注释里的示例不会被误判
    // 已有 need_account_choice 或 resolveShop 三级兜底的，视为合规
    const hasPicker = /account-picker|need_account_choice/.test(code)
    const hasResolveShop = /function resolveShop|const resolveShop/.test(code)
    if (/findByPlatform\([^)]*\)\s*\?\.\s*shop_key/.test(code) && !hasPicker && !hasResolveShop) {
      issues.push(`[11] ${where}: 用 findByPlatform()?.shop_key 静默取第一个账号（多账号会写错店，应改用 account-picker）`)
    }
    if (/accounts\s*\[\s*0\s*\]/.test(code) && !/need_account_choice/.test(code)) {
      issues.push(`[11] ${where}: 用 accounts[0] 取第一个账号且无 need_account_choice 兜底`)
    }

    for (const lk of findEvalLeaks(code)) {
      issues.push(`[6] ${where}:${lk.at}: page.evaluate 内引用了 Node 侧标识符 \`${lk.id}\`（跨上下文必失效）`)
    }
  }
  results.push({ skill, status: issues.length ? 'fail' : 'pass', issues })
}

// ── 输出 ────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log('\n拼多多技能 · 风控闸门合规检查\n' + '='.repeat(72))
let failed = 0
for (const r of results) {
  const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'exempt' ? '⏭ ' : '·'
  console.log(`${icon} ${pad(r.skill, 20)} ${r.status}${r.note ? '  — ' + r.note : ''}`)
  for (const i of r.issues) console.log(`     ${i}`)
  if (r.status === 'fail') failed++
}
console.log('='.repeat(72))
console.log(`通过 ${results.filter(r => r.status === 'pass').length} / 失败 ${failed} / 豁免 ${results.filter(r => r.status === 'exempt').length}\n`)

if (failed) {
  console.log('修复指引：')
  console.log('  · 机制与示例见知识库《拼多多技能统一风控闸门（pdd-guard）》')
  console.log('  · 最小接入形态：')
  console.log('      const { openTask } = await import(\'<...>/_shared/pdd-guard.mjs\')')
  console.log('      const guard = await openTask(\'pdd-xxx\', SHOP, { lockWaitMs: 300_000 })')
  console.log('      if (guard.blocked) { emit({ failureKind: \'rate_limit\', text: guard.reason }); process.exit(2) }')
  console.log('      guard.startHeartbeat()')
  console.log('      process.on(\'exit\', () => guard.close())')
  console.log('      // 请求出口： await guard.beforeCall(url)')
  console.log('')
  process.exit(1)
}
process.exit(0)
