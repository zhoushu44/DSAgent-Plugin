/**
 * 拼多多技能风控错误归一（共享）
 *
 * 所有 pdd-* 技能统一用它把底层错误转成「failureKind + 人话提示」。
 *
 * ══════════════════════════════════════════════════════════════════
 * 官方错误码 → failureKind 映射
 * ══════════════════════════════════════════════════════════════════
 *   54001  风控            → risk_control    （自动自愈，失败要人工）
 *   43001  会话过期        → token_expired   （不是风控，重新登录）
 *   40001  未登录          → token_expired
 *   40010  无权限          → no_permission
 *   40002  高频限流        → rate_limit      （官方实测无法本地修复）
 *   48143  非法请求        → api_error       （依赖页面 SDK 上下文）
 *   2000000 账号不适合发布  → no_permission   （视频域）
 *   3000000 参数/灰度错误   → api_error
 *   54003  安全验证未通过  → security_blocked（停号等待，重扫无效）
 *   310120000 页面上下文失效 → reload_required（reload，不跳登录）
 *   HTTP 430 网关级频率惩罚 → rate_limit
 *
 * ══════════════════════════════════════════════════════════════════
 * 底层 kind → failureKind 映射（pdd-client / pdd-http 返回的 kind）
 * ══════════════════════════════════════════════════════════════════
 */

/** 底层 kind → failureKind */
const KIND_MAP = {
  captcha: 'risk_control',
  session_expired: 'token_expired',
  login_needed: 'token_expired',
  rate_limit: 'rate_limit',
  blocked: 'rate_limit',
  no_permission: 'no_permission',
  signature_error: 'api_error',
  network: 'api_error',
  api_error: 'api_error',
  exception: 'exception',
  config_error: 'api_error',
  not_bound: 'not_bound',
  reload_required: 'reload_required',
  security_blocked: 'security_blocked',
}

/** 官方错误码 → failureKind */
const EC_MAP = {
  54001: 'risk_control',
  43001: 'token_expired',
  40001: 'token_expired',
  40010: 'no_permission',
  40002: 'rate_limit',
  48143: 'api_error',
  2000000: 'no_permission',
  3000000: 'api_error',
  // ★ 2026-10-27 补：100001（活动写操作「请2小时后重试」）原不在表内，
  //   会走 kind 兜底 → 归一结果不稳定。它与 40002 同属平台侧限流，
  //   在 pdd-risk.mjs 的 RISK_CODES 里也是 2 小时冷却，故显式映射为 rate_limit。
  100001: 'rate_limit',
  // ★ 2026-11-04 新增：403 + 310120000 = 页面上下文失效（官方语义是 reload），
  //   不是登录失效。证据：推广域 msfe-9d32834f5061ec2a.js@529922/@531800。
  310120000: 'reload_required',
  // ★ 2026-11-05 新增：54003 = 安全验证未通过，暂时无法登录。
  //   它与 43001/40001 的关键区别：**重扫码无效**，只能等。
  //   若不单独归类，会被当成普通 api_error 吞掉 → 上层立刻重试 → 进一步加重。
  //   ⚠️ 语义来自需求方描述，本项目日志中尚无该码的真实样本（grep 全项目 0 次），
  //     故 failureKind 用独立的 'security_blocked'，处理策略=停号等待，不做自动重试。
  54003: 'security_blocked',
}

/** 官方错误码 → 人类可读说明 */
const EC_HINT = {
  54001: [
    '54001 = 平台风控。',
    '已自动尝试「清 token → 提取新 token → 重放」，仍失败。',
  ],
  43001: [
    '43001 = 会话过期（这不是风控）。',
    '请到「账号连接」重新扫码登录 pdd_mms（会自动打通 live / yingxiao 域）。',
  ],
  40001: ['40001 = 未登录。', '请到「账号连接」重新扫码登录。'],
  40010: ['40010 = 无权限。', '可能是账号类型不对（需诚信通/实力商家），或换主店号。'],
  100001: [
    '100001 = 活动写操作频控（请 2 小时后重试）。',
    '官方实测此码无法本地修复，只能等待或换时间段。',
  ],
  40002: [
    '40002 = 高频限流。',
    '官方实测此码无法本地修复，只能等待或降级（如搜索接口 → feed）。',
  ],
  48143: [
    '48143 = 非法请求。',
    '该接口依赖页面 SDK 的请求上下文（签名头/Referer 状态），',
    'page.evaluate fetch 复刻不了 —— 必须让页面自己发请求（DOM 触发）。',
  ],
  2000000: [
    '2000000 = 账号被系统判定不适合发布。',
    '这是权限问题不是技术问题。用 --mode permission 查带货/内容权限。',
  ],
  3000000: ['3000000 = 参数错误或灰度未开放。'],
  54003: [
    '54003 = 安全验证未通过，暂时无法登录。',
    '⚠️ 这不是普通掉登录：**重新扫码也登不上**，只能等平台解除。',
    '正确处置：立即停用该账号（建议 24h），不要重试、不要重扫、不要换 profile 硬顶。',
    '反复尝试会按累计行为分延长封禁。',
  ],
  310120000: [
    '310120000 = 页面上下文已失效（不是登录失效）。',
    '官方处置是 window.location.reload()，请重开/刷新页面后重试；不要跳登录页。',
  ],
}

