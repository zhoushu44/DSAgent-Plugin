/**
 * Wiki frontmatter 锁定模板与渲染 —— 移植 Accio 最重要的一条硬约束。
 *
 * Accio 的硬规则原文：
 *   「frontmatter 必须经脚本生成：禁止模型直接编写或修改最终 Wiki 页面的 YAML frontmatter。
 *     每页必须先用 `scripts/frontmatter.py template` 生成完整锁定模板；模型只替换模板中的值，
 *     不得增加、删除、改名或移动任何 key；再用 `render` 校验、清空值并拼接正文。」
 *
 * 为什么这条约束值得移植（而不是「让模型直接写 YAML」）：
 *
 *   1. **模型写 YAML 必然漂移**。字段名会变成近义词（「价格底线」写成「底价」）、
 *      层级会重组、枚举会自创。Accio 的验收表里为此专门列了 3 条检查项
 *      （Schema 一致性 / 域字段块存在 / 接待意图枚举），说明这是真实高频故障。
 *   2. **漂移是静默的**。YAML 合法但字段名错了，解析器不会报错，
 *      只会让「按字段检索」永久失效 —— 而 wiki 的全部价值就在于可检索。
 *   3. **锁定模板把「创造性」限制在值上**。结构由脚本生成，模型只填值，
 *      于是「结构一致性」从「要求模型遵守」变成「物理上无法违反」。
 *
 * 本模块提供三段：
 *   template() → 生成含全部 key、值为 null 的模板
 *   render()   → 校验填充结果并渲染最终页面（递归删空值、按 Schema 顺序输出）
 *   check()    → 只校验不渲染（CI 用）
 *
 * 刻意不引入 YAML 库：本插件是零 YAML 依赖的（见 skill-service 的 frontmatter 解析）。
 * 因此自带一个**受限 YAML 子集**的发射器与解析器，覆盖 Schema 用到的
 * 「映射 + 标量 + 标量数组」三种结构，遇到不支持的结构一律报错而非静默降级。
 */

import {
  getDomain,
  isSingleFormDomain,
  allFieldNames,
  RECEPTION_INTENTS,
  type DomainDef,
  type FieldDef,
  type Disclosure,
} from './wiki-schema.js'

/* ────────────────────────────── 类型 ────────────────────────────── */

/** 模板的值节点：null 表示「待模型填写」 */
export type FieldValue = string | string[] | null

/** 一个锁定模板：字段名 → 值（或分组 → 字段 → 值） */
export interface WikiTemplate {
  /** 页面形态 */
  type: '实体' | '概念'
  /** 所属领域 */
  domain: string
  /** 实体子类型（仅多形态域） */
  subtype?: string
  /** 顶层字段 → 值 */
  top: Record<string, FieldValue>
  /** 实体识别字段 → 值 */
  identity: Record<string, FieldValue>
  /** 分组名 → 字段名 → 值 */
  groups: Record<string, Record<string, FieldValue>>
  /** 意图字段 → 值 */
  intent: Record<string, FieldValue>
}

export interface ValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warn'
}

export interface RenderResult {
  ok: boolean
  /** 渲染出的完整页面（frontmatter + 正文）；不 ok 时为空串 */
  content: string
  issues: ValidationIssue[]
}

/* ────────────────────────── 顶层字段顺序 ────────────────────────── */

/**
 * 顶层字段的固定顺序 —— 与 Accio `_index.md`「三、顶层检索标签」一致。
 *
 * 顺序固定有两个好处：同一域的页面 diff 干净；模型只看前六行就能判断是否要打开。
 */
export const TOP_ORDER = [
  'type', 'title', 'description', 'resource', 'tags', 'timestamp',
  '所属领域', '实体子类型', '披露等级', '置信度说明',
]

/* ────────────────────────── 模板生成 ────────────────────────── */

/**
 * 生成锁定模板。
 *
 * 生成的模板包含该域**全部**字段（值一律 null），模型只能在值的位置填内容。
 * 这与「让模型自由写 YAML」的区别是根本性的：模板本身就是 Schema 的可执行形态。
 *
 * @param domain  域中文名
 * @param kind    页面形态（实体 / 概念）；概念页在概念域下，但可落在任意域的 concepts/ 目录
 * @param subtype 实体子类型（多形态域必传）
 */
