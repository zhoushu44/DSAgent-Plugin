/**
 * account-picker.mjs —— 账号选择器（基座·跨平台）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个（2026-11-05）
 * ══════════════════════════════════════════════════════════════════
 * 多个账号时「静默取第一个」是危险的：
 *   · 用户以为自己操作的是 A 店，实际改的是 B 店
 *   · 写操作（改价、下架、报名、发品）打错店的代价不可逆
 *   · 而且完全无声 —— 事后才发现
 *
 * 抖音那套已经做对了（`need_account_choice` + 候选列表），
 * 但每个 skill 各写一遍，拼多多和淘宝则完全没做。
 *
 * 这个模块把规则统一为一条：
 *   0 个 → 报「未绑定」
 *   1 个 → 直接用（无歧义）
 *   多个 → 必须让用户选
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *   import { pickAccount } from '<PLUGIN_ROOT>/skills/_shared/account-picker.mjs'
 *
 *   const pick = pickAccount(store, {
 *     platform: 'pdd_mms',
 *     want: argOf('account'),        // 用户显式传的 --account
 *     wantName: argOf('shop-name'),  // 或 --shop-name
 *     skill: 'pdd-works',
 *   })
 *   if (!pick.ok) {
 *     emit({ ok: false, failureKind: pick.failureKind, text: pick.text, accounts: pick.accounts })
 *     process.exit(2)              // ★ 一定退出，不能"猜一个继续"
 *   }
 *   const SHOP = pick.shopKey
 *
 * ══════════════════════════════════════════════════════════════════
 * 返回形状
 * ══════════════════════════════════════════════════════════════════
 *   成功: { ok: true,  shopKey, label, account }
 *   失败: { ok: false, failureKind, text, accounts: [{shop_key, label}] }
 */

/** 各平台的「显示名」字段不同，这里统一 */
const LABEL_FIELDS = ['display_label', 'nickname', 'shop_name', 'name', 'label', 'shopKey', 'shop_key']

function labelOf(a) {
  for (const f of LABEL_FIELDS) {
    const v = a?.[f]
    if (v && String(v).trim()) return String(v).trim()
  }
  return String(a?.shop_key || a?.shopKey || '（未命名）')
}

function keyOf(a) {
  return String(a?.shop_key || a?.shopKey || a?.key || '')
}

/**
 * 选账号
 *
 * @param {object} store    CredentialStore（需有 listAccounts()）
 * @param {object} o
 * @param {string} o.platform        平台 id，如 'pdd_mms' / 'douyin_shop' / 'taobao'
 * @param {string} [o.want]          用户显式指定的 shopKey
 * @param {string} [o.wantName]      用户指定的店铺名（模糊匹配）
 * @param {string} [o.skill]         skill 名（仅用于提示文案）
 * @param {boolean} [o.allowExpired] 是否允许选到 expired（默认 false，但会提示）
 * @param {Function} [o.isHealthy]   (shopKey) => { ok, reason } —— 可选的可用性过滤
 * @returns {{ok:boolean, shopKey?:string, label?:string, account?:object, failureKind?:string, text?:string, accounts?:Array}}
 */
