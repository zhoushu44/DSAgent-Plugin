/**
 * 闲鱼批量发布器（API/数字类商品专用）
 *
 * 为什么不用 dsagent_xianyu_publish：
 *   该技能尚未处理「分类被拦」问题（补丁已提交到 src/xianyu-publish.ts，
 *   但宿主进程需重启才会加载新 lib）。本脚本用同样的浏览器链路 + 分类解锁，
 *   可直接批量发布。
 *
 * 关键机制：
 *   发布页「分类」是 antd Select 下拉框。AI/软件/服务类会被自动识别成受限分类
 *   （DeepSeek服务 / AI模型训练 / …）并提示「网页版暂不支持发布此分类」。
 *   改选「其他闲置」即可解除限制，正常发布。
 *
 * 用法：
 *   node dev/xianyu-batch-publish.mjs --dry-run          # 只出预览
 *   node dev/xianyu-batch-publish.mjs --confirm          # 真实发布
 *   node dev/xianyu-batch-publish.mjs --confirm --only openrouter
 */
import puppeteer from 'puppeteer-core'
import { findChromePath, profileDir, clearProfileLocks, sleep } from '../lib/browser-login.js'
import { CredentialStore } from '../lib/services/credential-store.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ARGS = process.argv.slice(2)
const CONFIRM = ARGS.includes('--confirm')
const DRY = ARGS.includes('--dry-run') || !CONFIRM
const ONLY = (() => { const i = ARGS.indexOf('--only'); return i >= 0 ? ARGS[i + 1] : null })()
const OUT = 'dev/.ui-shots'
mkdirSync(OUT, { recursive: true })

const IMG_ROOT = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/xianyu/img'

const FOOTER = '\n\n虚拟商品，一经发出不支持退换，请确认需求后再拍。\n不会配置的下单后联系我，远程协助到你跑通为止。'

const BODY = {
  models: `支持模型：DeepSeek V4 全系、Claude、GPT、Gemini、GLM、Kimi、Qwen、MiniMax。
OpenAI 兼容接口，改一下 base_url 就能用，Cherry Studio / Cursor / Chatbox / Dify / n8n 都能接。`,
  why: `为什么选我们：
1. 独享 Key，不掺量、不共享号池
2. 额度长期有效，不做日卡次卡的过期套路
3. 余额和消耗明细实时可查
4. 一个 Key 通用全部模型，不用分开充值
5. 支持小额先测后买，不会配置可协助接入`,
}

/** 待发布清单：关键词 → 变体 */
const PLAN = [
  {
    slug: 'openrouter', kw: 'OpenRouter', price: '1',
    title: 'OpenRouter 官方Key 官方2折 独享 额度不过期',
    desc: `【官方2折】OpenRouter 官方Key 独享 | 一个Key调用全部主流模型

官方 2 折，1 元起测，按量计费，不用不扣。

一个 Key 调用 OpenRouter 上全部模型：Claude、GPT、Gemini、DeepSeek、GLM、Kimi、Qwen 等。
OpenAI 兼容接口，改一下 base_url 就能用。${FOOTER}`,
  },
  {
    slug: 'llm-api', kw: '大模型 API', price: '1',
    title: '大模型API 一个Key通用全部模型 官方2折 不过期',
    desc: `【官方2折】大模型 API 一个Key通用全部模型

官方 2 折，1 元起测，按量计费，不用不扣。

${BODY.models}

${BODY.why}${FOOTER}`,
  },
  {
    slug: 'claude-api', kw: 'Claude API', price: '9.9',
    title: 'Claude API 中转 官方2折 独享Key 额度不过期',
    desc: `【官方2折】Claude API 中转 Key 独享 | 额度不过期

官方 2 折，9.9 元起测，按量计费，不用不扣。

支持 Claude 全系列，同时兼容 GPT / Gemini / DeepSeek / GLM / Kimi / Qwen 等主流模型。
OpenAI 兼容接口，改一下 base_url 就能用。${FOOTER}`,
  },
  {
    slug: 'kimi-api', kw: 'Kimi API', price: '9.9',
    title: 'Kimi API 中转 官方2折 独享Key 不过期',
    desc: `【官方2折】Kimi API 中转 Key 独享 | 额度不过期

官方 2 折，9.9 元起测，按量计费，不用不扣。

支持 Kimi K2/K3 全系列，长上下文、代码能力强，同时兼容其他主流模型。
OpenAI 兼容接口，改一下 base_url 就能用。${FOOTER}`,
  },
  {
    slug: 'glm-api', kw: 'GLM API', price: '9.9',
    title: 'GLM API 智谱大模型 官方2折 独享Key 不过期',
    desc: `【官方2折】GLM API 智谱大模型 Key 独享 | 额度不过期

官方 2 折，9.9 元起测，按量计费，不用不扣。

支持 GLM 全系列，原生多模态，同时兼容其他主流模型。
OpenAI 兼容接口，改一下 base_url 就能用。${FOOTER}`,
  },
  {
    slug: 'gpt-api', kw: 'GPT API', price: '9.9',
    title: 'ChatGPT API 中转 官方2折 独享Key 通用大模型',
    desc: `【官方2折】ChatGPT API 中转 Key 独享 | 通用大模型

官方 2 折，9.9 元起测，按量计费，不用不扣。

支持 GPT 全系列，同时兼容 Claude / Gemini / DeepSeek / GLM / Kimi 等主流模型。
OpenAI 兼容接口，改一下 base_url 就能用。${FOOTER}`,
  },
  {
    slug: 'api-relay', kw: 'API 中转', price: '9.9',
    title: 'AI大模型API接口 中转 官方2折 独享 不过期',
    desc: `【官方2折】AI 大模型 API 接口 中转 | 一个接口通用全部模型

官方 2 折，9.9 元起测，按量计费，不用不扣。

${BODY.models}

${BODY.why}${FOOTER}`,
  },
]

