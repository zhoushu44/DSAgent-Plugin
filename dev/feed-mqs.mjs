/**
 * 给觅千手喂数据：写 localStorage detailData + sessionStorage move_tab_active，
 * 重载页面让它的 hook 接管并自动填表。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')
const { buildTaobaoJsonDocument } = await import('../lib/taobao-publish-replay.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const MQS = 'E:\\360MoveData\\Users\\Administrator\\Desktop\\觅千手'
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')

const main = await localImagesToSpaceUrls(['main_06.jpg', 'main_07.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls(['detail_10.jpg', 'detail_11.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
console.log('主图', main.urls.length, '详情', det.urls.length)

// 构造 detailData（觅千手搬家格式）+ 完整 Json 文档
const detailData = {
  collect_source: 'shop_move',
  productId: 'mqs-test-' + Date.now(),
  pic_id: 'mqs-' + Date.now(),
  title: '觅千手喂入测试 秋冬儿童休闲长裤',
  main_img: main.urls,
  detail_img: det.urls,
  skuList: [
    { skuUniqueName: { value: '格蕾灰' }, price: '59.9', quantity: '100' },
    { skuUniqueName: { value: '奶油黄' }, price: '59.9', quantity: '100' },
  ],
}
const jsonDoc = buildTaobaoJsonDocument({
  title: detailData.title, price: '59.9', stock: '100',
  images: [], skus: [{ name: '格蕾灰', price: '59.9', stock: '50' }, { name: '奶油黄', price: '59.9', stock: '50' }],
  imageUrls: main.urls, detailImageUrls: det.urls,
})

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950',
    `--disable-extensions-except=${MQS}`, `--load-extension=${MQS}`],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

// 先到一个 taobao 页（让 localStorage/sessionStorage 能写）
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(2000)

// ★ 喂数据：detailData + Json 文档 + 搬家会话标记
await page.evaluate((dd, doc) => {
  localStorage.setItem('kdds_taobao_detailData', JSON.stringify(dd))
  localStorage.setItem('kdds_taobao_Json_backup', JSON.stringify(doc))
  localStorage.setItem('Json', JSON.stringify(doc))
  try { sessionStorage.setItem('kdds_taobao_move_tab_active', '1') } catch (e) { }
  localStorage.removeItem('kdds_taobao_sku_hook_done')
}, detailData, jsonDoc)
console.log('已喂入 detailData + Json + move_tab_active')

// ★ 同一标签页内导航（sessionStorage 不跨标签页，必须同 tab 才能带上 move_tab_active）
//   觅千手的搬家流程正是「同 tab 从商品页跳发布页」，hook 在该 tab 的 sessionStorage 里读标记。
try {
  await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618', { waitUntil: 'domcontentloaded', timeout: 90000 })
} catch (e) { console.log('导航提示:', e.message.slice(0, 60)) }
let pub = page
for (let i = 0; i < 35; i++) {
  await sleep(2000)
  const ok = await pub.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)
  if (ok) break
}
console.log('发布页就绪:', pub.url().slice(0, 90))
await sleep(6000)

// 检查觅千手是否接管 + 表单被填
const state = await pub.evaluate(() => {
  const fv = window.Json?.models?.formValues || {}
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  return {
    title: fv.title, price: fv.price, quantity: fv.quantity,
    mainImg: Array.isArray(fv.mainImagesGroup?.images) ? fv.mainImagesGroup.images.length : 0,
    descLen: String(fv.desc || '').length,
    hookResult: window.__kddsReplayResult || null,
    hookDone: localStorage.getItem('kdds_taobao_sku_hook_done'),
    moveTabActive: sessionStorage.getItem('kdds_taobao_move_tab_active'),
    hasDetailData: !!localStorage.getItem('kdds_taobao_detailData'),
    errCount: (t.match(/错误\s*\((\d+)\)/) || [])[1] || '无',
    bodyHint: t.slice(0, 300),
  }
})
console.log('\n===== 觅千手接管结果 =====')
console.log(JSON.stringify(state, null, 1))
console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
