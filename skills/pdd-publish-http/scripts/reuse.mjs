import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ★ 路径推导（替代原硬编码绝对路径）：本文件在 skills/<name>/scripts/ 下，上推三层到插件根
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const PKG_BASE = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
].find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-script-base.json')
/**
 * 三层查一复用（Three-Layer Reuse）—— 拼多多上架的「数据先知」层
 *
 * 思路（参考淘宝 asyncOpt 三层结构，拼多多全部有对应且更直接）：
 *   L1 发布历史/类目记忆  命中 → 直接用该类目（省掉选类目全过程）
 *   L2 存量商品/草稿      命中 → on_shop/detail 拉 170 字段完整提交体 → 改 values → 提交（最快）
 *   L3 类目树+属性树      新类目 → 拉模板 → 填 values → 提交
 *
 * 拼多多接口映射：
 *   L2 数据源   POST /glide/v2/mms/query/commit/on_shop/detail   {goods_id}
 *              → 170 字段完整提交体（skus 带 spec_id/parent_id、thumb_url_file_id、价格库存）
 *   L2 提交     POST /glide/v2/mms/edit/commit/copyGoodsCommitAndSubmit
 *   L2 属性     POST /draco-ms/mms/query-goods-property {goods_id}
 *              → goods_properties / sku_properties / goods_property_group
 *   L3 属性树   POST /draco-ms/mms/template/with/property {cat_id}
 *   L3 尺码树   POST /glide/forward/cabernet/mms/sizespec/query/meta {cat_id}
 *
 * 用法（作为库被 publish.mjs 调用，也可独立跑）：
 *   node scripts/reuse.mjs --category "儿童家居服 家居服套装"
 *   node scripts/reuse.mjs --goods-id 1018902684648 --dump
 */

const require = createRequire(PKG_BASE)
const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const hasFlag = (n) => process.argv.includes(`--${n}`)

/**
 * 三层查一复用主流程。
 *
 * @param page      已登录的 mms 页面（/goods/goods_list 主应用）
 * @param opts      { category, product, specPoolPath }
 * @returns         { layer, catId, baseBody?, specIds?, template?, note }
 *                 layer=1 类目记忆命中（只给 catId）
 *                 layer=2 存量商品命中（给完整 baseBody，最快路径）
 *                 layer=3 新类目（给 template 属性树 + 空 baseBody）
 */
export async function threeLayerReuse(page, opts = {}) {
  const { getAntiContent } = await import(`file:///${PLUGIN_ROOT}/lib/pdd-mode2.js`)
  const call = async (url, body) => {
    const a = await getAntiContent(page, { force: true })
    if (!a.ok) throw new Error('Anti-Content 生成失败')
    return await page.evaluate(async (u, bd, av) => {
      const resp = await fetch(u, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Anti-Content': av },
        body: JSON.stringify(bd),
      })
      return await resp.json().catch(() => null)
    }, url, body, a.data)
  }

  const category = String(opts.category || '').trim()
  const result = { layer: 0, catId: 0, note: '' }

  // ── L1：类目记忆（本地缓存：类目关键词 → catId）──
  const memPath = path.join(process.cwd(), 'artifacts', 'pdd-re', 'cat-memory.json')
  let memory = {}
  try { if (fs.existsSync(memPath)) memory = JSON.parse(fs.readFileSync(memPath, 'utf8')) } catch { /* ignore */ }
  const memHit = category && memory[category]
  if (memHit?.cat_id) {
    result.layer = 1
    result.catId = memHit.cat_id
    result.note = `L1 类目记忆命中：「${category}」→ cat_id=${memHit.cat_id}（${memHit.cat_path || ''}）`
    return result
  }

  // ── L2：存量商品/草稿（同叶子类目）──
  // 2a. 先在售/仓库/草稿里找同类目商品
  let candidate = null
  try {
    const list = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList',
      { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, size: 50 })
    const goods = list?.result?.goods_list || []
    if (goods.length) {
      // 优先匹配标题关键词与 category；取第一个带多 SKU 的（数据最全）
      const kw = category.replace(/\s+/g, ' ').split(' ').filter(Boolean)
      const scored = goods.map(g => {
        let s = 0
        for (const k of kw) if ((g.goods_name || '').includes(k) || (g.cat_name || '').includes(k)) s += 2
        if (category && (g.cat_name || '').includes(category)) s += 5
        s += Math.min(3, ((g.sku_group_price || []).length))   // SKU 越多数据越全
        return { g, s }
      }).sort((a, b) => b.s - a.s)
      candidate = scored[0]?.s > 0 ? scored[0].g : null
    }
  } catch { /* L2 列表失败不阻断，落 L3 */ }

  if (candidate?.id) {
    try {
      // 2b. 拉完整提交体（170 字段，含全部 spec_id/预览图/属性）
      const detail = await call('https://mms.pinduoduo.com/glide/v2/mms/query/commit/on_shop/detail', { goods_id: candidate.id })
      if (detail?.result && Object.keys(detail.result).length > 50) {
        // 2c. 商品已填属性（可选，失败不阻断）
        let props = null
        try { props = await call('https://mms.pinduoduo.com/draco-ms/mms/query-goods-property', { goods_id: candidate.id }) } catch { /* ignore */ }

        result.layer = 2
        result.catId = detail.result.cat_id || candidate.cat_id || 0
        result.baseBody = detail.result
        result.sourceGoods = { id: candidate.id, name: candidate.goods_name, skuCount: (detail.result.skus || []).length }
        result.goodsProperty = props?.result || null
        result.note = `L2 存量商品命中：${candidate.goods_name.slice(0, 30)}（goods_id=${candidate.id}）→ 170 字段提交体 + ${(detail.result.skus || []).length} SKU`

        // 顺手写 L1 记忆（下次直接命中）
        if (category && result.catId) {
          memory[category] = { cat_id: result.catId, cat_path: (detail.result.cats || []).filter(Boolean).join('>'), savedAt: new Date().toISOString() }
          try { fs.mkdirSync(path.dirname(memPath), { recursive: true }); fs.writeFileSync(memPath, JSON.stringify(memory, null, 2)) } catch { /* ignore */ }
        }
        return result
      }
    } catch { /* 落 L3 */ }
  }

  // ── L3：新类目 → 拉属性树 + 尺码树 ──
  result.layer = 3
  result.note = 'L3 新类目：无历史商品可复用，需拉取类目属性树'
  return result
}

