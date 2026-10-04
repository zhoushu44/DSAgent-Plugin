/**
 * 技能质量门禁 —— 吸收 Accio 的 SKILL.md 校验与评分模型。
 *
 * 背景（见 ACCIO-REVERSE-ANALYSIS.md §2）：
 *   Accio 在技能落盘前有一套**硬校验**（不合格直接拒绝写入），另有一套**加权评分**（用于淘汰排序）。
 *   本项目原样移植这两套机制，但做了两处必要改造：
 *
 *   1. **槽位正则中英双语化**。Accio 的评分器是英文硬编码（`/^## Workflow/im`），
 *      而本项目技能正文用的是中文标题（`## 工作流` / `## 前置条件` / `## 错误处理`）。
 *      直接照搬会把 55/55 个技能全判为 0.60 且「missing Workflow」——
 *      信息其实齐全，只是标题语言不同。因此槽位匹配改为双语，任一命中即通过。
 *
 *   2. **不做「不合格拒绝写入」的硬拦截**。Accio 是封闭市场，能强制约束作者；
 *      本项目的技能目录是用户自己的资产，硬拦截会让人无法保存半成品。
 *      因此门禁只**报告问题**（issues/warnings）并**打分**，由 UI 展示、由 CI 决定是否阻断。
 *
 * 本模块是纯函数集合，不碰文件系统，便于单测与在 browser 半区复用。
 */

/* ────────────────────────────── frontmatter 切分 ────────────────────────────── */

export interface SplitResult {
  /** frontmatter 文本（不含首尾 --- 行）；无 frontmatter 时为空串 */
  frontmatter: string
  /** 正文（frontmatter 之后的内容，已 trim） */
  body: string
  /** 是否存在合法的 `---` 包裹块 */
  hasFrontmatter: boolean
}

/**
 * 切分 SKILL.md 为 frontmatter + 正文。
 *
 * 与 skill-service.ts::pickFrontmatter 使用同一套边界正则，保证两处对
 * 「哪些内容算 frontmatter」的判定完全一致（不一致会导致打分与解析结果对不上）。
 */
export function splitSkillMarkdown(raw: string): SplitResult {
  const normalized = stripBom(raw)
  const m = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { frontmatter: '', body: normalized.trim(), hasFrontmatter: false }
  return {
    frontmatter: m[1],
    body: normalized.slice(m[0].length).trim(),
    hasFrontmatter: true,
  }
}

/** 去掉 BOM 与前导空白 —— 某些编辑器保存的中文技能文件带 BOM，会让 ^--- 匹配失败 */
export function stripBom(s: string): string {
  let t = s
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  return t.replace(/^[\s\uFEFF\xA0]+/, '')
}

/* ────────────────────────── frontmatter 字段取值 ────────────────────────── */

/**
 * 从 frontmatter 文本取字段值（不引入 YAML 依赖）。
 *
 * 必须支持 YAML 块标量：`description: |` / `>` 的取值是后续缩进行，不是那个竖线本身。
 * 只按单行正则取会把 description 解析成字面量 "|"。
 *
 * ★ 值以 `[` `{` `#` `*` 开头时的处理（Accio 明确警告的 YAML 陷阱）：
 *   Accio 的解析器在 YAML.parse 失败时降级到 flat parser，并警告
 *   「Quote any value starting with "[", "{", "#", or "*"」。
 *   本函数是 flat parser 语义，直接按文本取值，因此天然不受该陷阱影响；
 *   但为了让**下游**（如契约生成、UI 展示）拿到干净值，这里统一剥掉成对引号。
 */
