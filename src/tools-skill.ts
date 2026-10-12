/**
 * 技能类工具（host 半区）。
 *
 * 职责：定义 6 个「技能清单 / 详情 / 执行 / 报告生成 / 坑位记忆」工具：
 *   dsagent_list_skills / dsagent_get_skill_detail / dsagent_execute_skill /
 *   dsagent_generate_report / dsagent_pitfalls / dsagent_chat_with_context
 *
 * 注意：executeSkillCore 仍是 index.ts 的闭包（依赖 triggers 重建、账号绑定上下文、
 * 坑位惰性提示、网关 env 三件套等可变闭包状态），这里以函数引用注入 —— 不复制实现。
 *
 * 物理隔离：本文件不 import index.ts；服务与函数由 index.ts 接线时注入
 * （仿 http-routes.ts 的依赖注入模式）。
 */
import type { AccountService } from './services/account-service.js'
import type { SkillService } from './services/skill-service.js'
import type { PitfallMemory } from './services/pitfall-memory.js'
import { parseArgString } from './services/skill-service.js'
import { exportPitfallDraft, PITFALL } from './services/pitfall-memory.js'
import { defineTool, renderToolOutput, agentIdOf } from './tool-runtime.js'

/** 插件依赖注入：index.ts apply() 内创建的服务与函数，全部从这里进 */
export interface SkillToolsDeps {
  /** 技能服务（list/get/supportsReport/runReport/patchOf） */
  skill: SkillService
  /** 账号服务（isBound 授权判定） */
  account: AccountService
  /** 坑位记忆（list/listConfirmed/activeFor/stats/clear） */
  pitfalls: PitfallMemory
  /**
   * 技能执行核心（index.ts 的闭包）：dsagent_execute_skill 与契约工具共用。
   * 以函数引用注入，避免把闭包依赖（触发注册表、账号绑定、坑位提示、网关 env）
   * 复制到本文件。闭包无法用 typeof import() 引用，这里内联其调用签名。
   */
  executeSkillCore: (opts: {
    skillId: string
    requestStr: string
    explicitArgs?: string[]
    chosenShopKey: string
    agentId: string
    fromContract: boolean
    invokedTool: string
    /** 契约工具路径下的原始具名参数 —— 供 tool_triggers 的 args 条件匹配使用 */
    contractArgs?: Record<string, unknown>
  }) => Promise<any>
  /** 本地代理网关就绪 Promise（generate_report 需要网关 env 三件套） */
  gatewayReady: Promise<{ url: string; close(): void }>
  /** 技能根目录（generate_report 的 DSAGENT_SKILL_ROOT env） */
  skillRoot: string
}

