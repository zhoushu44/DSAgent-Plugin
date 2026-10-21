/**
 * 诊断：读类目属性的真实「必填」标记 + 每个属性的 kind / 候选可用性。
 * 输出到 dev/.ui-shots/attrs-diag.json，用于修 required 判定与兜底策略。
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)

const browser = await puppeteer.launch({
  headless: false, executablePath: findChromePath(), userDataDir: profileDir('taobao', account),
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,950'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.setCookie(...Object.entries(acc.cookies || {}).filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ])))
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618',
  { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

const diag = await page.evaluate(() => {
  const root = document.getElementById('struct-catProp')
  if (!root) return { err: 'no struct-catProp' }
  const out = []
  for (const it of Array.from(root.querySelectorAll('[id^="struct-p-"]'))) {
    const fieldId = 'sell-field-' + it.id.replace(/^struct-/, '')
    const field = document.getElementById(fieldId)
    if (!field) { out.push({ id: it.id, noField: true }); continue }
    const labelEl = field.querySelector('.sell-component-info-wrapper-label')
    const rawLabel = (labelEl?.textContent || '')
    // 各种必填线索
    const reqClasses = Array.from(field.querySelectorAll('*'))
      .map((e) => String(e.className || ''))
      .filter((c) => /required|must|necessary/i.test(c)).slice(0, 4)
    const stars = Array.from(field.querySelectorAll('*'))
      .filter((e) => /^[*＊]$/.test(((e).innerText || '').trim()) && e.children.length === 0)
      .length
    const ac = field.querySelector('.next-select-auto-complete')
    const trg = field.querySelector('.next-select-trigger')
    const inp = field.querySelector('input, textarea')
    out.push({
      id: it.id,
      name: (labelEl?.innerText || rawLabel).replace(/[*＊]/g, '').replace(/\s+/g, ''),
      rawLabel: rawLabel.replace(/\s+/g, ' ').slice(0, 40),
      hasStarInLabel: /[*＊]/.test(rawLabel),
      starEls: stars,
      reqClasses,
      kind: ac ? 'combobox' : (trg ? 'select' : 'text'),
      filled: !!((inp?.value || '').trim() || ((field.querySelector('.next-select-values')?.innerText) || '').trim()),
      val: (inp?.value || '').slice(0, 20),
      // 必填提示文案（字段下方）
      helpText: ((field.querySelector('.next-form-item-help, [class*="help"]')?.innerText) || '').replace(/\s+/g, ' ').slice(0, 60),
    })
  }
  // 页面「错误(N)」面板内容
  const errPanel = Array.from(document.querySelectorAll('*'))
    .filter((e) => /必填项未填|必填/.test((e.textContent || '')) && e.children.length === 0)
    .map((e) => (e.textContent || '').trim().slice(0, 50))
    .slice(0, 20)
  return { attrs: out, errPanel }
})

import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync(join('dev', '.ui-shots'), { recursive: true })
writeFileSync(join('dev', '.ui-shots', 'attrs-diag.json'), JSON.stringify(diag, null, 2))
console.log('属性数:', diag.attrs?.length)
console.log('带 * 的:', diag.attrs?.filter((a) => a.hasStarInLabel || a.starEls > 0).map((a) => a.name))
console.log('有 required class 的:', diag.attrs?.filter((a) => a.reqClasses.length).map((a) => [a.name, a.reqClasses]))
console.log('未填的:', diag.attrs?.filter((a) => !a.filled).map((a) => `${a.name}(${a.kind})`))
console.log('错误面板:', JSON.stringify(diag.errPanel))
console.log('\n前 8 项明细:')
for (const a of (diag.attrs || []).slice(0, 8)) console.log(' ', JSON.stringify(a))

await sleep(5000)
await browser.close()
