/**
 * 网关响应缓存 —— 「同一请求不重复打平台」。
 *
 * ## 为什么需要
 *
 * 技能取数时大量出现**参数完全相同**的重复请求：
 *   - 同一技能内的分页/重试
 *   - 多个技能读同一份基础数据（如先看店铺概览再看类目明细）
 *   - 模型「不确定，再查一次」
 *
 * 每次重复请求都要走账号级节流（4~6s）、消耗平台配额，并累积风控风险。
 * RGV587 那类风控的本质就是「短时间内同账号请求过多」，
 * 减少重复请求是对风控的**直接**缓解，而不是绕过它。
 *
 * ## 与 Accio 的对应关系
 *
 * Accio 用一整套本地 SQLite 快照体系（`local_data_snapshots` / `coverage_segments` /
 * `query_evidence`）解决这个问题：把采集结果落成本地带时间覆盖区间与水位的数据集。
 *
 * 本模块刻意**不照搬那一整套** —— 快照体系的代价是必须改技能取数路径
 * （你们技能是 Python 脚本经网关取数，不是 JS 内联），改动面太大、收益不成比例。
 *
 * 只取它最核心的一点：**同样的请求不要重复打平台**。落在网关这一层的好处是
 * **技能契约完全不用动** —— 对 Python 脚本来说网关仍是同一个 HTTP 接口。
 *
 * ## 安全边界（本模块最重要的设计约束）
 *
 * 缓存错数据的代价远高于少缓一次。因此规则从严：
 *
 * 1. **只缓存 GET**（`mtop_jsonp` / `http_get`）。`http_post` 一律不缓存 ——
 *    发布、提交、下单这类写操作走 POST，缓存它们等于重复发布。
 * 2. **只缓存成功响应**。`failure_kind` 非空的一律不缓存，尤其是
 *    `risk_control` / `token_expired`：把失败结果缓存住会让故障持续 TTL 那么久，
 *    且用户完成重新登录后仍读到旧失败。
 * 3. **只缓存最终响应**。风控自动重试成功后的结果才进缓存（重试中间态不缓存）。
 * 4. **带写语义的 URL 路径黑名单**：即使调用方误用 GET 提交写操作，也拒绝缓存。
 * 5. **凭证变化即失效**：Cookie / `_tb_token_` 是缓存键的一部分，
 *    重新登录后键自然改变，不会读到上一个身份的旧数据（防串号）。
 * 6. **TTL 默认保守**：默认 60s。只覆盖「同一轮任务内的重复请求」这个主要场景，
 *    不试图跨任务复用（那需要真正的快照与失效策略，本模块不做）。
 *
 * ## 关于 `set_cookies`（已实地核对技能侧用法后的结论）
 *
 * 命中缓存时会把**当次响应**的 `set_cookies` 一并回放。这看着像「重放过期 Cookie」，
 * 但核对 `skills/.dsagent/runtime/platform_client.py` 与各技能后确认是**正确且必要**的：
 *
 *   - 技能侧（如 xianyu-crawl / pinduoduo 的 `fetch_data.py`）会从 `set_cookies` 里
 *     提取 `_m_h5_tk` 的 token 段，自行计算 MTOP 签名（`inject_token=False` 的引导请求）。
 *   - 若命中缓存时把 `set_cookies` 剥成空数组，技能会拿不到 token、直接判定失败 ——
 *     **那才会破坏契约**。故必须原样回放。
 *   - 而「token 可能已过期」这件事是自我修复的：网关在每次真实请求后都会把响应下发的
 *     `_m_h5_tk` 合并进凭证库，凭证库变化 → Cookie 串变化 → **缓存键随之变化**，
 *     因此后续请求不会命中旧键。TTL 又只有 60s，即便平台在窗口内轮换了 token，
 *     技能拿到旧 token 签名失败后，平台的 `FAIL_SYS_TOKEN_*` 响应会再下发新 token，
 *     走既有的重试链路自愈。
 *   - 且缓存命中路径**不会**把回放的 `set_cookies` 再次合并进凭证库（命中即返回），
 *     不存在重复写入。
 *
 * ## 一个刻意不做的优化
 *
 * 缓存条目与返回给调用方的对象**共享同一个 payload 引用**（省掉每次命中的深拷贝）。
 * 这是安全的，前提是调用方不得 mutate —— 网关内该 payload 一路只读，
 * 最终由 `JSON.stringify` 序列化出网（序列化不改对象）。
 * 若日后有人在网关内改写 payload，必须先改为拷贝写入。
 *
 * ## 可关闭
 *
 * `DSAGENT_GATEWAY_CACHE=off` 完全关闭；`DSAGENT_GATEWAY_CACHE_TTL=<秒>` 调 TTL；
 * `DSAGENT_GATEWAY_CACHE_MAX=<条数>` 调容量。
 */

