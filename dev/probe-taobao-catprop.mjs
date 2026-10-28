/**
 * 探针：读淘宝发布页「类目属性」区的真实 DOM 结构，用于修正属性读取逻辑。
 * 零风险：不填表、不提交。
 *
 * 用法：node dev/probe-taobao-catprop.mjs [catId]
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CAT_ID = process.argv[2] || '150708'

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')
const { applyStealth } = await import('../lib/stealth-inject.js')

// 复用引擎里的浏览器/profile 工具
const { findChromePath, profileDir, clearProfileLocks, sleep, UI_STEP_DELAY_MS } = await import('../lib/browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')[0]
if (!acc) { console.error('无有效淘宝账号'); process.exit(1) }

const puppeteer = await import('puppeteer-core')
const chromePath = findChromePath()
if (!chromePath) { console.error('未找到 Chrome'); process.exit(1) }

const dir = profileDir('淘宝发布探针')
clearProfileLocks(dir)
const browser = await puppeteer.launch({
  headless: false,
  executablePath: chromePath,
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

try {
  const page = await browser.newPage()
  const cookies = Object.entries(acc.cookies || {})
    .filter(([, v]) => v !== '' && v != null)
    .flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.taobao.com', path: '/' },
      { name, value: String(value), domain: '.tmall.com', path: '/' },
    ]))
  await page.setCookie(...cookies)
  await applyStealth(page)

  const url = `https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT_ID}`
  console.log(`打开：${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(UI_STEP_DELAY_MS * 3)

  // 等属性区渲染
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('label').length).catch(() => 0)
    if (n > 3) break
    await sleep(500)
  }
  await sleep(3000)

  const probe = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const labels = Array.from(document.querySelectorAll('label'))
    const req = labels.filter(l => l.className && /required/.test(String(l.className)))
    return {
      url: location.href,
      title: document.title,
      counts: {
        labelAll: labels.length,
        labelRequired: req.length,
        structP: document.querySelectorAll('[id^="struct-p-"]').length,
        structCatProp: document.querySelectorAll('#struct-catProp').length,
        catPropClass: document.querySelectorAll('[class*="catProp"]').length,
        sellCatProp: document.querySelectorAll('[class*="sell-catProp"]').length,
        nextSelect: document.querySelectorAll('.next-select').length,
        nextFormItem: document.querySelectorAll('.next-form-item').length,
      },
      // 前 40 个 label 的文本 + class + 最近的祖先线索
      labelSample: labels.slice(0, 40).map(l => {
        let box = l, chain = []
        for (let i = 0; i < 6 && box; i++) {
          chain.push(`${box.tagName.toLowerCase()}${box.id ? '#' + box.id : ''}${box.className && typeof box.className === 'string' ? '.' + box.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''}`)
          box = box.parentElement
        }
        return { text: norm(l.innerText).slice(0, 24), cls: String(l.className || '').slice(0, 60), chain: chain.slice(0, 4) }
      }),
      // 含「必填」视觉标记的行
      requiredTexts: req.map(l => norm(l.innerText).slice(0, 24)).slice(0, 40),
      // 页面里所有带红星 * 的文本节点附近
      starBlocks: Array.from(document.querySelectorAll('div,li,tr')).filter(e => {
        const t = e.innerText || ''
        return /[*＊]/.test(t) && t.length < 200 && e.children.length < 12
      }).slice(0, 25).map(e => norm(e.innerText).slice(0, 60)),
      // 关键容器 id 清单
      structIds: Array.from(new Set(Array.from(document.querySelectorAll('[id^="struct-"]')).map(e => e.id))).slice(0, 40),
      bodyTextHead: norm(document.body?.innerText || '').slice(0, 600),
    }
  })

  console.log('\n===== 属性区 DOM 探针 =====')
  console.log(JSON.stringify(probe, null, 2))

  // 截图留证
  const shotDir = join('E:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'dev', '.ui-shots')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shotDir, { recursive: true })
  const shot = join(shotDir, `taobao-catprop-probe-${Date.now()}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  console.log(`\n截图：${shot}`)
} catch (err) {
  console.error('探针异常：', err)
  process.exitCode = 1
} finally {
  await browser.close().catch(() => {})
}
