/**
 * 技能使用统计与淘汰评分 —— 吸收 Accio 的 SkillStats + SkillEviction。
 *
 * 背景（见 ACCIO-REVERSE-ANALYSIS.md §4）：
 *   Accio 用 `.skill-stats.json` 记录每个技能的 useCount / lastUsedAt，
 *   并以 `0.4×使用频次 + 0.4×新鲜度 + 0.2×文档质量` 排序，淘汰低分技能。
 *
 * ★ 本项目的关键改造：**不自动删除任何技能**。
 *   Accio 淘汰的是它自己从对话里自动提炼的 `[Harvest]` 技能 —— 那些是副产品，误删代价低。
 *   而本项目的技能是人工精编的平台连接器，误删意味着用户资产受损且不可恢复。
 *   因此这里只做两件事：
 *     1. 记录使用统计（供市场页排序 / 长期未用提醒）
 *     2. 计算分数并**列出候选**，删除动作永远由人决定
 *
 * 落盘位置：与凭证库同级的 `.skill-stats.json`，避免污染技能目录
 * （技能目录会被 Harness 扫描，往里塞隐藏状态文件容易引起混淆）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 单个技能的统计条目 */
export interface SkillStatEntry {
  useCount: number
  /** 最近一次使用时间（epoch ms） */
  lastUsedAt: number
}

/** 统计文件整体形状 */
export type SkillStatsMap = Record<string, SkillStatEntry>

/**
 * 淘汰评分模型 —— 权重逐项对齐 Accio 的常量。
 *
 * 注意 `useCount` 归一化用的是 50（Accio 的 `Zk`）：
 * 即「用过 50 次」即视为该维度满分，避免高频技能独占分数。
 */
export const EVICTION = {
  /** useCount 归一化上限：达到即满分 */
  USE_COUNT_NORM: 50,
  /** 新鲜度线性衰减窗口（天） */
  RECENCY_WINDOW_DAYS: 180,
  /** 使用频次权重 */
  W_USE: 0.4,
  /** 新鲜度权重 */
  W_RECENCY: 0.4,
  /** 文档质量权重 */
  W_QUALITY: 0.2,
  /** 分数低于此值的技能进入「长期未用」候选（仅用于排序，见 idleCandidates 说明） */
  CANDIDATE_THRESHOLD: 0.2,
  /** 至少多少天没用才可能进候选 */
  MIN_IDLE_DAYS: 30,
  /**
   * 「低使用」门槛：成功次数不超过它才算长期未用。
   *
   * ★ 为什么用「次数」而不是「综合分」判定候选：
   *   综合分含 0.2 权重的文档质量，而质量是**静态属性**、不随时间衰减。
   *   若用综合分低于 0.2 作为候选条件，那么任何文档质量 ≥1.0 的技能
   *   其分数恒 ≥0.2，**永远不可能**进入候选 —— 阈值形同虚设
   *   （这正是首版实现被验证脚本抓到的缺陷）。
   *   因此候选判定改用「用过的次数少 + 很久没用」这两个**真正反映陈旧**的信号，
   *   综合分只用于候选之间的排序（对齐 Accio「排序取最低 N 个」而非阈值过滤的取向）。
   */
  LOW_USE_BAR: 3,
} as const

export interface SkillScoreRow {
  id: string
  score: number
  breakdown: {
    /** 归一化后的使用频次 [0,1] */
    useCount: number
    /** 归一化后的新鲜度 [0,1] */
    recency: number
    /** 文档质量 [0,1]（来自 scoreSkill） */
    quality: number
  }
  useCount: number
  lastUsedAt: number | null
  idleDays: number | null
}

/**
 * 计算单个技能的综合分。
 *
 * @param stat     该技能的使用统计（无记录时传 null）
 * @param quality  文档质量分 [0,1]，来自 skill-quality::scoreSkill
 * @param now      当前时间戳（便于测试注入）
 */
export function computeSkillScore(
  stat: SkillStatEntry | null,
  quality: number,
  now: number = Date.now(),
): { score: number; breakdown: SkillScoreRow['breakdown']; idleDays: number | null } {
  const useCount = stat?.useCount ?? 0
  const lastUsedAt = stat?.lastUsedAt ?? null

  const useScore = Math.min(useCount / EVICTION.USE_COUNT_NORM, 1)

  // 无使用记录时，用「从未使用」处理：新鲜度给 0（而非满分），
  // 否则新技能会因为「刚创建」而在从未使用的状态下拿到高新鲜度，
  // 掩盖「这个技能上线后一次都没被成功调用过」这一事实。
  let recencyScore = 0
  let idleDays: number | null = null
  if (lastUsedAt && Number.isFinite(lastUsedAt) && lastUsedAt > 0) {
    idleDays = (now - lastUsedAt) / 86_400_000
    recencyScore = Math.max(0, 1 - idleDays / EVICTION.RECENCY_WINDOW_DAYS)
  }

  const score = EVICTION.W_USE * useScore + EVICTION.W_RECENCY * recencyScore + EVICTION.W_QUALITY * quality
  return { score, breakdown: { useCount: useScore, recency: recencyScore, quality }, idleDays }
}

