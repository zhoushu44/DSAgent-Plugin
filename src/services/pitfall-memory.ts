/**
 * 平台坑位记忆 —— 从真实执行失败中累积「某个平台/技能的坑」。
 *
 * 背景（见 ACCIO-REVERSE-ANALYSIS.md §4 C1）：
 *   本项目有 21 条 FIX-LOG 记录（#45–#65）都是「平台坑位」类知识：
 *   淘宝详情接口要走 tmall 域、拼多多 search 有账号级频控、闲鱼网页版部分类目不能发布……
 *   这些现在散落在 FIX-LOG 与人工记忆里，**会漂移、会遗忘**。
 *
 * ★ 与 Accio SkillHarvest 的关键差异（刻意不照搬）：
 *
 *   Accio 用**另一个 LLM 调用**在会话结束时提炼技能。本项目不这么做，原因有三：
 *
 *   ① **幻觉风险**。LLM 提炼出的「经验」无法与事实核对，写进技能目录后会长期误导。
 *      本模块只记录**机器可验证的事实**：失败类型（failureKind）、归一化后的错误签名、
 *      出现次数、首次/最近时间。没有任何一项来自模型推断。
 *
 *   ② **成本**。每次会话结束都跑一次 LLM 调用，在长会话场景是纯开销。
 *      本模块是纯内存 + 一次 JSON 落盘，成本可忽略。
 *
 *   ③ **审核**。Accio 自动落盘，本模块**只记录不写入技能目录**；
 *      需要沉淀成 SKILL.patch.md 时，由 `exportPitfallDraft()` 生成**草稿**交人审核。
 *
 * 三段式设计：
 *   记录（record）→ 达阈值晋升为「已确认坑位」（promote）→ 注入提示 / 导出草稿
 *
 * 不变量：**证据不足的坑位不会进入提示**。单次失败只是偶发，不是坑。
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/* ────────────────────────────── 常量 ────────────────────────────── */

export const PITFALL = {
  /**
   * 晋升为「已确认坑位」所需的最小证据次数。
   *
   * 为什么是 3：单次失败可能是偶发（网络抖动、账号临时异常），
   * 2 次仍可能是同一个偶发原因的重复。3 次才开始具备「可复现」的含义。
   * 这是**刻意偏向保守**的选择 —— 误报的坑位会污染提示，比漏报代价更高。
   */
  PROMOTE_THRESHOLD: 3,
  /**
   * 降级阈值：已确认坑位连续多久没再出现就退出提示（天）。
   *
   * 平台会修问题、账号会换。一个 90 天没再复现的坑位继续提示只会造成噪声。
   * 注意：是「退出提示」而非「删除记录」—— 记录保留，方便回溯。
   */
  STALE_DAYS: 90,
  /** 最多同时提示的坑位数（避免提示块膨胀） */
  MAX_HINT_ITEMS: 3,
  /** 最多保留的坑位记录数（防止长期运行无限增长） */
  MAX_ENTRIES: 500,
  /** 错误签名归一化后的最大长度 */
  SIGNATURE_MAX: 120,
} as const

/* ────────────────────────────── 类型 ────────────────────────────── */

export interface PitfallEntry {
  /** 归一化后的错误签名 —— 同签名的失败会合并计数 */
  signature: string
  /** 失败类型（failureKind），机器可读 */
  failureKind: string
  /** 涉及平台（可能为空：通用技能） */
  platform: string
  /** 出现的技能 id 列表（同一坑可能命中多个技能） */
  skillIds: string[]
  /** 出现次数 —— 晋升与提示排序的依据 */
  count: number
  /** 首次出现时间 */
  firstSeenAt: number
  /** 最近出现时间 */
  lastSeenAt: number
  /** 原始错误信息样本（保留最近一条，供人工判断） */
  lastMessage: string
  /**
   * 是否为「已确认坑位」（count >= PROMOTE_THRESHOLD）。
   * 只有已确认的坑位才会进入给模型的提示。
   */
  confirmed: boolean
}

export type PitfallMap = Record<string, PitfallEntry>

/** 一次失败观测 */
export interface FailureObservation {
  skillId: string
  platform?: string
  failureKind: string
  /** 原始错误信息（会被归一化成签名） */
  message?: string
}

/* ────────────────────────── 签名归一化 ────────────────────────── */