export function readFrontmatterField(frontmatter: string, key: string): string | null {
  if (!frontmatter) return null
  const re = new RegExp(`^[ \\t]*${escapeRe(key)}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, 'm')
  const hit = frontmatter.match(re)
  if (!hit) return null
  const inline = stripQuotes(hit[1].trim())
  // 非块标量：直接就是值
  if (!/^[|>][+-]?$/.test(inline)) return inline
  // 块标量：从下一行起收集缩进行，遇到顶格行（下一个 frontmatter 键）即结束
  const rest = frontmatter.slice(frontmatter.indexOf(hit[0]) + hit[0].length)
  const lines: string[] = []
  for (const line of rest.split(/\r?\n/)) {
    if (line.trim() === '') { lines.push(''); continue }
    if (!/^[ \t]/.test(line)) break
    lines.push(line.trim())
  }
  return lines.join(' ').trim() || null
}

/** 剥掉成对的首尾引号（单/双/中文引号） */
function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const a = v[0]
    const b = v[v.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '“' && b === '”')) {
      return v.slice(1, -1)
    }
  }
  return v
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ────────────────────────────── 槽位（双语） ────────────────────────────── */

/** 一个标准槽位的定义 */
export interface SlotDef {
  key: 'workflow' | 'errorHandling' | 'precondition'
  label: string
  re: RegExp
}

/**
 * 标准槽位定义 —— 中英双语正则，任一命中即算该槽位存在。
 *
 * 两处刻意的设计，都来自对本项目 56 个技能实测后的修正：
 *
 * ① **不用 `\b` 收尾**。JS 里 `\w` 只含 `[A-Za-z0-9_]`，中文字符不属于 `\w`，
 *    因此 `工作流\b` 在行尾永远失配（首版就是这么写的，实测 0/56 命中）。
 *
 * ② **匹配「标题里含关键词」而非「标题以关键词开头」**。Accio 的英文技能
 *    一律叫 `## Workflow`，所以它敢用 `^## Workflow` 锚定；而本项目的技能
 *    标题是描述式的，如 `## 完整 HTML 报告工作流（含分析结论）`、`## 4 步主流程`，
 *    锚定开头会全部漏掉。改为「H2 行内包含关键词」后覆盖率才符合直觉。
 *
 * 由于只在 `## ` 开头的行上测试（`###` 不会命中），放宽带来的误报风险很低。
 */
export const SLOTS: SlotDef[] = [
  {
    key: 'workflow',
    label: '工作流 / Workflow',
    re: /^##\s+.*(?:Workflow|工作流|流程)/im,
  },
  {
    key: 'errorHandling',
    label: '错误处理 / Pitfalls',
    // Pitfall(s) / Fallback / Edge Cases / 错误处理 / 异常处理 / 常见错误 / 失败处理 / 降级 / 边界情况 / 注意事项 / 限制
    re: /^##\s+.*(?:Pitfalls?|Fallback|Edge\s*Cases?|错误处理|异常处理|常见错误|失败处理|降级|边界情况|注意事项|限制)/im,
  },
  {
    key: 'precondition',
    label: '前置条件 / Preconditions',
    // Precondition(s) / Verification / Success / 前置条件 / 前置要求 / 前置准备 / 验收 / 校验 / 成功标准
    re: /^##\s+.*(?:Preconditions?|Verification|Success(?:\s*Criteria)?|前置条件|前置要求|前置准备|验收|校验|成功标准)/im,
  },
]

/** 取出正文里某个槽位的小节内容（用于统计步数/条目数）；不存在返回 null */
export function readSection(body: string, slot: SlotDef): string | null {
  const lines = body.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) && slot.re.test(lines[i])) { start = i; break }
  }
  if (start === -1) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/** 统计有序步骤数（`1. ` / `1) ` 行） */
export function countSteps(section: string | null): number {
  if (!section) return 0
  return section.split(/\r?\n/).filter(l => /^\s*\d+[.)]\s+/.test(l)).length
}

/** 统计列表条目数（`- ` / `* ` / `1. ` 行） */
export function countItems(section: string | null): number {
  if (!section) return 0
  return section.split(/\r?\n/).filter(l => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)).length
}

