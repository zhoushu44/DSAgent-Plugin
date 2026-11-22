/**
 * pdd-cdp-harvest.mjs —— 用 CDP 逆向平台请求头签名（2026-11-19）
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 这个文件解决什么
 * ═══════════════════════════════════════════════════════════════════════
 * 拼多多的 mms 接口要求请求头带 `Anti-Content`（真签名，415~418 字符）。
 * 原先的生成方式是从页面 webpack 模块里 new 出签名器（模块 ID 硬编码为 eDaA），
 * 但平台随时可能改版 —— 一旦模块改名/移除，整条链路直接死。
 *
 * 本模块改为**用 CDP 从浏览器真实流量里取签名**，不依赖任何模块名：
 *
 *   ① Network.requestWillBeSent        → 拿到请求的 headers 快照
 *   ② Network.requestWillBeSentExtraInfo → 拿到**真实发出**的完整头（这里的 anti-content 才是有效值）
 *
 * ⚠️ 关键坑（实测）：requestWillBeSent 里的 `Anti-Content` 是**空字符串**
 *    或只有占位符 —— 它是在更晚的阶段才被填充的。
 *    必须监听 `requestWillBeSentExtraInfo` 才能拿到真实签名。
 *    这个差异排查了很久，务必保留。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 用法
 * ═══════════════════════════════════════════════════════════════════════
 *   const h = await createSignHarvester(page)
 *   const sig = await h.grab()        // 触发一次页面请求并抓签名
 *   h.dispose()
 *
 * 或者拿「URL → 签名」映射（同一 URL 用同一签名，命中率更高）：
 *   const map = await h.collect(15_000)
 *   const sig = map.get('/sydney/api/xxx')
 */

/**
 * @param {import('puppeteer-core').Page} page
 */
export async function createSignHarvester(page) {
  if (!page || page.isClosed()) throw new Error('page closed')

  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  /** 最近一次抓到的有效签名（任何 URL） */
  let latest = null
  /** path → 签名 */
  const byPath = new Map()

  const onExtra = (e) => {
    const h = e.headers || {}
    let sig = null
    for (const k of Object.keys(h)) {
      if (/^anti-content$/i.test(k)) {
        const v = String(h[k])
        if (v && v.length > 200) sig = v
      }
    }
    if (!sig) return
    latest = sig
    const p = h[':path'] || h[':Path']
    if (p) byPath.set(String(p).split('?')[0], sig)
  }
  cdp.on('Network.requestWillBeSentExtraInfo', onExtra)

  /** 触发页面自身的若干无害请求，促使平台注入签名 */
  const nudge = async () => {
    try {
      await page.evaluate(() => {
        const urls = [
          '/newjersy/api/mms/popup',
          '/cambridge/api/duoduoChicken/queryFagList',
          '/mms-gateway/mall/query/mall_info',
        ]
        for (const u of urls) {
          try {
            fetch(u, {
              method: 'POST', credentials: 'include',
              headers: { 'content-type': 'application/json' }, body: '{}',
            }).catch(() => {})
          } catch { /* ignore */ }
        }
      })
    } catch { /* 页面可能正在导航 */ }
  }

  return {
    /** 抓一个签名（任意 URL）。@returns {Promise<string|null>} */
    async grab(timeoutMs = 12_000) {
      if (latest) return latest
      const t0 = Date.now()
      await nudge()
      while (Date.now() - t0 < timeoutMs) {
        if (latest) return latest
        await new Promise(r => setTimeout(r, 200))
        if (Date.now() - t0 > timeoutMs / 2) await nudge()
      }
      return null
    },

    /** 收集 path→签名映射。@returns {Promise<Map<string,string>>} */
    async collect(timeoutMs = 15_000) {
      await nudge()
      await new Promise(r => setTimeout(r, timeoutMs))
      return byPath
    },

    /** 按接口路径取签名（先查映射，取不到退化为任意签名） */
    async grabForPath(pathname, timeoutMs = 12_000) {
      const key = String(pathname).split('?')[0]
      if (byPath.has(key)) return byPath.get(key)
      const s = await this.grab(timeoutMs)
      return s
    },

    dispose() {
      try { cdp.off('Network.requestWillBeSentExtraInfo', onExtra) } catch { /* ignore */ }
      try { cdp.detach() } catch { /* ignore */ }
    },
  }
}

/**
 * 判断当前页面是否已经被踢到登录页。
 *
 * ★ 2026-11-19：这是排查 pdd-shop goods 长期失败时发现的**真正根因**。
 *   现象极具误导性：所有 pdd 页面的 webpack 模块里都找不到 eDaA
 *   → 报 "eDaA module not found" → 看起来像「平台删了签名模块」。
 *   实际是页面停在 /login，压根没加载业务模块。
 *
 *   症状对照（一眼识别）：
 *     · 纯 Node 通道 overview/flow 正常，但需要浏览器的模式全失败
 *     · Cookie 里 PASS_ID 在，但任何 mms 页面都跳到 /login
 *     · anti-content 仍能生成（415~418 字符）
 *   → 结论：**Cookie 是旧的，服务端会话已失效，需重新扫码登录**。
 *     这不是代码问题，重试多少次都没用。
 *
 * @param {import('puppeteer-core').Page} page
 */
export async function isLoginPage(page) {
  try {
    const url = page.url() || ''
    if (/\/login/i.test(url)) return true
    const r = await page.evaluate(() => ({
      href: location.href,
      hasLoginForm: !!document.querySelector('input[placeholder*="手机号"], .login-form, [class*="login"]'),
      bodyHint: /扫码登录|账号登录/.test(document.body?.innerText || ''),
    })).catch(() => null)
    if (!r) return /\/login/i.test(url)
    return /\/login/i.test(r.href) || r.hasLoginForm || r.bodyHint
  } catch {
    return false
  }
}

export default { createSignHarvester, isLoginPage }
