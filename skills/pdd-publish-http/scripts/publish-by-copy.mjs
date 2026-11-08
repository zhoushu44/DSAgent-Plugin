/**
 * publish-by-copy.mjs — 拼多多主发布路径：复制本店商品 → 改包 → 提交
 *
 * ═══════════════════════════════════════════════════════════════════
 *  这是拼多多上架的【首选】方式。核心思路：
 *    不从空白发布页走，而是「复制本店已有商品」，再改 SKU / 标题 / 图 / 价格。
 *
 *  为什么这样做：
 *    ① 免选类目        —— 类目跟着源商品走
 *    ② 免填属性        —— 属性结构继承源商品
 *    ③ 免填品牌        —— 品牌继承源商品（解决 brand_limit=true 类目的必填问题）
 *    ④ 快              —— 复制 1-3 秒，全流程 40-90 秒
 *    ⑤ 通用            —— 不限于某个类目，店里有什么类目就能发什么类目
 *
 * ═══════════════════════════════════════════════════════════════════
 *  使用前提（缺一不可）
 *    ① 本店必须已有【同类目】商品作为复制源
 *       跨店复制会报「该商品不属于该店铺」
 *    ② 源商品复制一次后会被锁，再复制报 600102「该商品已被新建过,请勿连续新建」
 *       → 需轮换多个源商品
 *    ③ 账号需已登录拼多多商家后台（浏览器 profile 有效）
 *
 * ═══════════════════════════════════════════════════════════════════
 *  用法
 *    # 1. 列出本店可用的复制源（按类目筛）
 *    node publish-by-copy.mjs --shop <shopKey> --list [--catId 16675]
 *
 *    # 2. 预览（不写任何数据）
 *    node publish-by-copy.mjs --shop <shopKey> --product p.json --source <goodsId> --dry
 *
 *    # 3. 真实发布（L2，需用户确认）
 *    node publish-by-copy.mjs --shop <shopKey> --product p.json --source <goodsId> --confirm
 *
 * ═══════════════════════════════════════════════════════════════════
 *  商品 JSON（product）
 *    {
 *      "title":     "≤30 汉字 / 60 字符",       ← 超长会被平台拦（错误：商品标题最多填写30个汉字）
 *      "images":    ["本地绝对路径", ...],        ← 1~5 张，可选；不传则沿用源商品图
 *      "price":     "参考价",                     ← 可选，默认取 SKU 最大单买价 + 1
 *      "stock":     "默认库存",
 *      "specs": [                                 ← 规格维度，1~2 维
 *        { "name": "款式", "values": [{"value":"A"},{"value":"B"}] }
 *      ],
 *      "skus": [                                  ← SKU 行，需覆盖全部维度
 *        { "specs": {"款式":"A"}, "price":"19.9", "stock":"100", "itemNo":"A1" }
 *      ]
 *    }
 *
 * ═══════════════════════════════════════════════════════════════════
 *  实测记录（2026-11）
 *    门贴（空空商行 cat 9683）: 1维1值 / 1维3值 / 2维2×2 / 2维3×3 全部成功，最快 3 秒
 *    纸杯（爱绿森 cat 16675）: 1维2值 / 2维2×2 成功（页面提交路径）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')

const argv = process.argv.slice(2)
const arg = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 ? String(argv[i + 1] ?? d) : d }
const has = n => argv.includes(`--${n}`)

const shopKey = arg('shop', '')
const productFile = arg('product', '')
const sourceId = Number(arg('source', '0'))
const catId = Number(arg('catId', '0'))
const LIST = has('list')
const DRY = has('dry')
const CONFIRM = has('confirm')

if (!shopKey) { console.error('❌ 必须传 --shop <shopKey>'); process.exit(1) }
const PROFILE = path.join(os.homedir(), '.dsh', 'browser-profiles', 'accounts', shopKey)

const LOGPATH = path.join(__dirname, '..', '..', '..', 'artifacts', 'pdd-publish-by-copy', `run-${Date.now()}.log`)
const lines = []
const log = (...a) => {
  const s = `[${new Date().toISOString().slice(11, 19)}] ` + a.join(' ')
  console.log(s); lines.push(s)
  try { fs.mkdirSync(path.dirname(LOGPATH), { recursive: true }); fs.writeFileSync(LOGPATH, lines.join('\n')) } catch { }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href)
const hook = await import(pathToFileURL(`${PLUGIN}/skills/_shared/pdd-shadow-hook.mjs`).href).catch(() => null)
const antiban = await import(pathToFileURL(`${PLUGIN}/skills/_shared/pdd-antiban.mjs`).href).catch(() => null)

// ★ 基座风控（pdd-risk）：账号级节流 + 冷却 + 滑块守卫 + 通行证
const risk = await import(pathToFileURL(`${PLUGIN}/skills/_shared/pdd-risk.mjs`).href).catch(() => null)
if (risk) log('基座风控已加载（throttle strict=20次/分 + 冷却 + 滑块守卫）')
else log('⚠ 基座风控未加载，降级为 pdd-antiban')

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: [
    '--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized',
    // ★ 防后台节流：窗口失焦/遮挡时 Chrome 会冻结渲染器，导致 page.evaluate 超时
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})
const page = (await browser.pages())[0] || await browser.newPage()
if (hook) await hook.installShadowHook(page)   // 防 closed shadow DOM 滑块

// ★ Node 直连（带浏览器 Cookie）：页面内 evaluate 会被 Chrome 渲染器节流，
//   实测 commit/submit 会挂死 120s+，而 Node 直连 167ms 就返回。
let COOKIE_CACHE = null
async function refreshCookies() {
  try {
    const cks = await page.cookies('https://mms.pinduoduo.com')
    COOKIE_CACHE = cks.map(c => `${c.name}=${c.value}`).join('; ')
  } catch (e) {
    // 页面会话失效时，从浏览器上下文重新取
    const ctx = browser.defaultBrowserContext()
    const cks = await ctx.cookies('https://mms.pinduoduo.com').catch(() => [])
    if (cks.length) COOKIE_CACHE = cks.map(c => `${c.name}=${c.value}`).join('; ')
  }
  return COOKIE_CACHE
}
async function nodePost(url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!COOKIE_CACHE) await refreshCookies()
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cookie': COOKIE_CACHE,
          'origin': 'https://mms.pinduoduo.com',
          'referer': 'https://mms.pinduoduo.com/goods/goods_list',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      const data = await resp.json()
      return { status: resp.status, data }
    } catch (e) {
      const msg = String(e?.message || e)
      if (attempt === 0) { await refreshCookies(); continue }
      return { err: msg.slice(0, 150) }
    }
  }
  return { err: 'nodePost failed' }
}

// 带节流的 post（账号级 4-6s / 接口级 1.8s / 40002 冷却 240s）
async function post(url, body, label = '') {
  const ep = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
  const MAXR = 2
  for (let attempt = 0; attempt <= MAXR; attempt++) {
    // ★ 基座风控①：账号级冷却检查（54001/40002 后会被 markCooldown 标记）
    if (risk) {
      const cd = risk.checkCooldown(shopKey)
      if (cd?.cooling) {
        log(`   ⏳ 账号冷却中 ${risk.fmtRemain ? risk.fmtRemain(cd.remainMs) : Math.ceil(cd.remainMs / 1000) + 's'}（${cd.reason || ''}）`)
        await sleep(Math.min(cd.remainMs, 300000))
      }
    }
    // ★ 基座风控②：账号级滑动窗口节流（商品域 20 次/分钟）
    if (risk) {
      try { await risk.throttleRequest(shopKey, 'strict') } catch { }
    }
    // ★ 兜底：pdd-antiban 时间槽（接口级 1.8s）
    if (antiban) {
      const slot = await antiban.reserveSlot(shopKey, ep)
      if (slot.waitMs > 0) {
        if (slot.cooling) log(`   ⏳ 冷却 ${Math.ceil(slot.waitMs / 1000)}s（${slot.reason}）`)
        await sleep(slot.waitMs)
      }
    }
    let r = null
    for (let i = 0; i < 3; i++) {
      try { await page.waitForFunction(() => document.readyState === 'complete', { timeout: 20000 }) } catch { }
      // ★ 用 Node 直接 fetch（带浏览器 Cookie）——页面内 evaluate 会被渲染器节流拖死
      r = await nodePost(url, body)
      if (!/detached Frame|Execution context|Target closed/.test(String(r.err || ''))) break
      await sleep(2500)
    }
    const ok = !!r?.data?.success
    const ec = r?.data?.error_code
    if (ok) { antiban?.recordResult(shopKey, 'ok'); if (label) log(`   ${label} → ✅`); return r }
    if (ec === 40002) {
      antiban?.recordResult(shopKey, 'rate_limit')
      // ★ 基座风控：记录冷却（240s），后续请求会自动等待
      if (risk) { try { risk.markCooldown(shopKey, 40002, `40002 高频 ${ep}`) } catch { } }
      log(`   ${label} → ⚠ 40002 高频（${attempt + 1}/${MAXR + 1}），已记冷却 240s`)
      if (attempt < MAXR) { await sleep(240000); continue }
    } else if (ec === 54001) {
      antiban?.recordResult(shopKey, 'captcha')
      if (risk) { try { risk.markCooldown(shopKey, 54001, `54001 风控 ${ep}`) } catch { } }
      log(`   ${label} → ⚠ 54001 风控（${attempt + 1}/${MAXR + 1}）`)
      // ★ 基座风控：尝试自动过滑块（连续失败会自动停，转人工）
      if (risk && page && attempt < MAXR) {
        try {
          const stop = risk.shouldStopAutoSlider ? risk.shouldStopAutoSlider(shopKey) : { stop: false }
          if (stop.stop) {
            log(`   ⚠ ${stop.reason}`)
          } else {
            log('   尝试自动过滑块…')
            const solved = await risk.autoSolveSlider(shopKey, page)
            log(`   滑块: ${solved?.ok ? '✅ 通过' : '❌ ' + (solved?.text || '').slice(0, 60)}`)
            if (solved?.ok) continue
          }
        } catch (e) { log('   滑块尝试异常:', e.message.slice(0, 60)) }
      }
      if (attempt < MAXR) { await sleep(60000); continue }
    } else if (ec === 43001 || ec === 40001) {
      antiban?.recordResult(shopKey, 'session')
      if (risk) { try { risk.markCooldown(shopKey, 43001, '会话失效') } catch { } }
      log(`   ${label} → ❌ 会话失效，请到「账号连接」重新登录`)
      return r
    }
    // ★ 基座风控：识别其它未列出的风控码
    if (risk && !ok && attempt === 0) {
      try {
        const det = risk.detectRiskCode(r?.data)
        if (det?.isRisk) log(`   识别到风控码 ${det.code}: ${det.reason || ''}`)
      } catch { }
    }
    if (label) log(`   ${label} → ❌ ${r?.data?.error_msg || r?.err || ''}`)
    if (ec !== 40002 && ec !== 54001) return r
  }
  return null
}
const BASE = 'https://mms.pinduoduo.com'

// 启动：确认登录
// ★ 基座风控：账号级并发锁（防多个技能同时操作同一账号 → 必触发 54001）
if (risk) {
  const lk = await risk.tryAcquireAccountLock(shopKey, 'pdd-publish-by-copy', 30000)
  if (!lk.ok) {
    log(`❌ 账号正被占用（${lk.holder || '未知任务'}），30s 内未释放。请等其它任务结束。`)
    await browser.close().catch(() => { })
    process.exit(1)
  }
  log('   账号锁已获取')
  process.on('exit', () => { try { risk.releaseAccountLock(shopKey) } catch { } })
}

await page.goto(`${BASE}/goods/goods_list`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => { })
await sleep(12000)
if (/login/.test(page.url())) { log('❌ 未登录，请先在「账号连接」绑定/重新登录拼多多商家后台'); if (risk) { try { risk.releaseAccountLock(shopKey) } catch { } } await browser.close(); process.exit(1) }
log('✅ 已进入商家后台')
await refreshCookies()   // ★ 预热 Cookie，后续全部走 Node 直连
log(`   Cookie 已缓存（${COOKIE_CACHE.length} 字符）`)

// ── 模式一：列出复制源 ────────────────────────────────────────────────
if (LIST) {
  const rows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('table tbody tr')]
    return trs.map(tr => {
      const t = (tr.innerText || '').replace(/\s+/g, ' ').trim()
      const id = (t.match(/(\d{12,})/) || [])[1] || ''
      return { id, name: t.slice(0, 50) }
    }).filter(x => x.id)
  }).catch(() => [])
  log('')
  log('=== 本店可复制商品 ===')
  if (!rows.length) {
    log('未读到商品（可能页面未加载完或触发了验证码）')
  } else {
    rows.forEach(r => log(`  ${r.id}  ${r.name}`))
  }
  await browser.close(); process.exit(0)
}

// ── 商品校验 ────────────────────────────────────────────────────────
if (!productFile || !fs.existsSync(productFile)) { log('❌ 缺 --product <json>'); await browser.close(); process.exit(1) }
if (!sourceId) { log('❌ 缺 --source <goodsId>（本店已有商品 ID）'); await browser.close(); process.exit(1) }
const product = JSON.parse(fs.readFileSync(productFile, 'utf8'))

const cjk = (product.title.match(/[\u4e00-\u9fa5]/g) || []).length
if (cjk > 30) { log(`❌ 标题 ${cjk} 个汉字，超过平台上限 30 个。请缩短标题。`); await browser.close(); process.exit(1) }
if (!product.specs?.length) { log('❌ product.specs 不能为空'); await browser.close(); process.exit(1) }
if (product.specs.length > 2) { log('❌ 最多 2 个规格维度'); await browser.close(); process.exit(1) }

log('')
log('商品:', product.title, `(${cjk}汉字)`)
log('规格:', product.specs.map(d => `${d.name}(${d.values.length})`).join(' × '), '→', product.skus.length, '行')
log('源商品:', sourceId, '| 模式:', DRY ? '预览' : (CONFIRM ? '真实发布' : '需 --confirm'))

// ── ① 拉源商品 ──────────────────────────────────────────────────────
const r1 = await post(`${BASE}/glide/v2/mms/query/commit/on_shop/detail`, { goods_id: sourceId }, 'on_shop/detail')
const src = r1.data?.result
if (!src) { log('❌ 源商品读取失败（可能不属于本店）'); await browser.close(); process.exit(1) }
const srcCat = Number(src.cat_id)
log(`   源: ${(src.goods_name || '').slice(0, 28)} | cat=${srcCat}`)
if (catId && catId !== srcCat) log(`   ⚠ 传了 --catId=${catId} 但源商品属于 ${srcCat}，以源为准`)

// ── ② 复制 ─────────────────────────────────────────────────────────
const r2 = await post(`${BASE}/glide/v2/mms/edit/commit/copyGoodsCommit`, { goods_id: sourceId, goods_commit_id: Number(src.goods_commit_id) }, 'copyGoodsCommit')
let cp = r2.data?.result
if (!cp) { log('   ❌ 复制失败。若提示 600102，说明该源已被复制过，请换 --source'); await browser.close(); process.exit(1) }
const goodsId = cp.goods_id, commitId = cp.goods_commit_id
log(`   新草稿 goods_id=${goodsId} commit_id=${commitId}`)

// ── ③ 拉草稿 body（打开草稿页抓 commit/detail）──────────────────────
let capturedDetail = null
page.on('response', async r => {
  if (/commit\/detail/.test(r.url())) { try { const t = await r.text(); if (t.length > 3000) capturedDetail = t } catch { } }
})
await page.goto(`${BASE}/goods/goods_add/index?id=${commitId}&goods_id=${goodsId}`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => { })
await sleep(20000)
let draft = null
if (capturedDetail) { draft = (JSON.parse(capturedDetail).result || JSON.parse(capturedDetail)); log('   草稿 body ✅（页面响应）') }
else {
  for (let i = 0; i < 2; i++) {
    const r = await post(`${BASE}/glide/v2/mms/query/commit/detail`, { goods_commit_id: Number(commitId), goods_id: Number(goodsId) })
    if (r.data?.success) { draft = r.data.result; break }
    await sleep(6000)
  }
  if (draft) log('   草稿 body ✅（API）')
}
if (!draft) { log('   ❌ 拿不到草稿 body'); await browser.close(); process.exit(1) }

// ★ 草稿页会持续重定向（autosave/装修加载），必须离开它再发 API
log('   离开草稿页，回到稳定页面…')
await page.goto(`${BASE}/goods/goods_list`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { })
await sleep(7000)
try { await page.waitForFunction(() => document.readyState === 'complete', { timeout: 25000 }) } catch { }
// 确认页面稳定：连续两次 readyState 都完整
for (let i = 0; i < 3; i++) {
  try { await page.evaluate(() => 1) ; break } catch { await sleep(3000) }
}
log('   页面已稳定')

// ── ④ 换 spec_id（任意自定义名 → 真实 spec_id）───────────────────────
const specIdMap = {}
let nl = await post(`${BASE}/glide/v2/mms/query/spec/name/list`, { cat_id: srcCat }, 'spec/name/list')
if (!nl?.data?.success) {
  log('   重试 spec/name/list…')
  await sleep(4000)
  nl = await post(`${BASE}/glide/v2/mms/query/spec/name/list`, { cat_id: srcCat }, 'spec/name/list(重试)')
}
const dimId = {}
for (const d of (nl?.data?.result || [])) dimId[d.label] = d.id
if (!Object.keys(dimId).length) { log('   ❌ 拿不到维度表（页面可能正在跳转）'); await browser.close(); process.exit(1) }
for (const dim of product.specs) {
  const pid = dimId[dim.name] || 0
  if (!pid) { log(`   ❌ 维度「${dim.name}」不在该类目候选表（可用: ${Object.keys(dimId).slice(0, 12).join('/')}）`); await browser.close(); process.exit(1) }
  const r = await post(`${BASE}/glide/v2/mms/query/batch/spec/by/name`, {
    cat_id: srcCat, spec_vos: dim.values.map(v => ({ parent_id: pid, spec_name: v.value })),
  })
  const res = r.data?.result || {}
  for (const it of (res.success_result || [])) specIdMap[it.spec_name] = { spec_id: it.spec_id, parent_id: it.parent_id }
  log(`   [${dim.name}] pid=${pid} 成功 ${res.success_cnt} 失败 ${res.fail_cnt}`)
}
const missing = product.specs.flatMap(d => d.values.map(v => v.value)).filter(v => !specIdMap[v])
if (missing.length) { log('   ❌ 缺 spec_id:', missing.join(',')); await browser.close(); process.exit(1) }

// ── ⑤ 重建 body ─────────────────────────────────────────────────────
// ★ 关键：commit/detail 与 action/edit 是两个不同 schema。
//   必须用「原生抓取的 action/edit body」做模板（157 字段），
//   不能用 commit/detail（174 字段，含大量展示字段，会报「请求body错误」）。
const nativeBodyFile = path.join(PLUGIN, 'artifacts', 'pdd-native-props', `cat${srcCat}_${shopKey}_native-body.json`)

let body
if (fs.existsSync(nativeBodyFile)) {
  body = JSON.parse(fs.readFileSync(nativeBodyFile, 'utf8'))
  log('   body: 用原生 action/edit 模板（157 字段）')
  // 清掉这次不该带的（crawlerInfo 会被页面层重新注入）
  delete body.crawlerInfo
  // ★ detail_gallery 完整结构（type=2 详情图，file_id 必填，宽高必填）
  //   从 commit/detail 的 detail_gallery 或 galleries(type=2) 取全量，不要截断
  {
    const srcAll = draft.detail_gallery || draft.galleries || []
    body.detail_gallery = srcAll.map(g => ({
      url: g.url || g.img_url,
      width: g.width || 750,
      height: g.height || 1500,
      type: 2,
      source: null,
      status: null,
      video_url: null,
      file_id: null,
      is_deleted: null,
      check_comment: null,
      origin_url: null,
    })).filter(x => x.url)
  }
  log(`   detail_gallery: ${(body.detail_gallery || []).length} 张（type=2）`)
  log(`   decorationDetail: ${(body.decorationDetail || []).length} 个楼层`)
} else {
  // 退化：直接用 commit/detail（去掉纯展示字段），并补齐提交必需字段
  body = JSON.parse(JSON.stringify(draft))
  for (const k of ['id','commit_deleted','owner','goods_sn','fabric','fabric_content','mall_id','share_desc','list_desc','thumb_url','hd_thumb_url','allowed_region','region_limit','sub_goods_type','country','origin_country_name','event_type','is_app','is_wms','is_bangdan','quick_refund','commit_extension','mall_info','paper_net_weight','paper_length','paper_width','paper_plies_num','source','is_card_secret','client_id','sf_markup_template_sn','min_group_price','max_group_price','must_check_type','goods_property_list','is_small_group','submit_time','oversea_type','is_general_trade','bad_claim_text','goods_trade_attr','goods_travel_attr','sku_type','is_goods_decoration','out_source_type','out_source_goods_id','shop_group_name','created_at','size_spec_url','chance_protocol_types','owner_name','show_activity_price','appeal_status','can_appeal','estimate_quantity','last_commit_check_status','is_deposit','gold_price_type','shoes_template_id','spu_id','spu_version','promised_delivery_seconds','community_group_buying','purchase_info_supply','business_source_type','creator_name','reason','app_id','app_name','user_source','package_label_type','experiment_key','check_type']) delete body[k]
  // 补提交必需字段（原生 body 里有的）
  const mustHave = ['carousel_video','detail_video','spu','isbn_properties_related','propertys_standard','hasBatchEnter','ai_carousel_gallery','explanation_video','tag_price_gallery','pack_label_image','medical_device_image','ingredient_gallery','nutrition_gallery','ai_goods_video','booking_notes','instruction_template_id','propertys_tid','propertys_edit_search_spu','service_time','electric_status','isGoodsLock','is_billion_subsidy','title_keywords','title_recommend','imageEnhanceGray','hide_apply','showGoodsInstruction','decorationCanEdit','decorationDetail','decorationPreview','extendedMainPropertys','must_have_spu','can_not_change_cat','can_not_change_spu','is_transfer_spu','hasFillDefaultBrand','prescriptionWhiteGraph','weight','home_delivery_template_name','promise_delivery_template_name','isAddLocalCityGoods','isCoupon','allow_purchase_info_supply','effect_logistics_weight_limit','is_default_template_id','cost_template_error','origin_is_pre_sale','default_template_gray','shipment_limit_second_origin_value','out_goods_sn','dead_line_seconds','processing_charges_in_yuan','is_auto_save','validate_message','validate_message_v2']
  for (const k of mustHave) if (body[k] === undefined) body[k] = (k.includes('gallery')||k.includes('video'))?[]:(k==='isbn_properties_related'?{isInit:true}:(k==='spu'?{}:null))
  log('   body: 用 commit/detail + 补必需字段（退化模式）')
  log('   ⚠ 该类目无原生模板，属性校验可能失败。建议先跑 harvest-native-props.mjs')
}

// 统一 skus / gallery
body.skus = (draft.sku || []).map(s => ({ ...s }))
if (body.skus.length) body.skus = body.skus  // 后面会被重建覆盖
delete body.sku

const galSrc = draft.galleries || draft.gallery || []
body.gallery = galSrc.map(g => ({ url: g.url || g.img_url, type: g.type || 2, file_id: g.file_id || null })).filter(x => x.url)
delete body.galleries

// 笛卡尔积
let combos = [{}]
for (const d of product.specs) {
  const next = []
  for (const c of combos) for (const v of d.values) next.push({ ...c, [d.name]: v })
  combos = next
}

const galleryUrls = (body.gallery || []).map(g => g.url).filter(Boolean)
const tplSku = (draft.sku || draft.skus || [])[0] || {}
const newSkus = combos.map((combo, idx) => {
  const row = JSON.parse(JSON.stringify(tplSku))
  for (const k of ['id', 'sku_id', 'ref_sku_commit_id', 'batch_id', 'cspu_id', 'child_skus', 'ware_id']) delete row[k]
  // spec 只保留 5 个字段（页面实测格式）
  row.spec = product.specs.map(dn => {
    const rec = specIdMap[combo[dn.name].value]
    return { parent_id: rec.parent_id, parent_name: dn.name, spec_id: rec.spec_id, spec_name: combo[dn.name].value, is_custom: 0 }
  })
  const want = {}
  for (const d of product.specs) want[d.name] = combo[d.name].value
  const hit = product.skus.find(k => product.specs.every(d => String(k.specs[d.name]) === want[d.name]))
  const p = Number(hit?.price || product.price || 9.9)
  row.multi_price = Math.round(p * 100)
  row.price = Math.round((p + 1) * 100)
  row.multi_price_in_yuan = p.toFixed(2)
  row.price_in_yuan = (p + 1).toFixed(2)
  const q = Number(hit?.stock || product.stock || 100)
  row.quantity = q; row.quantity_delta = q; row.init_quantity = 0
  row.out_sku_sn = hit?.itemNo || ''
  row.is_onsale = 1
  // ★ SKU 预览图必须是本店图片空间文件：优先沿用源商品对应行的 thumb_url
  const srcSkus = draft.sku || draft.skus || []
  const srcThumb = srcSkus[idx % Math.max(1, srcSkus.length)]?.thumb_url
  row.thumb_url = srcThumb || ''
  return row
})
body.skus = newSkus
body.goods_name = product.title
body.goods_id = goodsId
body.goods_commit_id = String(commitId)
delete body.out_goods_sn

// 参考价：必须 > 最大单买价
const maxSingle = Math.max(...newSkus.map(s => Number(s.price) / 100))
const refP = Number(product.price) > maxSingle ? Number(product.price) : maxSingle + 1
body.market_price = Math.round(refP * 100)
body.market_price_in_yuan = refP.toFixed(2)

// ★ 属性：直接沿用原生 action/edit body 里的 goods_properties（本来就带正确值）
//   body 是以原生 body 为底构造的，所以 goods_properties / propertys_tid 已经是权威值
if (!body.goods_properties || !body.goods_properties.length) {
  const nativeFile = path.join(PLUGIN, 'artifacts', 'pdd-native-props', `cat${srcCat}_${shopKey}.json`)
  if (fs.existsSync(nativeFile)) {
    const tpl = JSON.parse(fs.readFileSync(nativeFile, 'utf8'))
    body.goods_properties = tpl.goods_properties_tpl.map(p => ({ ...p }))
  }
}
log(`   属性: ${(body.goods_properties || []).length} 条 | propertys_tid=${body.propertys_tid}`)

// ★ 主图：可直接用「图片空间已有 URL」（product.imageUrls），避免 file/create 限流
if (Array.isArray(product.imageUrls) && product.imageUrls.length) {
  // ★ 查图片空间，拿到每张图的 file_id / 宽高（carousel_gallery 需要完整结构）
  let spaceFiles = []
  try {
    const r = await post(`${BASE}/garner/mms/file/dir_list`, {
      if_query_dir: true, order_by: 'create_time desc ', dir_id: 0,
      page: 1, page_size: 100, file_param: { file_type_desc: '' }, dir_param: {},
    }, 'file/dir_list')
    spaceFiles = r?.data?.result?.file_list || r?.data?.result?.list || []
    log(`   图片空间读到 ${spaceFiles.length} 个文件`)
  } catch (e) { log('   ⚠ 图片空间读取失败:', e.message.slice(0, 60)) }

  // ★ 关键：保留源商品完整 gallery，只把头部替换成新图
  //   （gallery 只剩 2 张会触发「详情图数量」校验失败）
  const srcGallery = (draft.galleries || draft.gallery || []).map(g => ({
    url: g.url || g.img_url, width: g.width || 750, height: g.height || 1200,
    type: 1, source: null, status: null, video_url: null,
    file_id: null, is_deleted: null, check_comment: null, origin_url: null,
  })).filter(x => x.url)
  const newImgsTop = product.imageUrls.map(u => {
    const f = spaceFiles.find(x => x.url === u) || spaceFiles.find(x => u.includes(String(x.name || ''))) || {}
    return {
      url: u,
      width: f.width || 1024,
      height: f.height || 1024,
      type: 1,
      source: null, status: null, video_url: null,
      file_id: null,   // ★ 页面实测：新图 file_id 一律 null（靠 url 认图）
      is_deleted: null, check_comment: null, origin_url: null,
    }
  })
  // 新图在前，源图补齐（保持总数量不低于源商品）
  body.gallery = [...newImgsTop, ...srcGallery.slice(newImgsTop.length)]
  log(`   gallery: 新图 ${newImgsTop.length} + 源图 ${body.gallery.length - newImgsTop.length} = ${body.gallery.length} 张`)
  log(`   主图: 图片空间图 ${product.imageUrls.length} 张（file_id ${body.gallery.filter(g => g.file_id).length}/${body.gallery.length} 命中）`)

  // ★ 换主图：detail_gallery 保留源商品完整列表（图不够会导致数量校验失败），
  //   只把前 N 张替换为新主图（新图已在图片空间登记，file_id 有效）
  {
    const srcDetail = draft.detail_gallery || draft.galleries || []
    const newImgs = body.gallery.map(g => ({
      url: g.url, width: g.width || 1024, height: g.height || 1024,
      type: 2, source: null, status: null, video_url: null,
      file_id: null, is_deleted: null, check_comment: null, origin_url: null,
    }))
    const keep = srcDetail.slice(newImgs.length).map(g => ({
      url: g.url || g.img_url, width: g.width || 750, height: g.height || 1500,
      type: 2, source: null, status: null, video_url: null,
      file_id: null, is_deleted: null, check_comment: null, origin_url: null,
    })).filter(x => x.url)
    body.detail_gallery = [...newImgs, ...keep]
    log(`   detail_gallery: 新图 ${newImgs.length} + 源图 ${keep.length} = ${body.detail_gallery.length} 张`)
  }
}

// 主图：本地图上传（可选）
if (product.images?.length) {
  try {
    const { preuploadProductImages } = await import(pathToFileURL(`${PLUGIN}/lib/pdd-image-preupload.js`).href)
    const up = await preuploadProductImages(page, { images: product.images }, {})
    const urls = (up.product.images || []).filter(u => /^https?:/.test(u))
    if (urls.length) {
      body.gallery = urls.map(u => ({ url: u, type: 1, file_id: null }))
      // ★ 不要覆盖 skus.thumb_url：必须用本店图片空间的图（沿用源商品）
      log(`   主图: 上传 ${urls.length} 张`)

      // 详情图对齐放到 action/edit 之后做（见下）

    } else log('   ⚠ 主图上传失败，沿用源商品图')
  } catch (e) {
    log('   ⚠ 主图上传异常:', e.message.slice(0, 80), '→ 重试一次')
    try {
      await page.goto(`${BASE}/goods/goods_list`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { })
      await sleep(6000)
      const { preuploadProductImages } = await import(pathToFileURL(`${PLUGIN}/lib/pdd-image-preupload.js`).href)
      const up2 = await preuploadProductImages(page, { images: product.images }, {})
      const urls2 = (up2.product.images || []).filter(u => /^https?:/.test(u))
      if (urls2.length) {
        body.gallery = urls2.map(u => ({ url: u, type: 1, file_id: null }))
        log(`   主图重试成功 ${urls2.length} 张`)
      }
    } catch (e2) { log('   主图重试也失败:', e2.message.slice(0, 60)) }
  }
}

if (DRY) {
  const outFile = path.join(__dirname, '..', '..', '..', 'artifacts', 'pdd-publish-by-copy', 'preview-body.json')
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(body, null, 2))
  log('')
  log('=== 预览 ===')
  log('  标题:', product.title)
  log('  SKU:', newSkus.length, '行')
  log('  图:', (body.gallery || []).length, '张')
  log('  参考价:', refP.toFixed(2))
  log('  属性:', (body.goods_properties || []).length, '条')
  log('  →', outFile)
  log('')
  log('✅ 预览完成（未写入任何数据）。确认后加 --confirm 真实发布。')
  await browser.close(); process.exit(0)
}

if (!CONFIRM) {
  log('')
  log('⚠ 这是 L2 写操作。请先加 --dry 看预览，确认后加 --confirm 执行。')
  await browser.close(); process.exit(0)
}

// ── ⑥ action/edit ───────────────────────────────────────────────────
const r6 = await post(`${BASE}/glide/mms/goodsCommit/action/edit`, body, 'action/edit')
if (!r6.data?.success) {
  const f = path.join(__dirname, '..', '..', '..', 'artifacts', 'pdd-publish-by-copy', 'failed-body.json')
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(body, null, 2))
  log('   ❌ body 已存 →', f)
  await browser.close(); process.exit(1)
}

// ── ⑥.5 装修楼层对齐：save → query → 用 query 结果回写 ──────────────
//    页面真实时序：saveDecorationDetail → queryDecorationDetail → 用 floor_list 初始化
log('')
log('⑥.5 装修楼层对齐')
{
  // ★ 楼层可能为空（退化模式/源商品无装修）：先查一次服务端
  if (!Array.isArray(body.decorationDetail) || !body.decorationDetail.length) {
    const rq0 = await post(`${BASE}/gorse/mms/goods/decoration/commit/query/V2`, {
      goods_commit_id: Number(commitId), goods_id: Number(goodsId),
    }, 'decoration/query(预查)')
    const initFloors = rq0?.data?.result?.floor_list || []
    if (initFloors.length) {
      body.decorationDetail = initFloors
      log(`   预查到服务端楼层 ${initFloors.length}`)
    }
  }
  // ★ 仍为空 → 用 detail_gallery 或 gallery 生成标准装修楼层
  if (!Array.isArray(body.decorationDetail) || !body.decorationDetail.length) {
    const imgs = (body.detail_gallery?.length ? body.detail_gallery : body.gallery) || []
    if (imgs.length) {
      body.decorationDetail = imgs.slice(0, 20).map((g, i) => ({
        floor_id: Date.now() + i,
        key: 'DecImage',
        type: i === 0 ? 'text' : 'image',
        priority: i,
        content_list: [{
          img_url: g.url, file_id: g.file_id || null,
          height: g.height || 1500, width: g.width || 750,
          file_status: null, goods_id: null, goods_name: null, show_price: null,
          status: null, min_on_sale_group_price: null,
          text: i === 0 ? (product.title || '') : null,
          hot_zone_list: null,
          text_module_details: i === 0 ? { font_size: 15, font_color: '#333', font_family: 9, align: 'left', background_color: '#fff' } : null,
          activity_sn: null, combine_buy_element_dtoList: null,
        }],
        check_status: null, check_id: null, check_name: null, comment: null,
        if_have_template: null, floor_status: null, template_id: null, template_type: null, template_json: null,
      }))
      log(`   用图片生成标准楼层 ${body.decorationDetail.length} 个`)
    }
  }
  // ★ 换主图时：用图片空间新图【重建】装修楼层（源商品旧图不在图片空间 → 会报「非图片空间图片」）
  if (Array.isArray(product.imageUrls) && product.imageUrls.length && Array.isArray(body.decorationDetail) && body.decorationDetail.length) {
    const newUrls = body.gallery.map(g => g.url)
    const makeFloor = (url, i, withText) => ({
      floor_id: Date.now() + i,
      key: 'DecImage',
      type: withText ? 'text' : 'image',
      priority: i,
      content_list: [{
        img_url: url, file_id: null, height: 1500, width: 750,
        file_status: null, goods_id: null, goods_name: null, show_price: null,
        status: null, min_on_sale_group_price: null,
        text: withText ? (product.title || '') : null,
        hot_zone_list: null,
        text_module_details: withText ? { font_size: 15, font_color: '#333', font_family: 9, align: 'left', background_color: '#fff' } : null,
        activity_sn: null, combine_buy_element_dtoList: null,
      }],
      check_status: null, check_id: null, check_name: null, comment: null,
      if_have_template: null, floor_status: null, template_id: null, template_type: null, template_json: null,
    })
    const n = body.decorationDetail.length
    body.decorationDetail = Array.from({ length: n }, (_, i) => makeFloor(newUrls[i % newUrls.length], i, i === 0))
    log(`   装修楼层已用图片空间新图重建（${n} 层）`)
  }
  // 旧逻辑保留（不换图时）
  if (false) {
    const newUrls = body.gallery.map(g => g.url)
    const newFids = body.gallery.map(g => g.file_id)
    body.decorationDetail = body.decorationDetail.map((fl, i) => {
      const cl = Array.isArray(fl.content_list) ? fl.content_list : []
      return {
        ...fl,
        content_list: cl.map((c, j) => ({
          ...c,
          img_url: newUrls[(i + j) % newUrls.length] || c.img_url,
          file_id: newFids[(i + j) % newFids.length] || c.file_id || null,
        })),
      }
    })
    log(`   装修楼层已统一为新主图（${body.decorationDetail.length} 层）`)
  }
  const floors = body.decorationDetail || []
  log(`   当前楼层: ${floors.length}`)
  if (floors.length) {
    // ① 保存装修
    await post(`${BASE}/gorse/mms/goods/decoration/commit/save`, {
      goods_commit_id: Number(commitId), goods_id: Number(goodsId), floor_list: floors,
    }, 'decoration/save')

    // ② 立刻查回
    await sleep(1200)
    const rq = await post(`${BASE}/gorse/mms/goods/decoration/commit/query/V2`, {
      goods_commit_id: Number(commitId), goods_id: Number(goodsId),
    }, 'decoration/query')

    const back = rq?.data?.result?.floor_list || []
    log(`   服务端回读楼层: ${back.length}`)

    // ③ 用回读结果回写 action/edit（页面就是这么做的）
    if (back.length && JSON.stringify(back) !== JSON.stringify(floors)) {
      body.decorationDetail = back
      const rw = await post(`${BASE}/glide/mms/goodsCommit/action/edit`, body, 'action/edit(回写装修)')
      if (rw.data?.success) log('   ✅ 已用服务端楼层回写')
    } else if (back.length) {
      log('   楼层一致，跳过回写')
    } else {
      log('   ⚠ 服务端回读为空')
    }
  } else {
    log('   ⚠ body 无 decorationDetail')
  }
}

// ── ⑦ commit/submit ─────────────────────────────────────────────────
await sleep(1500)
const r7 = await post(`${BASE}/glide/v2/mms/edit/commit/submit`, {
  goods_commit_id: Number(commitId), goods_id: goodsId, is_onsale: 1, if_allow_submit_mall_checking: true,
}, 'commit/submit')

log('')
if (r7.data?.success) {
  log(`✅ 上架成功 goods_id=${goodsId}`)
} else {
  log(`❌ 提交失败: ${r7.data?.error_msg || ''}`)
  log('   提示：若报「属性[X]必填」或「属性值不可用」，说明该类目属性必须由页面重建。')
  log('   可改用页面提交：node publish-flow.mjs --product <json> --source <goodsId>')
}
log('日志 →', LOGPATH)
await sleep(2000)
await browser.close().catch(() => { })














































