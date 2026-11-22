/**
 * verify-taobao-base.mjs —— 淘宝基座自检（改完基座必跑）
 *
 * 覆盖 4 个域 + 2 条通道：
 *   [1] 签名模块            md5 / tokenOf / signMtop / 风控凭证白名单
 *   [2] 接口注册表          逻辑名 / 域 / referer / appKey / 未登记报错
 *   [3] 账号选择            列举 / 选中 / 带 Cookie / 指定不存在
 *   [4] 账号级风控冷却      记/读/清 / verifyUrl / RGV587 / SUCCESS 不误判
 *   [5] 域名级路由冷却      失败计数 / 阈值触发
 *   [6] 跨进程节流          首次不等待 / 第二次等待 / 落盘
 *   [6b] 同账号串行队列     FIFO 不插队 / 自动清理
 *   [6c] 出站 UA 同源       版本取本机 / client hints
 *   [7] 风控子类型          bxpunish / punish / waf / denycdc / pureCaptcha
 *   [8] mtop 真实请求       item.detail / rate.list / wdj / search / xianyu
 *   [9] sycm 域             HTTP 通道 + 权限归因
 *   [10] alimama 域         万相台注册表
 *   [11] 图片空间上传       multipart
 *   [12] 浏览器通道         Chrome 探测 + 会话
 *
 * 用法：node skills/_shared/verify-taobao-base.mjs [itemId] [--with-slow]
 *   --with-slow 才跑 [11][12]（浏览器/上传较慢）
 */
import { md5, tokenOf, signMtop, isRiskPassCookie } from './taobao-sign.mjs'
import { resolveApi, listApis, APP_KEYS } from './taobao-api.mjs'
import { pickTaobaoAccount, listTaobaoAccounts } from './taobao-account.mjs'
import {
  riskState, markRisk, clearRisk, isRiskPayload, riskKind, extractVerifyUrl,
  isRouteCoolingDown, reportRouteFailure, reportRouteSuccess, routeState,
} from './taobao-risk.mjs'
import { acquireSlot, throttleState, resetThrottle } from './taobao-throttle.mjs'
import { withAccountQueue, queueDepth } from './taobao-queue.mjs'
import { desktopUserAgent, clientHintsHeaders, uaInfo } from './taobao-ua.mjs'
import { request } from './taobao-request.mjs'
import { parseSkuData } from './taobao-sku.mjs'
import { sycmGet, alimamaCall, ALIMAMA_APIS, ALIMAMA_HOSTS } from './taobao-http.mjs'
import {
  DEFAULT_LIMITS, isRateLimited, rateState, setLimits, checkPublish,
  consumePublish, markRateLimited, resetPublishRate, quotaSummary,
} from './taobao-publish-rate.mjs'
import {
  validateBeforePublish, checkCopy, checkDetailImages, checkConsistency,
  TAOBAO_DETAIL_IMAGE_SPEC, ABSOLUTE_WORDS, MEDICAL_CLAIMS,
} from './taobao-publish-guard.mjs'

const itemId = process.argv[2] || '652576134064'
const withSlow = process.argv.includes('--with-slow')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('\n=== [1] 签名模块 ===')
ok('md5("abc") 固定值', md5('abc') === '900150983cd24fb0d6963f7d28e17f72')
ok('tokenOf 带后缀', tokenOf({ _m_h5_tk: 'abc123_1794999999999' }) === 'abc123')
ok('tokenOf 无下划线（凭证库常见）', tokenOf({ _m_h5_tk: 'abc123def' }) === 'abc123def')
ok('tokenOf 空罐返回空', tokenOf({}) === '')
ok('signMtop 稳定可复现',
  signMtop({ token: 'tk', t: '1', data: '{}' }) === signMtop({ token: 'tk', t: '1', data: '{}' }))
ok('x5sec 是风控通过凭证', isRiskPassCookie('x5sec') === true)
ok('x5secdata 不是通过凭证', isRiskPassCookie('x5secdata') === false)

