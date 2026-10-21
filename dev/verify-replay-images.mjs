/**
 * 最小验证：只验「逆向 HTTP 上传 + replay 注入 → 主图是否真的渲染出来」。
 *
 * 跳过选类目：直接用 catId 打开发布页（URL 带 catId 时框架直接进表单）。
 * 用法：
 *   node dev/verify-replay-images.mjs                  # catId=50013618（儿童裤子）
 *   node dev/verify-replay-images.mjs --cat=121424009
 */
import puppeteer from 'puppeteer-core'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { findChromePath, profileDir } = await import('../lib/browser-login.js')
const { localImagesToSpaceUrls } = await import('../lib/taobao-image-space.js')
const { buildTaobaoJsonDocument, buildTaobaoJsonReplayInitScript } = await import('../lib/taobao-publish-replay.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
let account = argOf('account')
if (!account) account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
console.log('账号', account)

// ── 素材 ──
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const MAIN = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg']
const DETAIL = ['detail_10.jpg', 'detail_11.jpg']

// ── 1) 逆向 HTTP 上传拿 URL ──
console.log('\n[1] 图片空间上传...')
const t0 = Date.now()
const main = await localImagesToSpaceUrls(MAIN.map((n) => join(SRC, n)), { cookies: acc.cookies || {}, concurrency: 3 })
const det = await localImagesToSpaceUrls(DETAIL.map((n) => join(SRC, n)), { cookies: acc.cookies || {}, concurrency: 3 })
console.log(`    主图 ${main.urls.length}/${MAIN.length}，详情图 ${det.urls.length}/${DETAIL.length}（${Date.now() - t0}ms）`)
for (const f of [...main.failed, ...det.failed]) console.log('    ✗', f.local, f.error)
if (!main.urls.length) { console.error('主图上传全失败'); process.exit(1) }

// ── 2) 注入 replay 并打开发布页 ──
const catId = argOf('cat') || '50013618'
const doc = buildTaobaoJsonDocument({
  title: '验证用标题秋冬儿童休闲长裤',
  price: '59.9',
  stock: '100',
  images: [],
  skus: [{ name: '格蕾灰', price: '59.9', stock: '100' }],
  imageUrls: main.urls,
  detailImageUrls: det.urls,
})

console.log(`\n[2] 启动浏览器，catId=${catId}`)
const dir = profileDir('taobao', account)
const browser = await puppeteer.launch({
  headless: false,
  executablePath: findChromePath(),
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
  defaultViewport: null,
})
const page = (await browser.pages())[0] || (await browser.newPage())
await page.evaluateOnNewDocument(buildTaobaoJsonReplayInitScript(JSON.stringify(doc)))

const cookieList = Object.entries(acc.cookies || {})
  .filter(([, v]) => v !== '' && v != null)
  .flatMap(([name, value]) => ([
    { name, value: String(value), domain: '.taobao.com', path: '/' },
    { name, value: String(value), domain: '.tmall.com', path: '/' },
  ]))
await page.setCookie(...cookieList)

await page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${catId}`,
  { waitUntil: 'domcontentloaded', timeout: 60000 })
console.log('    URL:', page.url().slice(0, 110))

// ── 3) 等表单 ──
console.log('\n[3] 等表单就绪...')
let ready = false
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  ready = await page.evaluate(() => !!document.querySelector('#struct-mainImagesGroup, button[name="button-submit"]')).catch(() => false)
  if (ready) break
}
console.log('    表单就绪 =', ready)

// ── 4) 验收：主图 + 详情（详情走页面自己的上传器，一比一复刻觅千手）──
console.log('\n[4a] 打开「图文描述」tab 让详情编辑器挂载...')
let mounted = false
for (let round = 0; round < 6; round++) {
  const st = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const ed = document.querySelector('#lite-decoration-editor')
    if (ed && ed.querySelector('#panel_edit')) {
      return { mounted: true }
    }
    // 导航是整条容器（文字连成一片），按片段命中并取最小尺寸
    const cands = Array.from(document.querySelectorAll('*'))
      .filter((e) => vis(e) && /图文描述/.test(e.textContent || ''))
      .map((e) => ({ el: e, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
      .filter((o) => o.h > 10 && o.h < 120 && o.w > 20)
      .sort((a, b) => (a.h * a.w) - (b.h * b.w))
    if (cands.length) {
      const t = cands[0].el
      t.scrollIntoView({ block: 'center' })
      t.click()
      return { clicked: true }
    }
    return {}
  }).catch(() => ({}))
  if (st.mounted) { mounted = true; console.log('    编辑器已挂载（轮次 ' + round + '）'); break }
  await sleep(2500)
}
if (!mounted) console.log('    ⚠ 编辑器未挂载')

console.log('\n[4b] 点「添加 → 图片」，打开素材层...')
const opened = await page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null
  const ed = document.querySelector('#lite-decoration-editor')
  if (!ed) return 'no-editor'
  const items = Array.from(ed.querySelectorAll('div,span,button,a'))
  const addTitle = items.find((e) => vis(e) && /add_title/i.test(String(e.className)) && /添加/.test(e.textContent || ''))
  if (addTitle) { try { addTitle.click() } catch { } }
  const pic = items.find((e) => vis(e) && /add_item/i.test(String(e.className)) && (e.textContent || '').trim() === '图片')
  if (!pic) return 'no-pic-item'
  pic.scrollIntoView({ block: 'center' })
  pic.click()
  return 'clicked'
}).catch((e) => 'err:' + e.message)
console.log('    ', opened)
await sleep(3000)

// 等素材弹层 iframe
let dlg = null
for (let i = 0; i < 16 && !dlg; i++) {
  dlg = page.frames().find((f) => /sucai-selector|sucai\.|select\.htm|image-bank/i.test(f.url()))
  if (!dlg) await sleep(900)
}
console.log('    素材弹层 frame:', dlg ? dlg.url().slice(0, 90) : '未出现')

let detailNote = '未尝试'
if (dlg) {
  // 切「本地上传」
  await dlg.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null
    const all = Array.from(document.querySelectorAll('div,span,button,a'))
    const hit = all.find((e) => vis(e) && /^(本地上传|上传图片|上传)$/.test((e.textContent || '').trim()) && e.children.length <= 1)
    if (hit) { try { hit.click() } catch { } }
  }).catch(() => { })
  await sleep(2500)

  // ★ 一比一：页面内 fetch → DataTransfer → File → input.files → dispatchEvent('change')
  // ★ 先用 puppeteer 原生 uploadFile（trusted 事件）——DataTransfer 造的事件
  //   会被部分上传器丢弃，表现为「加了 File 但没上传」。
  const detLocal = det.urls.map((u, i) => {
    const m = u.match(/O1CN[^_]+/)
    return { u, i }
  })
  console.log('    尝试原生 uploadFile 投递…')
  let nativeOk = false
  try {
    const inputEl = await dlg.$('input[type="file"]')
    if (inputEl) {
      // 用本地原图（同源、无需下载）
      const localFiles = [join(SRC, 'detail_10.jpg'), join(SRC, 'detail_11.jpg'), join(SRC, 'detail_12.jpg')]
        .filter((p) => existsSync(p))
      if (localFiles.length) {
        await inputEl.uploadFile(...localFiles)
        nativeOk = true
        console.log('    已投递本地文件:', localFiles.map((p) => p.split(/[\\/]/).pop()).join(','))
      }
    } else {
      console.log('    ⚠ 弹层内无 input[type=file]')
    }
  } catch (e) {
    console.log('    原生投递异常:', e.message)
  }
  if (!nativeOk) {
    console.log('    回退到 DataTransfer 方案')
    const CHUNK = 7
    let total0 = 0
    for (let i = 0; i < det.urls.length; i += CHUNK) {
      const chunk = det.urls.slice(i, i + CHUNK)
      const r = await dlg.evaluate(async (list, startIndex) => {
        const getImgBlob = async (raw) => {
          try {
            let url = String(raw || '').replace('.avif', '')
            if (url.startsWith('//')) url = 'https:' + url
            else if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url
            const ts = Date.now() + '_' + Math.random().toString(36).substring(2, 15)
            const u2 = url + (url.includes('?') ? '&' : '?') + '_nocache=' + ts
            const resp = await fetch(u2, { cache: 'no-store' })
            return resp && resp.status === 200 ? await resp.blob() : null
          } catch { return null }
        }
        let input = null
        for (let t = 0; t < 20 && !input; t++) {
          input = document.querySelector('input[type="file"]')
          if (!input) await new Promise((r2) => setTimeout(r2, 300))
        }
        if (!input) return { ok: false, err: 'no-file-input' }
        const dt = new DataTransfer()
        for (let k = 0; k < list.length; k++) {
          const blob = await getImgBlob(list[k])
          if (!blob) continue
          const f = new File([blob], `detail_${startIndex + k}.jpg`, { type: 'image/jpeg' })
          Object.assign(f, { beginTime: Date.now(), uid: 'la8yta8a' })
          dt.items.add(f)
        }
        if (!dt.items.length) return { ok: false, err: 'no-blob' }
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, count: dt.files.length }
      }, chunk, i).catch((e) => ({ ok: false, err: e.message }))
      console.log('    批', Math.floor(i / CHUNK) + 1, JSON.stringify(r))
      if (r?.ok) total0 += Number(r.count || 0)
    }
  }
  detailNote = nativeOk ? '原生投递完成，等待上传' : `DataTransfer 投递 ${det.urls.length} 张`
  await sleep(8000)

  // ⑦ 等上传完成 → 点「完成」退出上传弹层 → 回到列表选图 → 确认
  await sleep(3000)
  // 7.1 若有「完成」按钮，先点掉上传弹层
  await dlg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === '完成')
    if (b) b.click()
  }).catch(() => { })
  await sleep(3000)

  // 7.2 回到列表：选中刚上传的图（优先最新的前几张）
  const sel = await dlg.evaluate(() => {
    const txt = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim()
    // a) checkbox 方案
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter((b) => b.offsetParent !== null)
    let n = 0
    for (const b of boxes.slice(0, 4)) { if (!b.checked) { try { b.click(); n++ } catch { } } }
    // b) 卡片点击方案
    if (!boxes.length) {
      const cards = Array.from(document.querySelectorAll('img'))
        .filter((im) => im.offsetParent !== null && /imgextra/.test(im.src || ''))
        .slice(0, 4)
      for (const im of cards) {
        const card = im.closest('[class*="item"], [class*="card"], li, div')
        if (card) { try { card.click(); n++ } catch { } }
      }
    }
    // 当前可用按钮
    const btns = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.offsetParent !== null && !b.disabled).map((b) => txt(b))
    // 已选数量提示
    const picked = (document.body.innerText.match(/已选\s*(\d+)/) || [])[1] || ''
    return { n, btns: btns.slice(0, 14), picked }
  }).catch(() => ({ n: 0, btns: [], picked: '' }))
  console.log('    列表选中:', JSON.stringify(sel))

  // 7.3 点确认：按钮文案形如「确定（3）」——带选中数量后缀，必须用前缀匹配
  const okBtn = (sel.btns || []).find((t) => /^(确定|确认|使用选中图片|确定选择|确认上传|完成)(（\d+）|\(\d+\))?$/.test(t))
  if (okBtn) {
    await dlg.evaluate((label) => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => x.offsetParent !== null && !x.disabled && (x.innerText || '').trim() === label)
      if (b) b.click()
    }, okBtn).catch(() => { })
    console.log('    点确认按钮:', okBtn)
  } else {
    console.log('    ⚠ 未找到确认按钮，按钮列表:', JSON.stringify(sel.btns))
  }
  await sleep(6000)
}
console.log('    详情投递:', detailNote)
await sleep(2000)

const res = await page.evaluate(() => {
  const norm = (a) => a.map((s) => String(s || '')).filter(Boolean)
  // 主图
  const mainEl = document.querySelector('.sell-component-simply-images')
  const imgs = mainEl ? norm(Array.from(mainEl.querySelectorAll('img')).map((i) => i.src)) : []
  // 详情
  const ed = document.querySelector('#lite-decoration-editor')
  const edImgs = ed ? norm(Array.from(ed.querySelectorAll('img')).map((i) => i.src)) : []
  // 详情图：排除编辑器自带的 UI 小图标（-tps-WxH 尾缀 / svg / tfs 站内资源）
  const detailOnly = edImgs.filter((s) => /imgextra/i.test(s)
    && !/tps-\d+-\d+\./i.test(s)
    && !/-tps-\d+-\d+\./i.test(s)
    && !/\.(svg|gif|ico)(\?|$)/i.test(s)
    && !/\/tfs\//i.test(s)
    && /2218891961201/.test(s))
  const J = window.Json || {}
  const v = J.components?.mainImagesGroup?.props?.value
  return {
    mainDomImgs: imgs.length,
    mainDomSample: imgs.slice(0, 3),
    mainText: ((mainEl?.innerText) || '').replace(/\s+/g, ' ').slice(0, 100),
    descDomImgs: detailOnly.length,
    descSample: detailOnly.slice(0, 3),
    stateMain: Array.isArray(v?.images) ? v.images.length : 0,
    stateMainSample: Array.isArray(v?.images) ? JSON.stringify(v.images[0])?.slice(0, 150) : null,
    stateDesc: Array.isArray(J.models?.formValues?.wirelessDesc) ? J.models.formValues.wirelessDesc.length : 0,
    hasDescRep: !!(J.models?.formValues?.descRepublicOfSell?.descPageCommitParam?.templateContent),
    replay: window.__kddsReplayResult ? {
      applied: window.__kddsReplayResult.applied,
      merged: window.__kddsReplayResult.mergedFields,
      hookSource: window.__kddsReplayResult.hookSource,
    } : null,
  }
})

console.log('\n===== 验收 =====')
console.log('state(主图) =', res.stateMain, '| 样例:', res.stateMainSample)
console.log('DOM  (主图) =', res.mainDomImgs, '|', res.mainText)
console.log('state(详情) =', res.stateDesc, '| descRepublic=' + res.hasDescRep, '| DOM 详情 img =', res.descDomImgs)
if (res.descSample?.length) console.log('详情图样例 =', res.descSample.join(' | '))
console.log('replay =', JSON.stringify(res.replay))
console.log(res.mainDomImgs > 0 ? '✅ 主图渲染成功' : '❌ 主图未渲染')
console.log(res.descDomImgs > 0 ? '✅ 详情图渲染成功' : '❌ 详情图未渲染')

// 主图出来了就留着窗口人工看；没出来也留着便于继续诊断
console.log('\n浏览器窗口保持打开（10 分钟内可继续查看）')
await sleep(10000)
await browser.close()
process.exit(res.mainDomImgs > 0 ? 0 : 1)
