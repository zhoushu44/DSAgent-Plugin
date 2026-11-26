/**
 * pdd-goods-full.mjs —— 完整商品数据（纯 Node）
 *
 * ══════════════════════════════════════════════════════════════════
 * 解决什么问题
 * ══════════════════════════════════════════════════════════════════
 *
 *   mall/goodsList  → 一次拿全（含价格/在售），但**长期 54001 限流**
 *   glide/goodsList → 稳定可通（289ms），但**缺价格/在售状态**
 *   skuInfo         → 有价格/库存/在售，但一次只能查一个商品
 *
 * 方案：glide 拿列表 + 并发 skuInfo 补全
 *
 *   实测：137 个商品，列表 289ms + SKU 并发（5 并发）约 3~5 秒
 *   对比：浏览器 mall/goodsList 28 秒，且经常限流失败
 *
 * ══════════════════════════════════════════════════════════════════
 * 字段映射
 * ══════════════════════════════════════════════════════════════════
 *
 *   glide/goodsList          skuInfo              输出
 *   ─────────────────        ───────────────      ──────────────────
 *   goods_id                 goods_id            id
 *   goods_name               -                   title
 *   thumb_url                thumb_url           thumb
 *   cat_id1/2/3              -                   catIds
 *   -                        price               price（分→元）
 *   -                        quantity            stock
 *   -                        is_onsale           isOnSale
 *   -                        sold_quantity       soldQty
 *   -                        sku_id              skuId
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法
 * ══════════════════════════════════════════════════════════════════
 *
 *   import { listGoodsFull } from './pdd-goods-full.mjs'
 *
 *   const goods = await listGoodsFull(req, account, shopKey, {
 *     max: 50,          // 最多取多少个（默认全部）
 *     concurrency: 5,   // SKU 查询并发数
 *   })
 *   // → [{ id, title, thumb, catIds, price, stock, isOnSale, soldQty, skuCount }]
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const listCache = new Map()
const CACHE_TTL = 60 * 1000

/**
 * 商品列表的三个 tab（vodka/display/mall/goodsList 的分页判据）
 * ★ 2026-11-26：实测「全部」传空条件时接口会退化成在售，所以状态只能用这三个 tab 分别数。
 */
export const GOODS_TABS = {
  onsale: { is_onsale: 1, sold_out: 0, label: '在售中' },
  offsale: { is_onsale: 0, label: '已下架' },
  soldout: { is_onsale: 1, sold_out: 1, label: '已售罄' },
}

/**
 * 抓「商品管理」页自己发出的 goodsList 请求（URL + headers + body）当基线
 *
 * ★ 2026-11-26：display/mall/goodsList 用纯 Node 走 pdd-request 会稳定 54001「操作太过频繁」，
 *   只有**在页面上下文里重放**（带着页面自己算的 t2 签名 + anti-content）才通。
 *   所以先打开 goods/goods_list，拦住页面首次查询的 POST 当模板。
 */
export async function captureGoodsListBaseline(page, opts = {}) {
  const { timeout = 15000 } = opts
  const caps = []
  const onReq = (req) => {
    if (req.method() !== 'POST') return
    if (!/display\/mall\/goodsList/.test(req.url())) return
    try { caps.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') }) } catch { }
  }
  page.on('request', onReq)
  try {
    await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
    // ★ 2026-11-26：页面通常自己会查一次；只在第 4s / 8s 各补点一次「查询」。
    //   原来每 500ms 就点一次，反复触发请求把页面拖慢（单次 status 要 40s）。
    const t0 = Date.now()
    let clicks = 0
    while (!caps.length && Date.now() - t0 < timeout) {
      await new Promise(r => setTimeout(r, 500))
      const el = Date.now() - t0
      if (!caps.length && clicks < 2 && (el >= 4000 && el < 4500 || el >= 8000 && el < 8500)) {
        clicks++
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(e => (e.innerText || '').trim() === '查询')
          if (b) b.click()
        }).catch(() => { })
      }
    }
    if (!caps.length) throw new Error('没抓到 goodsList 请求（页面未加载完成或被风控）')
    return caps[0]
  } finally {
    page.off('request', onReq)
  }
}

/**
 * 在页面上下文按 tab 拉商品列表（唯一实测可通的路径）
 * @param {object} page puppeteer page（需在 mms 域）
 * @param {object} [opts] { tab, size, maxPages, baseline }
 */
export async function listGoodsByTabViaPage(page, opts = {}) {
  const { tab = 'onsale', size = 100, maxPages = 20, baseline = null } = opts
  const cfg = GOODS_TABS[tab]
  if (!cfg) throw new Error(`未知 tab: ${tab}（可用 ${Object.keys(GOODS_TABS).join(' / ')}）`)
  const cap = baseline || await captureGoodsListBaseline(page)
  const patch = {}
  if (cfg.is_onsale !== undefined) patch.is_onsale = cfg.is_onsale
  if (cfg.sold_out !== undefined) patch.sold_out = cfg.sold_out

  const list = []
  let total = 0
  for (let pg = 1; pg <= maxPages; pg++) {
    const res = await page.evaluate(async (a) => {
      const h = { ...a.headers }
      delete h['content-length']; delete h['Content-Length']
      const r = await fetch(a.url, {
        method: 'POST', credentials: 'include', headers: h,
        body: JSON.stringify({ ...a.body, ...a.patch, page: a.pg, size: a.size }),
      })
      return await r.json().catch(() => null)
    }, { url: cap.url, headers: cap.headers, body: cap.body, patch, pg, size })
    const body = res?.result ?? res?.data ?? res
    const ec = body?.error_code
    if (!body || (ec && ec !== 1000000)) {
      throw new Error(`goodsList 失败 tab=${cfg.label} ec=${ec || '?'} ${String(body?.error_msg || '').slice(0, 80)}`)
    }
    const cur = body.goods_list || []
    total = body.total ?? total
    list.push(...cur.map(g => ({
      id: g.id, title: g.goods_name, thumb: g.thumb_url,
      catIds: [g.cat_id1, g.cat_id2, g.cat_id3].filter(Boolean),
    })))
    if (!cur.length || list.length >= total) break
    await new Promise(s => setTimeout(s, 300))
  }
  return { tab, label: cfg.label, total, list }
}