/** 构建技能类工具定义 */
export function buildSkillTools(deps: SkillToolsDeps): import('@deepseek-ai/dsh-tools').ToolDefinition[] {
  const { skill, account, pitfalls, executeSkillCore, gatewayReady, skillRoot } = deps

  return [
    defineTool({
      name: 'dsagent_list_skills',
      description: '列出 DSAgent 插件管理的业务技能。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤' },
        onlyEnabled: { type: 'boolean', description: '可选，仅返回已启用技能' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await skill.list({ platform: args.platform, onlyEnabled: args.onlyEnabled })
        if (!rows.length) return { text: '没有匹配的业务技能。', count: 0 }
        return {
          text: rows.map(s => {
            const patch = s.hasPatch ? ' [有补丁]' : ''
            const used = s.useCount > 0 ? ` | 用过 ${s.useCount} 次` : ''
            return `- ${s.name}（${s.id}）| ${s.enabled ? '已启用' : '已停用'} | ${s.platform} | 质量 ${s.quality.toFixed(2)}${patch}${used}`
          }).join('\n'),
          count: rows.length,
        }
      },
    }),

    defineTool({
      name: 'dsagent_get_skill_detail',
      description: '查看单个业务技能详情，含文档质量分与校验问题清单。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const s = await skill.get(args.id)
        if (!s) return { text: `未找到技能：${args.id}` }
        const bound = s.platform === 'common' ? true : await account.isBound(s.platform)

        // 质量诊断：把 error（结构性缺陷）与 warn（可改进）分开列，
        // 让模型/用户能直接知道这个技能差在哪、怎么改。
        const errors = s.issues.filter(i => i.severity === 'error')
        const warns = s.issues.filter(i => i.severity === 'warn')
        const qualityLines: string[] = [`文档质量：${s.quality.toFixed(2)} / 1.00`]
        if (errors.length) {
          qualityLines.push(`结构性问题（${errors.length}）：`)
          qualityLines.push(...errors.map(i => `  ✗ ${i.message}`))
        }
        if (warns.length) {
          qualityLines.push(`可改进（${warns.length}）：`)
          qualityLines.push(...warns.map(i => `  • ${i.message}`))
        }
        if (!errors.length && !warns.length) qualityLines.push('文档结构完整，无校验问题。')

        // 现场修正层：patch 存在时给出内容，因为它是「与主文档冲突时以它为准」的部分
        const patchLines: string[] = []
        if (s.hasPatch) {
          const p = await skill.patchOf(s.id)
          patchLines.push('', `现场修正（SKILL.patch.md${p?.truncated ? '，已截断' : ''}）：`, p?.content || '（读取失败）')
        }

        return {
          text: [
            `技能：${s.name}（${s.id}）`,
            `版本：${s.version}　风险：${s.risk}`,
            `状态：${s.enabled ? '已启用' : '已停用'}`,
            `所需平台：${s.platform === 'common' ? '无' : s.platform}`,
            `授权：${bound ? '已授权' : '未授权'}`,
            `使用：${s.useCount > 0 ? `成功 ${s.useCount} 次` : '尚未成功使用过'}`,
            ...qualityLines,
            ...patchLines,
            '', s.description,
          ].join('\n'),
        }
      },
    }),

    defineTool({
      name: 'dsagent_execute_skill',
      description: '执行指定技能并返回结果。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
        request: { type: 'string', required: true, description: '自然语言描述要做什么' },
        args: { type: 'string', description: '命令行参数（可选）。技能需要参数时必填，如 "手机壳" 或 "--keyword 手机壳 --page 2"' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        console.log(`[dsagent-execute] execute() called with args=${JSON.stringify(args)}`)
        // 当前会话（= 智能体）ID：账号绑定的维度就是它；account 为多账号待选时由模型回传的主键
        return executeSkillCore({
          skillId: String(args.id ?? ''),
          requestStr: String(args.request ?? ''),
          explicitArgs: args.args ? parseArgString(String(args.args)) : undefined,
          chosenShopKey: args.account ? String(args.account).trim() : '',
          agentId: agentIdOf(exec),
          fromContract: false,
          invokedTool: 'dsagent_execute_skill',
        })
      },
    }),

    defineTool({
      name: 'dsagent_generate_report',
      description: '基于 AI 洞察 Markdown 文件生成 HTML 报告。',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能 id' },
        insightsMdPath: { type: 'string', required: true, description: '洞察 Markdown 文件路径' },
        seedKeyword: { type: 'string', description: '种子关键词，可选' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        const skillId = String(args.skillId ?? '')
        const insightsMdPath = String(args.insightsMdPath ?? '')
        const seedKeyword = args.seedKeyword ? String(args.seedKeyword) : undefined

        const supports = await skill.supportsReport(skillId)
        if (!supports) return { ok: false, text: `技能「${skillId}」不支持报告生成。`, skillId } as any

        const gw = await gatewayReady
        const env: Record<string, string> = {
          DSAGENT_WORKSPACE: process.env.DSAGENT_WORKSPACE ?? process.cwd(),
          DSAGENT_SKILL_ROOT: skillRoot,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          DSCONNECT_URL: gw.url,
          DSCONNECT_TOKEN: 'local',
          DSCONNECT_AGENT_ID: agentIdOf(exec),
        }

        const result = await skill.runReport(skillId, insightsMdPath, { seedKeyword }, env)
        if (!result.ok) {
          return { ok: false, text: `报告生成失败：${result.message || result.stderr || '未知错误'}`, exitCode: result.exitCode, skillId } as any
        }

        const textParts: string[] = ['报告生成成功！']
        if (result.reportPath) textParts.push(`\n\n📊 HTML 报告：${result.reportPath}`)
        if (result.csvPath) textParts.push(`\n📎 CSV：${result.csvPath}`)

        return { ok: true, text: textParts.join(''), exitCode: result.exitCode, skillId, reportPath: result.reportPath ?? null, csvPath: result.csvPath ?? null } as any
      },
    }),

    defineTool({
      name: 'dsagent_pitfalls',
      description: '查看本机累积的「平台坑位记忆」：从真实执行失败中统计出的可复现问题'
        + '（证据 ≥3 次才计入），可导出草稿供人工审核后沉淀到 SKILL.patch.md。',
      parameters: {
        skillId: { type: 'string', description: '可选，只看该技能相关的坑位' },
        platform: { type: 'string', description: '可选，只看该平台的坑位（如 taobao / pdd_mms）' },
        mode: { type: 'string', description: '可选：summary（默认，概览）/ all（全部记录）/ draft（导出可粘贴的草稿）' },
        clear: { type: 'boolean', description: '可选，清空全部坑位记录（谨慎使用）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        if (args.clear === true) {
          await pitfalls.clear()
          return { ok: true, text: '坑位记忆已清空。' }
        }
        const mode = String(args.mode ?? 'summary').trim()
        const skillId = args.skillId ? String(args.skillId).trim() : undefined
        const platform = args.platform ? String(args.platform).trim() : undefined

        if (mode === 'all') {
          const all = await pitfalls.list()
          if (!all.length) return { text: '暂无坑位记录。', count: 0 }
          return {
            text: all.map(e =>
              `- [${e.confirmed ? '已确认' : '观察中'}] ${e.platform} / ${e.failureKind}　复现 ${e.count} 次\n`
              + `  签名：${e.signature || '(无)'}\n`
              + `  最近：${new Date(e.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')}　涉及：${e.skillIds.join('、') || '—'}`,
            ).join('\n'),
            count: all.length,
          }
        }

        if (mode === 'draft') {
          const entries = skillId
            ? (await pitfalls.list()).filter(e => e.skillIds.includes(skillId) && e.confirmed)
            : await pitfalls.listConfirmed()
          return {
            text: exportPitfallDraft(entries, skillId ? { skillId } : undefined),
            count: entries.length,
            hint: '审核后可直接粘贴到对应技能的 SKILL.patch.md。',
          }
        }

        // summary：默认只给「当前有效」的坑位（已确认 + 未陈旧）
        const active = await pitfalls.activeFor({ skillId, platform })
        const st = await pitfalls.stats()
        if (!active.length) {
          return {
            text: [
              '当前没有达到阈值的活跃坑位。',
              '',
              `统计：共 ${st.total} 条记录，其中已确认 ${st.confirmed} 条，已陈旧（>${PITFALL.STALE_DAYS} 天未复现）${st.stale} 条。`,
              '',
              `坑位在技能失败时自动累积，同一问题复现 ${PITFALL.PROMOTE_THRESHOLD} 次后才会进入提示。`,
              '用 mode=all 查看全部记录（含观察中的），用 mode=draft 导出可粘贴的草稿。',
            ].join('\n'),
            ...st,
          }
        }
        return {
          text: [
            `活跃坑位 ${active.length} 条（已确认 + ${PITFALL.STALE_DAYS} 天内复现过）：`,
            '',
            ...active.map(e =>
              `- [${e.platform} / ${e.failureKind}] 复现 ${e.count} 次，最近 ${new Date(e.lastSeenAt).toISOString().slice(0, 10)}\n`
              + `  ${e.signature || '(无签名)'}`,
            ),
            '',
            `总计 ${st.total} 条记录 / 已确认 ${st.confirmed} 条。用 mode=draft 导出草稿沉淀到 SKILL.patch.md。`,
          ].join('\n'),
          active,
          ...st,
        }
      },
    }),

    defineTool({
      name: 'dsagent_chat_with_context',
      description: '基于技能执行结果生成自然语言回复。',
      parameters: {
        skillResult: { type: 'string', required: true, description: '技能返回结果' },
        userQuestion: { type: 'string', required: true, description: '用户的问题' },
        style: { type: 'string', description: '回复风格：brief/detailed/report' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        let data: unknown
        try { data = JSON.parse(args.skillResult) } catch { data = args.skillResult }
        const style = args.style ?? 'brief'
        const styleGuide = style === 'report' ? '请以结构化报告格式输出。' : style === 'detailed' ? '请详细分析数据。' : '请简洁直接回答。'
        const dataSummary = typeof data === 'object' && data !== null ? JSON.stringify(data, null, 2).slice(0, 4000) : String(data).slice(0, 4000)
        return { text: `用户问题：${args.userQuestion}\n\n技能数据：\n${dataSummary}\n\n回复要求：${styleGuide}`, style, hasData: data !== null && data !== '' }
      },
    }),
  ]
}
