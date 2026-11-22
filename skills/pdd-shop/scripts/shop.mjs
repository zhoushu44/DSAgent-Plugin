import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

// ★ 路径推导（替代原硬编码绝对路径）：本文件在 skills/<name>/scripts/ 下，上推三层到插件根
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const PKG_BASE = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
].find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-script-base.json')
/**
 * 拼多多店铺经营数据（pdd-shop）—— 只读
 *
 * 数据源：生意参谋（mms.pinduoduo.com/sycm/*），接口统一 /sydney/api/* 前缀。
 * 全部 HTTP，无平台副作用。
 *
 * ★ 双通道（2026-10-23 新增纯 Node）：
 *   --transport http    纯 Node + 本地 anti-content 签名（默认，快 10 倍，不弹滑块）
 *                       实测通过：queryMallFlowData / queryGoodsPageOverviewForMms /
 *                                 queryFinalCredentialNew
 *   --transport browser 页面 hook（兜底，接口改版/签名失效时用）
 *
 * 能力：
 *   overview   店铺经营总览（流量 + 评分 + 商品数据 + 店铺等级）
 *   flow       店铺流量数据（访客 uv / 浏览量 pv / 粉丝 / 搜索指数）
 *   score      店铺评分（服务数据：退款率/发货/客服响应）
 *   goods      商品数据明细（每商品 访客/支付金额/支付订单/转化率/收藏）
 *
 * 用法：node scripts/shop.mjs --mode overview
 *       node scripts/shop.mjs --mode goods --transport browser
 */
const { CHROME_PATH, STEALTH_ARGS, STEALTH_SCRIPT } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))

