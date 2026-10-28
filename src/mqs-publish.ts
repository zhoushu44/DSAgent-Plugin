/**
 * 通用 mqs 商品上架引擎（觅千手 v5.61 goods_manager 等价链路 · 多平台共用）。
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────
 * 淘宝/天猫走的是 `taobao-publish.ts`（真机逐格实测过的专用链路），拼多多走
 * `pdd-publish.ts`。剩下的**京东 / 抖店 / 1688** 三个平台在觅千手 v5.61 里
 * 也挂在同一条 goods_manager 引擎上（见 `source/pageHooks.js`：wares-jdm.jd.com、
 * fxg.jinritemai.com/ffa/g/create、offer-new.1688.com/*\/publish.htm 都做了
 * beforeunload 拦截与详情数据注入；`source/iframeHandler.js` 覆盖 1688 图片空间）。
 *
 * 本文件把「同一套引擎换锚点」从口号变成代码：
 *   - **零平台 if/else**：平台差异全部写在 `publish-config/{jd,douyin_shop,1688}.json`
 *     （入口 URL / 限额 / 锚点 / 超时 / 正则），本文件只实现流程骨架；
 *   - **7 函数链 + 3 补**（PUBLISH-MATRIX.md §3 / §6）：选类目 → 等表单 → 标题 →
 *     主图 → SKU → 类目属性 → 运费模板 → 提交 → 三路错误回读；
 *   - **锚点落空不假成功**：任一步锚点没命中，都记 `missed` 并把可见浏览器窗口
 *     留给用户人工补全（L2 语义：宁可交人工，也不谎报已提交）；
 *   - **锚点自诊**：`diagDom` / 任一步失败都会落一份 DOM 诊断
 *     （可见 input / button / file / iframe 清单 + 截图），照着改 JSON 即可，
 *     **改锚点不需要重编译、不需要重启宿主**（loader 带 mtime 热加载）。
 *
 * ── 与淘宝 / 拼多多实现的关系 ──────────────────────────────────
 * 不复制它们的实测补丁（那些是平台专属坑：淘宝 next 组件只认 element.click()、
 * 拼多多单买价 = 拼单价 + 1 等），只复用它们验证过的**通用纪律**：
 *   - 规格值必须「键入后 Tab」才进受控组件 state；
 *   - 主图区的 untrusted click 会被忽略，必要时用真实坐标点击 + fileChooser；
 *   - 类目规则从 DOM 读（maxlength / required），不查文档；
 *   - 品牌一律不自动填（授权风险）；
 *   - 提交被拦要三路回读（toast + 字段红字 + 建议面板）。
 */
import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { applyStealth } from './stealth-inject.js'
import { basename, join } from 'node:path'
import type { CredentialStore, StoredAccount } from './services/credential-store.js'
import { resolveAccountForRequest, toAccountChoice } from './services/credential-store.js'
import { parseProduct, validateProduct, type ProductData, type ProductSku, type ProductSpecDimension } from './services/product-schema.js'
import { loadPublishConfig, anchorSpec, configString, configTimeout, type PublishConfig, type AnchorSpec } from './services/publish-config-loader.js'
import {
  clearProfileLocks, findChromePath, profileDir, profileOwner, registerProfilePort,
  releaseProfile, sleep, tryAcquireProfile, verifyPortOwnership, UI_STEP_DELAY_MS,
} from './browser-login.js'
import type { AttrModelHandle } from './pdd-publish.js'

/* ══════════════════════════════════════════════════════════════════
 * 渠道表（唯一的「平台知识」入口：账号平台 + Cookie 域 + Profile 占用者）
 * 其余一切（URL / 锚点 / 限额 / 超时）都在 publish-config/<channel>.json 里。
 * ══════════════════════════════════════════════════════════════════ */

export type MqsChannel = 'jd' | 'douyin_shop' | '1688'

interface ChannelSpec {
  /** 给人看的渠道名 */
  label: string
  /** 账号平台（凭证库里的 platform 字段） */
  platform: string
  /** publish-config 文件名（去掉 .json） */
  configPlatform: string
  /** Profile 锁占用者标识（互斥提示文案用） */
  profileOwner: string
  /** 兜底发布入口（config.urls 覆盖；写在这里是为了「配置缺失也有据可查」） */
  entryUrl: string
  /** 兜底 Cookie 注入域（config.cookieDomains 覆盖） */
  cookieDomains: string[]
  /** 平台侧「发布域名」（诊断/文案用；也是 tools 门禁的域名证据） */
  domains: string[]
}

const CHANNELS: Record<MqsChannel, ChannelSpec> = {
  jd: {
    label: '京东',
    platform: 'jd',
    configPlatform: 'jd',
    profileOwner: '京东发布',
    entryUrl: 'https://wares-jdm.jd.com/newPublish',
    cookieDomains: ['.jd.com'],
    domains: ['wares-jdm.jd.com', 'jd.com'],
  },
  douyin_shop: {
    label: '抖音小店',
    // ★ 抖店是商家后台，用**独立平台键** douyin_shop：它的可用账号语义是「有抖店商家权限」，
    //   与内容平台 douyin 的账号分开管理，避免「发抖音视频」和「抖店上架」互相抢号。
    platform: 'douyin_shop',
    configPlatform: 'douyin_shop',
    profileOwner: '抖店发布',
    entryUrl: 'https://fxg.jinritemai.com/ffa/g/create',
    // 抖店后台自己的域是 .jinritemai.com，但登录态来自抖音账号 SSO（.douyin.com 的 sessionid）
    cookieDomains: ['.jinritemai.com', '.douyin.com'],
    domains: ['fxg.jinritemai.com', 'jinritemai.com', 'douyin.com'],
  },
  '1688': {
    label: '1688',
    platform: 'alibaba',
    configPlatform: '1688',
    profileOwner: '1688发布',
    entryUrl: 'https://offer-new.1688.com/offer/publish.htm',
    cookieDomains: ['.1688.com', '.taobao.com'],
    domains: ['offer-new.1688.com', 'work.1688.com', '1688.com'],
  },
}

/* ══════════════════════════════════════════════════════════════════
 * 入参 / 出参
 * ══════════════════════════════════════════════════════════════════ */

/** 一个规格值（复用统一商品数据的形状，单独声明避免平台层耦合） */
export interface MqsSpecDimension {
  name: string
  values: { value: string; image?: string }[]
}

export interface MqsPublishOptions {
  /** 统一商品数据（对象或 JSON 字符串）；给了就忽略下面的扁平字段 */
  product?: unknown
  title?: string
  images?: string[]
  detailImages?: string[]
  category?: string
  price?: string
  stock?: string
  itemNo?: string
  specs?: MqsSpecDimension[]
  skus?: ProductSku[]
  attributes?: { name: string; value: string }[]
  /** 是否已获用户确认；false → 只返回预览，不启动浏览器、不产生写操作 */
  confirm?: boolean
  /** 指定账号 shopKey */
  account?: string
  /** 当前会话 ID（账号选择链第 2 级） */
  agentId?: string
  /** 类目属性自动选值用的宿主模型句柄（可选） */
  attrModel?: AttrModelHandle
  /** 只做 DOM 诊断后返回（不上传、不填表、不提交；零风险，绕过 confirm 门禁） */
  diagDom?: boolean
}

export interface MqsPublishResult {
  ok: boolean
  text: string
  needConfirm?: boolean
  failureKind?: string
  accounts?: unknown[]
  shopKey?: string
  finalUrl?: string
  verifyUrl?: string
  /** 锚点落空清单（模型据此告诉用户「哪些要人工补」） */
  missed?: string[]
  /** 已自动填写的字段 */
  filled?: string[]
}

/** 归一后的发布数据（引擎内部用） */
interface PublishPayload {
  title: string
  images: string[]
  detailImages: string[]
  category: string
  price: string
  stock: string
  itemNo: string
  specs: MqsSpecDimension[]
  skus: ProductSku[]
  attributes: { name: string; value: string }[]
}

/* ══════════════════════════════════════════════════════════════════
 * 配置读取（mtime 热加载，改 JSON 即生效）
 * ══════════════════════════════════════════════════════════════════ */

interface ChannelConfig {
  cfg: PublishConfig
  maxImageBytes: number
  maxImages: number
  maxTitleLen: number
  maxDetailImages: number
  defaultStock: string
  entryUrl: string
  goodsListUrl: string
  cookieDomains: string[]
  loginUrlRe: string
  riskSelector: string
  submitTextRe: string
  successRe: string
  uploadFailureRe: string
  attrSkipRe: RegExp
  salePropPlaceholderRe: RegExp
  formWaitMs: number
  publishTimeoutMs: number
  uploadWaitMs: number
  skuCellWaitMs: number
  attrDropdownWaitMs: number
  attrModelTimeoutMs: number
}