/**
 * @param {Function} request  pdd-request 的 request 函数
 * @param {object} account    { cookies, localStorage }
 * @param {string} shopKey
 * @param {object} [opts]
 */
export async function listGoodsFull(request, account, shopKey, opts = {}) {
  const { max = 0, concurrency = 5, pageSize = 50, useCache = true, source = 'tabs', enumerate = null } = opts
  const ck = `${shopKey}:${max}:${pageSize}:${source}`
  if (useCache && listCache.has(ck)) {
    const c = listCache.get(ck)
    if (Date.now() - c.at < CACHE_TTL) return c.data
  }

  // ── ① 枚举商品 ──
  // ★ 2026-11-26：优先用传进来的 enumerate(tab) —— 它内部走「页面上下文重放」
  //   （display/mall/goodsList 纯 HTTP 必 54001）。glide/addProperties/goodsList
  //   是「待补属性」视角，会漏新发布商品，只作为回退。
  const raw = []
  let total = 0
  let enumerated = 'glide'
  if (typeof enumerate === 'function') {
    try {
      for (const tab of ['onsale', 'offsale']) {
        const r = await enumerate(tab)
        total += r.total || 0
        for (const g of r.list) {
          raw.push({ goods_id: g.id, goods_name: g.title, thumb_url: g.thumb, _cat: g.catIds })
        }
        if (max && raw.length >= max) break
      }
      enumerated = 'tabs(在售+已下架)'
    } catch (e) {
      raw.length = 0
      total = 0
      enumerated = `glide(回退：${String(e.message).slice(0, 60)})`
    }
  }

  if (!raw.length) {
    let page = 1
    while (true) {
      const r = await request('/glide/v2/mms/addProperties/goodsList', {
        page_num: page,
        page_size: pageSize,
        only_query_no_props_goods: false,
        only_query_un_auth_brand: false,
      }, { account, shopKey })
      if (!r.ok) throw new Error(`商品列表失败 ec=${r.ec} ${r.hint || ''}`)
      const list = r.data?.list || []
      total = r.data?.total ?? list.length
      raw.push(...list)
      if (list.length < pageSize) break
      if (max && raw.length >= max) break
      page++
      if (page > 50) break
      await new Promise(s => setTimeout(s, 300))
    }
  }

  const picked = max ? raw.slice(0, max) : raw

  // ── ② 并发补 SKU ──
  const out = new Array(picked.length)
  let idx = 0
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= picked.length) return
      const g = picked[i]
      let sku = null
      try {
        const sr = await request('/vodka/v2/mms/query/sku/info', { goodsId: g.goods_id }, { account, shopKey })
        if (process.env.PDD_DEBUG_GOODS) {
          console.error(`[sku] goodsId=${g.goods_id} ok=${sr.ok} ec=${sr.ec} dataType=${Array.isArray(sr.data) ? 'array[' + sr.data.length + ']' : typeof sr.data}`)
        }
        if (sr.ok && Array.isArray(sr.data) && sr.data.length) {
          // ★ 价格字段是 group_price（拼团价）/ normal_price（原价），单位「分」
          //   注意：price 字段恒为 0，不可用
          const gp = sr.data.map(x => Number(x.group_price) || 0).filter(n => n > 0)
          const np = sr.data.map(x => Number(x.normal_price) || 0).filter(n => n > 0)
          const stocks = sr.data.map(x => Number(x.quantity) || 0)
          sku = {
            price: gp.length ? Math.min(...gp) / 100 : null,
            priceMax: gp.length ? Math.max(...gp) / 100 : null,
            normalPrice: np.length ? Math.min(...np) / 100 : null,
            stock: stocks.reduce((a, b) => a + b, 0),
            isOnSale: sr.data.some(x => x.is_onsale === true),
            soldQty: sr.data.reduce((a, b) => a + (Number(b.sold_quantity) || 0), 0),
            skuCount: sr.data.length,
            skuId: sr.data[0].sku_id,
            skuSn: sr.data[0].out_sku_sn || '',
          }
        }
      } catch (e) {
        if (process.env.PDD_DEBUG_GOODS) console.error('[sku] EXCEPTION:', String(e.message).slice(0, 120), String(e.stack).split('\n')[1] || '')
      }

      out[i] = {
        id: g.goods_id,
        title: g.goods_name,
        thumb: g.thumb_url,
        catIds: g._cat?.length ? g._cat : [g.cat_id1, g.cat_id2, g.cat_id3].filter(x => x),
        commitId: g.goods_commit_id,
        ...(sku || { price: null, stock: null, isOnSale: null, skuCount: 0 }),
      }
      await new Promise(s => setTimeout(s, 120))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, picked.length) }, worker))

  const data = { total, goods: out, enumerated }
  if (useCache) listCache.set(ck, { at: Date.now(), data })
  return data
}

/** 清缓存 */
export function clearGoodsCache() { listCache.clear() }

export const GOODS_FULL_INFO = {
  module: 'pdd-goods-full.mjs',
  strategy: 'glide 列表 + 并发 skuInfo',
  why: 'mall/goodsList 长期 54001，glide 稳定但缺价格',
  fields: ['id', 'title', 'thumb', 'catIds', 'price', 'stock', 'isOnSale', 'soldQty', 'skuCount'],
}
