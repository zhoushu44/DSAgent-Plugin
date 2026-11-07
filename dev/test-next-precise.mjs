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
await p.goto('https://mms.pinduoduo.com/goods/category', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 6000))

// ★ 用 DOM 精确定位：找文本【恰好】是「下一步,完善商品信息」的最小元素
const btn = await p.evaluate(() => {
  const NAV = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]'
  const cands = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => {
      const t = (el.innerText || '').trim().replace(/\s+/g, '')
      return /^下一步[,，]完善商品信息$/.test(t) && !el.closest(NAV)
    })
    .map(el => {
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 40),
        text: (el.innerText || '').trim(),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        w: Math.round(r.width), h: Math.round(r.height),
        visible: r.width >= 20 && r.y >= 0 && r.y <= window.innerHeight,
      }
    })
  // 取最小的（最内层）
  cands.sort((a, b) => (a.w * a.h) - (b.w * b.h))
  return cands.slice(0, 4)
})
console.log('候选按钮:', JSON.stringify(btn, null, 2))

const target = btn.find(x => x.visible)
if (!target) { console.log('❌ 无可见按钮'); process.exit(1) }

console.log(`\n点击 ${target.tag} (${target.x}, ${target.y}) "${target.text}"`)
await p.mouse.click(target.x, target.y)

// 观察
for (let i = 1; i <= 15; i++) {
  await new Promise(r => setTimeout(r, 1000))
  const st = await p.evaluate(() => ({
    url: location.href,
    hasSearch: !!document.querySelector('input[placeholder*="搜索分类"]'),
    props: document.querySelectorAll('[id^="basic.propertys."]').length,
  })).catch(() => null)
  if (st && (st.hasSearch || st.props > 0 || /goods_add/.test(st.url))) {
    console.log(`  ${i}s: ${JSON.stringify(st)}`)
    console.log('  ✅ 进入下一页')
    break
  }
  if (i === 15) console.log('  15s 无变化:', JSON.stringify(st))
}

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/next_step2.png' })
console.log('截图: next_step2.png')
await new Promise(r => setTimeout(r, 30000))
process.exit(0)
