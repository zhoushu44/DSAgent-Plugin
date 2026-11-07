/**
 * 逐层核对睡衣表单页规格区结构
 * 只读，不填不改
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 1000 })

await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205133764345',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise(r => setTimeout(r, 12000))

// 逐层核对每个 .property-container-v2
const dims = await p.evaluate(() => {
  const box = document.querySelector('#goods-spec-sku')
  if (!box) return { err: 'no #goods-spec-sku' }
  const containers = [...box.querySelectorAll('.property-container-v2')]
  return containers.map((c, i) => {
    // 维度名
    const title = c.querySelector('.property-name-title')?.textContent?.trim()
      || c.querySelector('[class*="sizeStandardWrapper_title"]')?.textContent?.trim()
      || c.querySelector('input[placeholder^="规格类型"]')?.value
      || ''
    // 输入框
    const inputs = [...c.querySelectorAll('input')].map(inp => ({
      ph: inp.placeholder || '(无)',
      val: (inp.value || '').slice(0, 20),
      w: Math.round(inp.getBoundingClientRect().width),
    })).filter(x => x.w > 20)
    // checkbox 数量（内置规格值）
    const cbs = c.querySelectorAll('.package-item-container').length
    // 操作按钮
    const btns = [...c.querySelectorAll('button, a, span, div')]
      .map(e => (e.innerText || '').trim())
      .filter(t => /^(删除规格类型|添加规格类型|添加自定义|本地上传|开始排序|全部尺码表|启用尺码表)$/.test(t))
    return {
      idx: i + 1,
      title,
      inputs: inputs.slice(0, 4),
      checkboxCount: cbs,
      buttons: [...new Set(btns)],
      hasAddBtn: /添加规格类型|添加自定义/.test([...new Set(btns)].join('|')),
      hasDeleteBtn: /删除规格类型/.test([...new Set(btns)].join('|')),
    }
  })
})

console.log('=== 逐层核对结果 ===')
console.log(JSON.stringify(dims, null, 2))

// 页面上真实的「添加规格类型」按钮（精确匹配）
const addBtn = await p.evaluate(() => {
  const cands = [...document.querySelectorAll('button, a, span, div')]
    .filter(e => {
      const t = (e.innerText || '').trim().replace(/\s+/g, '')
      return /^(添加规格类型|添加规格|添加自定义规格)$/.test(t)
    })
    .map(e => {
      const r = e.getBoundingClientRect()
      return { tag: e.tagName, text: (e.innerText || '').trim(), w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }
    })
  return cands.slice(0, 5)
})
console.log('\n=== 精确匹配「添加规格类型」按钮 ===')
console.log(JSON.stringify(addBtn, null, 2))

await new Promise(r => setTimeout(r, 30000))
process.exit(0)
