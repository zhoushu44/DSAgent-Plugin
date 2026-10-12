/**
 * 工具运行时公共层（host 半区）。
 *
 * 职责：工具定义包装器与返回值清洗 —— 这是全插件唯一的工具返回出口：
 *   - defineTool：包装 DSH 的 defineTool，execute 返回值统一过 lossless JSON 清洗，
 *     新增工具无需关心序列化约束
 *   - renderToolOutput：统一 render（text 优先 / JSON.stringify 兜底 / failureKind 追加）
 *   - agentIdOf：从工具运行上下文取当前会话（= 智能体）ID
 *   - spillPayload：技能 payload 过大时落盘
 *
 * 物理隔离：本文件不 import index.ts，也不被注入任何服务 —— 全部是纯函数/常量，
 * 各 tools-*.ts 与 index.ts 直接 import 共用。
 */
import { defineTool as dshDefineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { smartTruncateJsonAware } from './services/smart-truncate.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 单次工具回传给模型的文本上限（字符）。过小会腰斩数据型技能的 payload */
export const TOOL_TEXT_LIMIT = 32_000

/**
 * 清洗字符串，移除 lossless JSON 不支持的字符：
 * - 控制字符 U+0000-U_001F（标准 JSON 规范不允许未转义的控制字符）
 * - 孤立的代理对（lone surrogates U+D800-U+DFFF，lossless JSON 拒绝）
 * - BOM、零宽字符等不可见字符
 * - 截断过长的文本（避免序列化超大 payload）
 */
export function sanitizeForLosslessJson(s: string): string {
  // 移除控制字符（保留 \t \n \r）
  let cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // 移除孤立的代理对字符（lossless JSON 不支持）
  cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '')
  // 移除 BOM 和零宽字符
  cleaned = cleaned.replace(/\uFEFF/g, '').replace(/[\u200B-\u200D\u2060]/g, '')
  // 截断过长文本：智能头尾保留（尾部常有 summary/total/结论），见 smart-truncate.ts
  if (cleaned.length > TOOL_TEXT_LIMIT) cleaned = smartTruncateJsonAware(cleaned, TOOL_TEXT_LIMIT)
  return cleaned
}

/**
 * 把失败类型显式写进回传给模型的文本。
 *
 * 工具返回值里的 `failureKind` 是结构化字段，但模型只能看到 render 后的文本，
 * 若不拼接就会被丢弃——模型于是只能靠猜（实测出现过「结果中没有出现名为
 * failureKind 的字段」的误判）。这里统一把失败类型追加到文案末尾。
 */
export function withFailureKind(v: unknown, text: string): string {
  if (typeof v !== 'object' || v === null) return text
  const kind = (v as { failureKind?: unknown }).failureKind
  if (typeof kind !== 'string' || !kind) return text
  if (text.includes(kind)) return text
  return `${text}\n\n[failureKind] ${kind}`
}

/**
 * 工具返回值序列化：
 * execute 返回的对象有 text 字段（人类可读摘要），优先取 text；
 * 其他对象用 JSON.stringify 保证不丢信息；原始类型直接 String()。
 * 所有输出都经过 sanitizeForLosslessJson 清洗，确保 Cordis 的 lossless JSON 序列化不会失败。
 */
export function renderToolOutput(_a: unknown, v: unknown) {
  if (v == null) return [{ type: 'text' as const, text: '' }]
  if (typeof v === 'string') return [{ type: 'text' as const, text: sanitizeForLosslessJson(v) }]
  if (typeof v === 'object' && v !== null && 'text' in v && typeof (v as any).text === 'string' && (v as any).text) {
    return [{ type: 'text' as const, text: sanitizeForLosslessJson(withFailureKind(v, (v as any).text)) }]
  }
  let jsonStr: string
  try { jsonStr = JSON.stringify(v) } catch { jsonStr = String(v) }
  return [{ type: 'text' as const, text: sanitizeForLosslessJson(jsonStr) }]
}