/**
 * 技能使用统计存取。
 *
 * 写入策略：**读-改-写 + 原子替换**。并发的两次 recordUse 若不串行化，
 * 后写会覆盖先写导致计数丢失；这里用一个进程内 Promise 链把写操作串起来。
 */
export function createSkillStats(storePath: string) {
  let cache: SkillStatsMap | null = null
  /** 写串行化：所有写操作排队，避免读-改-写竞态 */
  let writeChain: Promise<void> = Promise.resolve()

  async function readAll(): Promise<SkillStatsMap> {
    if (cache) return cache
    try {
      const raw = await readFile(storePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // 逐条净化：丢弃形状不对的条目，避免脏数据污染评分
        const clean: SkillStatsMap = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!v || typeof v !== 'object') continue
          const e = v as Record<string, unknown>
          const useCount = typeof e.useCount === 'number' && Number.isFinite(e.useCount) ? e.useCount : 0
          const lastUsedAt = typeof e.lastUsedAt === 'number' && Number.isFinite(e.lastUsedAt) ? e.lastUsedAt : 0
          clean[k] = { useCount, lastUsedAt }
        }
        cache = clean
        return clean
      }
      cache = {}
      return cache
    } catch {
      // 文件不存在 / JSON 损坏 → 从空开始，不阻塞技能执行
      cache = {}
      return cache
    }
  }

  /** 原子写：先写 .tmp 再 rename，避免写到一半被读取到半个文件 */
  async function persist(map: SkillStatsMap): Promise<void> {
    try {
      await mkdir(dirname(storePath), { recursive: true })
      const tmp = `${storePath}.tmp`
      await writeFile(tmp, JSON.stringify(map, null, 2), 'utf8')
      const { rename } = await import('node:fs/promises')
      await rename(tmp, storePath)
    } catch (e) {
      console.warn('[dsagent] 技能统计写入失败（不影响技能执行）:', e instanceof Error ? e.message : String(e))
    }
  }

  return {
    /** 读取全量统计（带进程内缓存） */
    async readAll(): Promise<SkillStatsMap> {
      return { ...(await readAll()) }
    },

    /**
     * 记录一次技能使用。
     *
     * 调用时机：技能**执行成功后**（失败也记录会让「从未成功」的技能看起来被频繁使用）。
     * 这里只做计数与时间戳，不做任何 IO 阻塞 —— 排队写入，失败静默。
     */
    async recordUse(skillId: string): Promise<void> {
      writeChain = writeChain.then(async () => {
        const map = await readAll()
        const prev = map[skillId]
        map[skillId] = {
          useCount: (prev?.useCount ?? 0) + 1,
          lastUsedAt: Date.now(),
        }
        cache = map
        await persist(map)
      }).catch(() => { /* 链上任何一环失败都不能打断后续写入 */ })
      return writeChain
    },

    /** 清除某技能的统计（技能被删除时调用） */
    async remove(skillId: string): Promise<void> {
      writeChain = writeChain.then(async () => {
        const map = await readAll()
        if (!(skillId in map)) return
        delete map[skillId]
        cache = map
        await persist(map)
      }).catch(() => {})
      return writeChain
    },

    /**
     * 批量评分 —— 供市场页排序。
     *
     * @param qualityOf 技能 id → 文档质量分 [0,1] 的查表函数
     */
    async scoreAll(qualityOf: (id: string) => number): Promise<SkillScoreRow[]> {
      const map = await readAll()
      const now = Date.now()
      return Object.keys(map).map(id => {
        const r = computeSkillScore(map[id], qualityOf(id), now)
        return {
          id,
          score: r.score,
          breakdown: r.breakdown,
          useCount: map[id]?.useCount ?? 0,
          lastUsedAt: map[id]?.lastUsedAt ?? null,
          idleDays: r.idleDays,
        }
      }).sort((a, b) => b.score - a.score)
    },

    /**
     * 列出「长期未用」候选 —— **仅供人工复核，绝不自动删除**。
     *
     * 判定分两步，刻意把「是否候选」与「候选排序」拆开：
     *
     *   ① 候选资格（布尔条件，与文档质量无关）：
     *      用过（useCount > 0，排除刚发布还没人用的新技能）
     *      且 成功次数 ≤ LOW_USE_BAR（很少被真正用起来）
     *      且 空闲 ≥ MIN_IDLE_DAYS 天
     *   ② 候选排序：按综合分升序（越陈旧越靠前），对齐 Accio「取最低 N 个」的取向。
     *
     * 不用「综合分 < 阈值」做资格判定：质量分是静态的，会让高质量技能永不入选
     * （详见 EVICTION.LOW_USE_BAR 的说明）。
     */
    async idleCandidates(qualityOf: (id: string) => number): Promise<SkillScoreRow[]> {
      const rows = await this.scoreAll(qualityOf)
      return rows
        .filter(r =>
          r.useCount > 0
          && r.useCount <= EVICTION.LOW_USE_BAR
          && r.idleDays !== null
          && r.idleDays >= EVICTION.MIN_IDLE_DAYS,
        )
        .sort((a, b) => a.score - b.score)
    },

    /** 丢弃进程内缓存，强制下次重新读盘 */
    invalidate(): void {
      cache = null
    },
  }
}

export type SkillStats = ReturnType<typeof createSkillStats>
