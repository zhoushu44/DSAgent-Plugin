/**
 * 直连提交：构造完整 jsonBody，在页面内 fetch POST previewDraftSubmit.htm。
 * 验证这是不是真正的「发布提交」。
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
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

// 拿会话字段：在整个 Json 里搜 itemId（13 位数字）
const session = await page.evaluate(() => {
  const u = new URL(location.href)
  const J = window.Json || {}
  let itemId = null
  try {
    const s = JSON.stringify(J)
    const m = s.match(/"(?:trueItemId|itemId)"\s*:\s*"?(\d{12,})/)
    if (m) itemId = m[1]
    if (!itemId) {
      const m2 = s.match(/\b(1091\d{9})\b/)
      if (m2) itemId = m2[1]
    }
  } catch (e) { }
  return {
    itemId, catId: u.searchParams.get('catId') || null,
    traceId: u.searchParams.get('gpfRenderTrace') || null,
    url: location.href.slice(0, 120),
  }
})
console.log('会话字段:', JSON.stringify(session))
if (!session.itemId) { console.error('缺 itemId'); process.exit(1) }

// ★ 从页面拿 window.csrfToken.tokenValue（这是发布页真实的 XSRF token）
const csrf = await page.evaluate(() => {
  const t = window.csrfToken
  if (t && t.tokenValue) return { name: t.tokenName || 'X-XSRF-TOKEN', value: t.tokenValue }
  return null
})
console.log('csrfToken:', csrf ? csrf.value : '(无)')
if (!csrf) { console.error('拿不到 csrfToken'); await browser.close(); process.exit(1) }

// 构造完整 jsonBody（照 real-commit.json 的结构，填进我们的数据）
const jsonBody = {
  fromLocal: null,
  frontDataLog: { identityId: 'general-taobao-100', mainCategoryId: 50008165, newPublish: true },
  auctionType: 'b',
  sevenDayDefaultValue: 1,
  id: session.itemId,
  copyItemMode: 0,
  postCouponPromotionId: null,
  spuMatch: null,
  guideMaterialEnable: 1,
  sevenDayGray: -1,
  catSuggest: { empty: false },
  riskWarningSubmit: false,
  feedbackSubmit_catErrorWarningSubmit: false,
  showDraft: 1,
  newDescVersion: 1,
  descRepublicEnable: 1,
  recommendInfo: '{"fromAiPublish":false,"fromNewImagePublish":false,"hasStructTitle":false,"algoScene":1,"preItemRender":false}',
  draftIdKey: 'dbDraftId',
  aliColorEnable: 'p-1627207',
  catId: 50013618,
  userId: acc.cookies?.unb ? Number(acc.cookies.unb) : 2218891961201,
  // 我们的数据
  title: '直连测试 秋冬儿童休闲长裤摇粒绒加绒',
  price: 59.9,
  quantity: 100,
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
  descRepublicOfSell: {
    descPageCommitParam: { opt: 0, clientType: 1, bizSource: 'sell', newItem: true, changed: true, params: 'params', maxHeight: 100000, templateContent: det.urls.map((u) => `<img src="${u}"/>`).join('') },
  },
  wirelessDesc: det.urls.map((u) => ({ type: 'img', url: u, pix: '790x1088' })),
  catPath: '当前类目：童装/婴儿装/亲子装>>裤子（新）>>休闲裤',
  stuffStatus: { value: 5 },
  customize: { value: 'customize_0' },
  globalStock: { value: 'globalStock_0' },
  subStock: { value: 1 },
  tbExtractWay: { value: ['2'], template: '65293290580' },
  regionLimitSale: { value: 'regionLimitSale_0' },
  sevenDaySupport: 1,
  startTime: { type: 0 },
  ysbCheckTask: { value: 0 },
  multiDiscountPromotion: { type: 1, value: 9.5, enable: false },
}

// ★ 用 node 侧 fetch 直接 POST（页面内 fetch/XHR 被 CSP 拦，改走 node，cookie 我全有）
// XSRF-TOKEN 从页面读（优先）或凭证库兜底
const cookieStr = Object.entries(acc.cookies || {})
  .filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `${k}=${v}`).join('; ')
const xsrf = csrf.value
const body = 'catId=' + session.catId + '&itemId=' + session.itemId + '&copyItemMode=0&jsonBody=' + encodeURIComponent(JSON.stringify(jsonBody))
const url = 'https://item.upload.taobao.com/sell/partEdit/previewDraftSubmit.htm?partEditScene=previewDraft'
let result
try {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf,
      'Referer': `https://item.upload.taobao.com/sell/v2/publish.htm?catId=${session.catId}`,
      'Origin': 'https://item.upload.taobao.com',
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    },
    body,
    signal: AbortSignal.timeout(60000),
  })
  const text = await r.text()
  result = { status: r.status, len: text.length, body: text.slice(0, 2000) }
} catch (e) {
  result = { err: String(e) }
}
console.log('\n===== 直连提交响应（node fetch）=====')
console.log('HTTP', result.status, '长度', result.len, 'xsrf=', xsrf ? xsrf.slice(0, 20) : '(无)')
console.log(result.body || result.err)
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'direct-submit-response.json'), JSON.stringify(result, null, 2))
console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
