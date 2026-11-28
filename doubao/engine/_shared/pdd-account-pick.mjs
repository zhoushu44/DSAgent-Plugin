/**
 * pdd-account-pick.mjs —— 基座级「挑一个可用的拼多多账号」
 *
 * 【为什么需要】
 *   之前各脚本把 shop_key 写死在代码里（pdd_mms_2b1bca…），账号一换/一删就全废
 *   —— 2026-11-09 实测：测试脚本直接报 "无有效账号"，而账号其实有 3 个。
 *
 * 【挑选规则（按优先级）】
 *   ① status === 'valid'          凭证库认为没过期
 *   ② 有种子文件（~/.dsh/pdd-risk-seeds/<shopKey>.json）
 *      —— 种子是 mms 域签名 + 风控的基础，没种子等于没上过道
 *   ③ 真实探测（GET /earth/api/mallInfo/commonMallInfo）
 *      —— 最后一道关：凭证库说 valid 不代表 session 没过期
 *
 * 探测走基座 request()，它自带 **Cookie 自愈**（43001 时从 Profile 浏览器取新 Cookie
 * 并写回凭证库后重试），所以探测通过 = 这个账号现在真的能用。
 *
 * 用法：
 *   const { pickPddAccount } = await import('.../pdd-account-pick.mjs')
 *   const acc = await pickPddAccount({ probe: true })   // 不传 probe 则只做静态筛选
 *   if (!acc) console.log('没有可用账号')
 */

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// ★ 用 fileURLToPath，不要用 new URL(import.meta.url).pathname
//   （Windows 上 pathname 会把盘符变成 /E:/…，且中文路径会乱码）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

/**
 * 列出**全部**可用的拼多多账号：
 *   A. 凭证库里的 pdd_mms 账号
 *   B. 只有浏览器 Profile、没进凭证库的（推广域就是靠 Profile 活着的）
 *      —— 2026-11-09 实测：pdd_mms_63110dd… 一直用得好好的，但凭证库里没有它。
 *      这类账号 cookies 传空即可，基座 request() 遇到 43001 会
 *      **从 Profile 自愈 Cookie**（healCookiesFromProfile）后重试。
 */
export async function listPddAccounts(opts = {}) {
  const { platform = 'pdd_mms' } = opts
  const { CredentialStore } = await imp('lib/services/credential-store.js')
  const seedStore = await imp('skills/_shared/pdd-seed-store.mjs')
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))

  const known = new Map()
  for (const a of store.listAccounts().filter(x => x.platform === platform)) {
    known.set(a.shop_key, { ...a, fromStore: true })
  }

  // B. 扫浏览器 Profile
  const profRoot = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts')
  try {
    for (const d of fs.readdirSync(profRoot)) {
      if (!d.startsWith(platform + '_')) continue
      if (known.has(d)) continue
      // Profile 目录必须像个浏览器（有 Default 子目录）
      if (!fs.existsSync(path.join(profRoot, d, 'Default'))) continue
      known.set(d, {
        shop_key: d, platform, status: 'profile_only', display_label: '',
        cookies: {}, fromStore: false,
      })
    }
  } catch { /* 目录不存在就跳过 */ }

  const out = []
  for (const a of known.values()) {
    const seed = seedStore.readSeed(a.shop_key)
    out.push({
      acc: a,
      valid: a.status === 'valid',
      seeded: !!seed?.localStorage && Object.keys(seed.localStorage).length > 0,
      cookies: Object.keys(a.cookies || {}).length,
      hasProfile: fs.existsSync(path.join(profRoot, a.shop_key, 'Default')),
    })
  }
  // ① valid ② 有种子 ③ cookie 数 —— 逐级降权
  out.sort((a, b) =>
    (b.valid - a.valid) || (b.seeded - a.seeded) || (b.hasProfile - a.hasProfile) || (b.cookies - a.cookies))
  return out
}

/**
 * @param {object} opts { platform='pdd_mms', probe=true, label='' }
 * @returns {Promise<object|null>} 凭证库里的账号记录（附 pickedReason）
 */
export async function pickPddAccount(opts = {}) {
  const { probe = true } = opts
  const seedStore = await imp('skills/_shared/pdd-seed-store.mjs')
  const scored = await listPddAccounts(opts)

  if (!scored.length) return null

  if (!probe) {
    const top = scored[0]
    if (!top) return null
    top.acc.pickedReason = top.valid ? 'status=valid' : 'fallback'
    return top.acc
  }

  // 真实探测：mms 主域 + 推广域（两个域都要通才算满分）
  // ⚠️ 探测上限：每个失败账号可能触发一次 Cookie 自愈（要开浏览器，约 10s），
  //   候选有 20+ 个时不能全探一遍 —— 只探排序靠前的 maxProbe 个。
  const { request } = await imp('skills/_shared/pdd-request.mjs')
  const maxProbe = opts.maxProbe ?? 8
  let best = null
  for (const s of scored.slice(0, maxProbe)) {
    const account = { cookies: s.acc.cookies, localStorage: seedStore.readSeed(s.acc.shop_key)?.localStorage || {} }
    let mmsOk = false, promoOk = false
    try {
      const r = await request('/earth/api/mallInfo/commonMallInfo', {}, {
        account, shopKey: s.acc.shop_key, method: 'GET',
      })
      mmsOk = !!r.ok
    } catch { /* ignore */ }
    try {
      const r2 = await request('/mms-gateway/reinhardt/homepage/v3/accountAll', {}, {
        account: { ...account, cookies: {} }, shopKey: s.acc.shop_key, method: 'POST',
      })
      promoOk = !!r2.ok
    } catch { /* ignore */ }
    const score = (mmsOk ? 2 : 0) + (promoOk ? 1 : 0)
    if (!best || score > best.score) {
      best = { ...s, score, mmsOk, promoOk }
      if (score === 3) break   // 满分，直接用
    }
  }
  if (!best || best.score === 0) return null
  best.acc.pickedReason = `mms=${best.mmsOk ? '通' : '不通'} 推广域=${best.promoOk ? '通' : '不通'}${best.seeded ? '，有种子' : '，无种子'}`
  return best.acc
}

/** 拼多多「推广域」可用账号（返回 shopKey + account 对象） */
export async function pickPromoAccount(opts = {}) {
  const acc = await pickPddAccount(opts)
  if (!acc) return null
  return {
    shopKey: acc.shop_key,
    account: { shopKey: acc.shop_key, cookies: acc.cookies, userAgent: acc.userAgent },
    displayLabel: acc.display_label || acc.shop_key,
    mallId: acc.mall_id || null,
  }
}

export default { pickPddAccount, pickPromoAccount }
