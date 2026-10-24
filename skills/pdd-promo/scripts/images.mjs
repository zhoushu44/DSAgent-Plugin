/**
 * 拼多多 · 推广商品图片 + 推广数据（pdd-promo images）
 *
 * 逆向结论（2026-10-24）：
 *   推广域（yingxiao）稳定成本推广没有「创意/素材」tab —— 自动投放。
 *   「推广里的图片」= 推广单元关联商品的商品主图。
 *
 * ★ 单接口拿全部：hook 页面的
 *     POST /mms-gateway/venus/api/goods/promotion/v3/list
 *   响应 result.adInfos[] 每一条已包含：
 *     · goodsInfo  → goodsId / goodsName / thumbUrl / catId / minOnSaleGroupPrice
 *     · 几十个推广指标（impression / click / ctr / spend / gmv / roi / order ...）
 *     · maxCostSuggestVO / suggestLimitInfo / bidAlertInfo / adAssistInfo
 *
 *   不需要另外调 sku/info（那是 mms 域的，跨域会失败）。
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mode = argOf('mode') || 'goods-images'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

/** 拆 {value, unit} → number（按单位换算） */
function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'object' && 'value' in v) {
    const n = parseFloat(v.value)
    if (!Number.isFinite(n)) return null
    const u = v.unit || v.unitCode
    if (u === 'PERCENT' || u === 100) return n            // 已是百分比数值
    if (u === 'PER_ONE' || u === 1) return n
    return n
  }
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
/** 保留原始 {value, unit} */
function raw(v) {
  if (v == null) return null
  if (typeof v === 'object' && 'value' in v) return `${v.value}${v.unit ? '(' + v.unit + ')' : ''}`
  return v
}

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { launchOptions, STEALTH_SCRIPT } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-launch.mjs`)
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  let SHOP = argOf('account') || store.listAccounts().filter(a => a.platform === 'pdd_mms').slice(-1)[0]?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  const browser = await puppeteer.launch(launchOptions(SHOP, {
    args: [
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  }))
  const page = (await browser.pages())[0] || await browser.newPage()
  await page.evaluateOnNewDocument(STEALTH_SCRIPT)
  // hook XHR：被动截获页面自己发的 v3/list（主动 fetch 会 54001）
  await page.evaluateOnNewDocument(() => {
    window.__caps = []
    const O = XMLHttpRequest.prototype.open
    const S = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return O.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function () {
      const self = this
      self.addEventListener('load', () => {
        try {
          const u = String(self.__u || '')
          if (!/mms-gateway/.test(u)) return
          const txt = self.responseText
          if (!txt || txt.length < 20) return
          JSON.parse(txt)   // 只存合法 JSON
          window.__caps.push({ url: u.slice(0, 260), body: txt })
          if (window.__caps.length > 60) window.__caps.splice(0, 20)
        } catch { /* ignore */ }
      })
      return S.apply(this, arguments)
    }
  })

  async function ev(fn, ...args) {
    for (let i = 0; i < 6; i++) {
      try { return await page.evaluate(fn, ...args) }
      catch (e) {
        if (/detached Frame|Target closed/i.test(String(e))) { await sleep(2000); continue }
        throw e
      }
    }
    return null
  }
  async function waitReady(minLen = 400) {
    for (let i = 0; i < 45; i++) {
      try {
        const len = await ev(() => (document.body?.innerText || '').length)
        const isLogin = await ev(() => /\/login|\/sso/i.test(location.href))
        if (len > minLen && !isLogin) return true
      } catch { /* ignore */ }
      await sleep(2000)
    }
    return false
  }

  console.error('[pdd-promo] 打开推广列表...')
  await page.goto('https://yingxiao.pinduoduo.com/goods/promotion/list', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
  await waitReady()
  await sleep(16000)

  const out = { ok: true, mode, shopKey: SHOP }

  try {
    // 页面内解析，只回传需要的字段（响应 324KB，整串回传会被截断）
    const res = await ev(() => {
      const caps = window.__caps || []
      const hits = caps.filter(c => /goods\/promotion\/v3\/list/.test(c.url))
      if (!hits.length) return { found: 0, units: [] }
      try {
        const j = JSON.parse(hits[hits.length - 1].body)
        const r = j?.result || {}
        return {
          found: hits.length,
          total: r.totalAdNum,
          sum: r.sumReportInfo || null,
          reportTime: r.reportLatestUpdateTime,
          units: r.adInfos || [],
        }
      } catch (e) { return { found: hits.length, units: [], err: String(e).slice(0, 80) } }
    })

    if (!res?.units?.length) {
      out.ok = false; out.failureKind = 'api_error'
      out.text = `未 hook 到推广单元（${res?.found ?? 0} 个 v3/list${res?.err ? '，解析失败: ' + res.err : ''}）`
      emit(out); process.exit(2)
    }

    // 指标字段清单（★ 都在 u.reportInfo 里，不在顶层）
    const METRICS = [
      ['impression', '曝光量'], ['click', '点击量'], ['ctr', '点击率CTR%'], ['cvr', '转化率CVR%'],
      ['spend', '花费'], ['marketingSpend', '营销花费'],
      ['gmv', 'GMV'], ['payGmv', '支付GMV'], ['netGmv', '净GMV'], ['directGmv', '直接GMV'],
      ['orderNum', '订单数'], ['netOrderNum', '净订单数'], ['directOrderNum', '直接订单数'],
      ['orderSpendRoiUnified', 'ROI'], ['settlementRoi', '结算ROI'], ['netRoiForDealAd', '净ROI'],
      ['avgPayAmount', '客单价'], ['netAvgPayAmount', '净客单价'],
      ['costPerOrder', '单均成本'], ['orderSpendNetCostPerOrder', '净单均成本'],
      ['goodsFavSpend', '商品收藏花费'], ['multiGoalGoodsFavNum', '商品收藏数'],
      ['mallFavSpend', '店铺收藏花费'], ['multiGoalMallFavNum', '店铺收藏数'],
      ['refundGmv30d', '30日退款GMV'], ['refundOrder30d', '30日退款订单'],
      ['settlementGmv', '结算GMV'], ['settlementOrder', '结算订单'],
      ['netOrderNumRate', '净订单率%'], ['netGmvRate', '净GMV率%'],
      ['settlementGmvRate', '结算GMV率%'], ['settlementOrderRate', '结算订单率%'],
    ]

    const items = res.units.slice(0, limit).map(u => {
      const gi = u.goodsInfo || {}
      const ri = u.reportInfo || {}
      const m = {}
      for (const [k, label] of METRICS) {
        if (ri[k] != null) {
          const n = num(ri[k])
          m[label] = n ?? raw(ri[k])
        }
      }
      return {
        adId: u.adId ?? null,
        adName: u.adName ?? null,
        adStatus: u.adStatus ?? null,
        groupName: u.groupName ?? u.adGroupInfo?.groupName ?? null,
        goods: {
          goodsId: gi.goodsId ?? u.goodsId ?? null,
          goodsName: gi.goodsName ?? null,
          thumbUrl: gi.thumbUrl ?? null,
          catId: gi.catId ?? null,
          price: gi.minOnSaleGroupPrice ? num(gi.minOnSaleGroupPrice) : null,
        },
        metrics: m,
        suggest: {
          maxCost: u.maxCostSuggestVO?.suggestMaxCost ? num(u.maxCostSuggestVO.suggestMaxCost) : null,
          bidMin: u.suggestLimitInfo?.minValue ? num(u.suggestLimitInfo.minValue) : null,
          bidMax: u.suggestLimitInfo?.maxValue ? num(u.suggestLimitInfo.maxValue) : null,
          expectedBid: u.bidAlertInfo?.expectedBid ? num(u.bidAlertInfo.expectedBid) : null,
        },
        raw: u,
      }
    })

    out.items = items
    out.count = items.length
    out.total = res.total ?? items.length
    out.reportTime = res.reportTime
    out.sum = res.sum ? Object.fromEntries(Object.entries(res.sum).slice(0, 12).map(([k, v]) => [k, raw(v)])) : null

    const L = [`推广商品图片 + 推广数据（${items.length}/${res.total ?? items.length} 个）`, '']
    if (out.reportTime) L.push(`数据更新时间: ${out.reportTime}`)
    if (out.sum) {
      L.push('')
      L.push('【全店合计】')
      for (const [k, v] of Object.entries(out.sum)) L.push(`  ${k}: ${v}`)
    }
    L.push('')
    for (const it of items) {
      const g = it.goods
      L.push(`${'─'.repeat(76)}`)
      L.push(`[${it.adId}] ${String(it.adName || '').slice(0, 45)}`)
      L.push(`  商品ID ${g.goodsId ?? '—'} | 拼单价 ¥${g.price ?? '—'} | 类目 ${g.catId ?? '—'} | 状态 ${it.adStatus ?? '—'}`)
      L.push(`  名称   ${String(g.goodsName || '').slice(0, 60)}`)
      L.push(`  图片   ${g.thumbUrl ?? '（无）'}`)
      if (Object.keys(it.metrics).length) {
        // 隐藏全 0 的指标（推广未起量的单元大部分是 0）
        const nonZero = Object.entries(it.metrics).filter(([, v]) => {
          const n = typeof v === 'number' ? v : parseFloat(v)
          return Number.isFinite(n) ? n !== 0 : true
        })
        if (nonZero.length) {
          L.push('  推广数据:')
          for (const [label, v] of nonZero) {
            const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)
            L.push(`    ${label.padEnd(14)} ${s}`)
          }
        } else {
          L.push('  推广数据: 全为 0（未起量）')
        }
      }
      if (it.suggest.maxCost != null || it.suggest.expectedBid != null) {
        L.push(`  建议: 日限额 ¥${it.suggest.maxCost ?? '—'} | 出价 ${it.suggest.bidMin ?? '—'}~${it.suggest.bidMax ?? '—'} | 期望 ${it.suggest.expectedBid ?? '—'}`)
      }
    }
    out.text = L.join('\n')
  } catch (e) {
    out.ok = false; out.failureKind = 'exception'
    out.text = `推广商品图片失败：${e.message?.slice(0, 200)}`
    emit(out); process.exit(2)
  }

  emit(out)
  process.exit(out.ok ? 0 : 2)
})().catch(async (e) => {
  emit({ ok: false, failureKind: 'exception', text: `推广商品图片异常：${e.message?.slice(0, 200)}` })
  process.exit(2)
})
