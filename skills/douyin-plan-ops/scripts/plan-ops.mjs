#!/usr/bin/env node
/**
 * 抖音·全域投放计划管理（douyin-plan-ops）
 *
 * 逆向自千川「全域投放」计划管理页（/uni-prom）
 *
 * 数据源（实测 2026-10-25，均可用）：
 *   POST /ad/api/pmc/v1/uni-promotion/ad/list-required   计划列表（含权限）
 *   POST /ad/api/pmc/v1/uni-promotion/ad/list-summary    计划汇总数
 *   POST /ad/api/pmc/v1/uni-promotion/ad/list-optional   计划附加模块
 *
 * 能力：
 *   list        计划列表（名称/ID/状态/预算/ROI/商品/权限/投放设置）
 *   stop        暂停计划（L2，先预览后执行）
 *   start       开启计划（L2，先预览后执行）
 *
 * 计划状态判定：
 *   adDeliveryType === 0 → 投放中
 *   adDeliveryType !== 0 → 已暂停/停投
 *   operation.optStatusOperation.editable → 是否允许启停
 *
 * 启停实现路线：
 *   千川启停接口有 verifyFp/a_bogus 签名，手工 fetch 一律 40002，
 *   唯一可靠路线是「真实浏览器 + 点击页面开关」。脚本会：
 *     1) 打开计划管理页，切到推商品 → 商品自选
 *     2) 定位计划行的 .ovui-switch（--checked = 投放中）
 *     3) 点击并等待请求完成，再回读开关状态验证
 *
 * 用法：
 *   node scripts/plan-ops.mjs --mode list
 *   node scripts/plan-ops.mjs --mode stop  --ad_id 1835712799161914
 *   node scripts/plan-ops.mjs --mode start --ad_id 1835712799161914
 */

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(HERE, '..', '..', '..')
const PURL = (p) => pathToFileURL(p).href

// ── 参数解析 ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = 'true'
    else { out[key] = next; i++ }
  }
  return out
}
const ARGS = parseArgs(process.argv)

const MODE = (ARGS.mode || 'list').trim()
const ACCOUNT = (ARGS.account || '').trim()
const AD_ID = (ARGS.ad_id || ARGS.adId || '').trim()
const LIMIT = Math.min(100, Math.max(1, parseInt(ARGS.limit || '20', 10) || 20))
// mar_goal: 1=推商品（默认） 2=推直播间
const MAR_GOAL = String(ARGS.mar_goal || ARGS.goal || '1').trim()
const today = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
const START = (ARGS.start || today()).trim()
const END = (ARGS.end || START).trim()

function emit(payload) {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n')
}
function fail(kind, message, extra = {}) {
  emit({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })
  process.exit(1)
}
const log = (...a) => console.error('[douyin-plan-ops]', ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── 账号与库 ──────────────────────────────────────────────
let store, CredentialStore
let profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, applyAccountEnv, envOf
try {
  ;({ CredentialStore } = await import(PURL(join(PLUGIN_ROOT, 'lib', 'services', 'credential-store.js'))))
  ;({ profileDir, findChromePath, tryAcquireProfile, releaseProfile, clearProfileLocks, applyAccountEnv, envOf } =
    await import(PURL(join(PLUGIN_ROOT, 'lib', 'browser-login.js'))))
  store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
} catch (e) {
  fail('api_error', `无法加载插件库（${PLUGIN_ROOT}）：${e.message}`)
}

const accounts = store.listAccounts().filter((a) => a.platform === 'douyin_shop' && a.status !== 'invalid')
if (!accounts.length) {
  fail('not_bound', '未找到抖音小店账号。请到「账号连接」页面添加「抖店」账号（platform=douyin_shop）。')
}
let account
if (ACCOUNT) {
  account = accounts.find((a) => a.shop_key === ACCOUNT)
  if (!account) {
    fail('api_error', `账号 shopKey 不存在：${ACCOUNT}。可用：${accounts.map((a) => a.shop_key).join(' / ')}`)
  }
} else if (accounts.length === 1) {
  account = accounts[0]
} else {
  fail('need_account_choice',
    `抖音平台有 ${accounts.length} 个可用账号，请指定 --account：\n`
    + accounts.map((a, i) => `${i + 1}. ${a.nickname}（${a.shop_key}）`).join('\n'),
    { accounts: accounts.map((a) => ({ shop_key: a.shop_key, nickname: a.nickname })) })
}

const SHOP_KEY = account.shop_key
const pat = SHOP_KEY.replace(/[^a-zA-Z0-9]/g, '')

function killOrphanChrome() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${pat}*' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8' }
    )
    const pids = out.split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean)
    if (pids.length) {
      execSync(
        `powershell -NoProfile -Command "${pids.map(p => `Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`).join('; ')}"`,
        { stdio: 'ignore' }
      )
    }
    return pids.length
  } catch { return 0 }
}
// playwright 常抢同一个 profile，一并清
function killPlaywright() {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*playwright*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    )
  } catch { /* ignore */ }
}

