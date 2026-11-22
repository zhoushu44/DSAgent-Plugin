/**
 * run-api.mjs —— 淘宝基座通用调用桥（给 Python 技能用）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要这个桥
 * ══════════════════════════════════════════════════════════════════
 *   Python 技能进程拿不到 Cookie（网关强制 `include_cookie=false`），
 *   没法自己签 mtop。所以 Python 侧把「接口名 + 参数」交给本脚本，
 *   由 Node 侧从凭证库取 Cookie、走基座发请求，把结果 JSON 打回 stdout。
 *
 * ══════════════════════════════════════════════════════════════════
 * 用法（Python 侧）
 * ══════════════════════════════════════════════════════════════════
 *   node skills/_shared/run-api.mjs \
 *        --api item.detail \
 *        --params '{"id":"652576134064"}' \
 *        --out /path/result.json
 *
 *   # 需要自定义 data（如搜索接口的 {appId, params} 两层结构）
 *   --data '{"appId":"34385","params":"{...}"}'
 *
 *   # 批量：多个 itemId 串行拉取
 *   --batch item.detail --ids 123,456 --out result.json
 *
 * 输出：{ ok, api, results:[{ok,ms,data,...}|{ok:false,failureKind,hint}], summary }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = __dirname   // _shared 目录

const { request } = await import(new URL(`file:///${path.join(BASE, 'taobao-request.mjs').replace(/\\/g, '/')}`).href)

function argOf(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? def : v
}
function flag(name) {
  return process.argv.includes('--' + name)
}

const apiName = argOf('api', '')
const batchName = argOf('batch', '')
const paramsRaw = argOf('params', '{}')
const dataRaw = argOf('data', '')
const idsRaw = argOf('ids', '')
const outPath = argOf('out', '')
const account = argOf('account', '')

const opts = {
  account,
  get: flag('get'),
  ignoreRiskCooldown: flag('ignore-risk'),
  ignoreThrottle: flag('ignore-throttle'),
  noRetry: flag('no-retry'),
}

const result = { ok: false, api: apiName || batchName, results: [], summary: {} }

try {
  if (batchName) {
    const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean)
    if (!ids.length) throw new Error('--batch 需要 --ids')
    const items = []
    const errors = []
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      console.error(`[run-api] ${i + 1}/${ids.length} ${id}`)
      const r = await request(batchName, { id }, opts)
      if (r.ok) items.push({ id, ms: r.ms, data: r.data })
      else {
        errors.push({ id, failureKind: r.failureKind, hint: r.hint, riskKind: r.riskKind, remainMs: r.remainMs })
        if (['risk_control', 'token_expired', 'route_cooldown'].includes(r.failureKind)) break
      }
    }
    result.results = items
    result.errors = errors
    result.ok = errors.length === 0
    result.summary = { requested: ids.length, succeeded: items.length, failed: errors.length }
  } else {
    if (!apiName) throw new Error('需要 --api 或 --batch')
    const params = paramsRaw ? JSON.parse(paramsRaw) : {}
    const r = await request(apiName, params, { ...opts, dataJson: dataRaw || '' })
    result.ok = r.ok
    result.results = [r]
    result.ms = r.ms
    if (!r.ok) {
      result.failureKind = r.failureKind
      result.hint = r.hint
      result.riskKind = r.riskKind
      result.remainMs = r.remainMs
      result.verifyUrl = r.verifyUrl
    }
  }
} catch (e) {
  result.ok = false
  result.error = String(e?.message || e)
}

const json = JSON.stringify(result, null, 1)
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, 'utf8')
  console.error(`[run-api] 已写入 ${outPath}`)
}
process.stdout.write(json)