import * as crypto from 'node:crypto'

// ── 配置 ────────────────────────────────────────────────────

/** 默认 TTL：60s。保守取值 —— 主要吃掉「同一轮任务内的重复请求」。 */
const DEFAULT_TTL_MS = 60_000

/** 默认容量上限：超出后按 LRU 淘汰，防止长时间运行内存无界增长 */
const DEFAULT_MAX_ENTRIES = 500

/** 单条响应体积上限：超过则不缓存（大响应缓存收益低、占用高） */
const MAX_CACHED_BODY_BYTES = 256 * 1024

/** 环境变量名 */
const ENV_ENABLED = 'DSAGENT_GATEWAY_CACHE'
const ENV_TTL = 'DSAGENT_GATEWAY_CACHE_TTL'
const ENV_MAX = 'DSAGENT_GATEWAY_CACHE_MAX'

/**
 * 永不缓存的 URL 特征。
 *
 * 这是**纵深防御**：主判据是「只缓存 GET」，但调用方有可能用 http_get 去打
 * 一个实际有副作用的接口（例如某些平台用 GET 提交操作）。命中这些特征一律不缓存。
 *
 * 关键词取自各平台常见的写操作路径命名。
 */
const WRITE_URL_PATTERNS: RegExp[] = [
  /\/publish/i,
  /\/create/i,
  /\/update/i,
  /\/delete/i,
  /\/remove/i,
  /\/submit/i,
  /\/save/i,
  /\/edit/i,
  /\/upload/i,
  /\/commit/i,
  /\/confirm/i,
  /\/cancel/i,
  /\/audit/i,
  /\/approve/i,
  /\/pay/i,
  /\/order\/create/i,
  /\/(add|modify|set)(\/|_|\?|=)/i,
  /method=(add|update|delete|create|submit|publish|save)/i,
  // MTOP 写操作接口名：阿里系写操作常以这些动词开头
  /mtop\.[a-z.]*\.(add|update|delete|create|submit|publish|save|upload|confirm)/i,
]

export type CacheMode = 'on' | 'off'

let _mode: CacheMode | null = null

/** 缓存是否启用（默认启用；`DSAGENT_GATEWAY_CACHE=off` 关闭） */
export function cacheEnabled(): boolean {
  if (_mode) return _mode === 'on'
  const raw = (process.env[ENV_ENABLED] ?? 'on').trim().toLowerCase()
  _mode = (raw === 'off' || raw === 'false' || raw === '0' || raw === 'no') ? 'off' : 'on'
  return _mode === 'on'
}

function ttlMs(): number {
  const raw = Number(process.env[ENV_TTL])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MS
  // 上限 10 分钟：再长就该上真正的快照层，而不是把陈旧数据当新鲜数据喂给模型
  return Math.min(raw * 1000, 600_000)
}

function maxEntries(): number {
  const raw = Number(process.env[ENV_MAX])
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_ENTRIES
  return Math.min(raw, 10_000)
}

/** 仅供测试：清空配置缓存，让环境变量改动生效 */
export function resetCacheConfigCache(): void {
  _mode = null
  stats.hits = 0
  stats.misses = 0
  stats.stores = 0
  stats.evictions = 0
  stats.skips = {}
  store.clear()
}

// ── 缓存条目 ────────────────────────────────────────────────

