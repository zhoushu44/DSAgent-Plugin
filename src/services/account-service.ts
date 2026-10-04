/**
 * 账号服务：账号连接器页与账号类工具的唯一数据出口。
 *
 * 不依赖任何外部网关，凭证自己存在本地 CredentialStore。
 *
 * 数据来源：
 *   1. 本地 CredentialStore（dsagent-accounts.json）
 *   2. 内置回退数据（无数据时用于预览，保证页面不报错）
 *
 * 安全：Cookie 只存在 CredentialStore 中，不出插件。
 */

import { CredentialStore, type StoredAccount, keyCookies, credentialPlatform, isPseudoNick, PLATFORM_PREFIX, resolveAccountForRequest, normalizePlatform, accountsForPlatform, planCascadeDisconnect } from './credential-store.js'
import type { AccountRow, AccountStatus, HealthRow, BindingContext } from './types.js'

/** 掩码 AppSecret：前 4 位明文 + •••• */
function maskSecret(s: string): string {
  if (!s) return ''
  return s.length <= 4 ? '••••' : s.slice(0, 4) + '••••'
}

/** 平台登录入口 URL（扫码用） */
const LOGIN_URLS: Record<string, string> = {
  taobao: 'https://login.taobao.com/member/login.jhtml',
  tmall: 'https://login.taobao.com/member/login.jhtml',
  sycm: 'https://sycm.taobao.com/',
  alimama: 'https://one.alimama.com/',
  dmp: 'https://dmp.taobao.com/',
  sycm_insight: 'https://sycm.taobao.com/',
  jd: 'https://passport.jd.com/new/login.aspx',
  pdd: 'https://mobile.yangkeduo.com/login.html',
  // ★ 拼多多商家后台登录页（与买家 H5 不同）：有「扫码登录 / 账号密码登录 / 立即注册」三个入口
  pdd_mms: 'https://mms.pinduoduo.com/login',
  douyin: 'https://www.douyin.com/',
  xhs: 'https://www.xiaohongshu.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://passport.bilibili.com/login',
  kuaishou: 'https://passport.kuaishou.com/pc/account/login',
  wechat_mp: 'https://mp.weixin.qq.com/',
  // ★ 闲鱼登录页必须是 /login（独立扫码页，有二维码 iframe）；首页无法完成真实登录
  xianyu: 'https://www.goofish.com/login',
  pinduoduo: 'https://mobile.yangkeduo.com/login.html',
  wechat_store: 'https://channels.weixin.qq.com/shop',
  zhihu: 'https://www.zhihu.com/signin',
}

/** 内置回退数据：仅用于无数据时的可视预览 */
const FALLBACK_ACCOUNTS: AccountRow[] = [
  // status 绝不能硬编码为 valid：预览兜底不该制造「账号有效」的假象（FIX-LOG：淘宝远端失效仍显示有效）。
  // 用 pending 让 UI 显示「待验证」，不承诺任何有效性。
  { shopKey: 'taobao_2218891961201', accountId: 'a1', platformId: 'taobao', nickname: 'tb957985228335', platformUid: '2218891961201', status: 'pending', lastCheckAt: '2026-09-17 14:20', syncServices: [], boundAgentName: '默认智能体' },
]

/**
 * 业务平台 -> 凭证平台。
 * 直接复用 credential-store.ts 的 credentialPlatform()，它同时处理别名归一化
 * （xiaohongshu -> xhs、pinduoduo -> pdd）与凭证层复用（生意参谋系 sycm/万相台/达摩盘/天猫洞察 -> taobao、
 * 闲鱼 -> taobao）。此处**禁止**再维护一份副本，否则两端漂移会导致绑定查询匹配不到账号。
 */
const toCredentialPlatform = credentialPlatform

/** 昵称前缀表：从 credential-store 统一引入，禁止本地再维护副本 */

/**
 * 生成展示昵称。
 * 凭证库里 display_label 可能是伪昵称（等于 account_id、或等于「前缀 + account_id」、
 * 或 Cookie 原始值截断后的乱码串），此时视为「无昵称」，必须回退到「平台前缀 + account_id」。
 * API Key 账号的 display_label 就是 AppID，直接使用。
 */
function toNickname(platform: string, label: string | undefined, accountId: string, authType?: string): string {
  // API Key 账号：display_label = AppID，直接用
  if (authType === 'apikey') return label || accountId
  if (label && !isPseudoNick(label, platform, accountId)) return label
  const prefix = PLATFORM_PREFIX[platform] || platform
  return accountId ? `${prefix}${accountId}` : (label || '')
}