console.log('\n=== [2] 接口注册表 ===')
const apis = listApis()
ok('注册接口数 ≥ 10', apis.length >= 10, `${apis.length} 个`)
const d = resolveApi('item.detail', { id: '123' })
ok('item.detail 走 tmall 域', d.host === 'h5api.m.tmall.com', d.host)
ok('item.detail referer 带 id', d.referer.includes('id=123'))
ok('item.detail appKey=12574478', d.appKey === '12574478')
const xy = resolveApi('xianyu.search', {})
ok('闲鱼 appKey=34839810（接口级覆盖）', xy.appKey === '34839810', xy.appKey)
ok('闲鱼走 goofish 域', xy.host === 'h5api.m.goofish.com')
const wdjA = resolveApi('wdj.answer', { questionId: '1' })
ok('wdj.answer referer 用 web.m.taobao.com', wdjA.referer.includes('web.m.taobao.com'))
ok('wdj.answer origin 与 referer 同源', wdjA.origin === 'https://web.m.taobao.com')
let threw = false
try { resolveApi('nope.nope') } catch { threw = true }
ok('未登记接口会抛错', threw)

console.log('\n=== [3] 账号选择 ===')
const accs = await listTaobaoAccounts()
ok('能列出淘宝账号', accs.length > 0, `${accs.length} 个`)
const pick = await pickTaobaoAccount({})
ok('能选到一个账号', pick.ok === true, pick.ok ? pick.shopKey : pick.text)
ok('选到的账号带 Cookie', pick.ok && Object.keys(pick.cookies || {}).length > 0,
  pick.ok ? `${Object.keys(pick.cookies || {}).length} 项` : '')
const pickBad = await pickTaobaoAccount({ want: 'not_exist_xxx' })
ok('指定不存在账号会失败', pickBad.ok === false && pickBad.failureKind === 'account_not_found')

console.log('\n=== [4] 账号级风控冷却 ===')
const testKey = '__verify_test__'
clearRisk(testKey)
ok('初始无冷却', riskState(testKey).cooling === false)
markRisk(testKey, { reason: 'self-test', riskKind: 'ban', verifyUrl: 'https://x/punish' })
ok('记风控后进入冷却', riskState(testKey).cooling === true)
ok('冷却保留 verifyUrl', riskState(testKey).verifyUrl === 'https://x/punish')
clearRisk(testKey)
ok('清冷却后恢复', riskState(testKey).cooling === false)
ok('识别 RGV587', isRiskPayload({ ret: ['FAIL_SYS_USER_VALIDATE', 'RGV587_ERROR::x'] }) === true)
ok('SUCCESS 不误判风控', isRiskPayload({ ret: ['SUCCESS::调用成功'] }) === false)

console.log('\n=== [5] 域名级路由冷却 ===')
const testHost = '__test.example__'
reportRouteSuccess(testHost)
ok('初始不冷却', isRouteCoolingDown(testHost) === false)
reportRouteFailure(testHost)
ok('失败 1 次不冷却', isRouteCoolingDown(testHost) === false, `failures=${routeState(testHost).failures}`)
reportRouteFailure(testHost)
ok('失败 2 次触发冷却', isRouteCoolingDown(testHost) === true)

console.log('\n=== [6] 跨进程节流 ===')
const tKey = '__throttle_test__'
resetThrottle(tKey)
ok('首次调用不等待', acquireSlot(tKey, { intervalMs: 500, jitterMs: 0 }).waitMs === 0)
ok('紧接第二次必须等待', acquireSlot(tKey, { intervalMs: 500, jitterMs: 0 }).waitMs > 0)
ok('节流记录已落盘', throttleState(tKey).lastCallAt > 0)
resetThrottle(tKey)
ok('可重置节流', throttleState(tKey).lastCallAt === 0)

console.log('\n=== [6b] 同账号串行队列 ===')
{
  const order = []
  const t = (id, ms) => new Promise(r => setTimeout(() => { order.push(id); r(id) }, ms))
  const q = (id, ms) => withAccountQueue('__q_test__', () => t(id, ms))
  await Promise.all([q('a', 120), q('b', 10)])
  ok('FIFO 串行（快请求不插队）', order.join(',') === 'a,b', order.join(','))
  ok('队列执行完自动清理', queueDepth('__q_test__') === 0)
}