interface CacheEntry {
  /** 缓存键 */
  key: string
  /** 响应体（已解析的 payload，直接复用，避免重复 JSON.parse） */
  payload: unknown
  /** 原始 HTTP 状态码 */
  statusCode: number
  /** 完整的响应对象（除 payload 外的字段一并缓存，保证命中时与未命中完全同构） */
  response: Record<string, unknown>
  /** 写入时间 */
  createdAt: number
  /** 过期时间 */
  expiresAt: number
  /** 响应体字节数（用于容量统计） */
  bytes: number
}

const store = new Map<string, CacheEntry>()

/** 命中/未命中统计（供观测与排障） */
const stats = {
  hits: 0,
  misses: 0,
  stores: 0,
  evictions: 0,
  /** 各类跳过原因计数，便于判断「为什么没缓存」 */
  skips: {} as Record<string, number>,
}

function bumpSkip(reason: string): void {
  stats.skips[reason] = (stats.skips[reason] ?? 0) + 1
}

// ── 缓存键 ──────────────────────────────────────────────────

/**
 * 构造缓存键。
 *
 * 必须纳入的维度（少任何一个都会串数据）：
 *   - `platform` / `shopKey` —— 不同账号的数据绝不能混
 *   - `method` / `url`       —— 不同接口
 *   - 查询参数               —— 分页、日期、筛选条件（`t` 这类时间戳要剔除，否则永远不命中）
 *   - POST body             —— 虽不缓存 POST，仍纳入以保持键语义完整
 *   - **凭证指纹**           —— Cookie / tb_token 变化即视为不同缓存空间（防串号）
 *
 * ★ `t` / `callback` / `sign` / `_tb_token_` 的处理最讲究：
 *   MTOP 每次请求都会带上新的 `t`（时间戳）、`callback`（随机回调名），
 *   且 `sign` 由 token+t+data 派生。若原样纳入键，则**永远不可能命中**（等于没做缓存）。
 *   这些字段不承载业务语义（不影响返回哪份数据），故剔除。
 *   `_tb_token_` 也被剔除，但它的来源凭证已通过「凭证指纹」参与键 —— 二者等价且更稳。
 */
const VOLATILE_PARAM_KEYS = new Set(['t', 'callback', 'sign', '_tb_token_', 'jsv', 'dataType', 'ts', '_'])

export interface CacheKeyInput {
  kind: string
  platform: string
  shopKey: string
  url: string
  params?: Record<string, unknown>
  postBody?: string
  /** 凭证指纹（Cookie 摘要 + tb_token 摘要），由调用方计算 */
  credentialFingerprint: string
}

export function buildCacheKey(input: CacheKeyInput): string {
  const params = input.params ?? {}
  const stableParams = Object.keys(params)
    .filter(k => !VOLATILE_PARAM_KEYS.has(k))
    .sort()
    .map(k => `${k}=${String(params[k])}`)
    .join('&')

  const material = [
    input.kind,
    input.platform,
    input.shopKey,
    input.url,
    stableParams,
    input.postBody ?? '',
    input.credentialFingerprint,
  ].join('\u0000')

  return crypto.createHash('sha256').update(material, 'utf-8').digest('hex')
}

/**
 * 计算凭证指纹。
 *
 * 用 sha256 摘要而非原文：缓存键会出现在日志与统计里，不能泄露 Cookie。
 * 取 Cookie 串 + tb_token 一起摘要 —— 只摘要 Cookie 会漏掉 `_tb_token_` 单独刷新的情形。
 */
export function credentialFingerprint(cookieStr: string, tbToken?: string): string {
  return crypto
    .createHash('sha256')
    .update(`${cookieStr}\u0000${tbToken ?? ''}`, 'utf-8')
    .digest('hex')
    .slice(0, 16)
}

// ── 可缓存性判定 ────────────────────────────────────────────

/**
 * 该请求是否**允许**缓存（静态判定，与响应无关）。
 *
 * 判定顺序：先排除写操作（最危险），再看是否关闭。
 */