/**
 * 深度清洗工具返回值，确保满足 Cordis 的 lossless JSON 约束。
 *
 * DSH 用 `walkJsonValue` 校验 `execute` 的**原始返回值**（不是 render 后的文本），
 * 遇到 undefined / NaN / Infinity / -0 / BigInt / 函数 / 非纯对象（Date、Map、
 * Buffer、类实例）会直接判定 `tool "xxx" returned invalid output: value is not
 * lossless JSON`，整个工具调用失败。
 *
 * 所有工具统一在这里兜底，避免某个分支多写一个 `: undefined` 就整条链路挂掉。
 */
export function toLosslessJson(v: unknown, depth = 0): unknown {
  if (v === undefined) return null
  if (v === null) return null
  const t = typeof v
  if (t === 'string') return sanitizeForLosslessJson(v as string)
  if (t === 'boolean') return v
  if (t === 'number') {
    const n = v as number
    if (!Number.isFinite(n)) return String(n)
    return Object.is(n, -0) ? 0 : n
  }
  if (t === 'bigint') return String(v)
  if (t !== 'object') return String(v)
  if (depth > 12) return '[深度超限]'
  if (Array.isArray(v)) return Array.from(v, item => toLosslessJson(item, depth + 1))
  if (v instanceof Date) return v.toISOString()
  const proto = Object.getPrototypeOf(v)
  if (proto !== null && proto !== Object.prototype) {
    // Map / Set / Buffer / 类实例等：降级为 JSON 字符串，保证可序列化
    try {
      const s = JSON.stringify(v)
      return s === undefined ? String(v) : sanitizeForLosslessJson(s)
    } catch {
      return String(v)
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue
    out[k] = toLosslessJson(val, depth + 1)
  }
  return out
}

/**
 * 技能 payload 过大时落盘，只把预览 + 文件路径回传给模型。
 *
 * 旧实现固定 `slice(0, 8000)`，数据型技能（keyword-traffic 的 391 天趋势、
 * market-analysis 的上百条样本）会被腰斩，模型只能分析前段数据还误以为是完整结果。
 * 现在：小 payload 直传；超限写进工作区 `artifacts/`，模型可自行读文件拿全量数据。
 */
export function spillPayload(skillId: string, payloadStr: string): string {
  if (payloadStr.length <= TOOL_TEXT_LIMIT) return payloadStr
  // 预览改用智能截断：尾部保留——total/summary/分页字段常在 JSON 末尾，
  // 纯头部预览会让模型误以为数据「到此为止」而漏看统计字段（false PASS）。
  const preview = smartTruncateJsonAware(payloadStr, TOOL_TEXT_LIMIT)
  try {
    const ws = process.env.DSAGENT_WORKSPACE ?? process.cwd()
    const dir = join(ws, 'artifacts')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${skillId}_payload_${Date.now()}.json`)
    writeFileSync(file, payloadStr, 'utf8')
    return `${preview}\n\n⚠️ 结果过大（${payloadStr.length} 字符），完整数据已落盘：${file}\n需要全量数据请直接读取该文件。`
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    return `${preview}\n\n⚠️ 结果过大（${payloadStr.length} 字符），落盘失败：${reason}。完整数据未保存，仅显示截断预览。`
  }
}

/**
 * 包装 DSH 的 defineTool：所有工具的 execute 返回值统一过 lossless JSON 清洗。
 * 这是全插件唯一的工具返回出口，新增工具无需关心序列化约束。
 */
export function defineTool(def: ToolDefinition): ToolDefinition {
  const inner = def.execute
  return dshDefineTool({
    ...def,
    async execute(...callArgs: any[]) {
      return toLosslessJson(await inner(...(callArgs as [any, any])))
    },
  })
}

/**
 * 从工具运行上下文取当前会话（= 智能体）ID。
 *
 * DSH 里「会话」与「智能体」是同一个 id（`ToolRunContext.agent.id`），
 * 账号绑定维度就是它：账号的 `bound_agent_ids` 命中该 id 即为「本会话绑定」。
 *
 * 无 agent 归属的调用（宿主内部调用）返回 'default'，与凭证库的默认绑定语义一致。
 */
export function agentIdOf(exec: any): string {
  const id = exec?.agent?.id
  return typeof id === 'string' && id ? id : 'default'
}