export function buildTemplate(domain: string, kind: '实体' | '概念' = '实体', subtype?: string): WikiTemplate {
  const d = getDomain(domain)
  if (!d) throw new Error(`未知领域：${domain}（可选：商品/店铺/客户/经营/平台/资产/接待/概念）`)

  // 概念页统一按概念域字段编写，无论它落在哪个域的 concepts/ 目录
  const fieldDomain: DomainDef = kind === '概念' ? getDomain('概念')! : d

  if (kind === '实体') {
    if (!isSingleFormDomain(d.name)) {
      if (!subtype) throw new Error(`领域「${d.name}」有实体子类型，必须指定 subtype（可选：${d.subtypes.join('、')}）`)
      if (!d.subtypes.includes(subtype)) {
        throw new Error(`实体子类型「${subtype}」不在「${d.name}」的枚举内（可选：${d.subtypes.join('、')}）`)
      }
    } else if (subtype) {
      throw new Error(`领域「${d.name}」为单一形态域，不得指定实体子类型（Accio 验收项 3）`)
    }
  }

  const top: Record<string, FieldValue> = {}
  for (const n of TOP_ORDER) top[n] = null
  top.type = kind
  top.所属领域 = d.name
  if (kind === '实体' && !isSingleFormDomain(d.name) && subtype) top.实体子类型 = subtype

  const identity: Record<string, FieldValue> = {}
  for (const f of fieldDomain.identity) identity[f.name] = null

  const groups: Record<string, Record<string, FieldValue>> = {}
  for (const g of fieldDomain.groups) {
    const inner: Record<string, FieldValue> = {}
    for (const f of g.fields) inner[f.name] = null
    groups[g.name] = inner
  }

  const intent: Record<string, FieldValue> = {}
  for (const f of fieldDomain.intent) intent[f.name] = null

  return {
    type: kind,
    domain: d.name,
    ...(subtype ? { subtype } : {}),
    top, identity, groups, intent,
  }
}

/**
 * 把模板序列化成 YAML 文本（值一律为 null），供人工或模型查看「该填哪些 key」。
 */
export function templateToYaml(t: WikiTemplate): string {
  const lines: string[] = []
  for (const k of TOP_ORDER) {
    if (k === '实体子类型' && t.subtype === undefined) continue
    lines.push(`${k}: ${nf(t.top[k])}`)
  }
  lines.push('实体识别字段:')
  for (const [k, v] of Object.entries(t.identity)) lines.push(`  ${k}: ${nf(v)}`)
  lines.push('领域字段集:')
  for (const [g, fields] of Object.entries(t.groups)) {
    lines.push(`  ${g}:`)
    for (const [k, v] of Object.entries(fields)) lines.push(`    ${k}: ${nf(v)}`)
  }
  lines.push('意图字段集:')
  for (const [k, v] of Object.entries(t.intent)) lines.push(`  ${k}: ${nf(v)}`)
  return lines.join('\n')
}

/** 渲染单个值为 YAML 标量 */
function nf(v: FieldValue): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return v.length ? `[${v.map(quoteIfNeeded).join(', ')}]` : '[]'
  return quoteIfNeeded(v)
}

/**
 * 按需加引号 —— 这是 Accio 明确警告的 YAML 陷阱所在。
 *
 * Accio 原文：「Quote any value starting with "[", "{", "#", or "*",
 * or use | / > block scalars.」
 * 我们在这里**自动**加引号，从源头消除该类解析失败。
 */
