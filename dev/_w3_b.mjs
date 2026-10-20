
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
    const lower = body.toLowerCase()
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
