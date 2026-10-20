/**
 * 验收门禁：mqs 技能 ↔ 宿主实现一致性（skills/*-publish-mqs/SKILL.md vs src/）
 *
 * 与 dev/verify-mqs-skills.mjs 互补：那个门禁只看文档质量（frontmatter / 章节槽位 / L2 门禁 /
 * 悬空路径），本门禁看「文档有没有吹牛」——技能里声明的工具、发布域、锚点配置，宿主里到底有没有。
 * 专门用来暴露「只写了文档、没落实现」的真实缺口（如 jd / 1688 / 抖店 mqs 工具尚未注册）。
 *
 * 逐平台校验 4 件事：
 *   (1) 技能声明的 dsagent_<platform>_publish* 工具是否在 src/*.ts 真实注册（name: 'dsagent_xxx'）
 *   (2) 技能声明的发布域名是否在 src/ 有实现证据（发布类文件 > 仅绑定/代理文件 > 完全没有）
 *   (3) 技能引用的 publish-config/*.json 锚点集是否存在且可解析
 *   (4) 工具未实现时，技能是否给了「降级指令型」路径（有降级 → warn，没降级 → error）
 *
 * 默认模式（warn 不阻断，可直接进 CI）：只把「结构性错误」当 error。
 * --strict：把所有 warn 一并升为 error，缺口清单立刻变成红灯（当前 jd/1688/抖店会红）。
 *
 * 零依赖（不 import lib/，无需先 build）。
 *
 * 用法：
 *   node dev/verify-mqs-tools.mjs                 # 扫 skills/ + src/，只报结构性 error
 *   node dev/verify-mqs-tools.mjs --strict        # 缺技能 / 工具未实现 / 域名无实现 全部算 error
 *   node dev/verify-mqs-tools.mjs --dir <path>    # 指定技能根目录（写草稿时自检）
 *   node dev/verify-mqs-tools.mjs --src <path>    # 指定源码根目录
 *   node dev/verify-mqs-tools.mjs --json          # 机器可读输出
 *   node dev/verify-mqs-tools.mjs --selftest      # 只跑内置正反样例自测
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const LF = String.fromCharCode(10)
const BOM = String.fromCharCode(0xfeff)
const BT = String.fromCharCode(96)
const CR = String.fromCharCode(13)

/** 期望存在的 5 个 mqs 技能 + 平台词 + 平台域名（域名用于查 src/ 实现证据）。 */
export const EXPECTED = [
  {
    id: '1688-publish-mqs',
    platform: '1688',
    domains: ['1688.com'],
    words: ['1688', '阿里巴巴'],
    toolPatterns: [/^dsagent_1688_[a-z0-9_]*publish/],
  },
  {
    id: 'douyin-publish-mqs',
    platform: 'douyin',
    domains: ['douyin.com'],
    words: ['抖音', 'douyin'],
    toolPatterns: [/^dsagent_douyin_[a-z0-9_]*publish/],
  },
  {
    id: 'jd-publish-mqs',
    platform: 'jd',
    domains: ['jd.com'],
    words: ['京东', 'jd'],
    toolPatterns: [/^dsagent_jd_[a-z0-9_]*publish/],
  },
  {
    id: 'taobao-publish-mqs',
    platform: 'taobao',
    domains: ['taobao.com'],
    words: ['淘宝', 'taobao'],
    toolPatterns: [/^dsagent_taobao_[a-z0-9_]*publish/],
  },
  {
    // 天猫与淘宝共用同一 goods_manager 引擎，只按 channel 切发布域：
    // 天猫技能声明的工具就是 dsagent_taobao_publish_mqs，因此天猫的合法工具前缀包含 taobao_。
    id: 'tmall-publish-mqs',
    platform: 'tmall',
    domains: ['tmall.com'],
    words: ['天猫', 'tmall'],
    toolPatterns: [/^dsagent_(?:tmall|taobao)_[a-z0-9_]*publish/],
  },
]

/** 只有这些文件才算「发布实现」；bindings / gateway-proxy / browser-login 只算「登录态证据」。 */
const PUBLISH_FILE_RE = /publish/i
const AUTH_FILE_RE = /(bindings|browser-login|gateway-proxy|tools-platform)/i