function quoteIfNeeded(s: string): string {
  const str = String(s)
  if (!str) return '""'
  // 需要引号的情况：特殊起始字符、包含会破坏 YAML 的字符、前后空白、纯 null 字面量
  const risky =
    /^[[\]{}#*&!%@`|>'"-]/.test(str)
    || /[:#]\s/.test(str)
    || /\n/.test(str)
    || /^\s|\s$/.test(str)
    || /^(null|~|true|false|yes|no|on|off)$/i.test(str)
    || /^[-+]?\d+(\.\d+)?$/.test(str)
  if (!risky) return str
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/* ────────────────────────── 渲染与校验 ────────────────────────── */

/**
 * 校验模板的填充结果 —— 逐项对齐 Accio 的验收表。
 *
 * 关键检查：
 *   - Schema 外字段（自创字段名）
 *   - 必填项为空（title / resource / 披露等级 / 置信度说明 / 必有值锚点）
 *   - 实体子类型：多形态域必填且取值逐字落在枚举内；单一形态域不得出现
 *   - 接待域：接待意图必须且只填 1 个，取自受控词表 8 值，且意图码一一对应
 *   - 接待域：证据不足的策略不得标「启用」（Accio 接待域 L1 硬规则）
 *   - 机密字段不得进入对外页面
 */
export function validateTemplate(t: WikiTemplate): ValidationIssue[] {
  const d = getDomain(t.domain)
  if (!d) return [{ code: 'unknown_domain', message: `未知领域：${t.domain}`, severity: 'error' }]
  const issues: ValidationIssue[] = []

  // 概念页按概念域校验字段；实体页按所属域
  const fieldDomain = t.type === '概念' ? getDomain('概念')! : d
  const allowed = allFieldNames(fieldDomain)

  // ── ① Schema 外字段 ──
  for (const k of Object.keys(t.identity)) {
    if (!allowed.has(k)) issues.push({ code: 'unknown_field', message: `实体识别字段「${k}」不在 ${fieldDomain.name} 域 Schema 内`, severity: 'error' })
  }
  for (const [g, fields] of Object.entries(t.groups)) {
    if (!allowed.has(g)) issues.push({ code: 'unknown_group', message: `字段分组「${g}」不在 ${fieldDomain.name} 域 Schema 内`, severity: 'error' })
    for (const k of Object.keys(fields)) {
      if (!allowed.has(k)) issues.push({ code: 'unknown_field', message: `领域字段「${k}」不在 ${fieldDomain.name} 域 Schema 内`, severity: 'error' })
    }
  }
  for (const k of Object.keys(t.intent)) {
    if (!allowed.has(k)) issues.push({ code: 'unknown_field', message: `意图字段「${k}」不在 ${fieldDomain.name} 域 Schema 内`, severity: 'error' })
  }

  // ── ② 顶层必填项 ──
  const REQUIRED_TOP = ['type', 'title', 'description', 'resource', 'tags', 'timestamp', '所属领域', '披露等级', '置信度说明']
  for (const k of REQUIRED_TOP) {
    if (isEmpty(t.top[k])) issues.push({ code: 'missing_top_field', message: `顶层字段「${k}」必填且不能为空`, severity: 'error' })
  }

  // ── ③ 建页锚点：第一个识别字段为必有值（Accio：拿不到就放弃建页而非编造）──
  const anchor = fieldDomain.identity[0]
  if (anchor && t.type === '实体' && isEmpty(t.identity[anchor.name])) {
    issues.push({
      code: 'missing_anchor',
      message: `建页锚点「${anchor.name}」为空 —— 应按 Accio 规则放弃建页，而不是编造`,
      severity: 'error',
    })
  }

  // ── ④ 实体子类型 ──
  const subtypeVal = t.top.实体子类型
  if (t.type === '实体') {
    if (isSingleFormDomain(d.name)) {
      if (!isEmpty(subtypeVal)) {
        issues.push({ code: 'subtype_not_allowed', message: `领域「${d.name}」为单一形态域，不得出现「实体子类型」（Accio 验收项 3）`, severity: 'error' })
      }
    } else {
      if (isEmpty(subtypeVal)) {
        issues.push({ code: 'missing_subtype', message: `领域「${d.name}」必须填「实体子类型」，取值：${d.subtypes.join('、')}`, severity: 'error' })
      } else if (typeof subtypeVal === 'string' && !d.subtypes.includes(subtypeVal)) {
        issues.push({
          code: 'invalid_subtype',
          message: `「实体子类型」取值「${subtypeVal}」不在枚举内（可选：${d.subtypes.join('、')}）—— 自创取值或近义改写一律不合格`,
          severity: 'error',
        })
      }
    }
  }

  // ── ⑤ 接待域两条 L1 硬规则 ──
  if (fieldDomain.name === '接待') {
    const intentVal = t.intent.接待意图
    const codeVal = t.intent.接待意图码
    const intentStr = typeof intentVal === 'string' ? intentVal : ''
    if (!intentStr) {
      issues.push({ code: 'missing_reception_intent', message: '接待域「接待意图」必填，且只能填 1 个', severity: 'error' })
    } else {
      const hit = RECEPTION_INTENTS.find(i => i.label === intentStr)
      if (!hit) {
        issues.push({
          code: 'invalid_reception_intent',
          message: `「接待意图」取值「${intentStr}」不在受控词表的 8 个值内（${RECEPTION_INTENTS.map(i => i.label).join('、')}）`,
          severity: 'error',
        })
      } else if (typeof codeVal === 'string' && codeVal && codeVal !== hit.code) {
        issues.push({
          code: 'intent_code_mismatch',
          message: `「接待意图码」为「${codeVal}」，与「接待意图」=「${intentStr}」应对应的「${hit.code}」不匹配`,
          severity: 'error',
        })
      }
    }
    // 证据不足 / 低置信度不得标为启用
    const status = t.groups['策略定义']?.策略状态
    const confidence = t.top.置信度说明
    if (status === '启用' && typeof confidence === 'string' && /不足|低|待补充|未验证|推测/.test(confidence)) {
      issues.push({
        code: 'weak_strategy_marked_enabled',
        message: `「置信度说明」显示证据不足（${confidence}），但「策略状态」标为「启用」—— 证据不足的策略只能停在「候选」（Accio 接待域 L1 硬规则）`,
        severity: 'error',
      })
    }
  }

  // ── ⑥ 机密字段不得进入对外页面 ──
  if (t.top.披露等级 === '可对外') {
    for (const g of fieldDomain.groups) {
      for (const f of g.fields) {
        if (f.disclosure === '机密' && !isEmpty(t.groups[g.name]?.[f.name])) {
          issues.push({
            code: 'classified_in_public_page',
            message: `字段「${f.name}」是机密字段，不得出现在「可对外」页面`,
            severity: 'error',
          })
        }
      }
    }
  }

  return issues
}

function isEmpty(v: FieldValue | undefined): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.length === 0
  return String(v).trim() === ''
}

/* ────────────────────────── 渲染 ────────────────────────── */

/**
 * 渲染最终页面 = 校验后的 frontmatter + 正文。
 *
 * 「递归删除空值」是 Accio render 的关键行为：模板里模型没填的字段
 * **整行不写**，而不是留 `null`。这让页面干净，也避免 `null` 被误读成
 * 「已确认该字段为空」——两者语义完全不同（缺席 vs 空）。
 */
export function renderPage(t: WikiTemplate, body: string, opts?: { skipValidation?: boolean }): RenderResult {
  const issues = opts?.skipValidation ? [] : validateTemplate(t)
  const errors = issues.filter(i => i.severity === 'error')
  if (errors.length) {
    return { ok: false, content: '', issues }
  }

  const fieldDomain = t.type === '概念' ? getDomain('概念')! : getDomain(t.domain)!
  const lines: string[] = ['---']

  // 顶层：按固定顺序，空值整行省略
  for (const k of TOP_ORDER) {
    if (k === '实体子类型') {
      if (t.subtype === undefined && isEmpty(t.top[k])) continue
    }
    const v = t.top[k]
    if (isEmpty(v)) continue
    lines.push(`${k}: ${nf(v)}`)
  }

  // 实体识别字段块
  const idLines = renderBlock(t.identity)
  if (idLines.length) {
    lines.push('实体识别字段:')
    lines.push(...idLines)
  }

  // 领域字段集（按 Schema 分组顺序、组内字段顺序输出）
  const groupLines: string[] = []
  for (const g of fieldDomain.groups) {
    const inner = t.groups[g.name]
    if (!inner) continue
    const inLines = renderBlock(inner, '    ')
    if (!inLines.length) continue          // 整组为空则整组省略
    groupLines.push(`  ${g.name}:`)
    groupLines.push(...inLines)
  }
  if (groupLines.length) {
    lines.push('领域字段集:')
    lines.push(...groupLines)
  }

  // 意图字段集
  const intentLines = renderBlock(t.intent)
  if (intentLines.length) {
    lines.push('意图字段集:')
    lines.push(...intentLines)
  }

  lines.push('---')
  const content = `${lines.join('\n')}\n\n${body.trim()}\n`
  return { ok: true, content, issues }
}

/** 渲染一个字段块（跳过空值） */
function renderBlock(fields: Record<string, FieldValue>, indent = '  '): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (isEmpty(v)) continue
    out.push(`${indent}${k}: ${nf(v)}`)
  }
  return out
}

