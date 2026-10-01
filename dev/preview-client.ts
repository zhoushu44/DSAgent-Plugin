/**
 * 浏览器侧入口：由 preview-server 用 esbuild 打包成 IIFE 后下发。
 * 负责渲染两页 HTML 并调用各自 mount() 绑定交互。
 *
 * 注意：**不能** import 服务层（account-service / skill-service），
 * 它们依赖 node:fs 等 Node API，无法打进浏览器包。
 * 预览模式下数据由服务端预取，通过 __PLUGIN__ 注入通道交给页面。
 *
 * 只用于开发预览，不进生产。
 */

import { accountPage } from '../src/ui/account-page.ts'
import { skillMarketPage } from '../src/ui/skill-market-page.ts'

/** 由 esbuild 的 define 注入：服务端预取数据的 base64 编码 */
interface Payload {
  skillRoot: string
  storePath: string
  skills: unknown[]
  accounts: unknown[]
}
declare const __DSAGENT_B64__: string

const payload: Payload = JSON.parse(atob(__DSAGENT_B64__))

const cfg = {
  skillRoot: payload.skillRoot,
  storePath: payload.storePath,
  guideOnUnbound: true,
}

// 预览模式：把服务端预取的数据交给页面的注入通道。
// 页面优先读 __PLUGIN__，因此不需要真实服务层。
;(globalThis as { __PLUGIN__?: Record<string, unknown> }).__PLUGIN__ = {
  accounts: payload.accounts,
  skills: payload.skills,
}

/**
 * 预览专用的技能服务替身：
 * 只支持读（list/get），写操作（setEnabled）通过 HTTP 回传到服务端执行，
 * 这样拨动开关依然会真实改写 SKILL.md。
 */
const previewSkillService = {
  async list(opts?: { platform?: string; onlyEnabled?: boolean }) {
    let rows = payload.skills as Array<Record<string, unknown>>
    if (opts?.platform) rows = rows.filter(r => r.platform === opts.platform)
    if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
    return rows
  },
  async get(id: string) {
    return (payload.skills as Array<Record<string, unknown>>).find(s => s.id === id) ?? null
  },
  async setEnabled(id: string, enabled: boolean) {
    const res = await fetch('/api/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },
  async refresh() {
    const res = await fetch('/api/skills')
    const rows = await res.json()
    payload.skills = rows
    return rows
  },
}

/**
 * 预览专用的账号服务替身。
 * 读走注入快照；写（绑定/删除）通过 HTTP 回传到服务端真实执行，
 * 成功后重新拉取账号列表并刷新注入通道，保证表格重绘拿到最新数据
 * （页面 load() 优先读 __PLUGIN__.accounts，只改 payload 不生效）。
 */
const previewAccountService = {
  async list(platform?: string) {
    const rows = (payload.accounts as Array<Record<string, unknown>>) ?? []
    return platform ? rows.filter(r => r.platformId === platform) : rows
  },
  async checkHealth(platform?: string) {
    const rows = await this.list(platform)
    return rows.map(r => ({
      platformId: r.platformId,
      nickname: r.nickname,
      status: r.status,
      reason: r.expireReason ?? undefined,
    }))
  },
  async isBound(platform: string) {
    const rows = await this.list(platform)
    return rows.some(r => r.status === 'valid' || r.status === 'pending')
  },
  /** 从服务端重新拉取账号列表，并同步刷新注入通道 */
  async refreshAccounts() {
    const res = await fetch('/api/accounts')
    const rows = await res.json()
    payload.accounts = rows
    const host = (globalThis as { __PLUGIN__?: Record<string, unknown> }).__PLUGIN__
    if (host) host.accounts = rows
    return rows
  },
  async bindAgent(shopKey: string, agentId: string) {
    if (!shopKey || !agentId) return { ok: false, error: '缺少 shopKey / agentId' }
    const res = await fetch('/api/bind_agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopKey, agentId }),
    })
    if (!res.ok) return { ok: false, error: await res.text() }
    const out = await res.json()
    if (out?.ok) await this.refreshAccounts()
    return out
  },
  async deleteAccount(shopKey: string) {
    if (!shopKey) return { ok: false, error: '无效的 shopKey' }
    const res = await fetch('/api/delete_account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopKey }),
    })
    if (!res.ok) return { ok: false, error: await res.text() }
    const out = await res.json()
    if (out?.ok) await this.refreshAccounts()
    return out
  },
}

async function boot() {
  const mounter = async (
    id: string,
    page: { html(): Promise<string>; mount(root: HTMLElement): unknown },
  ) => {
    const root = document.getElementById(id)
    if (!root) return
    const raw = await page.html()
    // <style> 提到 head，其余内容留在容器内
    const body = raw.replace(/<style>([\s\S]*?)<\/style>/g, (_m, css: string) => {
      const el = document.createElement('style')
      el.textContent = css
      document.head.appendChild(el)
      return ''
    })
    root.innerHTML = body
    // 宿主职责：注入 DOM 后调用 mount() 绑交互
    page.mount(root)
  }

  await mounter('m-account', accountPage({
    account: previewAccountService as never,
    config: cfg,
  }))
  await mounter('m-market', skillMarketPage({
    skill: previewSkillService as never,
    account: previewAccountService as never,
    config: cfg,
  }))
}

void boot()