const dir = profileDir('douyin_shop', SHOP_KEY)
if (!tryAcquireProfile(dir, 'douyin-plan-ops')) {
  fail('api_error', '抖店/千川的浏览器环境正被其他任务占用，请稍后重试。')
}

// 复用正式 profile（不能注入账号 cookies，会被判未登录）
let browser = null
try {
  const puppeteer = await import(PURL(join(PLUGIN_ROOT, 'node_modules', 'puppeteer-core',
    'lib', 'esm', 'puppeteer', 'puppeteer-core.js')))
  const chromePath = findChromePath()
  if (!chromePath) fail('api_error', '未找到 Chrome 或 Edge 浏览器')

  killOrphanChrome(); killPlaywright()
  let lastErr = null
  for (let round = 0; round < 5 && !browser; round++) {
    if (round > 0) { killOrphanChrome(); killPlaywright(); await sleep(6000) }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.default.launch({
        headless: false,
        executablePath: chromePath,
        userDataDir: dir,
        defaultViewport: { width: 1600, height: 1400 },
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1600,1400'],
      })
    } catch (e) { lastErr = e; log(`launch round ${round} fail`) }
  }
  if (!browser) throw lastErr || new Error('浏览器启动失败')

  let page = (await browser.pages())[0] || await browser.newPage()
  const env = envOf(account)
  // ★ 不调用 applyAccountEnv：它会把视口压回 1440x900，
  //   而计划行的状态开关在 y≈1050，超出视口就无法点击（实测踩坑）

  const ensurePage = async () => {
    try { if (browser.isConnected()) return page } catch { /* ignore */ }
    log('browser disconnected, relaunching')
    try { await browser.close() } catch {}
    killOrphanChrome(); await sleep(5000); clearProfileLocks(dir)
    for (let r = 0; r < 4; r++) {
      try {
        browser = await puppeteer.default.launch({
          headless: false, executablePath: chromePath, userDataDir: dir,
          defaultViewport: { width: 1600, height: 1400 },
          args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1600,1400'],
        })
        page = await browser.newPage()
        // ★ 不调用 applyAccountEnv：它会把视口压回 1440x900，
  //   而计划行的状态开关在 y≈1050，超出视口就无法点击（实测踩坑）
        return page
      } catch (e) { log('relaunch fail', r); await sleep(4000) }
    }
    return null
  }

  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 3; i++) {
      try { return await page.evaluate(fn, arg) } catch (e) {
        log('eval rebuild:', String(e.message).split('\n')[0])
        try { await page.close() } catch {}
        page = (await ensurePage()) || page
        if (!page) return null
      }
    }
    return null
  }
  const safeGoto = async (url) => {
    for (let i = 0; i < 3; i++) {
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 50000 }); return true } catch (e) {
        log('goto rebuild:', String(e.message).split('\n')[0])
        try { await page.close() } catch {}
        page = (await ensurePage()) || page
        if (!page) return false
      }
    }
    return false
  }
  const clickByText = async (t) => {
    const box = await safeEval((txt) => {
      const els = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').trim() === txt)
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.width >= 2 && r.height >= 2) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }
      return null
    }, t)
    if (box) { await page.mouse.click(box.x, box.y); return true }
    return false
  }

  const PLAN_PAGE = 'https://qianchuan.jinritemai.com/uni-prom?aavid=1781536544329804&ct=1'
  log('DIAG page before goto:', typeof page, page && page.url ? page.url().slice(0, 60) : 'no-url-method')
  const gotoOk = await safeGoto(PLAN_PAGE)
  log('DIAG goto result:', gotoOk)
  await sleep(16000)
  let curUrl = ''
  try { curUrl = page.url() } catch (e) { log('DIAG url err:', e.message) }
  log('landed:', (curUrl || '').slice(0, 110))

  // 提取 aavid
  const extractAavid = () => {
    try {
      let m = page.url().match(/aavid=(\d{6,})/)
      if (m) return m[1]
    } catch { /* ignore */ }
    return null
  }
  let AVID = extractAavid()
  if (!AVID) {
    // 兜底：调接口取 accountId
    const r = await safeEval(async () => {
      try {
        const res = await fetch('https://qianchuan.jinritemai.com/ad/api/v1/account/account-info/get-customer-id', { credentials: 'include' })
        return await res.text()
      } catch (e) { return '' }
    })
    AVID = (String(r || '').match(/"accountId"\s*:\s*"?(\d{6,})/) || [])[1] || null
  }
  if (!AVID) fail('api_error', '未能解析出千川账户 ID（aavid）')
  log('aavid =', AVID)

  // ── 计划列表接口（无需页面签名，可直调） ──────────────────
  const fetchPlans = async () => {
    const body = {
      _origin_ajax_: 1,
      UseNewChain: true,
      Params: {
        AdFilter: {
          AdlabScene: 0,
          DataTimeRange: { StartTime: START + ' 00:00:00', EndTime: END + ' 23:59:59' },
          MarGoal: Number(MAR_GOAL),
          SmartBidType: 0,
          UniPromShopFilter: { UniPromShopView: 1 },
        },
        PageParams: { Page: 1, PageSize: LIMIT },
        ListAdsModules: [36, 7, 53, 10],
        OrderBy: { Field: 'stat_cost_for_roi2', Type: 2 },
        Metrics: ['stat_cost_for_roi2'],
        SophonxDataSetKey: 'overall_roi_promotion_list_for_product',
      },
      aavid: AVID,
    }
    const raw = await safeEval(async (b) => {
      try {
        const res = await fetch('https://qianchuan.jinritemai.com/ad/api/pmc/v1/uni-promotion/ad/list-required', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(b),
        })
        return await res.text()
      } catch (e) { return 'ERR ' + e.message }
    }, body)
    try { return JSON.parse(raw) } catch { return null }
  }

  const parsePlan = (ad, statsMap) => {
    const op = ad.operation || {}
    const stats = (statsMap || {})[ad.id]?.metrics || {}
    // 金额单位实测（2026-10-25）：budget="30000000" → 页面显示 300 元
    //   换算系数 /100000（千分之一元），与 get-adv-balance 的 valid 同口径
    const yuan = (v) => { const n = Number(v); return Number.isFinite(n) ? n / 100000 : null }
    const ts2date = (t) => {
      const n = Number(t)
      return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 19).replace('T', ' ') : null
    }
    return {
      adId: ad.id,
      name: ad.name,
      status: ad.adDeliveryType === 0 ? '投放中' : '已暂停',
      statusCode: ad.adDeliveryType,
      statusName: ad.adDeliveryName,
      marGoal: ad.marGoal,
      marGoalName: ad.marGoal === 2 ? '推直播间' : '推商品',
      budget: yuan(ad.budget),
      budgetMode: ad.budgetMode,
      roiGoal: ad.ecpRoi2Goal ?? null,
      externalAction: ad.externalAction,
      externalActionName: ad.externalActionName,
      deepExternalAction: ad.deepExternalAction,
      deepExternalActionName: ad.deepExternalActionName,
      smartBidType: ad.smartBidType,
      qcpxMode: ad.qcpxMode,
      isMultiProduct: ad.isMultiProduct ?? null,
      createTime: ts2date(ad.createTime),
      modifyTime: ts2date(ad.modifyTime),
      cost: stats.statCostForRoi2 ? Number(stats.statCostForRoi2.valueStr) : null,
      // 权限
      canOptStatus: op.optStatusOperation?.editable ?? null,
      canEdit: op.editOperation?.editable ?? null,
      canEditBudget: op.budgetEditOperation?.editable ?? null,
      canEditRoi: op.roi2GoalOperation?.editable ?? null,
      canCopy: op.copyOperation?.copyable ?? null,
      canTransfer: op.transferOperation?.transferable ?? null,
      optMsg: op.optStatusOperation?.msg || '',
    }
  }

  const out = { ok: true, mode: MODE, shopKey: SHOP_KEY, aavid: AVID, items: [] }
  const lines = []

  // ═══════════ list ═══════════
  if (MODE === 'list') {
    const res = await fetchPlans()
    const ads = res?.data?.adInfos || []
    const statsMap = res?.data?.adStatsMap || {}
    const plans = ads.map(a => parsePlan(a, statsMap))
    out.plans = plans
    out.items = plans
    out.total = plans.length

    lines.push(`全域投放计划（${MAR_GOAL === '2' ? '推直播间' : '推商品'}｜${START} ~ ${END}）：`)
    lines.push(`  账户 aavid：${AVID}`)
    lines.push(`  计划数：${plans.length}`)
    lines.push('')
    if (plans.length) {
      for (const p of plans) {
        lines.push(`  · ${p.name}`)
        lines.push(`     ID：${p.adId}｜状态：${p.status}${p.statusName ? `（${p.statusName}）` : ''}`)
        lines.push(`     预算：${p.budget == null ? '—' : p.budget + ' 元/日'}`
          + `｜ROI目标：${p.roiGoal ?? '—'}`
          + `｜转化：${p.deepExternalActionName || p.externalActionName || '—'}`)
        lines.push(`     消耗：${p.cost ?? '—'} 元`
          + `｜创建：${p.createTime ?? '—'}`
          + `｜修改：${p.modifyTime ?? '—'}`)
        const perms = []
        perms.push('启停 ' + (p.canOptStatus ? '✅' : '❌'))
        perms.push('编辑 ' + (p.canEdit ? '✅' : '❌'))
        perms.push('改预算 ' + (p.canEditBudget ? '✅' : '❌'))
        perms.push('改ROI ' + (p.canEditRoi ? '✅' : '❌'))
        lines.push('     权限：' + perms.join(' | '))
        if (p.optMsg) lines.push(`     提示：${p.optMsg}`)
      }
    } else {
      lines.push('  （无计划）')
      lines.push('  若页面显示有计划但这里为空，可能是「乘方」体系的计划，')
      lines.push('  或用 --mar_goal 2 切到推直播间看看。')
    }
    out.text = lines.join('\n')
    emit(out)
  } else if (MODE === 'stop' || MODE === 'start') {
    if (!AD_ID) {
      fail('api_error', MODE + ' 模式需要 --ad_id 参数。可先用 --mode list 查看计划 ID。',
        { available: ['list', 'stop', 'start'] })
    }

    // 1) 拿计划当前状态与权限
    const res = await fetchPlans()
    const ads = res?.data?.adInfos || []
    const statsMap = res?.data?.adStatsMap || {}
    const target = ads.find(a => String(a.id) === String(AD_ID))
    if (!target) {
      fail('api_error', '未找到计划 ' + AD_ID + '。当前列表共 ' + ads.length + ' 条：'
        + ads.map(a => a.name + '(' + a.id + ')').join('、'),
        {
          requestedAdId: AD_ID,
          available: ads.map(a => ({ id: a.id, name: a.name, status: a.adDeliveryName })),
        })
    }
    const plan = parsePlan(target, statsMap)

    if (!plan.canOptStatus) {
      fail('permission_denied',
        '计划「' + plan.name + '」不允许启停。平台提示：' + (plan.optMsg || '（无）'),
        { plan })
    }

    const isRunning = plan.statusCode === 0
    const wantRun = MODE === 'start'

    if (isRunning === wantRun) {
      out.noop = true
      out.plan = plan
      out.text = '计划「' + plan.name + '」（' + plan.adId + '）当前已是「' + plan.status + '」，无需' + (wantRun ? '开启' : '暂停') + '。'
      emit(out)
    } else if (String(ARGS.confirm) !== 'true') {
      // 2) L2 预览
      out.pending = true
      out.plan = plan
      out.action = MODE
      out.text = [
        '【预览】' + (wantRun ? '开启' : '暂停') + '计划：',
        '  计划名称：' + plan.name,
        '  计划 ID  ：' + plan.adId,
        '  当前状态：' + plan.status,
        '  操作后   ：' + (wantRun ? '投放中' : '已暂停'),
        '  每日预算：' + (plan.budget == null ? '—' : plan.budget + ' 元'),
        '  ROI 目标 ：' + (plan.roiGoal ?? '—'),
        '  今日消耗 ：' + (plan.cost ?? '—') + ' 元',
        '',
        '  执行方式：真实浏览器点击计划行开关（千川启停接口有签名，只能走 UI）',
        '  确认执行请加 --confirm true',
      ].join('\n')
      emit(out)
    } else {
      // 3) 执行：UI 点击开关
      log('执行 ' + MODE + '：' + plan.name + ' (' + plan.adId + ')')
      await clickByText(MAR_GOAL === '2' ? '推直播间' : '推商品')
      await sleep(14000)
      if (MAR_GOAL !== '2') {
        for (let i = 0; i < 4; i++) {
          if (await clickByText('商品自选')) break
          await sleep(5000)
        }
        await sleep(12000)
      }

      // 定位该计划的开关
      const sw = await safeEval((adId) => {
        const all = [...document.querySelectorAll('*')]
        let anchor = null
        for (const el of all) {
          if (el.children.length) continue
          if ((el.textContent || '').includes(adId)) { anchor = el; break }
        }
        if (!anchor) return null
        let row = anchor
        for (let i = 0; i < 12 && row; i++, row = row.parentElement) {
          const t = row.innerText || ''
          if (t.includes(adId) && t.includes('编辑')) break
        }
        const scope = row || document.body
        const swEl = scope.querySelector('.ovui-switch')
        if (!swEl) return null
        const r = swEl.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), checked: /checked/.test(swEl.className || '') }
      }, AD_ID)

      if (!sw) {
        fail('api_error', '未能在页面定位到计划 ' + AD_ID + ' 的开关。可能该计划不在当前 tab，或页面未加载完。',
          { plan, url: page.url() })
      }
      log('开关状态:', JSON.stringify(sw))
      if (sw.checked !== isRunning) {
        fail('api_error', '页面开关状态(' + sw.checked + ')与接口状态(' + isRunning + ')不一致，终止操作以防误判。',
          { sw, plan })
      }

      // hover 校验：平台会在开关上弹「计划开启中，点击暂停」/「计划已暂停，点击开启」
      await page.mouse.move(sw.x - 30, sw.y)
      await sleep(600)
      await page.mouse.move(sw.x, sw.y, { steps: 8 })
      await sleep(2500)
      const tip = await safeEval(() => {
        const els = [...document.querySelectorAll('.ovui-popover, .oc-popover-text, [class*="popover"]')]
        for (const el of els) {
          const t = (el.innerText || '').trim()
          if (/点击暂停|点击开启/.test(t)) return t.slice(0, 60)
        }
        return null
      })
      log('hover 提示:', tip)
      if (!tip) log('（未取到 hover 提示，继续点击）')

      await page.mouse.click(sw.x, sw.y)
      await sleep(14000)

      // 4) 回读验证
      const after = await safeEval((adId) => {
        const all = [...document.querySelectorAll('*')]
        let anchor = null
        for (const el of all) {
          if (el.children.length) continue
          if ((el.textContent || '').includes(adId)) { anchor = el; break }
        }
        if (!anchor) return null
        let row = anchor
        for (let i = 0; i < 12 && row; i++, row = row.parentElement) {
          const t = row.innerText || ''
          if (t.includes(adId) && t.includes('编辑')) break
        }
        const scope = row || document.body
        const swEl = scope.querySelector('.ovui-switch')
        return swEl ? { checked: /checked/.test(swEl.className || '') } : null
      }, AD_ID)

      const res2 = await fetchPlans()
      const ad2 = (res2?.data?.adInfos || []).find(a => String(a.id) === String(AD_ID))
      const nowRunning = ad2 ? ad2.adDeliveryType === 0 : null
      const success = nowRunning === wantRun

      out.done = true
      out.success = success
      out.plan = plan
      out.after = {
        switchChecked: after?.checked ?? null,
        statusCode: ad2?.adDeliveryType ?? null,
        statusName: ad2?.adDeliveryName ?? null,
      }
      out.text = success
        ? '✅ 计划「' + plan.name + '」已' + (wantRun ? '开启' : '暂停') + '（当前状态：' + ad2.adDeliveryName + '）'
        : '⚠️ 已执行点击，但状态未按预期变化。接口状态：' + (ad2?.adDeliveryName ?? '未知') + '，页面开关：' + after?.checked
      emit(out)
    }
  } else {
    fail('api_error', `未知 mode：${MODE}。可用：list / stop / start`, { mode: MODE })
  }
} catch (err) {
  fail('api_error', `抖音计划管理异常：${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  await sleep(2000)
  killOrphanChrome(); killPlaywright()
  clearProfileLocks(dir)
  releaseProfile(dir)
}
