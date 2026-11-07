import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

// ★ 路径推导（替代原硬编码绝对路径）：本文件在 skills/<name>/scripts/ 下，上推三层到插件根
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..')
const PKG_BASE = [
  path.join(PLUGIN_ROOT, 'package.json'),
  path.join(HERE, 'package.json'),
].find(p => fs.existsSync(p)) || path.join(tmpdir(), 'pdd-script-base.json')
/**
 * 拼多多 · 一款多链接批量铺（pdd-link-matrix）
 *
 * 场景：一个款铺 N 条链接 / 主图分裂 / 批量主图 + 详情页
 *
 * 做法：同一个 product，换 title + 主图，多次调 pdd-publish-http。
 *       spec-pool 自动从全店采集，保证 spec_id 一致。
 *
 * 风控（2026-10-24 补）：
 *   · 每条链接间隔 30s+随机 0~10s（避免高频）
 *   · 每条发布前 checkAccountUsable（冷却中即停）
 *   · 每条发布后 recordToAntiban（健康分）
 *   · 遇到风控立即停，不继续铺（越铺越封）
 *
 * 用法：
 *   node scripts/matrix.mjs --product-file <json> --variants <json> [--confirm true]
 *
 *   --variants: [{title, images, desc?}, ...]
 */

const require = createRequire(PKG_BASE)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const argOf = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  if (i < 0 || i + 1 >= process.argv.length) return undefined
  const v = process.argv[i + 1]
  return v.startsWith('--') ? undefined : v
}
const has = (n) => process.argv.includes(`--${n}`)
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const productFile = argOf('product-file')
const variantsArg = argOf('variants')
const confirm = has('confirm') && argOf('confirm') !== 'false'
const account = argOf('account')

if (!productFile || !variantsArg) {
  emit({
    ok: false, failureKind: 'api_error',
    text: '必须带 --product-file <基础商品 JSON> 和 --variants <变体 JSON 数组>\n\n'
      + '例：\n'
      + '  --product-file base.json --variants \'[{"title":"A款","images":["/img/a1.jpg"]},{"title":"B款","images":["/img/b1.jpg"]}]\'\n\n'
      + '也可用 --variants-file <path> 传文件。',
  })
  process.exit(2)
}

let variants
try {
  variants = JSON.parse(variantsArg)
} catch {
  emit({ ok: false, failureKind: 'api_error', text: '--variants 不是合法 JSON' })
  process.exit(2)
}
if (!Array.isArray(variants) || !variants.length) {
  emit({ ok: false, failureKind: 'api_error', text: '--variants 必须是非空数组' })
  process.exit(2)
}

const base = JSON.parse(fs.readFileSync(productFile, 'utf8'))

// ─── 预览 ───
if (!confirm) {
  const L = [`【一款多链接铺货预览 · ${variants.length} 条 · 需用户确认】`, '']
  L.push(`基础商品：${base.title || '(无标题)'}`)
  L.push(`规格维度：${(base.specs || []).map(d => d.name).join('、') || '无'}`)
  L.push(`SKU 行数：${(base.skus || []).length}`)
  L.push('')
  L.push('将发布：')
  variants.forEach((v, i) => {
    L.push(`  ${i + 1}. ${v.title}`)
    L.push(`     主图 ${(v.images || []).length} 张${v.desc ? ` | 描述 ${String(v.desc).slice(0, 30)}` : ''}`)
  })
  L.push('')
  L.push(`风控策略：每条间隔 45s（--gap 可调，下限 20s），共约 ${Math.ceil(variants.length * 45 / 60)} 分钟。`)
  L.push('遇到风控立即停止（不继续铺，越铺越封）。')
  L.push('')
  L.push('确认后请带 --confirm true 重新调用。注意：这是不可撤销的真实操作（L2）。')
  emit({ ok: false, needConfirm: true, mode: 'matrix', count: variants.length, text: L.join('\n') })
  process.exit(0)
}

