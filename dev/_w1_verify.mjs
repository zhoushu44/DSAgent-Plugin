import os from 'node:os'
/**
 * 验收门禁：skills/*-publish-mqs/SKILL.md 系列（淘宝 / 天猫 / 抖音 / 京东 / 1688）
 *
 * 这 5 个技能由多个 worker 并行产出，本脚本把它们共有的硬性要求做成一次可跑的验收门禁，
 * 避免「5 份 SKILL.md 各写一套、质量参差」。纯 Node 零依赖（不 import lib/，无需先 build）。
 *
 * error 级：
 *   missing_frontmatter     没有 frontmatter（文件须以 --- 开头并有闭合 ---）
 *   missing_name            frontmatter 缺 name
 *   name_mismatch           name 与目录名不一致
 *   desc_missing            缺 description
 *   desc_too_short          description < 72 字符（模型触发不到）
 *   desc_too_long           description > 420 字符
 *   body_too_short          正文 < 200 字符（空壳技能）
 *   missing_usage_slot      缺「何时使用 / 适用场景」二级章节
 *   missing_workflow_slot   缺「工作流 / 流程 / 步骤」二级章节
 *   missing_error_slot      缺「错误处理 / 异常」二级章节
 *   missing_l2_gate         缺 L2 两步门禁（正文须同时出现 confirm 与「预览/确认」）
 *   dangling_path           反引号里引用的仓库相对路径不存在
 *
 * warn 级：
 *   desc_no_platform_word   description 未出现本平台触发词
 *   desc_no_exclusion       description 未声明边界（「排除」/「不做」）
 *   no_shared_spec          正文未引用 PUBLISH-MATRIX.md / PUBLISH-SPEC.md
 *   missing_precondition    缺「前置条件 / 前提」章节
 *   missing_expected_skill  期望的技能目录缺失（--strict 时升为 error）
 *
 * 用法：
 *   node dev/verify-mqs-skills.mjs               # 扫 skills/，有 error 则退出码 1
 *   node dev/verify-mqs-skills.mjs --strict      # 5 个技能缺任何一个即失败
 *   node dev/verify-mqs-skills.mjs --dir <path>  # 校验任意目录（写草稿时自检）
 *   node dev/verify-mqs-skills.mjs --json        # 机器可读输出
 *   node dev/verify-mqs-skills.mjs --selftest    # 只跑内置正反样例自测
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const BOM = String.fromCharCode(0xfeff)

export const LIMITS = { DESC_MIN: 72, DESC_MAX: 420, BODY_MIN: 200 }

/** 期望存在的 5 个技能（--strict 时缺一即失败）。 */
export const EXPECTED = [
  { id: '1688-publish-mqs', words: ['1688', '阿里巴巴'] },
  { id: 'douyin-publish-mqs', words: ['抖音', 'douyin'] },
  { id: 'jd-publish-mqs', words: ['京东', 'jd'] },
  { id: 'taobao-publish-mqs', words: ['淘宝', 'taobao'] },
  { id: 'tmall-publish-mqs', words: ['天猫', 'tmall'] },
]

const SPEC_FILES = ['PUBLISH-MATRIX.md', 'PUBLISH-SPEC.md']
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const BT = String.fromCharCode(96)

function splitLines(text) {
  return text.split(LF).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l))
}

/** 拆分 frontmatter 与正文。 */
export function splitSkillMarkdown(raw) {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw
  const lines = splitLines(text)
  if (!lines.length || lines[0].trim() !== '---') {
    return { hasFrontmatter: false, frontmatter: '', body: text }
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return {
        hasFrontmatter: true,
        frontmatter: lines.slice(1, i).join(LF),
        body: lines.slice(i + 1).join(LF),
      }
    }
  }
  return { hasFrontmatter: false, frontmatter: '', body: text }
}

function stripQuotes(v) {
  if (v.length < 2) return v
  const a = v[0]
  const b = v[v.length - 1]
  if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1)
  return v
}

/** 读 frontmatter 单值字段：支持引号剥离与块标量（| / >）。 */
export function readField(frontmatter, key) {
  const lines = splitLines(frontmatter)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith(key)) continue
    const rest = line.slice(key.length)
    const trimmed = rest.trimStart()
    if (!trimmed.startsWith(':')) continue
    const value = trimmed.slice(1).trim()
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const buf = []
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (l.trim() === '') continue
        if (!l.startsWith(' ') && !l.startsWith(LF)) break
        buf.push(l.trim())
      }
      return buf.join(' ')
    }
    return stripQuotes(value)
  }
  return undefined
}

