/**
 * 核实真实上架数量：对比商品列表 vs 日志里的 goodsId
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const LOG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch200_v7.txt'
const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_2384db98bbcb596936cded12513defe7'

// 日志里的 goodsId
const lines = fs.readFileSync(LOG, 'utf8').split('\n')
const loggedIds = new Set()
for (const l of lines) {
  const m = l.match(/goods_id=(\d+)/)
  if (m) loggedIds.add(m[1])
}
console.log(`日志里的 goodsId: ${loggedIds.size} 个`)

for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:' + (fs.existsSync(`${PROFILE}/DevToolsActivePort`)
    ? fs.readFileSync(`${PROFILE}/DevToolsActivePort`, 'utf8').split('\n')[0].trim() : '9222'),
  defaultViewport: null,
}).catch(() => null)

if (!b) { console.log('浏览器未连接，跳过列表核实'); process.exit(0) }

const p = await b.newPage()
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))

// 翻页拿全部（最多 5 页）
const allIds = new Set()
for (let page = 1; page <= 5; page++) {
  const ids = await p.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll('tr')) {
      const m = (row.innerText || '').match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
      if (m) out.push(m[1])
    }
    return out
  }).catch(() => [])
  ids.forEach(i => allIds.add(i))
  console.log(`  第 ${page} 页: ${ids.length} 个，累计 ${allIds.size}`)
  if (ids.length < 20) break
  // 点下一页
  const next = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button, li, a')]
      .find(x => /下一页/.test(x.innerText || '') && !x.className.includes('disabled'))
    if (btn) { btn.click(); return true }
    return false
  }).catch(() => false)
  if (!next) break
  await new Promise(r => setTimeout(r, 5000))
}

console.log(`\n商品列表共 ${allIds.size} 个商品`)

// 交集
const hit = [...loggedIds].filter(i => allIds.has(i))
console.log(`日志 goodsId 在列表中找到: ${hit.length}/${loggedIds.size}`)

await p.close()
process.exit(0)
