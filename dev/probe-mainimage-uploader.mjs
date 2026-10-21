/**
 * 主图走页面自己的素材上传器（与详情图同一机制），让校验认可。
 * 不依赖 replay 注入 state。
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
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const MAIN = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg', 'main_09.jpg', 'main_10.jpg'].map((n) => join(SRC, n))

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
await page.goto('https://item.upload.taobao.com/sell/v2/publish.htm?catId=50013618', { waitUntil: 'domcontentloaded', timeout: 60000 })
for (let i = 0; i < 30; i++) { await sleep(2000); if (await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup')).catch(() => false)) break }
await sleep(3000)

// 点主图区第一个占位框 → 出素材弹层
console.log('点主图占位框...')
const clicked = await page.evaluate(() => {
  const area = document.querySelector('#struct-mainImagesGroup .sell-component-simply-images')
  if (!area) return 'no-area'
  const pick = Array.from(area.querySelectorAll('*')).find((e) => /上传图片/.test(e.textContent || '') && e.offsetParent !== null && e.getBoundingClientRect().width > 40 && e.getBoundingClientRect().width < 200)
    || area.querySelector('[class*="dashed"], [class*="empty"], [class*="upload"]')
  if (!pick) return 'no-pick'
  pick.scrollIntoView({ block: 'center' })
  const r = pick.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
console.log('clicked:', JSON.stringify(clicked))
if (clicked && typeof clicked === 'object') {
  const fc = page.waitForFileChooser({ timeout: 8000 }).catch(() => null)
  await page.mouse.move(clicked.x, clicked.y); await sleep(300); await page.mouse.click(clicked.x, clicked.y)
  const chooser = await fc
  if (chooser) {
    console.log('fileChooser 弹出，直接塞文件')
    await chooser.accept(MAIN)
    await sleep(6000)
  } else {
    console.log('没弹 fileChooser，可能是素材层')
  }
}
// 看弹层
let dlg = null
for (let i = 0; i < 16 && !dlg; i++) {
  dlg = page.frames().find((f) => /sucai-selector|select\.htm|image-bank/i.test(f.url()))
  if (!dlg) await sleep(900)
}
console.log('主图素材弹层:', dlg ? dlg.url().slice(0, 90) : '无')

if (dlg) {
  // 本地上传
  await dlg.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const hit = Array.from(document.querySelectorAll('div,span,button,a')).find((e) => vis(e) && /^(本地上传|上传图片|上传)$/.test((e.textContent || '').trim()) && e.children.length <= 1)
    if (hit) hit.click()
  }).catch(() => { })
  await sleep(2500)
  const inputEl = await dlg.$('input[type="file"]').catch(() => null)
  if (inputEl) {
    console.log('主图投递本地文件...')
    await inputEl.uploadFile(...MAIN)
    // ★ 等上传完成：轮询「完成」按钮出现（不等固定 sleep）
    let doneBtn = null
    for (let i = 0; i < 30; i++) {
      await sleep(2000)
      const st = await dlg.evaluate(() => {
        const txt = (document.body?.innerText || '').replace(/\s+/g, ' ')
        const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.disabled).map((b) => (b.innerText || '').trim())
        return { hasDone: btns.includes('完成'), uploading: /正在上传|上传中/.test(txt), btns: btns.slice(0, 8) }
      }).catch(() => ({ hasDone: false, uploading: false, btns: [] }))
      if (i % 5 === 0) console.log(`  上传等待 ${i}: ${JSON.stringify(st)}`)
      if (st.hasDone && !st.uploading) { doneBtn = 'done'; break }
      if (!st.uploading && i > 8) { doneBtn = 'idle'; break }
    }
    console.log('上传状态:', doneBtn)
    // 点「完成」退出上传面板
    await dlg.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === '完成')
      if (b) b.click()
    }).catch(() => { })
    await sleep(4000)
    // dump 面板（找 checkbox / 已上传图 / 确定按钮）
    const panel = await dlg.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.disabled).map((b) => (b.innerText || '').trim())
      const boxes = document.querySelectorAll('input[type=checkbox]').length
      const imgs = Array.from(document.querySelectorAll('img')).filter((i) => /imgextra/.test(i.src || '')).length
      return { btns: btns.slice(0, 10), checkboxes: boxes, imgextraImgs: imgs, text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 250) }
    }).catch(() => null)
    console.log('弹层面板:', JSON.stringify(panel, null, 1))
    if (panel && panel.checkboxes > 0) {
      // ★ 这是 realtime=true 的即时选择模式：点图即选中（无「确定」按钮）
      //   先勾 checkbox，若没有「确定」就直接点图片卡片
      await dlg.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter((b) => b.offsetParent !== null)
        for (const b of boxes.slice(0, 5)) { if (!b.checked) { try { b.click() } catch { } } }
      }).catch(() => { })
      await sleep(800)
      const sel = await dlg.evaluate(() => ({
        btns: Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.disabled).map((b) => (b.innerText || '').trim()),
      })).catch(() => ({ btns: [] }))
      const okBtn = (sel.btns || []).find((t) => /^(确定|确认)(（\d+）|\(\d+\))?$/.test(t))
      if (okBtn) {
        await dlg.evaluate((label) => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === label)
          if (b) b.click()
        }, okBtn).catch(() => { })
        console.log('主图回填(确定按钮):', okBtn)
        await sleep(4000)
      } else {
        // 没有「确定」按钮 → 直接点前 5 张图卡片（即时选择）
        console.log('无确定按钮，改为直接点图卡片')
        const clickedImgs = await dlg.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img')).filter((i) => i.offsetParent !== null && /imgextra/.test(i.src || ''))
          let n = 0
          for (const im of imgs.slice(0, 5)) {
            const card = im.closest('[class*="item"], [class*="card"], li, div')
            if (card) { try { card.click(); n++ } catch { } }
          }
          return { n, btns: Array.from(document.querySelectorAll('button')).filter((b) => b.offsetParent !== null && !b.disabled).map((b) => (b.innerText || '').trim()) }
        }).catch(() => ({ n: 0, btns: [] }))
        console.log('点图结果:', JSON.stringify(clickedImgs))
        await sleep(3000)
        // 若出现确定按钮就点
        const ok2 = (clickedImgs.btns || []).find((t) => /^(确定|确认)(（\d+）|\(\d+\))?$/.test(t))
        if (ok2) {
          await dlg.evaluate((label) => {
            const b = Array.from(document.querySelectorAll('button')).find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === label)
            if (b) b.click()
          }, ok2).catch(() => { })
          console.log('主图回填(确定2):', ok2)
          await sleep(4000)
        }
      }
    }
  }
}

// 验证主图渲染 + state
const res = await page.evaluate(() => {
  const area = document.querySelector('.sell-component-simply-images')
  const imgs = area ? Array.from(area.querySelectorAll('img')).map((i) => i.src).filter((s) => /imgextra/.test(s)) : []
  const fv = window.Json?.models?.formValues || {}
  return { domImgs: imgs.length, fvImgs: (fv.mainImagesGroup?.images || []).length, errText: (document.body.innerText.match(/1:1主图[^。]{0,40}/) || [])[0] || '' }
})
console.log('\n===== 主图验收 =====')
console.log(JSON.stringify(res, null, 1))
console.log('\n窗口保持 20s')
await sleep(20000)
await browser.close()