const charLen = (s) => Array.from(s || '').length

/** 收集全部二级（## ）标题文本。 */
export function h2Headings(body) {
  const out = []
  for (const line of splitLines(body)) {
    if (line.startsWith('## ')) out.push(line.slice(3).trim())
  }
  return out
}

const SLOTS = {
  usage: /(何时使用|适用场景|使用场景|什么时候用|触发场景)/,
  workflow: /(工作流|流程|步骤|执行流程)/i,
  error: /(错误处理|异常处理|失败处理|排错|常见错误)/i,
  precondition: /(前置条件|前提条件|前置准备|准备)/,
}

const hasSlot = (headings, re) => headings.some((h) => re.test(h))

/** 从正文反引号片段里提取「仓库相对路径」引用。 */
export function extractPathRefs(body) {
  const refs = []
  const lines = splitLines(body)
  for (const line of lines) {
    const parts = line.split(BT)
    for (let i = 1; i < parts.length; i += 2) {
      let p = parts[i].trim()
      p = p.replace(/[),.;:]+$/, '')
      if (!p) continue
      if (/[<>{}*…\s]/.test(p)) continue
      if (!p.includes('/')) continue
      if (!/^(skills|src|docs|publish-config|dev|scripts)\//.test(p)) continue
      refs.push(p)
    }
  }
  return Array.from(new Set(refs))
}

/* ───────────────────── 校验主体 ───────────────────── */

/**
 * 校验一份 SKILL.md 文本。
 * @param {string} id 目录名（= 期望的 frontmatter name）
 * @param {string} raw SKILL.md 全文
 * @param {string} repoRoot 仓库根（用于路径存在性检查）
 */
export function validateDoc(id, raw, repoRoot) {
  const root = repoRoot || REPO_ROOT
  const errors = []
  const warns = []
  const err = (code, msg) => errors.push({ code: code, msg: msg })
  const warn = (code, msg) => warns.push({ code: code, msg: msg })

  const split = splitSkillMarkdown(raw)
  const frontmatter = split.frontmatter
  const body = split.body
  if (!split.hasFrontmatter) {
    err('missing_frontmatter', '缺少 frontmatter（文件须以 --- 开头并有闭合 ---）')
  }

  const name = readField(frontmatter, 'name')
  if (!name) err('missing_name', 'frontmatter 缺 name')
  else if (name !== id) err('name_mismatch', 'name="' + name + '" 与目录名 "' + id + '" 不一致')

  const desc = readField(frontmatter, 'description') || ''
  const dlen = charLen(desc)
  if (!desc) err('desc_missing', '缺 description')
  else if (dlen < LIMITS.DESC_MIN) err('desc_too_short', 'description ' + dlen + ' 字符 < ' + LIMITS.DESC_MIN)
  else if (dlen > LIMITS.DESC_MAX) err('desc_too_long', 'description ' + dlen + ' 字符 > ' + LIMITS.DESC_MAX)

  const trimmedBody = body.trim()
  const blen = charLen(trimmedBody)
  if (blen < LIMITS.BODY_MIN) err('body_too_short', '正文 ' + blen + ' 字符 < ' + LIMITS.BODY_MIN)

  const headings = h2Headings(body)
  if (!hasSlot(headings, SLOTS.usage)) err('missing_usage_slot', '缺「何时使用 / 适用场景」二级章节')
  if (!hasSlot(headings, SLOTS.workflow)) err('missing_workflow_slot', '缺「工作流 / 流程 / 步骤」二级章节')
  if (!hasSlot(headings, SLOTS.error)) err('missing_error_slot', '缺「错误处理 / 异常」二级章节')
  if (!hasSlot(headings, SLOTS.precondition)) warn('missing_precondition', '建议补「前置条件 / 前提」章节')

  const gateOk = /confirm/i.test(body) && /(预览|确认)/.test(body)
  if (!gateOk) err('missing_l2_gate', '缺 L2 两步门禁：正文须同时出现 confirm 与「预览/确认」')

  const expected = EXPECTED.find((e) => e.id === id)
  if (expected && desc) {
    const lower = desc.toLowerCase()
    const hit = expected.words.some((w) => lower.includes(w.toLowerCase()))
    if (!hit) warn('desc_no_platform_word', 'description 未出现本平台触发词（' + expected.words.join(' / ') + '）')
  }
  if (desc && !/(排除|不做|不适用)/.test(desc)) {
    warn('desc_no_exclusion', 'description 建议声明边界（如「排除：拼多多用 pdd-publish-2」）')
  }
  if (body && !SPEC_FILES.some((f) => body.includes(f))) {
    warn('no_shared_spec', '正文建议引用共享规范 ' + SPEC_FILES.join(' / '))
  }

  for (const ref of extractPathRefs(body)) {
    if (!fs.existsSync(path.join(root, ref))) err('dangling_path', '引用的路径不存在：' + ref)
  }

  return {
    id: id,
    ok: errors.length === 0,
    errors: errors,
    warns: warns,
    stats: { descLen: dlen, bodyLen: blen, headings: headings.length },
  }
}

