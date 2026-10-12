/**
 * HTTP 路由层（host 半区）。
 *
 * 职责：注册 /dsagent/api 路由，处理 browser 半区（账号连接页 / 技能市场页）
 * 通过 webServer carrier service 发来的全部 action。
 *
 * 为什么需要它：browser 半区不能读写本地文件（node:fs 被打桩）、不能跨域访问
 * 平台域名、拿不到 cordis 服务 —— 所有涉及本地状态的操作都必须由 host 半区
 * 经此路由代为执行后回传。
 *
 * 物理隔离：本文件不 import index.ts；所有服务与函数由 index.ts 接线时注入
 * （仿 workflow/api.ts 的依赖注入模式），index.ts 原位置只留一行注册调用。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialStore } from './services/credential-store.js'
import type { SkillService } from './services/skill-service.js'
import type { PitfallMemory } from './services/pitfall-memory.js'
import type { ToolTriggerRegistry } from './services/tool-triggers.js'
import type { WorkflowApi } from './workflow/api.js'

/** 掩码 AppSecret：前 4 位明文 + ••••（账号列表回传给 browser 半区用） */
function maskSecret(s: string): string {
  if (!s) return ''
  return s.length <= 4 ? '••••' : s.slice(0, 4) + '••••'
}

/** 插件依赖注入：index.ts apply() 内创建的服务与函数，全部从这里进 */
export interface HttpRoutesDeps {
  ctx: Context
  /** 凭证库（list/probe/delete/bind/save） */
  store: CredentialStore
  /** 技能服务（list/quality/patch/setEnabled） */
  skill: SkillService
  /** 坑位记忆（stats/activeFor/list） */
  pitfalls: PitfallMemory
  /** 触发注册表（stats 诊断） */
  triggers: ToolTriggerRegistry
  /** 工作流 API（workflow_ 前缀 action 分发） */
  workflowApi: WorkflowApi
  /** 浏览器登录 / 关闭（browser-login.ts） */
  doBrowserLogin: typeof import('./browser-login.js').doBrowserLogin
  closeBrowser: typeof import('./browser-login.js').closeBrowser
  /** 风控验证（browser-login.ts） */
  riskVerify: typeof import('./browser-login.js').riskVerify
  /** 账号 Profile 清理（browser-login.ts） */
  removeAccountProfile: typeof import('./browser-login.js').removeAccountProfile
  /** 取平台最近一次风控验证入口（gateway-proxy.ts） */
  getLastVerifyUrlByPlatform: typeof import('./gateway-proxy.js').getLastVerifyUrlByPlatform
  /** 远程登录态探测（gateway-proxy.ts） */
  probeRemoteSession: typeof import('./gateway-proxy.js').probeRemoteSession
  /** 凭证工具（credential-store.ts） */
  parseCookieStr: typeof import('./services/credential-store.js').parseCookieStr
  resolveDisplayNick: typeof import('./services/credential-store.js').resolveDisplayNick
  loginOwnerPlatform: typeof import('./services/credential-store.js').loginOwnerPlatform
  planCascadeDisconnect: typeof import('./services/credential-store.js').planCascadeDisconnect
  /** 检查更新（版本比对三元组，来自 index.ts） */
  readLocalVersion: () => { version: string; commit: string; builtAt: string }
  fetchRemoteVersion: () => Promise<{ version: string; commit: string; ok: boolean; error?: string }>
  hasUpdate: (local: { version: string; commit: string }, remote: { version: string; commit: string }) => boolean
  /** 更新仓库地址（Release tag = latest 的滚动版本） */
  updateRepo: string
  /**
   * 技能启停后触发注册表失效回调：改写了 frontmatter（可能带 tool_triggers），
   * 注册表要跟着重建。index.ts 里对应 `triggersBuiltAt = 0`。
   */
  onTriggersInvalidated: () => void
}

/**
 * 注册 /dsagent/api 路由。webServer 是 browser 半区的 carrier service，
 * host 半区通过 ctx.inject 动态等待其就绪后再注册。
 */
