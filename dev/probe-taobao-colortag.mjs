/**
 * 探针 15：诊断「主色(必选)」颜色 tag 的建立（零风险：不提交）。
 * 试多种键入方式，找出哪种能让 tag 数增加。
 *
 * 用法：node dev/probe-taobao-colortag.mjs <catId> [颜色1,颜色2]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
const COLORS = (process.argv[3] || '黑色,白色').split(/[,，]/).map(s => s.trim()).filter(Boolean)
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-colortag.mjs <catId> [颜色1,颜色2]'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝颜色tag探针')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const countTags = (pg) => pg.evaluate(() => {
  const box = document.getElementById('struct-saleProp')
  if (!box) return { n: -1, sels: [] }
  const sels = ['.next-tag', '[class*="tag"]', '.sell-color-tag', '.sell-sale-prop-tag']
  let n = 0, found = ''
  for (const s of sels) {
    const c = box.querySelectorAll(s).length
    if (c > n) { n = c; found = s }
  }
  return { n, found }
}).catch(() => ({ n: -1 }))

try {
  const page = await browser.newPage()
  await page.setCookie(...Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => ([
      { name: n, value: String(v), domain: '.taobao.com', path: '/' },
      { name: n, value: String(v), domain: '.tmall.com', path: '/' },
    ])))
  await applyStealth(page)

  console.log(`直达 catId=${CAT_ID}，测试颜色：${COLORS.join(' / ')}`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  // 找「主色(必选)」输入框，dump 它的 DOM 上下文
  const box = await page.evaluate(() => {
    const box = document.getElementById('struct-saleProp')
    if (!box) return { found: false }
    const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
    const inputs = Array.from(box.querySelectorAll('input')).filter(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      .map(i => ({ ph: i.placeholder || '', ro: i.readOnly, cls: String(i.className).slice(0, 40) }))
    // 找 tag 容器
    const tagCands = Array.from(box.querySelectorAll('[class*="tag" i]')).slice(0, 6).map(e => ({ cls: String(e.className).slice(0, 50), text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 40) }))
    return { found: true, inputs, tagCands, text: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 260) }
  }).catch((e) => ({ error: String(e).slice(0, 120) }))
  console.log('\n===== 销售属性区 =====')
  console.log(JSON.stringify(box, null, 2))
  if (!box.found) { await browser.close(); process.exit(0) }

  const colorInput = box.inputs?.[0]
  if (!colorInput) { console.error('未找到主色输入框'); await browser.close(); process.exit(1) }

  for (let ci = 0; ci < COLORS.length; ci++) {
    const color = COLORS[ci]
    console.log(`\n---------- 第 ${ci + 1} 个颜色「${color}」 ----------`)

    // 滚动 + 取实时坐标
    const pos = await page.evaluate(() => {
      const box = document.getElementById('struct-saleProp')
      if (!box) return null
      const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
      const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      if (!inp) return null
      inp.scrollIntoView({ block: 'center' })
      const r = inp.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), ph: inp.placeholder }
    }).catch(() => null)
    console.log('坐标：', JSON.stringify(pos))

    const before = await countTags(page)
    await page.mouse.move(pos.x, pos.y)
    await sleep(200)
    await page.mouse.click(pos.x, pos.y)
    await sleep(500)
    console.log('聚焦后 input.value =', await page.evaluate(() => {
      const box = document.getElementById('struct-saleProp')
      const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
      const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      return inp?.value ?? null
    }).catch(() => null))

    await page.keyboard.type(color, { delay: 80 })
    await sleep(600)
    console.log('键入后 input.value =', await page.evaluate(() => {
      const box = document.getElementById('struct-saleProp')
      const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
      const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      return inp?.value ?? null
    }).catch(() => null))

    // 方式 A：Enter
    await page.keyboard.press('Enter')
    await sleep(1500)
    const afterA = await countTags(page)
    console.log(`方式A(Enter) 后 tag：${JSON.stringify(afterA)}（before=${before.n}）`)

    // 方式 B：若没建起来，试 Tab + 再点空白
    if (afterA.n <= before.n) {
      await page.mouse.click(400, 300)
      await sleep(800)
      const afterB = await countTags(page)
      console.log(`方式B(点空白) 后 tag：${JSON.stringify(afterB)}`)
    }

    // 方式 C：从下拉候选中点（Enter 建不起 tag，这是主力路径）
    const opts = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(p => p.offsetParent !== null)
      const p = panels[panels.length - 1]
      if (!p) return []
      return Array.from(p.querySelectorAll('.options-item, li, [role="option"]')).filter(n => n.offsetParent !== null)
        .map(n => {
          const r = n.getBoundingClientRect()
          return { t: (n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        })
    }).catch(() => [])
    console.log('面板候选：', JSON.stringify(opts.slice(0, 6)))
    const hit = opts.find(o => o.t === color)
    if (hit) {
      await page.mouse.move(hit.x, hit.y)
      await sleep(200)
      await page.mouse.click(hit.x, hit.y)
      await sleep(1800)
      const afterC = await countTags(page)
      console.log(`方式C(点候选) 后 tag：${JSON.stringify(afterC)}`)
      // 也看看 input 是否清空、颜色分类计数是否变
      const st = await page.evaluate(() => {
        const box = document.getElementById('struct-saleProp')
        const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
        const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || ''))
        const cnt = (box.innerText || '').match(/颜色分类\s*[（(]\s*(\d+)/)
        return { inputVal: inp?.value ?? null, colorCount: cnt ? cnt[1] : null, text: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 200) }
      }).catch(() => null)
      console.log('  点选后状态：', JSON.stringify(st))
    }
  }

  const final = await countTags(page)
  console.log(`\n===== 最终 tag 数：${final.n}（选择器 ${final.found}）=====`)
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
