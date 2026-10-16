/**
 * 类目档案（category profile）—— 按平台 + 具体类目（catId）长期持久化的发布配置档案。
 *
 * 用户需求（2026-10 定案，三条铁律）：
 *   1. **档案身份 = 平台 + catId 精确匹配**：发布页 URL 的 catId 是唯一身份键，
 *      文件名（如 taobao-儿童外套.json）只给人看，绝不参与查找匹配（不做模糊兜底）。
 *   2. **发布成功自动保存**：把本次页面确认生效的属性值全量写回，档案自我更新。
 *   3. **自动修复**：发布中发现属性变化（档案值不在当前页面候选里 → 降级重选，
 *      新值生效后回写 json）；当前页面已不存在的旧属性 → 保存时自动清除。
 *
 * 与 attr-cache（~/.dsh/.attr-cache.json）的分工：
 *   - attr-cache：机器内部的「命中即走」缓存，键是 categoryKeyword（用户输入的搜索词），
 *     用户不可见、不可编辑。
 *   - category-profile：用户可见、可手动编辑的长期档案（改完即生效，mtime 热加载），
 *     键是 catId（页面精确身份）。档案层优先级在 attr-cache 之上（见 fillCategoryAttrs）。
 *
 * 落盘位置：~/.dsh/publish-profiles/{platform}-{类目名}.json
 *   （与凭证库、.attr-cache.json 同目录 —— 运行时数据目录，不进源码库、
 *    不受 sync-to-host 覆盖影响，天然长期化。）
 *
 * ★ 复用 attr-cache 的持久化纪律：tmp+rename 原子写、writeChain 串行化、
 *   写失败只 warn 不影响发布。
 */