/** 降级路径关键词：工具未实现时，技能必须告诉模型「改用人工步骤，不要假装已提交」。 */
const FALLBACK_RE = /(降级|指令型|人工上架|人工发布|手动发布|不要假装|未注册)/

function splitLines(text) {
  return text.split(LF).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l))
}

/** 拆分 frontmatter / 正文（与 verify-mqs-skills.mjs 同规则）。 */
export function splitSkillMarkdown(raw) {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw
  const lines = splitLines(text)
  if (!lines.length || lines[0].trim() !== '---') return { hasFrontmatter: false, frontmatter: '', body: text }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { hasFrontmatter: true, frontmatter: lines.slice(1, i).join(LF), body: lines.slice(i + 1).join(LF) }
    }
  }
  return { hasFrontmatter: false, frontmatter: '', body: text }
}

/** 抽取正文里所有 dsagent_* 工具名（反引号内外都算），保序去重。 */
export function extractToolRefs(body) {
  const out = []
  const seen = new Set()
  const re = /dsagent_[a-z0-9_]+/g
  let m
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** 抽取技能引用的 publish-config/*.json 锚点集路径。 */
export function extractConfigRefs(body) {
  const out = []
  const seen = new Set()
  const re = /publish-config\/[A-Za-z0-9_.-]+\.json/g
  let m
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** 该平台「自己的」发布工具名：优先用 EXPECTED 里声明的 toolPatterns（含同引擎换域别名）。 */
export function isPlatformTool(tool, platform) {
  const expected = EXPECTED.find((e) => e.platform === platform)
  if (expected && expected.toolPatterns) return expected.toolPatterns.some((re) => re.test(tool))
  return tool.indexOf('dsagent_' + platform + '_') === 0 && /publish/.test(tool)
}


/** 读 src/ 下所有源码，产出工具注册表与域名证据表。 */
export function loadSourceIndex(srcRoot) {
  const tools = new Map() // tool name -> file
  const domains = new Map() // domain -> [files]
  const files = []
  if (!srcRoot || !fs.existsSync(srcRoot)) return { tools: tools, domains: domains, files: files }

  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue
        walk(full)
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(ent.name)) {
        files.push(full)
      }
    }
  }
  walk(srcRoot)

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/')
    const reTool = /name:\s*['\"](dsagent_[a-z0-9_]+)['\"]/g
    let m
    while ((m = reTool.exec(text)) !== null) {
      if (!tools.has(m[1])) tools.set(m[1], rel)
    }
    const reDom = /[a-z0-9-]+\.(?:com|cn|net|hk)/g
    while ((m = reDom.exec(text)) !== null) {
      const d = m[0]
      if (!domains.has(d)) domains.set(d, [])
      const arr = domains.get(d)
      if (arr.indexOf(rel) < 0) arr.push(rel)
    }
  }
  return { tools: tools, domains: domains, files: files }
}

/** 某域名在 src/ 的实现证据等级：publish(2) > auth/其他(1) > none(0)。 */
export function domainEvidence(index, domain) {
  const files = index.domains.get(domain) || []
  if (files.some((f) => PUBLISH_FILE_RE.test(f))) return { level: 2, files: files }
  if (files.length) return { level: 1, files: files }
  return { level: 0, files: [] }
}