/**
 * 从 L2 baseBody 提取规格池（规格值 → spec_id），供行数重建用。
 * 这是「不依赖本地规格池」的关键——存量商品的 spec 就是权威。
 */
export function extractSpecIdsFromBody(baseBody) {
  const out = {}
  for (const sku of baseBody?.skus || []) {
    for (const sp of sku.spec || []) {
      if (sp.spec_name == null || sp.spec_id == null) continue
      const val = String(sp.spec_name).trim()
      if (!val) continue
      if (!out[val]) out[val] = { spec_id: sp.spec_id, parent_id: sp.parent_id ?? 0 }
    }
  }
  return out
}

/**
 * 把 L2 baseBody 改成新商品的提交体（改 formvalues）：
 *   - 换标题/描述
 *   - 换图片（gallery 整组替换，调用方传新 gallery）
 *   - 换价格/库存（按规格值匹配，或统一价）
 *   - 清掉商品身份（goods_id/goods_commit_id/sku_id 归零，让平台当新建）
 */
export function adaptBaseBodyForNewGoods(baseBody, patch = {}) {
  const body = JSON.parse(JSON.stringify(baseBody))
  // 身份清零（新建）
  body.goods_id = patch.goodsId || 0
  body.goods_commit_id = patch.commitId ? String(patch.commitId) : ''
  body.is_draft = 0
  // 标题/描述
  if (patch.title) { body.goods_name = String(patch.title); body.goods_desc = String(patch.title) }
  // 图片整组替换
  if (Array.isArray(patch.gallery) && patch.gallery.length) body.gallery = patch.gallery
  // SKU：清 id/thumb 状态，按规格值改价库存
  const priceMap = patch.priceMap || {}   // {规格值: 价(元)} 或 {__all__: 价}
  const stockMap = patch.stockMap || {}
  for (const sku of body.skus || []) {
    sku.id = 0
    sku.sku_id = null
    sku.is_onsale = 1
    // thumb_url 保留（规格预览图可复用）；若调用方给了新预览图映射则替换
    if (patch.thumbMap) {
      const specTexts = (sku.spec || []).map(s => String(s.spec_name || '').trim())
      for (const t of specTexts) {
        if (patch.thumbMap[t]) { sku.thumb_url = patch.thumbMap[t].url; sku.thumb_url_file_id = patch.thumbMap[t].id ?? null }
      }
    }
    const texts = (sku.spec || []).map(s => String(s.spec_name || '').trim())
    for (const t of texts) {
      if (priceMap[t] != null) { sku.multi_price = Math.round(Number(priceMap[t]) * 100); sku.multi_price_in_yuan = String(priceMap[t]); sku.price = Math.round(Number(priceMap[t]) * 100) + 100; sku.price_in_yuan = String((Number(priceMap[t]) + 1).toFixed(2)) }
      if (stockMap[t] != null) { sku.quantity = Number(stockMap[t]); sku.quantity_delta = Number(stockMap[t]); sku.init_quantity = Number(stockMap[t]) }
    }
    if (priceMap.__all__ != null) { const p = Math.round(Number(priceMap.__all__) * 100); sku.multi_price = p; sku.multi_price_in_yuan = String(priceMap.__all__); sku.price = p + 100; sku.price_in_yuan = String((Number(priceMap.__all__) + 1).toFixed(2)) }
    if (stockMap.__all__ != null) { sku.quantity = Number(stockMap.__all__); sku.quantity_delta = Number(stockMap.__all__); sku.init_quantity = Number(stockMap.__all__) }
  }
  // 属性：保留 baseBody 的 goods_properties（同类目属性结构一致），调用方可用 patch.properties 覆盖
  if (Array.isArray(patch.properties)) {
    body.goods_properties = patch.properties
  }
  return body
}

