/**
 * 抖音投稿（内容发布）— host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP（路线 A 已实测排除）：
 *   投稿的核心动作是**视频文件上传（multipart 二进制）**，而网关 handleProxy
 *   只支持字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
 *   浏览器路线下页面自身请求自带签名，同时绕开「签名算法 + 分片上传协议」两座山。
 *
 * 实测依据（dev/probe-douyin-editor.mjs）：
 *   - 投稿入口 https://creator.douyin.com/creator-micro/content/upload
 *   - 页面上有可见的 input[type=file]，uploadFile 后自动跳编辑页
 *   - 编辑页 URL https://creator.douyin.com/creator-micro/content/post/video
 *   - 标题 input.semi-input（placeholder 含「作品标题」，限 30 字）
 *   - 描述 [contenteditable=true].zone-container（限 1000 字）
 *   - 发布按钮文本「发布」，另有「我知道了」弹窗需先关闭
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'
import { existsSync, statSync } from 'node:fs'

const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload'
const EDITOR_URL_PART = '/content/post/video'
const PUBLISH_TIMEOUT_MS = 120_000
const UPLOAD_WAIT_MS = 90_000

export interface DouyinPublishOptions {
  /** 本地视频文件绝对路径 */
  videoPath: string
  /** 作品标题（抖音限 30 字） */
  title: string
  /** 作品描述/文案（抖音限 1000 字），可含 #话题 */
  description?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface DouyinPublishResult {
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
const PROFILE_OWNER = '抖音发布'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: DouyinPublishResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'douyin' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到抖音账号。请引导用户打开「账号连接」页面添加抖音账号（扫码登录）后再发布。',
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
          `抖音平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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
function buildPreview(account: StoredAccount, opts: DouyinPublishOptions): string {
  const desc = (opts.description || '').trim()
  return [
    '【发布预览 · 需用户确认】',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `视频：${opts.videoPath}`,
    `标题：${opts.title}`,
    `描述：${desc ? desc.slice(0, 200) + (desc.length > 200 ? '…' : '') : '（空）'}`,
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正提交投稿。',
    '注意：发布是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/**
 * 抖音投稿主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function douyinPublish(
  store: CredentialStore,
  opts: DouyinPublishOptions,
): Promise<DouyinPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const videoPath = String(opts.videoPath || '').trim()
  const title = String(opts.title || '').trim()
  const description = String(opts.description || '')

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
    return { ok: false, failureKind: 'api_error', text: '缺少 title（作品标题）。抖音要求标题非空且不超过 30 字。' }
  }
  if (title.length > 30) {
    return { ok: false, failureKind: 'api_error', text: `标题 ${title.length} 字，超过抖音上限 30 字，请精简后重试。` }
  }
  if (description.length > 1000) {
    return { ok: false, failureKind: 'api_error', text: `描述 ${description.length} 字，超过抖音上限 1000 字，请精简后重试。` }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  if (opts.confirm !== true) {
    return { ok: false, needConfirm: true, text: buildPreview(account, { ...opts, videoPath, title, description }) }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   按目录加锁才能拦住「发布与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
  //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
  const dir = profileDir('douyin', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `抖音的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
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
      // 可见窗口：发布是真实副作用操作，用户应能看到过程；若出现滑块也可人工处理
      headless: false,
      executablePath: chromePath,
      userDataDir: dir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
    }
    clearProfileLocks(dir)
    try {
      browser = await puppeteer.launch(launchOpts)
    } catch (e) {
      console.warn('[dsagent-douyin-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入抖音域 Cookie（domain 必须写 .douyin.com，creator 子域才认）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.douyin.com', path: '/' }))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-douyin-publish] 已注入 ${cookieList.length} 个 douyin.com Cookie（账号 ${shopKey}）`)

    // ── 1. 打开投稿页并上传视频 ────────────────────────────
    console.log('[dsagent-douyin-publish] 打开投稿页...')
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
    const landedUrl = page.url()
    if (/login|passport/i.test(landedUrl)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: `抖音登录态已失效（投稿页被重定向到 ${landedUrl}）。请到「账号连接」页面重新登录抖音后重试。`,
      }
    }

    await page.waitForSelector('input[type=file]', { timeout: 30_000 })
    console.log('[dsagent-douyin-publish] 上传视频文件...')
    const fileInput = await page.$('input[type=file]')
    if (!fileInput) {
      return { ok: false, failureKind: 'api_error', text: '未在投稿页找到文件上传控件（input[type=file]），页面结构可能已变更。', shopKey }
    }
    await fileInput.uploadFile(videoPath)

    // ── 2. 等上传完成 → 自动跳编辑页 ───────────────────────
    console.log('[dsagent-douyin-publish] 等待上传与编辑页加载...')
    let editorReady = false
    const uploadDeadline = Date.now() + UPLOAD_WAIT_MS
    while (Date.now() < uploadDeadline) {
      await new Promise(r => setTimeout(r, 2000))
      if (page.url().includes(EDITOR_URL_PART)) { editorReady = true; break }
    }
    if (!editorReady) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: `上传后 ${UPLOAD_WAIT_MS / 1000}s 内未跳转到编辑页（当前 URL：${page.url()}）。`
          + `可能原因：视频格式不被支持、上传被风控拦截、或页面结构变更。`,
      }
    }
    // 编辑页 React 渲染 + 视频转码状态回填需要一点时间
    await new Promise(r => setTimeout(r, 5000))

    // ── 3. 关闭「我知道了」等引导弹窗 ──────────────────────
    try {
      const closed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')) as HTMLElement[]
        const hit = btns.find(b => ['我知道了', '知道了', '知道了！'].includes((b.innerText || '').trim()))
        if (hit) { hit.click(); return true }
        return false
      })
      if (closed) {
        console.log('[dsagent-douyin-publish] 已关闭引导弹窗')
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch { /* 无弹窗，忽略 */ }

    // ── 4. 填标题 ─────────────────────────────────────────
    // 抖音编辑器是 React 受控组件：直接赋值不会触发 onChange，
    // 必须走原生 value setter + 派发 input 事件。
    const titleOk = await page.evaluate((val: string) => {
      const input = (document.querySelector('input[placeholder*="作品标题"]')
        || document.querySelector('input.semi-input')) as HTMLInputElement | null
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, val); else input.value = val
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, title)
    if (!titleOk) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到标题输入框（input.semi-input），页面结构可能已变更。' }
    }
    console.log(`[dsagent-douyin-publish] 已填标题：${title}`)

    // ── 5. 填描述 ─────────────────────────────────────────
    if (description) {
      const descOk = await page.evaluate((text: string) => {
        const el = (document.querySelector('[contenteditable="true"][class*="zone-container"]')
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
        // execCommand 会触发真实的 input 事件，富文本编辑器才能同步到内部状态
        document.execCommand('insertText', false, text)
        return true
      }, description)
      if (!descOk) {
        return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑页找到描述输入区（contenteditable.zone-container），页面结构可能已变更。' }
      }
      console.log(`[dsagent-douyin-publish] 已填描述（${description.length} 字）`)
    }

    // ── 6. 点「发布」 ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 1500))
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLElement[]
      const hit = btns.find(b => (b.innerText || '').trim() === '发布' && !(b as HTMLButtonElement).disabled)
      if (!hit) return false
      hit.click()
      return true
    })
    if (!clicked) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未找到可点击的「发布」按钮（可能仍处于禁用态，说明标题或视频未通过校验）。' }
    }
    console.log('[dsagent-douyin-publish] 已点击发布，等待结果...')

    // ── 7. 判定发布结果 ────────────────────────────────────
    // 抖音发布成功后一般跳转到作品管理页；失败则停留编辑页并弹错误提示。
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

      if (finalUrl.includes('/content/manage')) { success = true; break }
      if (/发布成功|已发布|作品管理/.test(bodyText)) { success = true; break }
      const err = bodyText.match(/发布失败[^。]{0,80}|标题不能为空|请上传视频|上传失败[^。]{0,60}|内容违规[^。]{0,60}|网络异常[^。]{0,40}/)
      if (err) { errText = err[0]; break }
    }

    if (success) {
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `抖音投稿已提交成功。\n账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${title}\n当前页面：${finalUrl}\n`
          + `注意：平台可能仍在审核中，最终状态请在抖音创作服务平台的「作品管理」中确认。`,
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
          + `请打开浏览器窗口查看具体提示；若出现滑块/安全验证请人工完成。`,
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `抖音发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
