/**
 * ═══════════════════════════════════════════════════════════════════
 * 推广域写操作 · 纯 Node 通道（2026-11-09）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 背景：6 个写操作（pause/resume/delete/create/maxcost/roi）原来只能在
 *       `page.evaluate` 里发请求（靠页面 hook 到的签名 pair）。
 *       现在基座有了混合通道（Chrome 签名 + Node 发请求），body 也全都抓到了，
 *       所以可以走 Node —— 快得多，而且能跑在被 54001 拦之前把参数校验掉。
 *
 * ★ 写操作的安全红线（比读接口严得多）：
 *   ① **绝不在网络异常时自动重试** —— 超时可能是"服务端已执行但响应没回来"，
 *      重试 = 重复下单/重复改价。
 *   ② 只有明确的「请求被拦」（54001 风控 / 40001 鉴权）才允许降级浏览器重发，
 *      因为这两种情况能保证服务端**没有执行**。
 *   ③ 失败信息原样回传，不吞。
 *
 * 用法：
 *   const r = await execPromoWrite({ mode: 'pause', unitIds: ['123'], shopKey })
 */

/** 写操作模式 */
export const PROMO_WRITE_MODES = ['pause', 'resume', 'delete', 'create', 'maxcost', 'roi']

/** 中文动词（预览/结果文案用） */
export const PROMO_WRITE_VERB = {
  pause: '暂停', resume: '开启', delete: '删除',
  create: '创建', maxcost: '改日限额', roi: '改投产比',
}

/** 模式 → 注册表接口名 */
export const PROMO_WRITE_API = {
  pause: 'promo.updateStatus',
  resume: 'promo.updateStatus',
  delete: 'promo.delete',
  create: 'promo.batchCreate',
  maxcost: 'promo.updateMaxCost',
  roi: 'promo.updateBid',
}

/**
 * 日限额/出价「不限」的魔法值（页面实证：不限 = value "1000000.00"）
 * ★ 不是 0，也不是 -1 —— 填错会被当成"限额 0 元"直接把推广停了。
 */
export const UNLIMITED = { value: '1000000.00', unitCode: 1 }

/** 元 → API 的 {value, unitCode} 对象；未指定或 unlimited 都算不限 */
function money(yuan) {
  if (yuan === undefined || yuan === null || yuan === '' || yuan === 'unlimited' || Number(yuan) === 0) {
    return { ...UNLIMITED }
  }
  return { value: String(yuan), unitCode: 1 }
}

/**
 * 组装写操作的 body。**纯函数**，与域无关 —— 这样 Node 和浏览器两条路径
 * 用的是同一份 body 逻辑，不会出现"Node 通、浏览器不通"的分叉。
 *
 * @returns {{api: string, body: object}}
 */
export function buildPromoWrite(mode, a = {}) {
  const adId = a.unitId ? Number(a.unitId) : 0
  const adIds = (Array.isArray(a.unitIds) ? a.unitIds : [])
    .map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0)
  const useIds = adIds.length ? adIds : (adId ? [adId] : [])
  const gid = a.goodsId ? Number(a.goodsId) : 0

  const bodies = {
    // 实测成功（2026-10-21）：是 adIdList + dataOperateStatus，
    // 不是 operateStatus / adStatus（后者报「operateStatus 错误」）
    pause: { adIdList: useIds, dataOperateStatus: 2 },
    resume: { adIdList: useIds, dataOperateStatus: 1 },
    // 删除：{goodsId, adId, planId}（部分推广类型服务端返回"不支持删除广告"）
    delete: { goodsId: gid, adId, planId: a.planId || 0 },
    // 创建：adInfoList 数组；maxCost/targetRoi 是 {value,unitCode} 对象
    create: {
      adInfoList: [{
        goodsId: gid,
        maxCost: money(a.maxCostYuan),
        bidType: 1,
        targetRoi: a.roi ? { value: String(a.roi), unitCode: 1 } : undefined,
        isAdvertiserEnableAdvanced: true,
      }],
    },
    maxcost: { adId, maxCost: money(a.maxCostYuan) },
    // 投产比：body 是 updateBidList 数组（实测抓包 2026-10-21）
    roi: {
      updateBidList: [{
        adId,
        targetRoi: { value: String(a.roi || '0'), unitCode: 1 },
        isAdvertiserEnableAdvanced: true,
        optionalOptimizationMessageInfoList: [
          { optimizationGoal: 3, dataOperateStatus: 2 },
          { optimizationGoal: 4, dataOperateStatus: 2 },
          { optimizationGoal: 5, dataOperateStatus: 2 },
        ],
      }],
    },
  }

  const api = PROMO_WRITE_API[mode]
  const body = bodies[mode]
  if (!api || !body) throw new Error(`未知的写操作模式: ${mode}`)
  return { api, body }
}