export function isCacheableRequest(kind: string, url: string): { ok: boolean; reason?: string } {
  // ① 只缓存 GET 语义的 kind。http_post 一律排除（发布/提交类走这里）
  if (kind === 'http_post') return { ok: false, reason: 'post_method' }
  if (kind !== 'mtop_jsonp' && kind !== 'http_get') return { ok: false, reason: 'unsupported_kind' }

  // ② URL 写操作黑名单（纵深防御）
  for (const re of WRITE_URL_PATTERNS) {
    if (re.test(url)) return { ok: false, reason: 'write_url' }
  }

  return { ok: true }
}

/**
 * 该**响应**是否允许写入缓存（判定依赖响应内容，故在拿到结果后调用）。
 *
 * 这是防止「把故障缓存住」的关键闸门。
 */
export function isCacheableResponse(response: {
  status?: string
  failure_kind?: string
  status_code?: number
  payload?: unknown
}): { ok: boolean; reason?: string } {
  // ① 只缓存成功响应。失败（尤指风控/登录态）绝不能缓存 ——
  //    缓存住会让故障持续整个 TTL，且用户重新登录后仍读到旧失败。
  if (response.failure_kind) return { ok: false, reason: `failure:${response.failure_kind}` }
  if (response.status !== 'success') return { ok: false, reason: 'not_success' }

  // ② HTTP 非 2xx 不缓存（即使 failure_kind 为空）
  const code = Number(response.status_code ?? 0)
  if (code && (code < 200 || code >= 300)) return { ok: false, reason: `http_${code}` }

  // ③ payload 为空不缓存：空结果可能只是本次请求的临时状态，
  //    缓存它会让「本来有数据」的后续请求也读到空。
  if (response.payload === null || response.payload === undefined) {
    return { ok: false, reason: 'empty_payload' }
  }

  return { ok: true }
}

// ── 读写 ────────────────────────────────────────────────────

/** 读缓存。未命中或已过期返回 null（过期条目顺手删除）。 */
export function getCached(key: string): Record<string, unknown> | null {
  const entry = store.get(key)
  if (!entry) {
    stats.misses++
    return null
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    stats.misses++
    return null
  }
  // LRU：命中后移到队尾（Map 保持插入序，删除再插入即置后）
  store.delete(key)
  store.set(key, entry)
  stats.hits++
  // 同 setCached：逐字段复制并保留不可枚举的归属字段
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(entry.response)) out[k] = v
  for (const meta of ['_cache_shop_key', '_cache_platform', '_cache_ttl_ms'] as const) {
    const v = (entry.response as Record<string, unknown>)[meta]
    if (v !== undefined) {
      Object.defineProperty(out, meta, { value: v, enumerable: false, configurable: true })
    }
  }
  out.cache_hit = true
  out.cache_age_ms = Date.now() - entry.createdAt
  return out
}

/** 写缓存。体积超限或不允许时跳过（并记录原因）。 */
export function setCached(
  key: string,
  response: Record<string, unknown>,
  payload: unknown,
): void {
  const bytes = (() => {
    try {
      return Buffer.byteLength(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf-8')
    } catch {
      return Number.MAX_SAFE_INTEGER
    }
  })()

  if (bytes > MAX_CACHED_BODY_BYTES) {
    bumpSkip('too_large')
    return
  }

  const now = Date.now()
  // ★ 不能用 `{ ...response }` 展开：归属字段（_cache_shop_key 等）被定义成
  //   **不可枚举**属性（刻意的，见 attachCacheMeta —— 防止随 JSON 泄露给技能），
  //   而展开运算符只复制可枚举属性，展平后归属信息会全部丢失，
  //   导致 invalidateCache({shopKey}) 永远清不掉任何条目。
  //   故这里逐字段复制：可枚举的用 Object.entries，归属字段单独取。
  const stored: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(response)) stored[k] = v
  for (const meta of ['_cache_shop_key', '_cache_platform', '_cache_ttl_ms'] as const) {
    const v = (response as Record<string, unknown>)[meta]
    if (v !== undefined) {
      Object.defineProperty(stored, meta, { value: v, enumerable: false, configurable: true })
    }
  }

  store.set(key, {
    key,
    payload,
    statusCode: Number(response.status_code ?? 200),
    response: stored,
    createdAt: now,
    expiresAt: now + ttlMs(),
    bytes,
  })
  stats.stores++

  // LRU 淘汰
  const max = maxEntries()
  while (store.size > max) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
    stats.evictions++
  }
}