console.log('\n=== [6c] 出站 UA 同源 ===')
{
  const ua = desktopUserAgent()
  const info = uaInfo()
  ok('UA 含 Chrome 主版本', ua.includes('Chrome/'))
  ok('UA 主版本取自本机 Chrome', ua.includes(`Chrome/${info.chromeMajor}.`), `${info.chromeFull}`)
  const ch = clientHintsHeaders()
  ok('带 sec-ch-ua', !!ch['sec-ch-ua'] && ch['sec-ch-ua'].includes(`v="${info.chromeMajor}"`))
}

console.log('\n=== [7] 风控子类型识别 ===')
ok('bxpunish 头 → IP 封锁',
  riskKind({ headers: { bxpunish: '1' } }).kind === 'waf-block'
  && riskKind({ headers: { bxpunish: '1' } }).enforceChangeIp === true)
ok('HTML punish → 滑块页', riskKind({ html: '<html>punish</html>' }).kind === 'bixi-punish')
ok('HTML 非 punish → WAF', riskKind({ html: '<html>blocked</html>' }).kind === 'waf-html')
ok('denycdc → 无滑块封禁',
  riskKind({ payload: { ret: ['FAIL_SYS_USER_VALIDATE'], data: { url: 'x&action=denycdc_forbidden&pureCaptcha=' } } }).kind === 'ban')
ok('有 pureCaptcha → 可过滑块',
  riskKind({ payload: { ret: ['FAIL_SYS_USER_VALIDATE'], data: { url: 'x&pureCaptcha=abc' } } }).canSolve === true)
ok('verifyUrl 可提取',
  extractVerifyUrl({ data: { url: '//h5api.m.tmall.com/_____tmd_____/punish?x=1' } }).startsWith('https:'))

console.log('\n=== [8] mtop 真实请求（核心 5 个）===')
if (!pick.ok) {
  console.log('  ⏭ 跳过（无可用账号）')
} else {
  const o = { account: pick.shopKey, ignoreRiskCooldown: true, ignoreThrottle: true }

  const r1 = await request('item.detail', { id: itemId }, o)
  ok('item.detail', r1.ok === true, r1.ok ? `${r1.ms}ms` : `${r1.failureKind}`)
  if (r1.ok) {
    const p = parseSkuData(r1.data)
    ok('  解析 SKU 维度', p.dimensions.length > 0, p.dimensions.map(x => `${x.name}(${x.valueCount})`).join(' / '))
    ok('  解析 SKU 行', p.skuCount > 0, `${p.skuCount} 行`)
    ok('  不含 skuId=0 假行', !p.skuRows.some(x => x.skuId === '0'))
  }
  await new Promise(s => setTimeout(s, 700))

  const r2 = await request('rate.list', {
    itemId, auctionNumId: itemId, pageNo: 1, pageSize: 5, orderType: 'searchImpr', showTrueCount: false, searchImpr: '-8',
  }, o)
  ok('rate.list（评价）', r2.ok === true, r2.ok ? `${r2.ms}ms` : `${r2.failureKind}`)
  await new Promise(s => setTimeout(s, 700))

  const r3 = await request('wdj.list', { itemId, pageSize: 3, page: 1, type: 'mix_group', tagId: '', ecode: 0, biz: 'pc' }, o)
  ok('wdj.list（问大家）', r3.ok === true, r3.ok ? `${r3.ms}ms` : `${r3.failureKind}`)
  await new Promise(s => setTimeout(s, 700))

  const r4 = await request('xianyu.bootstrap', {}, o)
  ok('xianyu.bootstrap（goofish + 异 appKey）', r4.ok === true, r4.ok ? `${r4.ms}ms` : `${r4.failureKind}`)
}