/** 将 StoredAccount 转为 AccountRow */
function toRow(a: StoredAccount): AccountRow {
  const isApiKey = a.auth_type === 'apikey'
  return {
    shopKey: a.shop_key,
    accountId: a.account_id,
    platformId: a.platform,
    nickname: toNickname(a.platform, a.display_label || a.account_meta?.display_nick, a.account_id, a.auth_type),
    platformUid: a.account_id,
    status: a.status,
    lastCheckAt: a.last_checked_at?.replace('T', ' ').slice(0, 16) || '—',
    syncServices: [],
    boundAgentName: a.bound_agent_ids?.join(', ') || '—',
    boundAgentIds: [...(a.bound_agent_ids || [])],
    // 三种异常态各给**不同**的 reason（用户据此知道该做什么）：
    //   reauth_required —— 确定要重登，重试无用
    //   expired         —— 疑似失效，可先重试
    //   invalid         —— Cookie 结构坏了，需删除重加
    expireReason: a.status === 'reauth_required'
      ? '登录态已失效，必须重新登录'
      : a.status === 'expired'
        ? '登录态疑似过期，可先重试；仍失败请重新登录'
        : a.status === 'invalid'
          ? 'Cookie 已失效，请重新登录'
          : null,
    authType: a.auth_type || 'cookie',
    appId: isApiKey ? (a.app_id || '') : undefined,
    secretHint: isApiKey ? maskSecret(a.app_secret || '') : undefined,
  }
}

/** 调用 host 半区工具的桥接函数 —— browser 半区通过 HTTP 路由调 host 工具 */
async function callHostTool<T>(action: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const resp = await fetch('/dsagent/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...args }),
    })
    if (!resp.ok) return null
    return await resp.json() as T
  } catch {
    return null
  }
}