/**
 * 失效缓存。
 *
 * 触发时机：
 *   - 某账号重新登录 → 按 shopKey 精确失效（虽然凭证指纹变了键本就不同，但显式清更干净）
 *   - 某账号完成风控验证 → 同上（凭证变了，旧数据可能已不准）
 *   - 用户手动要求刷新
 *
 * @returns 被清除的条目数
 */
export function invalidateCache(filter?: { shopKey?: string; platform?: string }): number {
  if (!filter?.shopKey && !filter?.platform) {
    const n = store.size
    store.clear()
    return n
  }
  let removed = 0
  // 键是 sha256，无法从键反查 shopKey —— 故在条目上保存归属信息。
  // 简化起见这里改用「条目内记录了 key 前缀字段」的做法：
  for (const [k, entry] of store) {
    const meta = entry.response as Record<string, unknown>
    const sk = String(meta._cache_shop_key ?? '')
    const pf = String(meta._cache_platform ?? '')
    const hit = (filter.shopKey && sk === filter.shopKey)
      || (filter.platform && pf === filter.platform)
    if (hit) {
      store.delete(k)
      removed++
    }
  }
  return removed
}

/** 清空全部缓存（测试与手动刷新用） */
export function clearCache(): number {
  const n = store.size
  store.clear()
  return n
}

/** 当前缓存状态（供观测工具与排障） */
export function cacheStats(): {
  enabled: boolean
  entries: number
  maxEntries: number
  ttlMs: number
  hits: number
  misses: number
  stores: number
  evictions: number
  skips: Record<string, number>
  hitRate: string
} {
  const total = stats.hits + stats.misses
  return {
    enabled: cacheEnabled(),
    entries: store.size,
    maxEntries: maxEntries(),
    ttlMs: ttlMs(),
    hits: stats.hits,
    misses: stats.misses,
    stores: stats.stores,
    evictions: stats.evictions,
    skips: { ...stats.skips },
    hitRate: total > 0 ? `${((stats.hits / total) * 100).toFixed(1)}%` : 'n/a',
  }
}

/**
 * 为缓存条目附加归属信息，使 `invalidateCache({shopKey})` 能按账号清理。
 *
 * 单独成一个函数是刻意的：归属字段以 `_cache_` 前缀写进响应对象，
 * 集中在一处便于审计「哪些字段是缓存内部用的、不该透给技能」。
 * 调用方在返回给技能前应剥掉这些字段（见 `stripCacheMeta`）。
 */
export function attachCacheMeta(
  response: Record<string, unknown>,
  shopKey: string,
  platform: string,
  ttlMsValue?: number,
): Record<string, unknown> {
  const out = { ...response }
  // 非枚举式地存归属：用 Object.defineProperty 设为不可枚举，
  // 这样 JSON.stringify 不会把它带给技能（技能看到的结构与改造前完全一致）。
  Object.defineProperty(out, '_cache_shop_key', { value: shopKey, enumerable: false, configurable: true })
  Object.defineProperty(out, '_cache_platform', { value: platform, enumerable: false, configurable: true })
  Object.defineProperty(out, '_cache_ttl_ms', { value: ttlMsValue ?? ttlMs(), enumerable: false, configurable: true })
  return out
}

/** 剥掉缓存内部字段（若调用方需要显式净化） */
export function stripCacheMeta<T extends Record<string, unknown>>(response: T): T {
  const out = { ...response } as Record<string, unknown>
  delete out._cache_shop_key
  delete out._cache_platform
  delete out._cache_ttl_ms
  delete out.cache_hit
  delete out.cache_age_ms
  return out as T
}

export const __internals = { WRITE_URL_PATTERNS, VOLATILE_PARAM_KEYS, DEFAULT_TTL_MS }