/** 读并归一一份渠道配置（失败返回错误文案，绝不用旧值静默兜底） */
function readChannelConfig(channel: MqsChannel): { config?: ChannelConfig; error?: string } {
  const spec = CHANNELS[channel]
  let cfg: PublishConfig
  try {
    cfg = loadPublishConfig(spec.configPlatform)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  const L = cfg.limits
  const urlKeys = Object.keys(cfg.urls || {})
  // 入口 URL：优先 <channel>Publish 形态的键（jdPublish / dyPublish / aliPublish）
  const entryKey = urlKeys.find(k => /Publish$/.test(k) && !/List$/i.test(k))
  return {
    config: {
      cfg,
      maxImageBytes: L.maxImageBytes || 3 * 1024 * 1024,
      maxImages: L.maxImages || 5,
      maxTitleLen: L.maxTitleLen || 60,
      maxDetailImages: L.maxDetailImages || 20,
      defaultStock: L.defaultStock || '999',
      entryUrl: (entryKey ? configString(cfg, 'urls', entryKey) : '') || spec.entryUrl,
      goodsListUrl: configString(cfg, 'urls', 'goodsList'),
      cookieDomains: Array.isArray((cfg as any).cookieDomains) && (cfg as any).cookieDomains.length
        ? ((cfg as any).cookieDomains as string[])
        : spec.cookieDomains,
      loginUrlRe: String((cfg as any).loginUrlRe || 'login|passport|signin'),
      riskSelector: String((cfg as any).riskSelector || '[class*="captcha"], [class*="punish"], #nc_1_n1z'),
      submitTextRe: anchorSpec(cfg, 'submitButton').matchTextRe
        || anchorText(cfg, 'submitTextRe', '^(提交|发布|保存)$'),
      successRe: anchorText(cfg, 'successRe', '发布成功|提交成功|上架成功|保存成功'),
      uploadFailureRe: anchorText(cfg, 'uploadFailure', '图片格式不正确|文件过大|上传失败'),
      attrSkipRe: new RegExp(cfg.regexes?.attrSkip || '^品牌$'),
      salePropPlaceholderRe: new RegExp(cfg.regexes?.salePropPlaceholder || '规格值|颜色|尺码'),
      formWaitMs: configTimeout(cfg, 'formWaitMs', 150_000),
      publishTimeoutMs: configTimeout(cfg, 'publishTimeoutMs', 180_000),
      uploadWaitMs: configTimeout(cfg, 'uploadWaitMs', 90_000),
      skuCellWaitMs: configTimeout(cfg, 'skuCellWaitMs', 500),
      attrDropdownWaitMs: configTimeout(cfg, 'attrDropdownWaitMs', 800),
      attrModelTimeoutMs: configTimeout(cfg, 'attrModelTimeoutMs', 20_000),
    },
  }
}

/** 锚点 → CSS 逗号列表（跳过 `text:` 前缀的文案候选） */
function cssList(spec: AnchorSpec | null): string {
  if (!spec) return ''
  return spec.candidates
    .map(c => c.selector)
    .filter(s => !s.startsWith('text:') && !s.startsWith('//') && !s.startsWith('(/'))
    .join(', ')
}

/** 锚点 → 文案候选（`text:xxx` 形态） */
function textCandidates(spec: AnchorSpec | null): string[] {
  if (!spec) return []
  return spec.candidates
    .filter(c => c.selector.startsWith('text:'))
    .map(c => c.selector.slice(5).trim())
    .filter(Boolean)
}

/** 安全取锚点（键不存在时返回 null，不炸） */
function anchor(cfg: PublishConfig, key: string): AnchorSpec | null {
  try {
    return anchorSpec(cfg, key)
  } catch {
    return null
  }
}

/**
 * 取 anchors 段里的**纯字符串**值（如 `successRe` / `uploadFailure`）。
 * ★ 不能走 configString：那个函数对 anchors 段刻意只认对象锚点，字符串简写会回落 fallback。
 */
function anchorText(cfg: PublishConfig, key: string, fallback = ''): string {
  const bag = cfg.anchors as Record<string, unknown> | undefined
  const v = bag?.[key]
  return typeof v === 'string' && v ? v : fallback
}

/* ══════════════════════════════════════════════════════════════════
 * 通用 DOM 工具（全部平台无关）
 * ══════════════════════════════════════════════════════════════════ */

/** 页面上某选择器是否可见就绪 */
async function visible(page: any, selector: string): Promise<boolean> {
  if (!selector) return false
  return await page.evaluate((sel: string) => {
    try {
      return Array.from(document.querySelectorAll(sel)).some((e) => (e as HTMLElement).offsetParent !== null)
    } catch {
      return false
    }
  }, selector).catch(() => false) as boolean
}

/** 等到某选择器出现（或超时） */
async function waitVisible(page: any, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await visible(page, selector)) return true
    await sleep(500)
  }
  return false
}

/**
 * 按「文案候选 + CSS 候选」定位一个可点元素并返回其屏幕中心。
 * 元素自身 `.click()` 与真实鼠标点击**两个都试**（不同平台吃不同方式）。
 */