export function pickAccount(store, o = {}) {
  const { platform, want = '', wantName = '', skill = '', allowExpired = false, isHealthy } = o

  let all = []
  try {
    all = (store?.listAccounts?.() || []).filter(a => a?.platform === platform)
  } catch (e) {
    return {
      ok: false, failureKind: 'config_error',
      text: `读取账号列表失败：${String(e?.message || e).slice(0, 100)}`,
      accounts: [],
    }
  }

  if (!all.length) {
    return {
      ok: false, failureKind: 'not_bound',
      text: `${platform} 没有已绑定的账号${skill ? `（${skill} 需要先绑定）` : ''}。`
        + `\n请到「账号连接」页面添加 ${platform} 账号后重试。`,
      accounts: [],
    }
  }

  const toCand = (a) => {
    const key = keyOf(a)
    const h = isHealthy ? (() => { try { return isHealthy(key) } catch { return { ok: true } } })() : { ok: true }
    return {
      shop_key: key,
      label: labelOf(a),
      status: a?.status || '',
      healthy: h?.ok !== false,
      unhealthyReason: h?.ok === false ? String(h.reason || '').slice(0, 60) : '',
    }
  }

  // ── ① 显式指定了 shopKey ──
  if (want) {
    const hit = all.find(a => keyOf(a) === want)
    if (!hit) {
      return {
        ok: false, failureKind: 'need_account_choice',
        text: `账号 shopKey 不存在：${want}\n可用账号：\n`
          + all.map((a, i) => `  ${i + 1}. ${labelOf(a)}（${keyOf(a)}）`).join('\n'),
        accounts: all.map(toCand),
      }
    }
    if (!allowExpired && String(hit.status || '').toLowerCase() === 'expired') {
      return {
        ok: false, failureKind: 'token_expired',
        text: `账号「${labelOf(hit)}」登录态已过期，请先到「账号连接」重新登录。`,
        accounts: [toCand(hit)],
      }
    }
    return { ok: true, shopKey: keyOf(hit), label: labelOf(hit), account: hit }
  }

  // ── ② 指定了店铺名（模糊匹配）──
  if (wantName) {
    const n = String(wantName).trim()
    const hits = all.filter(a => {
      const l = labelOf(a)
      return l.includes(n) || n.includes(l) || keyOf(a).includes(n)
    })
    if (hits.length === 1) {
      return { ok: true, shopKey: keyOf(hits[0]), label: labelOf(hits[0]), account: hits[0] }
    }
    if (hits.length > 1) {
      return {
        ok: false, failureKind: 'need_account_choice',
        text: `店铺名「${n}」匹配到 ${hits.length} 个账号，请用 --account 精确指定：\n`
          + hits.map((a, i) => `  ${i + 1}. ${labelOf(a)}（${keyOf(a)}）`).join('\n'),
        accounts: hits.map(toCand),
      }
    }
    return {
      ok: false, failureKind: 'need_account_choice',
      text: `没有店铺名含「${n}」的账号。可用：\n`
        + all.map((a, i) => `  ${i + 1}. ${labelOf(a)}（${keyOf(a)}）`).join('\n'),
      accounts: all.map(toCand),
    }
  }

  // ── ③ 只有一个账号 → 直接用 ──
  if (all.length === 1) {
    const a = all[0]
    if (!allowExpired && String(a.status || '').toLowerCase() === 'expired') {
      return {
        ok: false, failureKind: 'token_expired',
        text: `账号「${labelOf(a)}」登录态已过期，请先到「账号连接」重新登录。`,
        accounts: [toCand(a)],
      }
    }
    return { ok: true, shopKey: keyOf(a), label: labelOf(a), account: a }
  }

  // ── ④ 多个账号 → 必须让用户选 ──
  const cands = all.map(toCand)
  const lines = cands.map((c, i) => {
    const flags = []
    if (c.status) flags.push(c.status)
    if (!c.healthy) flags.push(`不可用：${c.unhealthyReason}`)
    return `  ${i + 1}. ${c.label}（${c.shop_key}）${flags.length ? ' — ' + flags.join('，') : ''}`
  })
  return {
    ok: false,
    failureKind: 'need_account_choice',
    text: `${platform} 有 ${all.length} 个可用账号，请选择要操作哪个店铺：\n`
      + lines.join('\n')
      + `\n\n请用 --account <shopKey> 指定，或 --shop-name <店铺名>。`,
    accounts: cands,
  }
}

/** 便捷：直接把失败结果转成 skill 的 emit 参数 */
export function toEmit(pick) {
  return {
    ok: false,
    failureKind: pick.failureKind || 'api_error',
    text: pick.text || '',
    ...(pick.accounts?.length ? { accounts: pick.accounts } : {}),
  }
}
