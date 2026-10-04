/**
 * 账号连接页：账号的手动操作入口（模型不参与）。
 *
 * 照搬本项目现有账号页的 14 项功能：
 *   标题说明 / 6 列表格 / 平台色块 Logo / 登录信息双字段复制 / 状态徽标+i 提示 /
 *   检查·绑定智能体·重新登录·删除 / 分页器 / 空状态 / 三步添加弹窗 /
 *   按平台能力动态出登录方式 / 平台专属风控提示 / 登录进度流 / Toast / 删除二次确认
 *
 * 页面取数：注入优先 + 内置回退（无宿主时用回退数据渲染，保证可预览）。
 */

import type { AccountService } from '../services/account-service.ts'
import type { AccountRow, AccountStatus } from '../services/types.ts'
import { loginOwnerPlatform, normalizePlatform } from '../services/credential-store.js'
import type { Config } from '../index.ts'

const PLATFORM_META: Record<string, { label: string; color: string; glyph: string; via: string }> = {
  taobao: { label: '淘宝', color: '#ff5000', glyph: '淘', via: '阿里 SSO' },
  douyin: { label: '抖音', color: '#161823', glyph: '抖', via: '官方开放 API' },
  xiaohongshu: { label: '小红书', color: '#ff2442', glyph: '红', via: 'Cookie 托管' },
  bilibili: { label: 'B站', color: '#00a1d6', glyph: 'B', via: 'Cookie 托管' },
  kuaishou: { label: '快手', color: '#ff4906', glyph: '快', via: 'Cookie 托管' },
  wechat_mp: { label: '微信公众号', color: '#07c160', glyph: '微', via: 'AppID + Secret' },
  pinduoduo: { label: '拼多多', color: '#e02e24', glyph: '拼', via: '官方开放 API' },
  // ★ 拼多多商家后台与上面的「拼多多」（买家 H5）是两套独立登录态，单独一行
  pdd_mms: { label: '拼多多商家后台', color: '#e02e24', glyph: '拼', via: 'Cookie 托管' },
  wechat_store: { label: '微信小店', color: '#fa9d3b', glyph: '店', via: '官方开放 API' },
  zhihu: { label: '知乎', color: '#0084ff', glyph: '知', via: 'Cookie 托管' },
}

const STATUS_META: Record<AccountStatus, { label: string; cls: string }> = {
  valid: { label: '有效', cls: 'ok' },
  // expired（疑似过期，可先重试）与 reauth_required（必须重登）用**不同**标签与配色：
  // 前者提示「可能只是抖动」，后者是确定结论，用户看到就知道该去重登而不是反复重试。
  expired: { label: '疑似过期', cls: 'warn' },
  reauth_required: { label: '需重新登录', cls: 'bad' },
  invalid: { label: '登录失效', cls: 'bad' },
  pending: { label: '待验证', cls: 'idle' },
}

