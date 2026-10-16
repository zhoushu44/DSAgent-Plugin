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
 * ★ 缓存分层（PUBLISH-SPEC §3.6，2026-10 扩展）——顶层键名空间：
 *   `${platform}:${category}`          → 属性桶：{ 属性名 → 上次成功值 }（原有）
 *   `${platform}:${category}:sku`      → SKU 维度：{ dims → 维度名数组 JSON }（店铺同类目规格类型偏好）
 *   `${platform}:${category}:schema`   → schema 指纹：{ fp → 控件清单 hash }（类目改版检测）
 *   `${platform}:freight`              → 运费模板/发货时间：{ template|delivery → 上次成功值 }（店铺级）
 * 新层全部沿用「命中即验证」纪律：缓存值必须仍在当前页面候选里才用。
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

/** 缓存键 = `${platform}:${categoryKeyword}` → { 属性名 → 条目 } 或分层扩展键（见头部注释） */
export type AttrCacheMap = Record<string, Record<string, AttrCacheEntry>>

/**
 * 类目属性 schema 指纹：对「排序后的属性名清单」做 hash（FNV-1a 32 位）。
 * 页面新增/删除/改名一栏属性 → 指纹变化 → 属性桶自动失效（缓存值降级为待验证，AI 重填）。
 * ★ 顺序无关：平台调整属性渲染顺序不会误判改版。
 */
export function schemaFingerprint(names: string[]): string {
  const sorted = names.map(n => String(n || '').replace(/\s+/g, '')).filter(Boolean).sort()
  let h = 0x811c9dc5
  for (const s of sorted.join('\n')) {
    h ^= s.charCodeAt(0)
    h = (h * 0x01000193) >>> 0
  }
  return `fnv1a32:${sorted.length}:${h.toString(36)}`
}

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

    // ── 分层扩展（PUBLISH-SPEC §3.6）─────────────────────────────

    /**
     * SKU 维度缓存：查该平台+类目上次成功使用的规格类型名（如「身高」「颜色」）。
     * ★ 命中后仍需验证它在当前规格类型下拉候选里（specTypeScore 语义打分优先），不在就丢弃。
     */
    async lookupSkuDims(platform: string, categoryKeyword: string): Promise<string[]> {
      const map = await load()
      const raw = map[`${key(platform, categoryKeyword)}:sku`]?.dims?.value
      if (!raw) return []
      try {
        const arr = JSON.parse(raw)
        return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, 4) : []
      } catch {
        return []
      }
    },

    /** SKU 维度缓存：记一次成功选中的规格类型名（按维度顺序） */
    async recordSkuDims(platform: string, categoryKeyword: string, dims: string[]): Promise<void> {
      const list = dims.map(d => String(d || '').trim()).filter(Boolean).slice(0, 4)
      if (!list.length) return
      const map = await load()
      const k = `${key(platform, categoryKeyword)}:sku`
      const prev = (() => { try { const a = JSON.parse(map[k]?.dims?.value || '[]'); return Array.isArray(a) ? a.map(String) : [] } catch { return [] } })()
      // 并集合并去重（保序：旧维度在前，新维度补后），最新 4 个——多维场景 d1/d2 不互相覆盖
      const merged = [...new Set([...prev, ...list])].slice(-4)
      map[k] = { ...map[k], dims: { value: JSON.stringify(merged), hits: (map[k]?.dims?.hits || 0) + 1, lastUsedAt: Date.now() } }
      await persist(map)
    },

    /**
     * 店铺级枚举缓存（运费模板/发货时间等）：查上次成功值。
     * @param kind 键名（如 'template' / 'delivery'）
     */
    async lookupFreight(platform: string, kind: string): Promise<string | null> {
      const map = await load()
      return map[`${platform}:freight`]?.[kind]?.value || null
    },

    /** 店铺级枚举缓存：记一次成功值（模板名/发货文案，均须页面验证过才记） */
    async recordFreight(platform: string, kind: string, value: string): Promise<void> {
      const v = String(value || '').trim()
      if (!v) return
      const map = await load()
      const k = `${platform}:freight`
      if (!map[k]) map[k] = {}
      const existing = map[k][kind]
      map[k][kind] = { value: v, hits: (existing?.hits || 0) + 1, lastUsedAt: Date.now() }
      await persist(map)
    },

    /**
     * schema 指纹比对：指纹没变返回 { changed: false }；变了 → 刷新指纹 + 失效该类目
     * 属性桶（缓存值下次自然走模型重填）+ 返回 { changed: true, prev, next }。
     * ★ 首次（无旧指纹）只记指纹不失效。
     */
    async checkSchemaFingerprint(
      platform: string,
      categoryKeyword: string,
      names: string[],
    ): Promise<{ changed: boolean; prev?: string; next?: string }> {
      const fp = schemaFingerprint(names)
      const map = await load()
      const k = `${key(platform, categoryKeyword)}:schema`
      const prev = map[k]?.fp?.value
      if (prev === fp) return { changed: false, prev, next: fp }
      map[k] = { ...map[k], fp: { value: fp, hits: 1, lastUsedAt: Date.now() } }
      const bucketKey = key(platform, categoryKeyword)
      const hadAttrs = !!map[bucketKey]
      if (prev && hadAttrs) {
        delete map[bucketKey]
        console.warn(`[dsagent-attr-cache] 类目 schema 指纹变化（${prev} → ${fp}），已失效属性缓存桶`)
      }
      await persist(map)
      return prev ? { changed: true, prev, next: fp } : { changed: false, prev, next: fp }
    },
  }
}

export type AttrCache = ReturnType<typeof createAttrCache>
