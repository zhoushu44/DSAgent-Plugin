/**
 * 探针 14：诊断「请选择尺码」弹层的真实结构（零风险：只勾选不提交）。
 * 复刻 fillSkus ②b 的点击，dump 弹层内容。
 *
 * 用法：node dev/probe-taobao-size.mjs <catId>
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2]
if (!CAT_ID) { console.error('用法：node dev/probe-taobao-size.mjs <catId>'); process.exit(1) }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')
const { applyStealth } = await import('../lib/stealth-inject.js')
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const dir = profileDir('淘宝尺码弹层探针')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

try {
  const page = await browser.newPage()
  await page.setCookie(...Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([n, v]) => ([
      { name: n, value: String(v), domain: '.taobao.com', path: '/' },
      { name: n, value: String(v), domain: '.tmall.com', path: '/' },
    ])))
  await applyStealth(page)

  console.log(`直达 catId=${CAT_ID}，先键入一个颜色值再点尺码`)
  await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  // 找维度输入框
  const dims = await page.evaluate(() => {
    const box = document.getElementById('struct-saleProp')
    if (!box) return []
    const isDim = (ph) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(ph)
    return Array.from(box.querySelectorAll('input'))
      .filter(i => i.offsetParent !== null && isDim(i.placeholder || ''))
      .map(i => { const r = i.getBoundingClientRect(); return { ph: i.placeholder || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })
  }).catch(() => [])
  console.log('\n维度：', JSON.stringify(dims, null, 2))
  if (!dims.length) { await browser.close(); process.exit(0) }

  // 维度1 键入一个颜色
  await page.mouse.move(dims[0].x, dims[0].y)
  await sleep(200)
  await page.mouse.click(dims[0].x, dims[0].y)
  await sleep(400)
  await page.keyboard.type('黑色', { delay: 60 })
  await sleep(300)
  await page.keyboard.press('Enter')
  await sleep(1500)

  // 点尺码维度（先滚动到可见，避免坐标超视口）
  const sizeDim = dims.find(d => /尺码|身高/.test(d.ph)) || dims[1]
  console.log(`\n点尺码维度「${sizeDim.ph}」（y=${sizeDim.y}，视口 900）`)
  // 先滚动到该元素
  await page.evaluate((ph) => {
    const box = document.getElementById('struct-saleProp')
    if (!box) return
    const isDim = (p) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(p)
    const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || '') && i.placeholder === ph)
    inp?.scrollIntoView({ block: 'center' })
  }, sizeDim.ph).catch(() => {})
  await sleep(800)
  // 重新取坐标（滚动后变了）
  const rePos = await page.evaluate((ph) => {
    const box = document.getElementById('struct-saleProp')
    if (!box) return null
    const isDim = (p) => /主色|颜色分类|请选择尺码|^规格值$|颜色/.test(p)
    const inp = Array.from(box.querySelectorAll('input')).find(i => i.offsetParent !== null && isDim(i.placeholder || '') && i.placeholder === ph)
    if (!inp) return null
    const r = inp.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, sizeDim.ph).catch(() => null)
  console.log('滚动后坐标：', JSON.stringify(rePos))
  await page.mouse.click(rePos.x, rePos.y)
  // 弹层异步加载：多等几轮
  let dlg = null
  for (let round = 0; round < 6; round++) {
    await sleep(1500)
    dlg = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const overlays = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened, .sell-size-sale-props-standard-size-popup, [class*="size-popup"], [class*="size-sale-props"]'))
        .filter(p => p.offsetParent !== null)
      const out = overlays.map(p => {
        const labels = Array.from(p.querySelectorAll('label, .next-checkbox-wrapper, li, [class*="item"], span'))
          .filter(e => e.offsetParent !== null)
          .map(e => norm(e.textContent).slice(0, 20)).filter(Boolean)
        const btns = Array.from(p.querySelectorAll('button')).filter(b => b.offsetParent !== null).map(b => norm(b.textContent).slice(0, 16))
        const cbs = p.querySelectorAll('input[type="checkbox"]').length
        return { cls: String(p.className).slice(0, 60), checkboxCount: cbs, labels: Array.from(new Set(labels)).slice(0, 30), buttons: btns.slice(0, 8) }
      })
      return { count: overlays.length, overlays: out }
    }).catch(() => null)
    const hasCb = dlg?.overlays?.some(o => o.checkboxCount > 0 || o.labels.length > 0)
    console.log(`  第 ${round + 1} 轮：浮层 ${dlg?.count} 个，有内容=${!!hasCb}`)
    if (hasCb) break
  }

  console.log('\n===== 尺码弹层 =====')
  console.log(JSON.stringify(dlg, null, 2))

  // ★ 定位「确定」按钮：它可能不在上面那些浮层里
  const confirmProbe = await page.evaluate(() => {    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    // 全页找文本为「确定」的可见 button
    const all = Array.from(document.querySelectorAll('button, a, .next-btn, [role="button"]'))
      .filter(b => b.offsetParent !== null && norm(b.textContent) === '确定')
      .map(b => {
        const r = b.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled === true, cls: String(b.className).slice(0, 50) }
      })
    // 也找含「确定」文本的更大容器（footer 区）
    const footers = Array.from(document.querySelectorAll('[class*="footer"], [class*="size-popup"] [class*="bottom"]'))
      .filter(e => e.offsetParent !== null && /确定/.test(e.textContent || ''))
      .map(e => norm(e.textContent).slice(0, 40))
    return { confirmButtons: all, footers: footers.slice(0, 5) }
  }).catch((e) => ({ error: String(e).slice(0, 120) }))
  console.log('\n===== 「确定」按钮定位 =====')
  console.log(JSON.stringify(confirmProbe, null, 2))

  // ★ 点确定后，dump SKU 表相关 DOM（找真实选择器）
  if (confirmProbe.confirmButtons?.length) {
    const b = confirmProbe.confirmButtons[0]
    await page.mouse.move(b.x, b.y)
    await sleep(200)
    await page.mouse.click(b.x, b.y)
    console.log('\n点了「确定」')
    await sleep(4000)
    const skuProbe = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const cands = Array.from(document.querySelectorAll('[class*="sku" i], [id*="sku" i]'))
        .filter(e => e.offsetParent !== null)
        .map(e => ({
          tag: e.tagName.toLowerCase(),
          id: e.id || '',
          cls: String(e.className).slice(0, 60),
          rows: e.querySelectorAll('tr').length,
          text: norm(e.innerText).slice(0, 100),
        }))
      // 去重（父子都命中）
      const seen = new Set()
      const uniq = cands.filter(c => { const k = c.tag + c.id + c.cls; if (seen.has(k)) return false; seen.add(k); return true })
      return { count: cands.length, items: uniq.slice(0, 20) }
    }).catch((e) => ({ error: String(e).slice(0, 120) }))
    console.log('\n===== SKU 表 DOM =====')
    console.log(JSON.stringify(skuProbe, null, 2))
  }
} catch (err) {
  console.error('异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