import { readFile, writeFile, mkdir, readdir, rename, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 一份类目档案（一个平台 + 一个具体类目一份） */
export interface CategoryProfile {
  /** 平台键（'taobao' / 'tmall' / 'pdd' ...，与发布工具的渠道键一致） */
  platform: string
  /** 类目 ID（发布页 URL ?catId=...）—— 档案身份的精确键，匹配只走字符串相等 */
  catId: string
  /** 类目显示名（选类目页页脚的完整路径，如「童装/婴儿装/亲子装>>儿童外套」；仅命名与展示用） */
  categoryName: string
  /** 属性名 → 上次发布实际生效的值（页面确认过的；用户手改后即为手写值，优先级最高之一） */
  attributes: Record<string, string>
  /** 属性结构指纹（attr-cache 的 schemaFingerprint 产物；变了 = 类目改版过，仅诊断用） */
  schemaFp?: string
  /** 运费模板名（上次发布选中的；店铺级数据，跟着档案走最直观） */
  freightTemplate?: string
  /** 规格维度名（上次发布使用的；预留字段） */
  skuDims?: string[]
  /** 最近一次发布成功时间（epoch ms） */
  updatedAt: number
  /** 诊断用：档案文件名（load 时填充；save 的落盘内容不含此字段） */
  file?: string
}

/** 文件名清洗：去 Windows 非法字符 / 空白 / 路径分隔符，截断到 60 字符 */
function sanitizeFileName(s: string): string {
  return String(s || '').replace(/[\\/:*?"<>|>＞\s/／]+/g, '').slice(0, 60) || 'unnamed'
}

/** 取类目路径的叶子名（「童装/婴儿装>>儿童外套」→「儿童外套」），文件命名用短名更可读 */
function leafName(categoryName: string): string {
  const parts = String(categoryName || '').split(/[>＞/／]+/).map(s => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * 创建类目档案库实例。
 * @param profilesDir 档案目录（如 ~/.dsh/publish-profiles）
 */
export function createCategoryProfileStore(profilesDir: string) {
  let writeChain: Promise<void> = Promise.resolve()
  /** 目录索引缓存：目录内容（文件名+mtime 签名）没变就不重读文件 —— 手动改 JSON 即刻生效 */
  let indexCache: { sig: string; profiles: CategoryProfile[] } | null = null

  /** 列出目录里全部合法档案（坏 JSON 跳过，不影响其他档案） */
  async function listProfiles(): Promise<CategoryProfile[]> {
    let names: string[] = []
    try {
      names = (await readdir(profilesDir)).filter(n => n.toLowerCase().endsWith('.json'))
    } catch {
      return []  // 目录不存在 = 还没有档案
    }
    const sigs = await Promise.all(names.map(async n => {
      try {
        const st = await stat(join(profilesDir, n))
        return `${n}:${st.mtimeMs}`
      } catch {
        return `${n}:x`
      }
    }))
    const sig = sigs.join('|')
    if (indexCache && indexCache.sig === sig) return indexCache.profiles
    const profiles: CategoryProfile[] = []
    for (const n of names) {
      try {
        const p = JSON.parse(await readFile(join(profilesDir, n), 'utf8')) as CategoryProfile
        if (p && typeof p === 'object' && p.platform && p.catId && p.attributes
          && typeof p.attributes === 'object') {
          profiles.push({ ...p, file: n })
        }
      } catch { /* 单个坏档案跳过 */ }
    }
    indexCache = { sig, profiles }
    return profiles
  }

  return {
    /**
     * 按 平台 + catId **精确匹配**查档案（铁律 1：不做文件名模糊匹配）。
     * 返回 null = 无档案（首次发布该类目）。
     */
    async load(platform: string, catId: string): Promise<CategoryProfile | null> {
      const id = String(catId || '').trim()
      if (!id) return null
      const hit = (await listProfiles()).find(p => p.platform === platform && String(p.catId) === id)
      return hit || null
    },

    /**
     * 保存档案（发布成功后调用，铁律 2+3：自动保存 + 自动修复合并）：
     *   - patch.attributes（本次页面确认生效值）覆盖旧同名键 —— 过期值被实际生效值修复；
     *   - 旧档案里「当前页面 schema 已不存在」的属性自动清除（类目改版）；
     *   - schema 里仍存在但本次没生效的旧属性保留（可能是用户手写的）；
     *   - categoryName / freightTemplate 为空时保留旧值（本次没收集到不清空）。
     * 类目改名后文件名跟随变化，并删除旧文件（同一 catId 永远只有一份档案）。
     * 返回写入的档案（含 file 文件名）；catId 为空时返回 null。
     */
    async save(
      platform: string,
      catId: string,
      categoryName: string,
      patch: {
        attributes?: Record<string, string>
        /** 当前页面全部属性名清单（清单外的旧属性被清除；空 = 不清除，保守） */
        schemaNames?: string[]
        schemaFp?: string
        freightTemplate?: string
      },
    ): Promise<CategoryProfile | null> {
      const plat = String(platform || '').trim()
      const id = String(catId || '').trim()
      if (!plat || !id) return null
      const prev = await this.load(plat, id).catch(() => null)

      // ── 自动修复合并 ──
      const nextAttrs: Record<string, string> = {}
      const schemaSet = new Set((patch.schemaNames || []).map(n => String(n || '').trim()).filter(Boolean))
      for (const [k, v] of Object.entries(prev?.attributes || {})) {
        if (schemaSet.size && !schemaSet.has(k)) continue  // 页面已无此属性 → 清除
        if (v != null && String(v) !== '') nextAttrs[k] = String(v)
      }
      for (const [k, v] of Object.entries(patch.attributes || {})) {
        if (v != null && String(v) !== '') nextAttrs[k] = String(v)
      }

      const nextName = String(categoryName || '').trim() || prev?.categoryName || `cat-${id}`
      const profile: CategoryProfile = {
        platform: plat,
        catId: id,
        categoryName: nextName,
        attributes: nextAttrs,
        schemaFp: patch.schemaFp || prev?.schemaFp,
        freightTemplate: patch.freightTemplate || prev?.freightTemplate,
        skuDims: prev?.skuDims,
        updatedAt: Date.now(),
      }
      const fileName = `${sanitizeFileName(plat)}-${sanitizeFileName(leafName(nextName) || `cat-${id}`)}.json`

      const run = async () => {
        try {
          await mkdir(profilesDir, { recursive: true })
          const target = join(profilesDir, fileName)
          const tmp = `${target}.tmp`
          const body = JSON.stringify(profile, null, 2)
          await writeFile(tmp, body, 'utf8')
          try {
            await rename(tmp, target)
          } catch {
            // Windows：rename 到已存在文件抛 EPERM/EBUSY/EEXIST（POSIX 原子替换语义不成立）。
            // 回退：先删目标再 rename；再失败则直接覆写目标并清掉 tmp。
            await unlink(target).catch(() => {})
            try {
              await rename(tmp, target)
            } catch {
              await writeFile(target, body, 'utf8')
              await unlink(tmp).catch(() => {})
            }
          }
          // 类目改名 → 删旧文件，保证同一 catId 只有一份档案
          if (prev?.file && prev.file !== fileName) {
            try { await unlink(join(profilesDir, prev.file)) } catch { /* 旧文件已不在，忽略 */ }
          }
          indexCache = null  // 索引失效，下次 load 重扫
        } catch (e) {
          console.warn('[dsagent-category-profile] 档案写入失败（不影响发布）:',
            e instanceof Error ? e.message : String(e))
        }
      }
      // ★ 排队并等待本次写入落盘再返回（紧随的 load 才能读到刚保存的档案）；
      //   run 内部自吞错误，链永不断裂。
      const chained = writeChain.then(run, run)
      writeChain = chained
      await chained
      return { ...profile, file: fileName }
    },

    /** 列出全部档案（诊断/管理用） */
    async list(): Promise<CategoryProfile[]> {
      return await listProfiles()
    },
  }
}

export type CategoryProfileStore = ReturnType<typeof createCategoryProfileStore>
