/**
 * 实测：睡衣表单页的规格区结构
 * 目的：看有没有「添加规格类型」按钮、#newSpec、预置维度行
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

console.log('直达睡衣表单页…')
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205133764345',
  { waitUntil: 'domcontentloaded', timeout: 60000 })

// 等规格区出现
let ok = false
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500))
  ok = await p.evaluate(() => {
    const box = document.querySelector('#goods-spec-sku') || document.querySelector('#newSpec')
    const hasBtn = [...document.querySelectorAll('button, div, span, a')].some(e =>
      /^添加规格类型|^添加规格/.test((e.innerText || '').trim()))
    return !!box || hasBtn
  }).catch(() => false)
  if (ok) break
}
console.log('规格区就绪:', ok)
await new Promise(r => setTimeout(r, 2000))

const info = await p.evaluate(() => {
  const out = {}
  // 容器
  out.hasGoodsSpecSku = !!document.querySelector('#goods-spec-sku')
  out.hasNewSpec = !!document.querySelector('#newSpec')
  out.propertyContainers = document.querySelectorAll('.property-container-v2').length
  out.goodsSpecRows = document.querySelectorAll('.goods-spec-row').length

  // 添加规格按钮
  const btns = [...document.querySelectorAll('button, div, span, a')]
    .filter(e => /添加规格|添加自定义|创建规格/.test((e.innerText || '').trim()))
    .map(e => {
      const r = e.getBoundingClientRect()
      return { tag: e.tagName, text: (e.innerText || '').trim().slice(0, 20), w: Math.round(r.width), y: Math.round(r.y), visible: r.width > 20 && r.y >= 0 }
    })
  out.addButtons = btns.slice(0, 6)

  // 规格区所有 input 的 placeholder
  const box = document.querySelector('#goods-spec-sku') || document.querySelector('#newSpec')
  if (box) {
    out.placeholders = [...new Set([...box.querySelectorAll('input')].map(i => i.placeholder || '(无)').filter(Boolean))].slice(0, 12)
    out.inputCount = box.querySelectorAll('input').length
    out.boxText = (box.innerText || '').replace(/\n+/g, ' | ').slice(0, 300)
  }
  return out
})

console.log(JSON.stringify(info, null, 2))

// 截图规格区
const el = await p.$('#goods-spec-sku') || await p.$('#newSpec')
if (el) {
  await el.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/spec_area_pajama.png' })
  console.log('\n规格区截图: spec_area_pajama.png')
}
await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/full_pajama.png' })
console.log('整页截图: full_pajama.png')
await new Promise(r => setTimeout(r, 60000))
process.exit(0)