/**
 * 把错误信息归一化成「签名」—— 同因不同例的失败必须折叠成同一条。
 *
 * 不归一化的后果：`商品 123456 取数失败` 与 `商品 789012 取数失败`
 * 会变成两条独立记录，各自计数永远到不了阈值，坑位永远无法晋升。
 *
 * 归一化规则（只做**无损**的占位符替换，不改动语义词）：
 *   - 长数字串（≥5 位）→ <ID>      （商品 ID、订单号、时间戳）
 *   - UUID / 长 hex   → <ID>
 *   - 引号包裹的值     → <VAL>
 *   - 连续空白         → 单空格
 *   - 去掉首尾标点
 *
 * 刻意**不做**的事：不做同义词替换、不做语义摘要 —— 那会引入判断，
 * 而判断一旦出错就会把不同原因的失败合并，反而制造假坑位。
 */
export function normalizeSignature(message: string): string {
  if (!message) return ''
  let s = String(message)
  // UUID
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<ID>')
  // 长 hex / 长数字串（≥5 位）
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, '<ID>')
  s = s.replace(/\b\d{5,}\b/g, '<ID>')
  // 引号包裹的值（含中文引号）
  s = s.replace(/"[^"]*"/g, '<VAL>')
  s = s.replace(/'[^']*'/g, '<VAL>')
  s = s.replace(/“[^”]*”/g, '<VAL>')
  // 绝对路径 → <PATH>（不同机器的路径不同，但坑是同一个）
  s = s.replace(/[A-Za-z]:\\[^\s"']+/g, '<PATH>')
  s = s.replace(/\/[\w./-]{10,}/g, '<PATH>')
  // 连续空白 + 首尾标点
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^[\s:：,，.。;；-]+|[\s:：,，.。;；-]+$/g, '')
  if (s.length > PITFALL.SIGNATURE_MAX) s = `${s.slice(0, PITFALL.SIGNATURE_MAX)}…`
  return s
}

/**
 * 生成坑位记录的主键。
 *
 * 键 = 平台 + 失败类型 + 签名。三者任一不同即为不同的坑：
 *   - 同签名但不同平台 → 不同坑（淘宝的域问题与拼多多的频控是两回事）
 *   - 同平台但不同 failureKind → 不同坑（risk_control 与 token_expired 处置完全不同）
 */
export function pitfallKey(o: { platform?: string; failureKind: string; signature: string }): string {
  const p = o.platform || 'common'
  return `${p}::${o.failureKind}::${o.signature || '(无签名)'}`
}

/* ────────────────────────── 存储 ────────────────────────── */

/**
 * 坑位记忆存储。
 *
 * 与 skill-stats 同样的写入策略：读-改-写 + 原子替换 + 写串行化。
 * 失败记录发生在**技能失败路径**上，绝不能因为记忆写入失败而影响错误上报，
 * 因此所有 IO 错误都静默吞掉。
 */