/** 各平台可用的登录方式（动态出按钮，与现有页一致） */
const LOGIN_METHODS: Record<string, Array<{ key: string; label: string; hint: string }>> = {
  taobao: [
    { key: 'qrcode', label: '扫码登录', hint: '打开淘宝 App 扫码' },
    { key: 'sso', label: '阿里 SSO 复用', hint: '复用已连的淘宝登录态' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  // ★ 不提供「生意参谋」独立登录入口：生意参谋/万相台/达摩盘/天猫洞察在凭证层都复用
  //   淘宝登录态（CREDENTIAL_PLATFORM → taobao），**登录淘宝后生意参谋即可用**。
  //   原有入口会让用户以为要单独登一次生意参谋，且它拿不到 `unb` 时会被误判为登录失败。
  // ★ 同样不提供「闲鱼」独立登录入口（FIX-LOG #70）：闲鱼也复用淘宝 SSO，其凭证行由
  //   淘宝登录成功后自动派生（见 browser-login.ts::ensureXianyuFromTaobao），且列表里隐藏。
  douyin: [
    { key: 'qrcode', label: '扫码登录', hint: '打开抖音 App 扫码' },
    { key: 'cdp', label: '复用本机 Chrome', hint: '读取本机已登录的 Chrome' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  xiaohongshu: [
    { key: 'qrcode', label: '扫码登录', hint: '打开小红书 App 扫码' },
    { key: 'cdp', label: '复用本机 Chrome', hint: '读取本机已登录的 Chrome' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  bilibili: [
    { key: 'qrcode', label: '扫码登录', hint: '打开 B站 App 扫码' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  kuaishou: [
    { key: 'qrcode', label: '扫码登录', hint: '打开快手 App 扫码' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  wechat_mp: [
    { key: 'qrcode', label: '管理员扫码', hint: '公众号后台扫码授权' },
    { key: 'appid', label: 'AppID + Secret', hint: '填写开发者凭证' },
  ],
  pinduoduo: [
    { key: 'qrcode', label: '扫码登录', hint: '打开拼多多 App 扫码' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  // ★ 商家后台登录页（mms.pinduoduo.com/login）有扫码 / 账号密码三个入口
  pdd_mms: [
    { key: 'qrcode', label: '扫码登录', hint: '打开拼多多 App 扫码（商家账号）' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
  wechat_store: [
    { key: 'qrcode', label: '管理员扫码', hint: '小店后台扫码授权' },
    { key: 'appid', label: 'AppID + Secret', hint: '填写开发者凭证' },
  ],
  zhihu: [
    { key: 'qrcode', label: '扫码登录', hint: '打开知乎 App 扫码' },
    { key: 'manual_cookie', label: '导入 Cookie', hint: '从浏览器复制粘贴' },
  ],
}

/** 平台专属风控/前置提示 */
const PLATFORM_NOTES: Record<string, string> = {
  taobao: '淘宝风控强度 L3，建议使用专用小号登录，避免与日常购物号混用。闲鱼 / 生意参谋 / 万相台 / 达摩盘技能共用此登录态，无需单独登录。',
  xiaohongshu: '小红书登录态有效期较短，建议登录后立刻到技能页启用所需技能。',
  douyin: '抖音开放平台需要企业开发者资质，个人号请使用扫码登录。',
  wechat_mp: '公众号需管理员本人扫码，且须为已认证的服务号或订阅号。',
  wechat_store: '微信小店需在后台开通「自定义应用」并授权本工具。',
  bilibili: 'B站登录态有效期约 30 天，过期后需在此重新登录。',
  kuaishou: '快手部分接口需开通企业认证，个人号仅支持只读数据。',
  pinduoduo: '拼多多开放平台需先申请应用并审核通过。',
  pdd_mms: '需用**商家账号**登录 mms.pinduoduo.com（商品发布/上架用）。它与「拼多多」买家账号是两套独立登录态，互不通用。拼多多滑块风控为页内内联，发布时需在弹出的可见窗口内手动拖动完成。',
  zhihu: '知乎登录态有效期约 30 天，过期后需在此重新登录。频繁请求可能触发风控，建议使用小号。',
}

const PAGE_SIZE = 20

/**
 * 三张展示表（`PLATFORM_META` / `LOGIN_METHODS` / `PLATFORM_NOTES`）的键是**前端平台名**
 * （`pinduoduo` / `xiaohongshu`），而账号行的 `platformId` 取自凭证库的 `platform` 字段，
 * **可能已被归一化成后端名**（`pdd` / `xhs`，契约见 `PLATFORM_ALIASES`）。
 *
 * 直接拿 `platformId` 查表会落空 → 该行渲染成灰色 `?` 徽标 + 裸文本 `pdd`，
 * 「重新登录」也拿不到平台的登录方式与风控提示（FIX-LOG #71）。
 * 这里做一次别名归一化反查，两种写法都能命中。
 *
 * 注意：只用于**查展示表**；`data-platform` / `startLogin` / `checkHealthReal` 仍必须用原始 id。
 */
function metaKey(platformId: string): string {
  if (PLATFORM_META[platformId]) return platformId
  for (const key of Object.keys(PLATFORM_META)) {
    if (normalizePlatform(key) === platformId) return key
  }
  return platformId
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * ★ 复用淘宝登录态、无独立登录入口的平台，其凭证行在账号页隐藏（FIX-LOG #70）。
 *
 * 目前只有闲鱼：它的 `xianyu_{unb}` 凭证行由 `ensureXianyuFromTaobao()` 在淘宝登录成功后
 * 自动派生并刷新 goofish 域 Cookie，用户不需要（也无法）单独登录闲鱼。
 * 该行仍存在于凭证库（闲鱼技能要用它自己的 goofish 域 Cookie），只是不在 UI 暴露。
 */
const HIDDEN_ROW_PLATFORMS = new Set(['xianyu'])

function hideSharedLoginRows(rows: AccountRow[]): AccountRow[] {
  return rows.filter(r => !HIDDEN_ROW_PLATFORMS.has(r.platformId))
}

export interface AccountPageDeps {
  account?: AccountService
  config: Config
}

export function accountPage(deps: AccountPageDeps) {
  const account = deps.account!

  /** 页面运行时状态：注入优先 + 回退 */
  let rows: AccountRow[] = []
  let page = 1

  function injected(): Partial<AccountRow>[] | null {
    const host = (globalThis as { __PLUGIN__?: { accounts?: Partial<AccountRow>[] } }).__PLUGIN__
    return host?.accounts ?? null
  }

  async function load() {
    const inj = injected()
    if (inj && inj.length) {
      rows = hideSharedLoginRows(inj as AccountRow[])
      return
    }
    if (!account) return // 无 account service 时显示空列表
    try {
      rows = hideSharedLoginRows(await account.list())
    } catch {
      rows = [] // 网络错误等异常时也显示空列表
    }
  }

  function renderTable(): string {
    if (!rows.length) {
      return `
        <div class="dsa-empty">
          <div class="dsa-empty-ico">🔗</div>
          <div class="dsa-empty-title">尚无已连接的账号</div>
          <div class="dsa-empty-sub">技能执行前须先在此完成授权。点击右上角「+ 添加连接」开始。</div>
          <button class="dsa-btn dsa-btn-primary" data-act="add">+ 添加连接</button>
        </div>`
    }

    const total = rows.length
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    page = Math.min(page, pages)
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    const body = slice.map(r => {
      const p = PLATFORM_META[metaKey(r.platformId)] ?? { label: r.platformId, color: '#8b93a7', glyph: '?', via: '' }
      const st = STATUS_META[r.status] ?? STATUS_META.pending
      const sync = r.syncServices?.length
        ? r.syncServices.map(s => `<span class="dsa-chip">${esc(s)}</span>`).join('')
        : '<span class="dsa-dim">—</span>'
      const warn = r.expireReason
        ? `<span class="dsa-i" title="${esc(r.expireReason)}">i</span>`
        : ''
      return `
        <tr data-id="${esc(r.accountId)}" data-shop-key="${esc(r.shopKey || '')}" data-platform="${esc(r.platformId)}">
          <td>
            <div class="dsa-plat">
              <span class="dsa-logo" style="background:${p.color}">${p.glyph}</span>
              <span class="dsa-plat-txt">
                <b>${esc(p.label)}</b>
                <em>${esc(p.via)}</em>
              </span>
            </div>
          </td>
          <td>
            ${r.authType === 'apikey'
              ? `<div class="dsa-field"><span class="dsa-key-label">AppID</span><span>${esc(r.appId || r.accountId)}</span>
                   <button class="dsa-copy" data-copy="${esc(r.appId || r.accountId)}" title="复制 AppID">⧉</button></div>
                 <div class="dsa-field dsa-dim"><span class="dsa-key-label">Secret</span><span>${esc(r.secretHint || '••••')}</span></div>`
              : `<div class="dsa-field"><span>${esc(r.nickname)}</span>
                   <button class="dsa-copy" data-copy="${esc(r.nickname)}" title="复制昵称">⧉</button></div>
                 <div class="dsa-field dsa-dim"><span>${esc(r.platformUid)}</span>
                   <button class="dsa-copy" data-copy="${esc(r.platformUid)}" title="复制 UID">⧉</button></div>`
            }
          </td>
          <td><span class="dsa-badge dsa-${st.cls}">${st.label}</span>${warn}</td>
          <td>${sync}</td>
          <td>${esc(r.boundAgentName || '—')}</td>
          <td class="dsa-ops">
            <a data-act="check">检查</a>
            <a data-act="bind">绑定会话</a>
            ${(r.boundAgentIds?.length ?? 0) > 0 ? '<a data-act="unbind">解绑</a>' : ''}
            <a data-act="relogin">重新登录</a>
            <a class="dsa-danger" data-act="del">删除</a>
          </td>
        </tr>`
    }).join('')

    const pager = `
      <div class="dsa-pager">
        <span>共 ${total} 条 · 每页 ${PAGE_SIZE} 条</span>
        <div class="dsa-pager-btns">
          <button class="dsa-pg" data-pg="prev" ${page <= 1 ? 'disabled' : ''}>‹</button>
          ${Array.from({ length: pages }, (_, i) => i + 1)
            .map(n => `<button class="dsa-pg ${n === page ? 'on' : ''}" data-pg="${n}">${n}</button>`)
            .join('')}
          <button class="dsa-pg" data-pg="next" ${page >= pages ? 'disabled' : ''}>›</button>
        </div>
      </div>`

    return `
      <table class="dsa-table">
        <thead><tr>
          <th>平台</th><th>登录信息</th><th>状态</th><th>同步服务</th><th>智能体</th><th>操作</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${pager}`
  }

  function renderModal(): string {
    const plats = Object.entries(PLATFORM_META)
      .map(([id, p]) => `
        <button class="dsa-pick" data-platform-pick="${id}">
          <span class="dsa-logo" style="background:${p.color}">${p.glyph}</span>
          <span>${esc(p.label)}</span>
        </button>`).join('')
    return `
      <div class="dsa-mask" hidden>
        <div class="dsa-modal">
          <div class="dsa-modal-hd">
            <b>添加连接</b>
            <button class="dsa-x" data-act="close">✕</button>
          </div>
          <div class="dsa-steps">
            <span class="dsa-step on" data-step-dot="1">1 选平台</span>
            <span class="dsa-step" data-step-dot="2">2 选登录方式</span>
            <span class="dsa-step" data-step-dot="3">3 执行登录</span>
          </div>
          <div class="dsa-modal-bd">
            <div class="dsa-step-pane on" data-step="1">
              <p class="dsa-dim">选择要连接的平台，登录态将保存在本地凭证库中，不出插件。</p>
              <label class="dsa-fresh">
                <input type="checkbox" data-fresh-box>
                <span>添加为其他账号（使用全新浏览器环境，不复用已绑定账号的登录态）</span>
              </label>
              <div class="dsa-picks">${plats}</div>
            </div>
            <div class="dsa-step-pane" data-step="2">
              <p class="dsa-dim" data-note></p>
              <div class="dsa-methods"></div>
            </div>
            <div class="dsa-step-pane" data-step="3">
              <ul class="dsa-log">
                <li data-log="0">启动内嵌浏览器…</li>
                <li data-log="1">导航到登录页…</li>
                <li data-log="2">等待扫码登录（超时 120s）…</li>
                <li data-log="3">登录成功，凭证已保存到本地</li>
              </ul>
            </div>
          </div>
          <div class="dsa-modal-ft">
            <button class="dsa-btn" data-act="close">取消</button>
            <button class="dsa-btn dsa-btn-primary" data-act="next" disabled>下一步</button>
          </div>
        </div>
      </div>`
  }

  /** 会话（智能体）选择弹窗 —— 绑定/解绑共用，数据源为 host 的 list_agents */
  function renderAgentModal(): string {
    return `
      <div class="dsa-mask" data-agent-mask hidden>
        <div class="dsa-modal dsa-agent-modal">
          <div class="dsa-modal-hd">
            <b data-agent-title>绑定会话</b>
            <button class="dsa-x" data-act="agent-close">✕</button>
          </div>
          <div class="dsa-modal-bd">
            <p class="dsa-dim" data-agent-note></p>
            <div class="dsa-agents" data-agent-list></div>
          </div>
          <div class="dsa-modal-ft">
            <button class="dsa-btn" data-act="agent-close">关闭</button>
          </div>
        </div>
      </div>`
  }

  return {
    /** 返回页面 HTML（宿主负责插入容器） */
    async html(): Promise<string> {
      await load()
      return `
        <div class="dsa-page dsa-account">
          <header class="dsa-hd">
            <div>
              <h2>账号连接</h2>
              <p class="dsa-dim">技能执行前须先在此完成授权。登录态保存在本地凭证库中，凭证不出插件。</p>
            </div>
            <div class="dsa-hd-ops">
              <button class="dsa-btn" data-act="add-new" title="同一平台登录第二个及以后的账号，将使用全新浏览器环境，不复用已绑定账号的登录态">+ 添加其他账号</button>
              <button class="dsa-btn dsa-btn-primary" data-act="add">+ 添加连接</button>
            </div>
          </header>
          <div class="dsa-body" data-body>${renderTable()}</div>
          ${renderModal()}
          ${renderAgentModal()}
          <div class="dsa-toast" hidden></div>
        </div>
        <style>${ACCOUNT_CSS}</style>`
    },

    /** 绑定页面交互（宿主在插入 DOM 后调用） */
    mount(root: HTMLElement) {
      const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T
      const mask = q('.dsa-mask')
      const agentMask = q('[data-agent-mask]')
      const toast = q('.dsa-toast')
      let step = 1
      let pickedPlatform = ''
      let pickedMethod = ''
      /** 添加其他账号：使用全新空浏览器环境，避免复用已登录 Profile 秒判成功（FIX-LOG #51） */
      let freshMode = false
      /** 重新登录：被刷新账号的凭证库主键，登录成功后替换旧条目并继承绑定关系 */
      let replaceKey = ''
      let timers: number[] = []
      /** 会话选择弹窗的当前目标账号（shopKey）与模式 */
      let agentTarget = ''
      let agentMode: 'bind' | 'unbind' = 'bind'

      function say(msg: string) {
        toast.textContent = msg
        toast.hidden = false
        window.setTimeout(() => { toast.hidden = true }, 1800)
      }

      async function repaint() {
        await load()
        q('[data-body]').innerHTML = renderTable()
      }

      function goStep(n: number) {
        step = n
        root.querySelectorAll('.dsa-step').forEach(el =>
          el.classList.toggle('on', Number((el as HTMLElement).dataset.stepDot) <= n))
        root.querySelectorAll('.dsa-step-pane').forEach(el =>
          el.classList.toggle('on', Number((el as HTMLElement).dataset.step) === n))
        const next = q<HTMLButtonElement>('[data-act="next"]')
        next.disabled = (n === 1 && !pickedPlatform) || (n === 2 && !pickedMethod)
        next.textContent = n >= 3 ? '完成' : '下一步'
      }

      function syncFresh() {
        const box = q<HTMLInputElement>('[data-fresh-box]')
        if (box) box.checked = freshMode
      }

      function openModal(fresh = false) {
        pickedPlatform = ''
        pickedMethod = ''
        freshMode = fresh
        replaceKey = ''
        mask.hidden = false
        syncFresh()
        goStep(1)
      }

      function closeModal() {
        mask.hidden = true
        timers.forEach(t => window.clearTimeout(t))
        timers = []
        root.querySelectorAll('[data-log]').forEach(el => el.classList.remove('on'))
      }

      /**
       * 打开会话选择弹窗。
       * 绑定维度是「会话（= 智能体）」，用户不该手打 id，必须从列表里挑。
       * Agent 只有 id（无人类可读名），故选项只能显示 id。
       */
      async function openAgentModal(shopKey: string, mode: 'bind' | 'unbind') {
        if (!account) { say('账号服务未就绪'); return }
        agentTarget = shopKey
        agentMode = mode
        const row = rows.find(r => r.shopKey === shopKey)
        const bound = row?.boundAgentIds ?? []
        q('[data-agent-title]').textContent = mode === 'bind' ? '绑定会话' : '解绑会话'
        q('[data-agent-note]').textContent = mode === 'bind'
          ? `选择要把账号「${row?.nickname ?? shopKey}」绑定到哪个会话。绑定后，该会话执行技能时优先使用此账号。`
          : `选择要从账号「${row?.nickname ?? shopKey}」解绑的会话。`
        agentMask.hidden = false
        q('[data-agent-list]').innerHTML = '<p class="dsa-dim">加载会话列表…</p>'

        const agents = await account.listAgents()
        // 'default' 是「平台默认」虚拟会话：未绑定具体会话时的兜底账号
        const options = [{ id: 'default', isDefault: true }, ...agents.filter(a => a.id !== 'default').map(a => ({ id: a.id, isDefault: false }))]
        const visible = mode === 'unbind' ? options.filter(o => bound.includes(o.id)) : options
        if (!visible.length) {
          q('[data-agent-list]').innerHTML = `<p class="dsa-dim">${mode === 'unbind' ? '该账号尚未绑定任何会话。' : '未取到会话列表，请确认 DSH 宿主已就绪。'}</p>`
          return
        }
        q('[data-agent-list]').innerHTML = visible.map(o => {
          const isBound = bound.includes(o.id)
          return `
            <button class="dsa-agent" data-agent-id="${esc(o.id)}">
              <span class="dsa-agent-id">${esc(o.id)}</span>
              <span class="dsa-agent-tag">${o.isDefault ? '平台默认' : '会话'}${isBound ? ' · 已绑定' : ''}</span>
            </button>`
        }).join('')
      }

      function closeAgentModal() {
        agentMask.hidden = true
        agentTarget = ''
      }

      function pickPlatform(id: string, autoFresh = true) {
        // 用户改选了别的平台 → 不再是「重新登录」，清掉替换目标
        if (replaceKey && pickedPlatform && pickedPlatform !== id) replaceKey = ''
        pickedPlatform = id
        // 该平台已有账号时默认走「添加其他账号」：复用已登录 Profile 会秒判成功并立即关窗
        if (autoFresh && rows.some(r => r.platformId === id)) freshMode = true
        syncFresh()
        // 展示表按前端平台名索引；`id` 可能是凭证库里的后端名（pdd / xhs），经 metaKey 归一化反查
        const key = metaKey(id)
        const methods = LOGIN_METHODS[key] ?? [{ key: 'qrcode', label: '扫码登录', hint: '打开 App 扫码' }]
        const note = PLATFORM_NOTES[key] ?? ''
        q('[data-note]').textContent = freshMode ? `【添加其他账号 · 全新浏览器环境】${note}` : note
        q('.dsa-methods').innerHTML = methods.map(m => `
          <button class="dsa-method" data-method="${m.key}">
            <b>${esc(m.label)}</b><span>${esc(m.hint)}</span>
          </button>`).join('')
        goStep(2)
      }

      async function runLogin() {
        if (!account) { say('账号服务未就绪，请检查配置'); return }
        const acct = account
        goStep(3)
        const logs = root.querySelectorAll('[data-log]')
        timers.forEach(t => window.clearTimeout(t))
        timers = []

        // step 0: 准备启动
        logs.item(0).classList.add('on')

        if (!pickedPlatform || !pickedMethod) {
          say('请先选择平台和登录方式')
          return
        }

        const method = pickedMethod
        const platform = pickedPlatform

        // ── manual_cookie: 弹出 Cookie 输入框 ──
        if (method === 'manual_cookie') {
          const cookieStr = window.prompt('请粘贴 Cookie 字符串（从浏览器开发者网络面板复制）')
          if (!cookieStr?.trim()) { say('未输入 Cookie，已取消'); closeModal(); return }
          logs.item(1).classList.add('on')
          const res = await acct.submitLoginCookie(platform, cookieStr.trim())
          if (res.ok) {
            logs.item(2).classList.add('on')
            logs.item(3).classList.add('on')
            say('登录成功，账号已加入列表')
            await repaint()
            closeModal()
          } else {
            say(`导入失败：${res.error ?? '未知错误'}`)
          }
          return
        }

        // ── appid: 弹出 AppID + Secret 输入框，直接保存凭证 ──
        if (method === 'appid') {
          const appId = window.prompt('请输入 AppID')
          if (!appId?.trim()) { say('未输入 AppID，已取消'); closeModal(); return }
          const appSecret = window.prompt('请输入 AppSecret')
          if (!appSecret?.trim()) { say('未输入 AppSecret，已取消'); closeModal(); return }
          logs.item(1).classList.add('on')
          logs.item(2).classList.add('on')
          const res = await acct.submitLoginAppId(platform, appId.trim(), appSecret.trim())
          if (res.ok) {
            logs.item(3).classList.add('on')
            say('凭证已保存，账号已加入列表')
            await repaint()
            closeModal()
          } else {
            say(`保存失败：${res.error ?? '未知错误'}`)
          }
          return
        }

        // ── qrcode / sso / cdp: 拉起浏览器窗口 → 等待登录完成 ──
        logs.item(1).classList.add('on')
        logs.item(2).classList.add('on')

        const loginRes = await acct.startLogin(platform, method, {
          freshLogin: freshMode,
          shopKey: replaceKey || undefined,
        })
        if (!loginRes.ok) {
          say(`登录失败：${loginRes.error ?? '浏览器工具不可用'}`)
          return
        }

        // doBrowserLogin 已经完成扫码 + Cookie 提取 + 保存，直接成功
        logs.item(3).classList.add('on')
        say(replaceKey ? '登录成功，账号登录态已刷新' : (freshMode ? '新账号已加入列表' : '登录成功，账号已加入列表'))
        await repaint()
        closeModal()
      }

      const onClick = async (e: Event) => {
        const target = e.target as HTMLElement

        // 复制
        const copyEl = target.closest('[data-copy]') as HTMLElement | null
        if (copyEl) {
          const val = copyEl.dataset.copy ?? ''
          try {
            await navigator.clipboard.writeText(val)
          } catch { /* 无剪贴板权限时静默 */ }
          say('已复制')
          return
        }

        // 「添加为其他账号」勾选框
        const freshBox = target.closest('input[data-fresh-box]') as HTMLInputElement | null
        if (freshBox) {
          freshMode = freshBox.checked
          return
        }

        // 弹窗内交互
        const pick = target.closest('[data-platform-pick]') as HTMLElement | null
        if (pick) { pickPlatform(pick.dataset.platformPick as string); return }
        const method = target.closest('[data-method]') as HTMLElement | null
        if (method) {
          pickedMethod = method.dataset.method as string
          root.querySelectorAll('.dsa-method').forEach(el => el.classList.remove('on'))
          method.classList.add('on')
          // 不跳 step 3 —— 让用户点"下一步"触发 runLogin()
          goStep(2)
          return
        }

        // 会话选择弹窗内的选项
        const agentPick = target.closest('[data-agent-id]') as HTMLElement | null
        if (agentPick) {
          const agentId = agentPick.dataset.agentId || ''
          if (!account || !agentTarget || !agentId) return
          const res = agentMode === 'bind'
            ? await account.bindAgent(agentTarget, agentId)
            : await account.unbindAgent(agentTarget, agentId)
          say(res.ok ? (agentMode === 'bind' ? '已绑定会话' : '已解绑会话') : `操作失败：${res.error ?? '未知错误'}`)
          if (res.ok) { closeAgentModal(); await repaint() }
          return
        }

        // 分页
        const pg = target.closest('[data-pg]') as HTMLElement | null
        if (pg) {
          const v = pg.dataset.pg as string
          if (v === 'prev') page = Math.max(1, page - 1)
          else if (v === 'next') page += 1
          else page = Number(v)
          q('[data-body]').innerHTML = renderTable()
          return
        }

        const el = target.closest('[data-act]') as HTMLElement | null
        if (!el) return
        const act = el.dataset.act
        const tr = target.closest('tr') as HTMLElement | null
        const rowId = tr?.dataset.id
        // 凭证库主键：优先取后端回传的 shopKey，降级用 {平台}_{accountId} 拼接
        const shopKey = tr?.dataset.shopKey || (tr?.dataset.platform && rowId ? `${tr.dataset.platform}_${rowId}` : '')

        switch (act) {
          case 'add': openModal(false); break
          case 'add-new': openModal(true); break
          case 'close': closeModal(); break
          case 'next':
            if (step === 1 && pickedPlatform) pickPlatform(pickedPlatform)
            else if (step === 2 && pickedMethod) runLogin()
            else if (step === 3) { closeModal(); say('连接流程已完成'); }
            break
          case 'check': {
            if (!account) { say('账号服务未就绪'); break }
            say('登录态检查中…')
            const plat = tr?.dataset.platform ?? undefined
            const results = await account.checkHealthReal(plat)
            const bad = results.filter(r => r.status !== 'valid')
            if (!bad.length) {
              say(`已检查 ${results.length} 个账号，登录态全部有效`)
            } else {
              say(`${bad.length} 个账号需要重新登录：${bad.map(r => r.nickname).join('、')}`)
            }
            await repaint()
            break
          }
          case 'bind': {
            await openAgentModal(shopKey, 'bind')
            break
          }
          case 'unbind': {
            await openAgentModal(shopKey, 'unbind')
            break
          }
          case 'agent-close': {
            closeAgentModal()
            break
          }
          case 'relogin': {
            const plat = tr?.dataset.platform ?? ''
            // ★ 不可独立登录的平台（生意参谋系 / 天猫）：凭证层复用淘宝登录态，账号页无入口。
            //   存量这类账号（修复前写入）仍可能出现在列表里，直接放行会重新拉生意参谋登录窗（FIX-LOG #67）。
            const owner = loginOwnerPlatform(plat)
            if (owner) {
              const ownerLabel = PLATFORM_META[owner]?.label ?? owner
              say(`「${plat}」复用${ownerLabel}登录态，无独立登录入口。请对${ownerLabel}账号执行「重新登录」。`)
              break
            }
            pickedPlatform = plat
            pickedMethod = ''
            freshMode = false
            // 记住被刷新的账号主键：登录成功后 host 侧替换旧条目，绑定关系继承
            replaceKey = shopKey
            mask.hidden = false
            pickPlatform(plat, false)
            break
          }
          case 'del': {
            if (!account) { say('账号服务未就绪'); break }
            const row = rows.find(r => r.accountId === rowId)
            const ok = window.confirm(
              `确认删除账号「${row?.nickname ?? rowId}」？\n\n将清除该账号的登录态与本地 Profile，已采集的数据会保留。`)
            if (ok) {
              const res = await account.deleteAccount(shopKey)
              // profileCleaned === false 才提示：账号服务版本较旧时该字段为 undefined，不应误报
              say(res.ok
                ? (res.profileCleaned === false
                  ? `已删除（登录态已清理，本地 Profile 未清理：${res.profileNote ?? '未知原因'}）`
                  : '已删除（登录态与 Profile 已清理，已采集数据保留）')
                : `删除失败：${res.error ?? '未知错误'}`)
              if (res.ok) await repaint()
            }
            break
          }
        }
      }
      root.addEventListener('click', onClick)

      // 点击遮罩关闭
      const onMaskClick = (e: Event) => { if (e.target === mask) closeModal() }
      mask.addEventListener('click', onMaskClick)

      const onAgentMaskClick = (e: Event) => { if (e.target === agentMask) closeAgentModal() }
      agentMask.addEventListener('click', onAgentMaskClick)

      return () => {
        timers.forEach(t => window.clearTimeout(t))
        root.removeEventListener('click', onClick)
        mask.removeEventListener('click', onMaskClick)
        agentMask.removeEventListener('click', onAgentMaskClick)
      }
    },
  }
}

const ACCOUNT_CSS = `
.dsa-page{font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2430}
.dsa-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
.dsa-hd-ops{display:flex;gap:8px;flex-shrink:0}
.dsa-fresh{display:flex;align-items:center;gap:8px;margin-top:12px;padding:8px 10px;border:1px solid #e4e8f0;background:#fafbfd;border-radius:8px;font-size:13px;color:#4b5468;cursor:pointer}
.dsa-fresh input{margin:0;cursor:pointer}
.dsa-hd h2{margin:0 0 4px;font-size:17px}
.dsa-dim{color:#8b93a7;margin:0}
.dsa-btn{border:1px solid #d8dde8;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
.dsa-btn:hover{border-color:#b9c2d4}
.dsa-btn-primary{background:#2b6cff;border-color:#2b6cff;color:#fff}
.dsa-btn-primary:hover{background:#1f5ae0}
.dsa-btn-primary:disabled{opacity:.45;cursor:not-allowed}
.dsa-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #eceff5;border-radius:8px;overflow:hidden}
.dsa-table th{text-align:left;font-weight:600;color:#67708a;background:#f7f9fc;padding:10px 14px;border-bottom:1px solid #eceff5}
.dsa-table td{padding:12px 14px;border-bottom:1px solid #f2f4f9;vertical-align:middle}
.dsa-table tr:last-child td{border-bottom:none}
.dsa-plat{display:flex;align-items:center;gap:10px}
.dsa-logo{width:28px;height:28px;border-radius:50%;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex:none}
.dsa-plat-txt{display:flex;flex-direction:column}
.dsa-plat-txt em{font-style:normal;font-size:11px;color:#8b93a7}
.dsa-field{display:flex;align-items:center;gap:6px}
.dsa-key-label{font-size:11px;color:#8b93a7;background:#eef1f7;border-radius:3px;padding:0 4px;flex:none}
.dsa-copy{border:none;background:none;color:#a3abbd;cursor:pointer;padding:0 2px}
.dsa-copy:hover{color:#2b6cff}
.dsa-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px}
.dsa-ok{background:#e8f7ee;color:#1a9f4d}
.dsa-warn{background:#fff6e5;color:#c47f00}
.dsa-bad{background:#fdecec;color:#d93b3b}
.dsa-idle{background:#eef1f7;color:#67708a}
.dsa-i{display:inline-flex;width:14px;height:14px;margin-left:6px;border-radius:50%;background:#d8dde8;color:#fff;font-size:10px;align-items:center;justify-content:center;cursor:help}
.dsa-chip{display:inline-block;background:#eef3ff;color:#2b6cff;border-radius:4px;padding:1px 6px;font-size:11px;margin-right:4px}
.dsa-ops a{color:#2b6cff;margin-right:10px;cursor:pointer;font-size:12px}
.dsa-ops a:hover{text-decoration:underline}
.dsa-danger{color:#d93b3b !important}
.dsa-pager{display:flex;justify-content:space-between;align-items:center;margin-top:12px;color:#8b93a7;font-size:12px}
.dsa-pager-btns{display:flex;gap:4px}
.dsa-pg{border:1px solid #e4e8f0;background:#fff;border-radius:5px;min-width:26px;height:26px;cursor:pointer}
.dsa-pg.on{background:#2b6cff;border-color:#2b6cff;color:#fff}
.dsa-empty{text-align:center;padding:60px 20px;border:1px dashed #dfe4ee;border-radius:8px;background:#fff}
.dsa-empty-ico{font-size:30px;margin-bottom:8px}
.dsa-empty-title{font-size:15px;font-weight:600;margin-bottom:6px}
.dsa-empty-sub{color:#8b93a7;margin-bottom:16px}
.dsa-mask{position:fixed;inset:0;background:rgba(16,20,32,.42);display:flex;align-items:center;justify-content:center;z-index:99}
.dsa-mask[hidden]{display:none}
.dsa-modal{width:520px;max-width:92vw;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 18px 48px rgba(16,20,32,.24)}
.dsa-modal-hd{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #eef1f7}
.dsa-x{border:none;background:none;font-size:14px;color:#8b93a7;cursor:pointer}
.dsa-steps{display:flex;gap:18px;padding:12px 18px;color:#a3abbd;font-size:12px;border-bottom:1px solid #f4f6fa}
.dsa-step.on{color:#2b6cff;font-weight:600}
.dsa-modal-bd{padding:18px;min-height:210px}
.dsa-step-pane{display:none}
.dsa-step-pane.on{display:block}
.dsa-picks{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.dsa-pick{display:flex;align-items:center;gap:8px;border:1px solid #e4e8f0;background:#fff;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:13px}
.dsa-pick:hover{border-color:#2b6cff;background:#f7faff}
.dsa-methods{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.dsa-method{display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid #e4e8f0;background:#fff;border-radius:8px;padding:10px 12px;cursor:pointer;text-align:left}
.dsa-method span{color:#8b93a7;font-size:12px}
.dsa-method.on{border-color:#2b6cff;background:#f7faff}
.dsa-log{list-style:none;padding:0;margin:0;font-size:13px}
.dsa-log li{position:relative;padding:6px 0 6px 22px;color:#a3abbd}
.dsa-log li::before{content:"○";position:absolute;left:0}
.dsa-log li.on{color:#1f2430}
.dsa-log li.on::before{content:"●";color:#2b6cff}
.dsa-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid #eef1f7;background:#fafbfd}
.dsa-agent-modal{width:440px}
.dsa-agents{display:flex;flex-direction:column;gap:8px;margin-top:12px;max-height:300px;overflow:auto}
.dsa-agent{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e4e8f0;background:#fff;border-radius:8px;padding:9px 12px;cursor:pointer;text-align:left;font:inherit;color:inherit}
.dsa-agent:hover{border-color:#2b6cff;background:#f7faff}
.dsa-agent-id{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#1f2430;word-break:break-all}
.dsa-agent-tag{flex:none;font-size:11px;color:#67708a;background:#eef1f7;border-radius:10px;padding:1px 8px}
.dsa-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(24,28,40,.9);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:120}
.dsa-toast[hidden]{display:none}
`
