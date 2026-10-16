/**
 * 决定性实验：遍历多个描述 → 打开类目下拉 → 找「其他服务」并选中
 * → 验证「网页版暂不支持」是否消失。
 *
 * 已知：类目下拉框可选（ant-select）。不同描述下发不同候选集，
 *       其中「软件/程序/网站开发」那批含「其他服务」(201461105)。
 * 只选择+校验，不点发布。
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const IMG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img/deepseek-api/01-钩子-官方2折.jpg'

// 目标：找含「其他服务」的候选集
const DESCS = [
  { name: 'D1-软件程序网站开发', desc: 'AI助手软件客户端，支持多模型切换，安装即用。\n\n支持Windows和Mac，正版授权，长期可用。' },
  { name: 'D2-API中转', desc: '【官方2折】AI大模型API中转 Key 独享 DeepSeek/Claude/GPT/GLM/Kimi 通用\n\n官方2折，1元起测，按量计费不用不扣。' },
  { name: 'D3-互联网软硬件服务', desc: '互联网软硬件相关技术服务，提供配置调试与远程协助。\n\n一对一指导，直到跑通为止。' },
]

const results = []

for (const d of DESCS) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
  await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.goofish.com', path: '/' },
    { name, value: String(value), domain: '.taobao.com', path: '/' },
  ])))

  const rec = { name: d.name }
  try {
    await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(5000)
    const fi = await page.$('input[type=file]')
    if (fi) await fi.uploadFile(IMG)
    await sleep(13000)
    const SEL = 'div[contenteditable="true"]'
    if (await page.$(SEL)) {
      await page.click(SEL)
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(d.desc, { delay: 8 })
    }
    await sleep(11000)
    await page.evaluate(() => {
      const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (s && i[0]) s.call(i[0], '1')
      if (i[0]) i[0].dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(14000)

    // 初始状态
    const st0 = await page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const m = t.match(/分类 \* ([^\s]+)/)
      return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t) }
    })
    rec.initial = st0

    // 打开下拉
    const box = await page.evaluate(() => {
      const lab = Array.from(document.querySelectorAll('label'))
        .find(l => (l.getAttribute('title') || l.innerText || '').trim().startsWith('分类'))
      const item = lab && lab.closest('.ant-form-item')
      const sel = item && item.querySelector('.ant-select')
      if (!sel) return null
      const r = sel.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!box) { rec.error = 'no select'; await page.close(); results.push(rec); continue }

    await page.mouse.click(box.x, box.y)
    await sleep(3000)
    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
    rec.options = opts

    // 找「其他服务」
    if (opts.includes('其他服务')) {
      rec.hasOtherService = true
      const ok = await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('.ant-select-item-option'))
          .find(e => (e.textContent || '').trim() === '其他服务')
        if (!t) return false
        t.scrollIntoView({ block: 'center' })
        t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        t.click()
        return true
      })
      await sleep(9000)
      rec.clicked = ok
      rec.after = await page.evaluate(() => {
        const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
        const m = t.match(/分类 \* ([^\s]+)/)
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === '发布')
        return { category: m ? m[1] : null,
                 blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t),
                 publishDisabled: btn ? btn.disabled : null }
      })
      await page.screenshot({ path: `${OUT}/xianyu-other-${d.name}.png`, fullPage: true })
      console.log(`\n★★★ [${d.name}] 选「其他服务」后:`, JSON.stringify(rec.after))
    } else {
      rec.hasOtherService = false
      console.log(`\n[${d.name}] 无「其他服务」，候选:`, JSON.stringify(opts))
    }
  } catch (e) {
    rec.error = String(e).slice(0, 200)
    console.log(`[${d.name}] 出错:`, String(e).slice(0, 150))
  }
  results.push(rec)
  await page.close()
}

writeFileSync(`${OUT}/xianyu-otherservice-test.json`, JSON.stringify(results, null, 2), 'utf-8')
console.log('\n===== 汇总 =====')
for (const r of results) {
  console.log(`${r.name}: 初始=${r.initial?.category}(被拦=${r.initial?.blocked}) 有「其他服务」=${r.hasOtherService}` +
    (r.after ? ` → 选择后=${r.after.category}(被拦=${r.after.blocked})` : ''))
}
await browser.close()
