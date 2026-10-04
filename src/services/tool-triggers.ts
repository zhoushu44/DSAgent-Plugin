/**
 * 工具触发注册表 —— 吸收 Accio 的 ToolTriggerRegistry。
 *
 * 解决的问题（见 ACCIO-REVERSE-ANALYSIS.md §3）：
 *   本插件的技能路由是「N 个工具常驻 system prompt + M 个技能描述全量注入」。
 *   对于「包了一层工具」的技能（如 dsagent_product_reviews），模型在调用前**不知道**
 *   该技能 SKILL.md 里沉淀的坑位信息（时间预算、域名要求、风控处置），
 *   这些信息只有加载 SKILL.md 才可见 —— 而加载动作本身需要一个触发信号。
 *
 * Accio 的做法是把「哪个工具 + 什么参数 → 该读哪个技能」变成**声明式数据**，
 * 在工具被调用的瞬间注入提示，逼模型先读 SKILL.md。本模块是该机制的移植，
 * 并补了两点本项目的实际需要：
 *
 *   1. **内置规则兜底**：无需改任何技能的 SKILL.md，插件即可自带风控等通用规则。
 *      技能作者可在自己 frontmatter 里写 tool_triggers 叠加（见 §3 的写法示例）。
 *   2. **每会话去重**：同一技能在同一会话里只提示一次，避免多轮对话反复刷屏。
 *
 * 去重状态是进程内的（会话级），不落盘：提示的有效期就是这一次会话上下文。
 */

import {
  parseToolTriggers,
  matchesTriggerArgs,
  type ToolTrigger,
} from './skill-quality.js'

/** 注册表里的一条规则（触发条件 + 被提示的技能） */
export interface TriggerRule {
  /** 被提示的技能 id；内置规则用 `builtin:` 前缀，不与真实技能 id 冲突 */
  skillId: string
  skillDescription: string
  /** 技能 SKILL.md 绝对路径；内置规则为空串 */
  skillPath: string
  tool: string
  /** 入参匹配条件，值可为 `/pattern/flags` 正则写法 */
  args?: Record<string, string>
  origin: 'skill' | 'builtin'
  /** 内置规则专用：直接作为提示正文，而非「去读某个文件」 */
  hint?: string
}

/** 命中一条规则后返回给调用方的结果 */
export interface TriggerHit {
  skillId: string
  skillDescription: string
  skillPath: string
  origin: 'skill' | 'builtin'
  hint?: string
}

/** 待注册的技能元数据（由 skill-service 扫描后提供） */
export interface TriggerSourceSkill {
  id: string
  description: string
  /** SKILL.md 绝对路径 */
  skillPath: string
  /** frontmatter 原文（用于提取 tool_triggers） */
  frontmatter: string
}

/** 内置规则的 id 前缀 */
export const BUILTIN_PREFIX = 'builtin:'

/**
 * 插件内置触发规则 —— 技能作者无需写任何声明即可生效。
 *
 * 每条规则都对应 FIX-LOG 里一个真实踩过的坑，目的是让模型在**第一次**
 * 调用相关工具时就看到处置办法，而不是失败后才发现 SKILL.md 里写了。
 */
const BUILTIN_RULES: TriggerRule[] = [
  {
    skillId: `${BUILTIN_PREFIX}risk-control`,
    skillDescription: '风控处置预提示',
    skillPath: '',
    tool: 'dsagent_execute_skill',
    // 淘宝 / 天猫 / 生意参谋 / 阿里系全家桶 —— 这些技能最常返回 risk_control
    args: {
      id: '/^(?:product-reviews|product-wdj|market-analysis|taobao-publish|'
        + 'keyword-assistant|keyword-traffic|market-trend|sycm-customer|store-patrol-manager|'
        + 'competitor-indicator|competitor-strategy-comparison|category-structure-diagnosis|'
        + 'product-layering-diagnosis|shop-promotion-diagnosis|'
        + 'xianyu-crawl|xianyu-publish|xiaohongshu-crawl|douyin-crawl)$/',
    },
    origin: 'builtin',
    hint: [
      '【风控预提示】本技能可能返回 failureKind=risk_control（阿里系技能尤为常见）。',
      '若命中：**不要**重复调用原技能 —— 先调 dsagent_risk_verify(platform=对应平台) 拉起验证页，',
      '用户完成滑块后凭证会自动写回账号并解除冷却，**然后**再重试原技能。',
      '例外：拼多多发布（dsagent_pdd_publish）的滑块是页内内联的，不能用 dsagent_risk_verify，',
      '需在弹出的可见窗口内手动拖动，超时才报 risk_control。',
      '风控处置办法详见对应技能的 SKILL.md「错误处理」小节。',
    ].join('\n'),
  },
  {
    skillId: `${BUILTIN_PREFIX}taobao-risk-verify`,
    skillDescription: '淘宝验证码兜底提示',
    skillPath: '',
    tool: 'dsagent_risk_verify',
    origin: 'builtin',
    hint: [
      '【验证后必须重试】滑块通过后不要停在验证这一步 —— 凭证已写回账号、冷却已解除，',
      '请立即重新调用刚才失败的那个技能（用同样的参数），把结果交付给用户。',
    ].join('\n'),
  },
]

/**
 * 工具触发注册表。
 *
 * 用法：
 *   const reg = createToolTriggerRegistry()
 *   reg.rebuild(skills)                       // 扫描后重建
 *   const hits = reg.match('dsagent_execute_skill', { id: 'product-wdj' }, sessionKey)
 *   if (hits.length) text += reg.formatHint(hits)
 */
