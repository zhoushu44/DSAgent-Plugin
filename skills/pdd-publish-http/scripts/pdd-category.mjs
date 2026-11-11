#!/usr/bin/env node
/**
 * pdd-category.mjs —— 类目查询 CLI（**纯 Node，不开浏览器**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 两个接口，都走基座 request()（自动签名 / 节流 / Cookie 自愈）
 * ══════════════════════════════════════════════════════════════════
 *
 *   ① 类目搜索   mms.categorySearch   关键词 → 类目树（含 catId）
 *   ② 类目模板   mms.mallTemplate     叶子 catId → 属性 + 规格维度
 *
 * 用法
 * ────
 *   # 按关键词搜类目
 *   node skills/pdd-publish-http/scripts/pdd-category.mjs search --keyword T恤
 *   node skills/pdd-publish-http/scripts/pdd-category.mjs search --keyword T恤 --account pdd_mms_xxx
 *
 *   # 按 catId 拉模板（属性 + 规格维度），并存成标准模板
 *   node skills/pdd-publish-http/scripts/pdd-category.mjs template --cat-id 8463
 *   node skills/pdd-publish-http/scripts/pdd-category.mjs template --cat-id 8463 --save
 *
 *   # 一条龙：关键词 → 取第一个叶子类目 → 拉模板
 *   node skills/pdd-publish-http/scripts/pdd-category.mjs resolve --keyword T恤 --save
 *
 * 输出
 * ────
 *   默认打 JSON（`__DSAGENT_RESULT__` 前缀，供上层解析）
 *   --save 时把标准模板写到 skills/pdd-publish-http/templates/<catId>__<名字>/template.json
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return def
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

function emit(obj) {
  console.log('__DSAGENT_RESULT__' + JSON.stringify(obj))
}

/**
 * 收尾退出。
 *
 * ★ 不要用 process.exit()：Node 24 + undici 连接池还挂着 keep-alive socket 时，
 *   进程退出会撞 libuv 断言（0xC0000409 / "Assertion failed: !(handle->flags &
 *   UV_HANDLE_CLOSING)"），退出码变成 -1073740791 —— 上层会当成失败，
 *   即使结果已经正常打印出来了。
 *   → 设 exitCode，再主动关掉 undici 的 agent，让事件循环自己空掉。
 */
async function finish(code) {
  process.exitCode = code
  try {
    const { getGlobalDispatcher } = await import('undici').catch(() => ({}))
    await getGlobalDispatcher?.()?.close?.()
  } catch { /* ignore */ }
  // 兜底：给事件循环一点时间自然收尾，超时再硬退
  setTimeout(() => process.exit(code), 1500).unref()
}

async function getAccount(shopKey) {
  const { CredentialStore } = await import(pathToFileURL(path.join(PLUGIN, 'lib/services/credential-store.js')).href)
  const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
  const all = store.listAccounts().filter(a => a.platform === 'pdd_mms' && a.status === 'valid')
  if (shopKey) {
    const a = all.find(x => x.shop_key === shopKey)
    if (!a) throw new Error(`找不到有效账号 ${shopKey}（可用：${all.map(x => x.shop_key + '/' + x.display_label).join('、')}）`)
    return a
  }
  if (all.length === 1) return all[0]
  if (!all.length) throw new Error('没有可用的拼多多商家后台账号')
  throw new Error(`有 ${all.length} 个账号，请用 --account 指定：${all.map(x => x.shop_key + '/' + x.display_label).join('、')}`)
}