export function createPitfallMemory(storePath: string) {
  let cache: PitfallMap | null = null
  let writeChain: Promise<void> = Promise.resolve()

  async function readAll(): Promise<PitfallMap> {
    if (cache) return cache
    try {
      const raw = await readFile(storePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // 逐条净化：丢弃形状不对的条目，避免脏数据让提示块输出乱码
        const clean: PitfallMap = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!v || typeof v !== 'object') continue
          const e = v as Record<string, unknown>
          const count = typeof e.count === 'number' && Number.isFinite(e.count) ? e.count : 0
          if (count <= 0) continue
          clean[k] = {
            signature: typeof e.signature === 'string' ? e.signature : '',
            failureKind: typeof e.failureKind === 'string' ? e.failureKind : 'unknown',
            platform: typeof e.platform === 'string' ? e.platform : 'common',
            skillIds: Array.isArray(e.skillIds) ? e.skillIds.filter((x): x is string => typeof x === 'string') : [],
            count,
            firstSeenAt: typeof e.firstSeenAt === 'number' ? e.firstSeenAt : 0,
            lastSeenAt: typeof e.lastSeenAt === 'number' ? e.lastSeenAt : 0,
            lastMessage: typeof e.lastMessage === 'string' ? e.lastMessage : '',
            confirmed: e.confirmed === true,
          }
        }
        cache = clean
        return clean
      }
      cache = {}
      return cache
    } catch {
      cache = {}
      return cache
    }
  }

  async function persist(map: PitfallMap): Promise<void> {
    try {
      await mkdir(dirname(storePath), { recursive: true })
      const tmp = `${storePath}.tmp`
      await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8')
      await rename(tmp, storePath)
    } catch (e) {
      console.warn('[dsagent] 坑位记忆写入失败（不影响技能执行）:', e instanceof Error ? e.message : String(e))
    }
  }

  /** 容量控制：超限时丢弃「已确认但最久未出现」的条目，优先保留活跃的 */
  function evictIfNeeded(map: PitfallMap): PitfallMap {
    const keys = Object.keys(map)
    if (keys.length <= PITFALL.MAX_ENTRIES) return map
    const sorted = keys.sort((a, b) => {
      const ea = map[a]
      const eb = map[b]
      // 已确认的排后面（先淘汰未确认的），其次按 lastSeenAt 升序（先淘汰最久没出现的）
      if (ea.confirmed !== eb.confirmed) return ea.confirmed ? 1 : -1
      return ea.lastSeenAt - eb.lastSeenAt
    })
    const drop = sorted.slice(0, keys.length - PITFALL.MAX_ENTRIES)
    const next: PitfallMap = { ...map }
    for (const k of drop) delete next[k]
    console.warn(`[dsagent] 坑位记忆超出 ${PITFALL.MAX_ENTRIES} 条，淘汰 ${drop.length} 条最陈旧的记录`)
    return next
  }

  return {
    /** 读取全量记录（按证据次数降序） */
    async list(): Promise<PitfallEntry[]> {
      const map = await readAll()
      return Object.values(map).sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
    },

    /** 只列已确认的坑位 */
    async listConfirmed(): Promise<PitfallEntry[]> {
      return (await this.list()).filter(e => e.confirmed)
    },

    /**
     * 记录一次失败观测。
     *
     * 调用时机：技能执行**失败**时（与 skill-stats 的「成功才计数」正好互补 ——
     * 一个记成功用于淘汰排序，一个记失败用于坑位累积）。
     *
     * @returns 本次是否发生了「晋升」（未确认 → 已确认），供上层决定要不要提示
     */
    async record(o: FailureObservation): Promise<{ promoted: boolean; entry: PitfallEntry | null }> {
      const signature = normalizeSignature(o.message ?? '')
      const key = pitfallKey({ platform: o.platform, failureKind: o.failureKind, signature })
      let promoted = false
      let entry: PitfallEntry | null = null

      writeChain = writeChain.then(async () => {
        const map = await readAll()
        const now = Date.now()
        const prev = map[key]
        if (prev) {
          prev.count += 1
          prev.lastSeenAt = now
          if (o.message) prev.lastMessage = String(o.message).slice(0, 400)
          if (!prev.skillIds.includes(o.skillId)) prev.skillIds.push(o.skillId)
          if (!prev.confirmed && prev.count >= PITFALL.PROMOTE_THRESHOLD) {
            prev.confirmed = true
            promoted = true
          }
          entry = { ...prev }
        } else {
          const fresh: PitfallEntry = {
            signature,
            failureKind: o.failureKind,
            platform: o.platform || 'common',
            skillIds: [o.skillId],
            count: 1,
            firstSeenAt: now,
            lastSeenAt: now,
            lastMessage: String(o.message ?? '').slice(0, 400),
            confirmed: 1 >= PITFALL.PROMOTE_THRESHOLD,
          }
          map[key] = fresh
          entry = { ...fresh }
        }
        const next = evictIfNeeded(map)
        cache = next
        await persist(next)
      }).catch(() => { /* 记忆写入失败不能影响错误上报 */ })

      await writeChain
      return { promoted, entry }
    },

    /**
     * 取出**当前有效**的坑位提示条目 —— 这是给模型看的部分。
     *
     * 过滤条件：
     *   - 必须已确认（证据 ≥ 阈值）
     *   - 必须在 STALE_DAYS 内出现过（平台会修问题，陈旧坑位是噪声）
     *   - 按证据次数降序，最多 MAX_HINT_ITEMS 条
     *
     * @param filter 可选：限定某个技能或平台（调用方按当前操作过滤）
     */
    async activeFor(filter?: { skillId?: string; platform?: string }): Promise<PitfallEntry[]> {
      const all = await this.list()
      const now = Date.now()
      const staleMs = PITFALL.STALE_DAYS * 86_400_000
      return all
        .filter(e => e.confirmed)
        .filter(e => e.lastSeenAt && now - e.lastSeenAt <= staleMs)
        .filter(e => !filter?.skillId || e.skillIds.includes(filter.skillId))
        .filter(e => !filter?.platform || e.platform === filter.platform)
        .slice(0, PITFALL.MAX_HINT_ITEMS)
    },

    /** 清空全部记录 */
    async clear(): Promise<void> {
      writeChain = writeChain.then(async () => {
        cache = {}
        await persist({})
      }).catch(() => {})
      return writeChain
    },

    /** 删除单条记录（按 key） */
    async remove(key: string): Promise<boolean> {
      let removed = false
      writeChain = writeChain.then(async () => {
        const map = await readAll()
        if (!(key in map)) return
        delete map[key]
        removed = true
        cache = map
        await persist(map)
      }).catch(() => {})
      await writeChain
      return removed
    },

    /** 丢弃内存缓存，强制重新读盘 */
    invalidate(): void {
      cache = null
    },

    /** 诊断信息 */
    async stats(): Promise<{ total: number; confirmed: number; stale: number }> {
      const all = await this.list()
      const now = Date.now()
      const staleMs = PITFALL.STALE_DAYS * 86_400_000
      return {
        total: all.length,
        confirmed: all.filter(e => e.confirmed).length,
        stale: all.filter(e => e.confirmed && e.lastSeenAt && now - e.lastSeenAt > staleMs).length,
      }
    },
  }
}

