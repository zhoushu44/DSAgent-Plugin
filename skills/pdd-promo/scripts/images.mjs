/**
 * 给 pdd-promo 加「商品图片」数据
 *
 * 逆向结论（2026-10-24）：
 *   · 推广域（yingxiao）稳定成本推广没有「创意/素材」tab —— 自动投放
 *   · 推广里的图片 = 推广单元关联商品的商品主图
 *   · 来源：推广列表抽屉 DOM 里的 <img>（64x64 缩略图）
 *     https://img.pddpic.com/gaudit-image/<日期>/<hash>.jpeg?imageMogr2/...
 *   · 原始大图：把 URL 里的 imageMogr2 参数去掉即可
 *
 * 已有能力：units 模式拿推广单元（含商品 ID）
 * 新增：goods-images 模式 → 推广单元 + 商品图
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const has = (n) => process.argv.includes(`--${n}`)
const mode = argOf('mode') || 'overview'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))

/** 从缩略图 URL 推导原图 URL */
function toOrigin(url) {
  if (!url) return ''
  return url.split('?')[0]
}
/** 从缩略图 URL 推导指定尺寸 */
function toSize(url, w) {
  if (!url) return ''
  const base = url.split('?')[0]
  return `${base}?imageMogr2/thumbnail/${w}x${w}/format/webp`
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

  // hook XHR，被动截获页面自己发的推广接口响应（主动 fetch 会 54001）
  await page.evaluateOnNewDocument(() => {
    window.__caps = []
    const O = XMLHttpRequest.prototype.open
    const S = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = String(u); return O.apply(this, arguments) }
    XMLHttpRequest.prototype.send = function () {
      const self = this
      this.addEventListener('load', () => {
        try {
          const u = String(self.__u || '')
          if (!/mms-gateway/.test(u)) return
          const txt = self.responseText
          if (!txt || txt.length < 20) return
          JSON.parse(txt)
          window.__caps.push({ url: u.slice(0, 260), body: txt, len: txt.length })
          if (window.__caps.length > 400) window.__caps.splice(0, 150)
        } catch { /* 非 JSON / 跨域 */ }
      })
      return S.apply(this, arguments)
    }
  })

  const CDP_LAUNCH = true

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
  await sleep(14000)

  const out = { ok: true, mode, shopKey: SHOP }

  try {
    if (mode === 'goods-images' || mode === 'images') {
      // 拿推广单元（hook 到的 v3/list）
      // ★ 页面内直接解析，只回传 adInfos（响应 324KB，整串回传会被截断）
      let units = []
      const unitsRes = await ev(() => {
        const caps = window.__caps || []
        const hits = caps.filter(c => /goods\/promotion\/v3\/list/.test(c.url))
        if (!hits.length) return { found: 0, units: [] }
        try {
          const j = JSON.parse(hits[hits.length - 1].body)
          return { found: hits.length, units: j?.result?.adInfos || [], total: j?.result?.totalAdNum }
        } catch (e) { return { found: hits.length, units: [], err: String(e).slice(0, 80) } }
      })
      units = unitsRes?.units || []
      if (!units.length) {
        out.ok = false; out.failureKind = 'api_error'
        out.text = `未 hook 到推广单元（${unitsRes?.found ?? 0} 个 v3/list 响应${unitsRes?.err ? '，解析失败: ' + unitsRes.err : ''}）。`
        emit(out); process.exit(2)
      }
      out.totalAdNum = unitsRes?.total ?? units.length

      // 遍历推广单元，按 goodsId 调 sku/info 拿商品图
      // ★ 必须先在 mms 域建立会话 —— sku/info 是 mms 的接口，
      //   在 yingxiao 域调会跨域失败
      const items = []
      const max = Math.min(units.length, limit)

      try {
        await page.goto('https://mms.pinduuduo.com/goods/goods_list'.replace('pinduuduo', 'pinduoduo'), { waitUntil: 'domcontentloaded', timeout: 60000 })
        await waitReady()
        await sleep(10000)
      } catch (e) {
        console.error(`[pdd-promo] mms 域导航失败: ${String(e).slice(0, 60)}`)
      }

      for (let i = 0; i < max; i++) {
        const u = units[i]
        const adId = u.adId ?? u.id
        const gid = u.goodsId ?? null
        console.error(`[pdd-promo] ${i + 1}/${max} adId=${adId} goodsId=${gid}`)

        let thumb = ''
        let specs = []
        if (gid) {
          try {
            const sr = await ev(async (g) => {
              const resp = await fetch('https://mms.pinduoduo.com/vodka/v2/mms/query/sku/info', {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goodsId: Number(g) }),
              })
              return resp.json().catch(() => null)
            }, gid)
            const sku = sr?.result?.[0]
            thumb = sku?.thumb_url || ''
            specs = (sku?.spec || []).map(s => ({ key: s.spec_key, value: s.spec_value }))
            if (!thumb) console.error(`[pdd-promo] 无 thumb_url: ${JSON.stringify(sr).slice(0, 150)}`)
          } catch (e) {
            console.error(`[pdd-promo] sku/info 失败: ${String(e).slice(0, 60)}`)
          }
          await sleep(1500)   // 防节流（40002）
        }

        items.push({
          adId,
          adName: u.adName ?? u.name ?? '',
          goodsId: gid,
          status: u.adStatus ?? u.status ?? null,
          images: thumb ? [{
            thumb: thumb,
            origin: toOrigin(thumb),
            medium: toSize(thumb, 400),
            large: toSize(thumb, 800),
          }] : [],
          specs,
          raw: u,
        })
      }

      out.items = items
      out.count = items.length
      const L = [`推广商品图片（${items.length} 个推广单元）`, '']
      for (const it of items.slice(0, limit)) {
        L.push(`  [${it.adId}] ${String(it.adName || '').slice(0, 40)}`)
        L.push(`     商品ID: ${it.goodsId ?? '—'}${it.price ? ` | 拼单价 ¥${it.price}` : ''} | 状态 ${it.status ?? '—'}`)
        if (it.images.length) {
          L.push(`     图片 ${it.images.length} 张:`)
          it.images.forEach((im, i) => L.push(`       ${i + 1}. ${im.origin}`))
        } else {
          L.push('     图片: 未取到')
        }
      }
      out.text = L.join('\n')
    } else {
      out.ok = false; out.failureKind = 'api_error'
      out.text = `本脚本只支持 --mode goods-images（推广商品图片）。\n其它模式请用 promo.mjs。`
      process.exitCode = 2
    }
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