/** 校验一份技能文档 vs 源码索引。 */
export function validateDoc(id, raw, srcIndex, repoRoot) {
  const root = repoRoot || REPO_ROOT
  const errors = []
  const warns = []
  const err = (code, msg) => errors.push({ code: code, msg: msg })
  const warn = (code, msg) => warns.push({ code: code, msg: msg })

  const expected = EXPECTED.find((e) => e.id === id)
  const platform = expected ? expected.platform : id.replace(/-publish-mqs$/, '')
  const parsed = splitSkillMarkdown(raw)
  const body = parsed.body

  if (!parsed.hasFrontmatter) err('missing_frontmatter', '没有 frontmatter，无法确认技能身份')

  const tools = extractToolRefs(body)
  const platformTools = tools.filter((t) => isPlatformTool(t, platform))
  const missingTools = platformTools.filter((t) => !srcIndex.tools.has(t))
  const otherMissing = tools.filter((t) => platformTools.indexOf(t) < 0 && !srcIndex.tools.has(t))

  // (1) 平台发布工具必须真实注册；未注册时必须给降级路径
  if (!platformTools.length) {
    err('no_platform_tool_declared', '正文没有声明任何 dsagent_' + platform + '_publish* 工具，无法与宿主对齐')
  } else if (missingTools.length === platformTools.length) {
    if (FALLBACK_RE.test(body)) {
      warn(
        'tool_not_implemented',
        '技能声明的 ' + missingTools.join(' / ') + ' 在 src/ 未注册（已给降级指令型路径：文档先行、实现待补）',
      )
    } else {
      err(
        'tool_not_implemented_no_fallback',
        '技能声明的 ' + missingTools.join(' / ') + ' 在 src/ 未注册，且正文没有降级指令型路径（会误导模型假装已提交）',
      )
    }
  } else if (missingTools.length) {
    warn('tool_partially_unregistered', '部分平台工具未在 src/ 注册：' + missingTools.join(' / '))
  }

  if (otherMissing.length) {
    warn('referenced_tool_unregistered', '正文引用了 src/ 未注册的工具：' + otherMissing.join(' / '))
  }

  // (2) 发布域名必须有实现证据
  const domains = expected ? expected.domains : []
  const noEvidence = []
  const authOnly = []
  for (const d of domains) {
    const ev = domainEvidence(srcIndex, d)
    if (ev.level === 0) noEvidence.push(d)
    else if (ev.level === 1) authOnly.push(d)
  }
  if (domains.length) {
    if (noEvidence.length === domains.length) {
      err('domain_no_evidence', '平台域名在 src/ 完全没有实现证据：' + noEvidence.join(' / '))
    } else if (noEvidence.length) {
      warn('domain_partial_evidence', '平台域名在 src/ 缺实现证据：' + noEvidence.join(' / '))
    }
    if (authOnly.length) {
      warn('domain_auth_only', '平台域名只在登录态/绑定文件出现、没有发布实现：' + authOnly.join(' / '))
    }
  }

  // (3) publish-config 锚点集必须存在且可解析
  const configRefs = extractConfigRefs(body)
  for (const ref of configRefs) {
    const abs = path.join(root, ref)
    if (!fs.existsSync(abs)) {
      err('dangling_config', '引用的锚点集不存在：' + ref)
      continue
    }
    try {
      const json = JSON.parse(fs.readFileSync(abs, 'utf8'))
      if (!json || typeof json !== 'object') err('bad_config', '锚点集不是 JSON 对象：' + ref)
    } catch (e) {
      err('bad_config', '锚点集 JSON 解析失败：' + ref + '（' + e.message + '）')
    }
  }
  if (!configRefs.length) {
    warn('no_config_ref', '正文没有引用任何 publish-config/*.json 锚点集（锚点应外置、发布时现读）')
  }

  // (4) 平台词覆盖，避免技能写错平台
  if (expected) {
    const prose = body.replace(/dsagent_[a-z0-9_]+/g, ' ').replace(/publish-config\/[A-Za-z0-9_.-]+\.json/g, ' ')
    const lower = prose.toLowerCase()
    if (!expected.words.some((w) => lower.includes(w.toLowerCase()))) {
      warn('no_platform_word', '正文没有出现本平台词（' + expected.words.join(' / ') + '）')
    }
  }

  return {
    id: id,
    platform: platform,
    ok: errors.length === 0,
    errors: errors,
    warns: warns,
    stats: {
      tools: tools.length,
      platformTools: platformTools.length,
      unregistered: missingTools.length,
      configRefs: configRefs.length,
    },
  }
}

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
  const srcRoot = o.srcRoot || path.join(repoRoot, 'src')
  const quiet = !!o.quiet
  const srcIndex = o.srcIndex || loadSourceIndex(srcRoot)

  const targets = collectTargets(root)
  const results = targets.map((t) => validateDoc(t.id, fs.readFileSync(t.file, 'utf8'), srcIndex, repoRoot))

  const present = new Set(results.map((r) => r.id))
  const missing = EXPECTED.filter((e) => !present.has(e.id)).map((e) => e.id)
  const missingReports = missing.map((id) => ({
    id: id,
    platform: (EXPECTED.find((e) => e.id === id) || {}).platform || id,
    ok: !strict,
    errors: strict ? [{ code: 'missing_expected_skill', msg: '期望存在的技能目录缺失：skills/' + id + '/SKILL.md' }] : [],
    warns: strict ? [] : [{ code: 'missing_expected_skill', msg: '期望存在的技能目录缺失：skills/' + id + '/SKILL.md' }],
    stats: null,
  }))

  const all = results.concat(missingReports).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const errCount = all.reduce((n, r) => n + r.errors.length, 0)
  const warnCount = all.reduce((n, r) => n + r.warns.length, 0)
  const promoted = strict ? warnCount : 0

  if (asJson && !quiet) {
    console.log(
      JSON.stringify(
        {
          root: root,
          srcRoot: srcRoot,
          strict: strict,
          present: results.length,
          missing: missing,
          errCount: errCount + promoted,
          warnCount: strict ? 0 : warnCount,
          registeredTools: Array.from(srcIndex.tools.keys()).sort(),
          results: all,
        },
        null,
        2,
      ),
    )
    return errCount + promoted
  }

  if (!quiet) console.log('=== mqs 技能 ↔ 宿主实现一致性门禁 ===')
  if (!quiet) console.log('技能目录：' + root)
  if (!quiet) console.log('源码目录：' + srcRoot + '（已注册 ' + srcIndex.tools.size + ' 个 dsagent_* 工具）')
  if (!quiet) console.log('命中技能：' + results.length + ' / 期望 ' + EXPECTED.length + (missing.length ? '（缺：' + missing.join(', ') + '）' : ''))
  for (const r of all) {
    const flag = r.errors.length ? 'FAIL' : r.warns.length ? 'WARN' : 'PASS'
    const st = r.stats
      ? ' [工具 ' + r.stats.platformTools + '/' + r.stats.tools + ' 平台/总，未注册 ' + r.stats.unregistered + '，锚点 ' + r.stats.configRefs + ']'
      : ''
    if (!quiet) console.log('')
    if (!quiet) console.log('[' + flag + '] ' + r.id + st)
    for (const e of r.errors) if (!quiet) console.log('    ERROR ' + e.code + ': ' + e.msg)
    for (const w of r.warns) if (!quiet) console.log('    warn  ' + w.code + ': ' + w.msg)
  }
  if (!quiet) console.log('')
  if (!quiet && strict) {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn（--strict：warn 一并计为失败 → ' + (errCount + warnCount) + '）')
  } else if (!quiet) {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn')
  }
  const failed = errCount + promoted
  if (!quiet) console.log(failed === 0 ? '✅ 门禁通过' : '❌ 门禁未通过（见上方 ERROR' + (strict ? ' / 被升级的 warn' : '') + '）')
  return failed
}

