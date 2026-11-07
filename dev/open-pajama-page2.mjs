/**
 * 打开睡衣表单页（增强版：确保窗口在前台）
 */
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

console.log('启动浏览器…')
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    '--new-window',
    '--window-position=0,0',
    '--window-size=1600,1000',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
  protocolTimeout: 3600000,
})
console.log('浏览器已启动')

const p = await b.newPage()
await p.setViewport({ width: 1600, height: 1000 })

console.log('打开睡衣表单页…')
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205133764345',
  { waitUntil: 'domcontentloaded', timeout: 60000 })

for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500))
  const ok = await p.evaluate(() => !!document.querySelector('#goods-spec-sku')).catch(() => false)
  if (ok) break
}

// 置前 + 滚到规格区
await p.bringToFront().catch(() => {})
await p.evaluate(() => {
  const box = document.querySelector('#goods-spec-sku')
  if (box) box.scrollIntoView({ block: 'start' })
}).catch(() => {})
await new Promise(r => setTimeout(r, 1500))

const st = await p.evaluate(() => ({
  url: location.href,
  dims: document.querySelectorAll('.property-container-v2').length,
  inputs: document.querySelectorAll('#goods-spec-sku input').length,
}))
console.log('已打开:', JSON.stringify(st))
console.log('窗口应在最前，规格区已定位')

// 保持 30 分钟
await new Promise(r => setTimeout(r, 30 * 60 * 1000))
