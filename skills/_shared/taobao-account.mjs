/**
 * taobao-account.mjs —— 淘宝账号选择（基座）
 *
 * 规则与 PDD/抖音基座一致：
 *   0 个 → 报未绑定
 *   1 个 → 直接用
 *   多个 → 必须让用户选（禁止静默取第一个，写操作打错店不可逆）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const ACCOUNTS_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')
const PROFILE_ROOT = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')

let _store = null
async function getStore() {
  if (_store) return _store
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib/services/credential-store.js')).href)
  _store = new mod.CredentialStore(ACCOUNTS_FILE)
  return _store
}

function labelOf(a) {
  for (const f of ['display_label', 'nickname', 'shop_name', 'name', 'label', 'shop_key']) {
    const v = a?.[f]
    if (v && String(v).trim()) return String(v).trim()
  }
  return String(a?.shop_key || '（未命名）')
}

/** 列出淘宝账号（含凭证库 + 仅有浏览器 Profile 的） */
export async function listTaobaoAccounts() {
  const store = await getStore()
  const out = []
  let seen = new Set()
  for (const a of store.listAccounts().filter(x => x.platform === 'taobao')) {
    seen.add(a.shop_key)
    out.push({
      shopKey: a.shop_key,
      label: labelOf(a),
      status: a.status || 'unknown',
      cookies: a.cookies || {},
      cookieCount: Object.keys(a.cookies || {}).length,
      accountId: a.account_id || '',
      fromStore: true,
    })
  }
  // 凭证库里没有、但有浏览器 Profile 的账号
  try {
    for (const d of fs.readdirSync(PROFILE_ROOT)) {
      if (!d.startsWith('taobao_') || seen.has(d)) continue
      if (!fs.existsSync(path.join(PROFILE_ROOT, d, 'Default'))) continue
      out.push({
        shopKey: d, label: d, status: 'profile_only',
        cookies: {}, cookieCount: 0, accountId: '', fromStore: false,
      })
    }
  } catch { /* 没有目录就跳过 */ }
  return out
}

/**
 * 选一个淘宝账号
 * @param {object} o
 * @param {string} [o.want]       显式 shopKey
 * @param {string} [o.wantName]   店铺名模糊匹配
 * @param {boolean} [o.allowExpired] 默认 false
 * @returns {Promise<{ok:boolean, shopKey?:string, label?:string, cookies?:object, account?:object, failureKind?:string, text?:string, accounts?:Array}>}
 */
export async function pickTaobaoAccount(o = {}) {
  const { want = '', wantName = '', allowExpired = false } = o
  const all = await listTaobaoAccounts()

  if (!all.length) {
    return {
      ok: false, failureKind: 'not_bound', accounts: [],
      text: '淘宝未绑定账号。请在「平台连接」登录淘宝买家账号并绑定当前智能体。',
    }
  }

  if (want) {
    const hit = all.find(a => a.shopKey === want) || all.find(a => a.shopKey.endsWith(want))
    if (!hit) {
      return {
        ok: false, failureKind: 'account_not_found', accounts: all,
        text: `找不到账号 ${want}。可选：${all.map(a => a.shopKey).join('、')}`,
      }
    }
    return { ok: true, shopKey: hit.shopKey, label: hit.label, cookies: hit.cookies, account: hit }
  }

  if (wantName) {
    const hit = all.filter(a => a.label.includes(wantName))
    if (hit.length === 1) {
      return { ok: true, shopKey: hit[0].shopKey, label: hit[0].label, cookies: hit[0].cookies, account: hit[0] }
    }
  }

  const usable = all.filter(a => a.status === 'valid' || (allowExpired && a.cookieCount > 0))
  if (usable.length === 1) {
    const a = usable[0]
    return { ok: true, shopKey: a.shopKey, label: a.label, cookies: a.cookies, account: a }
  }

  if (usable.length === 0) {
    return {
      ok: false, failureKind: 'token_expired', accounts: all,
      text: `淘宝账号均不可用（${all.map(a => `${a.shopKey}:${a.status}`).join('、')}）。请在「平台连接」重新登录。`,
    }
  }

  return {
    ok: false, failureKind: 'need_account_choice', accounts: all,
    text: `淘宝有 ${usable.length} 个可用账号，请指定要使用哪一个：${usable.map(a => `${a.shopKey}（${a.label}）`).join('、')}`,
  }
}

export default { pickTaobaoAccount, listTaobaoAccounts }
