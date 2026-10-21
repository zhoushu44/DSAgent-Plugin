/**
 * 端到端验证：全部字段用「native setter + input/change/blur」写入，
 * 看错误数能否归零、提交请求能否发出、提交体拦改能否生效。
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

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// 拦提交体
let intercepted = null
let responseBody = null
let resolveIt = null
const gotIt = new Promise((r) => { resolveIt = r })
const cdp = await page.target().createCDPSession()
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*previewDraftSubmit*', requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', async (ev) => {
  const url = String(ev.request?.url || '')
  if (!/previewDraftSubmit/.test(url)) { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => { }); return }
  const post = String(ev.request?.postData || '')
  const m = post.match(/jsonBody=([^&]+)/)
  let parsed = null
  if (m) { try { parsed = JSON.parse(decodeURIComponent(m[1])) } catch { } }
  intercepted = { url, len: post.length, title: parsed?.title, catProp: parsed?.catProp ? Object.keys(parsed.catProp).length : 0, skuLen: Array.isArray(parsed?.sku) ? parsed.sku.length : 0, mainImgLen: parsed?.mainImagesGroup?.images?.length || 0 }
  await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => { })
  resolveIt(intercepted)
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

const errCount = () => page.evaluate(() => {
  const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
  const m = t.match(/错误\s*\((\d+)\)/)
  return m ? Number(m[1]) : -1
})

// ★ native setter 写入工具（React 认可）
const setInput = async (phRe, value) => page.evaluate((src, v) => {
  const inp = Array.from(document.querySelectorAll('input, textarea'))
    .find((e) => e.offsetParent !== null && new RegExp(src).test(e.placeholder || ''))
  if (!inp) return false
  inp.scrollIntoView({ block: 'center' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(inp, v)
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
  return true
}, phRe.source, value)

console.log('基线错误数:', await errCount())

// 填字段
await setInput(/最多允许输入30个汉字/, '秋冬儿童休闲长裤摇粒绒加绒男童女童')
await setInput(/最多输入30字符/, '59.9')   // 一口价
console.log('标题+价格后错误数:', await errCount())

// 库存：找「库存」框
await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => e.offsetParent !== null && (e.value === '1' || e.value === '0') && /number|text/.test(e.type || 'text'))
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(inp, '100')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
  }
}).catch(() => { })

// 销售属性：主色（颜色分类）自由键入
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return
  const inp = Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /主色/.test(e.placeholder || ''))
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, '格蕾灰')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
  // 回车确认规格值（颜色分类是 tag 式输入，回车/Tab 确认）
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}).catch(() => { })
await sleep(2500)
console.log('颜色后错误数:', await errCount())

// 身高（尺码）联动：点开后看候选是否出现
const sizeResult = await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return 'no-box'
  const inp = Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /请选择尺码/.test(e.placeholder || ''))
  if (!inp) return 'no-input'
  inp.scrollIntoView({ block: 'center' })
  inp.click()
  return 'clicked'
})
await sleep(2500)
const sizeOpts = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter((p) => p.offsetParent)
  const panel = panels[panels.length - 1]
  if (!panel) return []
  return Array.from(panel.querySelectorAll('.options-item, li, [role=option]')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 12)
})
console.log('尺码候选:', JSON.stringify(sizeOpts))
if (sizeOpts.length) {
  await page.evaluate((want) => {
    const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter((p) => p.offsetParent)
    const panel = panels[panels.length - 1]
    const hit = Array.from(panel.querySelectorAll('.options-item, li, [role=option]')).find((e) => (e.textContent || '').trim() === want)
    if (hit) hit.click()
  }, sizeOpts[0]).catch(() => { })
  await sleep(1500)
  console.log('选尺码后错误数:', await errCount())
}

// 必填属性（下拉）：逐个选第一个合理候选
const attrNames = ['裤长', '裤型', '裤子分类', '适用年龄', '适用性别', '产地']
for (const nm of attrNames) {
  const ok = await page.evaluate((name) => {
    for (const l of Array.from(document.querySelectorAll('label'))) {
      const t = (l.innerText || '').replace(/[*＊]/g, '').trim()
      if (t !== name) continue
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
  }, nm).catch(() => false)
  if (!ok) continue
  await sleep(1000)
  await page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
    if (!panel) return
    const items = Array.from(panel.querySelectorAll('.options-item, li, [role=option]')).filter((e) => e.offsetParent)
    if (items.length) items[0].click()
  }).catch(() => { })
  await sleep(800)
  await page.keyboard.press('Escape').catch(() => { })
}
console.log('属性后错误数:', await errCount())

// 主图走 replay（注入过的 state 被认），详情走编辑器上传器（已验证）
await page.evaluate((mainUrls) => {
  const fv = window.Json?.models?.formValues
  if (fv) fv.mainImagesGroup = { images: mainUrls.map((u) => ({ url: u, pix: '800x800' })) }
}, main.urls)

console.log('\n提交前错误数:', await errCount())

// 点提交
await page.evaluate(() => {
  const b = document.querySelector('button[name="button-submit"]')
  if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
  const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
  if (t) t.click()
}).catch(() => { })

const inter = await Promise.race([gotIt, sleep(25000).then(() => null)])
console.log('\n===== 提交拦截 =====')
console.log(JSON.stringify(inter, null, 1))
if (!inter) {
  const t = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400))
  console.log('页面:', t)
}
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'react-write-result.json'), JSON.stringify({ intercepted: inter }, null, 2))
console.log('\n窗口保持 15s')
await sleep(15000)
await browser.close()