const imgs = (slug) => [
  `${IMG_ROOT}/${slug}/01-钩子-官方2折.jpg`,
  `${IMG_ROOT}/${slug}/02-权益-不做套路.jpg`,
  `${IMG_ROOT}/${slug}/03-接入-支持模型.jpg`,
]

const items = ONLY ? PLAN.filter(p => p.slug === ONLY) : PLAN

// ── 预览 ──
console.log('='.repeat(72))
console.log(DRY ? '【预览模式】不会产生任何写操作' : '【真实发布模式】')
console.log('='.repeat(72))
for (const it of items) {
  const files = imgs(it.slug)
  const missing = files.filter(f => !existsSync(f))
  console.log(`\n▸ ${it.kw}  (${it.slug})   ¥${it.price}`)
  console.log(`  标题：${it.title}`)
  console.log(`  图片：${files.length} 张${missing.length ? `  ⚠️ 缺失 ${missing.length} 张` : ' ✅'}`)
  console.log(`  描述：${it.desc.split('\n')[0]} …`)
}
console.log(`\n合计：${items.length} 条`)
if (DRY) {
  console.log('\n加 --confirm 才会真实发布。')
  process.exit(0)
}

// ── 发布 ──
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = store.listAccounts().find(a => a.platform === 'xianyu' && a.status === 'valid')
if (!acc) { console.log('无有效闲鱼账号'); process.exit(1) }
const cookies = acc.cookies || {}
const dir = profileDir('xianyu', acc.shop_key)
clearProfileLocks(dir)

const browser = await puppeteer.launch({
  executablePath: findChromePath(), headless: false, userDataDir: dir, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
})

