/**
 * B站投稿（内容发布）— host 半区 puppeteer 实现。
 *
 * 为什么走浏览器而不走 biliup CLI（路线已实测排除）：
 *   biliup 的 `login_by_cookies()` → `validate_tokens()` 强制拿 app 级 access_token 请求
 *   passport 的 oauth2/info，网页 SESSDATA 无法推导 app token（伪造返回 -400）；
 *   而两条「网页 Cookie 换凭据」路径（h5/qrcode/confirm、/qrcode/login/confirm）
 *   实测已被 B站 服务端下线（-101 / 502），只剩 TV 扫码（需手机 App 扫一次，不可自动化）。
 *   创作中心上传页用现有 Cookie 可直达（实测 HTTP 200），故改走浏览器。
 *
 * 实测依据（dev/probe-bilibili-*.mjs）：
 *   - 投稿入口 https://member.bilibili.com/platform/upload/video/frame（HTTP 200）
 *   - 页面上有 3 个 input[type=file]，取第 0 个 uploadFile 即生效
 *   - ★ 该页是 SPA：上传后 URL 全程不变（始终停在 /platform/upload/video/frame），
 *     不能用「URL 变化」判编辑页就绪，必须等编辑器 DOM 出现
 *   - 标题 input[placeholder="请输入稿件标题"]（maxlength 80，上传后自动填文件名）
 *   - 标签 input[placeholder="按回车键Enter创建标签"]（maxlength 20，原生 setter + Enter 键可创建）
 *   - 简介 .ql-editor（Quill 富文本，contenteditable）
 *   - 创作声明（必填 *）input[placeholder*="创作声明"] readonly，点击展开
 *     .bcc-select-option-list > li.bcc-option（7 个选项）
 *   - 分区（必填 *）页面会自动预选一个有效分区（.select-item-cont-inserted）
 *   - ★ 主封面（立即投稿必填，存草稿不要求）：未设置时前端 checkArchive 首校验
 *     `hasMainCover` 失败，且 reject 不带参数 → 页面只弹 toast「请先上传封面」，
 *     /x/vu/web/add 从不发出，表现为「点完立即投稿毫无反应」。
 *     页面上无封面专用 file input，改用系统推荐封面 `.cover-recommend-list`（点击即生效）。
 *   - 按钮：span.submit-draft（存草稿）/ span.submit-add（立即投稿）
 *     ★ submit-add 实测在视口外（y≈1099.5 > 视口 900），必须先 scrollIntoView 再点
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'
import { existsSync, statSync } from 'node:fs'

const UPLOAD_URL = 'https://member.bilibili.com/platform/upload/video/frame'
/** SPA 就绪判据：编辑器标题框出现 */
const EDITOR_SELECTOR = 'input[placeholder="请输入稿件标题"]'
const PUBLISH_TIMEOUT_MS = 120_000
const UPLOAD_WAIT_MS = 120_000
/** 创作声明默认选项（必填项，未指定时自动选它） */
const DEFAULT_STATEMENT = '内容无需标注'

