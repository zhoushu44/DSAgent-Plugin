/**
 * 工具输出智能截断 —— 头尾保留 + 形态感知。
 *
 * ## 为什么需要
 *
 * 原实现是**纯头部截断**：`slice(0, 32_000) + '...(截断)'`。
 * 问题：尾部信息全部丢失。而实际上很多输出的**关键内容恰在尾部**：
 *
 *   - JSON 类：`summary` / `total` / `error` / `pagination` 字段常在对象末尾
 *     （如 `{"rows":[...几百条...],"total":842,"summary":"..."}`）
 *   - 日志类：最后的报错行才是根因（Accio 的 `stderrTail` 就是为此设计）
 *   - 报告类：结论章节在文末（先分析后总结是通用写作结构）
 *
 * 模型看不到尾部时，会把「截断」误当成「数据到此为止」——
 * 以为是完整结果继续分析，得出错误结论（false PASS）。
 *
 * ## 与 Accio 的对应关系（本模块的移植来源）
 *
 * Accio 有 151 处 truncat 相关逻辑，最核心的两个模式：
 *
 *   1. **取尾而非取头**（`Zbr`，repo-launcher 的 stderrTail）：
 *      `filter(非空).slice(-10).join()`，超长时 `...\n${slice(-1200)}` ——
 *      明确知道「日志的根因在末尾」，且用 `...` 前缀**明示省略发生过**。
 *
 *   2. **头尾都留**（`lRe`，凭证掩码）：`${slice(0,4)}***${slice(-4)}` ——
 *      首尾各保一段，中间用标记隔开。
 *
 * 本模块把模式 2 泛化成通用截断器：**头 70% + 省略标记 + 尾 30%**，
 * 并吸收 Accio 「省略必须明示」的原则——截断标记里写清「省略了多少」，
 * 让模型知道中间有洞，而不是误以为内容连续。
 *
 * ## 截断形态的选择（为什么不是无脑头尾对半）
 *
 * 不同形态的信息密度分布不同，故按内容自适应：
 *
 *   | 形态 | 判定 | 策略 | 理由 |
 *   |------|------|------|------|
 *   | JSON | 首字符为 `{`/`[` 且能定位尾部闭合 | 头部 + 尾部 | 尾部常有 summary/total/分页字段 |
 *   | 多行文本 | 含 ≥3 个换行 | 头部 + 尾部 | 尾部常是结论/报错行 |
 *   | 单行长文本 | 无结构 | 头部 + 尾部（小比例） | URL、token 等首尾各有信息 |
 *
 * 头尾比例刻意**不是 50/50**：模型对开头的上下文依赖更强（字段名、
 * 结构声明都在开头），故头部占七成、尾部占三成。
 *
 * ## 两个刻意不做的事
 *
 * 1. **不尝试解析 JSON 后挑字段保留** —— 那需要知道每个技能的 schema，
 *    50+ 个技能各不相同，维护成本远超收益；且挑字段等于替模型做了判断。
 * 2. **不把截断做成「可配置比例」** —— 过早参数化。当前 70/30 是合理默认，
 *    真有需求时再加环境变量（照 `DSAGENT_GATEWAY_CACHE` 的模式）。
 *
 * ## 与技能契约的关系
 *
 * 截断只发生在「呈现给模型」这一层（`renderToolOutput` / `spillPayload`），
 * 技能本身仍返回完整数据；`spillPayload` 超限时全量落盘的机制保持不变，
 * 截断后的文本会指路到落盘文件。
 *
 * ## 开关
 *
 * `DSAGENT_TRUNCATE=head`（旧行为：纯头部）/ `smart`（默认：头尾保留）/ `off`（不截断）。
 */

/** 截断策略 */
export type TruncateMode = 'smart' | 'head' | 'off'

const MODE_ENV = 'DSAGENT_TRUNCATE'

/** 头部保留比例（尾部为 1-此值）。头部占比更高：字段名/结构声明在开头。 */
const HEAD_RATIO = 0.7

/** 尾部保底字符数：即使按比例算出的尾部过小，也至少保留这么多（总结至少一行） */
const MIN_TAIL_CHARS = 600

let _modeCache: TruncateMode | null = null

/** 当前截断策略（默认 smart）。仅测试需要重置缓存。 */
export function truncateMode(): TruncateMode {
  if (_modeCache) return _modeCache
  const raw = (process.env[MODE_ENV] ?? 'smart').trim().toLowerCase()
  _modeCache = raw === 'head' || raw === 'off' ? raw : 'smart'
  return _modeCache
}

/** 仅供测试：清空策略缓存 */
export function resetTruncateModeCache(): void {
  _modeCache = null
}

