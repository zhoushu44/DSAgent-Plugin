/**
 * 锚点解析引擎（JSON 驱动发布引擎 · 第 2 步）。
 *
 * 消费 publish-config/{platform}.json 的 anchors：对每个锚点键按
 * candidates 顺序（L1 埋点 → L2 语义 → L3 容器相对）逐个尝试，
 * 第一个命中的即用——平台小改版（class 哈希后缀变）时第二候选自动顶上，
 * **零维护自愈**（PUBLISH-SPEC §3.5）。
 *
 * ★ 与既有代码的关系：本引擎只提供「定位」，不改变三平台已验证的
 * 「怎么填」（真实键盘 / native setter + 事件 / 三连点击等全部留在
 * 各平台文件里原样执行——改造纪律：行为零变化，不重写已验证实现）。
 *
 * ★ 失败要报证据：全候选失联时返回诊断信息（URL + 各候选尝试结果），
 *   供上层截屏落盘与巡检报告使用（L4 绝对路径仅供诊断，引擎永不生成）。
 */
import type { AnchorSpec } from './publish-config-loader.js'

/** Playwright Page/ElementHandle 的最小结构面（避免直接依赖平台类型） */
export interface AnchorPage {
  url(): string
  $(selector: string): Promise<{ boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> } | null>
}

export interface AnchorElement {
  ok: true
  handle: NonNullable<Awaited<ReturnType<AnchorPage['$']>>>
  selector: string
  candidateIndex: number
  level: number
}

export interface AnchorResolveFailure {
  ok: false
  key: string
  url: string
  attempts: Array<{ selector: string; level: number; reason: string }>
}

export type AnchorResolveResult = AnchorElement | AnchorResolveFailure

/** selector 是否 XPath（`//` 开头或 `(/` 开头） */
export function isXPath(selector: string): boolean {
  return selector.startsWith('//') || selector.startsWith('(/')
}

/**
 * XPath 形态转 puppeteer 选择器语法。
 *
 * ★ 宿主用 puppeteer-core（三平台统一，见各 publish 文件 `await import('puppeteer-core')`）：
 *   - `page.$x()` 已在 puppeteer v22 移除，不再可用；
 *   - XPath 走 CSS 伪选择器 `::-p-xpath(...)`（puppeteer ≥19 官方语法）；
 *   - Playwright 的 `xpath=` 前缀在这里**不可用**（曾踩坑：传给 page.$() 会当 CSS 解析报错）。
 *   - 页内 evaluate 消费 XPath 的场景（如 pdd fillShippingAndFreight 的 document.evaluate）
 *     不经过本函数，直接原样传字符串即可。
 */
function toPuppeteerSelector(selector: string): string {
  if (!isXPath(selector)) return selector
  // `::-p-xpath()` 参数内不能再裸套引号体——用 `::-p-xpath("...")` 包裹并转义内部双引号
  return `::-p-xpath("${selector.replace(/"/g, '\\"')}")`
}

/**
 * 解析一个锚点：candidates 逐个尝试，取第一个可见元素。
 * ★ 可见性判据与三平台现有做法对齐：元素存在即可用（有的平台控件离屏隐藏，
 *   如 pdd 详情图 input 是 off-screen 但 setInputFiles 可投递）——所以本函数
 *   只做「存在性」判定，不做可见性过滤；需要可见性的调用方自行 boundingBox 校验。
 */
export async function resolveAnchor(page: AnchorPage, key: string, spec: AnchorSpec): Promise<AnchorResolveResult> {
  const url = page.url()
  const attempts: Array<{ selector: string; level: number; reason: string }> = []
  for (let i = 0; i < spec.candidates.length; i++) {
    const cand = spec.candidates[i]
    try {
      const handle = await page.$(toPuppeteerSelector(cand.selector))
      if (handle) {
        return { ok: true, handle, selector: cand.selector, candidateIndex: i, level: cand.level }
      }
      attempts.push({ selector: cand.selector, level: cand.level, reason: '未命中（元素不存在）' })
    } catch (err) {
      attempts.push({ selector: cand.selector, level: cand.level, reason: `选择器非法或查询失败：${(err as Error).message}` })
    }
  }
  return { ok: false, key, url, attempts }
}

/** 失败结果转人类可读诊断（附全部候选尝试明细，改 JSON 的依据） */
export function formatAnchorFailure(f: AnchorResolveFailure): string {
  const lines = f.attempts.map((a, i) => `  候选${i + 1}(L${a.level}): ${a.selector} —— ${a.reason}`)
  return [
    `锚点 "${f.key}" 全部候选失联（页面：${f.url}）`,
    ...lines,
    '→ 平台疑似改版：请在 publish-config/ 里为该锚点补新候选（按 L1 埋点 > L2 语义 > L3 容器相对 顺序）。',
  ].join('\n')
}

/**
 * 便捷方法：解析锚点，失联时 throw（消息含诊断证据）。
 * 三平台改造点用这个——与原「selector 常量直查」的失败形态对齐（fail-fast），
 * 但多候选顺序是新增的自愈能力。
 */
export async function resolveAnchorOrThrow(page: AnchorPage, key: string, spec: AnchorSpec): Promise<AnchorElement> {
  const r = await resolveAnchor(page, key, spec)
  if (!r.ok) throw new Error(formatAnchorFailure(r))
  return r
}