/* ───────────────────── 目录扫描 ───────────────────── */

/** 收集 root 下所有 *-publish-mqs/SKILL.md。 */
export function collectTargets(root) {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /-publish-mqs$/.test(d.name))
    .map((d) => ({ id: d.name, file: path.join(root, d.name, 'SKILL.md') }))
    .filter((t) => fs.existsSync(t.file))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function run(root, opts) {
  const o = opts || {}
  const strict = !!o.strict
  const asJson = !!o.json
  const repoRoot = o.repoRoot || REPO_ROOT

  const targets = collectTargets(root)
  const results = targets.map((t) => validateDoc(t.id, fs.readFileSync(t.file, 'utf8'), repoRoot))

  const present = new Set(results.map((r) => r.id))
  const missing = EXPECTED.filter((e) => !present.has(e.id)).map((e) => e.id)
  const missingReports = missing.map((id) => ({
    id: id,
    ok: !strict,
    errors: strict ? [{ code: 'missing_expected_skill', msg: '期望存在的技能目录缺失：skills/' + id + '/SKILL.md' }] : [],
    warns: strict ? [] : [{ code: 'missing_expected_skill', msg: '期望存在的技能目录缺失：skills/' + id + '/SKILL.md' }],
    stats: null,
  }))

  const all = results.concat(missingReports).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const errCount = all.reduce((n, r) => n + r.errors.length, 0)
  const warnCount = all.reduce((n, r) => n + r.warns.length, 0)

  if (asJson) {
    console.log(
      JSON.stringify(
        { root: root, strict: strict, present: results.length, missing: missing, errCount: errCount, warnCount: warnCount, results: all },
        null,
        2,
      ),
    )
    return errCount
  }

  console.log('=== mqs 技能验收门禁 ===')
  console.log('扫描目录：' + root)
  console.log('命中技能：' + results.length + ' / 期望 ' + EXPECTED.length + (missing.length ? '（缺：' + missing.join(', ') + '）' : ''))
  for (const r of all) {
    const flag = r.errors.length ? 'FAIL' : r.warns.length ? 'WARN' : 'PASS'
    const st = r.stats ? ' [desc ' + r.stats.descLen + ' / body ' + r.stats.bodyLen + ' / h2 ' + r.stats.headings + ']' : ''
    console.log('')
    console.log('[' + flag + '] ' + r.id + st)
    for (const e of r.errors) console.log('    ERROR ' + e.code + ': ' + e.msg)
    for (const w of r.warns) console.log('    warn  ' + w.code + ': ' + w.msg)
  }
  console.log('')
  console.log('合计：' + errCount + ' error / ' + warnCount + ' warn')
  console.log(errCount === 0 ? '✅ 门禁通过' : '❌ 门禁未通过（见上方 ERROR）')
  return errCount
}

/* ───────────────────── 自测（正反样例） ───────────────────── */

const GOOD_DESC =
  '淘宝商品上架：用统一商品 JSON 一键发布到淘宝卖家后台，支持类目搜索、类目属性回放、二维 SKU 矩阵与运费模板选择。' +
  '触发：淘宝上架、淘宝发布、淘宝批量上架。排除：天猫发布用 tmall-publish-mqs、拼多多用 pdd-publish-2、闲鱼用 xianyu-publish。'

