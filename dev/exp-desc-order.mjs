/**
 * 详情图注入顺序实验（照实验成功路径复现）：
 *   1) 打开发布页，等表单就绪
 *   2) **先点开「图文描述」tab**（让详情编辑器挂载）
 *   3) **再写入** fv.desc + descType + descRepublicOfSell
 *   4) 观察 DOM
 *
 * 用法：node dev/exp-desc-order.mjs
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const main = await localImagesToSpaceUrls([join(SRC, 'main_06.jpg'), join(SRC, 'main_07.jpg')], { cookies: acc.cookies || {} })
const det = await localImagesToSpaceUrls([join(SRC, 'detail_10.jpg'), join(SRC, 'detail_11.jpg'), join(SRC, 'detail_12.jpg')], { cookies: acc.cookies || {} })
console.log('主图', main.urls.length, '详情图', det.urls.length)

const dir = profileDir('taobao', account)
const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
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
console.log('表单就绪')
await sleep(2000)

// ★ 步骤 2：先点 tab，等编辑器挂载
for (let i = 0; i < 6; i++) {
  const r = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const ed = document.querySelector('#lite-decoration-editor')
    const has = ed && ed.children.length > 0 && ed.getBoundingClientRect().height > 100
    if (has) return { mounted: true, h: Math.round(ed.getBoundingClientRect().height) }
    const hit = Array.from(document.querySelectorAll('*'))
      .find((e) => vis(e) && (e.textContent || '').trim() === '图文描述' && e.children.length === 0)
    if (hit) { hit.scrollIntoView({ block: 'center' }); hit.click(); return { mounted: false, clicked: true } }
    return { mounted: false, clicked: false }
  }).catch(() => ({ mounted: false }))
  console.log('tab 轮次', i, JSON.stringify(r))
  if (r.mounted) break
  await sleep(2500)
}
await sleep(2000)

// ★ 步骤 3：再写入
const html = det.urls.map((u) => `<img src="${u}"/>`).join('')
const w = await page.evaluate(({ html, mains, dets }) => {
  const J = window.Json
  const fv = J?.models?.formValues
  if (!fv) return 'no fv'
  fv.mainImagesGroup = { images: mains.map((u) => ({ url: u, pix: '800x800' })) }
  fv.desc = html
  fv.descType = '1'
  fv.wirelessDesc = dets.map((u) => ({ type: 'img', url: u, pix: '790x1088' }))
  fv.descRepublicOfSell = {
    descPageCommitParam: {
      opt: 0, clientType: 1, bizSource: 'sell', newItem: true, changed: true,
      params: 'params', maxHeight: 100000, templateContent: html,
    },
  }
  const c = J.components
  if (c?.mainImagesGroup?.props) c.mainImagesGroup.props.value = fv.mainImagesGroup
  if (c?.desc?.props) c.desc.props.value = html
  if (c?.descRepublicOfSell?.props) c.descRepublicOfSell.props.value = fv.descRepublicOfSell
  return 'written'
}, { html, mains: main.urls, dets: det.urls })
console.log('写入:', w)
await sleep(5000)

const res = await page.evaluate(() => {
  const norm = (a) => a.map((s) => String(s || '')).filter(Boolean)
  const mainEl = document.querySelector('.sell-component-simply-images')
  const mains = mainEl ? norm(Array.from(mainEl.querySelectorAll('img')).map((i) => i.src)) : []
  const ed = document.querySelector('#lite-decoration-editor')
  const all = ed ? norm(Array.from(ed.querySelectorAll('img')).map((i) => i.src)) : []
  const dets = all.filter((s) => /imgextra/i.test(s))
  return { mainDom: mains.length, detDom: dets.length, detSample: dets.slice(0, 3), edHtmlLen: ed ? ed.innerHTML.length : -1 }
})
console.log('\n===== 顺序实验 结果 =====')
console.log(JSON.stringify(res, null, 1))
console.log(res.mainDom > 0 ? '✅ 主图' : '❌ 主图')
console.log(res.detDom > 0 ? '✅ 详情图' : '❌ 详情图')

console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
