/**
 * 真正的「拿真实 commitBody 改包」：
 *   页面自己点提交（带原生 XSRF/cookie/traceId），我在 CDP 层拦下 previewDraftSubmit，
 *   把它的 jsonBody 换成我们构造的完整数据，放行。
 *
 * 流程：
 *   1) 打开直达发布页，清掉 required 校验，往 formValues 填数据
 *   2) 点提交按钮 → 页面自己组装并发出 previewDraftSubmit
 *   3) CDP Fetch 拦截该请求 → 用我们的 jsonBody 覆盖 → continueRequest
 *   4) 等响应判定是否发布成功
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')

const main = await localImagesToSpaceUrls(['main_06.jpg', 'main_07.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls(['detail_10.jpg', 'detail_11.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
console.log('主图', main.urls.length, '详情', det.urls.length)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// ★ CDP Fetch 拦截提交请求 + 抓响应体
let intercepted = null
let responseBody = null
let resolveIntercept = null
const gotIt = new Promise((res) => { resolveIntercept = res })
const cdp = await page.target().createCDPSession()
// 拦截请求阶段改写 + 响应阶段读体
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*previewDraftSubmit*', requestStage: 'Request' }, { urlPattern: '*previewDraftSubmit*', requestStage: 'Response' }] })
cdp.on('Fetch.requestPaused', async (ev) => {
  const url = String(ev.request?.url || '')
  if (!/previewDraftSubmit/.test(url)) {
    await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => { })
    return
  }
  // 响应阶段：读体后放行
  if (ev.responseStatusCode) {
    try {
      const b = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId })
      responseBody = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body
    } catch (e) { }
    await cdp.send('Fetch.continueResponse', { requestId: ev.requestId }).catch(() => { })
    return
  }
  // 请求阶段：改 jsonBody
  const post = String(ev.request?.postData || '')
  const m = post.match(/jsonBody=([^&]+)/)
  if (!m) { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => { }); return }
  const newJson = await page.evaluate(() => window.__OUR_JSONBODY || null).catch(() => null)
  let outPost = post
  if (newJson && typeof newJson === 'object') {
    outPost = post.replace(/jsonBody=[^&]*/, 'jsonBody=' + encodeURIComponent(JSON.stringify(newJson)))
  }
  await cdp.send('Fetch.continueRequest', { requestId: ev.requestId, postData: Buffer.from(outPost, 'utf8').toString('base64') }).catch(() => { })
  intercepted = { url, before: post.length, after: outPost.length, replaced: !!newJson }
  resolveIntercept(intercepted)
})

await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

// 会话字段 + 校验清除
const sess = await page.evaluate(() => {
  const u = new URL(location.href)
  const J = window.Json || {}
  let itemId = null
  try { const m = JSON.stringify(J).match(/\b(1091\d{9})\b/); if (m) itemId = m[1] } catch (e) { }
  for (const el of Array.from(document.querySelectorAll('.required, [class*="required"]'))) el.classList.remove('required')
  for (const el of Array.from(document.querySelectorAll('[required]'))) el.removeAttribute('required')
  return { itemId, catId: u.searchParams.get('catId') }
})
console.log('会话:', JSON.stringify(sess))

// 填 state（让页面有内容，前端校验先放行）
await page.evaluate((mainUrls, detUrls) => {
  const fv = window.Json?.models?.formValues
  if (!fv) return
  fv.title = '改包测试 秋冬儿童休闲长裤'
  fv.price = '59.9'
  fv.quantity = '100'
  fv.mainImagesGroup = { images: mainUrls.map((u) => ({ url: u, pix: '800x800' })) }
  fv.desc = detUrls.map((u) => `<img src="${u}"/>`).join('')
  fv.tbExtractWay = { value: ['2'], template: '65293290580' }
}, main.urls, det.urls).catch(() => { })

// 设置我们要注入的完整 jsonBody（拦截时替换用）
await page.evaluate((payload) => { window.__OUR_JSONBODY = payload }, {
  fromLocal: null,
  frontDataLog: { identityId: 'general-taobao-100', mainCategoryId: 50008165, newPublish: true },
  auctionType: 'b', sevenDayDefaultValue: 1, id: Number(sess.itemId), copyItemMode: 0,
  catId: 50013618, userId: 2218891961201,
  title: '改包测试 秋冬儿童休闲长裤摇粒绒加绒',
  price: 59.9, quantity: 100,
  catProp: {
    'p-122276111': { value: '100-140cm', text: '100-140cm' },
    'p-414028073': { value: '休闲长裤', text: '休闲长裤' },
    'p-122216207': { value: '九分裤', text: '九分裤' },
    'p-20608': { value: '3岁', text: '3岁' },
    'p-24477': { value: '男女通用', text: '男女通用' },
    'p-149422948': { value: '其他', text: '其他' },
  },
  mainImagesGroup: { images: main.urls.map((u) => ({ url: u, pix: '800x800' })) },
  saleProp: {
    'p-1627207': [{ text: '格蕾灰' }, { text: '奶油黄' }],
    'p-122216343': { selectedSizeGroupId: { text: '身型', value: '136553091-kids_bottoms', subName: 'sizeGroup_136553091-kids_bottoms', sizeGroupType: 'kids_bottoms' } },
  },
  sku: [
    { props: [{ pid: 'p-1627207', vid: '格蕾灰' }, { pid: 'p-122216343', vid: '100cm' }], price: '59.9', quantity: '50', outerId: '' },
    { props: [{ pid: 'p-1627207', vid: '奶油黄' }, { pid: 'p-122216343', vid: '100cm' }], price: '59.9', quantity: '50', outerId: '' },
  ],
  customSaleProp: [{ items: [{ text: '格蕾灰' }, { text: '奶油黄' }] }],
  desc: det.urls.map((u) => `<img src="${u}"/>`).join(''),
  descType: '1',
  descRepublicOfSell: { descPageCommitParam: { opt: 0, clientType: 1, bizSource: 'sell', newItem: true, changed: true, params: 'params', maxHeight: 100000, templateContent: det.urls.map((u) => `<img src="${u}"/>`).join('') } },
  wirelessDesc: det.urls.map((u) => ({ type: 'img', url: u, pix: '790x1088' })),
  catPath: '当前类目：童装/婴儿装/亲子装>>裤子（新）>>休闲裤',
  stuffStatus: { value: 5 }, customize: { value: 'customize_0' }, globalStock: { value: 'globalStock_0' },
  subStock: { value: 1 }, tbExtractWay: { value: ['2'], template: '65293290580' },
  regionLimitSale: { value: 'regionLimitSale_0' }, sevenDaySupport: 1, startTime: { type: 0 }, ysbCheckTask: { value: 0 },
  multiDiscountPromotion: { type: 1, value: 9.5, enable: false },
})

await sleep(1500)
// 点提交（页面自己发请求）
await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) t.click()
}).catch(() => { })

// 等拦截 + 等响应
const inter = await Promise.race([gotIt, sleep(20000).then(() => null)])
console.log('\n===== 拦截 =====')
console.log(JSON.stringify(inter))
await sleep(8000)
console.log('最终 URL:', page.url())
console.log('\n===== previewDraftSubmit 响应 =====')
console.log((responseBody || '(无)').slice(0, 1200))
const bodyText='';console.log('页面:', bodyText)
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'hijack-submit.json'), JSON.stringify({ inter, finalUrl: page.url(), bodyText, responseBody }, null, 2))
console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