/** 取名为 name 的二级小节（用于 Pitfalls / Suggestions / Fallback 的单列小节） */
function readNamedSection(body: string, re: RegExp): string | null {
  const lines = body.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]) && re.test(lines[i])) { start = i; break }
  }
  if (start === -1) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/* ────────────────────────────── 阈值常量 ────────────────────────────── */

/** 阈值 —— 与 Accio 保持一致，便于横向对比 */
export const LIMITS = {
  /** 正文最短长度（字符） */
  BODY_MIN_LENGTH: 200,
  /** Workflow 最多步数 */
  WORKFLOW_MAX_STEPS: 7,
  /** Fallback / Edge Cases 最多条目 */
  FALLBACK_MAX_ITEMS: 3,
  /** Pitfalls 最多条目 */
  PITFALLS_MAX_ITEMS: 3,
  /** Suggestions 最多条目 */
  SUGGESTIONS_MAX_ITEMS: 3,
  /** description 最短长度 */
  DESC_MIN: 72,
  /** description 最长长度 */
  DESC_MAX: 420,
  /** description 甜区下限（仅用于提示，不判失败） */
  DESC_SWEET_MIN: 120,
  /** description 甜区上限 */
  DESC_SWEET_MAX: 380,
} as const

/* ────────────────────────────── 评分模型 ────────────────────────────── */

/**
 * 加权评分权重 —— 逐项对齐 Accio 的 oA 常量。
 *
 * Workflow 权重最高（0.20）：Accio 的设计意图是「技能的价值主要在于沉淀了
 * 一条可复用的执行路径」，与 CRITICAL 提示词里
 * 「Skills are historical operating experience」一致。
 */
export const SCORE_WEIGHTS = {
  FRONTMATTER_NAME_SCORE: 0.15,
  FRONTMATTER_DESC_SCORE: 0.15,
  BODY_LENGTH_SCORE: 0.15,
  BODY_SECTION_SCORE: 0.15,
  WORKFLOW_SECTION_SCORE: 0.20,
  ERROR_HANDLING_SCORE: 0.10,
  PRECONDITION_SCORE: 0.10,
} as const

export interface ScoreBreakdown {
  hasName: boolean
  hasDesc: boolean
  bodyLongEnough: boolean
  hasSection: boolean
  hasWorkflow: boolean
  hasErrorHandling: boolean
  hasPrecondition: boolean
}

export interface SkillScore {
  /** 0.00 ~ 1.00，与 Accio 同量表 */
  score: number
  breakdown: ScoreBreakdown
}

/**
 * 文档质量评分（Accio 同量表，槽位双语化）。
 *
 * 纯结构评分，**不读文件系统、不做语义判断** —— 因此同一个技能的分数稳定可复现，
 * 可作为「技能质量」的客观代理指标用于排序与淘汰。
 */
export function scoreSkill(raw: string): SkillScore {
  const { frontmatter, body, hasFrontmatter } = splitSkillMarkdown(raw)
  if (!hasFrontmatter) {
    return {
      score: 0,
      breakdown: {
        hasName: false, hasDesc: false, bodyLongEnough: false, hasSection: false,
        hasWorkflow: false, hasErrorHandling: false, hasPrecondition: false,
      },
    }
  }

  const hasName = /^[ \t]*name[ \t]*:[ \t]*\S/m.test(frontmatter)
  const hasDesc = /^[ \t]*description[ \t]*:[ \t]*\S/m.test(frontmatter)
  const bodyLongEnough = body.length >= LIMITS.BODY_MIN_LENGTH
  const hasSection = /^## /m.test(body)
  const hasWorkflow = SLOTS[0].re.test(body)
  const hasErrorHandling = SLOTS[1].re.test(body)
  const hasPrecondition = SLOTS[2].re.test(body)

  let s = 0
  if (hasName) s += SCORE_WEIGHTS.FRONTMATTER_NAME_SCORE
  if (hasDesc) s += SCORE_WEIGHTS.FRONTMATTER_DESC_SCORE
  if (bodyLongEnough) s += SCORE_WEIGHTS.BODY_LENGTH_SCORE
  if (hasSection) s += SCORE_WEIGHTS.BODY_SECTION_SCORE
  if (hasWorkflow) s += SCORE_WEIGHTS.WORKFLOW_SECTION_SCORE
  if (hasErrorHandling) s += SCORE_WEIGHTS.ERROR_HANDLING_SCORE
  if (hasPrecondition) s += SCORE_WEIGHTS.PRECONDITION_SCORE

  return {
    score: Math.min(s, 1),
    breakdown: { hasName, hasDesc, bodyLongEnough, hasSection, hasWorkflow, hasErrorHandling, hasPrecondition },
  }
}

