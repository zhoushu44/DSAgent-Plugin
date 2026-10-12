/**
 * 平台账号 / 授权 / 代理类工具（host 半区）。
 *
 * 职责：定义 13 个「账号查询 + 浏览器登录 + 授权流程 + 网关缓存 + 风控验证 +
 * 代理出网 + Cookie 导入 + 平台清单」工具：
 *   dsagent_list_accounts / dsagent_check_account_health / dsagent_search_accounts /
 *   dsagent_browser_login / dsagent_browser_close / dsagent_auth_status /
 *   dsagent_auth_advance / dsagent_auth_cancel / dsagent_gateway_cache /
 *   dsagent_risk_verify / dsagent_proxy / dsagent_save_cookie / dsagent_list_platforms
 *
 * 物理隔离：本文件不 import index.ts；服务与函数由 index.ts 接线时注入
 * （仿 http-routes.ts 的依赖注入模式）。
 */
import type { CredentialStore } from './services/credential-store.js'
import type { AccountService } from './services/account-service.js'
import * as authOp from './services/auth-operation.js'
import { handleProxy, gatewayCacheStats, clearGatewayCache, getLastVerifyUrlByPlatform } from './gateway-proxy.js'
import { defineTool, renderToolOutput, agentIdOf } from './tool-runtime.js'

/** 插件依赖注入：index.ts apply() 内创建的服务与函数，全部从这里进 */
export interface PlatformToolsDeps {
  /** 账号服务（list/checkHealth/findByKeyword/isBound） */
  account: AccountService
  /** 凭证库（save/读取账号） */
  store: CredentialStore
  /** 浏览器登录 / 关闭（browser-login.ts） */
  doBrowserLogin: typeof import('./browser-login.js').doBrowserLogin
  closeBrowser: typeof import('./browser-login.js').closeBrowser
  /** 风控验证（browser-login.ts） */
  riskVerify: typeof import('./browser-login.js').riskVerify
  /** 凭证工具（credential-store.ts） */
  parseCookieStr: typeof import('./services/credential-store.js').parseCookieStr
  keyCookies: typeof import('./services/credential-store.js').keyCookies
  loginOwnerPlatform: typeof import('./services/credential-store.js').loginOwnerPlatform
}

