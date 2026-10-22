/**
 * 拼多多滑块验证 —— 触发 + 截图 + 结构侦察
 *
 * 路线 A 基础设施：负责把验证弹窗抓出来、截图、dump DOM，
 * 识别部分（缺口坐标）交给可插拔的 solver（yydsocr API 或本地算法）。
 *
 * 背景：拼多多验证是**服务端校验轨迹**，弹窗 DOM 在 mms 域的 React 应用里，
 * 验证算法不在页面 JS（已实测：mmsui.Slider 是普通 UI 组件、beastCore_tokens 是主题样式）。
 * 触发条件：/vodka/*、/glide/* 等商品域接口被限流后返回 54001 + verifyAuthToken。
 *
 * 用法（独立侦察）：
 *   node scripts/pdd-slider.mjs --recon [--shop <shopKey>]
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')

const argOf = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined }
const emit = (obj) => { process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n') }

const RECON = process.argv.includes('--recon')
const OUT_DIR = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd-re'

;(async () => {
  const puppeteer = require('puppeteer-core')
  const { CredentialStore } = await import(`file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/lib/services/credential-store.js`)
  const store = new CredentialStore(path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const SHOP = argOf('shop') || argOf('account') || store.findByPlatform('pdd_mms')?.shop_key
  if (!SHOP) { emit({ ok: false, failureKind: 'not_bound', text: '未绑定拼多多商家后台账号' }); process.exit(2) }

  let profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP)
  if (!fs.existsSync(profile)) profile = path.join(homedir(), '.dsh', 'browser-profiles', 'accounts', 'pdd_mms_de55c3e159072dfb5297b234eaa487c3')

  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile, headless: false,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-position=100,50'],
  })
  const page = (await browser.pages())[0] || await browser.newPage()
  const safeEval = async (fn, arg) => {
    for (let i = 0; i < 15; i++) {
      for (const f of page.frames()) { try { return await f.evaluate(fn, arg) } catch { /* 换 */ } }
      await new Promise(r => setTimeout(r, 1500))
    }
    return null
  }

  await page.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise(r => setTimeout(r, 12000))

  // ── 滑块检测 ──
  const findSlider = () => safeEval(() => {
    const cands = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"], [class*="captcha"], [class*="Captcha"], [class*="verify"], [class*="Verify"]'))
      .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150 })
    for (const m of cands) {
      const txt = (m.innerText || '').replace(/\n/g, ' ')
      if (!/滑块|拼图|安全验证|向右/.test(txt)) continue
      const r = m.getBoundingClientRect()
      // 找背景图 + 滑块图
      const imgs = Array.from(m.querySelectorAll('img, canvas')).map(el => {
        const b = el.getBoundingClientRect()
        return {
          tag: el.tagName,
          src: el.tagName === 'IMG' ? (el.src || '').slice(0, 200) : null,
          x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
          vis: b.width > 0 && b.height > 0,
        }
      })
      // 找可能承载背景图的 div（background-image）
      const bgDivs = Array.from(m.querySelectorAll('div'))
        .map(d => {
          const b = d.getBoundingClientRect()
          const bg = getComputedStyle(d).backgroundImage || ''
          return { cls: String(d.className).slice(0, 70), bg: bg.slice(0, 200), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
        })
        .filter(d => d.bg && d.bg !== 'none' && d.w > 100 && d.h > 30)
        .slice(0, 8)
      // 找可拖元素
      const drags = Array.from(m.querySelectorAll('div, span, i'))
        .map(d => {
          const b = d.getBoundingClientRect()
          return { tag: d.tagName, cls: String(d.className).slice(0, 70), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
        })
        .filter(d => d.w > 10 && d.w < 200 && d.h > 10 && d.h < 200)
        .slice(0, 8)
      return { found: true, text: txt.slice(0, 150), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, imgs, bgDivs, drags }
    }
    return { found: false }
  })

  // ① 先看当前有没有（可能之前弹过还在）
  let info = await findSlider()
  // ② 没有就打一次接口触发（只用 1 次，避免加重风控）
  if (!info?.found) {
    console.error('[pdd-slider] 当前无滑块，打 1 次商品列表接口尝试触发...')
    await page.evaluate(async () => {
      const x = new XMLHttpRequest()
      x.open('POST', '/vodka/v2/mms/query/display/mall/goodsList')
      x.setRequestHeader('Content-Type', 'application/json')
      x.send(JSON.stringify({ page: 1, size: 3 }))
    }).catch(() => {})
    // 等弹窗渲染
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000))
      info = await findSlider()
      if (info?.found) break
    }
  }

  if (!info?.found) {
    emit({ ok: false, failureKind: 'risk_control', text: '未触发滑块弹窗（可能已过验证 / 未限流 / 验证方式变更）。' })
    await browser.close(); process.exit(2)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  // 截图：滑块区 + 全页
  const clip = { x: info.rect.x, y: info.rect.y, width: info.rect.w, height: info.rect.h }
  const shot = await page.screenshot({ clip, encoding: 'base64' }).catch(() => null)
  if (shot) fs.writeFileSync(path.join(OUT_DIR, 'slider-crop.png'), Buffer.from(shot, 'base64'))
  const full = await page.screenshot({ encoding: 'base64' }).catch(() => null)
  if (full) fs.writeFileSync(path.join(OUT_DIR, 'slider-full.png'), Buffer.from(full, 'base64'))
  fs.writeFileSync(path.join(OUT_DIR, 'slider-dom.json'), JSON.stringify(info, null, 1))

  emit({
    ok: true, mode: 'recon', shopKey: SHOP,
    text: `滑块已捕获：${info.text}\n弹窗区域：${JSON.stringify(info.rect)}\n图片元素 ${info.imgs.length} 个 / 背景图 div ${info.bgDivs.length} 个 / 可拖元素 ${info.drags.length} 个\n已存盘：slider-crop.png / slider-full.png / slider-dom.json`,
    slider: info,
  })
  await browser.close()
})().catch(e => {
  emit({ ok: false, failureKind: 'api_error', text: `执行异常：${e?.message || String(e)}` })
  process.exit(1)
})
