/**
 * 类目属性缓存 —— 按平台+类目缓存属性结构 + 成功填值，省模型 API 调用。
 *
 * 背景（见知识库 74 篇「上架两步结构」§三·补 + §六）：
 *   Accio 的 Printify 流程拉完蓝图/供应商/变体/成本后存进 MEMORY.md，下次不重拉。
 *   本模块缓存同类目的「属性名 → 上次成功填的值」，同类目发相似商品时直接复用，
 *   不调文本模型。但必须验证缓存值在当前下拉选项里（选项可能变），不在就 fallback。
 *
 * ★ 关键设计决策：
 *   1. 只缓存「成功且经页面验证」的值（filled 里 confirmed=true 的），不缓存模型犹豫的
 *   2. 命中缓存后仍要读当前下拉选项做验证——选项变了就 fallback 到模型，不硬塞旧值
 *   3. 只缓存枚举型（下拉选值），不缓存文本型（标题等每件商品都不同）
 *   4. 写串行化（同 skill-stats 的模式），避免读-改-写竞态
 *   5. 原子写（tmp + rename），失败不影响发布
 *
 * 落盘位置：与凭证库同级的 `.attr-cache.json`
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 单个属性的成功填值记录 */
export interface AttrCacheEntry {
  /** 上次成功填的值（必须是当时页面验证过的） */
  value: string
  /** 命中次数（同一类目同一属性复用多少次） */
  hits: number
  /** 最近一次命中时间（epoch ms） */
  lastUsedAt: number
}

/** 缓存键 = `${platform}:${categoryKeyword}` → { 属性名 → 条目 } */
export type AttrCacheMap = Record<string, Record<string, AttrCacheEntry>>

/**
 * 创建属性缓存实例。
 * @param storePath  JSON 落盘路径
 */
export function createAttrCache(storePath: string) {
  let cache: AttrCacheMap | null = null
  let writeChain: Promise<void> = Promise.resolve()

  /** 惰性加载缓存文件 */
  async function load(): Promise<AttrCacheMap> {
    if (cache) return cache
    try {
      const raw = await readFile(storePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cache = parsed as AttrCacheMap
      } else {
        cache = {}
      }
    } catch {
      cache = {}
    }
    return cache!
  }

  /** 串行化写（tmp + rename 原子写） */
  function persist(map: AttrCacheMap): Promise<void> {
    const run = () => mkdir(dirname(storePath), { recursive: true })
      .then(() => writeFile(`${storePath}.tmp`, JSON.stringify(map, null, 2), 'utf8'))
      .then(() => import('node:fs/promises').then(({ rename }) => rename(`${storePath}.tmp`, storePath)))
      .catch((e) => {
        console.warn('[dsagent-attr-cache] 写入失败（不影响发布）:', e instanceof Error ? e.message : String(e))
      })
    writeChain = writeChain.then(run, run)
    return writeChain
  }

  /** 缓存键：平台 + 类目关键词（小写归一） */
  function key(platform: string, categoryKeyword: string): string {
    return `${platform}:${(categoryKeyword || '').trim().toLowerCase()}`
  }

  return {
    /**
     * 查缓存：该平台+类目下，某属性是否有上次成功填的值。
     * 返回值后仍需验证它在当前下拉选项里（见上方设计决策 2）。
     */
    async lookup(platform: string, categoryKeyword: string, attrName: string): Promise<string | null> {
      const map = await load()
      const bucket = map[key(platform, categoryKeyword)]
      if (!bucket) return null
      const entry = bucket[attrName]
      return entry?.value || null
    },

    /**
     * 记一次成功填值（confirmed=true 的才记）。
     * 同属性已有记录则 hits+1 并刷新 lastUsedAt。
     */
    async record(platform: string, categoryKeyword: string, attrName: string, value: string): Promise<void> {
      const map = await load()
      const k = key(platform, categoryKeyword)
      if (!map[k]) map[k] = {}
      const existing = map[k][attrName]
      const now = Date.now()
      map[k][attrName] = {
        value,
        hits: existing ? existing.hits + 1 : 1,
        lastUsedAt: now,
      }
      await persist(map)
    },

    /** 清某平台+类目下的全部缓存（类目改版、属性结构大变时用） */
    async invalidate(platform: string, categoryKeyword: string): Promise<void> {
      const map = await load()
      const k = key(platform, categoryKeyword)
      delete map[k]
      await persist(map)
    },

    /** 诊断：返回全部缓存条目（市场页/调试用） */
    async snapshot(): Promise<AttrCacheMap> {
      return await load()
    },
  }
}

export type AttrCache = ReturnType<typeof createAttrCache>
