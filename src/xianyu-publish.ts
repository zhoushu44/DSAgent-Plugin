/**
 * 闲鱼内容发布（发闲置）— host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP：
 *   1. 发布的核心动作是**图片文件上传（multipart 二进制）**，而网关 handleProxy
 *      只支持字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
 *   2. 发布类 MTOP 接口（mtop.idle.pc.idleitem.publish / prepublish.check / preget）
 *      要求页面 JS 运行时生成的 `sign` 签名与真实 goofish 会话票据。
 *      实测（dev/_xianyu_publish_page.json）：注入凭证库 Cookie 后访问发布页，
 *      上述接口一律返回 FAIL_SYS_SESSION_EXPIRED::Session过期。
 *
 * 结论：让页面自己完成签名与上传，host 侧只负责驱动表单。
 *
 * 表单控件依据（dev/probe-xianyu-final-dom.mjs 实测 /publish 真实 DOM）：
 *   - 宝贝描述：DIV.editor--MtHPS94K[contenteditable=true]，必填，不支持 emoji
 *               ★ 必须用 page.click + page.keyboard.type 输入（execCommand / 派发事件均无效）
 *   - 价格：    3 个 input[placeholder="0.00"]，name 全空，靠祖先链文本区分语义：
 *               [0] 祖先链含「价格」→ 价格（必填）；[1] 含「原价」→ 原价（选填）；
 *               [2] 含「邮费」且隐藏 → 不填
 *   - 图片：    input[type=file][name=file]，单张 ≤ 10MB
 *   - 发布按钮：button.publish-button--KBpTVopQ，文本「发布」
 *   ★ 发布页**没有**独立标题输入框（标题由描述派生），也**没有**库存输入框（发闲置默认单件）。
 *   ★ 部分类目网页版不支持发布，页面会弹「扫码去APP发布」二维码 —— 本工具会识别并明确报出。
 *
 * ★ 前提：凭证库中的 xianyu 账号必须是**在 https://www.goofish.com/login 用闲鱼 APP
 *   扫码登录**得到的（只有这条路能拿到 havana_lgc2_77 会话票据）。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js'
import { existsSync, statSync } from 'node:fs'

const PUBLISH_URL = 'https://www.goofish.com/publish'
const PUBLISH_TIMEOUT_MS = 120_000
const UPLOAD_WAIT_MS = 60_000
/** 单张图片上限（bundle 实证 maxFileSize = 10485760） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 单次提交的图片张数上限（平台上限以页面提示为准，超出部分忽略） */
const MAX_IMAGES = 9

export interface XianyuPublishOptions {
  /** 本地图片绝对路径列表（至少 1 张） */
  images: string[]
  /** 宝贝描述（必填，不支持 emoji） */
  description: string
  /** 价格（元，字符串），0 ~ 1 亿元 */
  price: string
  /** 标题（选填：闲鱼网页版标题多由描述/类目派生，页面有标题框时会一并填入） */
  title?: string
  /** 原价（元，选填） */
  originalPrice?: string
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
  /** 是否已获用户确认；为 false 时只返回预览，不执行任何写操作 */
  confirm?: boolean
}

