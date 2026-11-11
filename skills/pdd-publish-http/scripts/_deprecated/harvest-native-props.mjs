/**
 * harvest-native-props.mjs — 从页面提交时偷取权威属性结构
 *
 * ═══ 原理 ═══
 *   页面点「提交并上架」时，前端会：
 *     ① 调 template/mall 拉类目属性模板（权威数据）
 *     ② 重建 goods_properties（含正确的 template_pid + template_module_id + vid）
 *     ③ 发 action/edit
 *   我们在 ③ 拦截 body，把 goods_properties 存下来。
 *   这份数据 = 平台认可的权威结构，之后纯 HTTP 直接复用。
 *
 * ═══ 用法 ═══
 *   # 用一个已存在的草稿（或新建），让它走一次页面提交
 *   node harvest-native-props.mjs --shop <shopKey> --catId 16675 [--goods <id>] [--commit <id>]
 *
 *   产物：artifacts/pdd-native-props/cat<catId>_<shopKey>.json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }

const shopKey = arg('shop', '')
const catId = Number(arg('catId', '0'))
const goodsArg = arg('goods', '')
const commitArg = arg('commit', '')
const sourceArg = Number(arg('source', '0'))

if (!shopKey) { console.error('❌ 缺 --shop'); process.exit(1) }
const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const OUT = path.join(PLUGIN, 'artifacts', 'pdd-native-props')
fs.mkdirSync(OUT, { recursive: true })

const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href)
const hook = await import(pathToFileURL(`${PLUGIN}/skills/_shared/pdd-shadow-hook.mjs`).href).catch(() => null)

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})
const page = (await browser.pages())[0] || await browser.newPage()
if (hook) await hook.installShadowHook(page)

// ★ 拦截 action/edit
const captured = []
page.on('request', (req) => {
  if (/goodsCommit\/action\/edit/.test(req.url()) && req.method() === 'POST') {
    try {
      const bd = req.postData()
      if (bd && bd.length > 1000) {
        captured.push(bd)
        log(`★ 拦截到 action/edit（${bd.length} 字节）`)
      }
    } catch { }
  }
})

await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => { })
await sleep(12000)
if (/login/.test(page.url())) { log('❌ 未登录'); await browser.close(); process.exit(1) }

async function post(url, body, label = '') {
  const r = await page.evaluate(async (u, b) => {
    try {
      const resp = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), credentials: 'include' })
      return { status: resp.status, data: await resp.json() }
    } catch (e) { return { err: String(e).slice(0, 120) } }
  }, url, body).catch(e => ({ err: e.message.slice(0, 80) }))
  if (label) log(`   ${label} → ${r.data?.success ? '✅' : '❌'} ${r.data?.error_msg || r.err || ''}`)
  return r
}
const BASE = 'https://mms.pinduoduo.com'

// 决定用哪个草稿
let goodsId = goodsArg ? Number(goodsArg) : 0
let commitId = commitArg ? Number(commitArg) : 0

if (!goodsId) {
  // 新建一个草稿：复制源商品
  const srcId = sourceArg || 0
  if (!srcId) { log('❌ 需传 --goods/--commit，或 --source 让它复制一个'); await browser.close(); process.exit(1) }
  const r1 = await post(`${BASE}/glide/v2/mms/query/commit/on_shop/detail`, { goods_id: srcId }, 'on_shop/detail')
  const src = r1.data?.result
  if (!src) { await browser.close(); process.exit(1) }
  const r2 = await post(`${BASE}/glide/v2/mms/edit/commit/copyGoodsCommit`, { goods_id: srcId, goods_commit_id: Number(src.goods_commit_id) }, 'copyGoodsCommit')
  if (!r2.data?.result) { log('❌ 复制失败'); await browser.close(); process.exit(1) }
  goodsId = r2.data.result.goods_id
  commitId = r2.data.result.goods_commit_id
  log(`   草稿 goods_id=${goodsId} commit_id=${commitId}`)
}

// 打开草稿页
const url = `${BASE}/goods/goods_add/index?id=${commitId}&goods_id=${goodsId}`
log('')
log('打开草稿页:', url)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => { })
await sleep(22000)

// 等加载完成
for (let i = 0; i < 12; i++) {
  const busy = await page.evaluate(() => /加载中/.test(document.body.innerText || '')).catch(() => false)
  if (!busy) { log('页面就绪', i * 5, 's'); break }
  await sleep(5000)
}
await sleep(2000)

// 填参考价（必填）
const maxP = 199.9
const refRes = await page.evaluate((rp) => {
  let input = null
  for (const el of document.querySelectorAll('div,span,label')) {
    const t = (el.innerText || '').trim()
    if (!/商品参考价/.test(t) || t.length > 30) continue
    const sc = el.closest('div[class*="row"],div[class*="form"],div[class*="item"]') || el.parentElement
    input = sc?.querySelector('input'); if (input) break
  }
  if (!input) input = [...document.querySelectorAll('input')].find(e => /参考价/.test(e.placeholder || ''))
  if (!input) return { ok: false }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  input.scrollIntoView({ block: 'center' }); input.focus()
  if (setter) setter.call(input, String(rp)); else input.value = String(rp)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
  return { ok: true, now: input.value }
}, maxP).catch(() => ({ ok: false }))
log('参考价:', JSON.stringify(refRes))
await sleep(1500)

// ★ 点「提交并上架」→ 触发页面的 action/edit
const btn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /提交并上架/.test(x.innerText || ''))
  if (!b) return null
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
}).catch(() => null)
log('提交按钮:', JSON.stringify(btn))

if (!btn) { log('❌ 找不到提交按钮'); await page.screenshot({ path: path.join(OUT, 'no-button.png'), fullPage: true }).catch(() => { }); await browser.close(); process.exit(1) }

await page.mouse.click(btn.x, btn.y)
log('已点击，等 25s 抓包…')
await sleep(25000)
log('最终URL:', page.url())

if (!captured.length) {
  log('❌ 没抓到 action/edit')
  await page.screenshot({ path: path.join(OUT, 'no-capture.png'), fullPage: true }).catch(() => { })
  await browser.close(); process.exit(1)
}

// 取最后一个（含完整数据的）
const last = captured[captured.length - 1]
let j = null
try { j = JSON.parse(last) } catch { }

if (!j) { log('❌ body 解析失败'); await browser.close(); process.exit(1) }

const props = j.goods_properties || []
log('')
log('=== 页面自己发的权威属性 ===')
log(`共 ${props.length} 条：`)
props.forEach((p, i) => log(`  [${i}] name=${p.name_alias || p.name || '?'} ref_pid=${p.ref_pid} template_pid=${p.template_pid} template_module_id=${p.template_module_id} vid=${p.vid || ''} content=${p.content || ''}`))

// 存成模板
const realCat = Number(j.cat_id || catId || 0)
const outFile = path.join(OUT, `cat${realCat}_${shopKey}.json`)
const tpl = {
  catId: realCat,
  shopKey,
  harvestedAt: new Date().toISOString(),
  source: 'native action/edit interception',
  template_module_id_candidates: [...new Set(props.map(p => p.template_module_id).filter(Boolean))],
  goods_properties_tpl: props.map(p => ({
    template_pid: p.template_pid,
    template_module_id: p.template_module_id,
    ref_pid: p.ref_pid,
    pid: p.pid,
    name_alias: p.name_alias || p.name || '',
    value: '',
    value_unit: '',
    content: '',
    vid: undefined,
  })),
}
fs.writeFileSync(outFile, JSON.stringify(tpl, null, 2))
fs.writeFileSync(path.join(OUT, `cat${realCat}_${shopKey}_native-body.json`), last)

log('')
log('✅ 已保存：')
log('  ', outFile)
log('  ', path.join(OUT, `cat${realCat}_${shopKey}_native-body.json`))
log('')
log('template_module_id 候选值:', JSON.stringify(tpl.template_module_id_candidates))

// ═══ ★ 判断该类目需不需要品牌 ═══
const brandProp = props.find(p => Number(p.ref_pid) === 310)
const brandHasValue = !!(brandProp && (brandProp.vid || brandProp.content))
log('')
log('══════════ 品牌判定 ══════════')
if (!brandProp) {
  log('  该类目属性里没有品牌字段 → 不需要品牌')
  tpl.brandRule = { required: false, reason: '属性模板无 ref_pid=310' }
} else if (brandHasValue) {
  log(`  ✅ 需要品牌（必填）`)
  log(`     品牌名: ${brandProp.content}`)
  log(`     vid:   ${brandProp.vid}          ← 提交时必须带这个`)
  log(`     template_pid: ${brandProp.template_pid}`)
  log(`     template_module_id: ${brandProp.template_module_id}`)
  log(`     pid: ${brandProp.pid} | ref_pid: 310`)
  log('')
  log('  提交时 goods_properties 里品牌那一条必须是：')
  log(`    { template_pid: ${brandProp.template_pid}, template_module_id: ${brandProp.template_module_id}, ref_pid: 310, pid: ${brandProp.pid}, vid: ${brandProp.vid}, content: "${brandProp.content}", value: "" }`)
  tpl.brandRule = {
    required: true,
    brand_name: brandProp.content,
    vid: brandProp.vid,
    template_pid: brandProp.template_pid,
    template_module_id: brandProp.template_module_id,
    pid: brandProp.pid,
    ref_pid: 310,
    valueMustBeEmpty: true,
    note: 'vid 不是 brand/audit/record 返回的 brand_id，两者不同',
  }
} else {
  log('  ⭕ 不需要品牌（品牌字段存在但值为空，且提交成功）')
  log(`     template_pid: ${brandProp.template_pid} | template_module_id: ${brandProp.template_module_id}`)
  tpl.brandRule = { required: false, reason: '品牌字段存在但 vid/content 为空', template_pid: brandProp.template_pid, template_module_id: brandProp.template_module_id }
}

// propertys_tid 也存进去
log('')
log('══════════ 关键类目参数 ══════════')
log(`  propertys_tid: ${j.propertys_tid}     ← 属性模板 ID（填错会带出别的类目品牌）`)
log(`  cat_id:        ${realCat}`)
tpl.propertys_tid = j.propertys_tid
tpl.catProperties = props.map(p => ({ ref_pid: p.ref_pid, template_pid: p.template_pid, template_module_id: p.template_module_id, pid: p.pid, vid: p.vid || null, content: p.content || '' }))

fs.writeFileSync(outFile, JSON.stringify(tpl, null, 2))
log(`  → ${outFile}（已含 brandRule / propertys_tid）`)

await sleep(2000)
await browser.close().catch(() => { })

