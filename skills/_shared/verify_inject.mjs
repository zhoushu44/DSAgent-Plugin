/** verify_inject.mjs — 端到端验证：连接器 Cookie 能否让发布页进入登录态 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]
const loadShared = f => import(pathToFileURL(path.join(PLUGIN, 'skills', '_shared', f)).href)

const { default: puppeteer } = await import(pathToFileURL(path.join(PLUGIN, 'node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js')).href)
const { launchStealth } = await loadShared('pdd-launch.mjs')

console.log('=== 启动（应看到 Cookie 注入日志）===')
const { browser, page } = await launchStealth(SHOP, puppeteer)

console.log('=== 打开商品列表 ===')
await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err', e.message))
await new Promise(r => setTimeout(r, 6000))
const url = page.url()
console.log('URL:', url.slice(0, 90))

const state = await page.evaluate(() => {
  const t = document.body.innerText || ''
  const hasNewBtn = !!document.querySelector('button[data-tracking-viewid="new_product_releasing"]')
  const isLogin = /\/login/.test(location.href)
  const mall = (t.match(/店铺[：:]\s*(\S+)/) || [])[1] || ''
  return { isLogin, hasNewBtn, mall, title: document.title.slice(0, 40), snippet: t.replace(/\s+/g, ' ').slice(0, 150) }
})
console.log('STATE:', JSON.stringify(state, null, 2))

const ok = !state.isLogin && state.hasNewBtn
console.log(ok ? '\n✅ 修复生效：连接器 Cookie 已让发布页进入登录态' : '\n❌ 仍未登录，连接器 Cookie 可能已过期')
await browser.close().catch(() => { })
process.exit(ok ? 0 : 1)
