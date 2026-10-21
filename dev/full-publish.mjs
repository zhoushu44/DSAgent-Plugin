/**
 * 完整端到端：把所有已验证的片段拼起来，跑通一次真实发布。
 *
 * 每段都是前面单独验证过的：
 *   ① 图片空间纯 HTTP 上传（逆向接口）
 *   ② 主图 replay 注入渲染
 *   ③ 详情图页面上传器注入
 *   ④ 文本字段 native setter 写入（React 认可）
 *   ⑤ 属性真实点选（下拉）
 *   ⑥ 销售属性：颜色键入 + 身高弹层选尺码
 *   ⑦ 提交体拦改兜底 + 抓响应判定结果
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const CAT = argOf('cat') || '50013618'

// ① 上传图片
console.log('[1] 图片空间上传...')
const MAIN = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg', 'main_09.jpg', 'main_10.jpg']
const DETAIL = ['detail_10.jpg', 'detail_11.jpg', 'detail_12.jpg']
const mainUp = await localImagesToSpaceUrls(MAIN.map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
const detUp = await localImagesToSpaceUrls(DETAIL.map((n) => join(SRC, n)), { cookies: acc.cookies || {} })
console.log(`    主图 ${mainUp.urls.length}/${MAIN.length}  详情 ${detUp.urls.length}/${DETAIL.length}`)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())

// 抓 previewDraftSubmit 响应（判定发布结果）
const cdp = await page.target().createCDPSession()
await cdp.send('Network.enable')
const reqMap = new Map()
let submitResp = null
cdp.on('Network.requestWillBeSent', (e) => {
  if (/previewDraftSubmit|publishSubmit|submit\.htm/i.test(e.request.url) && e.request.method === 'POST') {
    reqMap.set(e.requestId, e.request.url)
  }
})
cdp.on('Network.loadingFinished', async (e) => {
  if (!reqMap.has(e.requestId)) return
  try {
    const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
    const text = (b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body)
    submitResp = { url: reqMap.get(e.requestId), status: e.response?.status, body: text.slice(0, 3000) }
    console.log('\n>>> 抓到提交响应', submitResp.status, submitResp.url.slice(0, 100))
  } catch { }
})
// 响应头
cdp.on('Network.responseReceived', (e) => {
  if (!reqMap.has(e.requestId)) return
  console.log('>>> 提交响应状态:', e.response.status, e.response.url.slice(0, 110))
})

await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(4000)
console.log('[2] 表单就绪')

// ③ native setter 写入工具（React 认可，已验证）
const setText = (phRe, val) => page.evaluate((src, v) => {
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
}, phRe.source, val)

// 标题 / 一口价 / 库存 / 货号
await setText(/最多允许输入30个汉字/, '秋冬儿童休闲长裤摇粒绒加绒男童女童家居')
await setText(/最多输入30字符/, '59.9')
await page.evaluate(() => {
  const inp = Array.from(document.querySelectorAll('input')).find((e) => e.offsetParent !== null && /^[01]$/.test(e.value || '') && /number|text/i.test(e.type || 'text'))
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(inp, '1000')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
  }
}).catch(() => { })
console.log('[3] 文本字段已写入')

// ② 主图 replay 注入 + 详情图页面上传器（已验证链路）
const { buildTaobaoJsonDocument, buildTaobaoJsonReplayInitScript } = await import('../lib/taobao-publish-replay.js')
// 详情图走编辑器上传器（本地文件）
console.log('[4] 详情图注入...')
await page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null
  const hit = Array.from(document.querySelectorAll('*')).find((e) => vis(e) && (e.textContent || '').trim() === '图文描述' && e.children.length === 0)
  if (hit) { hit.scrollIntoView({ block: 'center' }); hit.click() }
}).catch(() => { })
await sleep(3000)
// 编辑器挂载后点添加图片
await page.evaluate(() => {
  const ed = document.querySelector('#lite-decoration-editor')
  if (!ed) return
  const items = Array.from(ed.querySelectorAll('div,span,button,a'))
  const add = items.find((e) => e.offsetParent !== null && /add_title/i.test(String(e.className)) && /添加/.test(e.textContent || ''))
  if (add) add.click()
  const pic = items.find((e) => e.offsetParent !== null && /add_item/i.test(String(e.className)) && (e.textContent || '').trim() === '图片')
  if (pic) { pic.scrollIntoView({ block: 'center' }); pic.click() }
}).catch(() => { })
await sleep(3000)
let dlg = null
for (let i = 0; i < 16 && !dlg; i++) {
  dlg = page.frames().find((f) => /sucai-selector|select\.htm|image-bank/i.test(f.url()))
  if (!dlg) await sleep(900)
}
if (dlg) {
  await dlg.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const hit = Array.from(document.querySelectorAll('div,span,button,a')).find((e) => vis(e) && /^(本地上传|上传图片|上传)$/.test((e.textContent || '').trim()) && e.children.length <= 1)
    if (hit) hit.click()
  }).catch(() => { })
  await sleep(2500)
  const inputEl = await dlg.$('input[type="file"]').catch(() => null)
  if (inputEl) {
    await inputEl.uploadFile(...DETAIL.map((n) => join(SRC, n))).catch(() => { })
    await sleep(5000)
    await dlg.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === '完成')
      if (b) b.click()
    }).catch(() => { })
    await sleep(3000)
    // 选图 + 确定（N）
    const sel = await dlg.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter((b) => b.offsetParent !== null)
      let n = 0
      for (const b of boxes.slice(0, 6)) { if (!b.checked) { try { b.click(); n++ } catch { } } }
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.disabled).map((b) => (b.innerText || '').trim())
      return { n, btns }
    }).catch(() => ({ n: 0, btns: [] }))
    const okBtn = (sel.btns || []).find((t) => /^(确定|确认)(（\d+）|\(\d+\))?$/.test(t))
    if (okBtn) {
      await dlg.evaluate((label) => {
        const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === label)
        if (b) b.click()
      }, okBtn).catch(() => { })
      console.log('    详情图回填：' + okBtn)
    }
    await sleep(4000)
  }
}

// ⑤ 必填属性：真实点选第一个候选
const attrNames = ['裤长', '裤型', '裤子分类', '适用年龄', '适用性别', '材质成分']
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
  if (!ok) { console.log('    属性「' + nm + '」未找到控件'); continue }
  await sleep(1000)
  const picked = await page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
    if (!panel) return ''
    const items = Array.from(panel.querySelectorAll('.options-item, li, [role=option]')).filter((e) => e.offsetParent)
    const texts = items.map((e) => (e.textContent || '').trim()).filter(Boolean)
    const target = texts.find((t) => /无|否|其他|通用|休闲|九分|3岁|棉/.test(t)) || texts[0] || ''
    const hit = items.find((e) => (e.textContent || '').trim() === target)
    if (hit) { hit.click(); return target }
    return ''
  }).catch(() => '')
  await page.keyboard.press('Escape').catch(() => { })
  await sleep(700)
  if (picked) console.log('    属性「' + nm + '」=' + picked)
}
console.log('[5] 属性已填')

// ⑥ 销售属性：颜色键入 + 身高弹层选尺码
console.log('[6] 销售属性...')
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return
  const inp = Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /主色/.test(e.placeholder || ''))
  if (!inp) return
  inp.scrollIntoView({ block: 'center' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(inp, '格蕾灰')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}).catch(() => { })
await sleep(2500)
// 身高弹层
await page.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  const inp = box ? Array.from(box.querySelectorAll('input')).find((e) => e.offsetParent !== null && /请选择尺码/.test(e.placeholder || '')) : null
  if (inp) { inp.scrollIntoView({ block: 'center' }); inp.click(); inp.dispatchEvent(new Event('mousedown', { bubbles: true })) }
}).catch(() => { })
await sleep(2500)
const sizePicked = await page.evaluate(() => {
  const panel = Array.from(document.querySelectorAll('.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
  if (!panel) return null
  // 只点真正的尺码项（带 checkbox 的 label / 单个数字文案的元素）
  const items = Array.from(panel.querySelectorAll('label, .next-checkbox-wrapper, [class*="size-item"]'))
    .filter((e) => e.offsetParent !== null && /^\d+cm$/.test((e.textContent || '').trim()))
  if (!items.length) return null
  const target = items.find((e) => /^100cm$/.test((e.textContent || '').trim())) || items[0]
  const cb = target.querySelector('input[type=checkbox]') || (target.tagName === 'LABEL' ? target.control : null)
  if (cb && !cb.checked) { cb.click() }
  else target.click()
  return (target.textContent || '').trim()
})
if (sizePicked) {
  console.log('    身高选尺码:', sizePicked)
  // 点「确定」关弹层
  await page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll('.sell-size-sale-props-standard-size-popup, .next-overlay-wrapper.opened')).filter((p) => p.offsetParent).pop()
    if (!panel) return
    const btn = Array.from(panel.querySelectorAll('button')).find((b) => /确定/.test(b.innerText || '') && !b.disabled)
    if (btn) btn.click()
  }).catch(() => { })
}
await sleep(2500)

// ⑦ 主图 replay 注入 + 点提交
const doc = buildTaobaoJsonDocument({
  title: '秋冬儿童休闲长裤摇粒绒加绒男童女童家居', price: '59.9', stock: '1000', images: [],
  skus: [{ name: '格蕾灰', price: '59.9', stock: '500' }], imageUrls: mainUp.urls, detailImageUrls: [],
})
await page.evaluateOnNewDocument(buildTaobaoJsonReplayInitScript(JSON.stringify(doc))).catch(() => { })

let errBefore = -1
try {
  errBefore = await page.evaluate(() => {
    const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const m = t.match(/错误\s*\((\d+)\)/)
    return m ? Number(m[1]) : -1
  })
} catch { }
console.log('\n[7] 提交前错误数:', errBefore)

try {
  await page.evaluate(() => {
    const b = document.querySelector('button[name="button-submit"]')
    if (b && !b.disabled) { b.scrollIntoView({ block: 'center' }); b.click(); return }
    const t = Array.from(document.querySelectorAll('button')).find((x) => /提交|发布/.test(x.innerText || '') && !x.disabled)
    if (t) t.click()
  })
} catch { }

// 等提交响应（响应抓取在 loadingFinished 里异步进行，跳转后也能拿到）
let finalUrl = ''
for (let i = 0; i < 25; i++) {
  await sleep(2000)
  try { finalUrl = page.url() } catch { }
  if (submitResp) break
}
console.log('\n===== 提交响应 =====')
if (submitResp) {
  console.log('URL:', submitResp.url.slice(0, 130))
  console.log(submitResp.body)
} else {
  console.log('未抓到提交响应。最终 URL:', finalUrl)
  // 跳转后的页面文本（新 frame）
  try {
    const pages = await browser.pages()
    const cur = pages.find((p) => /taobao\.com/.test(p.url())) || pages[0]
    const t = await cur.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))
    console.log('页面:', t)
  } catch (e) { console.log('读页面失败:', e.message) }
}
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'full-publish-result.json'), JSON.stringify({ submitResp, errBefore, finalUrl }, null, 2))
console.log('\n已写结果。窗口保持 15s')
await sleep(15000)
await browser.close()
