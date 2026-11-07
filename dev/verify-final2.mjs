import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const LOG = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch200_v7.txt'
const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_2384db98bbcb596936cded12513defe7'

const lines = fs.readFileSync(LOG, 'utf8').split('\n')
const loggedIds = new Set()
for (const l of lines) {
  const m = l.match(/goods_id=(\d+)/)
  if (m) loggedIds.add(m[1])
}
console.log(`日志 goodsId: ${loggedIds.size} 个`)

for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort', 'lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 3600000,
})
console.log('浏览器已启动')

const p = await b.newPage()
await p.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 10000))

const allIds = new Set()
for (let page = 1; page <= 6; page++) {
  const ids = await p.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll('tr')) {
      const m = (row.innerText || '').match(/(?:商品)?ID\s*[:：]\s*(\d{10,20})/)
      if (m) out.push(m[1])
    }
    return out
  }).catch(() => [])
  ids.forEach(i => allIds.add(i))
  console.log(`  第 ${page} 页: +${ids.length}，累计 ${allIds.size}`)
  if (ids.length < 20) break
  const next = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button, li, a')]
      .find(x => /下一页/.test(x.innerText || '') && !String(x.className).match(/disabled/))
    if (btn) { btn.click(); return true }
    return false
  }).catch(() => false)
  if (!next) break
  await new Promise(r => setTimeout(r, 5000))
}

console.log(`\n列表共 ${allIds.size} 个商品`)
const hit = [...loggedIds].filter(i => allIds.has(i))
console.log(`日志 goodsId 在列表中找到: ${hit.length}/${loggedIds.size}`)

// 统计本次运行新增的（ID 不在运行前快照的）
const before = new Set(['1023974144424', '1024207509667', '1023496708207', '1024209904685', '1023538811624', '1023540165321', '1024320425495', '1024320995423', '1024321798961', '1024323623448', '1024365173156', '1024463162124', '1024479277964', '1024484841048', '1024504873962', '1024507514288', '1024513071414', '1024520141223', '1024521552888', '1024522644344', '1024524375166'])
const newOnes = hit.filter(i => !before.has(i))
console.log(`本次运行(第7轮)新增: ${newOnes.length} 个`)

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/final_list.png' })
console.log('截图: final_list.png')
await new Promise(r => setTimeout(r, 60000))