async function locateClickable(
  page: any,
  spec: AnchorSpec | null,
  opts: { exact?: boolean } = {},
): Promise<{ found: boolean; x: number; y: number; how: string; text: string }> {
  if (!spec) return { found: false, x: 0, y: 0, how: '', text: '' }
  const sels = spec.candidates
    .map(c => c.selector)
    .filter(s => !s.startsWith('text:') && !s.startsWith('//') && !s.startsWith('(/'))
  const texts = textCandidates(spec)
  return await page.evaluate((selList: string[], textList: string[], exact: boolean) => {
    const vis = (e: Element | null): boolean => {
      const h = e as HTMLElement | null
      return !!h && h.offsetParent !== null && h.getBoundingClientRect().width > 2
    }
    const center = (e: Element) => {
      try { (e as HTMLElement).scrollIntoView({ block: 'center' }) } catch { /* 忽略 */ }
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    for (const sel of selList) {
      let nodes: Element[] = []
      try { nodes = Array.from(document.querySelectorAll(sel)) } catch { continue }
      const hit = nodes.find(vis)
      if (hit) return { found: true, ...center(hit), how: `css:${sel}`, text: (hit as HTMLElement).innerText || '' }
    }
    if (textList.length) {
      const pool = Array.from(document.querySelectorAll('button, a, [role="button"], div, span, li')) as HTMLElement[]
      for (const want of textList) {
        const w = want.trim()
        const hit = pool.find(e => {
          if (!vis(e)) return false
          const t = (e.innerText || e.textContent || '').replace(/\s+/g, '')
          if (!t) return false
          return exact ? t === w.replace(/\s+/g, '') : t.includes(w.replace(/\s+/g, ''))
        })
        if (hit) return { found: true, ...center(hit), how: `text:${w}`, text: (hit.innerText || '').slice(0, 40) }
      }
    }
    return { found: false, x: 0, y: 0, how: '', text: '' }
  }, sels, texts, opts.exact === true).catch(() => ({ found: false, x: 0, y: 0, how: '', text: '' }))
}

/** 定位后先 JS click，再真实鼠标点击兜底（untrusted click 被忽略的平台必须两步都做） */
async function clickAnchor(
  page: any,
  spec: AnchorSpec | null,
  opts: { exact?: boolean; mouseOnly?: boolean } = {},
): Promise<boolean> {
  const loc = await locateClickable(page, spec, { exact: opts.exact })
  if (!loc.found) return false
  if (!opts.mouseOnly) {
    await page.evaluate((how: string) => {
      try {
        const [kind, ...rest] = how.split(':')
        const val = rest.join(':')
        if (kind === 'css') {
          const el = Array.from(document.querySelectorAll(val)).find(e => (e as HTMLElement).offsetParent !== null) as HTMLElement | undefined
          el?.click()
        }
      } catch { /* 忽略 */ }
    }, loc.how).catch(() => { /* 忽略 */ })
    await sleep(300)
  }
  if (loc.x > 0 && loc.y > 0) {
    await page.mouse.move(loc.x, loc.y).catch(() => { /* 忽略 */ })
    await sleep(150)
    await page.mouse.click(loc.x, loc.y).catch(() => { /* 忽略 */ })
    await sleep(300)
  }
  return true
}

/**
 * 通用文本框填写：按 placeholder/name/aria-label → 邻近 label 文本 → 关键词 三级定位。
 * ★ maxlength 从 DOM 现读（类目规则优先），不写死。
 */
async function fillText(page: any, re: RegExp, value: string, labels: string[] = []): Promise<string | null> {
  if (!value) return null
  return await page.evaluate((kwSrc: string, kwFlags: string, v: string, labelList: string[]) => {
    const rx = new RegExp(kwSrc, kwFlags)
    const els = Array.from(document.querySelectorAll('input, textarea')) as (HTMLInputElement | HTMLTextAreaElement)[]
    const usable = els.filter((el) => {
      if (el.offsetParent === null) return false
      if (el.disabled || el.readOnly) return false
      if (el instanceof HTMLInputElement) {
        const t = (el.type || 'text').toLowerCase()
        if (!['text', 'number', 'search', ''].includes(t)) return false
      }
      return true
    })
    const direct = (el: HTMLInputElement | HTMLTextAreaElement) =>
      [el.placeholder || '', el.name || '', el.id || '', el.getAttribute('aria-label') || ''].join(' ')
    const chain = (el: HTMLElement) => {
      let s = direct(el as HTMLInputElement)
      let cur: HTMLElement | null = el
      for (let i = 0; i < 4 && cur; i++) {
        if (cur.previousElementSibling) s += ' ' + ((cur.previousElementSibling as HTMLElement).innerText || '')
        cur = cur.parentElement
        if (cur) s += ' ' + (cur.innerText || '').slice(0, 120)
      }
      return s.replace(/\s+/g, ' ')
    }
    const byLabel = (): HTMLInputElement | HTMLTextAreaElement | null => {
      if (!labelList.length) return null
      const norm = (s: string) => (s || '').replace(/\s+/g, '')
      const cands = Array.from(document.querySelectorAll('div,span,label,dt,dd,td,th,p,b,strong')) as HTMLElement[]
      const labelEl = cands.find(e => labelList.some(l => norm(e.innerText) === norm(l)) && (e.offsetWidth || e.offsetHeight))
      if (!labelEl) return null
      let cur: HTMLElement | null = labelEl
      for (let i = 0; i < 6 && cur; i++) {
        const inp = usable.find(el => cur!.contains(el))
        if (inp) return inp
        cur = cur.parentElement
      }
      return null
    }
    let hit = byLabel()
    if (!hit) hit = usable.find(el => rx.test(direct(el))) || null
    if (!hit) hit = usable.find(el => rx.test(chain(el))) || null
    if (!hit) return null
    let finalVal = v
    const ml = Number(hit.getAttribute('maxlength')) || (hit.maxLength > 0 ? hit.maxLength : 0)
    if (ml > 0 && finalVal.length > ml) finalVal = finalVal.slice(0, ml)
    const proto = hit instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(hit, finalVal); else hit.value = finalVal
    hit.dispatchEvent(new Event('input', { bubbles: true }))
    hit.dispatchEvent(new Event('change', { bubbles: true }))
    hit.dispatchEvent(new Event('blur', { bubbles: true }))
    return (hit.placeholder || hit.name || hit.id || 'input')
  }, re.source, re.flags, value, labels).catch(() => null) as string | null
}

/** 读「当前展开的最后一个可见下拉面板」里的真实选项（绝不凭空造值） */
async function readOptions(page: any, panelSel: string, optionSel: string): Promise<string[]> {
  return await page.evaluate((pSel: string, oSel: string) => {
    const panels = (Array.from(document.querySelectorAll(pSel)) as HTMLElement[]).filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const n of Array.from(panel.querySelectorAll(oSel)) as HTMLElement[]) {
      if (n.offsetParent === null) continue
      const t = (n.getAttribute('title') || n.innerText || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 40 || seen.has(t)) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }, panelSel, optionSel).catch(() => []) as string[]
}

/** 在已展开面板里点中文本匹配（精确优先，其次包含）的选项 */
async function clickOption(page: any, panelSel: string, optionSel: string, text: string): Promise<boolean> {
  return await page.evaluate((pSel: string, oSel: string, want: string) => {
    const panels = (Array.from(document.querySelectorAll(pSel)) as HTMLElement[]).filter(p => p.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return false
    const nodes = Array.from(panel.querySelectorAll(oSel)) as HTMLElement[]
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
    const hit = nodes.find(n => n.offsetParent !== null && norm(n.getAttribute('title') || n.innerText || '') === norm(want))
      || nodes.find(n => n.offsetParent !== null && norm(n.innerText || '').includes(norm(want)))
    if (!hit) return false
    hit.click()
    return true
  }, panelSel, optionSel, text).catch(() => false) as boolean
}

/** 读页面断言（用于成功/失败判定与就绪检测） */
async function bodyText(page: any, limit = 4000): Promise<string> {
  return await page.evaluate((n: number) =>
    ((document.body as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').slice(0, n), limit).catch(() => '') as string
}

/**
 * DOM 诊断：把「可见 input / button / file / iframe / 疑似锚点」全 dump 出来 + 截图。
 * 用途：首次接入一个平台时跑一次，照结果把 JSON 里的 L2 语义锚点换成真实埋点。
 */
async function dumpDom(page: any, label: string): Promise<string> {
  const info = await page.evaluate(() => {
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null
    const inputs = (Array.from(document.querySelectorAll('input, textarea, select')) as HTMLElement[])
      .filter(vis).slice(0, 40)
      .map(e => `${e.tagName.toLowerCase()}[type=${(e as HTMLInputElement).type || ''}] ph="${(e as HTMLInputElement).placeholder || ''}" name="${(e as HTMLInputElement).name || ''}" id="${e.id || ''}"`)
    const buttons = (Array.from(document.querySelectorAll('button, [role="button"], a')) as HTMLElement[])
      .filter(vis).slice(0, 40)
      .map(e => `"${(e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24)}"`)
    const files = (Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[])
      .map(e => `accept="${e.accept}" multiple=${e.multiple} vis=${vis(e)}`)
    const frames = (Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[])
      .map(f => f.src).filter(Boolean).slice(0, 8)
    return { url: location.href, title: document.title, inputs, buttons, files, frames }
  }).catch(() => null) as
    | { url: string; title: string; inputs: string[]; buttons: string[]; files: string[]; frames: string[] }
    | null

  let shot = ''
  try {
    const dir = join(process.cwd(), 'dev', '.ui-shots')
    mkdirSync(dir, { recursive: true })
    shot = join(dir, `mqs-${label}-${Date.now()}.png`)
    await page.screenshot({ path: shot })
  } catch { /* 截图失败不影响诊断 */ }

  if (!info) return `【DOM 诊断 ${label}】读取失败（页面可能正在跳转）；截图=${shot || '无'}`
  const lines = [
    `【DOM 诊断 ${label}】`,
    `URL：${info.url}`,
    `标题：${info.title}`,
    `可见输入框（${info.inputs.length}）：${info.inputs.join(' | ') || '（无）'}`,
    `可见按钮/链接（${info.buttons.length}）：${info.buttons.join(' , ') || '（无）'}`,
    `file input（${info.files.length}）：${info.files.join(' | ') || '（无）'}`,
    `iframe（${info.frames.length}）：${info.frames.join(' , ') || '（无）'}`,
    shot ? `截图：${shot}` : '',
  ].filter(Boolean)
  console.log(lines.join('\n'))
  return lines.join('\n')
}

/* ══════════════════════════════════════════════════════════════════
 * 账号选择 / 预览
 * ══════════════════════════════════════════════════════════════════ */

function selectAccount(
  store: CredentialStore,
  channel: MqsChannel,
  opts: { account?: string; agentId?: string },
): { account?: StoredAccount; error?: MqsPublishResult } {
  const spec = CHANNELS[channel]
  const all = store.listAccounts().filter(a => a.status !== 'invalid')
  const candidates = all.filter(a => a.platform === spec.platform)
  if (!candidates.length) {
    return {
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: `未找到${spec.label}账号（凭证库里没有 platform=${spec.platform} 的有效账号）。\n`
          + `请引导用户打开「账号连接」页面添加**${spec.label}**账号`
          + `（${spec.label === '1688' ? '登录 1688 需卖家/诚信通资质；阿里 SSO 与淘宝同源' : '登录后本工具用它注入 Cookie'}）。`,
      },
    }
  }
  const res = resolveAccountForRequest(candidates, { shopKey: opts.account, agentId: opts.agentId })
  if (!res.account) {
    const lines = res.choices.map((c, i) =>
      `${i + 1}. ${c.nickname}（账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`)
    return {
      error: {
        ok: false,
        failureKind: 'need_account_choice',
        accounts: res.choices,
        text: [
          `${spec.label}有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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

/** 生成发布预览（confirm 前给用户看） */
function buildPreview(
  channel: MqsChannel,
  account: StoredAccount,
  payload: PublishPayload,
  cc: ChannelConfig,
): string {
  const spec = CHANNELS[channel]
  const skuLines: string[] = []
  if (payload.specs.length) {
    for (const d of payload.specs) {
      skuLines.push(`  - ${d.name}（${d.values.length} 个值）：${d.values.map(v => v.value).join(' / ')}`)
    }
    skuLines.push(`  SKU 行（${payload.skus.length}）：`)
    for (const r of payload.skus) {
      const combo = Object.entries(r.specs).map(([k, v]) => `${k}=${v}`).join(' ')
      skuLines.push(`    · ${combo}：价格 ${(r.price || payload.price || '（未填）')} / 库存 ${(r.stock || payload.stock || cc.defaultStock)}`)
    }
  }
  return [
    '【发布预览 · 需用户确认】',
    `渠道：${spec.label}（${spec.domains[0]}）`,
    `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
    `标题：${payload.title}`,
    `类目：${payload.category || '（未填，将从标题提取关键词后搜索）'}`,
    `价格：${payload.price || '（未填，留待页面人工填写）'}`,
    `库存：${payload.stock || `（未填，默认 ${cc.defaultStock}）`}`,
    `货号：${payload.itemNo || '（未填）'}`,
    `主图（${payload.images.length}/${cc.maxImages} 张）：`,
    ...payload.images.map(p => `  - ${p}`),
    payload.detailImages.length ? `详情图（${payload.detailImages.length} 张）：` : '详情图：（未提供，跳过）',
    ...payload.detailImages.map(p => `  - ${p}`),
    ...(payload.specs.length ? ['规格维度：', ...skuLines] : ['规格：（未提供，按单 SKU 发布）']),
    ...(payload.attributes.length
      ? ['商品属性（显式指定）：', ...payload.attributes.map(a => `  - ${a.name}=${a.value}`)]
      : []),
    '',
    '★ 本工具自动填「类目 / 标题 / 价格 / 库存 / 货号 / 主图 / 规格 SKU / 类目属性（品牌除外）/ 运费模板」，',
    '  品牌、商品资质与部分类目属性**不会**自动填写，需在弹出的浏览器窗口内人工补全。',
    '',
    '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正打开浏览器提交。',
    '注意：发布是不可撤销的真实操作（L2）。',
  ].join('\n')
}

/* ══════════════════════════════════════════════════════════════════
 * 表单填写步骤（每步都返回「已填 / 未填」，锚点落空不假成功）
 * ══════════════════════════════════════════════════════════════════ */

async function stepFillBasicFields(
  page: any,
  cc: ChannelConfig,
  payload: PublishPayload,
  filled: string[],
  missed: string[],
): Promise<void> {
  const fs = (cc.cfg.fieldStrategies || {}) as Record<string, Record<string, unknown>>
  const anchorNameOf = (key: string): string => String(fs[key]?.anchor || '')
  const fallbackRe = (key: string): RegExp | null => {
    const a = anchorNameOf(key)
    const spec = a ? anchor(cc.cfg, a) : null
    const src = spec?.fillFieldFallbackRe
    return src ? new RegExp(src) : null
  }
  const labelList = (key: string): string[] => {
    const a = anchorNameOf(key)
    const spec = a ? anchor(cc.cfg, a) : null
    return spec?.fillFieldFallbackRe ? [String(spec.fillFieldFallbackRe)] : []
  }

  // 标题（必填项，失败要显式记 missed）
  const titleRe = fallbackRe('title') || /商品标题|标题|商品名称/
  const titleHit = await fillText(page, titleRe, payload.title, labelList('title'))
  if (titleHit) filled.push(`标题`)
  else missed.push('标题（未定位到标题输入框）')

  const simpleFields: Array<[string, string, RegExp, string]> = [
    ['price', payload.price, /价格|售价|单价|京东价|批发价/, '价格'],
    ['stock', payload.stock || cc.defaultStock, /库存|可售/, '库存'],
    ['itemNo', payload.itemNo, /货号|商家编码|商品编号|编码/, '货号'],
  ]
  for (const [key, value, re, label] of simpleFields) {
    if (!value) continue
    const hit = await fillText(page, fallbackRe(key) || re, value, labelList(key))
    if (hit) filled.push(label)
    else missed.push(`${label}（未定位到输入框）`)
  }
}

/** 选类目：搜索框 → Enter → 按标题相关性挑候选 → 点确认 → 等新页/表单 */
async function stepSelectCategory(
  page: any,
  browser: any,
  cc: ChannelConfig,
  keyword: string,
  title: string,
): Promise<{ page: any; note: string; path: string }> {
  const searchSpec = anchor(cc.cfg, 'cateSearchInput')
  const searchSel = cssList(searchSpec)
  if (!searchSel) return { page, note: '配置缺少 cateSearchInput 锚点', path: '' }

  const hasBox = await waitVisible(page, searchSel, 20_000)
  if (!hasBox) {
    // 可能在「入口选择页」：先尝试点一个「发布商品 / 搜索类目」入口
    const entrySpec = anchor(cc.cfg, 'cateConfirmButton')
    await clickAnchor(page, entrySpec)
    await sleep(2000)
    if (!(await visible(page, searchSel))) {
      return { page, note: `未找到类目搜索框（${searchSel}）`, path: '' }
    }
  }

  // 写入关键词（React 受控组件走原生 setter + input 事件）
  const typed = await page.evaluate((sel: string, kw: string) => {
    const inp = document.querySelector(sel) as HTMLInputElement | null
    if (!inp) return false
    inp.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(inp, kw); else inp.value = kw
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, searchSel, keyword).catch(() => false) as boolean
  if (!typed) return { page, note: '类目搜索框写入失败', path: '' }

  await page.keyboard.press('Enter').catch(() => { /* 忽略 */ })
  await sleep(UI_STEP_DELAY_MS)

  // 候选：按与标题的字词重叠打分挑（0 分的仅在全池无正分时兜底）
  const resultSel = cssList(anchor(cc.cfg, 'cateResultItem'))
  let path = ''
  if (resultSel) {
    const picked = await page.evaluate((sel: string, t: string) => {
      const nodes = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(e => e.offsetParent !== null)
      const text = (e: HTMLElement) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()
      const score = (s: string) => {
        let n = 0
        for (const ch of new Set(t.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ''))) if (s.includes(ch)) n += 1
        return n
      }
      const scored = nodes.map((e, i) => ({ e, i, s: score(text(e)) }))
      const positive = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s)
      const pick = (positive[0] || scored[0])?.e
      if (!pick) return null
      pick.scrollIntoView({ block: 'center' })
      const r = pick.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: text(pick).slice(0, 80) }
    }, resultSel, title).catch(() => null) as { x: number; y: number; text: string } | null
    if (picked) {
      await page.mouse.move(picked.x, picked.y).catch(() => { /* 忽略 */ })
      await sleep(200)
      await page.mouse.click(picked.x, picked.y).catch(() => { /* 忽略 */ })
      path = picked.text
      await sleep(1500)
    }
  }

  // 确认按钮（选好类目后才会从禁用变可用）
  const confirmSpec = anchor(cc.cfg, 'cateConfirmButton')
  if (confirmSpec) {
    const ready = await page.evaluate((spec: { sels: string[]; texts: string[] }) => {
      const vis = (e: Element | null) => !!e && (e as HTMLElement).offsetParent !== null
      const pool = Array.from(document.querySelectorAll('button, [role="button"], a')) as HTMLElement[]
      const byText = pool.find(e => vis(e) && !(e as HTMLButtonElement).disabled
        && spec.texts.some(t => (e.innerText || '').replace(/\s+/g, '') === t.replace(/\s+/g, '')))
      if (byText) return true
      for (const sel of spec.sels) {
        const el = document.querySelector(sel) as HTMLButtonElement | null
        if (vis(el) && !el!.disabled) return true
      }
      return false
    }, {
      sels: confirmSpec.candidates.filter(c => !c.selector.startsWith('text:')).map(c => c.selector),
      texts: textCandidates(confirmSpec),
    }).catch(() => false) as boolean
    if (ready) {
      await clickAnchor(page, confirmSpec, { exact: true })
      await sleep(UI_STEP_DELAY_MS)
    }
  }

  // 选完类目常新开标签页 → 切过去
  let nextPage: any = null
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const pages = await browser.pages().catch(() => [])
    const fresh = pages.find((p: any) => {
      const u = String(p.url() || '')
      return p !== page && u && u !== 'about:blank'
    })
    if (fresh) { nextPage = fresh; break }
    await sleep(800)
  }
  if (nextPage) {
    await nextPage.bringToFront().catch(() => { /* 忽略 */ })
    await nextPage.setViewport({ width: 1440, height: 900 }).catch(() => { /* 忽略 */ })
    await sleep(2000)
    return { page: nextPage, note: `已切换到新发布页：${String(nextPage.url()).slice(0, 80)}`, path }
  }
  return { page, note: '未捕获新发布标签页，继续等待当前页表单', path }
}

/** 主图上传：优先直投 file input，落空则真实点上传区 + fileChooser */
async function stepUploadImages(
  page: any,
  cc: ChannelConfig,
  images: string[],
  filled: string[],
  missed: string[],
): Promise<void> {
  if (!images.length) return
  const fileSel = cssList(anchor(cc.cfg, 'mainImageInput')) || 'input[type="file"]'

  const direct = await (async () => {
    const handles = await page.$$(fileSel).catch(() => [])
    for (const h of handles) {
      const usable = await h.evaluate((e: HTMLInputElement) =>
        !e.disabled && (!e.accept || /image|\*/.test(e.accept))).catch(() => false)
      if (!usable) continue
      await h.uploadFile(...images).catch(() => { /* 忽略 */ })
      return true
    }
    return false
  })()

  if (!direct) {
    // 真实点击上传区，等原生文件框
    const zoneSpec = anchor(cc.cfg, 'mainImageZone')
    const loc = await locateClickable(page, zoneSpec)
    if (loc.found) {
      const fcPromise = page.waitForFileChooser({ timeout: 8000 }).catch(() => null)
      await page.mouse.move(loc.x, loc.y).catch(() => { /* 忽略 */ })
      await sleep(200)
      await page.mouse.click(loc.x, loc.y).catch(() => { /* 忽略 */ })
      const fc = await fcPromise
      if (fc) await fc.accept(images).catch(() => { /* 忽略 */ })
    }
  }

  // 等上传完成：轮询主图区 img 数量
  const deadline = Date.now() + cc.uploadWaitMs
  let count = 0
  while (Date.now() < deadline) {
    count = await page.evaluate((zone: string) => {
      const c = zone ? document.querySelector(zone) : null
      const root = c || document
      return root.querySelectorAll('img').length
    }, cssList(anchor(cc.cfg, 'mainImageZone'))).catch(() => 0) as number
    if (count > 0) break
    const fail = await page.evaluate((re: string) => {
      const t = (document.body as HTMLElement | null)?.innerText || ''
      return new RegExp(re).test(t)
    }, cc.uploadFailureRe).catch(() => false) as boolean
    if (fail) {
      missed.push(`主图（页面提示上传异常：${cc.uploadFailureRe}）`)
      return
    }
    await sleep(1500)
  }
  if (count > 0) filled.push(`主图×${images.length}（页面已渲染 ${count} 张）`)
  else missed.push(`主图（未确认渲染，已尝试 ${direct ? '直投 file input' : '点击上传区等待文件框'}；请在窗口内人工确认）`)
}

/** 规格 SKU：规格值逐个键入 + Tab，然后回填 SKU 表价格/库存/编码 */
async function stepFillSku(
  page: any,
  cc: ChannelConfig,
  payload: PublishPayload,
  filled: string[],
  missed: string[],
): Promise<void> {
  // ★ 多维规格（颜色 × 尺码）：**每个维度各有一个规格值输入框**，必须逐维度填。
  //   旧实现只填 specs[0]，二维商品会只生成第一维的值 → SKU 表缺列 → 必被平台拦。
  const dims: Array<{ name: string; values: string[] }> = payload.specs.length
    ? payload.specs.slice(0, 2).map(d => ({ name: d.name, values: d.values.map(v => v.value).filter(Boolean) }))
    : (() => {
        // 无 specs、只有 skus：按维度名从 skus 的 specs 键里反推
        const keys = Array.from(new Set(payload.skus.flatMap(s => Object.keys(s.specs || {}))))
        return keys.map(k => ({
          name: k,
          values: Array.from(new Set(payload.skus.map(s => String(s.specs?.[k] || '')).filter(Boolean))),
        }))
      })()
  if (!dims.length) return

  const specSpec = anchor(cc.cfg, 'specInput')
  const inputSel = cssList(specSpec)
  if (!inputSel) {
    missed.push('规格（配置缺少 specInput 锚点）')
    return
  }

  /**
   * 定位第 dimIdx 个维度的规格值输入框。
   * 同页多个维度时，第 N 个维度的输入框按「可见输入框顺序」取第 N 个；
   * 只有一个维度（或页面只渲染一个）时全部沿用第 0 个的坐标。
   */
  const posOf = async (dimIdx: number): Promise<{ x: number; y: number } | null> =>
    await page.evaluate((sel: string, idx: number) => {
      const boxes = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(e => e.offsetParent !== null)
      if (!boxes.length) return null
      const box = boxes[Math.min(idx, boxes.length - 1)]
      box.scrollIntoView({ block: 'center' })
      const r = box.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, inputSel, dimIdx).catch(() => null) as { x: number; y: number } | null

  let filledDims = 0
  for (let di = 0; di < dims.length; di++) {
    const pos = await posOf(di)
    if (!pos) {
      missed.push(`规格「${dims[di].name}」（未定位到输入框）`)
      continue
    }
    let okCount = 0
    for (const name of dims[di].values) {
      await page.mouse.click(pos.x, pos.y).catch(() => { /* 忽略 */ })
      await sleep(250)
      await page.keyboard.type(name, { delay: 60 }).catch(() => { /* 忽略 */ })
      await sleep(250)
      // ★ Tab = onBlur：受控组件唯一能把值写进 state 的方式（Enter 无效）
      await page.keyboard.press('Tab').catch(() => { /* 忽略 */ })
      await sleep(1000)
      okCount += 1
    }
    if (okCount) filledDims += 1
  }
  const names = dims.flatMap(d => d.values)

  // 回填 SKU 表：每行按行序对齐价格/库存/编码
  const rowSel = cssList(anchor(cc.cfg, 'skuTableRow'))
  const dimSummary = `${filledDims}/${dims.length} 维、${names.length} 个规格值`
  if (!rowSel) {
    missed.push('SKU 表（配置缺少 skuTableRow 锚点，价格/库存需人工填写）')
    if (names.length) filled.push(`规格（${dimSummary}）`)
    return
  }
  const rowCount = await page.evaluate((sel: string) =>
    Array.from(document.querySelectorAll(sel)).filter(e => (e as HTMLElement).offsetParent !== null).length,
  rowSel).catch(() => 0) as number

  if (!rowCount) {
    missed.push(`SKU 表（规格已输入 ${dimSummary} 但未生成行）`)
    return
  }

  /**
   * SKU 表的行序 = 规格值笛卡尔积（多数平台按「第一维慢、第二维快」展开），
   * 因此先按 dims 生成组合序列，再用「该行组合 → payload.skus 里同组合的价格/库存」对齐。
   * ★ 不能直接用 payload.skus[i]：用户可能只给部分组合，或行序与入参不同（平台会重排）。
   */
  const combos: Array<Record<string, string>> = (() => {
    let acc: Array<Record<string, string>> = [{}]
    for (const d of dims) {
      const next: Array<Record<string, string>> = []
      for (const base of acc) for (const v of d.values) next.push({ ...base, [d.name]: v })
      acc = next
    }
    return acc
  })()
  const skuOf = (combo: Record<string, string>): (typeof payload.skus)[number] | undefined =>
    payload.skus.find(s => dims.every(d => String(s.specs?.[d.name] || '') === combo[d.name]))
      // 单维时平台行序可能与输入不同，兜底按值匹配
      || (dims.length === 1
        ? payload.skus.find(s => Object.values(s.specs || {})[0] === combo[dims[0].name])
        : undefined)

  let done = 0
  for (let i = 0; i < rowCount; i++) {
    const row = skuOf(combos[i] || {}) || payload.skus[i]
    const price = (row?.price || payload.price || '').trim()
    const stock = (row?.stock || payload.stock || cc.defaultStock).trim()
    const outer = (row?.itemNo || '').trim()
    const targets: Array<[RegExp, string, number]> = [
      [/价格|售价|单价|京东价/, price, 0],
      [/库存|可售/, stock, 1],
      [/编码|货号|skuId|商家/, outer, 2],
    ]
    for (const [re, value, fallbackIdx] of targets) {
      if (!value) continue
      const ok = await page.evaluate((sel: string, idx: number, kwSrc: string, v: string, fi: number) => {
        const rows = Array.from(document.querySelectorAll(sel)).filter(e => (e as HTMLElement).offsetParent !== null) as HTMLElement[]
        const tr = rows[idx]
        if (!tr) return false
        const rx = new RegExp(kwSrc)
        const inputs = (Array.from(tr.querySelectorAll('input')) as HTMLInputElement[]).filter(i => i.offsetParent !== null)
        const hit = inputs.find(i => rx.test(i.placeholder || '') || rx.test(i.name || '') || rx.test(i.getAttribute('aria-label') || ''))
          || inputs.filter(i => i.type === 'text' || i.type === 'number' || !i.type)[fi]
        if (!hit) return false
        hit.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (setter) setter.call(hit, v); else hit.value = v
        hit.dispatchEvent(new Event('input', { bubbles: true }))
        hit.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, rowSel, i, re.source, value, fallbackIdx).catch(() => false) as boolean
      if (ok) await sleep(cc.skuCellWaitMs)
    }
    done += 1
  }
  filled.push(`规格（${dimSummary}）、SKU 表 ${done} 行（价格/库存/编码已尽力回填）`)
  missed.push('SKU 表（部分列可能未命中，请在窗口内核对价格与库存）')
}

/** 类目属性：显式值优先 → 必填项尝试标题包含匹配 → 其余跳过（品牌一律跳过） */
async function stepFillAttributes(
  page: any,
  cc: ChannelConfig,
  payload: PublishPayload,
  filled: string[],
  missed: string[],
): Promise<void> {
  const itemSel = cssList(anchor(cc.cfg, 'attrItem'))
  if (!itemSel) {
    missed.push('类目属性（配置缺少 attrItem 锚点）')
    return
  }
  const items = await page.evaluate((sel: string) => {
    const nodes = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(e => e.offsetParent !== null)
    return nodes.slice(0, 40).map((e, i) => ({
      i,
      label: (e.innerText || '').replace(/\s+/g, '').slice(0, 20),
      required: /[*＊]/.test(e.innerText || '') || !!e.querySelector('[class*="required"], .required, [class*="important"]'),
    }))
  }, itemSel).catch(() => []) as Array<{ i: number; label: string; required: boolean }>

  if (!items.length) {
    missed.push('类目属性（未读到属性项，可能该类目无属性或换版）')
    return
  }

  const explicit = new Map(payload.attributes.map(a => [a.name.replace(/\s+/g, ''), a.value]))
  let done = 0
  for (const it of items) {
    const name = it.label.replace(/[*＊:：].*$/, '').trim()
    if (!name) continue
    if (cc.attrSkipRe.test(name)) {
      missed.push(`属性「${name}」（品牌类一律留人工：授权风险）`)
      continue
    }
    let want = explicit.get(name) || ''
    if (!want) {
      // 必填项兜底：选项里挑一个标题包含的；否则留人工
      const opened = await page.evaluate((sel: string, idx: number) => {
        const nodes = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(e => e.offsetParent !== null)
        const el = nodes[idx]
        if (!el) return false
        const trig = (el.querySelector('[class*="select"], [class*="dropdown"], input') || el) as HTMLElement
        trig.click()
        return true
      }, itemSel, it.i).catch(() => false) as boolean
      if (!opened) continue
      await sleep(cc.attrDropdownWaitMs)
      const panelSel = cssList(anchor(cc.cfg, 'attrDropdownPanel'))
      const optSel = cssList(anchor(cc.cfg, 'attrOption')) || 'li, [role="option"]'
      const options = panelSel ? await readOptions(page, panelSel, optSel) : []
      if (!options.length) continue
      const hit = options.find(o => payload.title.includes(o))
      if (hit && it.required) want = hit
      if (!want) {
        await page.keyboard.press('Escape').catch(() => { /* 忽略 */ })
        continue
      }
      const clicked = panelSel ? await clickOption(page, panelSel, optSel, want) : false
      if (clicked) done += 1
      await sleep(400)
      continue
    }
    // 显式属性：展开 → 读真实候选 → 点中 → 回读
    const opened = await page.evaluate((sel: string, idx: number) => {
      const nodes = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(e => e.offsetParent !== null)
      const el = nodes[idx]
      if (!el) return false
      const trig = (el.querySelector('[class*="select"], [class*="dropdown"], input') || el) as HTMLElement
      trig.click()
      return true
    }, itemSel, it.i).catch(() => false) as boolean
    if (!opened) {
      missed.push(`属性「${name}」= ${want}（未打开下拉）`)
      continue
    }
    await sleep(cc.attrDropdownWaitMs)
    const panelSel = cssList(anchor(cc.cfg, 'attrDropdownPanel'))
    const optSel = cssList(anchor(cc.cfg, 'attrOption')) || 'li, [role="option"]'
    const options = panelSel ? await readOptions(page, panelSel, optSel) : []
    if (!options.some(o => o === want || o.includes(want))) {
      missed.push(`属性「${name}」= ${want}（值不在当前类目候选里：${options.slice(0, 6).join('/') || '无候选'}）`)
      await page.keyboard.press('Escape').catch(() => { /* 忽略 */ })
      continue
    }
    const clicked = panelSel ? await clickOption(page, panelSel, optSel, want) : false
    if (clicked) done += 1
    else missed.push(`属性「${name}」= ${want}（点选失败）`)
    await sleep(400)
  }
  filled.push(`类目属性 ${done}/${items.length} 项`)
}

/** 运费模板：选一个模板（隐藏必填项，漏填必被拦） */
async function stepFillFreight(
  page: any,
  cc: ChannelConfig,
  filled: string[],
  missed: string[],
): Promise<void> {
  const sel = cssList(anchor(cc.cfg, 'freightSelect'))
  const zone = anchor(cc.cfg, 'freightZone')
  if (!sel) {
    missed.push('运费模板（配置缺少 freightSelect 锚点）')
    return
  }
  const opened = await page.evaluate((s: string) => {
    const el = (Array.from(document.querySelectorAll(s)) as HTMLElement[]).find(e => e.offsetParent !== null)
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, sel).catch(() => false) as boolean
  if (!opened) {
    // 可能整块不存在（部分类目不需要），点一下区域内的触发器再试
    await clickAnchor(page, zone)
    await sleep(800)
    missed.push('运费模板（未找到模板下拉；该类目可能不需要，或需人工选择）')
    return
  }
  await sleep(cc.attrDropdownWaitMs)
  const panelSel = cssList(anchor(cc.cfg, 'attrDropdownPanel'))
  const optSel = cssList(anchor(cc.cfg, 'attrOption')) || 'li, [role="option"]'
  const options = panelSel ? await readOptions(page, panelSel, optSel) : []
  if (!options.length) {
    missed.push('运费模板（未读到候选，需人工选择）')
    return
  }
  const target = options.find(o => /默认/.test(o)) || options[0]
  const clicked = panelSel ? await clickOption(page, panelSel, optSel, target) : false
  if (clicked) filled.push(`运费模板（${target}）`)
  else missed.push(`运费模板（候选读到了但点选失败：${options.slice(0, 4).join('/')}）`)
  await sleep(500)
}

/** 三路错误回读：toast + 字段级红字（+ 泛化 error 文本） */
async function readSubmitErrors(page: any, cc: ChannelConfig): Promise<{ hard: string; toast: string; fields: string[] }> {
  const toastSpec = anchor(cc.cfg, 'errorToast')
  const toastSel = cssList(toastSpec)
  const excludeRe = String((toastSpec as any)?.excludeTextRe || '')
  return await page.evaluate((tSel: string, fSel: string, exclude: string) => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
    const bad = /失败|错误|不能|不可|必填|请输入|请选择|请填写|请上传|请完善|不正确|超出|不支持|违规|重复|无效|已存在|限制/
    let toast = ''
    if (tSel) {
      const el = (Array.from(document.querySelectorAll(tSel)) as HTMLElement[]).find(e => e.offsetParent !== null)
      const t = norm(el?.innerText || '')
      let excluded = false
      if (exclude) {
        try { excluded = new RegExp(exclude).test(t) } catch { excluded = false }
      }
      if (t && bad.test(t) && !excluded) toast = t.slice(0, 120)
    }
    const fields: string[] = []
    if (fSel) {
      for (const el of Array.from(document.querySelectorAll(fSel)) as HTMLElement[]) {
        if (el.offsetParent === null) continue
        const t = norm(el.innerText)
        if (t && t.length <= 80 && bad.test(t)) fields.push(t)
      }
    }
    return { hard: [toast, ...fields].filter(Boolean).join('；'), toast, fields: Array.from(new Set(fields)).slice(0, 8) }
  }, toastSel, cssList(anchor(cc.cfg, 'errorField')), excludeRe).catch(() => ({ hard: '', toast: '', fields: [] as string[] })) as
    Promise<{ hard: string; toast: string; fields: string[] }>
}

/* ══════════════════════════════════════════════════════════════════
 * 主入口
 * ══════════════════════════════════════════════════════════════════ */

/** 把统一商品数据 / 扁平字段归一到引擎内部的 payload */
function toPayload(opts: MqsPublishOptions, cc: ChannelConfig): { payload?: PublishPayload; error?: string } {
  let base: Partial<ProductData> = {}
  if (opts.product != null) {
    const parsed = parseProduct(opts.product)
    if (parsed.error || !parsed.product) return { error: parsed.error || '商品数据解析失败' }
    const invalid = validateProduct(parsed.product)
    // 标题长度按渠道配置复核（统一校验用的是 60，各平台可能不同）
    if (invalid && !/标题超过 60/.test(invalid)) return { error: `商品数据校验未通过：${invalid}` }
    base = parsed.product
  } else {
    base = {
      title: opts.title,
      images: opts.images,
      detailImages: opts.detailImages,
      category: opts.category,
      price: opts.price,
      stock: opts.stock,
      itemNo: opts.itemNo,
      specs: opts.specs as ProductSpecDimension[] | undefined,
      skus: opts.skus,
      attributes: opts.attributes,
    }
  }
  const payload: PublishPayload = {
    title: String(base.title || '').trim(),
    images: (base.images || []).map(p => String(p || '').trim()).filter(Boolean).slice(0, cc.maxImages),
    detailImages: (base.detailImages || []).map(p => String(p || '').trim()).filter(Boolean).slice(0, cc.maxDetailImages),
    category: String(base.category || '').trim(),
    price: String(base.price || '').trim(),
    stock: String(base.stock || '').trim(),
    itemNo: String(base.itemNo || '').trim(),
    specs: (base.specs || []) as MqsSpecDimension[],
    skus: (base.skus || []) as ProductSku[],
    attributes: (base.attributes || []).map(a => ({ name: String(a.name || '').trim(), value: String(a.value || '').trim() }))
      .filter(a => a.name && a.value),
  }
  return { payload }
}

/** 入参校验（全部在开浏览器之前，零副作用） */
function validatePayload(payload: PublishPayload, cc: ChannelConfig): string | null {
  if (!payload.title) return '缺少 title（商品标题必填）'
  if (payload.title.length > cc.maxTitleLen) return `商品标题超过 ${cc.maxTitleLen} 个字符（当前 ${payload.title.length} 个）`
  if (!payload.images.length) return '缺少 images（主图，至少 1 张本地绝对路径）'
  for (const p of [...payload.images, ...payload.detailImages]) {
    if (!existsSync(p)) return `图片文件不存在：${p}`
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size === 0) return `图片文件不可用（非文件或大小为 0）：${p}`
      if (st.size > cc.maxImageBytes) {
        return `图片超过单张上限 ${(cc.maxImageBytes / 1024 / 1024).toFixed(0)}MB：${basename(p)}（${(st.size / 1024 / 1024).toFixed(2)}MB）`
      }
    } catch (e) {
      return `无法读取图片文件：${e instanceof Error ? e.message : String(e)}`
    }
  }
  if (payload.price) {
    const n = Number(payload.price)
    if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) return `价格不合法：${payload.price}（应为正数、1 亿元以内）`
  }
  if (payload.stock) {
    const n = Number(payload.stock)
    if (!Number.isInteger(n) || n < 0) return `库存不合法：${payload.stock}（应为非负整数）`
  }
  if (payload.specs.length > 2) return `规格维度最多 2 个（当前 ${payload.specs.length} 个）`
  for (let i = 0; i < payload.skus.length; i++) {
    const s = payload.skus[i]
    for (const d of payload.specs) {
      if (!s.specs?.[d.name]) return `第 ${i + 1} 个 SKU 缺少规格维度「${d.name}」的值`
    }
  }
  return null
}

/** 类目搜索关键词：优先显式 category，其次从标题提取（去营销词/标点） */
function categoryKeywordOf(payload: PublishPayload): string[] {
  const out: string[] = []
  const push = (s: string) => {
    const v = String(s || '').replace(/[【】\[\]()（）]/g, ' ').replace(/\s+/g, ' ').trim()
    if (v.length >= 2 && !out.includes(v)) out.push(v)
  }
  push(payload.category)
  const cleaned = payload.title.replace(/[【】\[\]()（）!！~～,，.。:：;；/\\|+*]/g, ' ').replace(/\s+/g, ' ').trim()
  push(cleaned)
  for (const w of cleaned.split(' ')) if (w.length >= 2) push(w)
  return out.slice(0, 4)
}

/** 发布入口（带 confirm 门禁 / 账号选择 / 浏览器复用 / 人工接管语义） */
export async function mqsPublish(
  store: CredentialStore,
  channel: MqsChannel,
  opts: MqsPublishOptions,
): Promise<MqsPublishResult> {
  const spec = CHANNELS[channel]
  const cfgRes = readChannelConfig(channel)
  if (cfgRes.error || !cfgRes.config) {
    return { ok: false, failureKind: 'api_error', text: `${spec.label}发布配置加载失败：${cfgRes.error || '未知原因'}` }
  }
  const cc = cfgRes.config
  const maybe = toPayload(opts, cc)
  if (maybe.error || !maybe.payload) {
    return { ok: false, failureKind: 'api_error', text: maybe.error || '商品数据为空' }
  }
  const payload = maybe.payload

  const invalid = validatePayload(payload, cc)
  if (invalid) return { ok: false, failureKind: 'api_error', text: invalid }

  const picked = selectAccount(store, channel, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!

  if (opts.confirm !== true && opts.diagDom !== true) {
    return { ok: false, needConfirm: true, shopKey: account.shop_key, text: buildPreview(channel, account, payload, cc) }
  }

  const dir = profileDir(spec.platform, account.shop_key)
  const busy = profileOwner(dir)
  if (!tryAcquireProfile(dir, spec.profileOwner)) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `${spec.label}的浏览器环境正被「${busy || '其他任务'}」占用。请先等待该任务结束或关闭已弹出的浏览器窗口，再重试。`,
    }
  }

  const shopKey = account.shop_key
  const cookies = account.cookies || {}
  const filled: string[] = []
  const missed: string[] = []
  let browser: any = null
  let attached = false
  let page: any = null
  let succeeded = false

  const notes: string[] = []
  try {
    const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core' as string) as {
      launch: (o: any) => Promise<any>
      connect: (o: any) => Promise<any>
    }
    const chromePath = findChromePath()
    if (!chromePath) {
      return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' }
    }

    // 复用已开窗口（避免反复开关）；端口归属校验防串号
    const port = readDevToolsPortSafe(dir)
    if (port) {
      const ownership = verifyPortOwnership(dir, port)
      if (ownership !== 'mismatch') {
        try {
          browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
          attached = true
          const pages = await browser.pages()
          const usable = pages.filter((p: any) => !/^(devtools|chrome-extension):/.test(String(p.url() || '')))
          page = usable.find((p: any) => spec.domains.some(d => String(p.url() || '').includes(d))) || usable[0] || await browser.newPage()
          registerProfilePort(dir, port)
          console.log(`[dsagent-mqs] 复用现有浏览器窗口（端口 ${port}）`)
        } catch {
          browser = null
          attached = false
        }
      }
    }
    if (!browser) {
      const launchOpts = {
        headless: false,
        executablePath: chromePath,
        userDataDir: dir,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900', '--remote-debugging-port=0'],
      }
      clearProfileLocks(dir)
      try {
        browser = await puppeteer.launch(launchOpts)
      } catch {
        clearProfileLocks(dir)
        browser = await puppeteer.launch(launchOpts)
      }
      const newPort = readDevToolsPortSafe(dir)
      if (newPort) registerProfilePort(dir, newPort)
    }
    if (!page) page = await browser.newPage()

    page.on('dialog', async (d: any) => {
      try {
        console.log(`[dsagent-mqs] 自动处理页面弹窗（${d.type()}）：${d.message()}`)
        await d.accept()
      } catch { /* 弹窗可能已被处理 */ }
    })
    await page.setViewport({ width: 1440, height: 900 })
    await applyStealth(page)

    // Cookie 注入（多域：抖店要同时喂 .jinritemai.com 与 .douyin.com）
    const cookieList = Object.entries(cookies)
      .filter(([, v]) => v !== '' && v != null)
      .flatMap(([name, value]) => cc.cookieDomains.map(domain => ({ name, value: String(value), domain, path: '/' })))
    if (cookieList.length) {
      await page.setCookie(...cookieList).catch((e: any) => {
        notes.push(`Cookie 注入部分失败：${e instanceof Error ? e.message : String(e)}`)
      })
      console.log(`[dsagent-mqs] 已注入 ${cookieList.length} 个 Cookie（账号 ${shopKey}，域 ${cc.cookieDomains.join('/')}）`)
    }

    // ── 1. 打开发布入口 ──
    console.log(`[dsagent-mqs] 打开${spec.label}发布入口：${cc.entryUrl}`)
    await page.goto(cc.entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e: any) => {
      notes.push(`打开发布入口异常：${e instanceof Error ? e.message : String(e)}`)
    })
    await sleep(UI_STEP_DELAY_MS)

    // 登录失效 / 风控快速判定
    const urlNow = String(page.url() || '')
    if (new RegExp(cc.loginUrlRe, 'i').test(urlNow)) {
      await store.setStatus(shopKey, 'expired').catch(() => { /* 忽略 */ })
      return {
        ok: false,
        failureKind: 'token_expired',
        shopKey,
        finalUrl: urlNow,
        text: `${spec.label}登录态在发布页无效（页面跳到了登录页 ${urlNow}）。\n`
          + `请到「账号连接」页面重新登录${spec.label}账号后重试。`,
      }
    }
    if (await visible(page, cc.riskSelector)) {
      return {
        ok: false,
        failureKind: 'risk_control',
        shopKey,
        finalUrl: urlNow,
        verifyUrl: urlNow,
        text: `${spec.label}发布页命中了安全风控（滑块 / 验证页）。\n`
          + `验证入口：${urlNow}\n`
          + `请先调用 dsagent_risk_verify（platform=${spec.platform}，verifyUrl=${urlNow}），在弹出窗口内完成验证；`
          + '也可在已打开的浏览器窗口内手动完成验证后重试本工具。',
      }
    }

    // ── 诊断模式：dump DOM 后直接返回（零风险） ──
    if (opts.diagDom) {
      const dump = await dumpDom(page, `${channel}-entry`)
      return {
        ok: true,
        shopKey,
        finalUrl: String(page.url() || ''),
        text: `【${spec.label}发布页 DOM 诊断】\n${dump}\n\n`
          + `按上面的可见输入框/按钮，把 publish-config/${spec.configPlatform}.json 里的 L2 语义锚点替换成真实选择器即可（改完热生效，无需重启）。`,
      }
    }

    // ── 2. 选类目（没有配置搜索框的平台直接跳过，等表单） ──
    const keywords = categoryKeywordOf(payload)
    if (cssList(anchor(cc.cfg, 'cateSearchInput'))) {
      let chosen = false
      for (const kw of keywords) {
        const r = await stepSelectCategory(page, browser, cc, kw, payload.title)
        page = r.page
        if (r.path) { notes.push(`类目搜索「${kw}」→ ${r.path}`); chosen = true; break }
        notes.push(`类目搜索「${kw}」未命中（${r.note}）`)
      }
      if (!chosen) missed.push('类目（自动选类目未命中，请在窗口内手动选好类目）')
    }

    // ── 3. 等发布表单就绪 ──
    const formReadyCss = cssList(anchor(cc.cfg, 'formReady'))
    const ready = formReadyCss ? await waitVisible(page, formReadyCss, cc.formWaitMs) : false
    if (!ready) {
      const dump = await dumpDom(page, `${channel}-no-form`)
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: String(page.url() || ''),
        text: `等待 ${cc.formWaitMs / 1000}s 未等到${spec.label}发布表单就绪。\n`
          + `未命中的就绪锚点：${formReadyCss || '（配置缺失）'}\n`
          + '常见原因：① 停在选类目/开店引导页；② 页面改版导致锚点失效；③ 账号无发品权限。\n'
          + `${dump}\n\n请在已打开的浏览器窗口内手动完成，或按上面的 DOM 诊断修正 `
          + `publish-config/${spec.configPlatform}.json 后重试。`,
      }
    }

    // ── 4. 基础字段 ──
    await stepFillBasicFields(page, cc, payload, filled, missed)

    // ── 5. 主图 ──
    await stepUploadImages(page, cc, payload.images, filled, missed)

    // ── 6. 规格 SKU ──
    await stepFillSku(page, cc, payload, filled, missed)

    // ── 7. 类目属性 ──
    await stepFillAttributes(page, cc, payload, filled, missed)

    // ── 8. 运费模板（隐藏必填） ──
    await stepFillFreight(page, cc, filled, missed)

    // ── 9. 提交 ──
    const submitSpec = anchor(cc.cfg, 'submitButton')
    const clicked = await clickAnchor(page, submitSpec)
    if (!clicked) {
      const dump = await dumpDom(page, `${channel}-no-submit`)
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: String(page.url() || ''),
        missed,
        filled,
        text: `${spec.label}表单已尽量填写，但未找到提交按钮（锚点 submitButton 未命中）。\n`
          + `${dump}\n\n请在已打开的浏览器窗口内核对后手动点提交。`,
      }
    }

    // ── 10. 结果判定（成功文案 / 三路错误回读） ──
    let errText = ''
    let errDetail = ''
    const deadline = Date.now() + cc.publishTimeoutMs
    while (Date.now() < deadline) {
      await sleep(2000)
      const txt = await bodyText(page)
      if (new RegExp(cc.successRe).test(txt)) { succeeded = true; break }
      const err = await readSubmitErrors(page, cc)
      if (err.hard) {
        errText = err.hard
        errDetail = [err.toast && `toast：${err.toast}`, err.fields.length && `字段：${err.fields.join(' / ')}`]
          .filter(Boolean).join('；')
        break
      }
      // 页面已跳走（部分平台提交后直接跳商品列表）也算成功
      const nowUrl = String(page.url() || '')
      if (cc.goodsListUrl && nowUrl.includes(cc.goodsListUrl)) { succeeded = true; break }
    }

    if (succeeded) {
      await store.setStatus(shopKey, 'valid').catch(() => { /* 忽略 */ })
      return {
        ok: true,
        shopKey,
        finalUrl: String(page.url() || ''),
        filled,
        missed,
        text: `${spec.label}商品发布已提交成功。\n`
          + `账号：${account.display_label || account.account_id}（${shopKey}）\n`
          + `标题：${payload.title}\n`
          + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
          + (missed.length ? `未自动填写（需人工确认）：${missed.join('、')}\n` : '')
          + (notes.length ? `过程记录：${notes.join('；')}\n` : '')
          + `当前页面：${String(page.url() || '')}\n`
          + `注意：平台仍会审核，最终状态请在${spec.label}商家后台「商品管理」确认。`,
      }
    }

    if (errText) {
      return {
        ok: false,
        failureKind: 'api_error',
        shopKey,
        finalUrl: String(page.url() || ''),
        filled,
        missed,
        text: `${spec.label}提交被拦：${errText}\n`
          + (errDetail ? `诊断：${errDetail}\n` : '')
          + (missed.length ? `未自动填写的字段：${missed.join('、')}\n` : '')
          + '请在浏览器窗口内补全必填项（尤其类目属性与商品详情）后手动点提交。',
      }
    }

    const dump = await dumpDom(page, `${channel}-timeout`)
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      finalUrl: String(page.url() || ''),
      filled,
      missed,
      text: `${spec.label}提交后 ${cc.publishTimeoutMs / 1000}s 内未检测到成功标志，也读不到明确拦因。\n`
        + (missed.length ? `未自动填写：${missed.join('、')}\n` : '')
        + `${dump}\n\n请在浏览器窗口内确认状态（可能已提交成功但文案不同），必要时手动补交。`,
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `${spec.label}发布异常：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    if (browser) {
      if (attached && !succeeded) {
        try { browser.disconnect() } catch { /* 忽略 */ }
      } else if (!succeeded) {
        // 未成功：保留窗口供人工补全（不关、不断）
        try { await page?.bringToFront?.() } catch { /* 忽略 */ }
      } else {
        try { await browser.close() } catch { /* 忽略 */ }
      }
    }
    releaseProfile(dir)
  }
}

/** 读 DevToolsActivePort（复用已开窗口用） */
function readDevToolsPortSafe(dir: string): number | null {
  try {
    const f = join(dir, 'DevToolsActivePort')
    if (!existsSync(f)) return null
    const port = Number.parseInt(readFileSync(f, 'utf8').split('\n')[0].trim(), 10)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

/** 「上架」入口：统一商品数据 → 渠道发布（与 pdd-publish2 同形态） */
export async function mqsPublish2(
  store: CredentialStore,
  channel: MqsChannel,
  opts: { product: unknown; confirm?: boolean; account?: string; agentId?: string; attrModel?: AttrModelHandle; diagDom?: boolean },
): Promise<MqsPublishResult> {
  return await mqsPublish(store, channel, {
    product: opts.product,
    confirm: opts.confirm,
    account: opts.account,
    agentId: opts.agentId,
    attrModel: opts.attrModel,
    diagDom: opts.diagDom,
  })
}

/** 渠道元信息（供工具层组装预览/文案与 tools 门禁的域名证据） */
export function mqsChannelInfo(channel: MqsChannel): { label: string; platform: string; domains: string[]; configPlatform: string } {
  const s = CHANNELS[channel]
  return { label: s.label, platform: s.platform, domains: [...s.domains], configPlatform: s.configPlatform }
}

/** 供工具层复用：把账号转候选（与凭证库同一形态） */
export function mqsAccountChoice(a: StoredAccount) {
  return toAccountChoice(a)
}

/** 写一份诊断文件（工具层调试用） */
export function writeDiagFile(name: string, body: string): string {
  try {
    const dir = join(process.cwd(), 'dev', '.ui-shots')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${name}-${Date.now()}.txt`)
    writeFileSync(file, body, 'utf8')
    return file
  } catch {
    return ''
  }
}
