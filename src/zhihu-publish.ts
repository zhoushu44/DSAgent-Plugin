/**
 * 知乎专栏文章发布 — host 半区 puppeteer 实现。
 *
 * 为什么走浏览器而不能走网关纯 HTTP：
 *   知乎「发布文章」的真实提交走 `zhuanlan.zhihu.com/api/articles`，
 *   请求体是 Draft.js 的 raw contentState（含 entityMap / blockMap），
 *   且需带 x-xsrftoken 与站点签名。浏览器路线下页面自身完成全部序列化与签名，
 *   同时复用已有登录态 Profile，绕开「contentState 构造 + 签名」两座山。
 *
 * 实测依据（dev/probe-zhihu-editor.mjs / probe-zhihu-fill-scheme.mjs）：
 *   - 写文章入口 https://zhuanlan.zhihu.com/write
 *   - 标题是 `textarea[placeholder*="请输入标题"]`（React 受控，限 100 字）
 *   - 正文是 Draft.js 的 `div.public-DraftEditor-content`（contenteditable）
 *   - ★ 正文填法实测三选一（FIX：execCommand 会与 Draft.js 内部状态错乱，
 *     出现文本重复 + 段落顺序颠倒 + 字数统计只认首段）：
 *       · execCommand insertText  → ✗ 文本重复、顺序颠倒
 *       · CDP Input.insertText    → △ 内容正确但换行不分段（块数恒 1）
 *       · 剪贴板 paste 事件        → ✓ 分段正确、字数统计正确（采用）
 *       · keyboard.type 逐段       → ✓ 正确但慢（备选）
 *   - 「发布」按钮为 `button.Button--primary`，初始 disabled，
 *     标题与正文都非空后才解禁（可作为「内容已就位」的天然校验）
 *   - 发布设置（封面 / 话题 / 投稿至问题）是页面侧栏，非阻塞弹窗
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'

const WRITE_URL = 'https://zhuanlan.zhihu.com/write'
const PUBLISH_TIMEOUT_MS = 120_000
/** 标题上限（知乎编辑器 placeholder 明示「最多 100 个字」） */
const TITLE_MAX = 100
/** 正文上限（知乎长文限制，保守取 5 万字） */
const CONTENT_MAX = 50_000