/** 构建平台账号 / 授权 / 代理类工具定义 */
export function buildPlatformTools(deps: PlatformToolsDeps): import('@deepseek-ai/dsh-tools').ToolDefinition[] {
  const { account, store, doBrowserLogin, closeBrowser, riskVerify, parseCookieStr, keyCookies, loginOwnerPlatform } = deps

  return [

    /* ─── 账号查询工具 ─── */

    defineTool({
      name: 'dsagent_list_accounts',
      description: '列出当前已连接的平台账号及其登录态。只读。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤。不传时返回全部' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.list(args.platform)
        if (!rows.length) {
          return { text: '当前没有已连接的平台账号。请引导用户打开「账号连接」页面添加账号。', count: 0 }
        }
        // 必须显式给出「店铺名」字段：生意参谋系技能（巡店管家、market-trend 等）要求
        // `--shop-name` 必填，但凭证库里只有一个展示标签，模型无法自行推断该填什么，
        // 会卡在反复追问用户。这里把标签直接标注为「店铺名」并说明它就是 --shop-name 的取值。
        return {
          text: [
            '已连接账号（「店铺名」即技能参数 --shop-name 的取值）：',
            ...rows.map(a => `- 平台=${a.platformId} | 店铺名=${a.nickname} | 账号ID=${a.platformUid} | 状态=${a.status} | 检查时间=${a.lastCheckAt}`),
          ].join('\n'),
          count: rows.length,
        }
      },
    }),

    defineTool({
      name: 'dsagent_check_account_health',
      description: '检查指定平台账号的登录态是否有效。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.checkHealth(args.platform)
        const bad = rows.filter(r => r.status !== 'valid')
        if (!bad.length) return { text: `已检查 ${rows.length} 个账号，全部有效。`, allOk: true } as any
        return {
          text: `以下 ${bad.length} 个账号需重新登录：\n` + bad.map(r => `- ${r.platformId} | ${r.nickname} | ${r.status}`).join('\n'),
          allOk: false,
          needRelogin: bad.length,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_search_accounts',
      description: '根据关键词或 token 自动查找匹配的账号。',
      parameters: {
        keyword: { type: 'string', required: true, description: '关键词、店铺 ID 或自然语言' },
        platform: { type: 'string', description: '可选，限定平台' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.findByKeyword(args.keyword, args.platform)
        if (!rows.length) return { text: `未找到与「${args.keyword}」匹配的账号。`, count: 0 }
        return { text: rows.map(a => `- ${a.platformId} | ${a.nickname} | UID: ${a.platformUid} | ${a.status}`).join('\n'), count: rows.length }
      },
    }),

    /* ─── 浏览器登录工具（host 半区，用 Playwright 启动浏览器） ─── */

    defineTool({
      name: 'dsagent_browser_login',
      description: '启动浏览器并导航到平台登录页，等待用户扫码登录。登录成功后自动提取 Cookie 并存入本地凭证库。这是内嵌浏览器登录方案的核心工具。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao / douyin' },
        loginUrl: { type: 'string', required: true, description: '平台登录页 URL' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        freshLogin: { type: 'boolean', description: '为 true 时使用全新的空浏览器环境登录，用于在同一平台添加「其他账号」（避免复用已绑定账号的登录态导致误判登录成功）' },
        shopKey: { type: 'string', description: '「重新登录」场景传入被刷新账号的凭证库主键 {platform}_{accountId}，登录成功后旧条目被替换、绑定关系继承；不传则视为新增账号' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        // ★ 不可独立登录的平台（生意参谋系 / 天猫）：凭证层复用淘宝登录态，无独立登录流程。
        //   模型可能推断出 platform=sycm 并试图登录，这里必须挡住（FIX-LOG #67）。
        const owner = loginOwnerPlatform(platform)
        if (owner) {
          return {
            ok: false,
            error: `「${platform}」复用 ${owner} 登录态，没有独立登录流程。请改为登录 ${owner}（登录后 ${platform} 技能即可直接用）。`,
          } as any
        }
        const loginUrl = String(args.loginUrl ?? '')
        // ★ 授权流程 operation 化（吸收 Accio 的 managed-auth start/advance/poll/cancel）：
        //   每次登录都登记一个 operation，模型可 poll 进度、resume 续推、cancel 放弃。
        //   同平台重复 start 会**复用**未结束的 operation（幂等），
        //   避免模型重试时拉起第二个浏览器撞上 Chrome 的 userDataDir 独占锁。
        const op = authOp.startOperation({
          kind: 'login',
          platform,
          onCancel: async () => {
            // 取消 = 关掉浏览器窗口。窗口一关，登录进度自然作废，无需额外状态。
            await closeBrowser()
          },
        })
        const result = await doBrowserLogin(platform, loginUrl, store, {
          freshLogin: args.freshLogin === true,
          replaceShopKey: String(args.shopKey ?? '') || undefined,
          operationId: op.operationId,
        })
        // 把 operationId 一并返回，模型后续可据此 poll / cancel
        const finalOp = authOp.getOperation(op.operationId)
        return {
          ...result,
          operationId: op.operationId,
          ...(finalOp ? { phase: finalOp.phase, awaitingUser: finalOp.awaitingUser } : {}),
        } as any
      },
    }),

    /* ─── 关闭浏览器工具 ─── */

    defineTool({
      name: 'dsagent_browser_close',
      description: '关闭由 dsagent_browser_login 启动的浏览器窗口。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute() {
        const result = await closeBrowser()
        return result as any
      },
    }),

    /* ─── 授权流程查询 / 续推 / 取消（吸收 Accio 的 managed-auth advance/poll/cancel） ───
     *
     * 登录与风控验证都是「需要用户参与、可能中途停顿、超时后窗口仍开着」的长流程。
     * 改造前它们是一次阻塞调用，中途状态对模型是黑盒；现在各有 operationId，
     * 模型可据此查询进度、续推、取消 —— 而不必重新走一遍登录（会重开浏览器）。
     */

    defineTool({
      name: 'dsagent_auth_status',
      description:
        '查询登录 / 风控验证流程的当前进度（不传 operationId 则列出所有进行中的流程）。'
        + '当 dsagent_browser_login 或 dsagent_risk_verify 返回「等待用户操作」或「等待超时」时，'
        + '用本工具查看当前阶段：是在等用户扫码 / 拖滑块，还是需要补充输入，还是已经完成。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        operationId: { type: 'string', description: '流程 ID（login / risk_verify 返回的 operationId）；省略则列出全部进行中流程' },
        platform: { type: 'string', description: '按平台过滤（仅列出模式下有效）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        if (operationId) {
          const op = authOp.getOperation(operationId)
          if (!op) {
            return { ok: false, error: `未找到授权流程 ${operationId}（可能已过期，请重新发起登录）` } as any
          }
          return { ok: true, text: authOp.describeOperation(op), operation: op } as any
        }
        const platform = String(args.platform ?? '').trim() || undefined
        const list = authOp.listOperations({ platform, liveOnly: false })
        if (!list.length) {
          return { ok: true, text: '当前没有进行中的登录 / 风控验证流程。' } as any
        }
        return {
          ok: true,
          text: list.map(authOp.describeOperation).join('\n\n'),
          operations: list,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_auth_advance',
      description:
        '推进一个已暂停的登录 / 风控验证流程（对应 Accio 的 managed-auth advance）。'
        + '典型用法：① 流程显示「等待超时」但用户其实已经完成了扫码 → action=resume 让它重新检查；'
        + '② 流程要求补充输入 → action=submit 并传 value；'
        + '③ 流程要求在多选项中选一个 → action=choose 并传 value；'
        + '④ action=retry 让它重试一次。',
      parameters: {
        operationId: { type: 'string', required: true, description: '流程 ID（来自 dsagent_browser_login / dsagent_risk_verify / dsagent_auth_status）' },
        action: { type: 'string', required: true, description: '动作：resume（超时后继续检查）/ submit（提交输入）/ choose（选择候选）/ confirm（确认）/ retry（重试）' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        value: { type: 'string', description: 'action=submit / choose 时的值（验证码、候选项 id 等）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        const action = String(args.action ?? '').trim()
        if (!operationId || !action) {
          return { ok: false, error: '缺少 operationId 或 action' } as any
        }
        const res = await authOp.advanceOperation(operationId, {
          action,
          value: String(args.value ?? '') || undefined,
        })
        if (!res.ok) {
          return { ok: false, error: res.error, operation: res.operation } as any
        }
        return {
          ok: true,
          text: res.operation ? authOp.describeOperation(res.operation) : '已推进',
          operation: res.operation,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_auth_cancel',
      description:
        '取消一个进行中的登录 / 风控验证流程，并关闭其浏览器窗口。'
        + '用于用户明确放弃、或在错误的平台上发起了登录时清理，避免浏览器窗口一直开着占用 Profile 锁。',
      parameters: {
        operationId: { type: 'string', required: true, description: '流程 ID' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        if (!operationId) return { ok: false, error: '缺少 operationId' } as any
        const res = await authOp.cancelOperation(operationId)
        if (!res.ok) return { ok: false, error: res.error, operation: res.operation } as any
        return { ok: true, text: '已取消该授权流程并关闭浏览器窗口。', operation: res.operation } as any
      },
    }),

    /* ─── 网关响应缓存观测（吸收 Accio 本地快照体系的核心目的：不重复打平台）─── */

    defineTool({
      name: 'dsagent_gateway_cache',
      description:
        '查看或清理网关响应缓存。网关会对「参数完全相同的 GET 请求」在短时间内复用上一次的结果，'
        + '从而减少对平台的重复请求（降低风控风险、省掉账号级节流的等待）。'
        + '本工具用于查看缓存命中情况；当怀疑读到的是陈旧数据时可用 action=clear 强制刷新。'
        + '注意：POST（发布/提交类）与失败响应从不进入缓存。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        action: { type: 'string', description: 'stats（默认，查看命中率）/ clear（清空全部缓存）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const action = String(args.action ?? 'stats').trim().toLowerCase()
        if (action === 'clear') {
          const n = clearGatewayCache()
          console.log(`[dsagent] 网关缓存已手动清空（${n} 条）`)
          return { ok: true, cleared: n, text: `已清空网关缓存（${n} 条）。后续请求将重新向平台取数。` } as any
        }
        const s = gatewayCacheStats()
        const skipLines = Object.entries(s.skips).length
          ? Object.entries(s.skips).map(([k, v]) => `${k}=${v}`).join('，')
          : '（无）'
        return {
          ok: true,
          ...s,
          text: [
            `网关缓存：${s.enabled ? '已启用' : '已关闭（DSAGENT_GATEWAY_CACHE=off）'}`,
            `条目 ${s.entries}/${s.maxEntries}，TTL ${s.ttlMs / 1000}s`,
            `命中 ${s.hits} / 未命中 ${s.misses}（命中率 ${s.hitRate}），写入 ${s.stores}，LRU 淘汰 ${s.evictions}`,
            `未缓存原因：${skipLines}`,
          ].join('\n'),
        } as any
      },
    }),

    /* ─── 风控验证助手（补上「完成验证」半个动作） ─── */

    defineTool({
      name: 'dsagent_risk_verify',
      description:
        '当平台技能因安全风控失败（failure_kind = risk_control，淘宝表现为 RGV587_ERROR）时调用本工具。'
        + '它会用该平台账号已有 Cookie 弹出一个可见浏览器窗口打开平台验证页，'
        + '用户完成滑块验证后，插件自动提取验证凭证（x5sec 等）写回账号并解除风控冷却；'
        + '随后重新执行刚才失败的技能即可正常获取数据。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao / tmall / xianyu' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        verifyUrl: { type: 'string', description: '验证页地址；省略时自动取该平台最近一次风控返回的入口' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        const explicit = String(args.verifyUrl ?? '').trim()
        const url = explicit || getLastVerifyUrlByPlatform(store, platform)
        if (!url) {
          return {
            ok: false,
            passed: false,
            error: `未找到平台 ${platform} 最近一次风控返回的验证入口。`
              + `请先执行一次失败的技能以触发风控（插件会自动记录入口），再调用本工具。`,
          } as any
        }
        // ★ 与登录一致地登记 operation：风控验证同样是「需要用户拖滑块、可能超时后继续」
        //   的长流程，operation 让模型能 poll 进度、cancel 放弃。
        const op = authOp.startOperation({
          kind: 'risk_verify',
          platform,
          onCancel: async () => { await closeBrowser() },
        })
        const verified = await riskVerify(store, platform, url, undefined, op.operationId)
        const finalOp = authOp.getOperation(op.operationId)
        return {
          ...verified,
          operationId: op.operationId,
          ...(finalOp ? { phase: finalOp.phase, awaitingUser: finalOp.awaitingUser } : {}),
        } as any
      },
    }),

    /* ─── 本地代理出网工具（委托给 gateway-proxy.ts 的 handleProxy） ─── */

    defineTool({
      name: 'dsagent_proxy',
      description: '代替技能向平台发 HTTP 请求，自动从本地凭证库取 Cookie 注入。三种 kind：http_get / http_post / mtop_jsonp。这是技能访问平台的唯一出口。',
      parameters: {
        kind: { type: 'string', required: true, description: '请求类型：http_get / http_post / mtop_jsonp' },
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao' },
        url: { type: 'string', required: true, description: '目标 URL' },
        params: { type: 'string', description: '查询参数 JSON' },
        headers: { type: 'string', description: '额外请求头 JSON' },
        body: { type: 'string', description: 'POST body JSON（http_post 用）' },
        data: { type: 'string', description: 'MTOP API data JSON（mtop_jsonp 用）' },
        extraParams: { type: 'string', description: '额外查询参数 JSON（mtop_jsonp 用）' },
        injectToken: { type: 'boolean', description: '是否自动注入 _tb_token_（默认 true）' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        // 直接委托给 gateway-proxy.ts 的 handleProxy，确保所有代理逻辑统一
        const proxyBody: Record<string, any> = {
          kind: String(args.kind ?? ''),
          platform: String(args.platform ?? ''),
          url: String(args.url ?? ''),
          // 会话 ID：网关据此走「会话绑定」这一级选号
          agent_id: agentIdOf(exec),
          inject_token: args.injectToken !== false,
        }
        // 显式指定账号：网关据此走「显式 shopKey」这一级，避免重新选号
        if (args.account) proxyBody.shop_key = String(args.account).trim()
        // 解析可选 JSON 参数
        try { if (args.params) proxyBody.params = JSON.parse(args.params) } catch { /* 忽略 */ }
        try { if (args.headers) proxyBody.headers = JSON.parse(args.headers) } catch { /* 忽略 */ }
        if (args.body) {
          const bodyStr = String(args.body)
          // 如果以 { 或 [ 开头，尝试 JSON.Parse；否则当作 form-urlencoded 字符串
          if (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')) {
            try { proxyBody.json_body = JSON.parse(bodyStr) } catch { proxyBody.json_body = bodyStr }
          } else {
            proxyBody.json_body = bodyStr
          }
        }
        try { if (args.data) proxyBody.data = JSON.parse(args.data) } catch { /* 忽略 */ }
        try { if (args.extraParams) proxyBody.extra_params = JSON.parse(args.extraParams) } catch { /* 忽略 */ }

        try {
          const result = await handleProxy(proxyBody, store)
          return { ok: result.status === 'success', ...result } as any
        } catch (err) {
          return { ok: false, status: 'error', text: `代理请求失败：${err instanceof Error ? err.message : String(err)}`, failure_kind: 'api_error' } as any
        }
      },
    }),

    /* ─── 手动 Cookie 导入工具 ─── */

    defineTool({
      name: 'dsagent_save_cookie',
      description: '手动导入 Cookie 字符串并存储到本地凭证库。用于用户从浏览器开发者工具复制 Cookie 后导入。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID' },
        cookieStr: { type: 'string', required: true, description: 'Cookie 字符串，如 a=1; b=2' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        const cookieStr = String(args.cookieStr ?? '')
        if (!platform || !cookieStr) return { ok: false, text: '缺少 platform 或 cookieStr' } as any

        try {
          const jar = parseCookieStr(cookieStr)
          const kc = keyCookies(platform)
          const missing = kc.filter(name => !jar[name])
          if (missing.length > 0) {
            return { ok: false, text: `Cookie 缺少关键字段：${missing.join(', ')}（${platform} 需要）` } as any
          }
          const saved = await store.save(platform, jar)
          return {
            ok: true,
            text: `Cookie 导入成功！账号 ${saved.display_label}（${saved.shop_key}）已保存。`,
            shopKey: saved.shop_key,
          } as any
        } catch (err) {
          return { ok: false, text: `导入失败：${err instanceof Error ? err.message : String(err)}` } as any
        }
      },
    }),

    /* ─── 平台清单工具 ─── */

    defineTool({
      name: 'dsagent_list_platforms',
      description: '列出支持连接的平台及授权状态。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute() {
        const rows = await account.list()
        const platforms: Array<[string, string]> = [
          ['taobao', '淘宝'], ['douyin', '抖音'], ['xiaohongshu', '小红书'],
          ['bilibili', 'B站'], ['kuaishou', '快手'], ['wechat_mp', '微信公众号'],
          ['pinduoduo', '拼多多'], ['pdd_mms', '拼多多商家后台'],
          ['xianyu', '闲鱼'], ['wechat_store', '微信小店'],
          ['zhihu', '知乎'],
        ]
        return {
          text: platforms.map(([pid, label]) => {
            const hit = rows.find(r => r.platformId === pid)
            const state = !hit ? '未连接' : hit.status === 'valid' ? `已连接（${hit.nickname}）` : `异常（${hit.status}）`
            return `- ${label}（${pid}）：${state}`
          }).join('\n'),
        }
      },
    }),
  ]
}