// ─── CLI：独立诊断用 ───
if (process.argv[1] && process.argv[1].includes('reuse.mjs')) {
  const category = argOf('category')
  const goodsId = argOf('goods-id')
  ;(async () => {
    const puppeteer = require('puppeteer-core')
    // ★ 2026-10-28 修：原写死单个账号 hash 的 profile 目录，换号/多号即失效。
    //   改为按凭证库里 pdd_mms 账号动态选 profile；只有 --profile 可显式覆盖。
    const store0 = new (await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)).CredentialStore(
      path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
    const mmsAccs = store0.listAccounts().filter(a => a.platform === 'pdd_mms' && a.cookies?.['PASS_ID'])
    const shopKey0 = argOf('account') || mmsAccs.slice(-1)[0]?.shop_key
    if (!shopKey0) {
      console.error('错误: 未绑定拼多多商家后台账号，无法确定浏览器 profile。')
      process.exit(1)
    }
    // shop_key 形如 pdd_mms_<hash>；profile 目录名即 hash 部分
    const profile = argOf('profile')
      || path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', String(shopKey0).replace(/^pdd_mms_/, ''))
    if (!fs.existsSync(profile)) {
      console.error(`错误: profile 不存在：${profile}（账号 ${shopKey0}）。请先完成一次登录。`)
      process.exit(1)
    }
    console.log(`使用账号 ${shopKey0} → ${profile}`)
    // ★ 自动清理 Cookie 域污染（2026-10-28）：同名 Cookie 分散在
    //   .pinduoduo.com / mms.pinduoduo.com / yingxiao.pinduoduo.com 时，
    //   浏览器优先发子域旧值 → 推广域反复掉登录。删子域同名项即恢复。
    //   跳过：--no-cookie-clean
    if (!process.argv.includes('--no-cookie-clean')) {
      try {
        const { cleanCookiePollution } = await import(`file:///${PLUGIN_ROOT}/skills/pdd-promo/scripts/cookie-clean.mjs`)
        const r = await cleanCookiePollution(profile, { log: (m) => console.warn('[pdd] ' + m) })
        if (r.ok && r.deleted > 0) console.warn('[pdd] ✅ 清理 ' + r.deleted + ' 条域污染 Cookie')
      } catch (e) {
        console.warn('[pdd] Cookie 清理跳过：' + String(e.message).slice(0, 60))
      }
    }
    const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', userDataDir: profile, headless: false, defaultViewport: { width: 1400, height: 900 }, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] })
    const page = (await browser.pages())[0] || await browser.newPage()
    await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 8000))
    if (!category) {
      console.error('错误: 缺少 --category 参数（如 --category "童装 套装"）。')
      process.exit(1)
    }
    const r = await threeLayerReuse(page, { category })
    console.log('\n=== 三层查一复用结果 ===')
    console.log('layer:', r.layer, '| catId:', r.catId)
    console.log('note:', r.note)
    if (r.baseBody) {
      console.log('baseBody 字段:', Object.keys(r.baseBody).length, '| skus:', (r.baseBody.skus || []).length)
      const specIds = extractSpecIdsFromBody(r.baseBody)
      console.log('提取规格池:', JSON.stringify(specIds).slice(0, 400))
    }
    if (hasFlag('dump') && r.baseBody) {
      fs.mkdirSync('artifacts/pdd-re', { recursive: true })
      fs.writeFileSync('artifacts/pdd-re/reuse-basebody.json', JSON.stringify(r, null, 2))
      console.log('已落盘: artifacts/pdd-re/reuse-basebody.json')
    }
    await browser.close()
  })().catch(e => { console.error('错误:', e.message); process.exit(1) })
}