/* ────────────────────────────── 硬校验 ────────────────────────────── */

export interface ValidationIssue {
  /** 机器可读的问题码，便于 UI 分组与 CI 断言 */
  code: string
  /** 面向人的中文说明 */
  message: string
  /** error = 结构性缺陷；warn = 可改进但不阻断 */
  severity: 'error' | 'warn'
}

export interface SkillValidation {
  ok: boolean
  score: SkillScore
  issues: ValidationIssue[]
}

/**
 * 校验技能文档 —— 对齐 Accio 的硬校验清单，但**只报告不拦截**（见文件头说明）。
 *
 * 校验顺序与 Accio 的校验函数一致（先结构、再长度、最后章节质量），
 * 便于把两边的诊断信息逐条对照。
 */
export function validateSkill(raw: string): SkillValidation {
  const issues: ValidationIssue[] = []
  const { frontmatter, body, hasFrontmatter } = splitSkillMarkdown(raw)

  // ① frontmatter 结构
  if (!hasFrontmatter) {
    issues.push({
      code: 'missing_frontmatter',
      message: '缺少 frontmatter（首行必须是 ---，并在其后用 --- 闭合）',
      severity: 'error',
    })
    return { ok: false, score: scoreSkill(raw), issues }
  }

  // ② 必填字段
  if (!/^[ \t]*name[ \t]*:[ \t]*\S/m.test(frontmatter)) {
    issues.push({ code: 'missing_name', message: 'frontmatter 缺少 name 字段', severity: 'error' })
  }
  const desc = readFrontmatterField(frontmatter, 'description')
  if (!desc) {
    issues.push({ code: 'missing_description', message: 'frontmatter 缺少 description 字段', severity: 'error' })
  } else {
    // ③ description 长度：这是模型路由的唯一依据，太短无法判断何时该用
    if (desc.length < LIMITS.DESC_MIN) {
      issues.push({
        code: 'desc_too_short',
        message: `description 过短（${desc.length} 字符，最少 ${LIMITS.DESC_MIN}）：`
          + '应说明何时使用本技能 —— 用户意图、触发词、关键词、前置条件或典型序列，'
          + `建议 ${LIMITS.DESC_SWEET_MIN}–${LIMITS.DESC_SWEET_MAX} 字符，不要只写一句话`,
        severity: 'error',
      })
    } else if (desc.length > LIMITS.DESC_MAX) {
      issues.push({
        code: 'desc_too_long',
        message: `description 过长（${desc.length} 字符，最多 ${LIMITS.DESC_MAX}）：`
          + '收紧「何时使用」的说明，正文细节留在 frontmatter 下方的 markdown 里',
        severity: 'warn',
      })
    } else if (desc.length < LIMITS.DESC_SWEET_MIN || desc.length > LIMITS.DESC_SWEET_MAX) {
      issues.push({
        code: 'desc_off_sweet_spot',
        message: `description 长度 ${desc.length} 偏离甜区 ${LIMITS.DESC_SWEET_MIN}–${LIMITS.DESC_SWEET_MAX}`,
        severity: 'warn',
      })
    }
  }

  // ④ 正文长度
  if (body.length < LIMITS.BODY_MIN_LENGTH) {
    issues.push({
      code: 'body_too_short',
      message: `正文过短（${body.length} 字符，最少 ${LIMITS.BODY_MIN_LENGTH}）：`
        + '必须包含至少一个 ## 工作流 小节（带编号步骤）',
      severity: 'error',
    })
  }

  // ⑤ 章节存在性
  if (!/^## /m.test(body)) {
    issues.push({ code: 'no_h2_section', message: '正文必须至少含一个 ## 小节（如「## 工作流」）', severity: 'error' })
  }
  if (!SLOTS[0].re.test(body)) {
    issues.push({
      code: 'no_workflow',
      message: '正文必须含「## 工作流 / ## Workflow」小节，沉淀经过验证的分步执行路径',
      severity: 'error',
    })
  }
  if (!SLOTS[1].re.test(body)) {
    issues.push({
      code: 'no_error_handling',
      message: '建议补「## 错误处理 / ## Pitfalls」小节，沉淀失败场景与降级路径',
      severity: 'warn',
    })
  }
  if (!SLOTS[2].re.test(body)) {
    issues.push({
      code: 'no_precondition',
      message: '建议补「## 前置条件 / ## Preconditions」小节，说明调用前需满足的条件',
      severity: 'warn',
    })
  }

  // ⑥ 章节质量：步数/条目数过多会让技能从「经验」退化成「流水账」
  const wfSteps = countSteps(readSection(body, SLOTS[0]))
  if (wfSteps > LIMITS.WORKFLOW_MAX_STEPS) {
    issues.push({
      code: 'workflow_too_detailed',
      message: `工作流步骤过多（${wfSteps} 步，最多 ${LIMITS.WORKFLOW_MAX_STEPS}）：`
        + '把例行工具调用收敛成更高层的阶段',
      severity: 'warn',
    })
  }
  const fbItems = countItems(readNamedSection(body, /^(?:Fallback(?:\s*\/\s*Edge\s*Cases?)?|Edge\s*Cases?|降级|边界情况)/i))
  if (fbItems > LIMITS.FALLBACK_MAX_ITEMS) {
    issues.push({
      code: 'fallback_too_detailed',
      message: `Fallback / 边界情况条目过多（${fbItems} 条，最多 ${LIMITS.FALLBACK_MAX_ITEMS}）`,
      severity: 'warn',
    })
  }
  const pitItems = countItems(readNamedSection(body, /^(?:Pitfalls?|常见错误|注意事项)/i))
  if (pitItems > LIMITS.PITFALLS_MAX_ITEMS) {
    issues.push({
      code: 'pitfalls_too_detailed',
      message: `Pitfalls / 常见错误条目过多（${pitItems} 条，最多 ${LIMITS.PITFALLS_MAX_ITEMS}）`,
      severity: 'warn',
    })
  }

  // ⑦ YAML 陷阱：未加引号且以特殊字符开头的值（Accio 明确警告的那组）
  for (const h of detectYamlHazards(frontmatter)) {
    issues.push({
      code: 'yaml_hazard',
      message: `frontmatter 字段 ${h.key} 的值以 "${h.char}" 开头且未加引号：${h.reason}`,
      severity: 'warn',
    })
  }

  return {
    ok: !issues.some(i => i.severity === 'error'),
    score: scoreSkill(raw),
    issues,
  }
}

