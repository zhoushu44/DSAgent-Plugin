/**
 * 测试：主图能否并行投递
 * 文档说批量会静默丢弃，但那是原图（1-3MB）。
 * 现在压缩后是 0.3-0.4MB，值得再试。
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_2384db98bbcb596936cded12513defe7'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) { try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {} }

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: { width: 1600, height: 1000 },
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 3600000,
})
const p = (await b.pages())[0] || await b.newPage()
const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log('打开抱枕类目表单页…')
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205041314615', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(4000)

// 找主图 input
const IMG_DIR = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/multicat/towel/img'
const files = fs.readdirSync(IMG_DIR).filter(f => f.startsWith('main')).sort().slice(0, 5).map(f => `${IMG_DIR}/${f}`)
console.log('主图:', files.length, '张')

// 找 input
const inputSel = await p.evaluate(() => {
  const candidates = [
    'input[data-tracking-click-viewid="carousel_img_localfile_upload"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ]
  for (const sel of candidates) {
    const els = [...document.querySelectorAll(sel)]
    if (els.length) return { sel, count: els.length }
  }
  return null
})
console.log('input:', JSON.stringify(inputSel))

if (!inputSel) { console.log('找不到 input'); process.exit(1) }

const readCount = () => p.evaluate(() => {
  const body = document.body.innerText || ''
  const m = body.match(/已上传\s*(\d+)\s*\/\s*(\d+)/)
  if (m) return { cur: parseInt(m[1]), max: parseInt(m[2]) }
  // 数缩略图
  const imgs = [...document.querySelectorAll('img')].filter(im => {
    const src = im.getAttribute('src') || ''
    const r = im.getBoundingClientRect()
    return r.width >= 40 && r.width <= 300 && (/^https?:/.test(src) || src.startsWith('data:'))
  })
  return { cur: imgs.length, max: -1 }
})

console.log('\n=== 方式 A：并行投递 5 张 ===')
const before = await readCount()
console.log('投递前:', JSON.stringify(before))

const t0 = Date.now()
// 一次性投递所有
const h = await p.$(inputSel.sel)
await h.uploadFile(...files).catch(e => console.log('uploadFile 错误:', e.message.slice(0, 60)))
console.log('已一次性投递', files.length, '张')

// 观察 20 秒
for (let i = 1; i <= 10; i++) {
  await sleep(2000)
  const st = await readCount()
  console.log(`  ${i * 2}s: ${JSON.stringify(st)}`)
  if (st.cur >= files.length) { console.log('  ✅ 全部上传成功'); break }
}
const cost = Date.now() - t0
console.log(`总耗时: ${cost}ms`)

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/parallel_upload.png' })
console.log('截图: parallel_upload.png')
await new Promise(r => setTimeout(r, 5 * 60 * 1000))
