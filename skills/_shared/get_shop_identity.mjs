/** get_shop_identity.mjs — 从商品列表页读店铺名，确认新 shopKey 对应哪家店 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]
const { createSession } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-client.mjs')).href)

const s = await createSession(SHOP, {})
await s.page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 7000))

const info = await s.page.evaluate(() => {
  const t = document.body.innerText || ''
  // 右上角店铺名 / localStorage new_userinfo
  let mall = ''
  try {
    const raw = localStorage.getItem('new_userinfo')
    if (raw) { const j = JSON.parse(raw); mall = j?.mall?.mall_name || j?.mall_name || '' }
  } catch { }
  if (!mall) {
    const m = t.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,20}商行)/)
    if (m) mall = m[1]
  }
  const tabs = (t.match(/在售中\((\d+)\)/) || [])
  const drafts = (t.match(/草稿箱\((\d+)\)/) || [])
  const rejected = (t.match(/已驳回\(([\d+]+)\)/) || [])
  return { mall, onSale: tabs[1] || '', drafts: drafts[1] || '', rejected: rejected[1] || '', url: location.href }
})
console.log(JSON.stringify(info, null, 2))
await s.browser.close().catch(() => { })
process.exit(0)