const require = createRequire(PKG_BASE)

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const mode = argOf('mode') || 'overview'
const limit = Math.min(100, Math.max(1, parseInt(argOf('limit') || '20', 10) || 20))
// ★★ 2026-11-11：goods 模式默认改成 **http（t3 纯 Node 真签名）**。
//
//   原默认是 'browser'，理由是「http/t3 的 PUA 解码用**静态** PUA_MAP，
//   而码点是动态的 → goodsUv/goodsVcr 全解成空串或 0%」。
//
//   **这个理由已经过时**：t3 分支现在用的是 `buildPuaMap()` **动态推导**
//   （见下方 goods 分支注释「不再用静态表」），实测 PUA 覆盖 10/10、uv/pv 正确。
//
//   而 browser 通道有两个硬伤（实测 2026-11-11）：
//     ① **日期不受控** —— 页面自己决定查哪天，`--date` 完全不起作用
//     ② 走页面 hook 抓响应 → 拿到什么算什么，空列表被当成「没有数据」
//
//   t3 通道能真正控制 `startDate/endDate/queryType`。
//   需要 DOM 明文兜底时显式 `--transport browser`。
const TRANSPORT = argOf('transport') || 'http'

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/lib/services/credential-store.js')))
  const { checkCooldown, detectSlider, autoSolveSlider, fmtRemain, tryAcquireAccountLock, releaseAccountLock, heartbeatAccountLock, throttleRequest } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs')))
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  // ★ 2026-10-27 修：账号解析三级兜底
  //   ① --account 显式传入 shopKey（最准）
  //   ② --shop-name 按店铺名模糊匹配（多账号时避免 findByPlatform 选错号）
  //   ③ findByPlatform 兜底（单账号场景）
  const resolveShop = () => {
    const explicit = argOf('account')
    if (explicit) return explicit
    const all = store.listAccounts().filter(a => a.platform === 'pdd_mms')
    const wantName = (argOf('shop-name') || argOf('shopName') || '').trim()
    if (wantName && all.length) {
      const hit = all.find(a =>
        (a.display_label || '').includes(wantName) || wantName.includes(a.display_label || '')
        || (a.shop_key || '').includes(wantName))
      if (hit) return hit.shop_key
      // 没匹配到就报清楚，别静默选错号
      emit({
        ok: false, failureKind: 'need_account_choice',
        text: `未找到店铺名含「${wantName}」的拼多多商家后台账号。可用账号：\n`
          + all.map(a => `  · ${a.display_label}（${a.shop_key}）`).join('\n')
          + '\n请用 --account 指定 shopKey，或到「账号连接」页面绑定。',
        accounts: all.map(a => ({ shop_key: a.shop_key, label: a.display_label })),
      })
      process.exit(2)
    }
    return store.findByPlatform('pdd_mms')?.shop_key
  }
  const SHOP = resolveShop()
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号，请到「账号连接」添加。' }); process.exit(2) }

  // ★ 2026-11-04 迁移到统一风控闸门（pdd-guard）
  //   原实现是手写四件套（checkCooldown + tryAcquireAccountLock + heartbeat + release 钩子）。
  //   ⚠️ 闸门内部已持锁，**不要保留旧的 tryAcquireAccountLock**（会自己锁死自己）。
  const { openTask } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-guard.mjs')))
  // ★ 2026-11-05：接口路径统一从基座注册表取（PDD 升级只改 pdd-api.mjs）
  const { API: PDD_API } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-api.mjs')))
  const apiPath = (name) => {
    const s = PDD_API[name]
    if (!s) throw new Error(`注册表缺少接口: ${name}`)
    return s.path
  }
  const guard = await openTask('pdd-shop', SHOP, { lockWaitMs: 300_000 })
  if (guard.blocked) {
    emit({ ok: false, failureKind: 'rate_limit', text: `账号 ${SHOP} 当前不可执行：${guard.reason}。期间请勿重复调用。` })
    process.exit(2)
  }
  guard.startHeartbeat()
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })


  // ══════════════════════════════════════════════════════════════════════
  // ★★★ 纯 Node 通道（默认）★★★
  // 不启浏览器、不弹滑块，速度 ~200ms/请求
  // ══════════════════════════════════════════════════════════════════════
  if (TRANSPORT === 'http') {
    // ★ t1 通道：简化签名 + 凭证库 Cookie
    const { call: callT1, cookiesOf } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-http.mjs')))
    const R = 'https://mms.pinduoduo.com/sydney/api'

    // ── goods 模式：走 t3 通道（真签名 + webSpiderRule + CDP Cookie），不依赖凭证库 ──
    if (mode === 'goods') {
      // （pad/now/TODAY 已在下方统一声明，勿重复）
      const now = new Date()
      
      // ★★ 2026-11-11：**默认日期改昨天 + queryType 从 6 改 1**。
      //
      //   实测（同一个账号，只改一个变量）：
      //     queryType=6 + startDate=2026-11-09  → statDate=2026-11-11（今天的）
      //     queryType=1 + startDate=2026-11-09  → statDate=2026-11-09 ✅ 认日期
      //     queryType=2/3 + startDate=2026-11-09 → statDate=2026-11-09 ✅
      //     queryType=4 → 2000000（无权限）
      //     queryType=5/7 → 空
      //
      //   → **queryType=6 是「今日实时」语义，会忽略 startDate/endDate**。
      //     原代码用 6 + 日期=TODAY，等于永远查「今天」；
      //     而生意参谋当天不出数 → goodsDetailList 恒为 [] →
      //     被当成「没有数据」，其实是查错了口径。
      //   → 1 = 按日期查（本处采用），需要今日实时请显式 --query-type 6。
      const pad = (n) => String(n).padStart(2, '0')
      const _now2 = now
      const _y = new Date(now)
      _y.setDate(_y.getDate() - 1)
      const YESTERDAY = `${_y.getFullYear()}-${pad(_y.getMonth() + 1)}-${pad(_y.getDate())}`
      const dateArg = argOf('date') || YESTERDAY
      if (!argOf('date')) console.error(`[pdd-shop] goods 默认查昨天（${YESTERDAY}）：生意参谋当天不出数`)

      console.error('[pdd-shop] goods 优先走纯 Node 通道（免签名免浏览器）...')

      /**
       * ★★★ 2026-11-22：goods 改为「纯 Node 优先，CDP 拦截兜底」 ★★★
       *
       *   实测（本机，2026-11-22）：`/sydney/api/goodsDataShow/queryGoodsDetailVOList`
       *   （注意：**不带** ForMMS 后缀）**不需要任何签名，纯 Cookie 直连即可**：
       *
       *     · POST + 凭证库 Cookie → success:true，10 条商品，102 个字段
       *     · 连 goodsName 都有（ForMMS 版本要单独查名字）
       *     · errorCode 1000000 是伴随警告（部分附加字段缺），不影响主数据
       *
       *   而之前用的 ForMMS / V2ForMMS 两个接口都强制 crawlerInfo（绑定请求体），
       *   纯 Node 拿不到 → 3000000 非法请求。**选错了接口**，不是 Node 不能做。
       *
       *   分层策略：
       *     ① 纯 Node：queryGoodsDetailVOList + Cookie（快，2~5s，无浏览器依赖）
       *     ② 兜底：CDP 拦截页面自己发的请求（2026-11-20 方案，保留但仅在 ① 失败时用）
       */
      const nodeGoods = await (async () => {
        try {
          const acc = store.listAccounts().find(a => a.shop_key === SHOP)
          if (!acc?.cookies?.PASS_ID) return null
          const https = await import('node:https')
          const body = JSON.stringify({
            startDate: dateArg, endDate: dateArg,
            queryType: Number(argOf('query-type') || 1),
            sortCol: 0, sortType: 1, pageNum: 1, pageSize: limit, actVs: 1,
          })
          const ck = Object.entries(acc.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
          const txt = await new Promise((resolve) => {
            const q = https.request({
              hostname: 'mms.pinduoduo.com',
              path: '/sydney/api/goodsDataShow/queryGoodsDetailVOList',
              method: 'POST',
              headers: {
                'cookie': ck, 'content-type': 'application/json',
                'origin': 'https://mms.pinduoduo.com',
                'referer': 'https://mms.pinduoduo.com/sycm/goods_effect',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36',
                'content-length': Buffer.byteLength(body),
              },
            }, rs => { let d = ''; rs.on('data', c => d += c); rs.on('end', () => resolve(d)) })
            q.on('error', () => resolve(''))
            q.setTimeout(20000, () => { q.destroy(); resolve('') })
            q.write(body); q.end()
          })
          if (!txt) return null
          const j = JSON.parse(txt)
          const list = j?.result?.goodsDetailList
          if (!Array.isArray(list) || !list.length) return null
          console.error(`[pdd-shop] goods 纯 Node 通道成功：${list.length} 条（${(list[0]?.statDate) || dateArg}），无需浏览器`)
          return { ok: true, json: j, signature: { type: 'node-cookie', len: 0 }, via: 'node' }
        } catch (e) {
          console.error(`[pdd-shop] goods 纯 Node 失败（${String(e.message).slice(0, 60)}），回落 CDP 拦截`)
          return null
        }
      })()

      let r = nodeGoods

      // ── 兜底：CDP 拦截页面自己发的 V2 请求（2026-11-20 方案）──
      let sess = null
      let buildPuaMap = null, decodePua = null

      if (!r) {
      console.error('[pdd-shop] goods 回落 CDP 拦截通道（真签名 + webSpiderRule + CDP Cookie）...')
      const { call: callT3, createSession } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-client.mjs')))
      // ★ 2026-10-27 修：用 buildPuaMap 动态推导映射，不再用静态表
      //   （静态表码点已过期，会把 goodsUv/goodsVcr 解成空串或 0%）
      const puaMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risksdk.mjs')))
      buildPuaMap = puaMod.buildPuaMap
      decodePua = puaMod.decodePua

      try {
        sess = await createSession(SHOP)
        /**
         * ★★★ 2026-11-20 最终方案：拦截页面自己发出的 V2 请求 ★★★
         *
         *   这一版是踩了一整天坑之后的定论，前面所有方案都被证伪：
         *
         *   ① 手工 new 签名器（eDaA）—— 平台改了 webpack 模块名，已失效；
         *     即使模块在，拿到的签名也**绑定请求体**，换接口就 3000000。
         *   ② CDP 抓 anti-content 复用到别的请求 —— 同样因签名绑定 body 而失败。
         *   ③ 页面内 fetch 发请求 —— 签名头在更底层注入，JS 层拿不到，3000000。
         *   ④ 旧接口 queryGoodsDetailVOListForMMS —— **平台已下线**，
         *     现行接口是 queryGoodsDetailVOListV2ForMMS，且必须带 crawlerInfo
         *     （crawlerInfo 同样绑定本次请求，复用无效）。
         *
         *   唯一可行的路：**让页面自己发**（它的签名和 body 天然匹配），
         *   我们用 CDP Fetch 域**拦截并读取它的响应体**，完全不构造请求。
         *
         *   实现要点：
         *     · 必须用 Fetch.enable 的 requestStage: 'Response'，才能拿到响应体
         *     · 拦截后必须 continueRequest，否则页面会卡住
         *     · 页面进入商品效果页会自动发这个请求（无需手动触发）
         *
         *   代价：要等页面渲染（约 25s），换来的是**稳定可用**，
         *   且平台再怎么改模块名都不影响这条链路。
         */
        const goodsApiPattern = '*queryGoodsDetailVO*'
        const cdpFetch = await sess.page.target().createCDPSession()
        await cdpFetch.send('Fetch.enable', {
          patterns: [{ urlPattern: goodsApiPattern, requestStage: 'Response' }],
        })

        /** 收集到的商品明细响应（可能多页，取第一页） */
        const capturedBodies = []
        cdpFetch.on('Fetch.requestPaused', async (e) => {
          try {
            const b = await cdpFetch.send('Fetch.getResponseBody', { requestId: e.requestId })
            const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body
            capturedBodies.push(txt)
          } catch { /* 响应体读取失败，忽略这一条 */ }
          try { await cdpFetch.send('Fetch.continueRequest', { requestId: e.requestId }) } catch { /* ignore */ }
        })

        await sess.goto('https://mms.pinduoduo.com/sycm/goods_effect', 20000)

        // 等页面自己发出请求（页面渲染 + 请求往返）
        const waitStart = Date.now()
        while (!capturedBodies.length && Date.now() - waitStart < 30000) {
          await new Promise(res => setTimeout(res, 500))
        }
        try { await cdpFetch.send('Fetch.disable') } catch { /* ignore */ }
        try { await cdpFetch.detach() } catch { /* ignore */ }

        // 用拦截到的响应替代原来的 callT3（★ 直接赋外层 r，不要重新声明）
        if (capturedBodies.length) {
          let parsed = null
          for (const t of capturedBodies) {
            try {
              const j = JSON.parse(t)
              if (j?.result?.goodsDetailList?.length) { parsed = j; break }
            } catch { /* 非 JSON，跳过 */ }
          }
          r = parsed
            ? { ok: true, json: parsed, signature: { type: 'cdp-intercept', len: 0 }, via: 'page-intercept' }
            : { ok: false, kind: 'signature_error', hint: '截获到响应但无商品数据' }
        } else {
          r = { ok: false, kind: 'login_required', hint: '页面未发出商品明细请求（可能未登录或页面未渲染完成）' }
        }

        if (!r.ok) {
          // ★ 错误码分级 + 账号健康分（2026-10-24 补）：t3 通道最容易踩 54001
          const { checkCooldown, fmtRemain } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs'))).catch(() => ({}))
          const { normalizeWithCooldown, recordToAntiban } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
          const n = normalizeWithCooldown(r, '商品明细取数（CDP 兜底通道）', SHOP, { checkCooldown, fmtRemain })
          await recordToAntiban(SHOP, r.ec, r.kind).catch(() => {})
          emit({
            ok: false, mode, transport: 't3', shopKey: SHOP,
            failureKind: n.failureKind, ec: n.ec,
            text: n.text,
          })
          process.exit(2)
        }

        const rawList = r.json.result?.goodsDetailList || []

        // ★★ 2026-11-11：**空列表不能当成功**。
        //
        //   故障现场：goodsDetailList 返回 [] 时，下面照常构造 items=[]、
        //   输出 ok:true「商品数据明细（0 个）」—— 把「接口没给数据」伪装成
        //   「这家店真的没有商品数据」，用户看到的是正常结果，实际啥也没拿到。
        //
        //   空列表的三种真实原因（必须区分，处置完全不同）：
        //     ① 该日确实无数据（比如选的是今天、数据还没生成）→ 换日期
        //     ② result 结构变了 / PUA 字段全解不出来        → 接口变更，要修代码
        //     ③ 被风控静默降级（返回 200 但结果被清空）      → 停手，别重试
        //
        //   这里统一报错并给出可执行建议，绝不返回假成功。
        if (!rawList.length) {
          const hasResult = r.json && typeof r.json === 'object' && 'result' in r.json
          emit({
            ok: false, mode, transport: 't3', shopKey: SHOP, date: dateArg,
            failureKind: hasResult ? 'empty_result' : 'api_error',
            ec: r.json?.error_code ?? null,
            suggestion: [
              `① 换日期：--date 前一天（今日数据通常未生成）`,
              `② 若连续多日都空 → 接口结构可能变更，需核对 goodsDetailList 字段`,
              `③ 若伴随 54001/40002 → 账号被风控，停手等待，别连续重试`,
            ],
            text: [
              `商品明细返回**空列表**（goodsDetailList: []），这不是「没有数据」，是没取到。`,
              `  日期：${dateArg}  接口：${'/sydney/api/goodsDataShow/queryGoodsDetailVOList'}`,
              `  原始返回：${JSON.stringify(r.json).slice(0, 240)}`,
              ``,
              `可能原因与处置：`,
              `  ① 该日期确实无数据（尤其选「今天」时，平台通常次日才生成）`,
              `     → 试 --date ${(() => { const d = new Date(dateArg); d.setDate(d.getDate() - 1); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()}`,
              `  ② 接口结构变更（goodsDetailList 字段名/层级变了）→ 需修代码`,
              `  ③ 被风控静默降级（200 但结果被清空）→ 停手，等冷却，别重试`,
            ].join('\n'),
          })
          process.exit(2)
        }
        // ★ 2026-10-27 修：先用整表动态推导 PUA 映射，再逐字段解码
        // ★ 2026-11-22：纯 Node 通道返回的是明文（无 PUA），buildPuaMap 可能为 null → 安全降级
        const pua = buildPuaMap ? buildPuaMap(rawList) : { map: {}, coverage: { total: 0, agreed: 0 }, conflicts: [] }
        const dec = (v) => {
          if (typeof v !== 'string') return v
          const cp = v.codePointAt(0)
          if (cp < 0xE000 || cp > 0xF8FF) return v
          return decodePua ? decodePua(v, pua.map) : v
        }
        if (pua.coverage.total > 0) {
          console.error(`[pdd-shop] PUA 映射动态推导：${pua.coverage.agreed}/${pua.coverage.total} 码点`
            + (pua.conflicts.length ? `，${pua.conflicts.length} 个码点有冲突票` : ''))
        }

        // ★★ 2026-11-19 修：prev 字段语义错误 ★★
        //
        //   原实现把 <X>Ppr 直接当作「上期值」展示并参与合计，导致：
        //     · 输出里出现 6.6133 / -0.8625 / 305.08% 这种值 —— 它们不是访客数，
        //       而是**环比百分比**（Ppr = Percent，不是 Previous）；
        //     · 「合计：访客 167.45」把百分比加起来了，客单价算成 ¥1，全是垃圾数；
        //     · 更糟的是第 313 行「今日数据未生成 → 已自动改用上期值」会让
        //       这批假数字冒充真实数据，用户完全看不出来。
        //
        //   证据：同文件第 798 行早就注明「Ppr 明文字段；部分账号返回的是当前值
        //   而非差值，仅作参考不用于算环比」，risksdk 注释也说明 Ppr 仅用于
        //   PUA 逐字符对齐推导映射。两处都写着「不要当数值用」，
        //   但 253-263 行还是在用。
        //
        //   修法：不再用 Ppr 当上期值。上期值改从 <X>Ytd 之类的明文字段取（若有），
        //   取不到就明确标记为 unknown，宁可不显示也不显示错的。
        const prevOf = (g, key) => {
          // Ytd = 同期对比/累计明文值；只有确实存在且是数值时才用
          const v = g?.[key + 'Ytd']
          if (v === undefined || v === null || v === '') return null
          const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''))
          return Number.isFinite(n) ? n : null
        }
        const items = rawList.map(g => ({
          goodsId: g.goodsId,
          name: g.goodsName,
          date: g.statDate,
          cur: {
            uv: dec(g.goodsUv), pv: dec(g.goodsPv),
            payAmt: dec(g.payOrdrAmt), payCnt: dec(g.payOrdrCnt),
            payUsers: dec(g.payOrdrUsrCnt), payQty: dec(g.payOrdrGoodsQty),
            vcr: dec(g.goodsVcr), fav: dec(g.goodsFavCnt),
            imprUsrCnt: dec(g.imprUsrCnt), cnsltUsrQty: dec(g.cnsltUsrQty),
          },
          // 上期值：仅取真实明文字段，取不到就是 null（不拿百分比冒充）
          prev: {
            uv: prevOf(g, 'goodsUv'), pv: prevOf(g, 'goodsPv'),
            payAmt: prevOf(g, 'payOrdrAmt'), payCnt: prevOf(g, 'payOrdrCnt'),
            payUsers: prevOf(g, 'payOrdrUsrCnt'), payQty: prevOf(g, 'payOrdrGoodsQty'),
            vcr: prevOf(g, 'goodsVcr'), fav: prevOf(g, 'goodsFavCnt'),
            imprUsrCnt: prevOf(g, 'imprUsrCnt'), cnsltUsrQty: prevOf(g, 'cnsltUsrQty'),
          },
          // 环比百分比单独存放（Ppr 的正确用途），仅供展示，绝不参与求和
          ppr: {
            uv: g.goodsUvPpr, pv: g.goodsPvPpr,
            payAmt: g.payOrdrAmtPpr, payCnt: g.payOrdrCntPpr,
            vcr: g.goodsVcrPpr, fav: g.goodsFavCntPpr,
          },
          cate: [g.cate1Id, g.cate2Id, g.cate3Id].filter(Boolean),
          status: g.goodsStatus,
          // ★ 2026-10-27 补：行业对比字段（三级类目基准）
          //   cate3AvgGoodsVcr = 三级类目平均转化率（本店判「高于行业均值」的基准）
          //   cate3IsPgvAbove = 平台标记是否高于同级类目（综合算法，非纯转化率）
          industry: {
            cate3AvgVcr: dec(g.cate3AvgGoodsVcr),
            cate3PctVcr: dec(g.cate3PctGoodsVcr),
            isAboveFlag: g.cate3IsPgvAbove,
            vcrRised: g.goodsVcrRised,
          },
        }))

        // ★ 合计只用「当前值」。以前用 prev 求和，等于把环比百分比加起来。
        //   当前值缺失的项跳过（不当作 0，避免把均值拉低）。
        const num = (v) => {
          if (v === null || v === undefined || v === '') return null
          const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, ''))
          return Number.isFinite(n) ? n : null
        }
        const tot = items.reduce((s, x) => {
          const uv = num(x.cur.uv); const pv = num(x.cur.pv)
          const amt = num(x.cur.payAmt); const cnt = num(x.cur.payCnt)
          return {
            uv: s.uv + (uv ?? 0), pv: s.pv + (pv ?? 0),
            payAmt: s.payAmt + (amt ?? 0), payCnt: s.payCnt + (cnt ?? 0),
            nUv: s.nUv + (uv != null ? 1 : 0),
          }
        }, { uv: 0, pv: 0, payAmt: 0, payCnt: 0, nUv: 0 })

        const out = {
          ok: true, mode, transport: 't3', shopKey: SHOP,
          // ★ 2026-11-20：date 用数据的 statDate，不用 dateArg。
          //   CDP 拦截拿的是页面自己发的请求（默认 queryType=6 今日实时），
          //   写 dateArg 会与实际数据日期不符（标题显示 11-20、字段却是 11-19）。
          date: items[0]?.date || dateArg,
          goods: items,
          totals: {
            ...tot, payAmt: +tot.payAmt.toFixed(2),
            vcr: tot.uv > 0 ? +(tot.payCnt / tot.uv * 100).toFixed(2) : null,
            aov: tot.payCnt > 0 ? +(tot.payAmt / tot.payCnt).toFixed(2) : null,
          },
          signature: r.signature,
          spiderRule: sess.spiderRule ? `${sess.spiderRule.length} 字符` : 'missing',
        }

        const L = []
        // ★ 2026-11-20：标题日期用实际数据的 statDate，不用 dateArg。
        //   CDP 拦截方案拿到的是页面自己发的请求（页面默认 queryType=6 = 今日实时），
        //   不受 --date 控制。写 dateArg 会让人误以为查的是昨天。
        const dataDate = items[0]?.date || dateArg
        L.push(`商品数据明细（${items.length} 个，数据日期 ${dataDate}，CDP 拦截通道）`)
        L.push(`签名: ${r.signature?.type} ${r.signature?.len} 字符 | webSpiderRule: ${out.spiderRule}`)
        L.push('')
        // ★ 2026-11-19：表格改为展示**当前值**并附环比。
        //   原来展示的是「上期值」，而 Ppr 字段其实是环比百分比 →
        //   整张表都是 6.6133 / 305.08% 这种无意义数字。
        L.push('  商品                          访客   浏览      支付   订单  转化率   环比(访客)')
        for (const x of items.slice(0, 20)) {
          const c = x.cur
          const pprUv = (() => {
            const v = x.ppr?.uv
            if (v === null || v === undefined || v === '') return '—'
            const n = Number(String(v).replace(/[^\d.\-]/g, ''))
            if (!Number.isFinite(n)) return '—'
            // Ppr 有 0~1 小数与百分数两种口径，统一按百分比显示
            const pct = Math.abs(n) <= 3 ? n * 100 : n
            return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
          })()
          L.push(`  ${String(x.name || '').slice(0, 26).padEnd(30)}`
            + `${String(c.uv ?? '—').padStart(6)}`
            + `${String(c.pv ?? '—').padStart(6)}`
            + `${String(c.payAmt ?? '—').padStart(10)}`
            + `${String(c.payCnt ?? '—').padStart(6)}`
            + `${String(c.vcr ?? '—').padStart(8)}`
            + `${pprUv.padStart(11)}`)
        }
        L.push('')
        L.push(`合计：访客 ${out.totals.uv} / 浏览 ${out.totals.pv} / 支付 ¥${out.totals.payAmt} / 订单 ${out.totals.payCnt}`)
        L.push(`      转化率 ${out.totals.vcr}% / 客单价 ¥${out.totals.aov}`)

        // ★ 2026-11-19：删掉「当前值字段为空 → 已自动改用上期值」这段。
        //   prev 已不再是 Ppr 百分比，继续这么提示会把假数据说成真数据。
        //   当前值为空时如实说明即可。
        const hasCur = items.some(x => x.cur.uv && x.cur.uv !== '0')
        if (!hasCur) {
          L.push('')
          L.push('ℹ️ 该日期当前值为空（数据可能尚未生成），请换一个更早的日期重试')
        }

        // ★ 2026-10-27 补：行业均值对比段
        //   判据：本店转化率数值 > 三级类目平均转化率（cate3AvgGoodsVcr）
        const n = (v) => { const s = String(v ?? '').replace(/[^\d.\-]/g, ''); return s === '' ? null : Number(s) }
        const withInd = items.filter(x => x.industry?.cate3AvgVcr != null)
        const avgSample = withInd.map(x => n(x.industry.cate3AvgVcr)).filter(v => v != null)
        const avgVcr = avgSample.length ? Math.max(...avgSample) : null
        // ★ 2026-11-19：prev 现在是「真实上期值或 null」，不再含 vcrCalc 等派生假值
        const curVcr = (x) => n(x.cur.vcr) ?? n(x.prev.vcr) ?? null
        const above = withInd.filter(x => { const v = curVcr(x); return v != null && avgVcr != null && v > avgVcr })
        if (avgVcr != null) {
          L.push('')
          L.push(`★ 行业均值对比（三级类目平均转化率 ${avgVcr}%）：`)
          if (above.length) {
            for (const x of above.sort((a, b) => curVcr(b) - curVcr(a))) {
              const v = curVcr(x)
              const lead = avgVcr > 0 ? ((v / avgVcr - 1) * 100).toFixed(0) : '?'
              L.push(`  [${x.goodsId}] ${String(x.name || '').slice(0, 26)}｜转化率 ${v}%｜高出 ${lead}%`
                + `｜访客 ${x.cur.uv ?? x.prev.uv ?? '—'}｜订单 ${x.cur.payCnt ?? x.prev.payCnt ?? '—'}`
                + `｜金额 ¥${x.cur.payAmt ?? x.prev.payAmt ?? '—'}`
                + (x.industry.isAboveFlag === 1 ? '｜平台标记:高于同级' : ''))
            }
            L.push(`  → 共 ${above.length} 个宝贝转化率高于行业均值`)
          } else {
            L.push('  （无转化率高于行业均值的宝贝）')
          }
          const flagOnly = withInd.filter(x => x.industry.isAboveFlag === 1 && !above.includes(x))
          if (flagOnly.length) {
            L.push('')
            L.push(`ℹ️ 另有 ${flagOnly.length} 个被平台标记「高于同级类目」但转化率数值未超均值`
              + '（该标记为综合算法，含成交额/UV 等多维，非纯转化率比对）：')
            for (const x of flagOnly) {
              L.push(`    [${x.goodsId}] ${String(x.name || '').slice(0, 24)}｜转化率 ${curVcr(x) ?? '—'}%｜均值 ${avgVcr}%`)
            }
          }
        }
        out.text = L.join('\n')

        // ★ 趋势分析（--trend 或默认附加）
        try {
          const { analyze, report } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-trend.mjs')))
          const trend = analyze(rawList)
          out.trend = trend
          out.text += '\n\n' + report(trend)
          fs.mkdirSync(path.join(process.cwd(), 'artifacts', 'pdd-re'), { recursive: true })
          fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-re', 'trend.json'), JSON.stringify(trend, null, 1), 'utf8')
          fs.writeFileSync(path.join(process.cwd(), 'artifacts', 'pdd-re', 'goods-final.json'), JSON.stringify(rawList, null, 1), 'utf8')
        } catch (e) {
          console.error('[pdd-shop] 趋势分析失败: ' + e.message.slice(0, 80))
        }

        emit(out)
        process.exit(0)
      } catch (e) {
        emit({ ok: false, mode, transport: 't3', failureKind: 'exception', text: `商品明细取数异常：${e.message?.slice(0, 200)}` })
        process.exit(2)
      } finally {
        if (sess) await sess.close()
      }
      } // if (!r) CDP 兜底块闭合

      /**
       * ★ 2026-11-22：纯 Node 通道的独立输出（走到这里 = nodeGoods 成功且 CDP 块被整体跳过）。
       *   Node 接口返回明文（无 PUA），且自带 goodsName / statDate / 102 个字段，
       *   直接组装输出，不需要 PUA 解码那一套。
       */
      {
        // ★ 防御：r.ok 为假绝不该走到这里（nodeGoods 内部已校验非空才返回真值），
        //   但「接口失败被当 0 条」是闸门检查器重点盯的假成功模式 —— 显式拦截，宁可多一层。
        const rawList = (r?.ok && Array.isArray(r.json?.result?.goodsDetailList)) ? r.json.result.goodsDetailList : []
        if (!rawList.length) {
          emit({ ok: false, mode, transport: 'node', shopKey: SHOP, date: dateArg, failureKind: 'empty_result', text: `商品明细未取到数据（node 通道返回空，日期 ${dateArg}）。今日数据通常未生成，试 --date 前一天。` })
          process.exit(2)
        }
        const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null }
        const items = rawList.map(g => ({
          goodsId: g.goodsId,
          name: g.goodsName,
          date: g.statDate,
          cur: {
            uv: num(g.goodsUv), pv: num(g.goodsPv),
            payAmt: num(g.payOrdrAmt), payCnt: num(g.payOrdrCnt),
            payUsers: num(g.payOrdrUsrCnt), payQty: num(g.payOrdrGoodsQty),
            vcr: typeof g.goodsVcr === 'number' ? g.goodsVcr.toFixed(2) + '%' : g.goodsVcr,
            fav: num(g.goodsFavCnt), imprUsrCnt: num(g.imprUsrCnt), cnsltUsrQty: num(g.cnsltUsrQty),
          },
          ppr: { uv: g.goodsUvPpr, pv: g.goodsPvPpr, payAmt: g.payOrdrAmtPpr, payCnt: g.payOrdrCntPpr, vcr: g.goodsVcrPpr, fav: g.goodsFavCntPpr },
          cate: [g.cate1Id, g.cate2Id, g.cate3Id].filter(Boolean),
          status: g.goodsStatus,
          industry: { cate3AvgVcr: g.cate3AvgGoodsVcr, cate3PctVcr: g.cate3PctGoodsVcr, isAboveFlag: g.cate3IsPgvAbove, vcrRised: g.goodsVcrRised },
        }))
        const tot = items.reduce((s, x) => ({
          uv: s.uv + (x.cur.uv ?? 0), pv: s.pv + (x.cur.pv ?? 0),
          payAmt: s.payAmt + (x.cur.payAmt ?? 0), payCnt: s.payCnt + (x.cur.payCnt ?? 0),
        }), { uv: 0, pv: 0, payAmt: 0, payCnt: 0 })

        const L = []
        L.push(`商品数据明细（${items.length} 个，数据日期 ${items[0]?.date || dateArg}，纯 Node 通道免签名）`)
        L.push('')
        L.push('  商品ID                        访客   浏览      支付   订单  转化率   收藏')
        for (const x of items.slice(0, 20)) {
          const pprUv = (() => { const v = x.ppr?.uv; if (v === null || v === undefined) return '—'; const n = Number(v); if (!Number.isFinite(n)) return '—'; const pct = Math.abs(n) <= 3 ? n * 100 : n; return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' })()
          L.push(`  ${String(x.goodsId).padEnd(14)} ${String(x.cur.uv ?? '—').padStart(6)} ${String(x.cur.pv ?? '—').padStart(6)}`
            + ` ${String(x.cur.payAmt != null ? '¥' + x.cur.payAmt.toFixed(2) : '—').padStart(9)} ${String(x.cur.payCnt ?? '—').padStart(5)}`
            + ` ${String(x.cur.vcr ?? '—').padStart(7)} ${String(x.cur.fav ?? '—').padStart(5)} ${pprUv.padStart(8)}`)
        }
        L.push('')
        L.push(`合计：访客 ${tot.uv} / 浏览 ${tot.pv} / 支付 ¥${tot.payAmt.toFixed(2)} / 订单 ${tot.payCnt}`)
        L.push(`      转化率 ${tot.uv > 0 ? (tot.payCnt / tot.uv * 100).toFixed(2) : '—'}% / 客单价 ¥${tot.payCnt > 0 ? (tot.payAmt / tot.payCnt).toFixed(2) : '—'}`)

        emit({
          ok: true, mode, transport: 'node', shopKey: SHOP,
          date: items[0]?.date || dateArg,
          goods: items,
          totals: { ...tot, payAmt: +tot.payAmt.toFixed(2), vcr: tot.uv > 0 ? +(tot.payCnt / tot.uv * 100).toFixed(2) : null, aov: tot.payCnt > 0 ? +(tot.payAmt / tot.payCnt).toFixed(2) : null },
          signature: { type: 'cookie-only', len: 0 },
          text: L.join('\n'),
        })
        process.exit(0)
      }
    }

    // ── 其他模式：t1 通道 ──
    /**
     * ★★ 2026-11-19 修：账号解析用错了 API ★★
     *
     *   原写法：
     *     store.findByPlatform('pdd_mms', SHOP)
     *
     *   `findByPlatform(platform, agentId?)` 的第二个参数是 **agentId**，不是 shopKey。
     *   把 shopKey 当 agentId 传进去 → 过滤 `bound_agent_ids.includes(shopKey)` → 必然为空
     *   → 返回 null → 后面 `if (!acc?.cookies?.['PASS_ID'])` 判定失败，
     *   或者 fallback 到「浏览器 Profile 的旧 Cookie」，于是出现：
     *
     *     [pdd-shop] 凭证库 Cookie 过期，已切换浏览器 Cookie 重试
     *     → 仍然 session_expired 43001
     *
     *   而同一个账号的凭证库 Cookie 其实是**好的**（实测 legacyFlow/Overview/Score 全通）。
     *   这就是「明明重新扫码登录了，技能还是说 Cookie 过期」的真正原因。
     *
     *   正确写法：先按 shop_key 精确取，取不到再退化为同平台第一个。
     */
    const acc = store.listAccounts().find(a => a.shop_key === SHOP)
      || store.findByPlatform('pdd_mms')
    if (!acc?.cookies?.['PASS_ID']) {
      emit({ ok: false, failureKind: 'token_expired', text: '账号缺少 PASS_ID，请到「账号连接」重新登录拼多多商家后台。' })
      process.exit(2)
    }
    let COOKIES = cookiesOf(acc)

    /** 统一调用 + 错误归一（★ 2026-10-24 改用共享 pdd-error） */
    const { normalize } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-error.mjs')))
    // ★ 2026-10-24：43001 时用浏览器 Profile 的 Cookie 兜底
    //   凭证库快照可能是几天前的旧票，而 Profile 里的是新的（Chrome 自己刷新/用户刚登录）
    let browserCookies = null
    async function freshCookiesFromBrowser() {
      if (browserCookies) return browserCookies
      // ★ 遍历所有候选 profile 目录（shopKey 自己的可能是过期票，
      //   display_label 对应的才是有效的）
      const { profileCandidates } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-launch.mjs')))
      const cands = profileCandidates(SHOP)
      for (const dir of cands) {
        try {
          const { createSession } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-client.mjs')))
          const s = await createSession(dir)
          await s.goto('https://mms.pinduoduo.com/home', 10000)
          const c = await s.cookieStr()
          await s.close()
          if (c.map['PASS_ID']) {
            // 直接试一次，通了才算
            const test = await callT1({
              shopKey: SHOP, cookies: c.str,
              url: 'https://mms.pinduoduo.com' + apiPath('shop.legacyFlow'), body: {},
              referer: 'https://mms.pinduoduo.com/sycm/evaluation',
            })
            if (test.ok) { browserCookies = c.str; return browserCookies }
          }
        } catch { /* 试下一个 */ }
      }
      return null
    }

    const get = async (url, body, referer) => {
      // ★ 2026-11-08：Node 优先
      //   有凭证库 Cookie + 种子 → 先走 pdd-request 纯 Node（0.06~0.5s）
      //   失败 → 自动降级到原来的 callT1（简化签名）
      //   实测：店铺信息/流量/评分/商品概览 四个接口全部可纯 Node
      try {
        const { request: nodeReq } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-request.mjs')).href)
        const accObj = store.listAccounts().find(a => a.shop_key === SHOP)
        if (accObj?.cookies) {
          const seedFile = path.join(homedir(), '.dsh', 'pdd-risk-seeds', String(SHOP).replace(/[^\w.-]/g, '_') + '.json')
          let ls = {}
          if (fs.existsSync(seedFile)) ls = JSON.parse(fs.readFileSync(seedFile, 'utf8')).localStorage || {}
          if (Object.keys(ls).length) {
            const nr = await nodeReq(url, body, {
              account: { cookies: accObj.cookies, localStorage: ls },
              shopKey: SHOP,
              method: /commonMallInfo/.test(url) ? 'GET' : 'POST',
              extraHeaders: referer ? { referer } : undefined,
            })
            if (nr.ok) return { ok: true, data: nr.data }
            console.error(`[pdd-shop] Node 失败 ec=${nr.ec}，降级 callT1`)
          }
        }
      } catch (e) {
        console.error(`[pdd-shop] Node 通道异常，降级 callT1：${String(e.message).slice(0, 60)}`)
      }

      // ★ 2026-11-04：节流统一走闸门 beforeCall（账号级时间槽，落盘跨进程）。
      const pre = await guard.beforeCall(url)
      if (!pre.allow) throw Object.assign(new Error(`账号不可用：${pre.reason}`), { __blocked: true })
      let r = await callT1({ shopKey: SHOP, cookies: COOKIES, url, body, referer })
      // ★ 2026-10-25：只有**真的** session_expired（body 43001 且 http 200）才切 Cookie。
      //   HTTP 430 是网关级频率惩罚，切 Cookie 没用，pdd-http 内部已重试。
      if (!r.ok && r.kind === 'session_expired' && r.http !== 430) {
        const fresh = await freshCookiesFromBrowser()
        if (fresh) {
          COOKIES = fresh
          console.error('[pdd-shop] 凭证库 Cookie 过期，已切换浏览器 Cookie 重试')
          r = await callT1({ shopKey: SHOP, cookies: COOKIES, url, body, referer })
        }
      }
      if (!r.ok) return { ok: false, ...normalize(r, '接口调用'), err: r }
      return { ok: true, data: r.json.result }
    }

    const out = { ok: true, mode, transport: 'http', shopKey: SHOP }

    // ── flow ──
    // ★ 2026-10-25 注：queryMallScoreOverView 报的 43001 实为 **HTTP 430 网关级
    //   频率惩罚**（edge 层限流），不是会话过期。已在 pdd-http.mjs 分开处理：
    //   HTTP 430 → rate_limit + 15s/30s 退避；body 43001 → session_expired。
    const flowR = await get('https://mms.pinduoduo.com' + apiPath('shop.legacyFlow'), {}, 'https://mms.pinduoduo.com/sycm/evaluation')
    if (flowR.ok) out.flow = {
      uv: flowR.data.uv, pv: flowR.data.pv, fans: flowR.data.totalFansCnt,
      srchIndex: flowR.data.srchIndex, orderIndex: flowR.data.orderIndex,
      uvPct: flowR.data.uvPct, pvPct: flowR.data.pvPct,
    }

    // ── goodsOverview（今日/昨日）──
    const ovR = await get('https://mms.pinduoduo.com' + apiPath('shop.legacyGoodsOverview'), {}, 'https://mms.pinduoduo.com/sycm/goods_effect')
    if (ovR.ok) out.goodsOverview = { today: ovR.data.todayData, yesterday: ovR.data.yesterdayData }

    // ── score ──
    let scR = null
    if (mode === 'score' || mode === 'overview') {
      scR = await get('https://mms.pinduoduo.com' + apiPath('shop.legacyScore'), {}, 'https://mms.pinduoduo.com/sycm/evaluation')
      // ★ 2026-10-27 修：http 通道漏了把 scR 解析成 out.score。
      //   请求发了、错误也判了（下方 flowR.err || scR?.err），但成功的 scR
      //   从未赋值给 out.score → 下方 `if (out.score && ...)` 恒为 false
      //   → score 模式必然报「取数失败：unknown」，尽管接口其实返回了完整数据。
      //   （browser 通道在 L758 有赋值，只有 http 通道漏了。）
      //   实测结构：result.{serviceDataVO, dealDataVO, goodsDataVO}，
      //   与 L398-414 的解析代码完全对应。
      if (scR?.ok && scR.data) out.score = scR.data
    }

    // ── 汇总文本（★ 2026-10-24 修：按 mode 只输出对应数据，
    //    之前 score 模式也显示 flow 的内容）──
    const lines = []
    if (out.flow && (mode === 'flow' || mode === 'overview')) {
      lines.push(`店铺流量：访客 ${out.flow.uv} / 浏览 ${out.flow.pv} / 粉丝 ${out.flow.fans} / 搜索指数 ${out.flow.srchIndex}`)
    }
    if (out.goodsOverview?.today && (mode === 'overview' || mode === 'goods')) {
      const t = out.goodsOverview.today
      lines.push(`今日：支付 ¥${t.payOrdrAmt} / ${t.payOrdrCnt} 单 / ${t.guv} 访客 / ${t.gpv} 浏览 / 支付转化 ${t.payUvRto}`)
    }
    if (out.goodsOverview?.yesterday && (mode === 'overview' || mode === 'goods')) {
      const y = out.goodsOverview.yesterday
      lines.push(`昨日：支付 ¥${y.payOrdrAmt} / ${y.payOrdrCnt} 单 / ${y.guv} 访客 / ${y.gpv} 浏览`)
    }
    if (out.score && (mode === 'score' || mode === 'overview')) {
      // ★ 2026-10-25：字段结构实测确认（不是 mallScore/serveScore）
      //   result.serviceDataVO  服务数据：处理时长/平台介入率/退款率
      //   result.dealDataVO     成交数据：成交额/订单数/转化
      //   后缀含义：1m=近1月 1d=近1日，Pct=环比，IsPercent=是否百分比
      const s = out.score
      const svc = s.serviceDataVO || {}
      const deal = s.dealDataVO || {}
      const parts = []
      if (svc.rfRto1m != null) parts.push(`退款率 ${svc.rfRto1m}`)
      if (svc.pltInvlRto1m != null) parts.push(`平台介入率 ${svc.pltInvlRto1m}`)
      if (svc.avgSucRfProcTime1m != null) parts.push(`平均退款处理 ${svc.avgSucRfProcTime1m}`)
      if (parts.length) lines.push(`服务：${parts.join(' / ')}`)
      const dparts = []
      if (deal.sucRfOrdrAmt1d != null) dparts.push(`昨日成交 ¥${deal.sucRfOrdrAmt1d}`)
      if (deal.sucRfOrdrCnt1d != null) dparts.push(`${deal.sucRfOrdrCnt1d} 单`)
      if (deal.cfmOrdrCnt1d != null) dparts.push(`发货 ${deal.cfmOrdrCnt1d} 单`)
      if (dparts.length) lines.push(`成交：${dparts.join(' / ')}`)
      // 顶层可能还有 mallScore 等（不同账号返回不同）
      const top = []
      for (const k of ['mallScore', 'serveScore', 'logisticsScore', 'goodsScore']) {
        if (s[k] != null) top.push(`${k} ${s[k]}`)
      }
      if (top.length) lines.push(`评分：${top.join(' / ')}`)
      // 兜底：结构又变了就把数字字段打出来
      if (!parts.length && !dparts.length && !top.length) {
        const nums = Object.entries(s).filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d.]+%?$/.test(v))).slice(0, 12)
        if (nums.length) lines.push(nums.map(([k, v]) => `${k} ${v}`).join(' / '))
        else lines.push(`返回结构：${Object.keys(s).join(', ') || '(空)'}`)
      }
    }
    if (!lines.length) {
      const e = flowR.err || scR?.err || {}
      out.ok = false
      out.failureKind = (flowR.kind || scR?.kind || 'api_error')
      out.text = [
        `取数失败：${e.kind || 'unknown'} ${e.ec ?? ''}`,
        e.msg || e.hint || '',
        '',
        mode === 'flow' ? 'flow 模式需要 queryMallFlowData 接口返回数据。' : '',
        mode === 'score' ? 'score 模式需要 queryMallScoreOverView 接口返回数据。' : '',
        '可重试；若持续失败，到「账号连接」重新扫码登录。',
      ].filter(Boolean).join('\n')
    } else {
      out.text = `【纯 Node·${mode}】\n` + lines.join('\n')
    }
    emit(out)
    process.exit(out.ok ? 0 : 2)
  }

  // ══════════════════════════════════════════════════════════════════════
  // 浏览器通道（兜底）
  // ══════════════════════════════════════════════════════════════════════
  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) {
    profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')
  }
  // ★ 自动清理 Cookie 域污染（2026-10-28）：同名 Cookie 分散在
  //   .pinduoduo.com / mms.pinduoduo.com / yingxiao.pinduoduo.com 时，
  //   浏览器优先发子域旧值 → 推广域反复掉登录。删子域同名项即恢复。
  //   跳过：--no-cookie-clean
  if (process.argv.includes('--cookie-clean')) {
    try {
      const { cleanCookiePollution } = await import(pathToFileURL('e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-promo/scripts/cookie-clean.mjs').href)
      const r = await cleanCookiePollution(profile, { log: (m) => console.warn('[pdd] ' + m) })
      if (r.ok && r.deleted > 0) console.warn('[pdd] ✅ 清理 ' + r.deleted + ' 条域污染 Cookie')
    } catch (e) {
      console.warn('[pdd] Cookie 清理跳过：' + String(e.message).slice(0, 60))
    }
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    userDataDir: profile,
    headless: false,
    defaultViewport: null,        // ★ 用真实窗口尺寸（SDK 会采集 innerWidth/screen.*）
    ignoreDefaultArgs: ['--enable-automation'],
    args: STEALTH_ARGS,
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  // ★ 注入反检测（webdriver / plugins / languages / chrome.runtime）
  await page.evaluateOnNewDocument(STEALTH_SCRIPT);
  const cdp = await page.target().createCDPSession()
  await cdp.send('Network.enable')

  // ★ 风控 L3：检测到滑块遮罩 → 自动过滑块（yydsocr 识别 + 人类化轨迹）
  const ensureNoSlider = async (label) => {
    if (await detectSlider(page)) {
      console.warn(`[pdd-shop] ${label}：检测到滑块遮罩，尝试自动过滑块...`)
      const solved = await autoSolveSlider(SHOP, page)
      if (!solved.ok) {
        await browser.close()
        emit({ ok: false, failureKind: 'risk_control', text: `滑块自动过失败：${solved.text}\n请手动过验证后重试。` })
        process.exit(2)
      }
      console.warn(`[pdd-shop] 滑块已过：${solved.text}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  /** 跨 frame 安全求值（页面可能在 iframe 里） */
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 12; i++) {
      for (const f of page.frames()) {
        try { return await f.evaluate(fn, arg) } catch { /* 换下一个 frame */ }
      }
      await new Promise(r => setTimeout(r, 1200))
    }
    return null
  }

  // hook 经营数据响应（/sydney/api/* + 等级）
  const byApi = {}
  const APIS = [
    ['flow', apiPath('shop.legacyFlow').replace(/^\//, '')],
    ['score', apiPath('shop.legacyScore').replace(/^\//, '')],
    ['goodsOverview', apiPath('shop.legacyGoodsOverview').replace(/^\//, '')],
    ['goodsList', apiPath('shop.legacyGoodsDetailVO').replace(/^\//, '')],
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
      await ensureNoSlider(u)   // ★ 风控 L3：每次导航后检测滑块
      if (/\/login/i.test(page.url())) {
        // 主应用跳登录 = 真失效；sycm 跳登录 = 会话未建立，重试一次
        if (!u.includes('sycm')) {
          await browser.close()
          emit({ ok: false, failureKind: 'token_expired', text: '拼多多商家后台登录态失效，请到「账号连接」重新登录。' })
          process.exit(2)
        }
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await new Promise(r => setTimeout(r, 12000))
        await ensureNoSlider(u + ' (retry)')
      }
    } catch { /* 单页失败不阻断 */ }
  }

  // ── 解析 ──
  const flow = byApi.flow || null
  const score = byApi.score || null
  const gOverview = byApi.goodsOverview || null
  const gList = byApi.goodsList?.goodsDetailList || []
  const mallLevel = byApi.mallLevel || null

  // ══════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════
  // DOM 明文抓取（2026-10-23 新增，2026-10-27 改为默认关闭）
  //
  // 历史背景：原设计认为 PUA 映射「每个字段独立偏移」不可全局推导，
  //            所以改从 DOM 读前端渲染出的明文数字。
  //
  // 2026-10-27 推翻该前提：实测 PUA 映射是**响应级全局统一**的，
  //   用 <X> <-> <X>Ppr 等长对齐 + 投票取众数可 10/10 全覆盖，
  //   且与明文字段交叉验证完全一致（goodsUv 解码值 == goodsUvPpr，10/10 条命中）。
  //
  // 同时发现 DOM 方案有两个硬伤：
  //   1) sycm goods_effect 是 div 布局，div 抓取只能拿到「商品名+ID」的
  //      整行文本，无法分列 -> domNum 模糊匹配会把别的字段/别的行的值
  //      错配到商品上（实测 uv 67 被覆盖成 77）。
  //   2) querySelectorAll('div,span') 全页遍历极慢，会把整个 evaluate 拖死，
  //      连 API hook 都收不到响应（表现为「接口未返回」）。
  //
  // -> 默认完全跳过 DOM 抓取，数据一律用接口 PUA 动态解码。
  //    确需启用时传 --dom-first（仅 table 方案；拿不到分列表头则自动回落）。
  // ══════════════════════════════════════════════════════════════════════
  const DOM_FIRST = process.argv.includes('--dom-first')
  let domGoods = { headers: [], rows: [], via: 'skipped' }
  if (DOM_FIRST && (mode === 'goods' || mode === 'overview')) {
    domGoods = await safeEval(() => {
      // 只做 table 方案（div 方案已证实不可靠且会拖死页面）
      const out = []
      let headers = []
      for (const tb of document.querySelectorAll('table')) {
        const headText = (tb.querySelector('thead')?.innerText || '').slice(0, 400)
        if (!/曝光|访客|浏览量|支付|商品/.test(headText)) continue
        headers = Array.from(tb.querySelectorAll('thead th')).map(th => (th.innerText || '').trim().replace(/\s+/g, ''))
        if (headers.length < 4) continue          // 表头不完整则跳过，防错配
        for (const tr of tb.querySelectorAll('tbody tr')) {
          const tds = Array.from(tr.querySelectorAll('td'))
          if (tds.length < 3) continue
          const rec = {}
          tds.forEach((td, i) => { rec[headers[i] || `col${i}`] = (td.innerText || '').trim().replace(/\s+/g, ' ').replace(/,/g, '') })
          const gid = (Object.values(rec).join(' ').match(/\b(\d{11,14})\b/) || [])[1]
          if (gid) rec.__goodsId = gid
          if (Object.keys(rec).length >= 3) out.push(rec)
        }
        if (out.length) return { headers, rows: out, via: 'table' }
      }
      return { headers: [], rows: [], via: 'none' }
    }).catch(() => ({ headers: [], rows: [], via: 'error' }))
    console.error(`[pdd-shop] DOM 抓取（--dom-first）：via=${domGoods?.via} rows=${domGoods?.rows?.length || 0} headers=${domGoods?.headers?.length || 0}`)
  } else {
    console.error('[pdd-shop] DOM 抓取已跳过（默认；PUA 动态解码已验证 10/10 覆盖）。需要时加 --dom-first')
  }

  // ── PUA 数字混淆解码器 ──────────────────────────────────────────
  // 拼多多 sycm 对数字字段用 PUA 私用区字符（U+E000~U+F8FF）混淆反采集，
  // 且码点是**动态**的（不是全局固定）。
  //
  // ★ 2026-10-27 修：改用共享模块 buildPuaMap（投票取众数），
  //   替换本文件原有的局部实现（首次出现即锁定，会漏码点/被错票带偏）。
  //   推导依据：同一响应里 <X>Ppr 是明文的较上周期值，与 <X> 等长同构。
  const { buildPuaMap, decodePua } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risksdk.mjs')))

  const pua = buildPuaMap(gList)
  const map = pua.map
  // ★ DOM 明文索引（按 goodsId）
  //
  // ★ 2026-10-27 修：默认**不启用** DOM 覆盖。
  //   原因：sycm goods_effect 页是 div 布局，DOM 抓取只能拿到
  //   「商品名 + ID」的整行文本（headers 为空、无分列数字），
  //   domNum 的模糊匹配会从 __raw 里抓到**别的字段/别的行**的数字，
  //   造成 uv/payAmt 与接口 PUA 解码值不一致（实测 uv 67 被覆盖成 77）。
  //   PUA 动态映射已验证 10/10 覆盖且解码正确，所以直接用接口值。
  //   需要启用时传 --dom-first，且仅当 headers 非空（真拿到分列表头）才覆盖。
  const domUsable = DOM_FIRST && Array.isArray(domGoods?.headers) && domGoods.headers.length >= 3
  const domById = new Map()
  for (const r of (domGoods?.rows || [])) {
    if (r.__goodsId) domById.set(String(r.__goodsId), r)
  }
  if (domGoods?.rows?.length && !domUsable) {
    console.error(`[pdd-shop] DOM 行数=${domGoods.rows.length} 但表头为空/不足，已跳过 DOM 覆盖（用接口 PUA 解码值）；需要强制启用加 --dom-first`)
  }
  /** 从 DOM 行里按「表头关键词」取数字（表头名各账号略有差异，用模糊匹配） */
  const domNum = (rec, kws) => {
    if (!rec) return null
    for (const [k, v] of Object.entries(rec)) {
      if (k === '__goodsId' || k === '__raw') continue   // ★ 排除整行文本，防错配
      if (kws.some(kw => k.includes(kw))) {
        // 去掉 % , 空格，取数字
        const m = String(v).replace(/[,%\s]/g, '').match(/-?\d+(\.\d+)?/)
        if (m) return m[0]
      }
    }
    return null
  }
  const goodsItems = gList.slice(0, limit).map(g => {
    // 先用整表推映射，再逐字段解码（映射对该响应全局有效）
    const d = (v) => decodePua(v, map)
    const dom = domUsable ? domById.get(String(g.goodsId)) : null
    // ★ DOM 明文优先（仅 --dom-first 且表头完整时）；否则一律用 PUA 解码
    const pick = (kws, puaVal) => {
      if (!dom) return puaVal
      const dv = domNum(dom, kws)
      return dv != null ? dv : puaVal
    }
    return {
      goodsId: g.goodsId,
      name: g.goodsName || '',
      date: g.statDate,
      src: dom ? 'dom' : 'pua',    // 数据来源标记
      // ── 曝光（隐藏数据，sycm 商品效果页核心指标）──
      imprUsrCnt: pick(['曝光访客', '曝光人数', '曝光'], d(g.imprUsrCnt)),
      imprUsrCntYtd: d(g.imprUsrCntYtd),
      // ── 流量 ──
      uv: pick(['商品访客', '访客数', '访客'], d(g.goodsUv)),
      pv: pick(['浏览量', '浏览'], d(g.goodsPv)),
      uvYtd: d(g.goodsUvYtd),
      pvYtd: d(g.goodsPvYtd),
      // ── 成交 ──
      payAmt: pick(['支付金额', '成交金额'], d(g.payOrdrAmt)),
      payCnt: pick(['支付订单', '订单数'], d(g.payOrdrCnt)),
      payQty: pick(['支付件数', '件数'], d(g.payOrdrGoodsQty)),
      payUsers: pick(['支付人数', '支付买家数'], d(g.payOrdrUsrCnt)),
      cfmOrdrCnt: d(g.cfmOrdrCnt),
      ordrCrtUsrCnt: pick(['下单人数', '下单买家数'], d(g.ordrCrtUsrCnt)),
      // ── 转化 ──
      vcr: pick(['转化率'], d(g.goodsVcr)),
      ordrVstrRto: pick(['下单访客率', '下单转化率'], d(g.ordrVstrRto)),
      payOrdrRto: pick(['支付访客率', '支付转化率', '支付率'], d(g.payOrdrRto)),
      goodsPtHelpRate: d(g.goodsPtHelpRate),
      // ── 互动 ──
      fav: pick(['收藏'], d(g.goodsFavCnt)),
      cnsltUsrQty: pick(['咨询'], d(g.cnsltUsrQty)),
      // 较上周期参考值（Ppr 明文字段；部分账号返回的是当前值而非差值，仅作参考不用于算环比）
      uvRef: g.goodsUvPpr, pvRef: g.goodsPvPpr, payAmtRef: g.payOrdrAmtPpr,
      vcrRef: g.goodsVcrPpr, favRef: g.goodsFavCntPpr,
      imprRef: g.imprUsrCntPpr,
      // 类目对比 + 指标
      cate3Vcr: d(g.cate3PctGoodsVcr),
      cate3AvgVcr: d(g.cate3AvgGoodsVcr),
      goodsStatus: g.goodsStatus,
      cate1Id: g.cate1Id, cate2Id: g.cate2Id, cate3Id: g.cate3Id,
      // ★ 2026-10-27 补：行业对比（与 t3 分支同构）
      industry: {
        cate3AvgVcr: d(g.cate3AvgGoodsVcr),
        cate3PctVcr: d(g.cate3PctGoodsVcr),
        isAboveFlag: g.cate3IsPgvAbove,
        vcrRised: g.goodsVcrRised,
      },
    }
  })

  // ══════════════════════════════════════════════════════════════════════
  // ★ 2026-10-27 结论：自然曝光量 sycm 拿不到（不是解码问题）
  //
  //   核查了 4 次历史抓包存档，imprUsrCnt 全是单个 PUA 字符（=0），
  //   imprUsrCntDetail 全部 false：
  //     · sycm-goods-scan.json   10-22  7 个商品  0/7  非零
  //     · goods-detail-raw.json  10-23  10 个商品 0/10 非零
  //     · goods-raw.json         10-27  31 个商品 0/31 非零
  //     · hunt-...ForMMS.json    10-27  10 个商品 0/10 非零
  //
  //   同一次响应里 goodsUv/goodsVcr/payOrdrAmt 全部正常解出（映射 10/10 覆盖），
  //   所以**不是 PUA 解码失败**，是接口本身不返回自然曝光值。
  //   imprUsrCntDetail=false 即「该商品未开放曝光明细」——拼多多按店铺等级
  //   开放 sycm 数据模块，本店没开到曝光层。
  //
  //   另扫过 sycm 全部 7 个页面（goods_effect / stores_data / evaluation /
  //   search_data / fans / goods_quality×2）共 20+ 接口，无任何自然曝光来源。
  //
  //   → 自然端只有店铺级 uv/pv/成交（mallFlow），无曝光无点击。
  //   → **曝光量和点击率请用 pdd-promo 技能**（poseidon 广告口径），
  //     那边 impression/click/ctr 都是真值，与 sycm 权限无关。
  //
  //   ⚠️ 历史脚本 nature_vs_paid_ctr.mjs / dual_ctr.mjs 里写的
  //      「imprUsrCnt PUA 解不出」是错误归因，真实原因就是没权限。
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // ★ 派生指标（真实点击率等）—— 只有拿到 DOM 明文曝光时才算得准
  // ══════════════════════════════════════════════════════════════════════
  for (const it of goodsItems) {
    const nImpr = parseFloat(it.imprUsrCnt)
    const nUv = parseFloat(it.uv)
    const nPv = parseFloat(it.pv)
    // 真实点击率（曝光→访客）≈ 访客 / 曝光访客
    it.realCtr = (nImpr > 0 && nUv >= 0) ? +(nUv / nImpr * 100).toFixed(2) : null
    // UV 率（访客/浏览，衡量浏览深度，不是点击率）
    it.uvRate = (nPv > 0 && nUv >= 0) ? +(nUv / nPv * 100).toFixed(2) : null
    // 人均浏览页数
    it.pagesPerUv = (nUv > 0 && nPv > 0) ? +(nPv / nUv).toFixed(2) : null
  }

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
      out.puaCoverage = pua.coverage
      // ★ 2026-10-27 补：行业均值对比段（转化率 > 三级类目均值）
      const n = (v) => { const s = String(v ?? '').replace(/[^\d.\-]/g, ''); return s === '' ? null : Number(s) }
      const withInd = goodsItems.filter(x => n(x.industry?.cate3AvgVcr) != null)
      const avgVals = withInd.map(x => n(x.industry.cate3AvgVcr))
      const avgVcr = avgVals.length ? Math.max(...avgVals) : null
      const curVcr = (x) => n(x.vcr)
      const above = withInd.filter(x => { const v = curVcr(x); return v != null && avgVcr != null && v > avgVcr })
      out.industry = { avgVcr, aboveCount: above.length, aboveIds: above.map(x => x.goodsId) }

      let txt = goodsItems.length
        ? `商品数据明细（${goodsItems.length} 个商品，${goodsItems[0]?.date || '今日'}；PUA 解码覆盖 ${pua.coverage.agreed}/${pua.coverage.total} 码点）：\n` + goodsItems.map((g, i) =>
            `  ${i + 1}. [${g.goodsId}] ${String(g.name).slice(0, 24)}`
            + `\n     ★曝光访客=${g.imprUsrCnt ?? '—'}（昨日 ${g.imprUsrCntYtd ?? '—'}）`
            + `\n     访客=${g.uv ?? '—'} 浏览=${g.pv ?? '—'} 收藏=${g.fav ?? '—'} 咨询=${g.cnsltUsrQty ?? '—'}`
            + `\n     支付=${g.payAmt ?? '—'}元 订单=${g.payCnt ?? '—'} 件数=${g.payQty ?? '—'} 人数=${g.payUsers ?? '—'}`
            + `\n     转化率=${g.vcr ?? '—'}（类目 ${g.cate3Vcr ?? '—'} / 类目均值 ${g.cate3AvgVcr ?? '—'}）`
            + (g.payOrdrRto ? ` 支付率=${g.payOrdrRto}` : '')
            + (g.ordrVstrRto ? ` 下单访客率=${g.ordrVstrRto}` : '')
          ).join('\n')
        : '商品数据：暂无明细（接口未返回或页面未加载完）'

      if (avgVcr != null) {
        txt += `\n\n★ 行业均值对比（三级类目平均转化率 ${avgVcr}%）：`
        if (above.length) {
          for (const x of above.sort((a, b) => curVcr(b) - curVcr(a))) {
            const v = curVcr(x)
            const lead = avgVcr > 0 ? ((v / avgVcr - 1) * 100).toFixed(0) : '?'
            txt += `\n  [${x.goodsId}] ${String(x.name || '').slice(0, 26)}｜转化率 ${v}%｜高出 ${lead}%`
              + `｜访客 ${x.uv ?? '—'}｜订单 ${x.payCnt ?? '—'}｜金额 ¥${x.payAmt ?? '—'}`
              + (x.industry.isAboveFlag === 1 ? '｜平台标记:高于同级' : '')
          }
          txt += `\n  → 共 ${above.length} 个宝贝转化率高于行业均值`
        } else {
          txt += '\n  （无转化率高于行业均值的宝贝）'
        }
        const flagOnly = withInd.filter(x => x.industry.isAboveFlag === 1 && !above.includes(x))
        if (flagOnly.length) {
          txt += `\n\nℹ️ 另有 ${flagOnly.length} 个被平台标记「高于同级类目」但转化率数值未超均值`
            + '（该标记为综合算法，含成交额/UV 等多维，非纯转化率比对）：'
          for (const x of flagOnly) {
            txt += `\n    [${x.goodsId}] ${String(x.name || '').slice(0, 24)}｜转化率 ${curVcr(x) ?? '—'}%｜均值 ${avgVcr}%`
          }
        }
      }
      out.text = txt
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
  // ★ 2026-11-04：clearInterval(hb) 随迁移去掉（心跳由 guard.startHeartbeat 管理）
  await guard.close()
  await browser.close()
})().catch(async (e) => {
  // ★ 风控异常 → 友好提示
  const { checkCooldown, fmtRemain } = await import(pathToFileURL(path.join(PLUGIN_ROOT, '/skills/_shared/pdd-risk.mjs'))).catch(() => ({}))
  if (e?.riskCode && checkCooldown) {
    const cd = checkCooldown(SHOP)
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `命中平台频控（code=${e.riskCode}${e.riskMsg ? `：${e.riskMsg}` : ''}），已记冷却 ${fmtRemain(cd.remainMs)}。\n期间请勿重复调用（会延长封禁）。\n若急需使用，可在浏览器窗口手动过滑块验证，然后重试。`,
    })
    process.exit(2)
  }
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})