/* ────────────────────────── YAML 危险性检测 ────────────────────────── */

/**
 * YAML 陷阱检测 —— 对应 Accio 解析器明确警告的那组问题。
 *
 * Accio 的 frontmatter 解析在 `YAML.parse` 失败时会降级到 flat parser，并打印：
 *   「Quote any value starting with "[", "{", "#", or "*", or use | / > block scalars.」
 * 同时警告：降级后 **nested 字段（renderers / tools / tool_triggers）会被完全忽略**。
 *
 * 对本项目尤其重要：技能 description 里大量出现 `[src: ...]` 这类方括号
 * （实测 data-report 554 字符、pywencai-stock 440 字符都在风险区），
 * 一旦解析器换成真正的 YAML 实现，这些 description 会解析失败并连带丢掉 tool_triggers。
 *
 * 因此这里主动把「未加引号但以特殊字符开头的值」标出来，让作者提前修掉。
 */
export interface YamlHazard {
  key: string
  value: string
  /** 触发危险的首字符 */
  char: string
  reason: string
}

/**
 * 扫描 frontmatter，找出未加引号且以 YAML 特殊字符开头的标量值。
 *
 * 只检测**单行标量**（`key: value`）。块标量（`key: |`）的内容天然是字符串，
 * 不参与 YAML 的流式语法解析，因此不检测；带缩进的行属于嵌套结构，也不在此检测。
 */
