/**
 * 拼多多店铺经营数据（pdd-shop）—— 只读
 *
 * 数据源：生意参谋（mms.pinduoduo.com/sycm/*），接口统一 /sydney/api/* 前缀。
 * 全部 HTTP，无平台副作用。采用「打开经营页 → hook 页面自己的响应」取数
 * （与 pdd-promo 同思路，规避 sycm 的风控签名）。
 *
 * 能力：
 *   overview   店铺经营总览（流量 + 评分 + 商品数据 + 店铺等级）
 *   flow       店铺流量数据（访客 uv / 浏览量 pv / 粉丝 / 搜索指数）
 *   score      店铺评分（服务数据：退款率/发货/客服响应）
 *   goods      商品数据明细（每商品 访客/支付金额/支付订单/转化率/收藏）
 *
 * 用法：node scripts/shop.mjs --mode overview
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号，请到「账号连接」添加。' }); process.exit(2) }

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
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // hook 经营数据响应（/sydney/api/* + 等级）
  const byApi = {}
  const APIS = [
    ['flow', 'sydney/api/mallScore/queryMallFlowData'],
    ['score', 'sydney/api/mallScore/queryMallScoreOverView'],
    ['goodsOverview', 'sydney/api/goodsDataShow/queryGoodsPageOverviewForMms'],
    ['goodsList', 'sydney/api/goodsDataShow/queryGoodsDetailVOListForMMS'],
    ['mallLevel', 'rivendell/api/mallLevel/getEntranceInfo'],
  ]
  cdp.on('Network.responseReceived', async (e) => {
    if (e.response.status !== 200) return
    const u = e.response.url
    if (!/mms\.pinduoduo\.com/.test(u)) return
    const hit = APIS.find(([, key]) => u.includes(key))
    if (!hit) return
    try {
      const b = await cdp.send('Network.getResponseBody', { requestId: e.requestId })
      const j = JSON.parse(b.body)
      if (j && (j.errorCode === 1000000 || j.success === true)) byApi[hit[0]] = j.result
    } catch { /* ignore */ }
  })

  // 打开经营页让页面自己发数据请求（先主应用建立会话，再进 sycm 子应用）
  for (const u of [
    'https://mms.pinduoduo.com/goods/goods_list',
    'https://mms.pinduoduo.com/sycm/evaluation',
    'https://mms.pinduoduo.com/sycm/goods_effect',
  ]) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await new Promise(r => setTimeout(r, u.includes('sycm') ? 13000 : 9000))
      if (/\/login/i.test(page.url())) {
        // 主应用跳登录 = 真失效；sycm 跳登录 = 会话未建立，重试一次
        if (!u.includes('sycm')) {
          await browser.close()
          emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
          process.exit(2)
        }
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 12000))
      }
    } catch { /* 单页失败不阻断 */ }
  }

  // ── 解析 ──
  const flow = byApi.flow || null
  const score = byApi.score || null
  const gOverview = byApi.goodsOverview || null
  const gList = byApi.goodsList?.goodsDetailList || []
  const mallLevel = byApi.mallLevel || null

  const goodsItems = gList.slice(0, limit).map(g => ({
    goodsId: g.goodsId,
    name: g.goodsName || '',
    date: g.statDate,
    uv: g.goodsUv,           // 访客
    pv: g.goodsPv,           // 浏览量
    payAmt: g.payOrdrAmt,    // 支付金额
    payCnt: g.payOrdrCnt,    // 支付订单
    payQty: g.payOrdrGoodsQty,
    payUsers: g.payOrdrUsrCnt,
    vcr: g.goodsVcr,         // 转化率
    fav: g.goodsFavCnt,      // 收藏
  }))

  const out = { ok: true, mode, shopKey: SHOP, items: [] }
  const lines = []

  if (mode === 'overview' || mode === 'flow') {
    out.flow = flow ? {
      uv: flow.uv, pv: flow.pv,
      uvPct: flow.uvPct, pvPct: flow.pvPct,
      srchIndex: flow.srchIndex, orderIndex: flow.orderIndex,
      totalFans: flow.totalFansCnt, weekFans: flow.curWeekFansCnt,
    } : null
    if (mode === 'flow') {
      lines.push('店铺流量：')
      lines.push(`  访客(uv)：${flow?.uv ?? '—'}${flow?.uvPct ? `（环比 ${flow.uvPct}）` : ''}`)
      lines.push(`  浏览量(pv)：${flow?.pv ?? '—'}${flow?.pvPct ? `（环比 ${flow.pvPct}）` : ''}`)
      lines.push(`  搜索指数：${flow?.srchIndex ?? '—'} | 交易指数：${flow?.orderIndex ?? '—'}`)
      lines.push(`  粉丝：总 ${flow?.totalFansCnt ?? '—'} / 本周新增 ${flow?.curWeekFansCnt ?? '—'}`)
      out.text = lines.join('\n')
    }
  }

  if (mode === 'overview' || mode === 'score') {
    out.score = score || null
    if (mode === 'score') {
      const sd = score?.serviceDataVO || {}
      lines.push('店铺评分（服务数据）：')
      lines.push(`  退款率：${sd.rfRto1m ?? '—'}`)
      lines.push(`  平台介入率：${sd.pltInvlRto1m ?? '—'}`)
      lines.push(`  成功退款订单金额：${sd.sucRfOrdrAmt1d ?? '—'}`)
      lines.push(`  平均成功退款处理时长：${sd.avgSucRfProcTime1m ?? '—'}`)
      out.text = lines.join('\n') || '店铺评分：暂无数据'
    }
  }

  if (mode === 'overview' || mode === 'goods') {
    out.goodsOverview = gOverview ? {
      today: gOverview.todayData, yesterday: gOverview.yesData,
    } : null
    out.goods = goodsItems
    out.items = goodsItems
    if (mode === 'goods') {
      out.text = goodsItems.length
        ? `商品数据明细（${goodsItems.length} 个商品）：\n` + goodsItems.map((g, i) =>
            `  ${i + 1}. [${g.goodsId}] ${String(g.name).slice(0, 26)} | 访客=${g.uv ?? '—'} 支付=${g.payAmt ?? '—'}元 订单=${g.payCnt ?? '—'} 转化率=${g.vcr ?? '—'}`).join('\n')
        : '商品数据：暂无明细（接口未返回或页面未加载完）'
    }
  }

  if (mode === 'overview') {
    out.mallLevel = mallLevel ? { level: mallLevel.level, gmv: mallLevel.gmv, restGmv: mallLevel.restGmv } : null
    const td = gOverview?.todayData
    const yd = gOverview?.yesData
    lines.length = 0
    lines.push('店铺经营总览：')
    if (mallLevel) lines.push(`  店铺等级：${mallLevel.level ?? '—'}${mallLevel.gmv ? `（当前 GMV ${mallLevel.gmv}）` : ''}`)
    if (flow) lines.push(`  访客 ${flow.uv ?? '—'} | 浏览量 ${flow.pv ?? '—'} | 粉丝 ${flow.totalFansCnt ?? '—'}`)
    if (td) lines.push(`  今日商品数据：支付金额 ${td.payOrdrAmt}元 / 订单 ${td.payOrdrCnt} / 访客商品 ${td.vstGoodsCnt} / 支付转化 ${td.payUvRto}`)
    if (yd) lines.push(`  昨日商品数据：支付金额 ${yd.payOrdrAmt}元 / 订单 ${yd.payOrdrCnt} / 访客商品 ${yd.vstGoodsCnt} / 支付转化 ${yd.payUvRto}`)
    if (goodsItems.length) {
      const top = goodsItems.slice().sort((a, b) => Number(b.payAmt || 0) - Number(a.payAmt || 0))[0]
      lines.push(`  支付金额最高商品：[${top.goodsId}] ${String(top.name).slice(0, 24)}（${top.payAmt}元 / ${top.payCnt}单）`)
    }
    out.text = lines.join('\n')
  }

  if (mode !== 'overview' && mode !== 'flow' && mode !== 'score' && mode !== 'goods') {
    emit({ ok: false, failureKind: 'api_error', text: `未知 mode：${mode}。可用：overview / flow / score / goods` })
    await browser.close()
    process.exit(2)
  }
  emit(out)
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})
