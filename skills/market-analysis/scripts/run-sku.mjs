/**
 * run-sku.mjs —— market-analysis 的 SKU 阶段（基座版）
 *
 * 为什么单独一个 Node 脚本：
 *   SKU 明细必须走 taobao-request 基座（纯 Node md5 自签），
 *   而 Python 技能进程里拿不到 Cookie（网关 include_cookie=false），
 *   只能由 Node 直接读凭证库。所以 Python 侧用子进程调它。
 *
 * 用法：
 *   node run-sku.mjs --item-ids 123,456 --out C:\path\sku.json --account <shopKey>
 *
 * 输出 JSON：
 *   { ok, items:[{itemId,title,shopName,skuCount,dimensions,skuRows,...}], errors:[], summary:{} }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// scripts/ → market-analysis/ → skills/ → 基座在 skills/_shared/
const BASE_DIR = path.resolve(__dirname, '..', '..', '_shared')
const { fetchSkuBatch } = await import(new URL('file:///' + path.join(BASE_DIR, 'taobao-sku.mjs').replace(/\\/g, '/')).href)

function argOf(name, def = '') {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return def
  return process.argv[i + 1] ?? def
}

const itemIdsRaw = argOf('item-ids', '')
const outPath = argOf('out', '')
const account = argOf('account', '')
const intervalMs = Number(argOf('interval', '1200'))
const limit = Number(argOf('limit', '0')) || 0

if (!itemIdsRaw) {
  console.error('缺少 --item-ids')
  process.exit(2)
}

let itemIds = itemIdsRaw.split(',').map(s => s.trim()).filter(Boolean)
if (limit > 0) itemIds = itemIds.slice(0, limit)

console.error(`[SKU] 开始：${itemIds.length} 个商品`)

const { items, errors } = await fetchSkuBatch(itemIds, {
  account,
  intervalMs,
  onProgress: (i, total, id) => console.error(`[SKU] ${i}/${total} ${id}`),
})

const summary = {
  requested: itemIds.length,
  succeeded: items.length,
  failed: errors.length,
  skuRows: items.reduce((n, x) => n + (x.skuCount || 0), 0),
  avgSkuPerItem: items.length
    ? +(items.reduce((n, x) => n + (x.skuCount || 0), 0) / items.length).toFixed(2)
    : 0,
  products: items.map(x => ({
    itemId: x.itemId,
    title: x.title,
    shopName: x.shopName,
    skuCount: x.skuCount,
    dimensions: x.dimensions,
    priceBeforeMin: x.priceBeforeMin,
    priceBeforeMax: x.priceBeforeMax,
    priceAfterMin: x.priceAfterMin,
    priceAfterMax: x.priceAfterMax,
    inStockCount: x.inStockCount,
  })),
}

const payload = { ok: errors.length === 0, items, errors, summary }
const json = JSON.stringify(payload, null, 1)
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, json, 'utf8')
  console.error(`[SKU] 已写入 ${outPath}`)
}
process.stdout.write(json)