export function detectYamlHazards(frontmatter: string): YamlHazard[] {
  const out: YamlHazard[] = []
  if (!frontmatter) return out

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    // 跳过嵌套键/列表项，只看顶层标量键
    if (/^\s/.test(rawLine)) continue
    const m = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/)
    if (!m) continue
    const key = m[1]
    const value = m[2].trim()
    if (!value) continue
    // 块标量标记 / 已加引号 —— 都安全
    if (/^[|>][+-]?$/.test(value)) continue
    if (/^["']/.test(value)) continue

    const first = value[0]
    if (first === '[' || first === '{') {
      out.push({
        key, value, char: first,
        reason: 'YAML 会尝试按流式集合解析，中文/未转义内容极易导致整个 frontmatter 解析失败；'
          + '请用引号包裹整个值，或改写成块标量（| 或 >）',
      })
    } else if (first === '#' || first === '*') {
      out.push({
        key, value, char: first,
        reason: first === '#'
          ? 'YAML 中 # 起始表示注释，该值会被当成空值'
          : 'YAML 中 * 起始表示别名引用，会解析失败',
      })
    } else if (first === '&' || first === '!' || first === '%' || first === '@' || first === '`') {
      out.push({
        key, value, char: first,
        reason: `YAML 中 ${first} 是保留指示符，作为值首字符时需要引号包裹`,
      })
    }
  }
  return out
}

/* ────────────────────────────── tool_triggers 解析 ────────────────────────────── */

/**
 * 工具触发规则 —— 对应 Accio 的 `tool_triggers` frontmatter 声明。
 *
 * 语义：当名为 `tool` 的工具被调用，且入参匹配 `args` 全部键值对时，
 * 提示模型「本次操作与某技能相关，先读该技能」。
 *
 * `args` 的值支持 `/pattern/flags` 正则写法（与 Accio 的 Ifr() 判定一致）。
 */
export interface ToolTrigger {
  /** 被监听的工具名，如 dsagent_execute_skill */
  tool: string
  /** 入参匹配条件；缺省表示「只要调用该工具就命中」 */
  args?: Record<string, string>
}

/**
 * 解析 frontmatter 里的 tool_triggers 声明。
 *
 * 手写解析而不用 YAML 库的理由与 pickFrontmatter 一致：本插件刻意不引入 YAML 依赖。
 * 只支持 Accio 用到的那个子集（列表 of map，map 值为标量），超出子集的行会被忽略而非报错 ——
 * 与 Accio「解析失败降级、不丢技能」的容错取向一致。
 *
 * 支持的写法：
 *   tool_triggers:
 *     - tool: dsagent_execute_skill
 *       args:
 *         id: /^(product-reviews|product-wdj)$/
 *     - tool: dsagent_proxy
 *     -   tool: foo          # 缩进风格差异也接受
 */
