/**
 * 解析 dev/.size-spec-dom.html（probe5 抓到的第二维规格区快照），
 * 用 puppeteer setContent 离线还原 DOM（无需登录），结构化输出：
 *   - SKU 表（thead/tbody 逐行）
 *   - 全部 input
 *   - 尺码 chips 容器（package-item-container）的选中态
 *   - 规格区内的按钮文案（找「确定/生成/应用」等提交入口）
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core')
const { findChromePath } = await import('../lib/browser-login.js')

const html = readFileSync('dev/.size-spec-dom.html', 'utf-8')
const browser = await puppeteer.launch({ headless: true, executablePath: findChromePath(), args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setContent(`<div id="root">${html}</div>`, { waitUntil: 'domcontentloaded' })

const out = await page.evaluate(() => {
  const root = document.getElementById('root')
  const q = (sel) => Array.from(root.querySelectorAll(sel))
  const txt = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim()

  const tables = q('table').map(t => ({
    thead: Array.from(t.querySelectorAll('thead th')).map(x => txt(x)),
    rows: Array.from(t.querySelectorAll('tbody tr')).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => txt(td).slice(0, 24))),
  }))

  const inputs = q('input').map(i => ({
    type: i.type, ph: i.placeholder || '', val: i.value || '',
    cls: String(i.className || '').slice(0, 50),
    parentTxt: txt(i.parentElement || i).slice(0, 40),
  }))

  const chips = q('.package-item-container').slice(0, 12).map(c => ({
    text: txt(c).slice(0, 40),
    checked: !!c.querySelector('input[type=checkbox]:checked'),
    hasCheckedCls: /checked|active|selected/i.test(c.className + ' ' + (c.innerHTML.match(/class="[^"]*"/g) || []).join(' ')),
    inner: c.innerHTML.replace(/\s+/g, ' ').slice(0, 260),
  }))

  const buttons = q('button,[role=button],.BTN_outerWrapper_5-188-0').map(b => txt(b)).filter(Boolean).slice(0, 40)

  return { tableCount: tables.length, tables, inputCount: inputs.length, inputs, chipCount: chips.length, chips, buttons }
})

console.log(JSON.stringify(out, null, 1))
await browser.close()