// ─── 真实执行 ───
;(async () => {
  const { checkAccountUsable, recordToAntiban } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-error.mjs`)
  const { CredentialStore } = await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))

  let SHOP = account || store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.cookies?.['PASS_ID']).slice(-1)[0]?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  // ★ 2026-11-04 迁移到统一风控闸门（pdd-guard）
  //   原实现：checkAccountUsable（前置检查）+ 手写 tryAcquireAccountLock 块。
  //   收敛后：冷却/健康分/锁由 openTask 一次搞定；批次内间隔仍保留（见下方 GAP_MS）。
  //   ⚠️ 闸门内部已持锁，**不要保留旧的 tryAcquireAccountLock**（会自己锁死自己）。
  const { openTask } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-guard.mjs`)
// ★ 2026-11-05：接口路径由基座注册表管理
const { API: _API } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/_shared/pdd-api.mjs')
  const guard = await openTask('pdd-link-matrix', SHOP, { lockWaitMs: 300_000 })
  if (guard.blocked) {
    emit({
      ok: false, failureKind: 'rate_limit',
      text: `账号 ${SHOP} 当前不可执行：${guard.reason}。\n`
        + '批量铺货风险最高，切勿与其他任务同时打同一个号。\n'
        + '请等待当前任务结束后再试。',
    })
    process.exit(2)
  }
  guard.startHeartbeat()
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })

  const results = []
  let stopped = false

  // ★ 2026-11-04 修（P0）：矩阵铺货是**频率放大最严重**的场景——
  //   一次调用 = N 次真实商品发布，且全部落在 /glide/ /vodka/（最严的发布域）。
  //   原实现只有「每条前检查冷却」，**没有任何间隔**：上一条刚提交完，
  //   立刻发下一条，平台侧看就是纯脚本节奏。
  //   这里加批次内强制间隔（默认 45s，--gap 可调，下限 20s），
  //   并且间隔后重新确认账号可用（上一条可能已经触发 54001）。
  //
  //   ⚠️ 解析要点：`process.argv.indexOf('--gap')` 未命中时返回 -1，
  //   直接拿 argv[-1+1]=argv[0]（node 可执行路径）会得到 NaN。
  //   必须先判 `>= 0` 再取值。
  const _gapEq = process.argv.find(a => a.startsWith('--gap='))
  const _gapIdx = process.argv.indexOf('--gap')
  const _gapRaw = _gapEq
    ? Number(_gapEq.split('=')[1])
    : (_gapIdx >= 0 ? Number(process.argv[_gapIdx + 1]) : 45)
  const GAP_MS = Math.max(20_000, (Number.isFinite(_gapRaw) && _gapRaw > 0 ? _gapRaw : 45) * 1000)
  console.error(`[matrix] 风控间隔：每条之间 ${(GAP_MS / 1000).toFixed(0)}s（--gap 可调，下限 20s）`)

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]
    console.error(`[matrix] ${i + 1}/${variants.length} ${v.title}`)

    // ★ 2026-11-04：批次内强制间隔（第 2 条起）
    if (i > 0) {
      console.error(`[matrix] [风控间隔] 等待 ${(GAP_MS / 1000).toFixed(0)}s…`)
      await new Promise(r => setTimeout(r, GAP_MS))
    }

    // 每条前都检查（可能上一条触发了风控 / 或刚刚等间隔的这段时间里被别处打了）
    // ★ 2026-11-04：改用闸门 beforeCall（内部 reserveSlot 会顺带占一个时间槽，
    //   所以在批次间隔之外还有账号级最小间隔兜底）。
    // ★ 2026-11-05：节流 key 从注册表取
    const pre = await guard.beforeCall('https://mms.pinduoduo.com' + _API['goods.commitSubmit'].path)
    if (!pre.allow) {
      stopped = true
      results.push({ i: i + 1, title: v.title, ok: false, reason: pre.reason })
      break
    }

    const product = {
      ...base,
      title: v.title,
      images: v.images || base.images,
      ...(v.desc ? { desc: v.desc } : {}),
      ...(v.detailImages ? { detailImages: v.detailImages } : {}),
    }

    let r
    try {
      const { pddPublish2 } = await import(`file:///${PLUGIN_ROOT}/lib/pdd-publish2.js`)
      r = await pddPublish2(store, { product, confirm: true, mode2: true, account: SHOP })
    } catch (e) {
      r = { ok: false, failureKind: 'exception', text: e?.message?.slice(0, 150) }
    }

    await recordToAntiban(SHOP, r?.ok ? 1000000 : null, r?.ok ? 'ok' : null).catch(() => {})
    results.push({
      i: i + 1, title: v.title,
      ok: !!r?.ok,
      shopKey: r?.shopKey,
      finalUrl: r?.finalUrl,
      failureKind: r?.failureKind,
      text: r?.text ? String(r.text).slice(0, 200) : '',
    })

    // 风控即停
    if (!r?.ok && ['risk_control', 'token_expired', 'rate_limit'].includes(r?.failureKind)) {
      stopped = true
      console.error(`[matrix] ⚠️ 命中 ${r.failureKind}，停止后续铺货`)
      break
    }

    // 间隔 30s + 随机 0~10s（最后一条不等）
    if (i < variants.length - 1) {
      const gap = 30000 + Math.floor(Math.random() * 10000)
      console.error(`[matrix] 等待 ${(gap / 1000).toFixed(0)}s...`)
      await sleep(gap)
    }
  }

  const okCount = results.filter(x => x.ok).length
  const L = [`一款多链接铺货结果：成功 ${okCount}/${results.length}`, '']
  results.forEach(x => {
    L.push(`  ${x.ok ? '✅' : '❌'} ${x.i}. ${x.title}`)
    if (x.finalUrl) L.push(`     ${x.finalUrl}`)
    if (!x.ok && x.text) L.push(`     ${x.text.split('\n')[0]}`)
  })
  if (stopped) {
    L.push('')
    L.push(`⚠️ 因风控/会话问题提前停止，剩余 ${variants.length - results.length} 条未发布。`)
    L.push('等账号恢复后再继续（换 --variants 传剩余条目）。')
  }

  emit({
    ok: okCount > 0,
    mode: 'matrix',
    shopKey: SHOP,
    total: variants.length,
    succeeded: okCount,
    stopped,
    results,
    text: L.join('\n'),
  })
  process.exit(okCount === variants.length ? 0 : (okCount > 0 ? 1 : 2))
})().catch(async (e) => {
  const { normalizeError } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-error.mjs`).catch(() => ({}))
  const n = normalizeError ? normalizeError(e, '批量铺货') : { failureKind: 'exception', text: `异常：${e?.message?.slice(0, 200)}` }
  emit({ ok: false, failureKind: n.failureKind, text: n.text })
  process.exit(2)
})