export function parseToolTriggers(frontmatter: string): ToolTrigger[] {
  if (!frontmatter) return []
  const lines = frontmatter.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*tool_triggers[ \t]*:[ \t]*$/.test(lines[i])) { start = i; break }
    // 行内写法 tool_triggers: [] → 视为空声明
    if (/^[ \t]*tool_triggers[ \t]*:[ \t]*\[\s*\]/.test(lines[i])) return []
  }
  if (start === -1) return []

  const out: ToolTrigger[] = []
  let cur: ToolTrigger | null = null
  /**
   * 当前 `args:` 子映射键所在的缩进；-1 表示当前序列项还没有 args 段。
   *
   * 用缩进而非「模式变量」判定 args 条目：`tool:` 与 `args:` 同级，
   * 而 args 的键更深一层，比较缩进即可区分，且不会引入需要跨闭包推断的状态。
   */
  let argsIndent = -1

  const indentOf = (s: string): number => (s.match(/^[ \t]*/)?.[0].length ?? 0)

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const ind = indentOf(line)
    // 回到顶层（缩进归零）→ tool_triggers 块结束
    if (ind === 0) break

    // 序列项起始：`- tool: xxx` 或 `-` 单独一行
    const seq = line.match(/^[ \t]*-[ \t]*(.*)$/)
    if (seq) {
      if (cur) out.push(cur)
      cur = { tool: '' }
      argsIndent = -1
      const rest = seq[1].trim()
      if (rest) {
        const kv = rest.match(/^([^:]+):[ \t]*(.*)$/)
        if (kv) applyKey(cur, kv[1].trim(), stripQuotes(kv[2].trim()), () => { argsIndent = ind })
      }
      continue
    }
    if (!cur) continue

    const kv = line.match(/^[ \t]*([^:]+):[ \t]*(.*)$/)
    if (!kv) continue
    const key = kv[1].trim()
    const val = stripQuotes(kv[2].trim())

    // args 子映射内的键值对：缩进比 args: 那一行更深
    if (argsIndent >= 0 && ind > argsIndent && key !== 'args' && key !== 'tool') {
      cur.args = cur.args ?? {}
      cur.args[key] = val
      continue
    }

    applyKey(cur, key, val, () => { argsIndent = ind })
  }
  if (cur) out.push(cur)

  // 丢弃 tool 为空的项（结构不完整，与 Accio「tool 非 string 则跳过」一致）
  return out.filter(t => typeof t.tool === 'string' && t.tool.length > 0)
}

function applyKey(t: ToolTrigger, key: string, val: string, enterArgs: () => void): void {
  if (key === 'tool') t.tool = val
  else if (key === 'args') enterArgs()
}

/* ────────────────────────── args 匹配（正则感知） ────────────────────────── */

const REGEX_LITERAL_RE = /^\/(.+)\/([gimsuy]*)$/

/**
 * 判定一次工具调用的入参是否命中触发规则的 args 条件。
 *
 * 与 Accio 的 Ifr() 逐条对齐：
 *   - 规则要求某键，而实参里该键为 null/undefined → 不匹配
 *   - 规则值写成 /pattern/flags → 按正则测试实参的字符串形式
 *   - 否则 → 字符串全等比较
 *   - 正则非法 → 视为不匹配（Accio 是记 warn 后返回 false）
 */
export function matchesTriggerArgs(
  expected: Record<string, string>,
  actual: Record<string, unknown>,
  onInvalidRegex?: (pattern: string, err: unknown) => void,
): boolean {
  for (const [key, pattern] of Object.entries(expected)) {
    const got = actual?.[key]
    if (got === null || got === undefined) return false
    const s = String(got)
    const m = pattern.match(REGEX_LITERAL_RE)
    if (m) {
      try {
        if (!new RegExp(m[1], m[2]).test(s)) return false
      } catch (e) {
        onInvalidRegex?.(pattern, e)
        return false
      }
    } else if (s !== pattern) {
      return false
    }
  }
  return true
}
