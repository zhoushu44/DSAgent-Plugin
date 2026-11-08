/**
 * audit-all-api.mjs - 全接口实测盘点
 *
 * 对注册表里所有接口逐个实测，产出准确的能力清单。
 * 只做只读探测，不执行任何写操作。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = 'pdd_mms_2b1bca962e5fba5172e3edc19a09e406'
const GID = 1025317086069
const CID = 205398721152

const api = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-api.mjs')).href)
const { request, detectDomain } = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-request.mjs')).href)
const seedStore = await import(pathToFileURL(path.join(ROOT, 'skills/_shared/pdd-seed-store.mjs')).href)
const { CredentialStore } = await import(pathToFileURL(path.join(ROOT, 'lib/services/credential-store.js')).href)

const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => String(a.shop_key) === SHOP)
const account = { cookies: acc.cookies, localStorage: seedStore.readSeed(SHOP)?.localStorage || {} }

/** 已知参数（只读场景） */
const KNOWN_BODY = {
  '/glide/v2/mms/addProperties/goodsList': { page_num: 1, page_size: 3, only_query_no_props_goods: false, only_query_un_auth_brand: false },
  '/glide/v2/mms/addProperties/goods/count': { only_query_no_props_goods: false, only_query_un_auth_brand: false },
  '/vodka/v2/mms/query/sku/info': { goodsId: GID },
  '/vodka/v2/mms/query/display/mall/goodsList': { pre_sale_type: 4, page: 1, out_goods_sn_gray_flag: true, shipment_time_type: 3, is_onsale: 1, sold_out: 0, size: 3 },
}

const entries = Object.entries(api.API)

console.log('AUDIT START')
console.log(`total=${entries.length}`)

const results = []
let i = 0
for (const [key, spec] of entries) {
  i++
  const domain = detectDomain(spec.path)
  const body = KNOWN_BODY[spec.path] || {}
  const method = spec.method || 'POST'

  let r
  try {
    r = await request(spec.path, body, { account, shopKey: SHOP, method, domain })
  } catch (e) {
    r = { ok: false, ec: 'EXC', hint: String(e.message).slice(0, 40), channel: 'none' }
  }

  const line = `${String(i).padStart(3)}/${entries.length} ${key.padEnd(26)} ${spec.path.slice(0, 46).padEnd(46)} ec=${String(r.ec).padEnd(9)} ch=${r.channel || '-'}`
  console.log(line)
  results.push({ key, path: spec.path, method, domain, ok: r.ok, ec: r.ec, channel: r.channel, hint: String(r.hint || '').slice(0, 60) })

  await new Promise(s => setTimeout(s, 1200))
}

const ok = results.filter(r => r.ok)
console.log('\n=== SUMMARY ===')
console.log(`OK   = ${ok.length}`)
console.log(`FAIL = ${results.length - ok.length}`)

// 按错误码分组
const byEc = {}
for (const r of results.filter(x => !x.ok)) {
  const k = String(r.ec)
  byEc[k] = byEc[k] || []
  byEc[k].push(r)
}
console.log('\n--- failures by code ---')
for (const [ec, arr] of Object.entries(byEc).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\nec=${ec} (${arr.length})`)
  for (const r of arr) console.log(`   ${r.key.padEnd(26)} ${r.path.slice(0, 60)} ${r.hint ? '| ' + r.hint : ''}`)
}

fs.writeFileSync(path.join(ROOT, 'skills/_shared/.audit-all.json'), JSON.stringify(results, null, 1), 'utf8')
console.log('\nSAVED')
await new Promise(r => setTimeout(r, 200))
process.exit(0)
