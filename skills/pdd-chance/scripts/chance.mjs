/**
 * 拼多多机会商品（chance-goods）数据采集
 *
 * 入口：商家后台 → 商品管理 → 机会商品（/goods/goods_list/chance）
 *
 * ★ 2026-10-23 逆向发现：全新域 `/opportunity-goods/*`，
 *   不在官方风控 SDK 的 antiCrawlerApiList 白名单里（风控宽松）。
 *
 * 接口清单：
 *   POST /opportunity-goods/chance-goods/home_list        主列表（分页 + banner_type）
 *   POST /opportunity-goods/chance-goods/my_list          我的机会商品
 *   POST /opportunity-goods/chance-goods/collection/list  收藏列表
 *   POST /opportunity-goods/chance-goods/mission_info     任务信息（礼物/考试/图片任务）
 *   POST /opportunity-goods/chance-goods/get_filters      筛选项
 *   POST /opportunity-goods/chance-goods/cate_info        类目信息（全量机会类目树）
 *   POST /opportunity-goods/chance-goods/default_category      默认类目
 *   POST /opportunity-goods/chance-goods/default_category_general  通用默认类目（{type:2}）
 *   POST /opportunity-goods/chance-goods/mall_gray       灰度开关
 *   POST /opportunity-goods/chance-goods/oversea         跨境
 *
 * 用法：
 *   node scripts/chance.mjs --mode list [--page 1] [--size 35] [--cat-id 16548]
 *   node scripts/chance.mjs --mode mine       我的机会商品
 *   node scripts/chance.mjs --mode collection 收藏列表
 *   node scripts/chance.mjs --mode mission    任务信息
 *   node scripts/chance.mjs --mode filters    筛选项（含 51 个站内热搜/缺货词）
 *   node scripts/chance.mjs --mode cates      机会类目树（259 个，看哪些类目开了机会池）
 *
 * ★ --cat-id：按一级类目查机会商品（默认 = 店铺主营类目）。
 *   实测：只有 `cat_id_1` 参数生效（cate_id_1/category_id/opt_id 都无效，会返回默认池）。
 *   已开放机会池的一级类目共 19 个（用 --mode cates 看），未开放的返回 total=0。
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'list'
const pageNo = Math.max(1, parseInt(argOf('page') || '1', 10) || 1)
const size = Math.min(100, Math.max(1, parseInt(argOf('size') || '35', 10) || 35))
// ★ --cat-id：按一级类目查机会商品。空 = 店铺主营类目（平台推荐）
const catId = argOf('cat-id') ? Number(argOf('cat-id')) : null

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-risk.mjs`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号，请到「账号连接」添加。' }); process.exit(2) }

  const cd = checkCooldown(SHOP)
  if (cd.cooling) {
    emit({ ok: false, failureKind: 'rate_limit', text: `账号 ${SHOP} 命中平台频控，冷却剩余 ${fmtRemain(cd.remainMs)}（${cd.reason}）。` })
    process.exit(2)
  }

  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-position=100,50'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 15; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }
  const safeGoto = async (url, opts) => {
    for (let k = 0; k < 4; k++) {
      try { return await page.goto(url, opts) } catch (e) {
        if (/detached Frame|Session closed/i.test(e.message) && k < 3) { await new Promise(r => setTimeout(r, 2000)); continue }
        throw e
      }
    }
  }

  // ① 商品列表建会话（机会商品页需要 mms 会话）
  await safeGoto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 12000))
  if (/\/login/i.test(page.url())) {
    await browser.close()
    emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
    process.exit(2)
  }
  // 滑块自动过
  if (await detectSlider(page)) {
    console.error('[chance] 检测到滑块遮罩，尝试自动过滑块...')
    const solved = await autoSolveSlider(SHOP, page)
    console.error(`[chance] ${solved.text}`)
    if (!solved.ok) {
      await browser.close()
      emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}` })
      process.exit(2)
    }
    await new Promise(r => setTimeout(r, 2000))
    await safeGoto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await new Promise(r => setTimeout(r, 10000))
  }

  // ② hook 签名（Anti-Content + crawlerInfo）
  //    ★ 2026-10-23 实测：/opportunity-goods/* 不在风控白名单，不需要签名也能返回全量数据
  //    （带/不带签名都是 total:455）。仍保留 hook 作为兜底——某些接口可能后续加风控。
  await page.evaluateOnNewDocument(() => {
    window.__sig = null
    const O = window.XMLHttpRequest.prototype.open
    const S = window.XMLHttpRequest.prototype.send
    const SH = window.XMLHttpRequest.prototype.setRequestHeader
    window.XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return O.apply(this, arguments) }
    window.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__h[k] = v; return SH.apply(this, arguments) }
    window.XMLHttpRequest.prototype.send = function (b) {
      try { if (String(b).includes('crawlerInfo')) window.__sig = { anti: this.__h['Anti-Content'], crawlerInfo: JSON.parse(String(b)).crawlerInfo } } catch { /* ignore */ }
      return S.apply(this, arguments)
    }
  }).catch(() => { /* ignore */ })

  // ③ 打开机会商品页（建立会话 + 让页面自己发请求）
  await safeGoto('https://mms.pinduoduo.com/goods/goods_list/chance', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 14000))
  // 机会商品页滑块
  if (await detectSlider(page)) {
    console.error('[chance] 机会商品页滑块 → 自动过...')
    const solved = await autoSolveSlider(SHOP, page)
    console.error(`[chance] ${solved.text}`)
    if (solved.ok) {
      await new Promise(r => setTimeout(r, 2000))
      await safeGoto('https://mms.pinduoduo.com/goods/goods_list/chance', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
      await new Promise(r => setTimeout(r, 12000))
    }
  }
  const sig = await page.evaluate(() => window.__sig).catch(() => null)
  console.error(`[chance] 签名: ${sig ? '有' : '无（该域不需要，无影响）'}`)

  const call = async (apiPath, body) => {
    // 该域不需要 crawlerInfo/Anti-Content；有签名就带上（兜底未来加风控）
    const payload = sig ? { ...body, crawlerInfo: sig.crawlerInfo } : body
    // ★ puppeteer 的 frame.evaluate 只接受「一个」arg —— 多参数会被丢，
    //   导致 fetch 拿到 undefined → 平台报 4000000「请求method,argument,body错误」。
    //   必须打包成单对象传入。
    const argObj = { p: apiPath, bd: payload, av: sig?.anti || null }
    return await safeEval(async (o) => {
      const resp = await fetch('https://mms.pinduoduo.com' + o.p, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(o.av ? { 'Anti-Content': o.av } : {}) },
        body: JSON.stringify(o.bd),
      })
      return await resp.json().catch(() => null)
    }, argObj)
  }

  const BASE = '/opportunity-goods/chance-goods'

  if (mode === 'list' || mode === 'mine' || mode === 'collection') {
    const api = mode === 'list' ? `${BASE}/home_list` : mode === 'mine' ? `${BASE}/my_list` : `${BASE}/collection/list`
    // ★ cat_id_1 才会筛选类目；cate_id_1/category_id/opt_id 都无效（实测）
    const body = mode === 'list'
      ? { size, page: pageNo, banner_type: 0, ...(catId ? { cat_id_1: catId } : {}) }
      : { size, page: pageNo, ...(catId ? { cat_id_1: catId } : {}) }
    const r = await call(api, body)
    const res = r?.result || {}
    const list = res.list || []
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', `${mode}-p${pageNo}.json`), JSON.stringify(r, null, 2), 'utf8')
    const items = list.map(g => ({
      chanceId: g.chance_id,
      keywords: g.keywords || '',
      referPrice: g.refer_price,
      priceLabel: g.price_label || '',
      hotIndex: g.hot_index,
      mmsHotIndex: g.mms_hot_index,
      oprtyIndex: g.mms_oprty_index,
      indexTarget: g.mms_index_target,
      potentialIndex: g.potential_index,
      labels: (g.labels || []).map(l => l.title).filter(Boolean),
      cats: [g.cat_id_1, g.cat_id_2, g.cat_id_3].filter(Boolean),
      pics: (g.gallery_img_url_list || []).length,
      collected: !!g.is_collection,
      pic: g.pic_url || '',
    }))
    emit({
      ok: true, mode, shopKey: SHOP,
      catId, total: res.total ?? items.length, page: pageNo, count: items.length,
      items,
      text: items.length
        ? `机会商品（${catId ? `类目 ${catId} · ` : ''}第 ${pageNo} 页，共 ${res.total ?? '?'} 条，本页 ${items.length}）：\n` + items.slice(0, 15).map((g, i) =>
            `  ${i + 1}. [${g.chanceId.slice(0, 12)}] ${g.keywords}\n`
            + `     参考价 ${g.referPrice}${g.priceLabel ? '（' + g.priceLabel + '）' : ''} | 热度 ${g.hotIndex} | 潜力 ${g.potentialIndex} | ${g.pics} 图\n`
            + `     标签：${g.labels.join(' / ') || '—'} | 类目 ${g.cats.join('>')}${g.collected ? ' | 已收藏' : ''}`
          ).join('\n') + (items.length > 15 ? `\n  ...（其余 ${items.length - 15} 条见 JSON）` : '')
        : catId
          ? `类目 ${catId} 暂无机会商品（total=${res.total ?? 0}）。\n可能：①该类目未开放机会池（当前仅 19 个一级类目开放，用 --mode cates 查看）\n②平台正在补录。建议隔天再试。`
          : '机会商品：本页无数据',
    })
  } else if (mode === 'mission') {
    const r = await call(`${BASE}/mission_info`, {})
    const m = r?.result || {}
    emit({
      ok: true, mode, shopKey: SHOP, mission: m,
      text: `机会商品任务：\n`
        + `  礼物任务：${m.show_gift_mission ? `进行中（${m.gift_mission_condition_cnt} 条件，已领 ${m.received_gift}）${m.is_gift_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  考试任务：${m.show_exam_mission ? `进行中（${m.exam_mission_condition_cnt} 条件，奖励 ${m.exam_mission_reward_cnt}）${m.is_exam_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  图片任务：${m.show_pic_mission ? `进行中（${m.pic_mission_condition_cnt} 条件）${m.is_pic_mission_complete ? ' ✅完成' : ''}` : '未开启'}\n`
        + `  跟款商品数：${m.follow_goods_cnt}（近 1 月 ${m.follow_goods_cnt_1m}）`,
    })
  } else if (mode === 'filters') {
    const r = await call(`${BASE}/get_filters`, {})
    const groups = r?.result || []
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'filters.json'), JSON.stringify(r, null, 2), 'utf8')
    const lines = []
    const hotWords = []
    for (const g of groups) {
      const key = g.params_key || ''
      const opts = g.option_info_list || []
      if (key === 'mall_chance_words') {
        // 站内热搜/缺货词——选品金矿，单独提取
        for (const o of opts) hotWords.push({ word: (o.option_key || o.title || '').trim(), tag: o.short_essay || '' })
        lines.push(`${key}（${opts.length} 个站内热搜/缺货词）：${opts.slice(0, 15).map(o => `${(o.option_key || o.title || '').trim()}${o.short_essay ? '[' + o.short_essay + ']' : ''}`).join('、')}${opts.length > 15 ? ' ...' : ''}`)
      } else {
        lines.push(`${key}（${opts.length} 项）：${opts.map(o => `${o.title || o.option_key || ''}${o.short_essay ? '（' + o.short_essay + '）' : ''}`).filter(Boolean).join(' / ') || '—'}`)
      }
    }
    emit({
      ok: true, mode, shopKey: SHOP, groups, hotWords,
      text: `机会商品筛选项（${groups.length} 组）：\n` + lines.join('\n')
        + (hotWords.length ? `\n\n★ 站内热搜/缺货词（${hotWords.length} 个，选品参考）：\n` + hotWords.slice(0, 25).map(w => `  ${w.word}${w.tag ? ' [' + w.tag + ']' : ''}`).join('\n') : ''),
    })
  } else if (mode === 'cates') {
    // ★ cate_info 必须带 size/page，空 body 返回 result:null
    const r = await call(`${BASE}/cate_info`, { size: 100, page: 1 })
    const res = r?.result || {}
    fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-chance'), { recursive: true })
    fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-chance', 'cates.json'), JSON.stringify(r, null, 2), 'utf8')
    // cate_info 的 result 是数组（259 个），字段 cate_id/cate_name/cate1_id/cate_lvl...
    const arr = Array.isArray(res) ? res : Object.values(res)
    const norm = arr.map(c => ({
      cateId: c.cate_id ?? c.id,
      name: c.cate_name ?? c.name ?? '',
      lvl: c.cate_lvl ?? null,
      parentId: c.parent_id ?? null,
      cate1Id: c.cate1_id ?? null,
      cate1Name: c.cate1_name ?? '',
      desc: c.cate_desc ?? '',
    }))
    const lvl1 = norm.filter(c => c.lvl === 1 || (c.cate1Id && c.cateId === c.cate1Id))
    emit({
      ok: true, mode, shopKey: SHOP, count: norm.length, lvl1Count: lvl1.length,
      cates: norm,
      text: `机会类目树：${norm.length} 个类目（一级 ${lvl1.length} 个）\n`
        + (lvl1.length ? lvl1.slice(0, 30).map(c => `  [${c.cateId}] ${c.name}`).join('\n')
           : norm.slice(0, 30).map(c => `  [${c.cateId}] ${c.name}（lvl ${c.lvl}，上级 ${c.parentId}）`).join('\n')),
    })
  } else {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：list / mine / collection / mission / filters / cates` })
    await browser.close(); process.exit(2)
  }
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})