export function createAccountService(storePath: string) {
  const store = new CredentialStore(storePath)

  return {
    /** 列出账号，可按平台过滤 */
    async list(platform?: string): Promise<AccountRow[]> {
      // 优先通过 HTTP 路由从 host 半区获取（browser 半区不能直接读本地文件）
      const res = await callHostTool<{ ok: boolean; rows: any[] }>('list_accounts', {})
      if (res?.ok && res.rows?.length) {
        const rows: AccountRow[] = res.rows.map(r => {
          const id = String(r.accountId || '')
          const plat = String(r.platform || '')
          const authType = r.authType || 'cookie'
          return {
            shopKey: String(r.shopKey || ''),
            accountId: id,
            platformId: plat,
            nickname: toNickname(plat, r.displayLabel, id, authType),
            platformUid: id,
            status: r.status || 'pending',
            lastCheckAt: r.lastCheckAt || '',
            syncServices: [],
            boundAgentName: r.boundAgentName || (Array.isArray(r.boundAgentIds) ? r.boundAgentIds.join(', ') : ''),
            boundAgentIds: Array.isArray(r.boundAgentIds) ? r.boundAgentIds : [],
            authType: authType as AccountRow['authType'],
            appId: r.appId || undefined,
            secretHint: r.secretHint || undefined,
            // 与本地 toRow 保持一致的失效原因推导，供 UI 悬停提示
            expireReason: r.status === 'reauth_required' ? (r.expireReason || '登录态已失效，必须重新登录')
              : r.status === 'expired' ? (r.expireReason || '登录态疑似过期，可先重试；仍失败请重新登录')
                : r.status === 'invalid' ? 'Cookie 已失效，请重新登录' : null,
          }
        })
        return platform ? rows.filter(r => r.platformId === platform || toCredentialPlatform(r.platformId) === toCredentialPlatform(platform)) : rows
      }
      // 降级：直接读本地文件（host 半区或非 DSH 环境）
      const accounts = store.listAccounts()
      if (!accounts.length) return [...FALLBACK_ACCOUNTS]
      const localRows = accounts.map(toRow)
      return platform ? localRows.filter(r => r.platformId === platform || toCredentialPlatform(r.platformId) === toCredentialPlatform(platform)) : localRows
    },

    /** 检查登录态健康度 */
    async checkHealth(platform?: string): Promise<HealthRow[]> {
      const rows = await this.list(platform)
      return rows.map(r => ({
        platformId: r.platformId,
        nickname: r.nickname,
        status: r.status,
        reason: r.expireReason ?? undefined,
      }))
    },

    /** 该平台是否已绑定有效账号 */
    async isBound(platform: string): Promise<boolean> {
      if (!platform || !platform.trim()) return false
      const rows = await this.list(platform)
      return rows.some(r => r.status === 'valid' || r.status === 'pending')
    },

    /** 根据关键词自动查找匹配的账号 */
    async findByKeyword(keyword: string, platform?: string): Promise<AccountRow[]> {
      const allRows = await this.list(platform)
      if (!keyword || !keyword.trim()) return allRows

      const tokens = extractTokens(keyword)
      const lowerKeyword = keyword.toLowerCase()

      const tokenMatches: AccountRow[] = []
      if (tokens.length > 0) {
        for (const row of allRows) {
          for (const token of tokens) {
            if (row.platformUid.includes(token) || row.accountId.includes(token) || row.nickname.includes(token)) {
              tokenMatches.push(row)
              break
            }
          }
        }
      }

      const fuzzyMatches = allRows.filter(r =>
        r.nickname.toLowerCase().includes(lowerKeyword) ||
        r.platformId.toLowerCase().includes(lowerKeyword)
      )

      const seen = new Set<string>()
      const merged: AccountRow[] = []
      for (const row of [...tokenMatches, ...fuzzyMatches]) {
        if (!seen.has(row.accountId)) {
          seen.add(row.accountId)
          merged.push(row)
        }
      }

      return merged
    },

    /**
     * 获取账号绑定上下文。
     *
     * 选择链与网关共用 `resolveAccountForRequest`（见 credential-store.ts）：
     * ① 显式 shopKey → ② 当前会话绑定 → ③ 平台默认 → ④ 自动兜底。
     * 走到第 ④ 级且有多个可用账号时**不静默选择**，返回 failureKind='need_account_choice'
     * + choices，由模型向用户提问（静默选错号的代价会放大到所有技能）。
     *
     * `shopKey`：用户在上一轮 `need_account_choice` 里选定后，模型回传的账号主键。
     */
    async fetchBindingContext(platform: string, agentId?: string, shopKey?: string): Promise<BindingContext | null> {
      if (!platform || !platform.trim()) return null
      const bizPlatform = normalizePlatform(platform)
      const credPlatform = toCredentialPlatform(platform)
      const rows = await this.list(credPlatform)
      // 候选集必须与网关（gateway-proxy.ts::handleProxy）同一套语义 —— 直接复用
      // credential-store.ts::accountsForPlatform()：精确平台优先，其次凭证所有者平台
      // （如 sycm 请求取 taobao 账号 —— 淘宝登录后生意参谋即可用），最后才放宽到凭证层派生账号；
      // 闲鱼/天猫**禁止**降级（域名不同、Cookie 域不同，选到淘宝号会静默失效）。
      //
      // 修复前这里用 credPlatform 做精确匹配（闲鱼 → taobao），把淘宝账号混进了闲鱼候选集，
      // 于是淘宝账号上的 `default` 绑定会在闲鱼请求里命中第 ③ 级 → 闲鱼也报 token_expired。
      const skipDegrade = bizPlatform === 'xianyu' || bizPlatform === 'tmall'
      const candidates = accountsForPlatform(store.listAccounts(), bizPlatform, {
        allowDegrade: !skipDegrade,
      })
      if (!candidates.length) return null

      // 账号选择链：① 显式 shopKey → ② 会话绑定 → ③ 平台默认 → ④ 派生闲鱼优先 → ⑤ 自动兜底。
      // 第 ④ 级需要全库行（同号淘宝行）作派生证据，而闲鱼候选集不允许降级，故传全库行。
      const resolved = resolveAccountForRequest(candidates, {
        agentId,
        shopKey,
        allAccounts: store.listAccounts(),
      })
      if (!resolved.account) {
        return {
          shopKey: '',
          sessionHint: 'none',
          displayLabel: '',
          tbToken: null,
          platformId: platform,
          accountId: '',
          nickname: '',
          failureKind: 'need_account_choice',
          choices: resolved.choices,
        }
      }

      const picked = resolved.account
      // sessionHint 细化：valid→ok, pending→none, reauth_required→reauth_required, 其余→expired
      //
      // ★ `reauth_required` 单独一档：它表示连续探测失败已达阈值、重试无用。
      //   下游据此报 failureKind='token_expired' 且文案明确要求「重新登录」，
      //   而 `expired`（疑似失效）仍走原来的模糊引导，两者不再混同。
      const sessionHint = picked.status === 'valid' ? 'ok'
        : picked.status === 'pending' ? 'none'
        : picked.status === 'reauth_required' ? 'reauth_required'
        : 'expired'
      const row = rows.find(r => r.shopKey === picked.shop_key)
      return {
        shopKey: picked.shop_key,
        sessionHint,
        displayLabel: row?.nickname || picked.display_label,
        tbToken: picked.tb_token || null,
        platformId: picked.platform,
        accountId: picked.account_id,
        nickname: row?.nickname || picked.display_label,
      }
    },

    /**
     * 启动浏览器登录 —— 通过 host 半区工具启动 Playwright 浏览器
     *
     * host 半区的 dsagent_browser_login 工具会：
     *   1. 启动 Playwright 浏览器
     *   2. 导航到平台登录页
     *   3. 等待用户扫码/登录
     *   4. 轮询关键 Cookie 出现
     *   5. 提取 Cookie 并通过 CredentialStore.save() 存储
     *
     * opts.freshLogin：为 true 时用全新空浏览器环境登录，
     * 用于在同一平台添加「其他账号」，避免复用已绑定账号的登录态。
     * opts.shopKey：「重新登录」时传入被刷新账号的凭证库主键，
     * 登录成功后 host 侧会替换旧条目并继承绑定关系。
     */
    async startLogin(platform: string, _method?: string, opts?: {
      appId?: string
      appSecret?: string
      cookieStr?: string
      freshLogin?: boolean
      shopKey?: string
    }): Promise<{ ok: boolean; error?: string }> {
      // ★ 闲鱼 / 生意参谋系 / 天猫均**不可独立登录**（FIX-LOG #67 / #70）：
      //   它们复用淘宝 SSO，凭证层已直接复用淘宝登录态，不应派生独立账号。
      //   闲鱼的 goofish 域 Cookie 由淘宝登录成功后自动同步（见 browser-login.ts::ensureXianyuFromTaobao），
      //   因此这里不再有 sso 分支，统一走 browser_login。
      const loginUrl = LOGIN_URLS[platform] || LOGIN_URLS[toCredentialPlatform(platform)]
      if (!loginUrl) return { ok: false, error: `不支持的平台：${platform}` }

      // 调用 host 半区的浏览器登录工具
      const res = await callHostTool<{ ok: boolean; error?: string; accountId?: string }>(
        'browser_login',
        {
          platform,
          loginUrl,
          freshLogin: opts?.freshLogin === true,
          shopKey: opts?.shopKey || '',
        },
      )
      if (!res) {
        // host 工具不可用（可能不在 DSH 环境中），降级提示
        return { ok: false, error: '浏览器登录工具不可用，请确认插件已正确加载' }
      }
      return { ok: res.ok, error: res.error }
    },

    /** 关闭登录窗口 */
    async closeLogin(): Promise<{ ok: boolean; error?: string }> {
      const res = await callHostTool<{ ok: boolean; error?: string }>(
        'browser_close',
        {},
      )
      if (!res) return { ok: false, error: '浏览器工具不可用' }
      return { ok: res.ok, error: res.error }
    },

    /**
     * 轮询本地凭证库，检测是否有新账号出现
     */
    async waitForNewAccount(before: { platform: string; accountIds: string[] }, opts?: {
      maxAttempts?: number
      intervalMs?: number
      isCancelled?: () => boolean
    }): Promise<{ status: 'success' | 'expired' | 'failed'; account?: AccountRow; error?: string }> {
      const maxAttempts = opts?.maxAttempts ?? 40
      const intervalMs = opts?.intervalMs ?? 3000
      const isCancelled = opts?.isCancelled ?? (() => false)
      for (let i = 0; i < maxAttempts; i++) {
        if (isCancelled()) return { status: 'failed', error: '用户取消' }
        await new Promise(r => setTimeout(r, intervalMs))
        store.reload() // 强制重新从磁盘读取
        const rows = await this.list(before.platform)
        const newRows = rows.filter(r => !before.accountIds.includes(r.accountId))
        if (newRows.length > 0) {
          return { status: 'success', account: newRows[0] }
        }
      }
      return { status: 'expired', error: '轮询超时（120s），请确认是否已完成登录' }
    },

    /**
     * 手动导入 Cookie —— 直接存入 CredentialStore
     */
    async submitLoginCookie(platform: string, cookieStr: string): Promise<{
      ok: boolean
      account?: AccountRow
      error?: string
    }> {
      try {
        // 委托 host 半区解析并存储 Cookie（host 有 fs 和 crypto）
        const res = await callHostTool<{ ok: boolean; error?: string; shopKey?: string }>(
          'save_cookie',
          { platform, cookieStr },
        )
        if (!res) return { ok: false, error: '存储工具不可用' }
        if (!res.ok) return { ok: false, error: res.error }
        store.reload()
        const accounts = store.listAccounts()
        const saved = accounts.find(a => a.shop_key === res.shopKey)
        if (saved) return { ok: true, account: toRow(saved) }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: `导入失败：${err instanceof Error ? err.message : String(err)}` }
      }
    },

    /** 提交 AppID+Secret —— 通过 host 半区保存为 API Key 凭证 */
    async submitLoginAppId(platform: string, appId: string, appSecret: string): Promise<{
      ok: boolean
      account?: AccountRow
      error?: string
    }> {
      try {
        const res = await callHostTool<{ ok: boolean; error?: string; shopKey?: string }>(
          'save_apikey',
          { platform, appId, appSecret },
        )
        if (!res) return { ok: false, error: '保存工具不可用' }
        if (!res.ok) return { ok: false, error: res.error }
        store.reload()
        const accounts = store.listAccounts()
        const saved = accounts.find(a => a.shop_key === res.shopKey)
        if (saved) return { ok: true, account: toRow(saved) }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: `保存失败：${err instanceof Error ? err.message : String(err)}` }
      }
    },

    /** 删除账号 —— browser 半区不能读写本地文件，必须走 host 路由 */
    async deleteAccount(shopKey: string): Promise<{ ok: boolean; error?: string; profileCleaned?: boolean; profileNote?: string }> {
      if (!shopKey) return { ok: false, error: '无效的 shopKey' }
      const res = await callHostTool<{ ok: boolean; error?: string; profileCleaned?: boolean; profileNote?: string; cascadeSummary?: string }>('delete_account', { shopKey })
      if (!res) return { ok: false, error: '删除失败：无法连接 host 半区' }
      return res
    },

    /**
     * 预演「断开该账号会影响谁」—— 供删除前的二次确认展示。
     *
     * 对应 Accio 的 `managedShopDisconnectGroup`（按逻辑店铺整组断开的提示语义）：
     * 删掉淘宝账号会连带影响生意参谋系（凭证层借用）与闲鱼（自动派生），
     * 用户应当在确认前就知道，而不是删完发现别的技能也不能用了。
     */
    async planDisconnect(shopKey: string): Promise<{ ok: boolean; summary: string; affected: string[] }> {
      const accounts = store.listAccounts()
      const plan = planCascadeDisconnect(shopKey, accounts)
      return {
        ok: true,
        summary: plan.summary,
        affected: plan.affected.map(a => a.shop_key),
      }
    },

    /** 绑定会话（= 智能体，同一个 id）—— 必须走 host 路由 */
    async bindAgent(shopKey: string, agentId: string): Promise<{ ok: boolean; error?: string }> {
      if (!shopKey || !agentId) return { ok: false, error: '缺少 shopKey / agentId' }
      const res = await callHostTool<{ ok: boolean; error?: string }>('bind_agent', { shopKey, agentId })
      if (!res) return { ok: false, error: '绑定失败：无法连接 host 半区' }
      return res
    },

    /** 解绑会话 —— 同上，必须走 host 路由 */
    async unbindAgent(shopKey: string, agentId: string): Promise<{ ok: boolean; error?: string }> {
      if (!shopKey || !agentId) return { ok: false, error: '缺少 shopKey / agentId' }
      const res = await callHostTool<{ ok: boolean; error?: string }>('unbind_agent', { shopKey, agentId })
      if (!res) return { ok: false, error: '解绑失败：无法连接 host 半区' }
      return res
    },

    /**
     * 会话（= 智能体）列表 —— 绑定下拉的数据源。
     * cordis 的 agents 服务只在 host 半区可见，browser 半区必须走 HTTP 路由取。
     * Agent 只有 id（无人类可读名），故下拉项只能显示 id。
     */
    async listAgents(): Promise<{ id: string }[]> {
      const res = await callHostTool<{ ok: boolean; agents?: { id: string }[] }>('list_agents', {})
      return res?.ok && Array.isArray(res.agents) ? res.agents : []
    },

    /**
     * 真实健康检查 —— 本地 Cookie 结构检查 + 远程轻量探测（#55）。
     *
     * 每个账号先做本地关键 Cookie 结构检查，缺失即标记 expired；
     * 通过后再经 host 路由 probe_session 发起一次远程轻量探测
     * （当前仅小红书支持，其他平台返回 unknown 不做误判）。
     * 远端判定为游客态时标记 expired 并回写凭证库。
     */
    async checkHealthReal(platform?: string): Promise<HealthRow[]> {
      const rows = await this.list(platform)
      const results: HealthRow[] = []

      for (const row of rows) {
        const stored = store.findByPlatform(row.platformId)
        if (!stored) {
          results.push({ platformId: row.platformId, nickname: row.nickname, status: row.status, reason: row.expireReason ?? undefined })
          continue
        }

        // 仅检查 valid/pending 状态的账号（已失效的不再探测）
        if (row.status !== 'valid' && row.status !== 'pending') {
          results.push({ platformId: row.platformId, nickname: row.nickname, status: row.status, reason: row.expireReason ?? undefined })
          continue
        }

        // 本地 Cookie 基础检查
        const kc = keyCookies(row.platformId)
        const cookieJar = stored.cookies || {}
        const hasKeyCookies = kc.length > 0 && kc.every(name => cookieJar[name])

        if (!hasKeyCookies) {
          // 关键 Cookie 缺失，标记过期
          await store.setStatus(stored.shop_key, 'expired')
          results.push({ platformId: row.platformId, nickname: row.nickname, status: 'expired', reason: '关键 Cookie 缺失' })
          continue
        }

        // 远程轻量探测：本地 Cookie 结构完整 ≠ 登录态有效（#55）。
        // 服务端可让 web_session 失效（风控 / 异地登录 / 过期），此时本地 Cookie 完好，
        // 账号页仍显示「有效」，用户被误导。由 host 半区发起探测（browser 半区无法跨域）。
        // 落库由 host 侧 recordSessionProbe 按连续失败计数决定（规范 §5.0），
        // 此处只读回结果，避免两端各写一次状态。
        const probe = await callHostTool<{
          ok: boolean
          result: string
          reason?: string
          status?: string
          failCount?: number
        }>('probe_session', { shopKey: stored.shop_key })
        if (probe?.ok && probe.result === 'expired') {
          // 未达阈值时 host 侧不落库，页面保持原状态，只在 reason 里提示进度
          //
          // ★ 达阈值后 host 侧落的是 `reauth_required`（不是 `expired`），故这里
          //   必须按 probe.status 原样透出 —— 写死 'expired' 会把「必须重登」降级成
          //   「疑似过期」，用户又回到反复重试的老路。
          const reached = probe.status === 'reauth_required' || probe.status === 'expired'
          if (reached) {
            const finalStatus: AccountStatus = probe.status === 'reauth_required' ? 'reauth_required' : 'expired'
            results.push({
              platformId: row.platformId,
              nickname: row.nickname,
              status: finalStatus,
              reason: probe.reason
                || (finalStatus === 'reauth_required'
                  ? '登录态已失效，必须重新登录'
                  : '登录态疑似过期（可先重试）'),
            })
            continue
          }
        }

        // 探测通过或无法判定（平台未支持 / 网络异常）→ 保持原状态
        results.push({ platformId: row.platformId, nickname: row.nickname, status: row.status, reason: undefined })
      }

      return results
    },

    /** 获取指定账号的 Cookie 字符串（供技能执行时注入环境变量） */
    getCookieStr(shopKey: string): string {
      const account = store.get(shopKey)
      return account?.cookie_str || ''
    },

    /**
     * 查找账号，返回完整 StoredAccount（含 Cookie）。
     *
     * 优先按 `shopKey` 精确取（模型按用户选择回传的账号）；
     * 无 shopKey 时退回「平台 + 会话」查找。
     */
    findStoredAccount(platform: string, agentId?: string, shopKey?: string): StoredAccount | null {
      if (shopKey) {
        const hit = store.get(shopKey)
        if (hit) return hit
      }
      return store.findByPlatform(platform, agentId)
    },

    dispose() {
      // CredentialStore 无需显式释放
    },
    get isDisposed() {
      return false
    },
  }
}

export type AccountService = ReturnType<typeof createAccountService>

/**
 * 从自然语言中提取 token 关键词
 */
const ARG_TOKEN_RE = /(?<![0-9A-Za-z_])(\d{5,13}|[A-Za-z]{1,6}_?\d{3,12})(?![0-9A-Za-z])/g

export function extractTokens(text: string): string[] {
  if (!text) return []
  const seen: string[] = []
  for (const token of text.matchAll(ARG_TOKEN_RE)) {
    const t = token[1]
    if (t && !seen.includes(t)) seen.push(t)
  }
  return seen
}
