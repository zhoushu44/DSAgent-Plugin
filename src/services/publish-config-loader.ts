/**
 * 发布平台配置加载器（JSON 驱动发布引擎 · 第 1 步）。
 *
 * 读插件根 `publish-config/{pdd,taobao,xianyu}.json`，做字段校验（fail-fast），
 * 并提供进程内 mtime 缓存——文件变了自动重读，**改 JSON 无需重启宿主即生效**
 * （每次发布调用都走 loadPublishConfig，命中缓存时只 stat 一次，开销可忽略）。
 *
 * ★ 设计要点（PUBLISH-SPEC.md §3.2 / §4）：
 *   - JSON 里只写「怎么填」（锚点/限额/流程），「有什么」（属性 schema/SKU 维度）
 *     每次发布从页面现拉，所以 JSON 里没有也不该有类目属性清单。
 *   - 本加载器不含任何平台 if/else——新增平台 = 新增一个 JSON 文件 + 在
 *     SUPPORTED_PLATFORMS 里加一个键。
 *   - 校验 fail-fast：缺字段/非法字段在首次加载时报错，配置坏了宁可发布失败
 *     也不要静默回退到旧硬编码（那是「看起来能用其实用的旧锚点」的隐患）。
 *
 * ★ 与 index.ts 的 PLUGIN_ROOT 同一模式（lib/ 的父目录 = 插件根）；
 *   sync-to-host 会把 publish-config/ 连同 lib/ 一起拷进宿主快照，路径关系不变。
 */
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve as resolvePath } from 'node:path'

/** 插件根目录（本文件的编译产物在 lib/services/ 下，上跳两层即插件根） */
const PLUGIN_ROOT = (() => {
  try {
    const here = fileURLToPath(import.meta.url)
    return resolvePath(dirname(here), '..', '..')
  } catch {
    return process.cwd()
  }
})()

const CONFIG_DIR = join(PLUGIN_ROOT, 'publish-config')

/**
 * 已支持的平台键（= publish-config/ 下的文件名去 .json）
 *
 * ★ jd / douyin_shop / 1688 是 mqs 同引擎三平台（src/mqs-publish.ts）：
 *   与 taobao/pdd 共用同一套「锚点集驱动」的流程骨架，只是各写一份 JSON。
 */
const SUPPORTED_PLATFORMS = ['pdd', 'taobao', 'xianyu', 'jd', 'douyin_shop', '1688'] as const

export type PublishPlatform = (typeof SUPPORTED_PLATFORMS)[number]

/** 一个锚点候选：level 越小越稳（L1 埋点 > L2 语义 > L3 容器相对 > L4 绝对路径·禁手写） */
export interface AnchorCandidate {
  level: number
  /** CSS 选择器；`//` 或 `(/` 开头表示 XPath */
  selector: string
}

/** 一个锚点：多备选逐个尝试（PUBLISH-SPEC §3.3） */
export interface AnchorSpec {
  candidates: AnchorCandidate[]
  /** 文本型锚点的匹配（正则字符串，用于巡检与诊断） */
  matchTextRe?: string
  /** 文本型锚点的精确文案列表（如发布按钮） */
  matchTexts?: string[]
  /** label 前缀匹配（如闲鱼「分类」label） */
  matchTextStart?: string
  /** 精确匹配失败后的兜底（如 pdd 运费模板选第一个 li） */
  fallback?: string
  /** 该锚点在哪个容器内解析（语义提示，供巡检与后续 flow 步骤用） */
  scope?: string
  /** 选项/内容的 src 匹配（如闲鱼已上传图的 CDN 域） */
  srcMatchRe?: string
  /** 按钮可用性要求 */
  requireEnabled?: boolean
  /** 输入框 placeholder 回退匹配正则（如 pdd titleInput：锚点落空时按 placeholder 兜底定位） */
  placeholderFallbackRe?: string
  /** 通用 fillField 文本框回退匹配正则（如 pdd titleInput：按 label/placeholder 关键词兜底） */
  fillFieldFallbackRe?: string
  /** 模板占位符说明（如 {shipmentLimitText}），不参与解析 */
  comment?: string
}

/** 平台配置（本步实现只消费 anchors/limits/urls/timeouts/regexes；flow/fieldStrategies 预留） */
export interface PublishConfig {
  platform: string
  version: number
  limits: {
    maxImageBytes: number
    maxImages: number
    maxTitleLen?: number
    maxDetailImages?: number
    defaultStock?: string
  }
  urls: Record<string, string>
  flow: Array<{ step: string; url?: string; match?: string; args?: Record<string, unknown> }>
  anchors: Record<string, AnchorSpec | string>
  fieldStrategies: Record<string, Record<string, unknown>>
  regexes?: Record<string, string>
  timeouts?: Record<string, number>
  [key: string]: unknown
}

/** mtime 缓存：路径 → { mtimeMs, config } */
const cache = new Map<string, { mtimeMs: number; config: PublishConfig }>()