/**
 * 归一化错误
 *
 * @param {object} r   底层返回（含 kind / ec / hint / msg）
 * @param {string} [label] 场景标签，如「商品明细取数（t3 通道）」
 * @returns {{failureKind: string, ec: number|null, text: string}}
 */
export function normalize(r, label = '') {
  const ec = r?.ec ?? r?.errorCode ?? r?.error_code ?? null
  const kind = r?.kind ?? null
  const failureKind = (ec != null && EC_MAP[ec]) || (kind && KIND_MAP[kind]) || 'api_error'

  const L = []
  if (label) L.push(`${label}失败：${kind || ('errorCode ' + ec)}`)
  else L.push(`失败：${kind || ('errorCode ' + ec)}`)

  const hint = r?.hint || r?.msg || r?.errorMsg || r?.error_msg
  if (hint) L.push(hint)

  if (ec != null && EC_HINT[ec]) {
    L.push('')
    L.push(...EC_HINT[ec])
  }

  return { failureKind, ec, text: L.filter(Boolean).join('\n') }
}

/**
 * 归一化 + 附加账号冷却信息
 *
 * @param {object} r
 * @param {string} label
 * @param {string} shopKey
 * @param {object} [riskMod] pdd-risk.mjs 的导出（{checkCooldown, fmtRemain}）
 */
export function normalizeWithCooldown(r, label, shopKey, riskMod) {
  const base = normalize(r, label)
  if (riskMod?.checkCooldown) {
    try {
      const cd = riskMod.checkCooldown(shopKey)
      if (cd?.remainMs > 0) {
        const rm = riskMod.fmtRemain ? riskMod.fmtRemain(cd.remainMs) : `${Math.ceil(cd.remainMs / 60000)} 分钟`
        base.text += `\n\n账号冷却剩余 ${rm}，期间请勿重复调用（会延长封禁）。`
      }
    } catch { /* ignore */ }
  }
  return base
}

/**
 * 异常对象归一（try/catch 里用）
 *
 * @param {Error} e
 * @param {string} label
 */
export function normalizeError(e, label = '') {
  const msg = String(e?.message || e)
  // detached Frame / Target closed → 页面被风控关掉
  if (/detached Frame|Target closed|Session closed|Execution context was destroyed/i.test(msg)) {
    return {
      failureKind: 'risk_control',
      text: [
        `${label || '操作'}失败：页面被关闭（detached Frame）`,
        '',
        '这通常是账号被临时风控 —— 平台主动关掉了页面。',
        '',
        '处理：',
        '  1. 等 3~5 分钟再试（别连续重试，会加重）',
        '  2. 打开 mms 后台看是否要求验证',
        '  3. 若持续如此，说明账号被打到重量级风控，需人工过验证',
      ].join('\n'),
    }
  }
  if (/Navigation timeout|timeout/i.test(msg)) {
    return {
      failureKind: 'api_error',
      text: `${label || '操作'}失败：导航/等待超时\n\n页面加载过慢或风控页卡住。可重试，或先手动打开后台确认登录态。`,
    }
  }
  return {
    failureKind: 'exception',
    text: `${label || '操作'}异常：${msg.slice(0, 200)}`,
  }
}

/**
 * 判断是否值得重试（风控/网络类才重试，参数错误重试无用）
 */
export function isRetryable(failureKind) {
  return ['risk_control', 'rate_limit', 'token_expired', 'api_error', 'exception'].includes(failureKind)
}

/**
 * ★ 把错误结果记到 pdd-antiban（账号健康分 + 冷却记忆）
 *
 * 所有技能在归一化错误后调一次，即可跨技能共享：
 *   · 54001 → 健康分 −10，60s 冷却，今日 ≥3 次 → 2 小时冷却
 *   · 43001 → 健康分 −30，标记需重新登录
 *   · 40002 → 健康分 −20，240s 冷却
 *   · ok    → 成功计数 +1，每小时恢复 10 分
 *
 * @param {string} shopKey
 * @param {number|null} ec   官方错误码
 * @param {string|null} kind 底层 kind
 * @returns {object|null} antiban 模块（已加载，可复用）
 */