export interface ZhihuPublishOptions {
  /** 文章标题（知乎限 100 字） */
  title: string
  /** 文章正文纯文本，用 \n 分段 */
  content: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface ZhihuPublishResult {
  ok: boolean
  text: string
  /** 需要用户确认（未传 confirm=true 时） */
  needConfirm?: boolean
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  /** 发布成功后的文章 URL */
  finalUrl?: string
}

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '知乎发布'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: ZhihuPublishResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'zhihu' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到知乎账号。请引导用户打开「账号连接」页面添加知乎账号（扫码登录或手动导入 Cookie）后再发布。',
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
          `知乎平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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

/** 生成发布预览文案（confirm 前给用户看） */
function buildPreview(account: StoredAccount, opts: ZhihuPublishOptions): string {
  const content = (opts.content || '').trim()
  const head = content.slice(0, 300)
  return [
    '【发布预览 · 需用户确认】',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `标题：${opts.title}`,
    `正文：共 ${content.length} 字，${content.split('\n').filter(Boolean).length} 段`,
    '———— 正文开头 ————',
    head + (content.length > 300 ? '\n……（已截断）' : ''),
    '———— 正文结束 ————',
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正发布。',
    '注意：文章发布是不可撤销的真实操作（L2），发布后即为公开可见状态。',
  ].join('\n')
}

/**
 * 知乎文章发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function zhihuPublish(
  store: CredentialStore,
  opts: ZhihuPublishOptions,
): Promise<ZhihuPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const title = String(opts.title || '').trim()
  const content = String(opts.content || '').trim()

  if (!title) {
    return { ok: false, failureKind: 'api_error', text: '缺少 title（文章标题）。知乎要求标题非空且不超过 100 字。' }
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, failureKind: 'api_error', text: `标题 ${title.length} 字，超过知乎上限 ${TITLE_MAX} 字，请精简后重试。` }
  }
  if (!content) {
    return { ok: false, failureKind: 'api_error', text: '缺少 content（文章正文）。知乎要求正文非空。' }
  }
  if (content.length > CONTENT_MAX) {
    return { ok: false, failureKind: 'api_error', text: `正文 ${content.length} 字，超过上限 ${CONTENT_MAX} 字，请精简后重试。` }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  if (opts.confirm !== true) {
    return { ok: false, needConfirm: true, text: buildPreview(account, { ...opts, title, content }) }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   按目录加锁才能拦住「发布与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
  //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
  const dir = profileDir('zhihu', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `知乎的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
        + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
    }
  }

  const shopKey = account.shop_key
  const accountCookies = account.cookies || {}
  let browser: any = null

  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as { launch: (opts: any) => Promise<any> }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' }
    }

    const launchOpts = {
      // 可见窗口：发布是真实副作用操作，用户应能看到过程；若出现安全验证也可人工处理
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-zhihu-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入知乎域 Cookie（domain 必须写 .zhihu.com，zhuanlan 子域才认）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.zhihu.com', path: '/' }))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-zhihu-publish] 已注入 ${cookieList.length} 个 zhihu.com Cookie（账号 ${shopKey}）`)

    // ── 1. 打开写文章编辑器 ────────────────────────────────
    console.log('[dsagent-zhihu-publish] 打开写文章编辑器...')
    await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    // Draft.js 编辑器挂载 + 草稿加载需要一点时间
    await new Promise(r => setTimeout(r, 6000))

    // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
    const landedUrl = page.url()
    if (/signin|sign_in|login/i.test(landedUrl)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: `知乎登录态已失效（写文章页被重定向到 ${landedUrl}）。请到「账号连接」页面重新登录知乎后重试。`,
      }
    }

    // ── 2. 填标题 ─────────────────────────────────────────
    // 标题是 React 受控 textarea：直接赋值不会触发 onChange，
    // 必须走原生 value setter + 派发 input 事件。
    const titleOk = await page.evaluate((val: string) => {
      const input = (document.querySelector('textarea[placeholder*="请输入标题"]')
        || document.querySelector('textarea.Input')) as HTMLTextAreaElement | null
      if (!input) return false
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(input, val); else input.value = val
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, title)
    if (!titleOk) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑器找到标题输入框（textarea[placeholder*="请输入标题"]），页面结构可能已变更。' }
    }
    console.log(`[dsagent-zhihu-publish] 已填标题：${title}`)

    // ── 3. 填正文 ─────────────────────────────────────────
    // ★ Draft.js 必须走剪贴板 paste 事件：execCommand 会与编辑器内部状态错乱
    //   （实测出现文本重复 + 段落顺序颠倒 + 字数统计只认首段），
    //   而 paste 事件由 Draft.js 的 onPaste 处理，能正确解析 \n 为独立段落。
    const bodyOk = await page.evaluate((text: string) => {
      const el = (document.querySelector('div.public-DraftEditor-content')
        || document.querySelector('[contenteditable="true"]')) as HTMLElement | null
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
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      return true
    }, content)
    if (!bodyOk) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑器找到正文输入区（div.public-DraftEditor-content），页面结构可能已变更。' }
    }
    console.log(`[dsagent-zhihu-publish] 已填正文（${content.length} 字）`)

    // ── 4. 校验内容已就位 ──────────────────────────────────
    // 知乎编辑器会把正文字数实时回填到页面（「字数：N」）。
    // 用它做一次落地校验，避免「填了但编辑器没收到」导致后续点不动发布按钮。
    await new Promise(r => setTimeout(r, 2500))
    const landed = await page.evaluate(() => {
      const el = document.querySelector('div.public-DraftEditor-content')
      const blocks = el ? el.querySelectorAll('[data-block="true"]').length : 0
      const t = document.body.innerText || ''
      const m = t.match(/字数[：:]\s*(\d+)/)
      const pub = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === '发布') as HTMLButtonElement | undefined
      return { blocks, charCount: m ? Number(m[1]) : null, publishDisabled: pub ? pub.disabled : null }
    })
    if (!landed.charCount) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '正文插入后编辑器未回填字数（可能未同步到编辑器内部状态）。请打开浏览器窗口确认后重试。',
      }
    }
    console.log(`[dsagent-zhihu-publish] 编辑器已就位：字数=${landed.charCount}，段落数=${landed.blocks}`)

    // ── 5. 点「发布」 ──────────────────────────────────────
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const hit = btns.find(b => (b.innerText || '').trim() === '发布' && !(b as HTMLButtonElement).disabled)
      if (!hit) return false
      hit.click()
      return true
    })
    if (!clicked) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '未找到可点击的「发布」按钮（仍处于禁用态，说明标题或正文未通过编辑器校验）。请打开浏览器窗口确认后重试。',
      }
    }
    console.log('[dsagent-zhihu-publish] 已点击发布，等待结果...')

    // ── 6. 判定发布结果 ────────────────────────────────────
    // 知乎发布成功后一般跳转到文章页 https://zhuanlan.zhihu.com/p/{id}；
    // 失败则停留编辑页并弹错误提示。
    let finalUrl = page.url()
    let bodyText = ''
    let success = false
    let errText = ''
    const deadline = Date.now() + PUBLISH_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      finalUrl = page.url()
      try {
        bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000))
      } catch { /* 页面跳转中，下一轮再取 */ }

      if (/zhuanlan\.zhihu\.com\/p\/\d+/.test(finalUrl)) { success = true; break }
      if (/发布成功|已发布|文章已发布/.test(bodyText)) { success = true; break }
      const err = bodyText.match(/发布失败[^。]{0,80}|标题不能为空[^。]{0,40}|请输入正文[^。]{0,40}|内容违规[^。]{0,60}|含有[^。]{0,20}违规[^。]{0,40}|网络异常[^。]{0,40}|操作过于频繁[^。]{0,40}/)
      if (err) { errText = err[0]; break }
    }

    if (success) {
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `知乎文章已发布成功。\n账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${title}\n文章链接：${finalUrl}\n`
          + `注意：平台可能仍在审核中，最终状态请在知乎「创作中心 → 内容管理」中确认。`,
      }
    }

    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl,
      text: errText
        ? `发布失败：${errText}`
        : `点击发布后 ${PUBLISH_TIMEOUT_MS / 1000}s 内未检测到成功标志（当前 URL：${finalUrl}）。`
          + `请打开浏览器窗口查看具体提示；若出现安全验证请人工完成。`,
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `知乎发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
