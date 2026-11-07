import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})

const p = await b.newPage()
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 7000))

// ★ 真实鼠标点击（跟 openPublishEntry 一致）
const info = await p.evaluate(() => {
  const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
  const all = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => (el.innerText || '').trim() === '发布新商品' && !el.closest(NAV))
  return all.map(el => {
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      w: Math.round(r.width), visible: r.width >= 20 && r.y >= 0 && r.y <= window.innerHeight,
    }
  })
})
console.log('候选按钮:', JSON.stringify(info, null, 2))

const target = info.find(i => i.visible)
if (target) {
  console.log(`\n真实鼠标点击 (${target.x}, ${target.y})…`)
  await p.mouse.click(target.x, target.y)
} else {
  console.log('\n❌ 没有可见按钮')
  process.exit(1)
}

// 观察是否新开标签页 / 跳转
const before = await b.pages()
console.log(`点击前标签页: ${before.length}`)
for (let i = 1; i <= 12; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const pages = await b.pages()
  const urls = pages.map(x => x.url())
  const hit = urls.find(u => /goods\/(category|goods_add)/.test(u))
  if (pages.length > before.length || hit) {
    console.log(`  ${i}s: 标签页 ${before.length} → ${pages.length}${hit ? '，命中 ' + hit.slice(0, 70) : ''}`)
    break
  }
  if (i === 12) console.log('  12s 无变化')
}

// 检查当前页 URL 和搜索框
await new Promise(r => setTimeout(r, 3000))
const st = await p.evaluate(() => ({
  url: location.href,
  searchInputs: [...document.querySelectorAll('input')]
    .filter(i => /搜索分类|搜索类目/.test(i.placeholder || '')).length,
  propBoxes: document.querySelectorAll('[id^="basic.propertys."]').length,
}))
console.log('\n当前页:', JSON.stringify(st, null, 2))

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real_click.png' })
console.log('截图: real_click.png')
process.exit(0)
