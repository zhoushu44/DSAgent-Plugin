/**
 * 拦截并拿「正式提交」的完整请求体。
 * 做法：hook 页面内 fetch / XHR，在提交被前端拦下前先记录目标 URL 与 body。
 * 与预览提交不同 —— 正式提交接口只在「所有必填齐全」时才发出。
 * 所以这里直接全填 + 触发，用最小代价拿到真实正式提交体。
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

// 上传图片拿 URL
const main = await localImagesToSpaceUrls(['main_06.jpg', 'main_07.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls(['detail_10.jpg', 'detail_11.jpg'].map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
console.log('主图', main.urls.length, '详情', det.urls.length)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// ★ 核心：hook 页面内 fetch，拦截正式提交
const intercepted = []
await page.evaluateOnNewDocument(() => {
  const orig = window.fetch
  window.fetch = function (...args) {
    const url = String(args[0] || '')
    const opts = args[1] || {}
    if (/submit|publish|commit|save|create|add/i.test(url) && /sell/.test(url) && !/previewDraft|asyncOpt/.test(url)) {
      try {
        const body = typeof opts.body === 'string' ? opts.body : (opts.body ? '[object]' : '')
        window.__interceptedCommit = { url, method: opts.method || 'POST', body, ct: opts.headers?.['Content-Type'] || '' }
        window.__interceptedCommitList = window.__interceptedCommitList || []
        window.__interceptedCommitList.push(window.__interceptedCommit)
      } catch (e) { }
    }
    return orig.apply(this, args)
  }
})

await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(4000)

// 尽量填齐必填（照 diag 已验证的写法），让正式提交能发出
console.log('填必填属性 + 销售属性...')
await page.evaluate(async (mainUrls, detUrls) => {
  const fv = window.Json?.models?.formValues
  if (!fv) return
  fv.title = 'intercept test 秋冬儿童休闲长裤'
  fv.price = '59.9'
  fv.quantity = '100'
  fv.mainImagesGroup = { images: mainUrls.map((u) => ({ url: u, pix: '800x800' })) }
  fv.desc = detUrls.map((u) => `<img src="${u}"/>`).join('')
  fv.descType = '1'
  fv.catProp = {
    'p-122276111': { value: '100-140cm', text: '100-140cm' },   // 裤长
    'p-414028073': { value: '休闲长裤', text: '休闲长裤' },        // 裤型
    'p-122216343': { value: '136553091-kids_bottoms', text: '100cm' }, // 身高（尺码组）
    'p-122216207': { value: '9分裤', text: '9分裤' },              // 裤子分类
    'p-20608': { value: '3岁', text: '3岁' },                     // 适用年龄
    'p-24477': { value: '男女通用', text: '男女通用' },            // 适用性别
    'p-149422948': { value: '其他', text: '其他' },               // 材质成分
  }
  // 销售属性（含尺码维度的联动 selectedSizeGroupId）
  fv.saleProp = {
    'p-1627207': [{ text: '格蕾灰' }, { text: '奶油黄' }],
    'p-122216343': { selectedSizeGroupId: { text: '身型', value: '136553091-kids_bottoms', subName: 'sizeGroup_136553091-kids_bottoms', sizeGroupType: 'kids_bottoms' } },
  }
  fv.customSaleProp = [{ items: [{ text: '格蕾灰' }, { text: '奶油黄' }] }]
  fv.sku = [
    { props: [{ name: '格蕾灰' }, { name: '100cm' }], price: '59.9', quantity: '100', outerId: '' },
    { props: [{ name: '奶油黄' }, { name: '100cm' }], price: '59.9', quantity: '100', outerId: '' },
  ]
  fv.tbExtractWay = { value: ['2'], template: '65293290580' }
  fv.stuffStatus = 5
  fv.subStock = 1
}, main.urls, det.urls).catch(() => { })

await sleep(4000)
// 点提交，让页面发正式请求
await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) t.click()
})
await sleep(10000)

// 读拦截到的正式提交
const out = await page.evaluate(() => ({
  intercepted: window.__interceptedCommitList || [],
  finalUrl: location.href,
}))
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'intercepted-commit.json'), JSON.stringify(out, null, 2))
console.log('\n===== 拦截结果 =====')
console.log('条数:', out.intercepted.length)
for (const it of out.intercepted) {
  console.log('---', it.method, it.url.slice(0, 140), `(${it.body.length}B, ${it.ct})`)
  console.log('body 前 500:', it.body.slice(0, 500))
}
if (!out.intercepted.length) {
  console.log('⚠ 没有拦到正式提交。页面可能仍被前端校验拦住。')
  // 兜底：把当前页面错误面板打出来
  const errs = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="error"], [class*="danger"], .next-form-item-help'))
    .map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 12))
  console.log('页面红字:', JSON.stringify(errs))
}
console.log('\n窗口保持 30s 供观察')
await sleep(30000)
await browser.close()
