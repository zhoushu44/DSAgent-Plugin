
function run(root, opts) {
  const o = opts || {}
  const strict = !!o.strict
  const asJson = !!o.json
  const repoRoot = o.repoRoot || REPO_ROOT
  const srcRoot = o.srcRoot || path.join(repoRoot, 'src')
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

  if (asJson) {
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

  console.log('=== mqs 技能 ↔ 宿主实现一致性门禁 ===')
  console.log('技能目录：' + root)
  console.log('源码目录：' + srcRoot + '（已注册 ' + srcIndex.tools.size + ' 个 dsagent_* 工具）')
  console.log('命中技能：' + results.length + ' / 期望 ' + EXPECTED.length + (missing.length ? '（缺：' + missing.join(', ') + '）' : ''))
  for (const r of all) {
    const flag = r.errors.length ? 'FAIL' : r.warns.length ? 'WARN' : 'PASS'
    const st = r.stats
      ? ' [工具 ' + r.stats.platformTools + '/' + r.stats.tools + ' 平台/总，未注册 ' + r.stats.unregistered + '，锚点 ' + r.stats.configRefs + ']'
      : ''
    console.log('')
    console.log('[' + flag + '] ' + r.id + st)
    for (const e of r.errors) console.log('    ERROR ' + e.code + ': ' + e.msg)
    for (const w of r.warns) console.log('    warn  ' + w.code + ': ' + w.msg)
  }
  console.log('')
  if (strict) {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn（--strict：warn 一并计为失败 → ' + (errCount + warnCount) + '）')
  } else {
    console.log('合计：' + errCount + ' error / ' + warnCount + ' warn')
  }
  const failed = errCount + promoted
  console.log(failed === 0 ? '✅ 门禁通过' : '❌ 门禁未通过（见上方 ERROR' + (strict ? ' / 被升级的 warn' : '') + '）')
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

  check('isPlatformTool 只认平台前缀', () => {
    assert(isPlatformTool('dsagent_1688_publish_mqs', '1688') === true, '1688 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'taobao') === true, 'taobao 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'tmall') === false, 'tmall 不该命中 taobao 工具')
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
    const n = run(tmp, { strict: true, json: true, srcIndex: TAOBAO_INDEX })
    assert(n === EXPECTED.length, 'expected ' + EXPECTED.length + ' failures, got ' + n)
  })

  check('非 strict 下缺技能只算 warn（不阻断）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-tools2-'))
    const n = run(tmp, { json: true, srcIndex: TAOBAO_INDEX })
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