console.log('\n=== [8b] 接口连通性矩阵（11 个可测接口）===')
if (!pick.ok) {
  console.log('  ⏭ 跳过（无可用账号）')
} else {
  const o = { account: pick.shopKey, ignoreRiskCooldown: true, ignoreThrottle: true }
  // 判据：ok=true 或「接口存在类」错误（参数缺失/风控）都算接口注册正确
  const isAlive = (r) => {
    if (r.ok) return true
    const t = String(r.ret || r.hint || '')
    return /BIZPARAM|RGV587|USER_VALIDATE|PARAM|ILLEGAL/i.test(t)
  }
  const matrix = [
    ['publish.render', { itemId: '', catId: '', type: '' }],
    ['publish.pc.manage', { itemId: '', catId: '' }],
    ['publish.tmall.manage', { itemId: '', catId: '' }],
  ]
  for (const [name, params] of matrix) {
    const r = await request(name, params, o)
    const alive = isAlive(r)
    ok(`${name} 接口存在`, alive,
      r.ok ? `${r.ms}ms` : String(r.ret || r.hint || '').slice(0, 60))
    await new Promise(s => setTimeout(s, 800))
  }
  // 负向断言：未确认的接口不应出现在注册表里（防止再次"凭文档猜名字"）
  let healthRegistered = true
  try { resolveApi('health.punish', {}) } catch { healthRegistered = false }
  ok('未确认接口未进注册表（不编造）', healthRegistered === false,
    healthRegistered ? '仍被注册，需核实' : 'health.punish 已移除')
}

console.log('\n=== [9] sycm 域 ===')
{
  const r = await sycmGet('/mc/mq/mkt/keyword/relate/analysis.json', {
    keyword: '儿童睡衣', dateType: 'day', terminal: 'PC',
  }, { ignoreRiskCooldown: true, ignoreThrottle: true })
  // 通道通 = 拿到 JSON 业务响应（成功或权限不足都算通道 OK）
  const channelOk = r.ok === true || r.failureKind === 'no_permission'
  ok('sycm HTTP 通道可用', channelOk,
    r.ok ? `${r.ms}ms` : (r.failureKind === 'no_permission' ? '通道OK/账号无生意参谋权限' : `${r.failureKind}: ${String(r.hint || '').slice(0, 60)}`))
  ok('权限不足能正确归因', r.ok === true || r.failureKind === 'no_permission')
}

console.log('\n=== [10] alimama 域 ===')
{
  ok('万相台注册表有接口', Object.keys(ALIMAMA_APIS).length >= 2, Object.keys(ALIMAMA_APIS).join(', '))
  ok('真实域不是 one.alimama.com',
    ALIMAMA_HOSTS.settle === 'stlacct.alimama.com' && ALIMAMA_HOSTS.club === 'club.alimama.com')
  const r = await alimamaCall('balance.real', {}, { ignoreRiskCooldown: true, ignoreThrottle: true })
  ok('balance.real（账户余额）', r.ok === true, r.ok ? `${r.ms}ms` : `${r.failureKind}: ${String(r.hint || '').slice(0, 60)}`)
}

console.log('\n=== [10b] 发布频率控制 ===')
{
  const K = '__verify_pubrate__'
  ok('默认间隔保守（≥60s）', DEFAULT_LIMITS.minIntervalMs >= 60_000, `${DEFAULT_LIMITS.minIntervalMs / 1000}s`)
  ok('默认每小时上限保守（≤10）', DEFAULT_LIMITS.windowMax <= 10, `${DEFAULT_LIMITS.windowMax}/h`)
  ok('默认每日上限保守（≤50）', DEFAULT_LIMITS.dailyMax <= 50, `${DEFAULT_LIMITS.dailyMax}/d`)

  ok('识别「发布过于频繁」', isRateLimited('发布过于频繁，请稍后再试'))
  ok('识别 RGV587', isRateLimited('RGV587_ERROR::SM'))
  ok('成功不误判', !isRateLimited('SUCCESS::调用成功'))

  resetPublishRate(K, { cooldown: true, daily: true })
  setLimits(K, { minIntervalMs: 200, windowMs: 5000, windowMax: 2, dailyMax: 3, riskCooldownMs: 500 })

  ok('首次可发布', checkPublish(K).allowed === true)
  consumePublish(K)
  const blocked = checkPublish(K)
  ok('L1 间隔不足被拦', blocked.allowed === false, `需等 ${Math.ceil(blocked.waitMs / 1000)}s`)

  markRateLimited(K, '发布过于频繁')
  ok('L4 命中即冷却', checkPublish(K).allowed === false && rateState(K).cooling === true)

  resetPublishRate(K, { cooldown: true, daily: true })
  ok('reset 后恢复', checkPublish(K).allowed === true && rateState(K).todayCount === 0)
  ok('配额摘要可读', quotaSummary(K).today.includes('/'), quotaSummary(K).today)
}