/** 校验参数是否够执行（不够就别发请求，省一次风控机会） */
export function validatePromoWrite(mode, a = {}) {
  const adId = a.unitId ? Number(a.unitId) : 0
  const adIds = (Array.isArray(a.unitIds) ? a.unitIds : []).map(Number).filter(x => x > 0)
  // ★ 单单元（--unit-id）和批量（--unit-ids）**都算**有效 —— 之前只查了 unitIds，
  //   导致 --unit-id 单独用被本地拦掉（body 明明是对的）
  const anyId = adIds.length > 0 || adId > 0
  const need = (cond, msg) => (cond ? null : msg)

  switch (mode) {
    case 'pause':
    case 'resume':
      return need(anyId, '需要 --unit-id 或 --unit-ids（批量）')
    case 'delete':
      return need(adId > 0, '需要 --unit-id') || need(Number(a.goodsId) > 0, '需要 --goods-id')
    case 'create':
      return need(Number(a.goodsId) > 0, '需要 --goods-id')
    case 'maxcost':
      return need(adId > 0, '需要 --unit-id') || need(a.maxCostYuan !== undefined && a.maxCostYuan !== '', '需要 --max-cost（元，或 unlimited）')
    case 'roi':
      return need(adId > 0, '需要 --unit-id') || need(a.roi !== undefined && a.roi !== '', '需要 --roi（如 3 = 投1赚3）')
    default:
      return `未知模式: ${mode}`
  }
}

/** 判定响应是否成功（推广域的成功码是 1000，不是 1000000） */
export function isPromoWriteOk(json) {
  if (!json) return false
  if (json.success === true) return true
  const ec = json.error_code ?? json.errorCode
  return ec === 1000 || ec === 1000000 || ec === '1000' || ec === '1000000'
}

/**
 * 纯 Node 执行写操作。
 *
 * @param {object} a  { mode, unitId, unitIds, goodsId, maxCostYuan, roi, planId, shopKey, account }
 * @returns {Promise<{ok, channel, json, ec, hint, failureKind, safeToRetry}>}
 */
export async function execPromoWrite(a = {}) {
  const { mode, shopKey, account } = a
  const { api, body } = buildPromoWrite(mode, a)

  const bad = validatePromoWrite(mode, a)
  if (bad) {
    return { ok: false, channel: 'none', failureKind: 'api_error', ec: 'bad_args', hint: bad, json: null, safeToRetry: false }
  }

  const { callApi } = await import(new URL('../../_shared/pdd-request.mjs', import.meta.url).href)
  const r = await callApi(api, body, {
    shopKey,
    account: account || { shopKey, cookies: {} },
    domain: 'yingxiao',
    // 写操作：**不允许基座在 54001 时自动降级浏览器重发** ——
    // 那条降级路径是为读接口设计的；写操作重发有重复执行风险，
    // 由调用方（promo.mjs）显式决定要不要用浏览器补一次。
    noBrowserFallback: true,
  })

  const ok = isPromoWriteOk(r.raw)
  // 只有「服务端明确拒绝、未执行」的才标记可安全重试
  const ec = r.ec
  const safeToRetry = !ok && (ec === 54001 || ec === 54003 || ec === 40001 || ec === 43001 || ec === 'no_channel')

  return {
    ok: r.ok && ok,
    channel: r.channel,
    json: r.raw,
    ec,
    hint: r.hint || '',
    failureKind: r.failureKind || '',
    safeToRetry,
  }
}

/** 结果文案（与 promo.mjs 原来的口径保持一致） */
export function describePromoWriteResult(r, { mode, unitIds = [], goodsId, detail = '' } = {}) {
  const verb = PROMO_WRITE_VERB[mode] || mode
  const succ = r.json?.result?.successList || []
  const fail = r.json?.result?.failedList || []
  // ★ 批量操作会「部分成功」：HTTP 200 + success:1000，但 successList 为空。
  //   这时报「成功」是错的 —— 要看 successList，不是只看 errorCode。
  if (r.ok && (succ.length > 0 || fail.length === 0)) {
    return `推广${verb}成功${unitIds.length > 1 ? `（${succ.length} 个单元）` : unitIds.length ? `（单元 ${unitIds[0]}）` : goodsId ? `（商品 ${goodsId}）` : ''}${detail ? `，${detail}` : ''}。`
      + (fail.length ? `\n失败 ${fail.length} 个：${JSON.stringify(fail).slice(0, 200)}` : '')
  }
  // 走通传输层但业务上没做成（如「操作中包含无效推广」）
  if (r.ok && succ.length === 0 && fail.length > 0) {
    return `推广${verb}未生效：服务端返回成功码，但 0 个单元生效。\n`
      + JSON.stringify(fail).slice(0, 300)
      + (fail[0]?.errorMessage ? `\n\n原因：${fail[0].errorMessage}` : '')
  }
  const msg = r.json?.error_msg || r.json?.errorMsg || r.hint || (r.json ? JSON.stringify(r.json).slice(0, 300) : '(无响应)')
  return `推广${verb}失败：${msg}\n\n可能原因：\n`
    + `① 单元不存在或已被删\n`
    + `② 出价类型不同 → bidType/参数结构需调整\n`
    + `③ 该推广类型不支持此操作（如部分类型的 delete 会返回"不支持删除广告"）\n`
    + (r.safeToRetry ? `\n本次**服务端未执行**（${r.ec}），可以安全重试。` : `\n⚠️ 网络异常，**不确定服务端是否已执行** —— 请先到 yingxiao.pinduoduo.com 后台确认，不要盲目重试。`)
}