export interface XianyuPublishResult {
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
const PROFILE_OWNER = '闲鱼发布'

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; choices: unknown[]; error?: XianyuPublishResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'xianyu' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      choices: [],
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到闲鱼账号。请引导用户打开「账号连接」页面添加闲鱼账号，'
          + '★ 必须用闲鱼 APP 扫描 https://www.goofish.com/login 的二维码（淘宝 SSO 派生的登录态在 goofish 域无效）。',
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
          `闲鱼平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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
function buildPreview(account: StoredAccount, opts: XianyuPublishOptions): string {
  const desc = (opts.description || '').trim()
  const imgs = (opts.images || []).map(p => `  - ${p}`)
  return [
    '【发布预览 · 需用户确认】',
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `标题：${(opts.title || '').trim() || '（未填，由页面按描述自动派生）'}`,
    `描述：${desc ? desc.slice(0, 200) + (desc.length > 200 ? '…' : '') : '（空）'}`,
    `价格：${opts.price} 元`,
    `原价：${(opts.originalPrice || '').trim() || '（未填）'}`,
    `图片（${(opts.images || []).length} 张）：`,
    ...imgs,
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正提交发布。',
    '注意：发布是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/**
 * 闲鱼发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function xianyuPublish(
  store: CredentialStore,
  opts: XianyuPublishOptions,
): Promise<XianyuPublishResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const description = String(opts.description || '')
  const title = String(opts.title || '').trim()
  const price = String(opts.price ?? '').trim()
  const originalPrice = String(opts.originalPrice ?? '').trim()
  const images = (Array.isArray(opts.images) ? opts.images : [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES)

  if (!images.length) {
    return { ok: false, failureKind: 'api_error', text: '缺少 images（本地图片绝对路径列表，至少 1 张）。' }
  }
  for (const p of images) {
    if (!existsSync(p)) {
      return { ok: false, failureKind: 'api_error', text: `图片文件不存在：${p}` }
    }
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size === 0) {
        return { ok: false, failureKind: 'api_error', text: `图片文件不可用（非文件或大小为 0）：${p}` }
      }
      if (st.size > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          failureKind: 'api_error',
          text: `图片超过闲鱼单张上限 10MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）`,
        }
      }
    } catch (e) {
      return { ok: false, failureKind: 'api_error', text: `无法读取图片文件：${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (!description.trim()) {
    return { ok: false, failureKind: 'api_error', text: '缺少 description（宝贝描述）。闲鱼要求描述必填。' }
  }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(description)) {
    return { ok: false, failureKind: 'api_error', text: '宝贝描述不能包含 emoji（闲鱼校验规则），请去掉后重试。' }
  }
  if (!price) {
    return { ok: false, failureKind: 'api_error', text: '缺少 price（价格，单位元）。闲鱼要求价格必填。' }
  }
  const priceNum = Number(price)
  if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 100_000_000) {
    return { ok: false, failureKind: 'api_error', text: `价格不合法：${price}。闲鱼要求价格在 0 到 1 亿元之间。` }
  }
  if (originalPrice) {
    const opNum = Number(originalPrice)
    if (!Number.isFinite(opNum) || opNum < 0 || opNum > 100_000_000) {
      return { ok: false, failureKind: 'api_error', text: `原价不合法：${originalPrice}。闲鱼要求原价在 1 亿元之内。` }
    }
  }

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  // ── confirm 门禁 ───────────────────────────────────────
  if (opts.confirm !== true) {
    return { ok: false, needConfirm: true, text: buildPreview(account, { ...opts, images, description, title, price, originalPrice }) }
  }

  // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 数据分析 / 风控验证共享。
  //   只有按目录加锁才能拦住「发布与数据分析同时启动」这类跨模块撞锁；目录带账号维度，
  //   同一账号的多个任务互斥、不同账号可并行。
  const dir = profileDir('xianyu', account.shop_key)
  const busyOwner = profileOwner(dir)
  if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `闲鱼的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
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
      console.warn('[dsagent-xianyu-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e))
      clearProfileLocks(dir)
      browser = await puppeteer.launch(launchOpts)
    }

    const page = await browser.newPage()
    // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // 注入闲鱼域 Cookie。★ 必须同时写 .goofish.com 与 .taobao.com：
    // 闲鱼登录态在 goofish 域，但 SSO 相关票据（_tb_token_ / cookie2 / unb）写在 taobao 域。
    const cookieList = Object.entries(accountCookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => ([
        { name, value: String(value), domain: '.goofish.com', path: '/' },
        { name, value: String(value), domain: '.taobao.com', path: '/' },
      ]))
    if (cookieList.length > 0) await page.setCookie(...cookieList)
    console.log(`[dsagent-xianyu-publish] 已注入 ${cookieList.length} 个 Cookie（账号 ${shopKey}）`)

    // ── 1. 打开发布页 ──────────────────────────────────────
    console.log(`[dsagent-xianyu-publish] 打开发布页：${PUBLISH_URL}`)
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // 等页面渲染（React 首屏 + prepublish.check / preget 两个前置接口）
    await new Promise(r => setTimeout(r, 4000))

    // ── 2. 登录态判定 ─────────────────────────────────────
    // 闲鱼未登录时**不跳转**登录页，而是原地渲染「立即登录」，因此必须看页面文案与登录按钮。
    let loginWord = false
    try {
      loginWord = await page.evaluate(() => /立即登录|登录后可以/.test(document.body?.innerText || ''))
    } catch { /* 页面跳转中，忽略 */ }
    if (loginWord) {
      await store.setStatus(shopKey, 'expired')
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        text: '闲鱼登录态在 goofish 域下无效（发布页仍显示「立即登录」）。\n'
          + '★ 常见原因：该账号是**淘宝 SSO 派生**的闲鱼账号，只持有 havana_lgc2_0 票据，'
          + '而 goofish 域需要 havana_lgc2_77（站点后缀 77），两者不通用。\n'
          + '请到「账号连接」页面删除该闲鱼账号后重新添加，'
          + '★ 必须用**闲鱼 APP 扫描** https://www.goofish.com/login 的二维码完成登录，不要走淘宝 SSO。',
      }
    }

    // ── 3. 上传图片 ───────────────────────────────────────
    await page.waitForSelector('input[type=file]', { timeout: 30_000 })
    const fileInput = await page.$('input[type=file]')
    if (!fileInput) {
      return { ok: false, failureKind: 'api_error', shopKey, text: '未在发布页找到图片上传控件（input[type=file]），页面结构可能已变更。' }
    }
    console.log(`[dsagent-xianyu-publish] 上传 ${images.length} 张图片...`)
    await fileInput.uploadFile(...images)

    // 等图片上传完成（页面会显示缩略图 / 上传进度）
    const uploadDeadline = Date.now() + UPLOAD_WAIT_MS
    let uploaded = 0
    while (Date.now() < uploadDeadline) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        uploaded = await page.evaluate((expect: number) => {
          const txt = document.body?.innerText || ''
          if (/上传失败|存在上传失败的图片/.test(txt)) return -1
          // 缩略图容器数量作为上传进度代理（img 的 src 指向阿里 CDN）
          const imgs = Array.from(document.querySelectorAll('img'))
            .filter(el => /alicdn|goofish|taobaocdn/i.test((el as HTMLImageElement).src || ''))
          return Math.min(imgs.length, expect)
        }, images.length)
      } catch { /* 页面重绘中，下一轮再取 */ }
      if (uploaded === -1) {
        return {
          ok: false,
          failureKind: 'api_error',
          shopKey,
          text: '图片上传失败（页面提示「存在上传失败的图片，请删除后重新上传」）。'
            + '请检查图片格式与大小（单张 ≤ 10MB），确认后重试。',
        }
      }
      if (uploaded >= images.length) break
    }
    if (uploaded < images.length) {
      console.warn(`[dsagent-xianyu-publish] 图片进度未达预期（${uploaded}/${images.length}），继续尝试填写其他字段`)
    }

    // ── 4. 填描述（必填）───────────────────────────────────
    // ★ 实测（dev/probe-xianyu-desc-input.mjs）：描述区是 DIV.editor--MtHPS94K[contenteditable=true]，
    //   发布页**没有 textarea**。React 受控组件只接受真实键盘事件：
    //     - document.execCommand('insertText')  → 字数仍 0/1500（无效）
    //     - textContent + InputEvent            → 字数仍 0/1500（无效）
    //     - page.click + page.keyboard.type     → 0/1500 → 30/1500（有效）
    //   故必须走真实键盘输入，不能用 evaluate 派发事件。
    const DESC_SELECTOR = 'div[contenteditable="true"]'
    const hasEditor = await page.$(DESC_SELECTOR)
    if (!hasEditor) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '未在发布页找到宝贝描述输入区（div[contenteditable="true"]），页面结构可能已变更。',
      }
    }
    await page.click(DESC_SELECTOR)
    // 清空编辑器可能残留的占位内容（全选后删除）
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(description, { delay: 12 })

    // 校验页面确实接收了描述（编辑器字数 > 0）
    const descLen = await page.evaluate(
      (sel: string) => ((document.querySelector(sel) as HTMLElement | null)?.textContent || '').trim().length,
      DESC_SELECTOR,
    ).catch(() => 0) as number
    if (descLen === 0) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '描述已输入但页面未接收（编辑器内容仍为空）。可能页面结构已变更或出现风控拦截，'
          + '请打开浏览器窗口查看页面状态。',
      }
    }
    console.log(`[dsagent-xianyu-publish] 已填描述（输入 ${description.length} 字，页面接收 ${descLen} 字）`)
    await new Promise(r => setTimeout(r, 1500))

    // ── 5. 填价格 / 原价 ───────────────────────────────────
    // ★ 实测（dev/probe-xianyu-price-dom.mjs）：发布页价格类输入框 name 全为空、placeholder 均为 "0.00"，
    //   共 3 个且 DOM 顺序固定，只能靠**祖先链文本**区分语义：
    //     [0] 祖先链含「价格 * ￥」→ 价格
    //     [1] 祖先链含「原价 ￥」  → 原价
    //     [2] 祖先链含「邮费*￥」（隐藏，属「发货设置」区）→ 不填
    //   写入用 native setter + input 事件即可被 React 接收（实测写入 12.50 → 1.5s 后被规范化为 12.5）。
    const fillZeroInput = async (kind: 'price' | 'originalPrice', val: string): Promise<boolean> => {
      return await page.evaluate((k: string, v: string) => {
        const inputs = Array.from(document.querySelectorAll('input[placeholder="0.00"]')) as HTMLInputElement[]
        const visible = inputs.filter(el => el.offsetParent !== null)
        const chainText = (el: HTMLElement) => {
          let s = ''
          let cur: HTMLElement | null = el
          for (let i = 0; i < 4 && cur; i++) { s += ' ' + (cur.innerText || ''); cur = cur.parentElement }
          return s
        }
        const withChain = visible.map(el => ({ el, t: chainText(el) }))
        const orig = withChain.find(x => /原价/.test(x.t))
        const price = withChain.find(x => x !== orig && /价格/.test(x.t))
        let hit = k === 'price' ? price?.el : orig?.el
        // 兜底：语义未命中时按可见框 DOM 顺序 [0]=价格 [1]=原价
        if (!hit) hit = k === 'price' ? visible[0] : visible[1]
        if (!hit) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(hit, v); else hit.value = v
        hit.dispatchEvent(new Event('input', { bubbles: true }))
        hit.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, kind, val)
    }

    if (!await fillZeroInput('price', price)) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '未在发布页找到价格输入框（input[placeholder="0.00"]），页面结构可能已变更。',
      }
    }
    console.log(`[dsagent-xianyu-publish] 已填价格：${price}`)

    // ── 6. 选填字段（原价）─────────────────────────────────
    if (originalPrice) {
      const ok = await fillZeroInput('originalPrice', originalPrice)
      if (!ok) console.warn('[dsagent-xianyu-publish] 未找到原价输入框，跳过')
    }
    // 库存：★ 实测发布页无库存输入框（闲鱼发闲置默认单件），故本工具不提供库存参数。

    // 标题框：★ 实测发布页无独立标题输入框，标题由页面按描述派生，故仅在存在时才填。
    if (title) {
      const ok = await page.evaluate((val: string) => {
        const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
        const hit = inputs.find(el => /请输入标题|宝贝标题|^标题$/.test((el.placeholder || '').trim()))
        if (!hit) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(hit, val); else hit.value = val
        hit.dispatchEvent(new Event('input', { bubbles: true }))
        hit.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, title)
      if (ok) console.log(`[dsagent-xianyu-publish] 已填标题：${title}`)
      else console.warn('[dsagent-xianyu-publish] 页面无独立标题输入框（实测发布页标题由描述派生），已跳过 title')
    }

    // ── 7. 点「发布」──────────────────────────────────────
    await new Promise(r => setTimeout(r, 2000))
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLElement[]
      const hit = btns.find(b => ['发布', '确认发布', '立即发布', '发布闲置'].includes((b.innerText || '').trim())
        && !(b as HTMLButtonElement).disabled)
      if (!hit) return false
      hit.click()
      return true
    })
    if (!clicked) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        text: '未找到可点击的「发布」按钮（可能仍处于禁用态，说明描述/价格/图片未通过页面校验，或该类目需先在页面手选分类）。'
          + '请打开浏览器窗口查看页面上的红色校验提示。',
      }
    }
    console.log('[dsagent-xianyu-publish] 已点击发布，等待结果...')

    // ── 8. 判定发布结果 ────────────────────────────────────
    // 成功：跳转到商品详情页（URL 含 /item）；失败：停留发布页并弹错误提示或二维码弹窗。
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

      if (/\/item(\?|\/)/.test(finalUrl)) { success = true; break }
      if (/发布成功|已发布|宝贝已发布/.test(bodyText)) { success = true; break }
      // 部分类目网页版不支持发布 → 页面弹「扫码去APP发布」
      if (/扫码去APP发布|网页版暂不支持发布此分类|暂不支持编辑此分类/.test(bodyText)) {
        errText = '该分类暂不支持在网页版发布，页面要求「扫码去APP发布」。请在闲鱼 APP 中完成该类目商品的发布。'
        break
      }
      const err = bodyText.match(/发布失败[^。]{0,80}|请输入价格[^。]{0,40}|请输入库存[^。]{0,40}|请输入宝贝描述[^。]{0,40}|商品描述不能包含emoji|价格必须在[^。]{0,30}|库存必须在[^。]{0,30}|上传失败[^。]{0,60}|内容违规[^。]{0,60}|网络异常[^。]{0,40}/)
      if (err) { errText = err[0]; break }
    }

    if (success) {
      // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
      try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
      return {
        ok: true,
        shopKey,
        finalUrl,
        text: `闲鱼发闲置已提交成功。\n账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `价格：${price} 元\n图片：${images.length} 张\n当前页面：${finalUrl}\n`
          + '注意：平台可能仍在审核中，最终状态请在闲鱼 APP 或「我发布的」页面确认。',
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
          + '请打开浏览器窗口查看具体提示；若出现滑块/安全验证请人工完成，'
          + '若页面要求手选分类，请人工选好分类后重试。',
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `闲鱼发布失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    releaseProfile(dir)
    if (browser) {
      try { await browser.close() } catch { /* 忽略 */ }
    }
  }
}