export async function recordToAntiban(shopKey, ec, kind) {
  let mod
  try {
    mod = await import('./pdd-antiban.mjs')
  } catch (e) {
    // ★ 2026-10-27 修：原为 catch { return null } 静默降级，
    //   antiban 模块加载失败 → 健康分/冷却全不记，无人知晓。
    console.error(`[pdd-error] ⚠ 账号健康分模块加载失败，本次不记健康分：${String(e && e.message || e).slice(0, 120)}`)
    return null
  }

  // ★ 2026-10-27 补（第三十一轮健康分量化发现）：kind 参数存在**两套体系**，
  //   原实现只认 pdd-client/pdd-http 那套（captcha / session_expired / rate_limit /
  //   blocked / api_error...），不认 pdd-error 自己的 failureKind 体系
  //   （risk_control / token_expired / rate_limit / no_permission / api_error）。
  //   后果：`recordToAntiban(k, null, 'risk_control')` 会**什么都不记** ——
  //   命中风控却不扣健康分、不进冷却，静默丢失（"盲目重试"的温床）。
  //   现有调用方都传的是能匹配的值，故尚未暴露；但这是健壮性缺口，
  //   新增调用方极易踩。这里把两套体系都归一。
  const KIND_ALIAS = {
    // failureKind 体系 → antiban kind
    risk_control: 'captcha',
    token_expired: 'session',
    rate_limit: 'rate_limit',
    no_permission: 'other',
    api_error: 'other',
    not_bound: 'session',
    need_account_choice: 'other',
    ok: 'ok',
    // 已在本体系的原样透传
    captcha: 'captcha',
    session_expired: 'session',
    login_needed: 'session',
    blocked: 'rate_limit',
    network: 'other',
    unknown: 'other',
  }
  const k = KIND_ALIAS[kind] ?? (kind === 'ok' ? 'ok' : null)

  try {
    if (ec === 54001 || k === 'captcha') mod.recordResult(shopKey, 'captcha')
    else if (ec === 43001 || ec === 40001 || k === 'session') mod.recordResult(shopKey, 'session')
    else if (ec === 40002 || k === 'rate_limit') mod.recordResult(shopKey, 'rate_limit')
    else if (k === 'other') mod.recordResult(shopKey, 'other')
    else if (ec != null && ec !== 1000000) mod.recordResult(shopKey, 'other')
    else if (k === 'ok') mod.recordResult(shopKey, 'ok')
    // ★ 2026-10-27 补：k 为 null（kind 无法归一）时显式告警，
    //   不再静默跳过 —— 否则"命中风控却没记账"这类问题无人知晓。
    else if (kind != null && kind !== 'ok') {
      console.error(`[pdd-error] ⚠ 无法归一的 kind：${JSON.stringify(kind)}（ec=${ec}），未记健康分`)
    }
  } catch (e) {
    console.error(`[pdd-error] ⚠ 记录风控健康分失败：${String(e && e.message || e).slice(0, 120)}`)
  }
  return mod
}

/**
 * ★ 请求前检查账号是否可用（冷却中/健康分过低 → 直接返回，不发请求）
 *
 * @param {string} shopKey
 * @param {string} [label] 场景标签
 * @returns {Promise<{blocked: boolean, text?: string, failureKind?: string}>}
 */
export async function checkAccountUsable(shopKey, label = '') {
  let mod
  try { mod = await import('./pdd-antiban.mjs') }
  catch (e) {
    // ★ 2026-10-27 修：原为 catch { return { blocked: false } } 静默放行，
    //   模块加载失败 → 冷却中/健康分过低的账号会被放过去打 → 盲打。
    console.error(`[pdd-error] ⚠ 账号健康分模块加载失败，跳过可用性检查（有盲打风险）：${String(e && e.message || e).slice(0, 120)}`)
    return { blocked: false }
  }

  try {
    const st = mod.canUse(shopKey)
    if (!st.ok) {
      const rm = st.remainMs ? mod.fmtRemain(st.remainMs) : ''
      return {
        blocked: true,
        failureKind: st.reason?.includes('重新登录') ? 'token_expired' : 'rate_limit',
        text: [
          `账号当前不可用${label ? `（${label}）` : ''}：${st.reason || '冷却中'}`,
          rm ? `剩余 ${rm}` : '',
          '',
          '期间请勿重复调用（会延长封禁）。',
          st.reason?.includes('重新登录')
            ? '请到「账号连接」重新扫码登录。'
            : '若急需使用，可打开后台手动完成验证，然后用 --clear-cooldown 清除冷却。',
        ].filter(Boolean).join('\n'),
      }
    }
    return { blocked: false, health: st.health }
  } catch { return { blocked: false } }
}

export { KIND_MAP, EC_MAP, EC_HINT }