export interface BilibiliPublishOptions {
  /** 本地视频文件绝对路径 */
  videoPath: string
  /** 稿件标题（B站限 80 字） */
  title: string
  /** 简介（B站限 2000 字） */
  description?: string
  /** 标签，多个用逗号分隔（B站上限约 10 个，单个 ≤ 20 字） */
  tags?: string
  /** 分区名（如「科技数码」「知识」）。不传则沿用页面自动预选的分区 */
  partition?: string
  /** 创作声明（必填），不传则自动选「内容无需标注」 */
  statement?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface BilibiliPublishResult {
  ok: boolean
  text: string
  /** 需要用户确认（未传 confirm=true 时） */
  needConfirm?: boolean
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  /** 发布成功后的落地页 URL */
  finalUrl?: string
}

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = 'B站发布'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: BilibiliPublishResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'bilibili' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到 B站 账号。请引导用户打开「账号连接」页面添加 B站 账号（扫码登录）后再发布。',
      },
    }
  }
  const res = resolveAccountForRequest(candidates, { shopKey: opts.account, agentId: opts.agentId })
  if (!res.account) {
    const lines = res.choices.map((c, i) =>
      `${i + 1}. ${c.nickname}（账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`)
    return {
      account: null,
      choices: res.choices,
      error: {
        ok: false,
        failureKind: 'need_account_choice',
        accounts: res.choices,
        text: [
          `B站 平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
          '为避免选错账号（错号会静默影响所有使用该平台的技能），请先向用户确认要用哪一个：',
          ...lines,
          '',
          '用户选定后，把对应的 shopKey 传给本次调用的 account 参数重调。★ 绝不要自己挑一个。',
        ].join('\n'),
      },
    }
  }
  return { account: res.account, choices: [] }
}

/** 解析标签字符串为数组（逗号 / 顿号 / 空白分隔），去重并限长 */
function parseTags(raw: string): string[] {
  const list = raw.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of list) {
    const cut = t.slice(0, 20)
    if (seen.has(cut)) continue
    seen.add(cut)
    out.push(cut)
    if (out.length >= 10) break
  }
  return out
}

/** 生成发布预览文案（confirm 前给用户看） */
function buildPreview(account: StoredAccount, opts: BilibiliPublishOptions, tags: string[]): string {
  const desc = (opts.description || '').trim()
  return [
    '【发布预览 · 需用户确认】',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `视频：${opts.videoPath}`,
    `标题：${opts.title}`,
    `标签：${tags.length ? tags.join('、') : '（沿用页面自动推荐标签）'}`,
    `分区：${(opts.partition || '').trim() || '（沿用页面自动预选分区）'}`,
    `创作声明：${(opts.statement || '').trim() || DEFAULT_STATEMENT}`,
    '封面：（未指定时自动选用 B站 系统推荐封面）',
    `简介：${desc ? desc.slice(0, 200) + (desc.length > 200 ? '…' : '') : '（空）'}`,
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正提交投稿。',
    '注意：投稿是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/**
 * B站投稿主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function bilibiliPublish(
  store: CredentialStore,
  opts: BilibiliPublishOptions,
): Promise<BilibiliPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const videoPath = String(opts.videoPath || '').trim()
  const title = String(opts.title || '').trim()
  const description = String(opts.description || '')
  const tags = parseTags(String(opts.tags || ''))

  if (!videoPath) {
    return { ok: false, failureKind: 'api_error', text: '缺少 videoPath（本地视频文件绝对路径）。' }
  }
  if (!existsSync(videoPath)) {
    return { ok: false, failureKind: 'api_error', text: `视频文件不存在：${videoPath}` }
  }
  try {
    const st = statSync(videoPath)
    if (!st.isFile() || st.size === 0) {
      return { ok: false, failureKind: 'api_error', text: `视频文件不可用（非文件或大小为 0）：${videoPath}` }
    }
  } catch (e) {
    return { ok: false, failureKind: 'api_error', text: `无法读取视频文件：${e instanceof Error ? e.message : String(e)}` }
  }
  if (!title) {
    return { ok: false, failureKind: 'api_error', text: '缺少 title（稿件标题）。B站要求标题非空且不超过 80 字。' }
  }
  if (title.length > 80) {
    return { ok: false, failureKind: 'api_error', text: `标题 ${title.length} 字，超过 B站上限 80 字，请精简后重试。` }
  }
  if (description.length > 2000) {
    return { ok: false, failureKind: 'api_error', text: `简介 ${description.length} 字，超过 B站上限 2000 字，请精简后重试。` }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  if (opts.confirm !== true) {
    return {
      ok: false,
      needConfirm: true,
      text: buildPreview(account, { ...opts, videoPath, title, description }, tags),
    }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   按目录加锁才能拦住「发布与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
  //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
  const dir = profileDir('bilibili', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `B站的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}
  const statement = String(opts.statement || '').trim() || DEFAULT_STATEMENT
  const partition = String(opts.partition || '').trim()
  let browser: any = null

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' }
    }

    const launchOpts = {
      // 可见窗口：发布是真实副作用操作，用户应能看到过程；若出现验证也可人工处理
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-bilibili-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入 B站 域 Cookie（domain 必须写 .bilibili.com，member 子域才认）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.bilibili.com', path: '/' }))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-bilibili-publish] 已注入 ${cookieList.length} 个 bilibili.com Cookie（账号 ${shopKey}）`)

    // ── 1. 打开投稿页并上传视频 ────────────────────────────
    console.log('[dsagent-bilibili-publish] 打开投稿页...')
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await new Promise(r => setTimeout(r, 4000))

    // 监听投稿提交接口的真实返回（URL/文案判定不可靠——实测点完投稿页面可能毫无反应）
    let submitResp: { url: string; status: number; body: string } | null = null
    page.on('response', async (resp: any) => {
      try {
        const u: string = resp.url() || ''
        if (/member\.bilibili\.com\/x\/vu\/web\/(add|edit)/i.test(u)) {
          const text = await resp.text()
          submitResp = { url: u, status: resp.status(), body: (text || '').slice(0, 2000) }
          console.log(`[dsagent-bilibili-publish] 投稿接口响应 ${resp.status()} ${u} → ${(text || '').slice(0, 300)}`)
        }
      } catch { /* 忽略 */ }
    })

    // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
    const landedUrl = page.url()
    if (/passport\.bilibili\.com|\/login/i.test(landedUrl)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: `B站 登录态已失效（投稿页被重定向到 ${landedUrl}）。请到「账号连接」页面重新登录 B站 后重试。`,
      }
    }

    await page.waitForSelector('input[type=file]', { timeout: 30_000 })
    const fileInputs = await page.$$('input[type=file]')
    if (!fileInputs.length) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在投稿页找到文件上传控件（input[type=file]），页面结构可能已变更。' }
    }
    console.log('[dsagent-bilibili-publish] 上传视频文件...')
    await fileInputs[0].uploadFile(videoPath)

    // ── 2. 等编辑器就绪（★ SPA：URL 不变，只能等 DOM） ──────
    console.log('[dsagent-bilibili-publish] 等待上传与编辑器加载...')
    try {
      await page.waitForSelector(EDITOR_SELECTOR, { timeout: UPLOAD_WAIT_MS })
    } catch {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: `上传后 ${UPLOAD_WAIT_MS / 1000}s 内编辑器未就绪（当前 URL：${page.url()}）。`
          + '可能原因：视频格式不被支持、上传被风控拦截、或页面结构变更。',
      }
    }
    // 编辑器渲染 + 视频转码状态回填需要一点时间
    await new Promise(r => setTimeout(r, 6000))

    // ── 3. 填标题（上传后会自动填文件名，这里覆盖为用户标题） ──
    const titleOk = await page.evaluate((val: string) => {
      const input = document.querySelector('input[placeholder="请输入稿件标题"]') as HTMLInputElement | null
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, val); else input.value = val
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, title)
    if (!titleOk) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到标题输入框，页面结构可能已变更。' }
    }
    console.log(`[dsagent-bilibili-publish] 已填标题：${title}`)

    // ── 4. 填标签（原生 setter + 回车键创建） ───────────────
    for (const tag of tags) {
      const added = await page.evaluate((val: string) => {
        const input = document.querySelector('input[placeholder*="回车键Enter创建标签"]') as HTMLInputElement | null
        if (!input) return false
        input.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(input, val); else input.value = val
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
        return true
      }, tag)
      if (!added) {
        return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到标签输入框，页面结构可能已变更。' }
      }
      await new Promise(r => setTimeout(r, 800))
    }
    if (tags.length) console.log(`[dsagent-bilibili-publish] 已添加 ${tags.length} 个标签：${tags.join('、')}`)

    // ── 5. 填简介（Quill 富文本） ──────────────────────────
    if (description) {
      const descOk = await page.evaluate((text: string) => {
        const el = document.querySelector('.ql-editor') as HTMLElement | null
        if (!el) return false
        el.focus()
        const sel = window.getSelection()
        if (sel) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          sel.removeAllRanges()
          sel.addRange(range)
        }
        // execCommand 会触发真实的 input 事件，Quill 才能同步到内部状态
        document.execCommand('insertText', false, text)
        return true
      }, description)
      if (!descOk) {
        return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到简介编辑器（.ql-editor），页面结构可能已变更。' }
      }
      console.log(`[dsagent-bilibili-publish] 已填简介（${description.length} 字）`)
    }

    // ── 6. 创作声明（必填 *，默认「内容无需标注」） ──────────
    const stInputVal = await page.evaluate(() => {
      const i = document.querySelector('input[placeholder*="创作声明"]') as HTMLInputElement | null
      return i ? i.value.trim() : null
    })
    if (stInputVal === null) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到创作声明选择器，页面结构可能已变更。' }
    }
    if (!stInputVal) {
      await page.click('input[placeholder*="创作声明"]')
      await new Promise(r => setTimeout(r, 1500))
      const pickedSt = await page.evaluate((want: string) => {
        const list = document.querySelector('.bcc-select-option-list')
        if (!list) return null
        const opts = Array.from(list.querySelectorAll('li.bcc-option')) as HTMLElement[]
        const hit = opts.find(o => (o.innerText || '').trim() === want) || opts[0]
        if (!hit) return null
        hit.click()
        return (hit.innerText || '').trim()
      }, statement)
      await new Promise(r => setTimeout(r, 1000))
      if (!pickedSt) {
        return { ok: false, failureKind: 'api_error', shopKey, text: '创作声明选项列表未能展开，无法完成必填项，请重试。' }
      }
      console.log(`[dsagent-bilibili-publish] 创作声明已选：${pickedSt}`)
    }

    // ── 7. 分区（可选覆盖；不传则沿用页面自动预选） ──────────
    if (partition) {
      const current = await page.evaluate(() => {
        const p = document.querySelector('.video-human-type .select-item-cont') as HTMLElement | null
        return (p?.innerText || '').trim()
      })
      if (current !== partition) {
        await page.click('.video-human-type .select-controller')
        await new Promise(r => setTimeout(r, 2000))
        const ok = await page.evaluate((want: string) => {
          const box = document.querySelector('.video-human-type .select-container')
          if (!box) return false
          const items = Array.from(box.querySelectorAll('li, [class*=option], [class*=item]')) as HTMLElement[]
          const hit = items.find(x => (x.innerText || '').replace(/\s+/g, '').trim() === want)
          if (!hit) return false
          hit.click()
          return true
        }, partition)
        await new Promise(r => setTimeout(r, 1500))
        if (!ok) {
          await page.keyboard.press('Escape')
          return {
            ok: false,
            failureKind: 'api_error',
            shopKey,
            text: `未在分区列表中匹配到「${partition}」。请检查分区名（如「科技数码」「知识」「生活兴趣」），或省略 partition 沿用页面自动预选的分区。`,
          }
        }
        const after = await page.evaluate(() => {
          const p = document.querySelector('.video-human-type .select-item-cont') as HTMLElement | null
          return (p?.innerText || '').trim()
        })
        console.log(`[dsagent-bilibili-publish] 分区：${current} → ${after}`)
      }
    }

    // ── 8. 选主封面（★ 必填；未设置时 checkArchive 首校验 hasMainCover 失败，
    //    且前端 reject 不带参数 → 表现为「点完立即投稿毫无反应」） ──────────
    // 实测：`.cover-recommend-list` 内是系统推荐封面，点第 1 张即可置为主封面；
    // 点击后可能弹出裁剪框，需点「确定/完成/确认/使用」。
    const hasMainCover = await page.evaluate(() => !document.querySelector('.cover-empty'))
    if (!hasMainCover) {
      await page.evaluate(() => document.querySelector('.cover')?.scrollIntoView({ block: 'center' }))
      await new Promise(r => setTimeout(r, 800))
      const coverClicked = await page.evaluate(() => {
        const el = (document.querySelector('.cover-recommend-list .img-item-box.img-item-cover')
          || document.querySelector('.cover-recommend-list .img-item-box')) as HTMLElement | null
        if (!el) return false
        el.click()
        return true
      })
      if (!coverClicked) {
        return {
          ok: false,
          failureKind: 'api_error',
          shopKey,
          text: '稿件未设置主封面，且页面上未找到系统推荐封面（.cover-recommend-list）。'
            + 'B站 要求投稿必须有主封面，请查看浏览器窗口手动上传封面后重试。',
        }
      }
      await new Promise(r => setTimeout(r, 3000))
      // 裁剪弹窗（推荐封面可能进入裁剪流程）
      const cropConfirmed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.bcc-dialog button, [class*="dialog"] button, .bcc-button')) as HTMLElement[]
        const hit = btns.find(b => /确定|完成|确认|使用/.test(b.innerText || ''))
        if (hit) { hit.click(); return (hit.innerText || '').trim() }
        return null
      })
      await new Promise(r => setTimeout(r, 2000))
      if (cropConfirmed) console.log(`[dsagent-bilibili-publish] 已确认封面裁剪：${cropConfirmed}`)
      const coverReady = await page.evaluate(() => !document.querySelector('.cover-empty'))
      if (!coverReady) {
        return {
          ok: false,
          failureKind: 'api_error',
          shopKey,
          text: '已尝试选择系统推荐封面，但主封面仍未设置成功（可能停留在裁剪弹窗）。请查看浏览器窗口手动完成封面设置后重试。',
        }
      }
      console.log('[dsagent-bilibili-publish] 已设置主封面（系统推荐图）')
    }

    // ── 9. 点「立即投稿」 ──────────────────────────────────
    await new Promise(r => setTimeout(r, 1500))
    // ★ 按钮可能在视口外（实测 y≈1099.5 > 900），必须先滚动再点
    await page.evaluate(() => document.querySelector('span.submit-add')?.scrollIntoView({ block: 'center' }))
    await new Promise(r => setTimeout(r, 800))
    const clicked = await page.evaluate(() => {
      const el = document.querySelector('span.submit-add') as HTMLElement | null
      if (!el) return 'missing'
      return /disabled/.test((el.className || '').toString()) ? 'disabled' : 'ok'
    })
    if (clicked === 'missing') {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未找到「立即投稿」按钮（span.submit-add），页面结构可能已变更。' }
    }
    if (clicked === 'disabled') {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '「立即投稿」按钮处于禁用态，说明标题/视频/封面等必填项未通过校验。请查看浏览器窗口内的具体提示。',
      }
    }
    // ★ 必须用真实鼠标点击（page.click）——合成 el.click() 实测无法触发提交
    try {
      await page.click('span.submit-add')
    } catch (e) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: `点击「立即投稿」失败：${e instanceof Error ? e.message : String(e)}。请查看浏览器窗口状态。`,
      }
    }
    console.log('[dsagent-bilibili-publish] 已点击立即投稿，等待结果...')

    // 可能弹出二次确认弹窗（★ 只认 .bcc-dialog 内的明确文案，避免误点其它弹层的「确定」）
    try {
      await new Promise(r => setTimeout(r, 2500))
      const confirmed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.bcc-dialog button, .bcc-dialog .bcc-button')) as HTMLElement[]
        const hit = btns.find(b => b.offsetParent !== null && /确认投稿|继续投稿|确认提交/.test((b.innerText || '').trim()))
        if (hit) { hit.click(); return (hit.innerText || '').trim() }
        return null
      })
      if (confirmed) console.log(`[dsagent-bilibili-publish] 已点击二次确认弹窗：${confirmed}`)
    } catch { /* 无弹窗，忽略 */ }

    // ── 10. 判定投稿结果 ───────────────────────────────────
    // 优先看投稿接口的真实返回码；URL/文案只作辅助（实测两者都可能不变）
    let finalUrl = page.url()
    let bodyText = ''
    let success = false
    let errText = ''
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      finalUrl = page.url()
      try {
        bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 2000))
      } catch { /* 页面跳转中，下一轮再取 */ }

      // 接口返回优先：code=0 即成功；code!=0 直接带着 message 失败
      const resp = submitResp as { url: string; status: number; body: string } | null
      if (resp) {
        try {
          const json = JSON.parse(resp.body) as { code?: number; message?: string; data?: { aid?: number; bvid?: string } }
          if (json.code === 0) {
            success = true
            const bvid = json.data?.bvid ? `（${json.data.bvid}）` : ''
            console.log(`[dsagent-bilibili-publish] 投稿接口 code=0，提交成功${bvid}`)
          } else {
            errText = `接口 code=${json.code}，message=${json.message || '（无）'}`
          }
        } catch {
          // 非 JSON 响应，按 HTTP 状态兜底
          if (resp.status >= 200 && resp.status < 300) success = true
          else errText = `投稿接口 HTTP ${resp.status}`
        }
        break
      }

      if (finalUrl.includes('/platform/upload-manager') && !finalUrl.includes('group=draft')) { success = true; break }
      if (/投稿成功|投递成功|稿件投递成功|提交成功/.test(bodyText)) { success = true; break }
      const err = bodyText.match(/投稿失败[^。]{0,80}|上传失败[^。]{0,60}|请填写[^。]{0,40}|不能为空[^。]{0,30}|内容违规[^。]{0,60}|请勿重复[^。]{0,40}|网络异常[^。]{0,40}/)
      if (err) { errText = err[0]; break }
    }

    // 接口已回但轮询还没走到（时间窗边缘），再兜底看一次
    const respFinal = submitResp as { url: string; status: number; body: string } | null
    if (!success && !errText && respFinal) {
      try {
        const json = JSON.parse(respFinal.body) as { code?: number; message?: string }
        if (json.code === 0) success = true
        else errText = `接口 code=${json.code}，message=${json.message || '（无）'}`
      } catch { /* 保持原判定 */ }
    }

    if (success) {
      // 投稿成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `B站 投稿已提交成功。\n账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${title}\n标签：${tags.length ? tags.join('、') : '（页面自动推荐）'}\n`
          + `当前页面：${finalUrl}\n`
          + '注意：平台可能仍在审核中，最终状态请在 B站 创作中心「稿件管理」中确认。',
      }
    }

    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl,
      text: errText
        ? `投稿失败：${errText}`
        : `点击投稿后 ${PUBLISH_TIMEOUT_MS / 1000}s 内未检测到成功标志（当前 URL：${finalUrl}）。`
          + '请打开浏览器窗口查看具体提示；若出现安全验证请人工完成。',
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `B站 发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