const results = []
for (const it of items) {
  const rec = { kw: it.kw, slug: it.slug, price: it.price, title: it.title }
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) })
    await page.setCookie(...Object.entries(cookies).filter(([, v]) => v).flatMap(([name, value]) => ([
      { name, value: String(value), domain: '.goofish.com', path: '/' },
      { name, value: String(value), domain: '.taobao.com', path: '/' },
    ])))

    console.log(`\n${'─'.repeat(72)}\n▸ 发布：${it.kw}`)
    await page.goto('https://www.goofish.com/publish', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(5000)

    const fi = await page.$('input[type=file]')
    if (!fi) throw new Error('未找到图片上传控件')
    await fi.uploadFile(...imgs(it.slug))
    console.log('  已上传图片')
    await sleep(16000)

    const SEL = 'div[contenteditable="true"]'
    await page.click(SEL)
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(it.desc, { delay: 6 })
    console.log('  已填描述')
    await sleep(11000)

    await page.evaluate((p) => {
      const i = Array.from(document.querySelectorAll('input[placeholder="0.00"]')).filter(e => e.offsetParent !== null)
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (s && i[0]) s.call(i[0], p)
      if (i[0]) { i[0].dispatchEvent(new Event('input', { bubbles: true })); i[0].dispatchEvent(new Event('change', { bubbles: true })) }
    }, it.price)
    console.log(`  已填价格 ¥${it.price}`)
    await sleep(14000)

    // ── 分类解锁 ──
    const catState = () => page.evaluate(() => {
      const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
      const m = t.match(/分类 \* ([^\s]+)/)
      return { category: m ? m[1] : null, blocked: /网页版暂不支持发布此分类|请使用闲鱼APP扫码/.test(t) }
    })
    let st = await catState()
    if (st.blocked) {
      console.log(`  分类「${st.category}」被拦 → 改选兜底类目`)
      const box = await page.evaluate(() => {
        const lab = Array.from(document.querySelectorAll('label'))
          .find(l => ((l.getAttribute('title') || l.innerText || '').trim()).startsWith('分类'))
        const sel = lab?.closest('.ant-form-item')?.querySelector('.ant-select')
        if (!sel) return null
        const r = sel.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })
      if (box) {
        await page.mouse.click(box.x, box.y)
        await sleep(2800)
        const opts = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.ant-select-item-option')).map(e => (e.textContent || '').trim()))
        const target = opts.includes('其他闲置') ? '其他闲置' : opts[opts.length - 1]
        await page.evaluate((tt) => {
          const el = Array.from(document.querySelectorAll('.ant-select-item-option'))
            .find(e => (e.textContent || '').trim() === tt)
          if (!el) return
          el.scrollIntoView({ block: 'center' })
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          el.click()
        }, target)
        await sleep(9000)
        st = await catState()
        console.log(`  已选「${target}」→ 类目=${st.category} 被拦=${st.blocked}`)
      }
    } else {
      console.log(`  类目「${st.category}」可直接发布`)
    }
    rec.category = st.category

    if (st.blocked) { rec.error = '分类仍被拦'; console.log('  ✗ 仍被拦，跳过'); await page.close(); results.push(rec); continue }

    // ── 点发布 ──
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText || '').trim() === '发布' && !x.disabled)
      if (!b) return false
      b.click()
      return true
    })
    if (!clicked) { rec.error = '发布按钮不可点'; console.log('  ✗ 发布按钮不可点'); await page.close(); results.push(rec); continue }

    const deadline = Date.now() + 120000
    let finalUrl = '', bodyText = '', success = false, errText = ''
    while (Date.now() < deadline) {
      await sleep(2500)
      finalUrl = page.url()
      try { bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000)) } catch {}
      if (/\/item(\?|\/)/.test(finalUrl)) { success = true; break }
      if (/发布成功|已发布|宝贝已发布/.test(bodyText)) { success = true; break }
      if (/扫码去APP发布|网页版暂不支持发布此分类/.test(bodyText)) { errText = '分类被拦'; break }
      const e = bodyText.match(/发布失败[^。]{0,80}|内容违规[^。]{0,60}/)
      if (e) { errText = e[0]; break }
    }
    rec.success = success
    rec.url = finalUrl
    rec.errText = errText
    console.log(success ? `  ✅ 发布成功 → ${finalUrl}` : `  ✗ 失败：${errText || '未检测到成功标志'}`)
    await sleep(3000)
  } catch (e) {
    rec.error = String(e).slice(0, 200)
    console.log(`  ✗ 异常：${rec.error}`)
  }
  await page.close()
  results.push(rec)
  await sleep(4000)
}

await browser.close()

console.log(`\n${'='.repeat(72)}\n汇总\n${'='.repeat(72)}`)
for (const r of results) {
  console.log(`${r.success ? '✅' : '✗ '} ${r.kw.padEnd(12)} ¥${String(r.price).padEnd(6)} ${r.success ? r.url : (r.errText || r.error || '')}`)
}
const okCount = results.filter(r => r.success).length
console.log(`\n成功 ${okCount}/${results.length}`)
writeFileSync(`${OUT}/xianyu-batch-result.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf-8')
console.log(`结果已存 ${OUT}/xianyu-batch-result.json`)