export function registerHttpRoutes(deps: HttpRoutesDeps): void {
  const {
    ctx,
    store,
    skill,
    pitfalls,
    triggers,
    workflowApi,
    doBrowserLogin,
    closeBrowser,
    riskVerify,
    removeAccountProfile,
    getLastVerifyUrlByPlatform,
    probeRemoteSession,
    parseCookieStr,
    resolveDisplayNick,
    loginOwnerPlatform,
    planCascadeDisconnect,
    readLocalVersion,
    fetchRemoteVersion,
    hasUpdate,
    updateRepo,
    onTriggersInvalidated,
  } = deps

  ;(ctx as any).inject(['webServer'], (webCtx: any) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsagent/api',
        async handler(req: any, res: any) {
          // 鉴权：仅允许同源请求（防止跨站攻击）
          const origin = req.headers?.origin || req.headers?.referer || ''
          if (origin && !/^(https?:\/\/)(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?/.test(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '请求来源不可信' }))
            return
          }
          let body: any = {}
          try {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks).toString('utf8')
            if (raw) body = JSON.parse(raw)
          } catch { /* 忽略 */ }

          const { action, ...rest } = body

          try {
            if (action === 'browser_login') {
              const reqPlatform = String(rest.platform ?? '')
              // ★ 不可独立登录的平台（生意参谋系 / 天猫）：凭证层复用淘宝登录态，账号页无入口。
              //   少了这道守卫，模型可直接传 platform=sycm 重新制造出「账号页出现生意参谋」（FIX-LOG #67）。
              const owner = loginOwnerPlatform(reqPlatform)
              if (owner) {
                console.log(`[dsagent-http] browser_login 被拒: ${reqPlatform} 不可独立登录，应登录 ${owner}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  ok: false,
                  error: `「${reqPlatform}」复用 ${owner} 登录态，没有独立登录流程。请改为登录 ${owner}。`,
                }))
                return
              }
              const freshLogin = rest.freshLogin === true
              const replaceShopKey = String(rest.shopKey ?? '') || undefined
              console.log(`[dsagent-http] browser_login 请求收到: platform=${rest.platform}, loginUrl=${rest.loginUrl}, freshLogin=${freshLogin}, replaceShopKey=${replaceShopKey || '(none)'}`)
              const result = await doBrowserLogin(
                reqPlatform,
                String(rest.loginUrl ?? ''),
                store,
                { freshLogin, replaceShopKey },
              )
              console.log(`[dsagent-http] browser_login 返回: ok=${result.ok}, error=${result.error || '(none)'}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } else if (action === 'browser_close') {
              const result = await closeBrowser()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } else if (action === 'risk_verify') {
              // 风控验证助手：弹可见浏览器打开平台验证页，轮询等待用户过滑块并提取 x5sec 回写
              const platform = String(rest.platform ?? '')
              const explicitUrl = String(rest.verifyUrl ?? '').trim()
              const verifyUrl = explicitUrl || getLastVerifyUrlByPlatform(store, platform)
              console.log(`[dsagent-http] risk_verify 请求收到: platform=${platform}, url=${verifyUrl ? '(已提供)' : '(缺失)'}`)
              if (!verifyUrl) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, passed: false, error: '未找到该平台最近一次风控返回的验证入口，请先执行一次失败的技能以触发风控' }))
              } else {
                const result = await riskVerify(store, platform, verifyUrl)
                console.log(`[dsagent-http] risk_verify 返回: ok=${result.ok}, passed=${result.passed}, error=${result.error || '(none)'}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              }
            } else if (action === 'list_accounts') {
              const accounts = store.listAccounts()
              const rows = accounts.map(a => {
                const isApiKey = a.auth_type === 'apikey'
                const boundAgentIds = a.bound_agent_ids || []
                return {
                  shopKey: a.shop_key,
                  platform: a.platform,
                  accountId: a.account_id,
                  displayLabel: isApiKey ? (a.app_id || a.account_id) : resolveDisplayNick(a.display_label, a.cookies, a.account_id, a.platform),
                  status: a.status,
                  authType: a.auth_type || 'cookie',
                  appId: isApiKey ? (a.app_id || '') : '',
                  secretHint: isApiKey ? maskSecret(a.app_secret || '') : '',
                  // 绑定关系：browser 半区不能读本地文件，必须随行回传，
                  // 否则账号页「智能体」列经 HTTP 路径恒为空
                  boundAgentIds,
                  boundAgentName: boundAgentIds.length ? boundAgentIds.join(', ') : '',
                }
              })
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, rows }))
            } else if (action === 'probe_session') {
              // 远程登录态探测：本地 Cookie 结构完整 ≠ 登录态有效，
              // 服务端可让 web_session 失效（风控/异地登录/过期）而本地 Cookie 完好。
              // 由 host 半区发起请求（browser 半区无法跨域访问平台域名）。
              const shopKey = String(rest.shopKey ?? '')
              const acc = shopKey ? store.get(shopKey) : null
              if (!acc) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, result: 'unknown', error: '账号不存在' }))
              } else {
                const probe = await probeRemoteSession({
                  platform: acc.platform,
                  shop_key: acc.shop_key,
                  cookie_str: acc.cookie_str,
                  account_meta: acc.account_meta,
                })
                // 连续失败计数：单次探测失败不落 expired（规范 §5.0 / FIX-LOG #57），
                // 达到阈值才置位；探测成功则清零并恢复 valid（自愈历史误标）。
                // ★ risk_control（P1-1）走独立分支：风控/限流 ≠ 凭证失效，
                //   recordSessionProbe 对它既不计数也不改状态，此处只打日志提示冷却。
                const rec = await store.recordSessionProbe(acc.shop_key, probe.result)
                if (rec.flipped) {
                  console.log(`[dsagent-http] probe_session: ${acc.shop_key} → ${rec.status}（${probe.reason || ''}）`)
                } else if (probe.result === 'risk_control') {
                  console.log(`[dsagent-http] probe_session: ${acc.shop_key} 命中风控（${probe.reason || ''}），账号状态保持，稍后重试`)
                } else if (probe.result === 'expired') {
                  console.log(`[dsagent-http] probe_session: ${acc.shop_key} 探测失败 ${rec.failCount}/3，暂不置位`)
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  ok: true,
                  result: probe.result,
                  reason: probe.reason,
                  status: rec.status,
                  failCount: rec.failCount,
                }))
              }
            } else if (action === 'list_skills') {
              // 技能列表：browser 半区不能读本地文件（node:fs 被打桩），
              // 必须由 host 半区扫描 skillRoot 后回传，否则页面会回退到内置假数据
              const rows = await skill.list()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: true,
                rows: rows.map(s => ({
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  version: s.version,
                  platform: s.platform,
                  capability: s.capability,
                  risk: s.risk,
                  enabled: s.enabled,
                  dir: s.dir,
                  // 质量门禁结果（Accio 同量表）—— 供市场页展示分数与缺陷清单
                  quality: s.quality,
                  issues: s.issues,
                  // 现场修正层标记
                  hasPatch: s.hasPatch,
                  // 使用统计（本地 .skill-stats.json）
                  useCount: s.useCount,
                  lastUsedAt: s.lastUsedAt,
                  // 注意：刻意不回传 body 与 frontmatter —— 两者体积大且页面不需要，
                  // 回传会让技能列表响应膨胀数十倍（body 是整篇 SKILL.md）。
                })),
              }))
            } else if (action === 'set_skill_enabled') {
              // 启停技能：改写 SKILL.md frontmatter，必须由 host 半区落盘
              const skillId = String(rest.skillId ?? '')
              const enabled = rest.enabled === true
              if (!skillId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 skillId' }))
              } else {
                try {
                  await skill.setEnabled(skillId, enabled)
                  // 启停改写了 frontmatter（可能带 tool_triggers），触发注册表要跟着失效重建
                  onTriggersInvalidated()
                  console.log(`[dsagent-http] set_skill_enabled: skillId=${skillId}, enabled=${enabled}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: true }))
                } catch (err: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
                }
              }
            } else if (action === 'skill_quality') {
              // 质量总览：技能市场页的「质量」视图 + CI 断言的数据源
              try {
                const overview = await skill.qualityOverview()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, ...overview }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'skill_stats') {
              // 使用统计排行 + 长期未用候选（**仅列出，绝不自动删除**）
              try {
                const ranking = await skill.usageRanking()
                const idle = await skill.idleCandidates()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, ranking, idle }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'skill_patch') {
              // 读取某技能的 SKILL.patch.md（现场修正层）
              const patchSkillId = String(rest.skillId ?? '')
              try {
                const patch = patchSkillId ? await skill.patchOf(patchSkillId) : null
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, patch }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'trigger_stats') {
              // 触发注册表诊断：命中规则数 / 已提示会话数
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, stats: triggers.stats() }))
            } else if (action === 'pitfall_stats') {
              // 平台坑位记忆诊断
              try {
                const stats = await pitfalls.stats()
                const active = await pitfalls.activeFor({ skillId: String(rest.skillId ?? '') || undefined })
                const all = await pitfalls.list()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, stats, active, all: all.slice(0, 100) }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'delete_account') {
              // 删除账号：按凭证库主键 shopKey 删除（browser 半区不能读写本地文件，必须走此路由）
              const shopKey = String(rest.shopKey ?? '')
              if (!shopKey) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey' }))
              } else {
                // ★ 删除前先算出级联影响（数据驱动的派生关系，见 credential-store.ts 的
                //   DERIVATION_REGISTRY / planCascadeDisconnect）：删淘宝会波及生意参谋系与闲鱼。
                //   必须在**删除前**算 —— 删完目标行就查不到 unb，身份无从判定。
                const cascade = planCascadeDisconnect(shopKey, store.listAccounts())
                const ok = await store.deleteByShopKey(shopKey)
                // ★ 凭证删除成功后再清账号专属 Profile（browser-profiles/accounts/{shopKey}）。
                //   顺序不能反：Profile 被占用删不掉时，账号必须仍然删得掉，所以这里只记结果不抛错。
                const profile = ok ? removeAccountProfile(shopKey) : { cleaned: false, note: '账号不存在' }
                console.log(`[dsagent-http] delete_account: shopKey=${shopKey}, ok=${ok}, profile=${profile.cleaned ? 'cleaned' : profile.note}${cascade.summary ? `, cascade=${cascade.summary}` : ''}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(ok
                  ? {
                      ok: true,
                      profileCleaned: profile.cleaned,
                      profileNote: profile.cleaned ? undefined : profile.note,
                      // 把级联影响回传给 UI / 模型，让用户知道「还影响了什么」
                      ...(cascade.summary ? { cascadeSummary: cascade.summary } : {}),
                      ...(cascade.affected.length ? { cascadeAffected: cascade.affected.map(a => a.shop_key) } : {}),
                    }
                  : { ok: false, error: '账号不存在' }))
              }
            } else if (action === 'bind_agent') {
              // 绑定智能体：在已有 bound_agent_ids 基础上追加
              const shopKey = String(rest.shopKey ?? '')
              const agentId = String(rest.agentId ?? '').trim()
              if (!shopKey || !agentId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey / agentId' }))
              } else {
                const existing = store.get(shopKey)
                if (!existing) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: '账号不存在' }))
                } else {
                  const agentIds = [...(existing.bound_agent_ids || [])]
                  if (!agentIds.includes(agentId)) agentIds.push(agentId)
                  const saved = await store.setBindings(shopKey, agentIds)
                  console.log(`[dsagent-http] bind_agent: shopKey=${shopKey}, agentId=${agentId}, ok=${!!saved}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(saved ? { ok: true } : { ok: false, error: '绑定失败' }))
                }
              }
            } else if (action === 'unbind_agent') {
              // 解绑智能体：从 bound_agent_ids 中移除（绑错号后必须能撤回）
              const shopKey = String(rest.shopKey ?? '')
              const agentId = String(rest.agentId ?? '').trim()
              if (!shopKey || !agentId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey / agentId' }))
              } else {
                const existing = store.get(shopKey)
                if (!existing) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: '账号不存在' }))
                } else {
                  const agentIds = (existing.bound_agent_ids || []).filter(id => id !== agentId)
                  const saved = await store.setBindings(shopKey, agentIds)
                  console.log(`[dsagent-http] unbind_agent: shopKey=${shopKey}, agentId=${agentId}, ok=${!!saved}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(saved ? { ok: true } : { ok: false, error: '解绑失败' }))
                }
              }
            } else if (action === 'list_agents') {
              // 会话（= 智能体）列表：账号页的绑定下拉需要它。
              // browser 半区拿不到 cordis 服务，必须由 host 半区回传。
              // 注意：Agent 接口只有 readonly id，没有人类可读名，下拉只能显示 id。
              let agents: { id: string }[] = []
              try {
                // ctx.get(name, strict) 无需静态 inject 即可读服务；
                // strict=false 兜底，避免提供方 fiber 状态判定导致偶发取空。
                const getSvc = (ctx as any).get
                const svc: any = typeof getSvc === 'function'
                  ? (getSvc.call(ctx, 'agents') ?? getSvc.call(ctx, 'agents', false))
                  : undefined
                const list = typeof svc?.list === 'function' ? svc.list() : []
                agents = ((list || []) as any[])
                  .map((a: any) => ({ id: String(a?.id ?? '') }))
                  .filter((a: { id: string }) => a.id)
              } catch (err: any) {
                console.log(`[dsagent-http] list_agents 失败: ${err?.message || String(err)}`)
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, agents }))
            } else if (action === 'save_apikey') {
              // 保存 API Key 凭证（AppID + AppSecret）
              const platform = String(rest.platform ?? '')
              const appId = String(rest.appId ?? '')
              const appSecret = String(rest.appSecret ?? '')
              if (!platform || !appId || !appSecret) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 platform / appId / appSecret' }))
              } else {
                try {
                  const saved = await store.saveApiKey(platform, appId, appSecret)
                  console.log(`[dsagent-http] save_apikey 成功: shopKey=${saved.shop_key}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: true, shopKey: saved.shop_key, accountId: saved.account_id }))
                } catch (err: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
                }
              }
            } else if (action === 'save_cookie') {
              // 手动导入 Cookie 字符串
              const platform = String(rest.platform ?? '')
              const cookieStr = String(rest.cookieStr ?? '')
              if (!platform || !cookieStr) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 platform/cookieStr' }))
                return
              }
              try {
                const jar = parseCookieStr(cookieStr)
                const shopKey = await store.save(platform, jar)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, shopKey }))
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
              }
            } else if (action === 'check_update') {
              // 检查更新：比对本地版本（package.json version + build-info commit）
              // 与 GitHub latest Release。UI 技能页「检查更新」按钮的数据源。
              const local = readLocalVersion()
              const remote = await fetchRemoteVersion()
              const updateAvailable = remote.ok ? hasUpdate(local, remote) : false
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: true,
                local: { version: local.version, commit: local.commit, builtAt: local.builtAt },
                remote: { version: remote.version, commit: remote.commit },
                remoteOk: remote.ok,
                remoteError: remote.error,
                updateAvailable,
                repo: updateRepo,
                downloadUrl: `https://github.com/${updateRepo}/releases/latest/download/DSAgent-Update.zip`,
              }))
            } else if (action.startsWith('workflow_')) {
              // 工作流 action 前缀分发：全部委托给 workflowApi.handleAction
              const result = await workflowApi.handleAction(action, rest)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }))
            }
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
          }
        },
      })
      return dispose
    })
  })
}