export type PitfallMemory = ReturnType<typeof createPitfallMemory>

/* ────────────────────────── 提示渲染 ────────────────────────── */

/** 失败类型 → 建议动作（与 README 的错误处理表一致，保持单一出处） */
const ACTION_HINT: Record<string, string> = {
  risk_control: '调 dsagent_risk_verify(platform=该平台) 过滑块后再重试，不要盲目重复调用',
  rate_limit: '稍后重试；若是拼多多 search/goods，改用 mode=feed',
  token_expired: '引导用户到「账号连接」重新登录',
  no_permission: '登录态有效但无该业务/类目权限 —— 不要重新登录，换个有权限的账号',
  not_bound: '引导用户到「账号连接」添加账号',
  parse_error: '展示原始返回，不要静默当成功',
  api_error: '检查参数与请求域名',
  skill_error: '查看 stderr 定位；必要时读技能 SKILL.md 的「错误处理」段',
}

/**
 * 把坑位渲染成注入给模型的提示块。
 *
 * 排版要点（来自实测的提示词实践）：
 *   - 每条一行，前缀「已复现 N 次」—— 让模型知道这不是猜测而是统计
 *   - 附建议动作 —— 只说「有这个坑」而不说「怎么办」等于没提示
 *   - 末尾保留最近一次的原始错误样本（截断）—— 有时需要原文才能定位
 */
export function renderPitfallHint(entries: PitfallEntry[]): string {
  if (!entries.length) return ''
  const lines: string[] = [
    '---',
    '【历史坑位提示】以下问题在本机**真实复现过**，请在动手前规避：',
    '',
  ]
  for (const e of entries) {
    const where = e.platform && e.platform !== 'common' ? `平台 ${e.platform}` : '通用'
    lines.push(`- [${where} / ${e.failureKind}] 已复现 ${e.count} 次（最近 ${formatAgo(e.lastSeenAt)}）`)
    if (e.signature) lines.push(`  现象：${e.signature}`)
    const action = ACTION_HINT[e.failureKind]
    if (action) lines.push(`  处置：${action}`)
    if (e.skillIds.length) lines.push(`  涉及技能：${e.skillIds.join('、')}`)
  }
  lines.push('')
  lines.push('这些是历史统计，不是本次调用已发生的事实 —— 若本次顺利则忽略。')
  return lines.join('\n')
}

function formatAgo(ts: number): string {
  if (!ts) return '时间未知'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

/**
 * 导出坑位草稿 —— 供人工审核后粘进 `SKILL.patch.md`。
 *
 * ★ 这是「自动提炼不落盘」与「人工精编」之间的桥：
 *   插件只生成**带证据的草稿**，是否沉淀成技能文档由人决定。
 *   这样既能让知识持续累积，又不会让模型生成的文字直接进入技能目录。
 */
export function exportPitfallDraft(entries: PitfallEntry[], opts?: { skillId?: string }): string {
  const scope = opts?.skillId ? `技能 ${opts.skillId}` : '全部技能'
  const lines: string[] = [
    `# ${scope} 平台坑位记录（草稿）`,
    '',
    '> 本文件由 dsagent_wiki 坑位记忆自动导出，**未经人工确认前请勿直接使用**。',
    '> 每条的「已复现 N 次」来自真实执行统计，非模型推断。',
    '> 审核后可直接粘贴到对应技能的 `SKILL.patch.md`。',
    '',
    `导出时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    '',
  ]
  if (!entries.length) {
    lines.push('_暂无达到证据阈值的坑位。_')
    return lines.join('\n')
  }
  for (const e of entries) {
    lines.push(`## [${e.failureKind}] ${e.signature || '(无签名)'}`, '')
    lines.push(`- 平台：${e.platform}`)
    lines.push(`- 复现次数：${e.count}`)
    lines.push(`- 首次：${new Date(e.firstSeenAt).toISOString().slice(0, 10)}　最近：${new Date(e.lastSeenAt).toISOString().slice(0, 10)}`)
    lines.push(`- 涉及技能：${e.skillIds.join('、') || '—'}`)
    const action = ACTION_HINT[e.failureKind]
    if (action) lines.push(`- 建议处置：${action}`)
    if (e.lastMessage) {
      lines.push('', '最近一次原始错误：', '', '```', e.lastMessage, '```')
    }
    lines.push('')
  }
  return lines.join('\n')
}
