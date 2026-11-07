/**
 * pdd-sign.mjs —— 签名统一入口（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么做这个（2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * 基座里有两个签名模块，能力其实**不重叠**，但调用方一直分不清该用哪个：
 *
 *   pdd-antistring.mjs  99 行  纯 Node 生成**简化签名**（40 字符）
 *                              btoa(时间戳+校验和)+"_"+21位随机串
 *   pdd-risksdk.mjs    271 行  浏览器内注入生成**真签名**（407~418 字符）+ PUA 解码
 *
 * 历史调用方式（各写各的）：
 *   pdd-http.t1     → getAntiString()              纯 Node 简化签名
 *   pdd-client.t2   → session.genSig()             浏览器真签名
 *   promo / activity → 页面 hook 抓 __sigPair       白嫖页面自己的
 *
 * 三条路径并存，且**没有统一判断"该用哪种"**。这个模块做统一分发：
 *
 *   const sig = await sign({ url, page, shopKey })
 *   // 内部按 pdd-transport.pickTier(url) 决定走哪种签名
 *
 * ══════════════════════════════════════════════════════════════════
 * 三种来源的可靠性（实测）
 * ══════════════════════════════════════════════════════════════════
 *
 *   ① 页面 hook 抓到的（__sigPair）—— 最真实，平台自己刚用的
 *      缺点：只有页面刚发过同类请求才有
 *   ② 浏览器真签名（risksdk / fbeZ 模块）—— 稳定，407~450 字符
 *      缺点：要开浏览器
 *   ③ 纯 Node 简化签名（antistring）—— 最快，40 字符
 *      缺点：只对宽松域有效（/vodka/ /glide/ 实测不够）
 *
 * 分发规则：
 *   t1 通道 → ③ 简化签名
 *   t2/t3   → ① 有就先用页面 hook 的，否则 ② 现生成
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const load = (f) => import(pathToFileURL(path.join(HERE, f)).href)

let _antistring = null
let _risksdk = null
let _transport = null
async function mods() {
  if (!_antistring) _antistring = await load('pdd-antistring.mjs').catch(() => null)
  if (!_risksdk) _risksdk = await load('pdd-risksdk.mjs').catch(() => null)
  if (!_transport) _transport = await load('pdd-transport.mjs').catch(() => null)
  return { antistring: _antistring, risksdk: _risksdk, transport: _transport }
}

/**
 * 统一签名
 *
 * @param {object} o
 * @param {string} o.url            目标接口（用于判通道）
 * @param {object} [o.page]         puppeteer page（t2/t3 需要）
 * @param {string} [o.shopKey]
 * @param {'auto'|'t1'|'t2'|'t3'} [o.tier]  可强制指定，默认按 url 自动判
 * @param {boolean} [o.preferPageHook=true] 优先用页面已抓到的签名
 * @returns {Promise<{ ok: boolean, sig: string, source: string, len: number, err?: string }>}
 */
export async function sign(o = {}) {
  const { url = '', page, shopKey, tier: forceTier, preferPageHook = true } = o
  const m = await mods()
  const tier = forceTier || (m.transport?.pickTier ? m.transport.pickTier(url) : 't2')

  // ── ① 页面 hook（最真实，优先）──
  if (preferPageHook && page && tier !== 't1') {
    try {
      const v = await page.evaluate(() => {
        const p = window.__sigPair
        if (p?.anti) return { sig: p.anti, crawler: p.crawlerInfo }
        if (window.__AC?.v) return { sig: window.__AC.v, crawler: null }
        return null
      })
      // 页面 hook 的签名要够长才可信（简化签名只有 40 字符）
      if (v?.sig && v.sig.length >= 200) {
        return { ok: true, sig: v.sig, source: 'page-hook', len: v.sig.length, crawlerInfo: v.crawler }
      }
    } catch { /* 页面可能已关 */ }
  }

  // ── ③ t1：纯 Node 简化签名 ──
  if (tier === 't1') {
    const s = m.antistring?.getAntiString?.()
    if (s) return { ok: true, sig: s, source: 'antistring', len: s.length }
    return { ok: false, sig: '', source: 'antistring', len: 0, err: 'pdd-antistring 不可用' }
  }

  // ── ② t2/t3：需要浏览器真签名 ──
  if (!page) {
    return { ok: false, sig: '', source: 'risksdk', len: 0, err: 't2/t3 需要 page（或传 tier:"t1" 强制简化签名）' }
  }
  try {
    // 真签名由 pdd-client 的 session 提供；这里接受传入的 page 上的生成器
    const v = await page.evaluate(() => {
      if (typeof window.__pddGenRiskSig === 'function') return window.__pddGenRiskSig()
      return null
    })
    if (v && String(v).length >= 200) {
      return { ok: true, sig: String(v), source: 'risksdk-inpage', len: String(v).length }
    }
  } catch { /* ignore */ }

  return {
    ok: false, sig: '', source: 'risksdk', len: 0,
    err: '页面内没有签名生成器。t2/t3 请用 pdd-client.createSession() 起的 page（它会注入 RISK_SDK_INJECT）',
  }
}

/** PUA 解码（risksdk 的能力，从这里统一暴露） */
export const buildPuaMap = (...a) => _risksdk?.buildPuaMap?.(...a)
export const decodePua = (...a) => _risksdk?.decodePua?.(...a)
export const hasPua = (...a) => _risksdk?.hasPua?.(...a)

/** 简化签名（直通，兼容老调用） */
export const getAntiString = (...a) => _antistring?.getAntiString?.(...a)

/** 自检 */
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const t1 = await sign({ url: '/sydney/api/mallFlow/getMallFlowData', tier: 't1' })
  console.log('t1（简化签名）:', t1.ok, '| 长度', t1.len, '| 来源', t1.source)
  const t2 = await sign({ url: '/vodka/v2/mms/query/sku/info' })
  console.log('t2（无 page）:', t2.ok, '| err:', String(t2.err).slice(0, 60))
  console.log('预期：t1 成功（40 字符），t2 失败并提示需要 page')
}
