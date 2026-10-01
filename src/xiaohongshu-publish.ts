/**
 * 小红书发布（内容发布）— host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP：
 *   发布的核心动作是**文件上传（multipart 二进制）**，而网关 handleProxy 只支持
 *   字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
 *   浏览器路线下页面自身请求自带签名（x-s / x-t / x-s-common），同时绕开
 *   「签名算法 + 上传协议」两座山。
 *
 * 实测依据（dev/probe-xhs-creator.mjs / probe-xhs-editor.mjs / probe-xhs-editor2.mjs）：
 *   - 图文入口 https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=image
 *   - 视频入口 https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video
 *   - 文件控件 input.upload-input（图文 accept .jpg/.jpeg/.png/.webp，上限 18 张；视频 accept .mp4/.mov/...）
 *   - 标题 input.d-text（placeholder「填写标题会有更多赞哦」）
 *   - 正文 div.tiptap.ProseMirror（contenteditable=true，限 1000 字）
 *   - 发布按钮：叶子节点文本「发布笔记」（span.btn-text），**不是 <button>**
 *   - tab 切换：div.creator-tab（内含 span.title「上传视频」/「上传图文」）
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'
import { existsSync, statSync } from 'node:fs'

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'
const TITLE_MAX = 20
const BODY_MAX = 1000
const IMAGE_MAX = 18
const VIDEO_EXT = ['.mp4', '.mov', '.flv', '.f4v', '.mkv', '.rm', '.rmvb', '.m4v', '.mpg', '.mpeg', '.ts']
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp']
const UPLOAD_WAIT_MS = 90_000
const PUBLISH_TIMEOUT_MS = 120_000

export interface XiaohongshuPublishOptions {
  /** 本地视频文件绝对路径（与 imagePaths 二选一） */
  videoPath?: string
  /** 本地图片文件绝对路径数组（与 videoPath 二选一，最多 18 张） */
  imagePaths?: string[]
  /** 笔记标题（小红书限 20 字） */
  title: string
  /** 笔记正文（小红书限 1000 字），可含 #话题 */
  content?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface XiaohongshuPublishResult {
  ok: boolean
  text: string
  needConfirm?: boolean
  failureKind?: string
  accounts?: unknown[]
  shopKey?: string
  finalUrl?: string
}

