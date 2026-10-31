/**
 * 淘宝端到端测试：二维 SKU（specs + skus[].specs）
 *
 * 用法：node dev/test-taobao-e2e.mjs --cat=case [--confirm]
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const CONFIRM = process.argv.includes('--confirm')
const CAT = process.argv.find(a => a.startsWith('--cat='))?.split('=')[1] || 'case'

const { CredentialStore } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js')
const { taobaoPublish } = await import('file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/taobao-publish.js')

const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
const accts = store.listAccounts().filter(a => a.platform === 'taobao' && a.status === 'valid')
if (!accts.length) { console.error('无有效淘宝账号'); process.exit(1) }
const account = accts[0].shop_key

const BASE = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/multicat'
const product = JSON.parse(fs.readFileSync(`${BASE}/${CAT}/product.json`, 'utf8'))

const CATMAP = { case: '手机壳', cup: '杯子', pillow: '抱枕', towel: '毛巾', bottle: '水杯', box: '收纳盒' }
const catKeyword = CATMAP[CAT] || CAT

console.log(`类目: ${catKeyword}`)
console.log(`标题: ${product.title}`)
console.log(`规格: ${(product.specs || []).map(s => `${s.name}(${s.values?.length})`).join(' × ')}`)
console.log(`SKU: ${(product.skus || []).length} 行`)

const prices = (product.skus || []).map(s => parseFloat(s.price)).filter(n => Number.isFinite(n))
const maxPrice = prices.length ? Math.max(...prices) : parseFloat(product.price || '99')

const result = await taobaoPublish(store, {
  channel: 'taobao',
  title: product.title,
  price: String(Math.round((maxPrice + 1.02) * 100) / 100),
  stock: String(product.stock || '100'),
  images: product.images,
  detailImages: product.detailImages || [],
  categoryKeyword: catKeyword,
  account,
  confirm: CONFIRM,
  // ★ 二维规格：显式传 specs + skus[].specs
  specs: product.specs || [],
  skus: (product.skus || []).map(s => ({
    specs: s.specs || null,
    price: s.price,
    stock: s.stock,
    outerId: s.itemNo || '',
  })),
  attributes: (product.attributes || []).map(a => ({ name: a.name, value: a.value })),
})

console.log('\n===== 结果 =====')
console.log(JSON.stringify(result, null, 2).slice(0, 3000))
process.exit(result.ok ? 0 : 1)
