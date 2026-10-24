/**
 * PDD 店铺名补全工具
 *
 * 问题：账号连接页大部分账号只显示 shop_key 哈希（如 de55c3e159072dfb5297b234eaa487c3），
 *      用户分不清是哪家店。只有扫码时抓到店铺名的才显示正常（如「空空商行」）。
 *
 * 方案：遍历所有 pdd_mms 账号，用各自的 Profile 打开 mms 后台抓店铺名，写回凭证库。
 *
 * 抓取优先级：
 *   ① DOM 提取（页面文本里带「旗舰店/专营店/专卖店/商行」等后缀）
 *   ② 接口 /earth/api/mallInfo/queryCredential → result.result.mallName
 *   ③ 接口 /earth/api/mallInfo/commonMallInfo → result.mallName
 *
 * 用法：
 *   node scripts/fill-mall-names.mjs                    # 全部账号
 *   node scripts/fill-mall-names.mjs --account <key>   # 指定账号
 *   node scripts/fill-mall-names.mjs --force           # 已有名字的也重抓
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const has = (n) => process.argv.includes(`--${n}`)
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 从页面 DOM 抓店铺名 */
const GRAB_FROM_DOM = () => {
  const t = document.body?.innerText || ''
  // 带店铺后缀的
  const m = t.match(/([^\n\s]{2,20}(?:旗舰店|专营店|专卖店|企业店|百货店|工厂店|仓库|商行|店铺))/)
  if (m && !/商家后台|拼多多|多多/.test(m[1])) return m[1].trim()
  // 左上角常见位置
  for (const el of document.querySelectorAll('[class*="shop"], [class*="mall"], [class*="store"], [class*="header"]')) {
    const txt = (el.innerText || '').trim()
    if (txt.length >= 2 && txt.length <= 24 && !/后台|登录|验证|商品|订单/.test(txt)) return txt
  }
  return ''
}

/** 从接口抓店铺名 */
const GRAB_FROM_API = () => new Promise((resolve) => {
  const tryApi = (url, pick) => {
    const x = new XMLHttpRequest()
    x.open('POST', url, true)
    x.setRequestHeader('Content-Type', 'application/json')
    x.onload = () => {
      try { resolve(pick(JSON.parse(x.responseText)) || '') } catch { resolve('') }
    }
    x.onerror = () => resolve('')
    x.send(JSON.stringify({}))
  }
  tryApi('https://mms.pinduoduo.com/earth/api/mallInfo/queryCredential',
    j => j?.result?.result?.mallName || j?.result?.mallName)
  setTimeout(() => resolve(''), 8000)
})

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const { launchOptions, profileCandidates, CHROME_PATH, STEALTH_ARGS, STEALTH_SCRIPT } =
    await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)

  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  let accs = store.listAccounts().filter(a => a.platform === 'pdd_mms')
  const only = argOf('account')
  if (only) accs = accs.filter(a => a.shop_key === only)
  if (!accs.length) { emit({ ok: false, failureKind: 'not_bound', text: '没有 pdd_mms 账号' }); process.exit(2) }

  const force = has('force')
  const results = []
  const L = [`PDD 店铺名补全（${accs.length} 个账号）`, '']

  for (const acc of accs) {
    const label = acc.display_label || ''
    const looksLikeHash = /^[0-9a-f]{16,}$/i.test(label) || /^1-/.test(label)

    if (!force && label && !looksLikeHash) {
      L.push(`⏭ ${acc.shop_key.slice(8, 24)} 已有店铺名「${label}」，跳过`)
      results.push({ shopKey: acc.shop_key, skipped: true, label })
      continue
    }

    // 找可用 profile（shopKey 目录 + display_label 目录）
    const cands = profileCandidates(acc.shop_key)
    const base = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts')
    const dirs = cands.map(c => path.join(base, c)).filter(d => fs.existsSync(d))
    if (!dirs.length) {
      L.push(`❌ ${acc.shop_key.slice(8, 24)} 没有 Profile 目录，跳过`)
      results.push({ shopKey: acc.shop_key, failed: true, reason: 'no profile' })
      continue
    }

    let name = ''
    let usedDir = ''
    for (const dir of dirs) {
      const browser = await puppeteer.launch(launchOptions(path.basename(dir)))
      const page = (await browser.pages())[0] || await browser.newPage()
      await page.evaluateOnNewDocument(STEALTH_SCRIPT)
      try {
        await page.goto('https://mms.pinduuduo.com/goods/goods_list'.replace('pinduuduo', 'pinduoduo'),
          { waitUntil: 'domcontentloaded', timeout: 45000 })
        await sleep(10000)
        if (/\/login/i.test(page.url())) continue    // 这个 profile 过期了，试下一个

        name = await page.evaluate(GRAB_FROM_DOM).catch(() => '')
        if (!name) name = String(await page.evaluate(GRAB_FROM_API).catch(() => '')).trim()
        if (name) { usedDir = path.basename(dir); break }
      } catch { /* 试下一个 */ }
      finally { await browser.close().catch(() => {}) }
      await sleep(4000)
    }

    if (name) {
      try {
        await store.save('pdd_mms', acc.cookies, {
          replaceShopKey: acc.shop_key,
          displayLabel: name,
          accountMeta: { ...(acc.account_meta || {}), mall_name: name, display_nick: name },
        })
        L.push(`✅ ${acc.shop_key.slice(8, 24)} → 「${name}」`)
        results.push({ shopKey: acc.shop_key, ok: true, name, via: usedDir })
      } catch (e) {
        L.push(`⚠️ ${acc.shop_key.slice(8, 24)} 抓到「${name}」但写回失败：${e.message?.slice(0, 60)}`)
        results.push({ shopKey: acc.shop_key, failed: true, name, reason: 'save failed' })
      }
    } else {
      L.push(`❌ ${acc.shop_key.slice(8, 24)} 抓不到店铺名（Profile 票据可能已过期）`)
      results.push({ shopKey: acc.shop_key, failed: true, reason: 'not found' })
    }
    await sleep(5000)
  }

  const okCount = results.filter(r => r.ok).length
  L.push('')
  L.push(`完成：${okCount} 个补全，${results.filter(r => r.failed).length} 个失败，${results.filter(r => r.skipped).length} 个跳过`)
  L.push('')
  L.push('失败的多为 Profile 票据过期 —— 到「账号连接」重新扫码即可。')

  emit({ ok: okCount > 0, mode: 'fill-mall-names', results, text: L.join('\n') })
  process.exit(okCount > 0 ? 0 : 2)
})().catch(async (e) => {
  emit({ ok: false, failureKind: 'exception', text: `店铺名补全异常：${e.message?.slice(0, 200)}` })
  process.exit(2)
})
