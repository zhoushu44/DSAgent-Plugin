/**
 * 用纸杯成功上传的 CDN URL 测试二维 SKU（跳过图片上传，避开风控）
 */
import * as fs from 'node:fs'
import { CredentialStore } from 'file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js'
import { taobaoPublish } from 'file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/taobao-publish.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIRM = process.argv.includes('--confirm')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acct = store.listAccounts().find(a => a.platform === 'taobao' && a.status === 'valid')

// 从纸杯成功日志提取的 15 个真实 CDN URL
const log = fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/taobao_cup_real.txt', 'utf8')
const urls = [...new Set([...log.matchAll(/https:\/\/img\.alicdn\.com\/imgextra\/[^\s，,）)]+\.jpg/g)].map(m => m[0]))]
const mainUrls = urls.slice(0, 5)
const detailUrls = urls.slice(5, 15)

console.log('主图:', mainUrls.length, '| 详情图:', detailUrls.length)

// 二维 SKU 数据（手机壳 型号×颜色）
const product = JSON.parse(fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/multicat/case/product.json', 'utf8'))
const prices = product.skus.map(s => parseFloat(s.price)).filter(n => Number.isFinite(n))
const maxPrice = Math.max(...prices)

console.log('标题:', product.title)
console.log('规格:', product.specs.map(s => `${s.name}(${s.values.length})`).join(' × '))
console.log('SKU:', product.skus.length, '行')

const result = await taobaoPublish(store, {
  channel: 'taobao',
  title: product.title,
  price: String(Math.round((maxPrice + 1.02) * 100) / 100),
  stock: '100',
  imageUrls: mainUrls,
  detailImageUrls: detailUrls,
  categoryKeyword: '手机壳',
  directPublishUrl: 'https://item.upload.taobao.com/sell/v2/publish.htm?catId=50025033',
  account: acct.shop_key,
  confirm: CONFIRM,
  specs: product.specs,
  skus: product.skus.map(s => ({ specs: s.specs, price: s.price, stock: s.stock })),
  attributes: product.attributes,
})

console.log('\n=== 结果 ===')
console.log('ok:', result.ok)
console.log('goodsId:', result.goodsId || '-')
console.log('text:', String(result.text || '').slice(0, 1200))
process.exit(result.ok ? 0 : 1)

