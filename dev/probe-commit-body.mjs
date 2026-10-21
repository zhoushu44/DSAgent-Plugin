/**
 * 抓淘宝发布的真实提交体（用户思路的前置：先拿到 commitBody 再照结构拼装）。
 *
 * 做法：手动走到「提交宝贝信息」并点击，用 CDP 拦下所有 POST 请求体。
 * 不修改任何数据，只观察。
 *
 * 用法：node dev/probe-commit-body.mjs [--cat=50013618] [--hold=30]
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')
const { buildTaobaoJsonDocument, buildTaobaoJsonReplayInitScript } = await import('../lib/taobao-publish-replay.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const catId = argOf('cat') || '50013618'

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const main = await localImagesToSpaceUrls([join(SRC, 'main_06.jpg'), join(SRC, 'main_07.jpg')], { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls([join(SRC, 'detail_10.jpg'), join(SRC, 'detail_11.jpg')], { cookies: acc.cookies || {} })
console.log('图片:', main.urls.length, det.urls.length)

const doc = buildTaobaoJsonDocument({
  title: '抓包测试秋冬儿童休闲长裤', price: '59.9', stock: '100', images: [],
  skus: [{ name: '格蕾灰', price: '59.9', stock: '50' }],
  imageUrls: main.urls, detailImageUrls: det.urls,
})

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.evaluateOnNewDocument(buildTaobaoJsonReplayInitScript(JSON.stringify(doc)))
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))

// 拦所有 POST
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const posts = []
cdp.on('Network.requestWillBeSent', (e) => {
  if (e.request.method !== 'POST') return
  const u = e.request.url
  if (/\.(css|js|png|jpg|woff2?|svg)/i.test(u)) return
  posts.push({ id: e.requestId, url: u, hasPost: !!e.request.hasPostData, ct: (e.request.headers || {})['Content-Type'] || '' })
})

await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${catId}`,
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(4000)
console.log('表单就绪，开始填必填项...')

// 尽力填几个必填下拉（品牌/裤长/裤型等），让提交能走到后端
const fillSelect = async (labelName, wanted) => {
  const ok = await page.evaluate((nm) => {
    for (const l of Array.from(document.querySelectorAll('label'))) {
      const t = (l.innerText || '').replace(/[*＊]/g, '').trim()
      if (t !== nm) continue
      let box = l
      for (let i = 0; i < 6 && box; i++) {
        const cand = box.closest('.sell-catProp-item-common, .sell-catProp-item')
        if (cand && cand.querySelector('.next-select, input')) {
          const trg = cand.querySelector('.next-select-trigger, .next-select, input')
          if (trg) { trg.scrollIntoView({ block: 'center' }); trg.click(); return true }
        }
        box = box.parentElement
      }
    }
    return false
  }, labelName).catch(() => false)
  if (!ok) return false
  await sleep(1200)
  const picked = await page.evaluate((want) => {
    const panel = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).pop()
    if (!panel) return ''
    const items = Array.from(panel.querySelectorAll('.options-item, li, .next-menu-item, [role=option]'))
    const texts = items.map((e) => (e.textContent || '').trim()).filter(Boolean)
    const target = (want && texts.includes(want)) ? want : (texts.find((t) => /无|否|其他|通用/.test(t)) || texts[0] || '')
    const hit = items.find((e) => (e.textContent || '').trim() === target)
    if (hit) { hit.click(); return target }
    return ''
  }, wanted).catch(() => '')
  await page.keyboard.press('Escape').catch(() => { })
  await sleep(500)
  return picked ? `${labelName}=${picked}` : ''
}

const filledAttrs = []
for (const [nm, want] of [['裤长', '100-140cm'], ['裤型', '休闲长裤'], ['裤子分类', '九分裤'], ['适用年龄', '3岁'], ['适用性别', '男女通用'], ['产地', '中国大陆']]) {
  const r = await fillSelect(nm, want)
  if (r) filledAttrs.push(r)
}
console.log('已填属性:', filledAttrs.join(', '))

await sleep(2000)
// 点提交
const clicked = await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return 'by-selector' }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) { t.click(); return 'by-text' }
  return 'not-found'
})
console.log('提交按钮:', clicked)
await sleep(12000)

// 取所有 POST 体
const hold = Number(argOf('hold') || 0)
if (hold) { console.log(`保持 ${hold}s 供手动操作...`); await sleep(hold * 1000) }

const bodies = []
for (const p of posts) {
  try {
    const pd = await cdp.send('Network.getRequestPostData', { requestId: p.id })
    const data = pd.postData || ''
    if (data.length < 50) continue
    bodies.push({ url: p.url, len: data.length, ct: p.ct, head: data.slice(0, 3000), full: data.length < 400000 ? data : undefined })
  } catch { /* 已释放 */ }
}
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'commit-bodies.json'), JSON.stringify(bodies, null, 2))
console.log('\n===== POST 请求体 =====')
for (const b of bodies) {
  console.log(`--- ${b.url}  (${b.len} bytes, ${b.ct}) ---`)
  console.log(b.head.slice(0, 800))
  console.log()
}
console.log('共', bodies.length, '个，已写入 dev/.ui-shots/commit-bodies.json')
await sleep(5000)
await browser.close()