/* ────────────────────────── 只校验不渲染（CI 用） ────────────────────────── */

/**
 * 校验一个**已有的** Wiki 页面文本（而非模板）。
 *
 * 用于检查模型直接手写、绕过模板产出的历史页面 —— 这类页面正是
 * Accio 验收表要拦的对象。这里只做能静态判断的部分（顶层字段、字段名、枚举），
 * 深层结构差异需要完整 YAML 解析，超出本模块范围。
 */
export function checkPageText(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return [{ code: 'missing_frontmatter', message: '页面缺少 frontmatter', severity: 'error' }]
  const fm = m[1]
  const body = text.slice(m[0].length)

  // 必填顶层字段
  for (const k of ['type', 'title', 'description', 'resource', 'tags', 'timestamp', '所属领域', '披露等级', '置信度说明']) {
    if (!new RegExp(`^${k}\\s*:\\s*\\S`, 'm').test(fm)) {
      issues.push({ code: 'missing_top_field', message: `顶层字段「${k}」缺失或为空`, severity: 'error' })
    }
  }

  // Accio 点名要拦的废弃字段
  for (const bad of ['页面类型', '来源文件', '更新时间', '页面编号', '证据次数']) {
    if (new RegExp(`^\\s*${bad}\\s*:`, 'm').test(fm)) {
      issues.push({
        code: 'deprecated_field',
        message: `字段「${bad}」已废弃（Accio 验收项 4 点名）—— 应并入对应顶层字段后删除`,
        severity: 'error',
      })
    }
  }

  // frontmatter 内不得出现 [src]（页级溯源看 resource，段落级才用 [src]）
  if (/\[src\s*:/.test(fm)) {
    issues.push({ code: 'src_in_frontmatter', message: 'frontmatter 内不得出现 [src]（页级来源用顶层 resource）', severity: 'error' })
  }

  // 域字段块存在性
  if (!/^\s*实体识别字段\s*:/m.test(fm) && !/^\s*领域字段集\s*:/m.test(fm)) {
    issues.push({
      code: 'no_domain_blocks',
      message: '缺少「实体识别字段」与「领域字段集」块 —— 只有顶层字段的页面属空壳，不合格',
      severity: 'error',
    })
  }

  // title 应与正文 H1 一致
  const titleM = fm.match(/^title\s*:\s*(.+)$/m)
  const h1M = body.match(/^#\s+(.+)$/m)
  if (titleM && h1M) {
    const t = titleM[1].trim().replace(/^["']|["']$/g, '')
    const h = h1M[1].trim()
    if (t !== h) {
      issues.push({ code: 'title_h1_mismatch', message: `title「${t}」与正文 H1「${h}」不一致`, severity: 'error' })
    }
  }

  return issues
}

/** 披露等级是否允许进入对外回答 */
export function canExpose(level: Disclosure | string | null | undefined): boolean {
  return level === '可对外'
}

/** 供工具输出：把模板渲染成「填值指引」 */
export function templateGuide(t: WikiTemplate): string {
  const fieldDomain = t.type === '概念' ? getDomain('概念')! : getDomain(t.domain)!
  const lines = [
    `# 锁定模板（${t.domain} / ${t.type}${t.subtype ? ` / ${t.subtype}` : ''}）`,
    '',
    '规则：只替换下面的 null 为有依据的值；**不要**增加、删除、改名或移动任何 key。',
    '无依据的字段保持 null —— 渲染时会整行省略（缺席 ≠ 空值）。',
    '',
    `## 顶层字段（必填：${['title', 'description', 'resource', 'tags', 'timestamp', '披露等级', '置信度说明'].join(' / ')}）`,
    ...TOP_ORDER.filter(k => !(k === '实体子类型' && t.subtype === undefined)).map(k => `- ${k}: ${t.top[k] ?? '待填'}`),
    '',
    '## 实体识别字段（第一项为建页锚点，拿不到就放弃建页）',
    ...fieldDomain.identity.map(f => `- ${f.name}〖${dutyLabel(f.duty)}〗：${f.desc}`),
    '',
    '## 领域字段集',
  ]
  for (const g of fieldDomain.groups) {
    lines.push(`### ${g.name}`)
    for (const f of g.fields) {
      lines.push(`- ${f.name}〖${dutyLabel(f.duty)}〗${f.disclosure ? `〖${f.disclosure}〗` : ''}：${f.desc}`)
    }
  }
  lines.push('', '## 意图字段集')
  for (const f of fieldDomain.intent) lines.push(`- ${f.name}〖${dutyLabel(f.duty)}〗：${f.desc}`)
  return lines.join('\n')
}

function dutyLabel(d: FieldDef['duty']): string {
  if (d === 'required-value') return '必有值'
  if (d === 'must-grab') return '必抓'
  if (d === 'required-block') return '必出现'
  return '可选'
}