/** 类目搜索：关键词 → [{catId, path, pathIds}] */
async function searchCategories(keyword, acc, guard) {
  const { callApi } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-request.mjs')).href)
  // 请求出口的节流：由基座在 request() 内调 guard.beforeCall 完成
  if (guard?.beforeCall) await guard.beforeCall('https://mms.pinduoduo.com/vodka/v2/mms/search/categories/v2')
  const r = await callApi('mms.categorySearch', { keyword }, { account: acc, shopKey: acc.shop_key, guard })
  if (!r.ok) throw new Error(`类目搜索失败: ${r.ec || r.failureKind || ''} ${JSON.stringify(r.data || {}).slice(0, 160)}`)
  const j = r.data
  const list = j?.cat_info_v2_lists || j?.result?.cat_info_v2_lists || (Array.isArray(j?.result) ? j.result : []) || []
  return {
    channel: r.channel,
    items: list.map(c => {
      const path = [c.cat_name_1, c.cat_name_2, c.cat_name_3, c.cat_name_4].filter(Boolean)
      const ids = [c.cat_id_1, c.cat_id_2, c.cat_id_3, c.cat_id_4].filter(Boolean)
      return { catId: ids[ids.length - 1], path: path.join(' > '), pathIds: ids, leaf: !!c.cat_name_4 || path.length >= 3 }
    }),
  }
}

/** 拉模板 */
async function pullTemplate(catId, acc) {
  const { fetchMallTemplate, normalizeMall } = await import(pathToFileURL(path.join(PLUGIN, 'skills/pdd-publish-http/templates/index.mjs')).href)
  const raw = await fetchMallTemplate(catId, { shopKey: acc.shop_key })
  const tpl = normalizeMall(raw)
  // ★ 空模板 = 假成功：接口对不存在的 catId / 非叶子类目都返回 200 + 空 modules。
  //   templateId=0 且 0 属性 0 规格维 → 明确报错，别让上层拿空模板去填表。
  const dims = tpl?.specs?.dimensions || []
  if (!tpl?.templateId && !tpl?.attributes?.length && !dims.length) {
    const e = new Error(
      `catId=${catId} 没有可用模板（接口返回空）。`
      + `常见原因：① 传的是一级/二级类目，只有叶子类目才有模板；`
      + `② catId 不存在；③ 该 catId 在当前店铺未开放。`
      + `先用 search 子命令确认叶子 catId。`
    )
    e.code = 'EMPTY_TEMPLATE'
    throw e
  }
  return { raw, tpl }
}

