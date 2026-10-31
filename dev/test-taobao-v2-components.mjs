/**
 * 测试淘宝新版 SKU 面板组件 + 属性组件
 *
 * 用法：
 *   node dev/test-taobao-v2-components.mjs --cat=case           # dry（探针，不填）
 *   node dev/test-taobao-v2-components.mjs --cat=case --fill    # 实际填写测试
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const CAT = process.argv.find(a => a.startsWith('--cat='))?.split('=')[1] || 'case'
const DO_FILL = process.argv.includes('--fill')

const S = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/taobao-publish/scripts'
const { detectNewSkuPanel, fillSkuPanelV2, fillSkuTableV2 } = await import(`file:///${S}/sku-panel-v2.mjs`)
const { harvestAttrs, fillAttrs, checkRequiredFilled } = await import(`file:///${S}/attr-fill.mjs`)

const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const BASE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/multicat'
const productFile = `${BASE}/${CAT}/product.json`
const product = JSON.parse(fs.readFileSync(productFile, 'utf8'))
log(`测试类目: ${CAT}`)
log(`标题: ${product.title}`)
log(`规格: ${(product.specs || []).map(s => `${s.name}(${s.values?.length})`).join(' × ')}`)
log(`SKU: ${(product.skus || []).length} 行`)

// ── 打开淘宝发布页（复用引擎的浏览器启动）──
const PROFILE = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'taobao_2218891961201')
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'],
  protocolTimeout: 3600000,
})
const page = (await browser.pages())[0] || await browser.newPage()

// 打开发布页（用 catId 直达，跳过类目搜索）
const CAT_IDS = {
  case: '50025033',
  cup: '121400014',
}
const catId = CAT_IDS[CAT]
if (!catId) {
  log(`⚠ 未知类目 ${CAT} 的 catId`)
  process.exit(1)
}
const url = `https://item.upload.taobao.com/sell/v2/publish.htm?catId=${catId}`
log(`打开发布页: ${url}`)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log(`goto 警告: ${e.message.slice(0, 80)}`))
await sleep(12000)

// ── 探测：新面板 + 属性 ──
log(`\n${'='.repeat(70)}`)
log('探针：SKU 面板类型 + 属性结构')
log('='.repeat(70))

const isV2 = await detectNewSkuPanel(page)
log(`新版 SKU 面板: ${isV2 ? '✅ 是' : '❌ 否（旧版）'}`)

const attrResult = await harvestAttrs(page, { log })
log(`\n属性采集: ${attrResult.fields.length} 个`)
attrResult.fields.forEach((f, i) => {
  log(`  ${i + 1}. 「${f.name}」${f.required ? '★必填' : ''} kind=${f.kind} value="${f.value}"`)
})

// ── 可选：实际填写 ──
if (DO_FILL) {
  log(`\n${'='.repeat(70)}`)
  log('实际填写测试')
  log('='.repeat(70))

  if (isV2 && product.specs?.length) {
    log('\n--- 填新版 SKU 面板 ---')
    const r = await fillSkuPanelV2(page, product.specs, product.skus || [], { log })
    log(`结果: 已填 ${r.filled.length}，未填 ${r.missed.length}，SKU 表${r.created ? '已创建' : '未创建'}`)
    if (r.missed.length) log(`未填: ${r.missed.slice(0, 5).join(' / ')}`)

    if (r.created) {
      log('\n--- 填 SKU 表价格库存 ---')
      const t = await fillSkuTableV2(page, product.skus || [], { log })
      log(`结果: 已填 ${t.filled.length}，未填 ${t.missed.length}`)
      if (t.missed.length) log(`未填: ${t.missed.slice(0, 5).join(' / ')}`)
    }
  }

  if (product.attributes?.length) {
    log('\n--- 填类目属性 ---')
    const values = Object.fromEntries(product.attributes.map(a => [a.name, a.value]))
    const r = await fillAttrs(page, values, { log, fields: attrResult.fields })
    log(`结果: 已填 ${r.filled.length}，未填 ${r.missed.length}`)

    log('\n--- 复核必填 ---')
    await checkRequiredFilled(page, r.fields || attrResult.fields, { log })
  }
}

// 截图
const shot = `E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/taobao_${CAT}_probe.png`
await page.screenshot({ path: shot }).catch(() => {})
log(`\n📸 截图: ${shot}`)
log('★ 浏览器保留，供你核对')
await sleep(30 * 60 * 1000)