function goodDoc() {
  const lines = [
    '---',
    'name: taobao-publish-mqs',
    'description: ' + GOOD_DESC,
    '---',
    '',
    '# 淘宝 · 商品上架',
    '',
    '## 前置条件',
    '- 需先绑定淘宝卖家账号；未绑定时引导用户到「账号连接」页添加。',
    '',
    '## 何时使用',
    '- 用户说「淘宝上架」「淘宝发布」「批量上架」时使用本技能。',
    '',
    '## 工作流',
    '1. 从用户话里组装统一商品 JSON（标题 / 主图 / 规格维度 / SKU 行）。',
    '2. 不带 confirm 调用工具，只取发布预览。',
    '3. 把预览原样给用户看，并明确询问是否发布。',
    '4. 用户明确同意后，带 confirm=true 重新调用工具，才真正提交。',
    '',
    '## 错误处理',
    '- 未绑定账号 → 引导绑定；命中风控 → 走 dsagent_risk_verify 过验证后重试。',
    '',
    '字段与选择器规范见 `PUBLISH-MATRIX.md` 与 `PUBLISH-SPEC.md`，',
    '同族技能参照 `skills/pdd-publish-2/SKILL.md` 的写法。',
  ]
  return lines.join(LF)
}

function selftest() {
  let pass = 0
  let fail = 0
  const check = (name, fn) => {
    try {
      fn()
      console.log('  ✓ ' + name)
      pass++
    } catch (e) {
      console.log('  ✗ ' + name)
      console.log('      ' + e.message)
      fail++
    }
  }
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }
  const codes = (r) => r.errors.map((e) => e.code)
  const wcodes = (r) => r.warns.map((e) => e.code)

  console.log('=== verify-mqs-skills 自测 ===')

  check('合格样例零 error 零 warn', () => {
    const r = validateDoc('taobao-publish-mqs', goodDoc())
    assert(r.errors.length === 0, 'unexpected errors: ' + JSON.stringify(codes(r)))
    assert(r.warns.length === 0, 'unexpected warns: ' + JSON.stringify(wcodes(r)))
    assert(r.ok === true, 'ok should be true')
  })

  check('缺 frontmatter → missing_frontmatter', () => {
    const r = validateDoc('taobao-publish-mqs', '# 无 frontmatter' + LF + '正文')
    assert(codes(r).includes('missing_frontmatter'), JSON.stringify(codes(r)))
  })

  check('name 与目录名不一致 → name_mismatch', () => {
    const r = validateDoc('jd-publish-mqs', goodDoc())
    assert(codes(r).includes('name_mismatch'), JSON.stringify(codes(r)))
  })

  check('description 过短 → desc_too_short', () => {
    const raw = goodDoc().replace(GOOD_DESC, '太短了')
    const r = validateDoc('taobao-publish-mqs', raw)
    assert(codes(r).includes('desc_too_short'), JSON.stringify(codes(r)))
  })

  check('description 过长 → desc_too_long', () => {
    const raw = goodDoc().replace(GOOD_DESC, '淘宝上架'.repeat(120))
    const r = validateDoc('taobao-publish-mqs', raw)
    assert(codes(r).includes('desc_too_long'), JSON.stringify(codes(r)))
  })

  check('正文过短 → body_too_short', () => {
    const raw = '---' + LF + 'name: taobao-publish-mqs' + LF + 'description: ' + GOOD_DESC + LF + '---' + LF + '短'
    const r = validateDoc('taobao-publish-mqs', raw)
    assert(codes(r).includes('body_too_short'), JSON.stringify(codes(r)))
  })

  check('缺三槽位章节 → usage/workflow/error 各报一条', () => {
    const raw = '---' + LF + 'name: taobao-publish-mqs' + LF + 'description: ' + GOOD_DESC + LF + '---' + LF + '# 标题' + LF + 'x'.repeat(260) + LF + 'confirm 预览'
    const c = codes(validateDoc('taobao-publish-mqs', raw))
    assert(c.includes('missing_usage_slot'), JSON.stringify(c))
    assert(c.includes('missing_workflow_slot'), JSON.stringify(c))
    assert(c.includes('missing_error_slot'), JSON.stringify(c))
  })

  check('缺 confirm / 预览 → missing_l2_gate', () => {
    const raw = goodDoc()
      .split(LF)
      .filter((l) => !/confirm/i.test(l) && !/预览|确认/.test(l))
      .join(LF)
    const c = codes(validateDoc('taobao-publish-mqs', raw))
    assert(c.includes('missing_l2_gate'), JSON.stringify(c))
  })

  check('引用了不存在的仓库路径 → dangling_path', () => {
    const raw = goodDoc() + LF + '另见 `skills/not-exist-mqs/SKILL.md`。' + LF
    const c = codes(validateDoc('taobao-publish-mqs', raw))
    assert(c.includes('dangling_path'), JSON.stringify(c))
  })

  check('不检查非仓库相对路径的反引号片段', () => {
    const raw = goodDoc() + LF + '调用 `dsagent_pdd_publish2` 与 `foo/bar`。' + LF
    const c = codes(validateDoc('taobao-publish-mqs', raw))
    assert(!c.includes('dangling_path'), JSON.stringify(c))
  })

  check('description 缺平台词 / 缺边界 → 各一条 warn', () => {
    const alt = '商品上架技能：把统一商品 JSON 发布到卖家后台，支持类目属性回放与二维 SKU 矩阵，适用于批量上架场景与日常补款。'
    const raw = goodDoc().replace(GOOD_DESC, alt)
    const w = wcodes(validateDoc('taobao-publish-mqs', raw))
    assert(w.includes('desc_no_platform_word'), JSON.stringify(w))
    assert(w.includes('desc_no_exclusion'), JSON.stringify(w))
  })

  check('未引用共享规范 / 缺前置条件 → warn', () => {
    const raw = goodDoc().replace('PUBLISH-MATRIX.md', 'x.md').replace('PUBLISH-SPEC.md', 'y.md').replace('## 前置条件', '## 其他')
    const w = wcodes(validateDoc('taobao-publish-mqs', raw))
    assert(w.includes('no_shared_spec'), JSON.stringify(w))
    assert(w.includes('missing_precondition'), JSON.stringify(w))
  })

  check('块标量 description 能被正确取值', () => {
    const raw = '---' + LF + 'name: x' + LF + 'description: |' + LF + '  第一行' + LF + '  第二行' + LF + '---' + LF + 'body'
    const f = readField(splitSkillMarkdown(raw).frontmatter, 'description')
    assert(f === '第一行 第二行', 'got ' + JSON.stringify(f))
  })

  check('带 BOM 的文件仍识别 frontmatter', () => {
    assert(splitSkillMarkdown(BOM + '---' + LF + 'name: a' + LF + '---' + LF + 'x').hasFrontmatter === true, 'BOM not handled')
  })

  check('h2Headings 只收二级标题，忽略三级', () => {
    const hs = h2Headings('## 一' + LF + '### 二' + LF + '## 三' + LF + '#四')
    assert(hs.length === 2 && hs[0] === '一' && hs[1] === '三', JSON.stringify(hs))
  })

  check('collectTargets 只收 *-publish-mqs 目录', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-gate-'))
    fs.mkdirSync(path.join(tmp, 'jd-publish-mqs'))
    fs.writeFileSync(path.join(tmp, 'jd-publish-mqs', 'SKILL.md'), goodDoc(), 'utf8')
    fs.mkdirSync(path.join(tmp, 'pdd-publish-2'))
    fs.writeFileSync(path.join(tmp, 'pdd-publish-2', 'SKILL.md'), goodDoc(), 'utf8')
    const t = collectTargets(tmp)
    assert(t.length === 1 && t[0].id === 'jd-publish-mqs', JSON.stringify(t))
  })

  check('--strict 下缺技能 → missing_expected_skill 为 error', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-gate2-'))
    const n = run(tmp, { strict: true, json: true })
    assert(n === EXPECTED.length, 'expected ' + EXPECTED.length + ' errors, got ' + n)
  })

  check('非 strict 下缺技能只算 warn（不阻断）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-gate3-'))
    const n = run(tmp, { json: true })
    assert(n === 0, 'expected 0 errors, got ' + n)
  })

  console.log('')
  console.log('自测结果：' + pass + ' pass / ' + fail + ' fail')
  return fail === 0 ? 0 : 1
}

/* ───────────────────── CLI ───────────────────── */

function main(argv) {
  const args = argv.slice(2)
  const selftestMode = args.includes('--selftest')
  const strict = args.includes('--strict')
  const json = args.includes('--json')
  const dirIdx = args.indexOf('--dir')
  const root = dirIdx >= 0 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : path.join(REPO_ROOT, 'skills')

  if (selftestMode) {
    const n = selftest()
    return n
  }

  const n = run(root, { strict: strict, json: json })
  return n === 0 ? 0 : 1
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  process.exitCode = main(process.argv)
}