function saveTemplate(tpl) {
  const name = String(tpl?.category?.name || tpl?.templateId || 'unknown').replace(/[\\/:*?"<>|]/g, '_')
  const dir = path.join(PLUGIN, 'skills/pdd-publish-http/templates', `${tpl?.templateId || ''}__${name}`)
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, 'template.json')
  fs.writeFileSync(f, JSON.stringify(tpl, null, 1), 'utf8')
  return f
}

/* ─────────────────────────── main ─────────────────────────── */
async function main() {

const cmd = process.argv[2] || 'resolve'
const shopKey = arg('account')
const save = !!arg('save', false)

try {
  const acc = await getAccount(shopKey)
  const t0 = Date.now()

  // ★ 接入统一风控闸门（准入 + 节流）。本 CLI 是只读的，但仍要走闸门：
  //   ① openTask 做账号准入（冷却 / 健康分 / 账号锁），避免和别的技能并发打同一账号
  //   ② request() 里的 guard.beforeCall 做账号级节流
  const { openTask } = await import(pathToFileURL(path.join(PLUGIN, 'skills/_shared/pdd-guard.mjs')).href)
  const guard = await openTask('pdd-publish-http', acc.shop_key, { lockWaitMs: 120_000 })
  if (guard.blocked) {
    return await finish((emit({ ok: false, failureKind: 'rate_limit', text: `账号 ${acc.shop_key} 当前不可执行：${guard.reason}。期间请勿重复调用。` }), 2))
  }
  guard.startHeartbeat()
  process.on('exit', () => { try { guard.close() } catch { /* ignore */ } })

  if (cmd === 'search') {
    const keyword = arg('keyword')
    if (!keyword) { emit({ ok: false, text: '缺 --keyword' }); return await finish(1) }
    const r = await searchCategories(String(keyword), acc, guard)
    emit({
      ok: true, mode: 'search', account: acc.shop_key, displayLabel: acc.display_label,
      channel: r.channel, ms: Date.now() - t0, count: r.items.length, items: r.items.slice(0, 30),
      text: `【类目搜索 · ${keyword}】共 ${r.items.length} 条（通道 ${r.channel}，${Date.now() - t0}ms）\n`
        + r.items.slice(0, 10).map((x, i) => `  ${i + 1}. ${x.path}  → catId=${x.catId}`).join('\n'),
    })
    return await finish(0)
  }

  if (cmd === 'template') {
    const catId = Number(arg('cat-id') || arg('catId') || 0)
    if (!catId) { emit({ ok: false, text: '缺 --cat-id' }); return await finish(1) }
    const { tpl } = await pullTemplate(catId, acc)
    const saved = save ? saveTemplate(tpl) : null
    const dims = tpl?.specs?.dimensions || []
    emit({
      ok: true, mode: 'template', account: acc.shop_key, channel: 'node', ms: Date.now() - t0,
      templateId: tpl.templateId, category: tpl.category, limits: tpl.limits,
      attributeCount: tpl.attributes.length,
      requiredAttributes: tpl.attributes.filter(a => a.required).map(a => a.label),
      dimensions: dims.map(d => ({ name: d.name, controlType: d.controlType, presetCount: d.presetCount, required: d.required })),
      savedFile: saved,
      text: `【类目模板 · ${catId}】templateId=${tpl.templateId} 类目=${tpl.category?.name}\n`
        + `  属性 ${tpl.attributes.length} 个（必填 ${tpl.attributes.filter(a => a.required).length}：${tpl.attributes.filter(a => a.required).map(a => a.label).join('、') || '无'}）\n`
        + `  规格维 ${dims.length} 个：${dims.map(d => `${d.name}(${d.presetCount}预设)`).join('、') || '该类目不开放规格'}\n`
        + `  SKU 上限 ${tpl.limits?.maxSku ?? '?'}${saved ? `\n  已保存：${saved}` : ''}`,
    })
    return await finish(0)
  }

  if (cmd === 'resolve') {
    const keyword = String(arg('keyword') || '')
    if (!keyword) { emit({ ok: false, text: '缺 --keyword' }); return await finish(1) }
    const s = await searchCategories(keyword, acc, guard)
    if (!s.items.length) {
      emit({ ok: false, text: `关键词「${keyword}」没搜到类目（通道 ${s.channel}）`, account: acc.shop_key })
      return await finish(1)
    }
    const pick = s.items[0]
    const { tpl } = await pullTemplate(pick.catId, acc)
    const saved = save ? saveTemplate(tpl) : null
    const dims = tpl?.specs?.dimensions || []
    emit({
      ok: true, mode: 'resolve', account: acc.shop_key, channel: 'node', ms: Date.now() - t0,
      keyword, catId: pick.catId, categoryPath: pick.path,
      templateId: tpl.templateId, category: tpl.category, limits: tpl.limits,
      attributeCount: tpl.attributes.length,
      requiredAttributes: tpl.attributes.filter(a => a.required).map(a => a.label),
      dimensions: dims.map(d => ({ name: d.name, presetCount: d.presetCount, required: d.required })),
      savedFile: saved,
      text: `【类目解析 · ${keyword}】\n  路径：${pick.path}\n  catId：${pick.catId}  templateId：${tpl.templateId}\n`
        + `  属性 ${tpl.attributes.length} 个 / 规格维 ${dims.length} 个：${dims.map(d => d.name).join('、') || '无'}\n`
        + `  SKU 上限 ${tpl.limits?.maxSku ?? '?'}${saved ? `\n  已保存：${saved}` : ''}`,
    })
    return await finish(0)
  }

  emit({ ok: false, text: `未知子命令：${cmd}（可用：search / template / resolve）` })
  return await finish(1)
} catch (e) {
  emit({ ok: false, failureKind: 'exception', text: `类目查询异常：${String(e?.message || e).slice(0, 300)}` })
  return await finish(1)
}
}

await main()