/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '小红书发布'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 * 注意：凭证库中 platform 可能存 'xiaohongshu' 或归一化后的 'xhs'，两种都要收。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; error?: XiaohongshuPublishResult } {
  const candidates = store.listAccounts().filter(
    a => (a.platform === 'xiaohongshu' || a.platform === 'xhs') && a.status !== 'invalid',
  )
  if (!candidates.length) {
    return {
      account: null,
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到小红书账号。请引导用户打开「账号连接」页面添加小红书账号（扫码登录）后再发布。',
      },
    }
  }
  const res = resolveAccountForRequest(candidates, { shopKey: opts.account, agentId: opts.agentId })
  if (!res.account) {
    const lines = res.choices.map((c, i) =>
      `${i + 1}. ${c.nickname}（账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`)
    return {
      account: null,
      error: {
        ok: false,
        failureKind: 'need_account_choice',
        accounts: res.choices,
        text: [
          `小红书平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
          '为避免选错账号（错号会静默影响所有使用该平台的技能），请先向用户确认要用哪一个：',
          ...lines,
          '',
          '用户选定后，把对应的 shopKey 传给本次调用的 account 参数重调。★ 绝不要自己挑一个。',
        ].join('\n'),
      },
    }
  }
  return { account: res.account }
}

/** 生成发布预览文案（confirm 前给用户看） */
function buildPreview(
  account: StoredAccount,
  opts: XiaohongshuPublishOptions,
  media: { kind: 'video' | 'image'; files: string[] },
): string {
  const body = (opts.content || '').trim()
  return [
    '【发布预览 · 需用户确认】',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `类型：${media.kind === 'video' ? '视频笔记' : '图文笔记'}`,
    media.kind === 'video'
      ? `视频：${media.files[0]}`
      : `图片：${media.files.length} 张\n  ${media.files.join('\n  ')}`,
    `标题：${opts.title}`,
    `正文：${body ? body.slice(0, 200) + (body.length > 200 ? '…' : '') : '（空）'}`,
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正提交发布。',
    '注意：发布是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/**
 * 小红书发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function xiaohongshuPublish(
  store: CredentialStore,
  opts: XiaohongshuPublishOptions,
): Promise<XiaohongshuPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const title = String(opts.title || '').trim()
  const content = String(opts.content || '')
  const videoPath = String(opts.videoPath || '').trim()
  const imagePaths = (Array.isArray(opts.imagePaths) ? opts.imagePaths : []).map(p => String(p || '').trim()).filter(Boolean)

  if (videoPath && imagePaths.length) {
    return { ok: false, failureKind: 'api_error', text: 'videoPath 与 imagePaths 只能二选一：视频笔记传 videoPath，图文笔记传 imagePaths。' }
  }
  if (!videoPath && !imagePaths.length) {
    return { ok: false, failureKind: 'api_error', text: '缺少素材：视频笔记传 videoPath（本地视频绝对路径），图文笔记传 imagePaths（本地图片绝对路径数组）。' }
  }
  if (!title) {
    return { ok: false, failureKind: 'api_error', text: `缺少 title（笔记标题）。小红书要求标题非空且不超过 ${TITLE_MAX} 字。` }
  }
  if (title.length > TITLE_MAX) {
    return { ok: false, failureKind: 'api_error', text: `标题 ${title.length} 字，超过小红书上限 ${TITLE_MAX} 字，请精简后重试。` }
  }
  if (content.length > BODY_MAX) {
    return { ok: false, failureKind: 'api_error', text: `正文 ${content.length} 字，超过小红书上限 ${BODY_MAX} 字，请精简后重试。` }
  }
  if (imagePaths.length > IMAGE_MAX) {
    return { ok: false, failureKind: 'api_error', text: `图片 ${imagePaths.length} 张，超过小红书上限 ${IMAGE_MAX} 张，请精简后重试。` }
  }

  const files = videoPath ? [videoPath] : imagePaths
  const kind: 'video' | 'image' = videoPath ? 'video' : 'image'
  const allowedExt = kind === 'video' ? VIDEO_EXT : IMAGE_EXT

  for (const f of files) {
    if (!existsSync(f)) {
      return { ok: false, failureKind: 'api_error', text: `素材文件不存在：${f}` }
    }
    try {
      const st = statSync(f)
      if (!st.isFile() || st.size === 0) {
        return { ok: false, failureKind: 'api_error', text: `素材文件不可用（非文件或大小为 0）：${f}` }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取素材文件：${e instanceof Error ? e.message : String(e)}` }
    }
    const ext = f.slice(f.lastIndexOf('.')).toLowerCase()
    if (!allowedExt.includes(ext)) {
      return {
        ok: false,
        failureKind: 'api_error',
        text: `文件格式不被小红书支持：${f}（${kind === 'video' ? '视频' : '图片'}仅支持 ${allowedExt.join(' / ')}）。`,
      }
    }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  if (opts.confirm !== true) {
    return { ok: false, needConfirm: true, text: buildPreview(account, { ...opts, title, content }, { kind, files }) }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
  //   按目录加锁才能拦住「发布与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
  //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
  const dir = profileDir('xiaohongshu', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `小红书的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
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
      console.warn('[dsagent-xhs-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入小红书域 Cookie（domain 必须写 .xiaohongshu.com，creator 子域才认）
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .map(([name, value]) => ({ name, value: String(value), domain: '.xiaohongshu.com', path: '/' }))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-xhs-publish] 已注入 ${cookieList.length} 个 xiaohongshu.com Cookie（账号 ${shopKey}）`)

    // ── 1. 打开对应类型的发布页 ────────────────────────────
    const target = kind === 'video' ? 'video' : 'image'
    const entryUrl = `${PUBLISH_URL}?source=official&from=menu&target=${target}`
    console.log(`[dsagent-xhs-publish] 打开${kind === 'video' ? '视频' : '图文'}发布页...`)
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
    const landedUrl = page.url()
    if (/login|passport|captcha/i.test(landedUrl)) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: `小红书登录态已失效（发布页被重定向到 ${landedUrl}）。请到「账号连接」页面重新登录小红书后重试。`,
      }
    }

    // ── 2. 上传素材 ────────────────────────────────────────
    await page.waitForSelector('input.upload-input, input[type=file]', { timeout: 30_000 })
    const fileInput = (await page.$('input.upload-input')) || (await page.$('input[type=file]'))
    if (!fileInput) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在发布页找到文件上传控件（input.upload-input），页面结构可能已变更。' }
    }
    console.log(`[dsagent-xhs-publish] 上传 ${files.length} 个文件...`)
    await fileInput.uploadFile(...files)

    // ── 3. 等编辑区就绪（标题 + 正文出现即视为就绪） ────────
    console.log('[dsagent-xhs-publish] 等待上传与编辑区加载...')
    let editorReady = false
    const uploadDeadline = Date.now() + UPLOAD_WAIT_MS
    while (Date.now() < uploadDeadline) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const ready = await page.evaluate(() =>
          !!(document.querySelector('input.d-text') && document.querySelector('.tiptap.ProseMirror')))
        if (ready) { editorReady = true; break }
      } catch { /* 页面重绘中，下一轮再探 */ }
    }
    if (!editorReady) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: `上传后 ${UPLOAD_WAIT_MS / 1000}s 内未出现编辑区（当前 URL：${page.url()}）。`
          + '可能原因：素材格式不被支持、文件过大、上传被风控拦截、或页面结构变更。'
          + '请打开浏览器窗口查看具体提示。',
      }
    }
    // 图片上传后会有缩略图渲染与校验，稍等稳定
    await new Promise(r => setTimeout(r, 3000))

    // ── 4. 填标题（React 受控组件，必须走原生 setter + 事件） ──
    const titleOk = await page.evaluate((val: string) => {
      const input = (document.querySelector('input.d-text')
        || document.querySelector('input[placeholder*="标题"]')) as HTMLInputElement | null
      if (!input) return false
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, val); else input.value = val
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }, title)
    if (!titleOk) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑区找到标题输入框（input.d-text），页面结构可能已变更。' }
    }
    console.log(`[dsagent-xhs-publish] 已填标题：${title}`)

    // ── 5. 填正文（tiptap 富文本，用 execCommand 触发真实 input 事件） ──
    if (content) {
      const bodyOk = await page.evaluate((text: string) => {
        const el = (document.querySelector('.tiptap.ProseMirror')
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
        document.execCommand('insertText', false, text)
        return true
      }, content)
      if (!bodyOk) {
        return { ok: false, failureKind: 'api_error', shopKey, text: '未在编辑区找到正文输入区（.tiptap.ProseMirror），页面结构可能已变更。' }
      }
      console.log(`[dsagent-xhs-publish] 已填正文（${content.length} 字）`)
    }

    // ── 6. 点「发布笔记」 ──────────────────────────────────
    // 实测：发布按钮不是 <button>，是叶子节点文本「发布笔记」（span.btn-text），
    // 点击叶子节点会冒泡到 React 的 onClick 容器上。
    await new Promise(r => setTimeout(r, 1500))
    const clicked = await page.evaluate(() => {
      const isLeaf = (el: Element) => el.children.length === 0
      const nodes = Array.from(document.querySelectorAll('span, div, button')) as HTMLElement[]
      const hit = nodes.find(el => isLeaf(el) && ['发布笔记', '发布'].includes((el.innerText || '').trim()))
      if (!hit) return false
      hit.scrollIntoView({ block: 'center' })
      hit.click()
      return true
    })
    if (!clicked) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '未找到「发布笔记」按钮（可能仍处于禁用态，说明标题/正文/图片未通过校验）。请打开浏览器窗口查看页面提示。',
      }
    }
    console.log('[dsagent-xhs-publish] 已点击发布笔记，等待结果...')

    // 部分场景会再弹一层二次确认弹窗，尝试自动点「确定/确认发布」
    await new Promise(r => setTimeout(r, 2000))
    try {
      await page.evaluate(() => {
        const isLeaf = (el: Element) => el.children.length === 0
        const nodes = Array.from(document.querySelectorAll('span, div, button')) as HTMLElement[]
        const hit = nodes.find(el => isLeaf(el) && ['确定', '确认', '确认发布'].includes((el.innerText || '').trim()))
        if (hit) hit.click()
      })
    } catch { /* 无二次确认，忽略 */ }

    // ── 7. 判定发布结果 ────────────────────────────────────
    // 成功一般会离开 /publish/publish（跳成功页或笔记管理页）；失败则停留并弹错误提示。
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

      if (/\/publish\/success|\/note-manager|\/publish\/note/.test(finalUrl)) { success = true; break }
      if (/发布成功|已发布|发布完成|笔记发布成功/.test(bodyText)) { success = true; break }
      const err = bodyText.match(/发布失败[^。]{0,80}|标题不能为空|请填写标题|请上传图片|请上传视频|上传失败[^。]{0,60}|内容违规[^。]{0,60}|图片违规[^。]{0,60}|网络异常[^。]{0,40}/)
      if (err) { errText = err[0]; break }
    }

    if (success) {
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `小红书笔记已提交成功。\n账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `类型：${kind === 'video' ? '视频笔记' : `图文笔记（${files.length} 张）`}\n标题：${title}\n当前页面：${finalUrl}\n`
          + '注意：平台可能仍在审核中，最终状态请在小红书创作服务平台的「笔记管理」中确认。',
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
          + '请打开浏览器窗口查看具体提示；若出现滑块/安全验证请人工完成。',
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `小红书发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
