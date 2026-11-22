/**
 * probe_with_cookie.mjs — 直接用凭证库 Cookie 打开真实网页，看服务端返回的是后台还是登录页
 *
 * 三重验证：
 *   ① 纯 HTTP GET /goods/goods_list  → 看 HTML 里是登录页还是商品列表
 *   ② 纯 HTTP GET /home/             → 后台首页
 *   ③ 浏览器注入 Cookie 后导航       → 真实渲染结果
 *
 * 判据不看 API 错误码，只看「服务端给我的 HTML 是什么」。
 */
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const _require = createRequire(import.meta.url)
const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]

const { CredentialStore } = _require(path.join(PLUGIN, 'lib/services/credential-store.js'))
const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = await store.get(SHOP)
if (!acc) { console.log('账号不存在'); process.exit(1) }

const jar = acc.cookies || {}
const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const UA = acc.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

console.log('店铺:', acc.display_label, '| Cookie', Object.keys(jar).length, '条')
console.log('='.repeat(70))

const TARGETS = [
  { name: '商品列表', url: 'https://mms.pinduoduo.com/goods/goods_list' },
  { name: '后台首页', url: 'https://mms.pinduoduo.com/home/' },
  { name: '订单查询', url: 'https://mms.pinduoduo.com/orders/list' },
]

for (const t of TARGETS) {
  try {
    const res = await fetch(t.url, {
      headers: {
        cookie: cookieStr,
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    })
    const html = await res.text()
    const finalUrl = res.url
    // 判据：登录页特征 vs 后台特征
    const isLogin = /扫码登录|账号登录|login_container|hasLogin|请登录/.test(html) && /passport|login/i.test(finalUrl + html.slice(0, 3000))
    const hasMall = /商品列表|发布新商品|goods_list|mallInfo/.test(html)
    const redirectedLogin = /\/login/.test(finalUrl)
    console.log(`\n[${t.name}] HTTP ${res.status}  len=${html.length}`)
    console.log(`  最终URL: ${finalUrl.slice(0, 100)}`)
    console.log(`  被重定向到登录页: ${redirectedLogin ? '❌ 是' : '✅ 否'}`)
    console.log(`  含后台特征(商品列表/发布新商品): ${hasMall ? '✅ 是' : '❌ 否'}`)
    console.log(`  含登录页特征: ${isLogin ? '❌ 是' : '✅ 否'}`)
    const title = (html.match(/<title>([^<]{0,80})<\/title>/) || [])[1] || ''
    console.log(`  title: ${title}`)
  } catch (e) {
    console.log(`\n[${t.name}] 请求异常: ${String(e.message).slice(0, 120)}`)
  }
}

// ── ③ 浏览器真实渲染 ──────────────────────
console.log('\n' + '='.repeat(70))
console.log('浏览器注入 Cookie 后真实访问：')
const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { createSession } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-client.mjs')).href)
let s
try {
  s = await createSession(SHOP, {})
  await s.page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 7000))
  const info = await s.page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasNewBtn: !!document.querySelector('button[data-tracking-viewid="new_product_releasing"]'),
    isLogin: /\/login/.test(location.href),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
  }))
  console.log(`  URL: ${info.url.slice(0, 100)}`)
  console.log(`  title: ${info.title.slice(0, 50)}`)
  console.log(`  登录页: ${info.isLogin ? '❌ 是（Cookie 无效）' : '✅ 否'}`)
  console.log(`  发布新商品按钮: ${info.hasNewBtn ? '✅ 有（已登录）' : '❌ 无'}`)
  console.log(`  页面片段: ${info.text}`)
} catch (e) {
  console.log('  浏览器验证异常:', String(e.message).slice(0, 150))
} finally {
  try { await s?.browser?.close() } catch { }
}
process.exit(0)