export function createToolTriggerRegistry() {
  /** tool 名 → 规则列表（与 Accio 一样按工具名分桶） */
  let rules = new Map<string, TriggerRule[]>()
  /** `${sessionKey}::${skillId}` 已提示过的集合 */
  const notified = new Set<string>()
  /** 诊断统计 */
  let lastStats = { skills: 0, declared: 0, builtin: 0, invalidRegex: 0, dropped: 0 }

  function put(rule: TriggerRule) {
    const list = rules.get(rule.tool)
    if (list) list.push(rule)
    else rules.set(rule.tool, [rule])
  }

  return {
    /**
     * 用最新扫描结果重建注册表。
     *
     * 全量重建而非增量：技能数量在几十个量级，重建成本可忽略，
     * 而增量更新要处理「技能被删 / 被停用」的失效清理，容易漏。
     */
    rebuild(skills: TriggerSourceSkill[]): void {
      rules = new Map()
      let declared = 0
      let invalidRegex = 0
      let dropped = 0

      for (const s of skills) {
        let triggers: ToolTrigger[] = []
        try {
          triggers = parseToolTriggers(s.frontmatter)
        } catch {
          dropped++
          continue
        }
        for (const t of triggers) {
          // 校验规则里的正则合法性；非法则丢弃该规则（与 Accio「正则非法 → 不匹配」同取向，
          // 但更进一步不让坏规则进入注册表，避免每次匹配都要重复捕获异常）
          let usable = true
          for (const v of Object.values(t.args ?? {})) {
            const m = v.match(/^\/(.+)\/([gimsuy]*)$/)
            if (!m) continue
            try { new RegExp(m[1], m[2]) } catch { usable = false; invalidRegex++ }
          }
          if (!usable) continue
          put({
            skillId: s.id,
            skillDescription: s.description,
            skillPath: s.skillPath,
            tool: t.tool,
            args: t.args,
            origin: 'skill',
          })
          declared++
        }
      }

      for (const b of BUILTIN_RULES) put(b)

      lastStats = {
        skills: skills.length,
        declared,
        builtin: BUILTIN_RULES.length,
        invalidRegex,
        dropped,
      }
      console.log(
        `[dsagent] ToolTriggerRegistry 重建：${skills.length} 个技能贡献 ${declared} 条声明规则`
        + ` + ${BUILTIN_RULES.length} 条内置规则`
        + (invalidRegex ? `（丢弃 ${invalidRegex} 条非法正则）` : '')
        + (dropped ? `（${dropped} 个技能 frontmatter 解析失败）` : ''),
      )
    },

    /**
     * 匹配一次工具调用。
     *
     * @param toolName 工具名，如 dsagent_execute_skill
     * @param callArgs 工具入参
     * @param sessionKey 会话键（用于去重）；不传则不去重
     * @returns 命中的规则（每个技能至多一条，与 Accio 的 `seen` 语义一致）
     */
    match(toolName: string, callArgs: Record<string, unknown>, sessionKey?: string): TriggerHit[] {
      const list = rules.get(toolName)
      if (!list?.length) return []
      const hits: TriggerHit[] = []
      const seen = new Set<string>()
      for (const r of list) {
        if (seen.has(r.skillId)) continue
        if (r.args && !matchesTriggerArgs(r.args, callArgs, (pat) => {
          console.warn(`[dsagent] tool_triggers 非法正则：${pat}`)
        })) continue
        // 会话级去重：同一技能在同一会话只提示一次
        if (sessionKey) {
          const key = `${sessionKey}::${r.skillId}`
          if (notified.has(key)) continue
          notified.add(key)
        }
        seen.add(r.skillId)
        hits.push({
          skillId: r.skillId,
          skillDescription: r.skillDescription,
          skillPath: r.skillPath,
          origin: r.origin,
          hint: r.hint,
        })
      }
      return hits
    },

    /**
     * 把命中结果渲染成注入给模型的提示块。
     *
     * 分两类渲染（对齐 Accio 的 formatHint）：
     *   - 有 skillPath 的：让模型去读该文件拿完整说明
     *   - 无 skillPath 的（内置提示）：直接把 hint 正文给出
     */
    formatHint(hits: TriggerHit[]): string {
      if (!hits.length) return ''
      const parts: string[] = []
      const fileHits = hits.filter(h => h.skillPath)
      const inlineHits = hits.filter(h => !h.skillPath)

      if (fileHits.length) {
        parts.push('---')
        parts.push('本次操作与以下技能相关：')
        parts.push('')
        for (const h of fileHits) {
          parts.push(`- ${h.skillId}：${h.skillDescription}`)
        }
        parts.push('')
        parts.push('继续操作前，先读取对应技能文件获取完整说明：')
        for (const h of fileHits) parts.push(`  ${h.skillPath}`)
      }

      for (const h of inlineHits) {
        if (parts.length) parts.push('')
        parts.push('---')
        if (h.hint) parts.push(h.hint)
      }

      return parts.join('\n')
    },

    /** 清空会话级去重状态（不传 sessionKey 则全清） */
    resetSession(sessionKey?: string): void {
      if (!sessionKey) { notified.clear(); return }
      const prefix = `${sessionKey}::`
      for (const key of [...notified]) {
        if (key.startsWith(prefix)) notified.delete(key)
      }
    },

    /** 诊断信息 */
    stats() {
      return { ...lastStats, notified: notified.size }
    },
  }
}

export type ToolTriggerRegistry = ReturnType<typeof createToolTriggerRegistry>