/** 校验并归一一份平台配置。非法直接 throw（fail-fast）。 */
function validateAndNormalize(platform: string, raw: unknown): PublishConfig {
  const src = `${platform}.json`
  const fail = (why: string): never => {
    throw new Error(`[publish-config] ${src} 配置非法：${why}`)
  }
  if (typeof raw !== 'object' || raw === null) fail('顶层必须是对象')
  const o = raw as Record<string, unknown>
  if (o.platform !== platform) fail(`platform 字段应为 "${platform}"，实际 "${String(o.platform)}"`)
  if (typeof o.version !== 'number') fail('version 字段缺失或非数字')
  const limits = o.limits
  if (typeof limits !== 'object' || limits === null) fail('limits 字段缺失')
  const L = limits as Record<string, unknown>
  if (typeof L.maxImageBytes !== 'number') fail('limits.maxImageBytes 缺失或非数字')
  if (typeof L.maxImages !== 'number') fail('limits.maxImages 缺失或非数字')
  if (typeof o.anchors !== 'object' || o.anchors === null) fail('anchors 字段缺失')
  const anchors = o.anchors as Record<string, unknown>
  for (const [key, val] of Object.entries(anchors)) {
    if (typeof val === 'string') continue // 简写：纯文本/正则锚点（如 guideBubbleDismissText）
    if (typeof val !== 'object' || val === null) fail(`anchors.${key} 必须是对象或字符串`)
    const a = val as Record<string, unknown>
    if (!Array.isArray(a.candidates) || a.candidates.length === 0) {
      fail(`anchors.${key}.candidates 缺失或为空数组`)
    }
    ;(a.candidates as unknown[]).forEach((c: unknown, i: number) => {
      if (typeof c !== 'object' || c === null) fail(`anchors.${key}.candidates[${i}] 非对象`)
      const cc = c as Record<string, unknown>
      if (typeof cc.level !== 'number') fail(`anchors.${key}.candidates[${i}].level 缺失`)
      if (typeof cc.selector !== 'string' || !cc.selector) fail(`anchors.${key}.candidates[${i}].selector 缺失`)
    })
  }
  if (typeof o.urls !== 'object' || o.urls === null) fail('urls 字段缺失')
  if (!Array.isArray(o.flow)) fail('flow 字段缺失或非数组（本步预留结构，也必须有）')
  if (typeof o.fieldStrategies !== 'object' || o.fieldStrategies === null) {
    fail('fieldStrategies 字段缺失（本步预留结构，也必须有）')
  }
  return raw as PublishConfig
}

/** 列出 publish-config/ 下实际存在的平台（巡检/诊断用） */
export function listAvailablePlatforms(): string[] {
  try {
    if (!existsSync(CONFIG_DIR)) return []
    return readdirSync(CONFIG_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5))
  } catch {
    return []
  }
}

/**
 * 加载平台配置（带 mtime 缓存）。
 * - 文件不存在 → throw（fail-fast，不静默回退硬编码）
 * - 文件变化 → 自动重读（改 JSON 一行无需重启宿主）
 */
export function loadPublishConfig(platform: PublishPlatform | string): PublishConfig {
  if (!(SUPPORTED_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(`[publish-config] 未支持的平台 "${platform}"（支持：${SUPPORTED_PLATFORMS.join(', ')}）`)
  }
  const file = join(CONFIG_DIR, `${platform}.json`)
  let mtimeMs = 0
  try {
    mtimeMs = statSync(file).mtimeMs
  } catch {
    throw new Error(
      `[publish-config] ${platform}.json 不存在（期望位置：${file}）。` +
      `请检查发布插件安装是否完整（publish-config/ 目录应与 lib/ 同级）。`
    )
  }
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === mtimeMs) return hit.config
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`[publish-config] ${platform}.json JSON 解析失败：${(err as Error).message}`)
  }
  const config = validateAndNormalize(platform, raw)
  cache.set(file, { mtimeMs, config })
  return config
}

/** 取一个锚点定义（不存在时 throw，键写错要在第一次调用就炸出来） */
export function anchorSpec(config: PublishConfig, key: string): AnchorSpec {
  const a = config.anchors[key]
  if (typeof a === 'string') {
    // 简写字符串锚点归一为单候选（level 2 语义层）
    return { candidates: [{ level: 2, selector: a }] }
  }
  if (typeof a !== 'object' || a === null) {
    throw new Error(`[publish-config] ${config.platform}.json 缺少锚点 "${key}"`)
  }
  return a
}

/** 取一个字符串型配置值（regexes/urls/anchors 里的简写字段），缺省返回 fallback */
export function configString(config: PublishConfig, section: 'regexes' | 'urls' | 'anchors', key: string, fallback = ''): string {
  const bag = config[section] as Record<string, unknown> | undefined
  const v = bag?.[key]
  if (typeof v === 'string') return v
  if (section === 'anchors') {
    // anchors 里的字符串简写也是合法取值
    return fallback
  }
  return fallback
}

/** 取超时毫秒数（缺省 fallback） */
export function configTimeout(config: PublishConfig, key: string, fallback: number): number {
  const v = config.timeouts?.[key]
  return typeof v === 'number' ? v : fallback
}

/** 清空缓存（单测用） */
export function resetPublishConfigCache(): void {
  cache.clear()
}
