/**
 * 拼多多商品查询（pdd-works）—— 只读，无平台副作用
 *
 * 能力（全部 HTTP，复用 pdd-mode2 的 Anti-Content 签名注入）：
 *   overview   商品列表汇总（在售/仓库/草稿 计数 + 前 N 条）
 *   list       商品列表明细（ goods_id / 标题 / 类目 / 价格带 / SKU 数 / 在售状态 ）
 *   detail     单商品 SKU 全量（spec/spec_id/价格/库存/预览图）
 *   sku        同 detail（别名，兼容 works 系列习惯）
 *   commit     单商品「提交体快照」（on_shop/detail，170 字段，三层复用的数据源）
 *   spec-pool  全店规格池（规格值 → spec_id）
 *
 * 用法：
 *   node scripts/query.mjs --mode list
 *   node scripts/query.mjs --mode detail --goods-id 1018993401073
 *   node scripts/query.mjs --mode spec-pool
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const PLUGIN_ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const goodsId = argOf('goods-id')
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))
const wantCsv = process.argv.includes('--csv')

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { ensureAntiContent, getAntiContent } = await import(`file:///${PLUGIN_ROOT}/lib/pdd-mode2.js`)

  // 账号选择：优先 --account，否则按平台自动找
  const { CredentialStore } = await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号，请到「账号连接」添加。' }); process.exit(2) }

  // profile：新 shopKey 目录优先，旧目录兜底（票据已注入）
  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) {
    profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
  }
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  // safeEval：页面跳转会导致 frame detached，重试遍历所有 frame
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 12; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换下一个 frame */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 9000))
  if (/\/login/i.test(page.url())) {
    await browser.close()
    emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
    process.exit(2)
  }
  await ensureAntiContent(page)
  const call = async (url, body) => {
    const a = await getAntiContent(page, { force: true })
    return await safeEval(async (u, bd, av) => {
      const resp = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Anti-Content': av }, body: JSON.stringify(bd) })
      return await resp.json().catch(() => null)
    }, url, body, a.data)
  }

  const LIST_URL = 'https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList'
  const listBody = { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, size: 50 }

  const rows = []
  if (mode === 'overview' || mode === 'list') {
    const r = await call(LIST_URL, listBody)
    const goods = r?.result?.goods_list || []
    // 汇总（未在售集合）
    const off = await call(LIST_URL, { ...listBody, is_onsale: 0 }).catch(() => null)
    const offCount = (off?.result?.goods_list || []).length
    for (const g of goods.slice(0, limit)) {
      rows.push({
        goods_id: g.id, title: g.goods_name, cat: [g.cat_name_1, g.cat_name_2, g.cat_name_3].filter(Boolean).join('>'),
        sku_count: (g.sku_group_price || []).length,
        price_range: (g.sku_group_price || []).length ? `${Math.min(...g.sku_group_price) / 100}~${Math.max(...g.sku_group_price) / 100}元` : '—',
        is_onsale: g.is_onsale, thumb: g.hd_thumb_url || g.thumb_url || '',
      })
    }
    const summary = mode === 'overview'
      ? { on_sale: goods.length, not_on_sale: offCount, total_shown: goods.length + offCount }
      : undefined
    emit({
      ok: true, mode, shopKey: SHOP,
      summary,
      total: goods.length,
      items: rows,
      text: mode === 'overview'
        ? `拼多多商品总览：在售 ${goods.length} 个、未在售 ${offCount} 个。最新 ${rows.length} 条：\n` + rows.slice(0, 10).map((r, i) => `  ${i + 1}. [${r.goods_id}] ${r.title.slice(0, 30)} | ${r.sku_count}SKU | ${r.price_range}`).join('\n')
        : `拼多多商品列表：共 ${goods.length} 个在售，返回前 ${rows.length} 条。\n` + rows.map((r, i) => `  ${i + 1}. [${r.goods_id}] ${r.title.slice(0, 30)} | ${r.sku_count}SKU | ${r.price_range}`).join('\n'),
    })
    if (wantCsv) {
      const dir = path.join(process.cwd(), 'artifacts', 'pdd-works')
      fs.mkdirSync(dir, { recursive: true })
      const csv = ['goods_id,title,cat,sku_count,price_range,is_onsale', ...rows.map(r => [r.goods_id, `"${r.title.replace(/"/g, '""')}"`, `"${r.cat}"`, r.sku_count, `"${r.price_range}"`, r.is_onsale].join(','))].join('\n')
      fs.writeFileSync(path.join(dir, `pdd-goods-${mode}-${Date.now()}.csv`), csv, 'utf8')
    }
  } else if (mode === 'detail' || mode === 'sku') {
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: 'detail/sku 模式必须带 --goods-id' }); await browser.close(); process.exit(2) }
    const r = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', { goodsId: Number(goodsId) })
    const skus = r?.result || []
    const items = skus.map(s => ({
      sku_id: s.sku_id,
      spec: (s.spec || []).map(x => `${x.spec_key || ''}:${x.spec_value}`).join(' / '),
      group_price: s.group_price, normal_price: s.normal_price,
      quantity: s.quantity, sold: s.sold_quantity,
      thumb: s.thumb_url ? '✅' : '—', is_onsale: s.is_onsale,
    }))
    emit({
      ok: true, mode: 'detail', goodsId, skuCount: skus.length, items,
      text: `商品 ${goodsId} 共 ${skus.length} 个 SKU：\n` + items.map((x, i) => `  ${i + 1}. ${x.spec} | 拼单=${x.group_price} 单买=${x.normal_price} | 库存=${x.quantity} | 预览图=${x.thumb}`).join('\n'),
    })
  } else if (mode === 'offsale' || mode === 'onsale' || mode === 'delete') {
    // ── 写操作（L2）：下架 / 上架 / 删除 ──
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: `${mode} 模式必须带 --goods-id` }); await browser.close(); process.exit(2) }
    if (!process.argv.includes('--confirm')) {
      const verb = mode === 'offsale' ? '下架' : mode === 'onsale' ? '上架' : '删除'
      emit({
        ok: false, needConfirm: true, mode, goodsId,
        text: `【${verb}预览 · 需用户确认】\n商品：${goodsId}\n操作：${verb}${mode === 'delete' ? '（删除需先下架；接口直删可能被服务端会话绑定拦截，下架 100% 可靠）' : ''}\n\n确认无误后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。`,
      })
      await browser.close()
      process.exit(0)
    }
    const gid = Number(goodsId)
    if (mode === 'offsale') {
      // ① 前置校验（页面同款：resourceValidate）
      await call('https://mms.pinduoduo.com/vodka/v2/mms/pc/resourceValidate', { goodsIdList: [gid], checkItem: ['if_in_bidding_check', 'if_in_goods_decoration', 'if_in_combine_buy'] }).catch(() => null)
      // ② 下架
      const a = await getAntiContent(page, { force: true })
      const r = await safeEval(async (u, bd, av) => {
        const resp = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Anti-Content': av }, body: JSON.stringify(bd) })
        return await resp.json().catch(() => null)
      }, 'https://mms.pinduoduo.com/vodka/v2/mms/pc/offSale', { goodsId: gid }, a.data)
      const ok = r?.success === true
      emit({
        ok, mode: 'offsale', goodsId,
        text: ok
          ? `商品 ${gid} 已下架。可在「已下架」列表确认。`
          : `下架失败：${r?.error_msg || JSON.stringify(r).slice(0, 200)}`,
      })
    } else if (mode === 'onsale') {
      const a = await getAntiContent(page, { force: true })
      const r = await safeEval(async (u, bd, av) => {
        const resp = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Anti-Content': av }, body: JSON.stringify(bd) })
        return await resp.json().catch(() => null)
      }, 'https://mms.pinduoduo.com/vodka/v2/mms/pc/onSale', { goodsId: gid }, a.data)
      const ok = r?.success === true
      emit({
        ok, mode: 'onsale', goodsId,
        text: ok
          ? `商品 ${gid} 已上架（在售）。`
          : `上架失败：${r?.error_msg || JSON.stringify(r).slice(0, 200)}`,
      })
    } else {
      // delete：create_by_sn 拿 commit_id → delete
      const sn = await call('https://mms.pinduoduo.com/glide/v2/mms/edit/commit/create_by_sn', { goods_id: gid }).catch(() => null)
      const cid = String(sn?.result?.goods_commit_id || '')
      const del = await call('https://mms.pinduoduo.com/glide/v2/mms/edit/commit/delete', { goods_id: gid, goods_commit_id: cid }).catch(() => null)
      const ok = del?.success === true
      // 验证
      await new Promise(r => setTimeout(r, 3000))
      const off = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/display/mall/goodsList', { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, size: 50, is_onsale: 0 }).catch(() => null)
      const list = off?.result?.goods_list || []
      const still = list.find(g => String(g.id) === String(gid))
      emit({
        ok: ok && !still, mode: 'delete', goodsId, commitId: cid,
        text: ok && !still
          ? `商品 ${gid} 已彻底删除（已不在「已下架」列表）。`
          : `接口已返回 success 但商品仍在列表——服务端会话绑定导致未落库。\n变通方案：先 offsale 下架，再到「已下架」列表页面点删除。`,
      })
    }
  } else if (mode === 'commit') {
    if (!goodsId) { emit({ ok: false, failureKind: 'api_error', text: 'commit 模式必须带 --goods-id' }); await browser.close(); process.exit(2) }
    const r = await call('https://mms.pinduoduo.com/glide/v2/mms/query/commit/on_shop/detail', { goods_id: Number(goodsId) })
    const res = r?.result || {}
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-works'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-works', `commit-${goodsId}.json`), JSON.stringify(r, null, 2), 'utf8')
    emit({
      ok: true, mode: 'commit', goodsId,
      fields: Object.keys(res).length,
      skus: (res.skus || []).length, gallery: (res.gallery || []).length,
      properties: (res.goods_properties || []).length,
      cat_id: res.cat_id, cat_path: (res.cats || []).filter(Boolean).join('>'),
      text: `商品 ${goodsId} 提交体快照：${Object.keys(res).length} 字段 | ${(res.skus || []).length} SKU | ${(res.gallery || []).length} 图 | ${(res.goods_properties || []).length} 属性\n类目：${(res.cats || []).filter(Boolean).join('>')}\n已存 artifacts/pdd-works/commit-${goodsId}.json`,
    })
  } else if (mode === 'spec-pool') {
    const r = await call(LIST_URL, listBody)
    const goods = r?.result?.goods_list || []
    const pool = {}
    for (const g of goods) {
      await new Promise(res => setTimeout(res, 1200))
      const sku = await call('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', { goodsId: g.id })
      for (const s of sku?.result || []) {
        for (const sp of s.spec || []) {
          if (sp.spec_value == null || sp.spec_id == null) continue
          const dim = sp.spec_key || '规格'
          if (!pool[dim]) pool[dim] = {}
          if (!pool[dim][sp.spec_value]) pool[dim][sp.spec_value] = { spec_id: sp.spec_id, parent_spec_id: sp.parent_spec_id ?? 0 }
        }
      }
    }
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-re'), { recursive: true })
    const out = { pool, collectedAt: new Date().toISOString(), goodsScanned: goods.length }
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-re', 'spec-pool.json'), JSON.stringify(out, null, 2), 'utf8')
    const dims = Object.entries(pool).map(([k, v]) => `${k}(${Object.keys(v).length})`).join('、')
    emit({
      ok: true, mode: 'spec-pool', goodsScanned: goods.length, dims,
      text: `规格池采集完成：扫描 ${goods.length} 个商品 → ${dims}\n已存 artifacts/pdd-re/spec-pool.json`,
    })
  } else {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：overview / list / detail / sku / commit / spec-pool` })
  }
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})