/**
 * 截断标记 —— **省略必须明示**（Accio 原则）。
 *
 * 标记里写清省略量，让模型明确知道「中间有 N 字符没看到」：
 *   - 不会把截断误当自然结束（false PASS 的根源）
 *   - 需要时能判断「落盘文件里那 N 字符值不值得读」
 */
function omissionMarker(omitted: number): string {
  return `\n\n…（中间省略 ${omitted.toLocaleString('en-US')} 字符${omitted > 4_000 ? '，全量数据见落盘文件或缩小查询范围' : ''}）…\n\n`
}

/** 尾部保留量：按比例算，但不低于保底值，且不超过总限的一半 */
function tailBudget(total: number, limit: number): number {
  const tail = Math.floor(limit * (1 - HEAD_RATIO))
  return Math.max(Math.min(tail, Math.floor(total / 2)), Math.min(MIN_TAIL_CHARS, Math.floor(limit / 4)))
}

/**
 * 智能截断：头 70% + 省略标记（含省略量）+ 尾 30%。
 *
 * 预期输入是**已经过 sanitize** 的干净字符串；本函数只负责在超限时切分，
 * 不做字符清洗（职责分离）。
 *
 * @param s 待截断文本
 * @param limit 上限（字符）。默认 32_000，与 TOOL_TEXT_LIMIT 一致。
 * @returns 超限时返回带省略标记的文本；未超限原样返回。
 *          省略标记本身计入 limit，保证最终长度 ≤ limit + 标记长度的小容差。
 */
export function smartTruncate(s: string, limit = 32_000): string {
  if (typeof s !== 'string' || s.length <= limit) return s

  const mode = truncateMode()
  if (mode === 'off') return s
  if (mode === 'head') return s.slice(0, limit) + '…(截断)'

  // smart：头尾保留。省略标记的长度要预留出来，避免总长超限。
  // ★ 标记预留量按 limit 缩放，且不让 budget 跌成负数：
  //   limit=32000 时预留 80 不痛不痒；但 limit=50 时固定预留 80 会让 budget 成负，
  //   头部 0 字符、尾部也所剩无几 —— 故改为按比例（最多 80，最少 limit 的 20%）。
  const markerReserve = Math.min(80, Math.max(Math.floor(limit * 0.2), 10))
  const budget = Math.max(limit - markerReserve, Math.floor(limit * 0.6))
  const tailLen = Math.min(tailBudget(s.length, budget), Math.floor(s.length / 2))
  const headLen = Math.max(budget - tailLen, 0)

  const head = s.slice(0, headLen)
  const tail = s.slice(s.length - tailLen)
  const omitted = s.length - headLen - tailLen
  if (omitted <= 0) return s.slice(0, limit)

  return head + omissionMarker(omitted) + tail
}

/**
 * 形态感知截断：对「看起来是 JSON」的文本做截断前对齐边界。
 *
 * 为什么需要对齐：`slice` 可能切在 JSON 中间，尾部片段以 `,"foo":...` 开头，
 * 模型难以辨认它属于哪个结构。对齐策略很克制——只把尾部**向前**推进到
 * 下一个 `,` 或 `{` 之后，让尾部片段从字段边界开始；不尝试重新配平括号
 * （那等于解析 JSON，超出截断层的职责）。
 */
export function smartTruncateJsonAware(s: string, limit = 32_000): string {
  if (typeof s !== 'string' || s.length <= limit) return s
  if (truncateMode() !== 'smart') return smartTruncate(s, limit)

  const looksJson = /^\s*[[{]/.test(s)
  const out = smartTruncate(s, limit)
  if (!looksJson) return out

  // 找到省略标记后的尾部起点，把它推进到下一个字段边界
  const markerIdx = out.indexOf('…（中间省略')
  if (markerIdx < 0) return out
  const tailStart = out.indexOf('）…', markerIdx)
  if (tailStart < 0) return out
  const tailFrom = tailStart + '）…'.length
  // 跳过标记后的换行，找到实际内容
  let i = tailFrom
  while (i < out.length && /\s/.test(out[i])) i++
  // 推进到下一个字段边界（, 或 { 之后），最多看 200 字符 ——
  // 找不到就保持原样（宁可让模型看原始切片，也不为对齐丢更多内容）
  const probeEnd = Math.min(i + 200, out.length)
  for (let j = i; j < probeEnd; j++) {
    if (out[j] === ',' || out[j] === '{') {
      const aligned = out.slice(0, tailFrom) + out.slice(j + 1).replace(/^\s+/, '')
      return aligned
    }
  }
  return out
}