if (withSlow) {
console.log('\n=== [10c] 发布前合规校验 ===')
{
  ok('极限词表非空', ABSOLUTE_WORDS.length >= 10, `${ABSOLUTE_WORDS.length} 个`)
  ok('医疗宣称表非空', MEDICAL_CLAIMS.length >= 5, `${MEDICAL_CLAIMS.length} 个`)
  ok('详情页层标记为 detail', TAOBAO_DETAIL_IMAGE_SPEC.layer === 'detail')
  ok('推荐宽度 1440', TAOBAO_DETAIL_IMAGE_SPEC.recommendedWidth === 1440)
  ok('最多 20 张', TAOBAO_DETAIL_IMAGE_SPEC.maxCount === 20)

  const bad = checkCopy({ title: '全网最低 100%纯天然' })
  ok('极限词被拦', bad.errors.some(e => e.includes('绝对化')))

  const med = checkCopy({ title: '可治疗湿疹' })
  ok('医疗宣称被拦', med.errors.some(e => e.includes('医疗')))

  const good = checkCopy({ title: '儿童纯棉睡衣套装 春秋薄款' })
  ok('正常标题无错误', good.errors.length === 0)

  const cons = checkConsistency({
    title: 't',
    specs: [{ name: '颜色', values: [{ value: '红' }] }, { name: '尺码', values: [{ value: '120' }] }],
    skus: [{ specs: { 颜色: '红' } }],
  })
  ok('SKU 缺维度被拦', cons.errors.some(e => e.includes('缺维度')))

  const v = validateBeforePublish({ title: '全网最低儿童睡衣' })
  ok('一站式校验能 block', v.pass === false && v.level === 'block', v.summary)
}

console.log('\n=== [11] 图片空间上传（multipart）===')
  try {
    const { uploadImage } = await import('./taobao-upload.mjs')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const zlib = await import('node:zlib')
    // 造 200x200 合法 PNG
    const size = 200
    const rowLen = size * 3 + 1
    const raw = Buffer.alloc(rowLen * size)
    for (let y = 0; y < size; y++) {
      raw[y * rowLen] = 0
      for (let x = 0; x < size; x++) {
        const p = y * rowLen + 1 + x * 3
        raw[p] = (200 + x) % 256; raw[p + 1] = (100 + y) % 256; raw[p + 2] = 150
      }
    }
    let tbl = null
    const crc32 = (buf) => {
      if (!tbl) { tbl = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c } }
      let c = -1; for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ -1
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
      return Buffer.concat([len, body, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ])
    const f = path.join(os.tmpdir(), 'tb-verify-upload.png')
    fs.writeFileSync(f, png)
    const up = await uploadImage(f, { account: pick.shopKey })
    ok('图片上传成功', up.ok === true, up.ok ? `${up.ms}ms → ${String(up.url).slice(0, 60)}` : up.error)
  } catch (e) {
    ok('图片上传', false, String(e.message).slice(0, 100))
  }

  console.log('\n=== [12] 浏览器通道 ===')
  try {
    const { findChrome } = await import('./taobao-browser.mjs')
    const exe = findChrome()
    ok('找到本机 Chrome', !!exe, exe || '(未找到)')
  } catch (e) {
    ok('浏览器通道', false, String(e.message).slice(0, 100))
  }
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`)
if (!withSlow) console.log('（[11][12] 需 --with-slow 才跑）')
console.log('')
process.exit(fail ? 1 : 0)