/* ───────────────────── 自测（正反样例） ───────────────────── */

const GOOD_BODY =
  '# 淘宝 · 商品上架\n' +
  '\n' +
  '## 工作流\n' +
  '1. 组装统一商品 JSON。\n' +
  '2. 不带 confirm 调用 `dsagent_taobao_publish` 取预览。\n' +
  '3. 用户确认后带 confirm=true 重新调用。\n' +
  '\n' +
  '锚点集见 `publish-config/taobao.json`，规范见 `PUBLISH-SPEC.md`。\n'

function goodDoc(id) {
  return '---\nname: ' + (id || 'taobao-publish-mqs') + '\ndescription: 淘宝商品上架\n---\n' + GOOD_BODY
}

function fakeIndex(tools, domains) {
  const toolMap = new Map()
  for (const t of tools || []) toolMap.set(t, 'src/tools-publish.ts')
  const domMap = new Map()
  for (const d of Object.keys(domains || {})) domMap.set(d, domains[d])
  return { tools: toolMap, domains: domMap, files: [] }
}

const TAOBAO_INDEX = fakeIndex(['dsagent_taobao_publish'], { 'taobao.com': ['src/taobao-publish.ts'] })

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

  console.log('=== verify-mqs-tools 自测 ===')

  check('工具已注册 + 域名有发布实现 → 零 error 零 warn', () => {
    const r = validateDoc('taobao-publish-mqs', goodDoc(), TAOBAO_INDEX)
    assert(r.errors.length === 0, 'unexpected errors: ' + JSON.stringify(codes(r)))
    assert(r.warns.length === 0, 'unexpected warns: ' + JSON.stringify(wcodes(r)))
    assert(r.ok === true, 'ok should be true')
  })

  check('缺 frontmatter → missing_frontmatter', () => {
    const r = validateDoc('taobao-publish-mqs', GOOD_BODY, TAOBAO_INDEX)
    assert(codes(r).includes('missing_frontmatter'), JSON.stringify(codes(r)))
  })

  check('没声明平台工具 → no_platform_tool_declared', () => {
    const raw = goodDoc().replace('dsagent_taobao_publish', '人工点击')
    const r = validateDoc('taobao-publish-mqs', raw, TAOBAO_INDEX)
    assert(codes(r).includes('no_platform_tool_declared'), JSON.stringify(codes(r)))
  })

  check('工具未注册 + 有降级路径 → 只 warn tool_not_implemented', () => {
    const raw = goodDoc().replace('dsagent_taobao_publish', 'dsagent_jd_publish_mqs') + '\n宿主未注册时降级为指令型。\n'
    const r = validateDoc('jd-publish-mqs', '---\nname: jd-publish-mqs\n---\n' + raw.split('---\n').slice(2).join(''), fakeIndex([], { 'jd.com': ['src/browser-login.ts'] }))
    const c = codes(r)
    const w = wcodes(r)
    assert(!c.includes('tool_not_implemented_no_fallback'), JSON.stringify(c))
    assert(w.includes('tool_not_implemented'), JSON.stringify(w))
    assert(w.includes('domain_auth_only'), JSON.stringify(w))
  })

  check('工具未注册 + 无降级路径 → error tool_not_implemented_no_fallback', () => {
    const raw = '---\nname: jd-publish-mqs\n---\n' + GOOD_BODY.replace('dsagent_taobao_publish', 'dsagent_jd_publish_mqs')
    const r = validateDoc('jd-publish-mqs', raw, fakeIndex([], { 'jd.com': ['src/browser-login.ts'] }))
    assert(codes(r).includes('tool_not_implemented_no_fallback'), JSON.stringify(codes(r)))
  })

  check('平台域名在 src/ 完全没有 → domain_no_evidence', () => {
    const r = validateDoc('jd-publish-mqs', goodDoc('jd-publish-mqs'), fakeIndex(['dsagent_jd_publish_mqs'], {}))
    assert(codes(r).includes('domain_no_evidence'), JSON.stringify(codes(r)))
  })

  check('只被顺带提及的工具未注册 → warn referenced_tool_unregistered', () => {
    const raw = goodDoc() + '\n命中风控调用 `dsagent_risk_verify`。\n'
    const r = validateDoc('taobao-publish-mqs', raw, TAOBAO_INDEX)
    assert(wcodes(r).includes('referenced_tool_unregistered'), JSON.stringify(wcodes(r)))
    assert(codes(r).length === 0, JSON.stringify(codes(r)))
  })

  check('锚点集不存在 → dangling_config', () => {
    const raw = goodDoc().replace('publish-config/taobao.json', 'publish-config/not-exist.json')
    const r = validateDoc('taobao-publish-mqs', raw, TAOBAO_INDEX)
    assert(codes(r).includes('dangling_config'), JSON.stringify(codes(r)))
  })

  check('没引用锚点集 → warn no_config_ref', () => {
    const raw = goodDoc().replace('`publish-config/taobao.json`', '内部常量')
    const r = validateDoc('taobao-publish-mqs', raw, TAOBAO_INDEX)
    assert(wcodes(r).includes('no_config_ref'), JSON.stringify(wcodes(r)))
  })

  check('正文没有本平台词 → warn no_platform_word', () => {
    const raw = '---\nname: jd-publish-mqs\n---\n' + GOOD_BODY.replace(/淘宝/g, '某平台').replace('dsagent_taobao_publish', 'dsagent_jd_publish_mqs')
    const r = validateDoc('jd-publish-mqs', raw, fakeIndex(['dsagent_jd_publish_mqs'], { 'jd.com': ['src/jd-publish.ts'] }))
    assert(wcodes(r).includes('no_platform_word'), JSON.stringify(wcodes(r)))
  })

  check('extractToolRefs 保序去重', () => {
    const t = extractToolRefs('`dsagent_a` 与 dsagent_b 与 `dsagent_a`')
    assert(t.length === 2 && t[0] === 'dsagent_a' && t[1] === 'dsagent_b', JSON.stringify(t))
  })

  check('isPlatformTool 认平台前缀 + 同引擎别名', () => {
    assert(isPlatformTool('dsagent_1688_publish_mqs', '1688') === true, '1688 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'taobao') === true, 'taobao 前缀未命中')
    assert(isPlatformTool('dsagent_douyin_shop_publish_mqs', 'douyin') === true, '抖店 shop_ 中缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish_mqs', 'tmall') === true, '天猫应接受同引擎 taobao_ 别名')
    assert(isPlatformTool('dsagent_taobao_publish', 'jd') === false, 'jd 不该命中 taobao 工具')
    assert(isPlatformTool('dsagent_risk_verify', 'jd') === false, 'risk_verify 不该算平台发布工具')
  })

  check('loadSourceIndex 能从真实 src/ 读出已注册工具与域名', () => {
    const idx = loadSourceIndex(path.join(REPO_ROOT, 'src'))
    assert(idx.tools.has('dsagent_taobao_publish'), '缺 dsagent_taobao_publish')
    assert(idx.domains.has('taobao.com'), '缺 taobao.com 域名证据')
    assert(domainEvidence(idx, 'taobao.com').level === 2, 'taobao.com 应有发布实现')
  })

  check('--strict 下缺技能 → missing_expected_skill 计入失败数', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-tools-'))
    const n = run(tmp, { strict: true, json: true, quiet: true, srcIndex: TAOBAO_INDEX })
    assert(n === EXPECTED.length, 'expected ' + EXPECTED.length + ' failures, got ' + n)
  })

  check('非 strict 下缺技能只算 warn（不阻断）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-tools2-'))
    const n = run(tmp, { json: true, quiet: true, srcIndex: TAOBAO_INDEX })
    assert(n === 0, 'expected 0 errors, got ' + n)
  })

  check('collectTargets 只收 *-publish-mqs 目录', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-tools3-'))
    fs.mkdirSync(path.join(tmp, 'jd-publish-mqs'))
    fs.writeFileSync(path.join(tmp, 'jd-publish-mqs', 'SKILL.md'), goodDoc('jd-publish-mqs'), 'utf8')
    fs.mkdirSync(path.join(tmp, 'pdd-publish-2'))
    fs.writeFileSync(path.join(tmp, 'pdd-publish-2', 'SKILL.md'), goodDoc('pdd-publish-2'), 'utf8')
    const t = collectTargets(tmp)
    assert(t.length === 1 && t[0].id === 'jd-publish-mqs', JSON.stringify(t))
  })

  console.log('')
  console.log('自测结果：' + pass + ' pass / ' + fail + ' fail')
  return fail === 0 ? 0 : 1
}

/* ───────────────────── CLI ───────────────────── */

function main(argv) {
  const args = argv.slice(2)
  const strict = args.includes('--strict')
  const json = args.includes('--json')
  const dirIdx = args.indexOf('--dir')
  const srcIdx = args.indexOf('--src')
  const root = dirIdx >= 0 && args[dirIdx + 1] ? path.resolve(args[dirIdx + 1]) : path.join(REPO_ROOT, 'skills')
  const srcRoot = srcIdx >= 0 && args[srcIdx + 1] ? path.resolve(args[srcIdx + 1]) : path.join(REPO_ROOT, 'src')

  if (args.includes('--selftest')) return selftest()

  const n = run(root, { strict: strict, json: json, srcRoot: srcRoot })
  return n === 0 ? 0 : 1
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  process.exitCode = main(process.argv)
}
