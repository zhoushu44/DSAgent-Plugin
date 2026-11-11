/**
 * 发布组件 · 视觉分析结果缓存（vision-cache.mjs）
 *
 * ★ 2026-10-30 优化：
 *   同类目第 2 单起，直接用缓存的 dim_type/strategy/hints，不再截图+调模型。
 *   省 8s/单。
 *
 *   缓存 key：类目 + 维度名
 *   失效条件：页面维度结构变化（可选，目前简单 TTL + 手动清理）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const STORE = path.join(PLUGIN_ROOT, 'skills', 'pdd-publish-http', 'assets', 'vision-cache.json')

/** 读全部缓存 */
export function loadVisionCache() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'))
  } catch {
    return {}
  }
}

/** 查缓存 */
export function getVisionCache(category, dimName) {
  const all = loadVisionCache()
  const key = `${String(category || '').trim()}::${String(dimName || '').trim()}`
  const hit = all[key]
  if (!hit) return null
  // 30 天过期
  const age = Date.now() - (hit.cachedAt || 0)
  if (age > 30 * 24 * 3600 * 1000) return null
  return hit
}

/** 存缓存 */
export function setVisionCache(category, dimName, analysis) {
  const all = loadVisionCache()
  const key = `${String(category || '').trim()}::${String(dimName || '').trim()}`
  all[key] = {
    dim_type: analysis.dim_type || '',
    strategy: analysis.strategy || '',
    blur_target: analysis.blur_target || '',
    element_hints: analysis.element_hints || [],
    confidence: analysis.confidence || '',
    cachedAt: Date.now(),
    hitCount: (all[key]?.hitCount || 0) + 1,
  }
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2), 'utf8')
}

/** 命中计数 +1 */
export function bumpVisionHit(category, dimName) {
  const all = loadVisionCache()
  const key = `${String(category || '').trim()}::${String(dimName || '').trim()}`
  if (all[key]) {
    all[key].hitCount = (all[key].hitCount || 0) + 1
    all[key].lastHitAt = Date.now()
    try { fs.writeFileSync(STORE, JSON.stringify(all, null, 2), 'utf8') } catch { /* ignore */ }
  }
}
