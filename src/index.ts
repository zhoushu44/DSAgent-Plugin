/**
 * DSAgent 插件 — Host 半区（运行在 DSH host Node 进程侧）
 *
 * 职责：
 *   1. 为模型注册工具（账号查询 + 技能查询 + 平台 + 技能执行 + 对话）
 *   2. 注册浏览器登录工具（Playwright 启动浏览器做扫码登录）
 *   3. 注册系统提示词
 *
 * 不依赖任何外部网关，凭证自己存在本地 CredentialStore。
 *
 * 双半区架构：
 *   - 本文件导出 "." → host 半区，注册工具与系统提示词
 *   - src/client.ts 导出 "./client" → browser 半区，注册 UI 页面
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool as dshDefineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createAccountService } from './services/account-service.js'
import { createSkillService, detectEntry, extractUsage, parseArgString, renderSkillDirHint, type SkillRow } from './services/skill-service.js'
import { createToolTriggerRegistry, type TriggerSourceSkill } from './services/tool-triggers.js'
import { getDomain, describeDomain, domainRoutingTable, DOMAIN_NAMES, RECEPTION_INTENTS } from './services/wiki-schema.js'
import { buildTemplate, templateToYaml, templateGuide } from './services/wiki-frontmatter.js'
import { createWikiStore } from './services/wiki-store.js'
import { createPitfallMemory, renderPitfallHint, exportPitfallDraft, isRecordableFailure, PITFALL } from './services/pitfall-memory.js'
import { loadContract, contractToolName, contractToolParameters, buildContractArgv, type SkillContract } from './services/arguments.js'
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CredentialStore, parseCookieStr, keyCookies, credentialPlatform, resolveDisplayNick, loginOwnerPlatform, planCascadeDisconnect } from './services/credential-store.js'
import { doBrowserLogin, closeBrowser, ensureXianyuFromTaobao, riskVerify, removeAccountProfile } from './browser-login.js'
import * as authOp from './services/auth-operation.js'
import { douyinPublish } from './douyin-publish.js'
import { zhihuPublish } from './zhihu-publish.js'
import { bilibiliPublish } from './bilibili-publish.js'
import { bilibiliDownload } from './bilibili-download.js'
import { xiaohongshuPublish } from './xiaohongshu-publish.js'
import { pddCrawl } from './pdd-crawl.js'
import { xianyuPublish } from './xianyu-publish.js'
import { xianyuAnalytics } from './xianyu-analytics.js'
import { taobaoPublish } from './taobao-publish.js'
import { pddPublish } from './pdd-publish.js'
import { startGatewayProxy, handleProxy, ensureAlimamaTokens, getLastVerifyUrlByPlatform, probeRemoteSession, gatewayCacheStats, clearGatewayCache } from './gateway-proxy.js'
import { smartTruncateJsonAware } from './services/smart-truncate.js'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'

/** 掩码 AppSecret：前 4 位明文 + •••• */
function maskSecret(s: string): string {
  if (!s) return ''
  return s.length <= 4 ? '••••' : s.slice(0, 4) + '••••'
}

/* ─────────────── 自检更新：读本地版本，查 GitHub latest Release 比对 ─────────────── */
/**
 * 插件根目录（lib/ 的父目录）。
 * host 半区编译产物是 lib/index.js，import.meta.url 指向它，上跳一层即插件根。
 * 绿色包里 build-info.json 在包根（= 插件根的父目录），下面读本地版本时两处都兜底。
 */
const PLUGIN_ROOT = (() => {
  try {
    const here = fileURLToPath(import.meta.url)
    // 兼容：编译产物可能在 lib/index.js（生产）或 src/index.ts（dev 直载，rare），
    // 上跳一层都能拿到插件根。
    return nodePath.resolve(nodePath.dirname(here), '..')
  } catch {
    // 兜底：cwd。极少走到，import.meta.url 在 ESM 下几乎总有值。
    return process.cwd()
  }
})()

/** 仓库地址（Release tag = latest 的滚动版本）。与 release.yml 的滚动 tag 一致。 */
const UPDATE_REPO = 'zhoushu44/DSAgent-Plugin'

/**
 * 读本地版本信息。
 * - package.json 的 version：所有安装方式都有（市场装的就是它）。
 * - build-info.json 的 gitCommit：仅绿色包有；市场/dev 安装没有，回退为空。
 *   绿色包的 build-info.json 在包根（插件根的父目录），两处都找。
 */
function readLocalVersion(): { version: string; commit: string; builtAt: string } {
  let version = '0.0.0'
  let commit = ''
  let builtAt = ''
  try {
    const pj = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    version = String(pj.version || '0.0.0')
  } catch { /* 极少走到：package.json 必然存在 */ }

  // build-info.json 候选位置：插件根本身 + 父目录（绿色包包根）
  for (const cand of [
    join(PLUGIN_ROOT, 'build-info.json'),
    join(PLUGIN_ROOT, '..', 'build-info.json'),
  ]) {
    if (existsSync(cand)) {
      try {
        const info = JSON.parse(readFileSync(cand, 'utf8'))
        if (!commit && info.gitCommit) commit = String(info.gitCommit).slice(0, 7)
        if (!builtAt && (info.commitTime || info.builtAt)) builtAt = String(info.commitTime || info.builtAt)
        break
      } catch { /* 格式异常忽略 */ }
    }
  }
  return { version, commit, builtAt }
}

/**
 * 查 GitHub latest Release，解析出远端 commit 与 package version。
 *
 * ★ 为什么不直接调 api.github.com：
 *   匿名调 api.github.com 每小时仅 60 次，用户多点几下就 403（实测 IP 103.62.49.178 已被限流）。
 *   改抓 Release 页 HTML（github.com/.../releases/tag/latest）—— 不走 API、无限流。
 *
 * ★ 怎么从页面拿版本：
 *   1) 远端 commit：页面里有指向本次提交的链接，href 含 /commit/<40位sha>，取第一个 7 位短 sha。
 *   2) package version：CI 把它写进了 Release body（"... 版本 yyyyMMdd-<sha>（package.json x.y.z）"），
 *      用正则取 "package.json" 后的版本号。
 */
async function fetchRemoteVersion(): Promise<{ version: string; commit: string; ok: boolean; error?: string }> {
  try {
    const r = await fetch(`https://github.com/${UPDATE_REPO}/releases/tag/latest`, {
      headers: { 'User-Agent': 'dsagent-update-checker' },
      redirect: 'follow',
    })
    if (!r.ok) return { version: '', commit: '', ok: false, error: `GitHub 返回 HTTP ${r.status}` }
    const html = await r.text()

    // 远端 commit：页面里第一处 /commit/<40sha>
    let commit = ''
    const cm = html.match(/\/commit\/([0-9a-f]{40})/)
    if (cm) commit = cm[1].slice(0, 7)

    // package version：Release body 里 "package.json x.y.z" 或 "（package.json x.y.z）"
    let version = ''
    const vm = html.match(/package\.json[^\d]{0,4}(\d+\.\d+\.\d+)/)
    if (vm) version = vm[1]

    // 兜底：若 body 里没写出 package version，用 CI 版本号（yyyyMMdd-sha）里的日期段也无意义，
    // 此时 version 留空，UI 仍可用 commit 比对。
    return { version, commit, ok: true }
  } catch (e: any) {
    return { version: '', commit: '', ok: false, error: e?.message || String(e) }
  }
}

/** 是否有更新：本地 commit 与远端不同（且本地有 commit），或本地 version 与远端不同。 */
function hasUpdate(local: { version: string; commit: string }, remote: { version: string; commit: string }): boolean {
  if (local.commit && remote.commit) return local.commit !== remote.commit
  if (local.version && remote.version) return local.version !== remote.version
  return false
}

/**
 * 清洗字符串，移除 lossless JSON 不支持的字符：
 * - 控制字符 U+0000-U_001F（标准 JSON 规范不允许未转义的控制字符）
 * - 孤立的代理对（lone surrogates U+D800-U+DFFF，lossless JSON 拒绝）
 * - BOM、零宽字符等不可见字符
 * - 截断过长的文本（避免序列化超大 payload）
 */
/** 单次工具回传给模型的文本上限（字符）。过小会腰斩数据型技能的 payload */
const TOOL_TEXT_LIMIT = 32_000

function sanitizeForLosslessJson(s: string): string {
  // 移除控制字符（保留 \t \n \r）
  let cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  // 移除孤立的代理对字符（lossless JSON 不支持）
  cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '')
  // 移除 BOM 和零宽字符
  cleaned = cleaned.replace(/\uFEFF/g, '').replace(/[\u200B-\u200D\u2060]/g, '')
  // 截断过长文本：智能头尾保留（尾部常有 summary/total/结论），见 smart-truncate.ts
  if (cleaned.length > TOOL_TEXT_LIMIT) cleaned = smartTruncateJsonAware(cleaned, TOOL_TEXT_LIMIT)
  return cleaned
}

/**
 * 工具返回值序列化：
 * execute 返回的对象有 text 字段（人类可读摘要），优先取 text；
 * 其他对象用 JSON.stringify 保证不丢信息；原始类型直接 String()。
 * 所有输出都经过 sanitizeForLosslessJson 清洗，确保 Cordis 的 lossless JSON 序列化不会失败。
 */
function renderToolOutput(_a: unknown, v: unknown) {
  if (v == null) return [{ type: 'text' as const, text: '' }]
  if (typeof v === 'string') return [{ type: 'text' as const, text: sanitizeForLosslessJson(v) }]
  if (typeof v === 'object' && v !== null && 'text' in v && typeof (v as any).text === 'string' && (v as any).text) {
    return [{ type: 'text' as const, text: sanitizeForLosslessJson(withFailureKind(v, (v as any).text)) }]
  }
  let jsonStr: string
  try { jsonStr = JSON.stringify(v) } catch { jsonStr = String(v) }
  return [{ type: 'text' as const, text: sanitizeForLosslessJson(jsonStr) }]
}

/**
 * 把失败类型显式写进回传给模型的文本。
 *
 * 工具返回值里的 `failureKind` 是结构化字段，但模型只能看到 render 后的文本，
 * 若不拼接就会被丢弃——模型于是只能靠猜（实测出现过「结果中没有出现名为
 * failureKind 的字段」的误判）。这里统一把失败类型追加到文案末尾。
 */
function withFailureKind(v: unknown, text: string): string {
  if (typeof v !== 'object' || v === null) return text
  const kind = (v as { failureKind?: unknown }).failureKind
  if (typeof kind !== 'string' || !kind) return text
  if (text.includes(kind)) return text
  return `${text}\n\n[failureKind] ${kind}`
}

/**
 * 深度清洗工具返回值，确保满足 Cordis 的 lossless JSON 约束。
 *
 * DSH 用 `walkJsonValue` 校验 `execute` 的**原始返回值**（不是 render 后的文本），
 * 遇到 undefined / NaN / Infinity / -0 / BigInt / 函数 / 非纯对象（Date、Map、
 * Buffer、类实例）会直接判定 `tool "xxx" returned invalid output: value is not
 * lossless JSON`，整个工具调用失败。
 *
 * 所有工具统一在这里兜底，避免某个分支多写一个 `: undefined` 就整条链路挂掉。
 */
function toLosslessJson(v: unknown, depth = 0): unknown {
  if (v === undefined) return null
  if (v === null) return null
  const t = typeof v
  if (t === 'string') return sanitizeForLosslessJson(v as string)
  if (t === 'boolean') return v
  if (t === 'number') {
    const n = v as number
    if (!Number.isFinite(n)) return String(n)
    return Object.is(n, -0) ? 0 : n
  }
  if (t === 'bigint') return String(v)
  if (t !== 'object') return String(v)
  if (depth > 12) return '[深度超限]'
  if (Array.isArray(v)) return Array.from(v, item => toLosslessJson(item, depth + 1))
  if (v instanceof Date) return v.toISOString()
  const proto = Object.getPrototypeOf(v)
  if (proto !== null && proto !== Object.prototype) {
    // Map / Set / Buffer / 类实例等：降级为 JSON 字符串，保证可序列化
    try {
      const s = JSON.stringify(v)
      return s === undefined ? String(v) : sanitizeForLosslessJson(s)
    } catch {
      return String(v)
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === undefined) continue
    out[k] = toLosslessJson(val, depth + 1)
  }
  return out
}

/**
 * 技能 payload 过大时落盘，只把预览 + 文件路径回传给模型。
 *
 * 旧实现固定 `slice(0, 8000)`，数据型技能（keyword-traffic 的 391 天趋势、
 * market-analysis 的上百条样本）会被腰斩，模型只能分析前段数据还误以为是完整结果。
 * 现在：小 payload 直传；超限写进工作区 `artifacts/`，模型可自行读文件拿全量数据。
 */
function spillPayload(skillId: string, payloadStr: string): string {
  if (payloadStr.length <= TOOL_TEXT_LIMIT) return payloadStr
  // 预览改用智能截断：尾部保留——total/summary/分页字段常在 JSON 末尾，
  // 纯头部预览会让模型误以为数据「到此为止」而漏看统计字段（false PASS）。
  const preview = smartTruncateJsonAware(payloadStr, TOOL_TEXT_LIMIT)
  try {
    const ws = process.env.DSAGENT_WORKSPACE ?? process.cwd()
    const dir = join(ws, 'artifacts')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${skillId}_payload_${Date.now()}.json`)
    writeFileSync(file, payloadStr, 'utf8')
    return `${preview}\n\n⚠️ 结果过大（${payloadStr.length} 字符），完整数据已落盘：${file}\n需要全量数据请直接读取该文件。`
  } catch {
    return preview
  }
}

/**
 * 包装 DSH 的 defineTool：所有工具的 execute 返回值统一过 lossless JSON 清洗。
 * 这是全插件唯一的工具返回出口，新增工具无需关心序列化约束。
 */
function defineTool(def: ToolDefinition): ToolDefinition {
  const inner = def.execute
  return dshDefineTool({
    ...def,
    async execute(...callArgs: any[]) {
      return toLosslessJson(await inner(...(callArgs as [any, any])))
    },
  })
}

/**
 * 从工具运行上下文取当前会话（= 智能体）ID。
 *
 * DSH 里「会话」与「智能体」是同一个 id（`ToolRunContext.agent.id`），
 * 账号绑定维度就是它：账号的 `bound_agent_ids` 命中该 id 即为「本会话绑定」。
 *
 * 无 agent 归属的调用（宿主内部调用）返回 'default'，与凭证库的默认绑定语义一致。
 */
function agentIdOf(exec: any): string {
  const id = exec?.agent?.id
  return typeof id === 'string' && id ? id : 'default'
}

export const name = 'dsagent'

/** 依赖声明：等这些服务就绪后再调用 apply */
export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** 技能根目录 */
  skillRoot: string
  /** 凭证存储文件路径 */
  storePath: string
  /** 未绑定账号时是否返回引导文案而非硬报错 */
  guideOnUnbound: boolean
  /** 商家知识 Wiki 根目录；留空则用 <工作区>/wiki */
  wikiRoot?: string
}

export const config: Config = {
  skillRoot: '',
  storePath: '',
  guideOnUnbound: true,
  wikiRoot: '',
}

/**
 * 需要绑定账号的技能（用于前置校验）。
 */
const BINDING_RULES: Array<[string, string]> = [
  // sycm 平台（生意参谋系技能 —— 凭证层复用淘宝登录态，登录淘宝后即可用，账号页无独立登录入口）
  ['sycm-customer', 'sycm'],
  ['competitor-strategy-comparison', 'sycm'],
  ['competitor-indicator', 'sycm'],
  ['keyword-assistant', 'sycm'],
  ['keyword-traffic', 'sycm'],
  ['market-trend', 'sycm'],
  ['store-patrol-manager', 'sycm'],
  // sycm 平台（参谋长分析包转换的诊断类技能 —— 凭证层同样复用淘宝登录态）
  ['category-structure-diagnosis', 'sycm'],
  ['product-layering-diagnosis', 'sycm'],
  ['shop-promotion-diagnosis', 'sycm'],
  // taobao 平台（淘宝登录态）
  ['product-reviews', 'taobao'],
  ['product-wdj', 'taobao'],
  ['market-analysis', 'taobao'],
  // douyin 平台
  ['douyin-crawl', 'douyin'],
  ['douyin-publish', 'douyin'],
  ['douyin-comment', 'douyin'],
  ['douyin-im', 'douyin'],
  ['douyin-analytics', 'douyin'],
  // zhihu 平台
  ['zhihu-crawl', 'zhihu'],
  ['zhihu-publish', 'zhihu'],
  // xhs 平台（小红书）
  ['xiaohongshu-crawl', 'xhs'],
  ['xiaohongshu-publish', 'xhs'],
  ['xiaohongshu-analytics', 'xhs'],
  // xianyu 平台（闲鱼）
  ['xianyu-crawl', 'xianyu'],
  ['xianyu-publish', 'xianyu'],
  ['xianyu-order', 'xianyu'],
  ['xianyu-im', 'xianyu'],
  ['xianyu-analytics', 'xianyu'],
  // bilibili 平台（B站）
  ['bilibili-crawl', 'bilibili'],
  ['bilibili-download', 'bilibili'],
  ['bilibili-publish', 'bilibili'],
  // pdd 平台（拼多多）
  ['pdd-crawl', 'pdd'],
  // pdd_mms 平台（拼多多商家后台 —— 与买家 H5 是两套独立登录态）
  ['pdd-publish', 'pdd_mms'],
  // taobao 平台（淘宝 / 天猫，共用同一套登录态）
  ['taobao-publish', 'taobao'],
]

function requiredPlatform(skillId: string): string | null {
  for (const [id, platform] of BINDING_RULES) {
    if (skillId === id || skillId.startsWith(id)) return platform
  }
  return null
}

/**
 * 账号引导文案里的平台名。
 *
 * 生意参谋系（sycm/万相台/达摩盘/天猫洞察）在凭证层复用淘宝登录态，
 * 账号连接页**没有**「生意参谋」入口 —— 引导文案必须说「淘宝」。
 * 否则用户按提示去账号页却找不到该平台，形成死路（「登录淘宝后生意参谋即可用」的文案侧收口）。
 */
const GUIDED_PLATFORM: Record<string, string> = {
  sycm: '淘宝',
  alimama: '淘宝',
  dmp: '淘宝',
  sycm_insight: '淘宝',
  xianyu: '淘宝',
}

function guidedPlatform(platform: string): string {
  return GUIDED_PLATFORM[platform] ?? platform
}

/** 复用淘宝登录态的平台在引导文案里的补充说明（说明为什么让用户去连淘宝） */
function guidedPlatformExtra(platform: string): string {
  if (!GUIDED_PLATFORM[platform]) return ''
  if (platform === 'xianyu') {
    return '（闲鱼复用淘宝登录态，登录淘宝后会自动同步闲鱼登录态，无需单独登录闲鱼）'
  }
  return '（生意参谋 / 万相台 / 达摩盘共用淘宝登录态，无需单独登录生意参谋）'
}

/** 平台登录入口 URL */
const LOGIN_URLS: Record<string, string> = {
  taobao: 'https://login.taobao.com/member/login.jhtml',
  tmall: 'https://login.taobao.com/member/login.jhtml',
  sycm: 'https://sycm.taobao.com/',
  alimama: 'https://one.alimama.com/',
  dmp: 'https://dmp.taobao.com/',
  sycm_insight: 'https://sycm.taobao.com/',
  jd: 'https://passport.jd.com/new/login.aspx',
  pdd: 'https://mobile.yangkeduo.com/login.html',
  // ★ 拼多多商家后台登录页（与买家 H5 不同）：登录后下发 PASS_ID
  pdd_mms: 'https://mms.pinduoduo.com/login',
  douyin: 'https://www.douyin.com/',
  xhs: 'https://www.xiaohongshu.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://passport.bilibili.com/login',
  kuaishou: 'https://passport.kuaishou.com/pc/account/login',
  wechat_mp: 'https://mp.weixin.qq.com/',
  // ★ 闲鱼登录页必须是 /login（独立扫码页，有二维码 iframe）。
  // 首页只会注入 mini_login iframe 且 SSO 无法建立会话（实测 havana_* 恒缺失 → 全部用户态接口 SESSION_EXPIRED）
  xianyu: 'https://www.goofish.com/login',
  pinduoduo: 'https://mobile.yangkeduo.com/login.html',
  wechat_store: 'https://channels.weixin.qq.com/shop',
  zhihu: 'https://www.zhihu.com/signin',
}

export function apply(ctx: Context, cfg: Config = config) {
  // 确定凭证存储路径
  const storePath = cfg.storePath || nodePath.join(
    nodeOs.homedir(),
    '.dsh',
    'dsagent-accounts.json',
  )
  const account = createAccountService(storePath)
  // 技能使用统计落在凭证库同级的 .skill-stats.json —— 不放技能目录内，
  // 避免被 Harness 的技能扫描当成技能资源（见 skill-stats.ts 的设计说明）。
  const statsPath = nodePath.join(nodePath.dirname(storePath), '.skill-stats.json')
  const skill = createSkillService(cfg.skillRoot, { statsPath })
  const store = new CredentialStore(storePath)

  /* ─────────────── 商家知识 Wiki（八域本体，移植自 Accio） ─────────────── */
  // 落盘位置：工作区下的 wiki/ 目录。选这里而非插件数据目录，是因为
  // 知识是**用户资产**，应当与工作区一起被看到、备份、搬迁；
  // 而凭证库是机器本地状态，两者生命周期不同。
  const wikiRoot = cfg.wikiRoot
    || nodePath.join(process.env.DSAGENT_WORKSPACE ?? process.cwd(), 'wiki')
  const wiki = createWikiStore(wikiRoot)

  /* ─────────────── 平台坑位记忆（P3，从真实失败中累积） ─────────────── */
  // 与技能统计同放插件数据目录：这是**机器本地状态**，不是用户知识资产。
  // 用户资产（wiki）放工作区，机器状态（凭证/统计/坑位）放数据目录 —— 两者生命周期不同。
  const pitfalls = createPitfallMemory(nodePath.join(nodePath.dirname(storePath), '.pitfall-memory.json'))

  /**
   * 工具触发注册表（吸收 Accio 的 ToolTriggerRegistry）。
   *
   * 在工具被调用的瞬间，把「本次操作与哪些技能相关」注入到工具返回里，
   * 逼模型先读 SKILL.md 再动手 —— 解决「包了一层工具的技能，其坑位信息
   * 在调用前不可见」的问题（见 tool-triggers.ts 的设计说明）。
   */
  const triggers = createToolTriggerRegistry()
  /** 注册表最近一次重建时间，用于避免每轮对话都重建 */
  let triggersBuiltAt = 0
  const TRIGGER_REBUILD_TTL = 60_000

  /** 扫描技能目录，为触发注册表提供 tool_triggers 来源 */
  async function rebuildTriggers(): Promise<void> {
    try {
      const rows = await skill.list()
      const sources: TriggerSourceSkill[] = rows
        .filter(r => r.dir && r.frontmatter)
        .map(r => ({
          id: r.id,
          description: r.description,
          skillPath: nodePath.join(r.dir, 'SKILL.md'),
          frontmatter: r.frontmatter,
        }))
      triggers.rebuild(sources)
      triggersBuiltAt = Date.now()
    } catch (e) {
      console.warn('[dsagent] 触发注册表重建失败（不影响技能执行）:', e instanceof Error ? e.message : String(e))
    }
  }

  /* ─────────────── 0. 扫描技能清单，注入系统提示词 ─────────────── */
  // 有 contract.json 的技能已作为「独立工具」注册（一技能一工具、参数表由契约生成），
  // 模型直接就能看到，无需再在提示词里重复列出。
  // 这里只扫「无契约」的技能，它们仍靠 dsagent_execute_skill 统一执行，
  // 必须在系统提示词里列出清单+描述，否则模型不知道有哪些技能可调。
  // 不变量：契约 ⇔ 该技能有输入（见 dev/gen-contracts.py），无输入的技能不产契约，
  // 因此不会出现「既不注册工具、又不在清单里」的隐身技能。
  function scanSkillCatalog(): Array<{ id: string; name: string; description: string; platform: string; usage: string | null }> {
    const root = cfg.skillRoot
    if (!root || !existsSync(root)) return []
    const results: Array<{ id: string; name: string; description: string; platform: string; usage: string | null }> = []
    try {
      for (const entry of readdirSync(root)) {
        const skillFile = join(root, entry, 'SKILL.md')
        if (!existsSync(skillFile)) continue
        // 已按契约暴露为独立工具的技能，不再进提示词清单
        if (loadContract(join(root, entry))) continue
        try {
          const raw = readFileSync(skillFile, 'utf8').replace(/\r\n/g, '\n')
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
          if (!fmMatch) continue
          const fm = fmMatch[1]
          const pick = (key: string): string | null => {
            const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm')
            const hit = fm.match(re)
            if (!hit) return null
            return hit[1].replace(/^["']|["']$/g, '').trim()
          }
          // 停用的技能不进清单
          const disabled = pick('disable-model-invocation')
          if (disabled && ['true', 'yes', 'on', '1'].includes(disabled.toLowerCase())) continue

          const id = pick('name') || entry
          const name = pick('display_name') || id
          // description 支持多种 YAML 格式：
          // 1) 单行：description: "文本"  或  description: 文本
          // 2) 多行 |：description: |\n  文本\n  文本
          // 3) 多行 >：description: >\n  文本\n  文本
          // 4) 带 chomping 标识：|- |- >- >+ 等
          let description = ''
          {
            const pickRaw = pick('description')
            // 多行标识符：| |+ |- > >+ >- 等
            const isMultiline = pickRaw && /^[|>][+-]?$/.test(pickRaw)
            if (pickRaw && !isMultiline) {
              // 单行 description
              description = pickRaw
            } else {
              // 多行 description（| 或 > 语法，含 chomping 标识 |- >- 等）
              // 从 description: 那行之后开始，到下一个顶层键或 license/metadata/--- 为止
              const descMatch = fm.match(/description\s*:\s*[|>][+-]?\s*\n([\s\S]*?)(?=\n[a-zA-Z_]+\s*:|\n---|\nlicense|\nmetadata)/)
              if (descMatch) {
                description = descMatch[1].replace(/^\s+/gm, '').trim()
              } else {
                // fallback：description 是最后一个字段，取到 frontmatter 末尾
                const fallback = fm.match(/description\s*:\s*[|>][+-]?\s*\n([\s\S]*)$/)
                if (fallback) description = fallback[1].replace(/^\s+/gm, '').trim()
              }
            }
          }

          const platform = requiredPlatform(id) || '无'
          // 从正文提取用法示例，供模型据此填 args。
          // 先判定入口形态：只有包入口/脚本入口技能才有可执行用法，
          // 纯指令型技能返回 null（避免把辅助脚本当成本技能用法）。
          const body = raw.slice(fmMatch[0].length)
          const entryForm = detectEntry(join(root, entry), id, body)
          const usage = extractUsage(body, entryForm)
          results.push({ id, name, description: description.slice(0, 200), platform, usage })
        } catch { /* 跳过 */ }
      }
    } catch { /* root 不存在 */ }
    return results.sort((a, b) => a.id.localeCompare(b.id))
  }

  /* ─────────────── 0a. 本地代理网关（替代 qiworkconnect） ─────────────── */
  // 起一个本地 HTTP 服务器，实现 /api/v1/proxy + /api/v1/health + /api/v1/accounts
  // 技能 runtime_http.py 打到这个地址，我们从 CredentialStore 取 Cookie 注入后转发
  // 用 Promise 存储，工具 execute 时 await 拿到 url，避免竞态
  const gatewayReady = startGatewayProxy(store)
  ctx.effect(() => {
    // cleanup: 插件卸载时关闭网关
    return () => { gatewayReady.then(gw => gw.close()).catch(() => {}) }
  })

  /* ─────────────── 0. Host 工具已通过 defineTool 注册 ─────────────── */
  /* ─────────────── 0b. HTTP 路由：host 半区直接执行 Playwright 登录 ─── */
  // webServer 是 browser 半区的 carrier service，但 host 半区可通过 ctx.inject 动态等待
  ;(ctx as any).inject(['webServer'], (webCtx: any) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'exact',
        path: '/dsagent/api',
        async handler(req: any, res: any) {
          let body: any = {}
          try {
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks).toString('utf8')
            if (raw) body = JSON.parse(raw)
          } catch { /* 忽略 */ }

          const { action, ...rest } = body

          try {
            if (action === 'browser_login') {
              const reqPlatform = String(rest.platform ?? '')
              // ★ 不可独立登录的平台（生意参谋系 / 天猫）：凭证层复用淘宝登录态，账号页无入口。
              //   少了这道守卫，模型可直接传 platform=sycm 重新制造出「账号页出现生意参谋」（FIX-LOG #67）。
              const owner = loginOwnerPlatform(reqPlatform)
              if (owner) {
                console.log(`[dsagent-http] browser_login 被拒: ${reqPlatform} 不可独立登录，应登录 ${owner}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  ok: false,
                  error: `「${reqPlatform}」复用 ${owner} 登录态，没有独立登录流程。请改为登录 ${owner}。`,
                }))
                return
              }
              const freshLogin = rest.freshLogin === true
              const replaceShopKey = String(rest.shopKey ?? '') || undefined
              console.log(`[dsagent-http] browser_login 请求收到: platform=${rest.platform}, loginUrl=${rest.loginUrl}, freshLogin=${freshLogin}, replaceShopKey=${replaceShopKey || '(none)'}`)
              const result = await doBrowserLogin(
                reqPlatform,
                String(rest.loginUrl ?? ''),
                store,
                { freshLogin, replaceShopKey },
              )
              console.log(`[dsagent-http] browser_login 返回: ok=${result.ok}, error=${result.error || '(none)'}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } else if (action === 'browser_close') {
              const result = await closeBrowser()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } else if (action === 'risk_verify') {
              // 风控验证助手：弹可见浏览器打开平台验证页，轮询等待用户过滑块并提取 x5sec 回写
              const platform = String(rest.platform ?? '')
              const explicitUrl = String(rest.verifyUrl ?? '').trim()
              const verifyUrl = explicitUrl || getLastVerifyUrlByPlatform(store, platform)
              console.log(`[dsagent-http] risk_verify 请求收到: platform=${platform}, url=${verifyUrl ? '(已提供)' : '(缺失)'}`)
              if (!verifyUrl) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, passed: false, error: '未找到该平台最近一次风控返回的验证入口，请先执行一次失败的技能以触发风控' }))
              } else {
                const result = await riskVerify(store, platform, verifyUrl)
                console.log(`[dsagent-http] risk_verify 返回: ok=${result.ok}, passed=${result.passed}, error=${result.error || '(none)'}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              }
            } else if (action === 'list_accounts') {
              const accounts = store.listAccounts()
              const rows = accounts.map(a => {
                const isApiKey = a.auth_type === 'apikey'
                const boundAgentIds = a.bound_agent_ids || []
                return {
                  shopKey: a.shop_key,
                  platform: a.platform,
                  accountId: a.account_id,
                  displayLabel: isApiKey ? (a.app_id || a.account_id) : resolveDisplayNick(a.display_label, a.cookies, a.account_id, a.platform),
                  status: a.status,
                  authType: a.auth_type || 'cookie',
                  appId: isApiKey ? (a.app_id || '') : '',
                  secretHint: isApiKey ? maskSecret(a.app_secret || '') : '',
                  // 绑定关系：browser 半区不能读本地文件，必须随行回传，
                  // 否则账号页「智能体」列经 HTTP 路径恒为空
                  boundAgentIds,
                  boundAgentName: boundAgentIds.length ? boundAgentIds.join(', ') : '',
                }
              })
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, rows }))
            } else if (action === 'probe_session') {
              // 远程登录态探测：本地 Cookie 结构完整 ≠ 登录态有效，
              // 服务端可让 web_session 失效（风控/异地登录/过期）而本地 Cookie 完好。
              // 由 host 半区发起请求（browser 半区无法跨域访问平台域名）。
              const shopKey = String(rest.shopKey ?? '')
              const acc = shopKey ? store.get(shopKey) : null
              if (!acc) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, result: 'unknown', error: '账号不存在' }))
              } else {
                const probe = await probeRemoteSession({
                  platform: acc.platform,
                  shop_key: acc.shop_key,
                  cookie_str: acc.cookie_str,
                })
                // 连续失败计数：单次探测失败不落 expired（规范 §5.0 / FIX-LOG #57），
                // 达到阈值才置位；探测成功则清零并恢复 valid（自愈历史误标）。
                const rec = await store.recordSessionProbe(acc.shop_key, probe.result)
                if (rec.flipped) {
                  console.log(`[dsagent-http] probe_session: ${acc.shop_key} → ${rec.status}（${probe.reason || ''}）`)
                } else if (probe.result === 'expired') {
                  console.log(`[dsagent-http] probe_session: ${acc.shop_key} 探测失败 ${rec.failCount}/3，暂不置位`)
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                  ok: true,
                  result: probe.result,
                  reason: probe.reason,
                  status: rec.status,
                  failCount: rec.failCount,
                }))
              }
            } else if (action === 'list_skills') {
              // 技能列表：browser 半区不能读本地文件（node:fs 被打桩），
              // 必须由 host 半区扫描 skillRoot 后回传，否则页面会回退到内置假数据
              const rows = await skill.list()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: true,
                rows: rows.map(s => ({
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  version: s.version,
                  platform: s.platform,
                  capability: s.capability,
                  risk: s.risk,
                  enabled: s.enabled,
                  dir: s.dir,
                  // 质量门禁结果（Accio 同量表）—— 供市场页展示分数与缺陷清单
                  quality: s.quality,
                  issues: s.issues,
                  // 现场修正层标记
                  hasPatch: s.hasPatch,
                  // 使用统计（本地 .skill-stats.json）
                  useCount: s.useCount,
                  lastUsedAt: s.lastUsedAt,
                  // 注意：刻意不回传 body 与 frontmatter —— 两者体积大且页面不需要，
                  // 回传会让技能列表响应膨胀数十倍（body 是整篇 SKILL.md）。
                })),
              }))
            } else if (action === 'set_skill_enabled') {
              // 启停技能：改写 SKILL.md frontmatter，必须由 host 半区落盘
              const skillId = String(rest.skillId ?? '')
              const enabled = rest.enabled === true
              if (!skillId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 skillId' }))
              } else {
                try {
                  await skill.setEnabled(skillId, enabled)
                  // 启停改写了 frontmatter（可能带 tool_triggers），触发注册表要跟着失效重建
                  triggersBuiltAt = 0
                  console.log(`[dsagent-http] set_skill_enabled: skillId=${skillId}, enabled=${enabled}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: true }))
                } catch (err: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
                }
              }
            } else if (action === 'skill_quality') {
              // 质量总览：技能市场页的「质量」视图 + CI 断言的数据源
              try {
                const overview = await skill.qualityOverview()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, ...overview }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'skill_stats') {
              // 使用统计排行 + 长期未用候选（**仅列出，绝不自动删除**）
              try {
                const ranking = await skill.usageRanking()
                const idle = await skill.idleCandidates()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, ranking, idle }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'skill_patch') {
              // 读取某技能的 SKILL.patch.md（现场修正层）
              const patchSkillId = String(rest.skillId ?? '')
              try {
                const patch = patchSkillId ? await skill.patchOf(patchSkillId) : null
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, patch }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'trigger_stats') {
              // 触发注册表诊断：命中规则数 / 已提示会话数
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, stats: triggers.stats() }))
            } else if (action === 'pitfall_stats') {
              // 平台坑位记忆诊断
              try {
                const stats = await pitfalls.stats()
                const active = await pitfalls.activeFor({ skillId: String(rest.skillId ?? '') || undefined })
                const all = await pitfalls.list()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, stats, active, all: all.slice(0, 100) }))
              } catch (err: any) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
              }
            } else if (action === 'delete_account') {
              // 删除账号：按凭证库主键 shopKey 删除（browser 半区不能读写本地文件，必须走此路由）
              const shopKey = String(rest.shopKey ?? '')
              if (!shopKey) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey' }))
              } else {
                // ★ 删除前先算出级联影响（数据驱动的派生关系，见 credential-store.ts 的
                //   DERIVATION_REGISTRY / planCascadeDisconnect）：删淘宝会波及生意参谋系与闲鱼。
                //   必须在**删除前**算 —— 删完目标行就查不到 unb，身份无从判定。
                const cascade = planCascadeDisconnect(shopKey, store.listAccounts())
                const ok = await store.deleteByShopKey(shopKey)
                // ★ 凭证删除成功后再清账号专属 Profile（browser-profiles/accounts/{shopKey}）。
                //   顺序不能反：Profile 被占用删不掉时，账号必须仍然删得掉，所以这里只记结果不抛错。
                const profile = ok ? removeAccountProfile(shopKey) : { cleaned: false, note: '账号不存在' }
                console.log(`[dsagent-http] delete_account: shopKey=${shopKey}, ok=${ok}, profile=${profile.cleaned ? 'cleaned' : profile.note}${cascade.summary ? `, cascade=${cascade.summary}` : ''}`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(ok
                  ? {
                      ok: true,
                      profileCleaned: profile.cleaned,
                      profileNote: profile.cleaned ? undefined : profile.note,
                      // 把级联影响回传给 UI / 模型，让用户知道「还影响了什么」
                      ...(cascade.summary ? { cascadeSummary: cascade.summary } : {}),
                      ...(cascade.affected.length ? { cascadeAffected: cascade.affected.map(a => a.shop_key) } : {}),
                    }
                  : { ok: false, error: '账号不存在' }))
              }
            } else if (action === 'bind_agent') {
              // 绑定智能体：在已有 bound_agent_ids 基础上追加
              const shopKey = String(rest.shopKey ?? '')
              const agentId = String(rest.agentId ?? '').trim()
              if (!shopKey || !agentId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey / agentId' }))
              } else {
                const existing = store.get(shopKey)
                if (!existing) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: '账号不存在' }))
                } else {
                  const agentIds = [...(existing.bound_agent_ids || [])]
                  if (!agentIds.includes(agentId)) agentIds.push(agentId)
                  const saved = await store.setBindings(shopKey, agentIds)
                  console.log(`[dsagent-http] bind_agent: shopKey=${shopKey}, agentId=${agentId}, ok=${!!saved}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(saved ? { ok: true } : { ok: false, error: '绑定失败' }))
                }
              }
            } else if (action === 'unbind_agent') {
              // 解绑智能体：从 bound_agent_ids 中移除（绑错号后必须能撤回）
              const shopKey = String(rest.shopKey ?? '')
              const agentId = String(rest.agentId ?? '').trim()
              if (!shopKey || !agentId) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 shopKey / agentId' }))
              } else {
                const existing = store.get(shopKey)
                if (!existing) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: '账号不存在' }))
                } else {
                  const agentIds = (existing.bound_agent_ids || []).filter(id => id !== agentId)
                  const saved = await store.setBindings(shopKey, agentIds)
                  console.log(`[dsagent-http] unbind_agent: shopKey=${shopKey}, agentId=${agentId}, ok=${!!saved}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(saved ? { ok: true } : { ok: false, error: '解绑失败' }))
                }
              }
            } else if (action === 'list_agents') {
              // 会话（= 智能体）列表：账号页的绑定下拉需要它。
              // browser 半区拿不到 cordis 服务，必须由 host 半区回传。
              // 注意：Agent 接口只有 readonly id，没有人类可读名，下拉只能显示 id。
              let agents: { id: string }[] = []
              try {
                // ctx.get(name, strict) 无需静态 inject 即可读服务；
                // strict=false 兜底，避免提供方 fiber 状态判定导致偶发取空。
                const getSvc = (ctx as any).get
                const svc: any = typeof getSvc === 'function'
                  ? (getSvc.call(ctx, 'agents') ?? getSvc.call(ctx, 'agents', false))
                  : undefined
                const list = typeof svc?.list === 'function' ? svc.list() : []
                agents = ((list || []) as any[])
                  .map((a: any) => ({ id: String(a?.id ?? '') }))
                  .filter((a: { id: string }) => a.id)
              } catch (err: any) {
                console.log(`[dsagent-http] list_agents 失败: ${err?.message || String(err)}`)
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, agents }))
            } else if (action === 'save_apikey') {
              // 保存 API Key 凭证（AppID + AppSecret）
              const platform = String(rest.platform ?? '')
              const appId = String(rest.appId ?? '')
              const appSecret = String(rest.appSecret ?? '')
              if (!platform || !appId || !appSecret) {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 platform / appId / appSecret' }))
              } else {
                try {
                  const saved = await store.saveApiKey(platform, appId, appSecret)
                  console.log(`[dsagent-http] save_apikey 成功: shopKey=${saved.shop_key}`)
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: true, shopKey: saved.shop_key, accountId: saved.account_id }))
                } catch (err: any) {
                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
                }
              }
            } else if (action === 'save_cookie') {
              // 手动导入 Cookie 字符串
              const platform = String(rest.platform ?? '')
              const cookieStr = String(rest.cookieStr ?? '')
              if (!platform || !cookieStr) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: '缺少 platform/cookieStr' }))
                return
              }
              try {
                const jar = parseCookieStr(cookieStr)
                const shopKey = await store.save(platform, jar)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: true, shopKey }))
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
              }
            } else if (action === 'check_update') {
              // 检查更新：比对本地版本（package.json version + build-info commit）
              // 与 GitHub latest Release。UI 技能页「检查更新」按钮的数据源。
              const local = readLocalVersion()
              const remote = await fetchRemoteVersion()
              const updateAvailable = remote.ok ? hasUpdate(local, remote) : false
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({
                ok: true,
                local: { version: local.version, commit: local.commit, builtAt: local.builtAt },
                remote: { version: remote.version, commit: remote.commit },
                remoteOk: remote.ok,
                remoteError: remote.error,
                updateAvailable,
                repo: UPDATE_REPO,
                downloadUrl: `https://github.com/${UPDATE_REPO}/releases/latest/download/DSAgent-Update.zip`,
              }))
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }))
            }
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }))
          }
        },
      })
      return dispose
    })
  })

  /* ─────────────── 1. 系统提示词 ─────────────── */

  ctx.effect(() => {
    // 扫描技能清单，拼进系统提示词——这是模型触发技能调用的唯一入口
    const catalog = scanSkillCatalog()
    // 启动时构建一次工具触发注册表（异步，不阻塞提示词注入；
    // 首次工具调用若早于构建完成，executeSkillCore 里会按 TTL 再补建一次）
    void rebuildTriggers()
    const skillLines: string[] = [
      '【技能调用方式】',
      '业务技能有两种暴露方式，按以下优先级选择：',
      '1. 每个技能一个独立工具（名字形如 dsagent_<技能id>），参数表由该技能的 contract.json 生成，',
      '   参数名/类型/是否必填/可选值都已写在工具定义里 —— 优先用这类工具，直接按具名参数调用。',
      '2. 其余技能没有契约，统一走 dsagent_execute_skill（参数 id=技能 id，request=用户原话，',
      '   需要参数时再填 args）。',
    ]
    if (catalog.length) {
      skillLines.push(
        '',
        '【以下技能尚未暴露为独立工具，请用 dsagent_execute_skill 调用】',
        '',
        ...catalog.map(s => {
          const needsPlatform = s.platform !== '无' ? `（需绑定 ${s.platform} 账号）` : ''
          const usage = s.usage ? `　用法：${s.usage}` : ''
          return `- ${s.id}：${s.description}${needsPlatform}${usage}`
        }),
        '',
        '示例：用户说「分析耳机市场」→ 调用 dsagent_execute_skill(id="market-analysis", request="分析耳机市场", args="耳机")',
      )
    }

    const dispose = ctx.systemPrompt.section({
      name: 'dsagent-tools',
      order: 50,
      text: [
        'DSAgent 插件提供以下工具（dsagent_ 前缀），与宿主的 skill 系统相互独立：',
        '',
        ...skillLines,
        '',
        '【工具说明】',
        '【账号类】',
        '- dsagent_list_accounts：列出已连接的平台账号及登录态',
        '- dsagent_check_account_health：检查账号登录态是否有效',
        '- dsagent_search_accounts：根据关键词/token 自动查找匹配的账号',
        '',
        '【技能类】',
        '- dsagent_list_skills：列出 DSAgent 插件管理的业务技能',
        '- dsagent_get_skill_detail：查看单个技能详情',
        '- dsagent_execute_skill：执行指定技能并返回结果数据',
        '- dsagent_generate_report：基于 AI 洞察 Markdown 生成 HTML 报告',
        '',
        '【平台类】',
        '- dsagent_list_platforms：列出支持连接的平台及授权状态',
        '',
        '【代理类】',
        '- dsagent_proxy：向平台发 HTTP 请求，自动注入 Cookie。三种 kind：http_get / http_post / mtop_jsonp',
        '',
        '【风控类】',
        '- dsagent_risk_verify：技能因安全风控失败时调用。弹出浏览器打开平台验证页，',
        '  用户完成滑块验证后自动提取验证凭证写回账号并解除风控，随后重试原技能即可',
        '',
        '【发布类】',
        '- dsagent_douyin_publish：发布视频到抖音（L2 真实副作用）。',
        '  ★ 必须两步走：先不带 confirm 调用 → 拿到「发布预览」→ 把预览内容完整给用户看并征求同意 →',
        '  用户明确同意后才带 confirm=true 重新调用。绝不要在一次调用里直接传 confirm=true。',
        '- dsagent_zhihu_publish：发布文章到知乎专栏（L2 真实副作用）。',
        '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
        '- dsagent_xiaohongshu_publish：发布笔记到小红书（L2 真实副作用），支持视频笔记与图文笔记。',
        '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
        '- dsagent_xianyu_publish：发布商品到闲鱼（L2 真实副作用）。',
        '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
        '  参数：images（本地图片路径，逗号分隔，1~9 张，单张 ≤10MB）、description（必填，不能含 emoji）、',
        '  price（必填，0~1 亿元）；可选 title / originalPrice。',
        '  ★ 前提：只需在「账号连接」绑定**淘宝**账号 —— 闲鱼复用阿里 SSO，登录淘宝成功后会自动派生',
        '  闲鱼登录态并同步 goofish 域 Cookie（无需扫码闲鱼 APP）。',
        '  若闲鱼技能报登录失效（token_expired），请对该淘宝账号执行「重新登录」以重新同步，不要引导用户去扫码闲鱼。',
        '  部分类目网页版不支持发布，页面会要求「扫码去APP发布」，此时只能引导用户到闲鱼 APP 操作。',
        '- dsagent_taobao_publish：发布商品到淘宝 / 天猫卖家中心（L2 真实副作用）。',
        '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
        '  参数：images（本地图片路径，逗号分隔，1~5 张，单张 ≤3MB）、title（必填，≤60 字符）；',
        '  可选 channel（taobao 默认 / tmall）、price（一口价）、stock（库存）、itemNo（货号）、',
        '  categoryKeyword（选类目关键词，填了会自动搜索并选**第一个类目**后进入表单）、',
        '  brand / model（品牌、型号；部分类目在选类目页把它们列为**必填属性**，如「AI软件订阅/Token充值」不填就进不了表单）。',
        '  ★ 字段策略：只自动填「主图 / 标题 / 一口价 / 库存 / 货号」；类目属性、商品详情、发货与售后设置',
        '  **不会自动填**，需用户在弹出窗口内人工补全后提交。发布第一步要**选类目**，页面停在「选择类目」属正常：',
        '  传了 categoryKeyword 会自动选第一个类目（该类目要求品牌/型号时会用 brand/model 自动填），未传则请让用户在窗口内选好类目。',
        '  ★ 淘宝与天猫共用**同一套淘宝登录态**（账号连接页只需连淘宝）；命中 baxia 滑块时返回 risk_control，',
        '  用 dsagent_risk_verify（platform=taobao）拉起验证页。',
        '- dsagent_pdd_publish：发布商品到拼多多商家后台（L2 真实副作用）。',
        '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
        '  参数：images（本地图片路径，逗号分隔，1~10 张，单张 ≤3MB）、title（必填，≤60 字符）；',
        '  可选 detailImages（详情页图片路径，逗号分隔，最多 50 张、单张 ≤3MB）、',
        '  skus（SKU 多规格 JSON 数组字符串，形如 [{"name":"白色","image":"C:/img/w.jpg","price":"9.9","stock":"1000"}]；',
        '  name 为规格值名、image 为该规格预览图本地路径（平台必填）、price 为拼单价、stock 为库存，',
        '  ★ 单买价由工具自动按「拼单价 + 1」计算，无需传）、',
        '  category（类目关键词或完整路径，如「纸杯」）、price（商品参考价）、stock（库存）、itemNo（货号）。',
        '  ★ 拼多多发布走**两步式**真实链路（不能直接打开表单 URL）：先到商品列表点「发布新商品」→',
        '  第一步页填主图 + 标题 → 点「下一步」→ 第二步表单页才真正初始化。',
        '  ★ 类目**由平台按发布入口自动推荐带出**（如「餐饮具 > 杯子/水杯/水壶 > 马克杯」），本工具不自动选类目；',
        '  category 参数仅作提示，如需改类目请在第二步页面点「修改分类」。',
        '  字段策略：自动填「主图 / 标题 / 参考价 / 库存 / 货号 / 详情图 / SKU 规格（含预览图与拼单价，单买价 = 拼单价+1）」，',
        '  并尽力自动选「商品属性」（品牌除外）；**发货与售后设置、运费模板、商品资质不会自动填**，',
        '  需用户在弹出窗口内人工补全后提交。',
        '  ★ 前提：必须在「账号连接」绑定**拼多多商家后台**（mms.pinduoduo.com）—— 它与拼多多买家账号',
        '  （dsagent_pdd_crawl 用的那套）是**两套完全独立的登录态**，绑定买家账号不能用于发布。',
        '  ★ 拼多多的滑块风控是**页内内联**的（不是独立验证页），因此**不能**用 dsagent_risk_verify 处理：',
        '  本工具会在已打开的可见窗口内等待用户手动拖动滑块，超时才返回 risk_control。',
        '',
        '【采集类】',
        '- dsagent_pdd_crawl：采集拼多多商品数据（只读，无副作用）。',
        '  拼多多接口需要页面 JS 生成的 anti_content 签名，纯 HTTP 请求必被拒，因此本工具驱动浏览器取数。',
        '  参数：mode=feed（首页推荐流，推荐）/ search / goods；search 传 keyword，goods 传 goodsId；limit 为条数上限（字符串，默认 20）。',
        '  省略 mode 时自动推断：有 goodsId → goods，有 keyword → search，都没有 → feed。',
        '  ★ search / goods 有账号级频控（常 429 error_code=40002「系统繁忙」），mode=feed 稳定可用，未指定关键词/商品 ID 时优先 feed。',
        '  ★ search 命中频控时返回 failureKind=risk_control，此时不要反复重试 search，改用 mode=feed。',
        '  ★ 前提：必须先绑定拼多多账号，未登录访问拼多多会强制跳登录页。',
        '- dsagent_xianyu_analytics：统计闲鱼商品表现数据（只读，无副作用）。',
        '  输出曝光/想要/收藏与爆款、滞销排行。参数：mode=overview（默认）/ items；limit 默认 50，最大 100。',
        '  ★ 前提同 dsagent_xianyu_publish：绑定淘宝账号即可，闲鱼登录态由淘宝登录成功后自动同步。',
        '',
        '【对话类】',
        '- dsagent_chat_with_context：基于技能执行结果生成自然语言回复',
        '',
        '【重要规则】',
        '1. 优先调用业务技能：有独立工具（dsagent_<技能id>）的直接用该工具；其余用 dsagent_execute_skill。',
        '   不要手动用 dsagent_proxy 拼接 API 请求。技能已封装好签名、分页、数据清洗等逻辑。',
        '2. 只有当已注册技能无法满足需求时，才使用 dsagent_proxy 手动发请求。',
        '3. 用 dsagent_execute_skill 时，从 dsagent_list_skills 返回的列表中选择正确的技能 ID。',
        '4. 无契约技能的用法里带参数的，必须同时填 args 参数（如 args="手机壳" 或 args="--keyword 手机壳 --page 2"）。',
        '   技能因参数问题失败时，返回文案会附带「用法」，请按用法补 args 后重新调用。',
        '5. 技能返回 failureKind 时，按错误处理表引导用户，不要盲目重试。',
        '',
        '当业务技能需要平台数据但账号未绑定时，系统会自动拦截并返回引导文案。',
        '请引导用户到「账号连接」页面手动添加账号。',
        '',
        '【错误处理】',
        '工具返回的 failureKind 字段标识失败类型，请根据它选择行动：',
        '- not_bound：平台未绑定 → 引导用户到「账号连接」页面添加账号',
        '- token_expired：登录态过期 → 引导用户到「账号连接」页面重新登录',
        '- risk_control：被风控拦截 → 调用 dsagent_risk_verify（platform=该平台）拉起验证页，',
        '  用户完成滑块后凭证会自动写回账号；然后重新执行刚才失败的技能（不要盲目重复调用原技能）',
        '- rate_limit：接口限流 → 告诉用户稍后重试',
        '- no_permission：登录态**有效**，但该账号没有当前业务/类目权限（如生意参谋返回「类目无权限」）。',
        '  ★ 这不是登录问题，**不要让用户重新登录**（重登不解决任何问题）。',
        '  请告知用户：当前账号无权访问该业务/类目，需换一个有权限的账号（到「账号连接」页面添加/切换），',
        '  或让用户用该账号在浏览器里确认能打开对应平台页面。',
        '- api_error / parse_error / skill_error：展示错误信息，不要盲目重试',
        '- skill_not_found：技能 ID 错误 → 用返回的可用技能列表重新选择',
        '- need_account_choice：该平台有多个可用账号，且当前会话未绑定具体账号。',
        '  ★ 绝不要自己挑一个。把返回的 accounts 候选列表列给用户，问清要用哪一个，',
        '  然后把选定的 shopKey 填进 dsagent_execute_skill 的 account 参数重新调用；',
        '  也可以引导用户到「账号连接」页面把该账号绑定到当前会话（此后本会话自动使用它）。',
        '  静默选错号会污染所有使用该平台的技能，且症状隐蔽（不报错，只是空数据）。',
      ].join('\n'),
    })
    return () => { dispose() }
  }, 'dsagent: systemPrompt')

  /**
   * 技能执行核心 —— `dsagent_execute_skill` 与「按契约暴露的每技能独立工具」共用。
   *
   * @param fromContract 参数来自技能契约（contract.json）：explicitArgs 已是完整 argv，
   *        下层会跳过「按用法模板 / 自然语言猜参数」，原样透传。
   * @param invokedTool  实际被调用的工具名，仅用于失败文案里的重试引导。
   */
  async function executeSkillCore(opts: {
    skillId: string
    requestStr: string
    explicitArgs?: string[]
    chosenShopKey: string
    agentId: string
    fromContract: boolean
    invokedTool: string
    /** 契约工具路径下的原始具名参数 —— 供 tool_triggers 的 args 条件匹配使用 */
    contractArgs?: Record<string, unknown>
  }): Promise<any> {
    const { skillId, requestStr, explicitArgs, chosenShopKey, agentId, fromContract, invokedTool } = opts

    // 前置校验：技能必须存在
    const skillInfo = await skill.get(skillId)
    if (!skillInfo) {
      const allSkills = await skill.list({ onlyEnabled: true })
      const available = allSkills.map(s => s.id).join('、')
      return { ok: false, failureKind: 'skill_not_found', text: `技能「${skillId}」不存在。可用技能：${available}`, exitCode: -1, skillId, message: '' } as any
    }

    // 技能目录 + 自带资源清单：可执行技能失败或数据层为空时，模型要读技能自带
    // references/、scripts/ 才能排查。缺这段会让模型满盘搜索文件系统找技能安装位置。
    const skillDirHint = skillInfo.dir ? renderSkillDirHint(skillInfo.dir) : ''

    // 工具触发提示（吸收 Accio 的 tool_triggers）：把与该技能相关的**其他**技能、
    // 以及插件内置的风控预提示挂到返回里，让模型在动手前先读相关 SKILL.md。
    // 会话级去重：同一技能在同一会话只提示一次，避免多轮对话反复刷屏。
    // 用实际被调用的工具名（invokedTool）匹配，这样声明了 `tool: dsagent_<技能>` 的
    // 规则在契约工具路径下也能命中，而不只在 dsagent_execute_skill 路径下生效。
    let triggerHint = ''
    try {
      if (Date.now() - triggersBuiltAt > TRIGGER_REBUILD_TTL) await rebuildTriggers()
      const callArgs = { id: skillId, ...(opts.contractArgs ?? {}) }
      const hits = [
        ...triggers.match('dsagent_execute_skill', callArgs, agentId),
        ...triggers.match(invokedTool, callArgs, agentId),
      // 去掉「本次正在执行的技能自己」——提示它去读自己正在跑的文件没有意义
      ].filter(h => h.skillId !== skillId)
      // 同一个技能可能被两条规则命中（通用规则 + 具名工具规则），去重
      const seen = new Set<string>()
      const unique = hits.filter(h => (seen.has(h.skillId) ? false : (seen.add(h.skillId), true)))
      if (unique.length) triggerHint = triggers.formatHint(unique)
    } catch (e) {
      console.warn('[dsagent] 触发匹配失败（不影响技能执行）:', e instanceof Error ? e.message : String(e))
    }

    /**
     * 坑位提示（P3）是惰性计算的，见 platform 解析之后的 `ensurePitfallHint()`。
     */

    const platform = requiredPlatform(skillId)
    let resolvedShopKey = chosenShopKey
    if (platform) {
      const ctx2 = await account.fetchBindingContext(platform, agentId, chosenShopKey)
      if (!ctx2) {
        return { ok: false, failureKind: 'not_bound', text: `技能「${skillId}」需要 ${guidedPlatform(platform)} 平台授权${guidedPlatformExtra(platform)}，请先到「账号连接」页面绑定账号。`, exitCode: -1, skillId, message: '' } as any
      }
      // 多账号未绑定当前会话：不静默选择，把候选交给模型问用户
      if (ctx2.failureKind === 'need_account_choice') {
        const choices = ctx2.choices || []
        const lines = choices.map((c, i) => `${i + 1}. ${c.nickname}（平台=${c.platformId}，账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`)
        return {
          ok: false,
          failureKind: 'need_account_choice',
          text: [
            `技能「${skillId}」需要 ${platform} 平台账号，但当前会话未绑定具体账号，且该平台有 ${choices.length} 个可用账号。`,
            '为避免选错账号（错号会静默影响所有使用该平台的技能），请先向用户确认要用哪一个：',
            ...lines,
            '',
            `用户选定后，把对应的 shopKey 传给本次调用的 account 参数即可（${invokedTool}）；`,
            '也可以引导用户到「账号连接」页面把该账号绑定到当前会话，此后本会话将自动使用它。',
          ].join('\n'),
          platform,
          accounts: choices,
          exitCode: -1,
          skillId,
          message: '',
        } as any
      }
      // 会话状态检查：过期 / 必须重登 / 风控
      //
      // ★ `reauth_required` 与 `expired` 给出**不同**的文案（吸收 Accio 的
      //   error / reconnect_required 二分）：
      //     · reauth_required —— 连续探测失败已达阈值，重试无用，必须人工重登
      //     · expired         —— 疑似失效，可能是网络抖动，允许先重试
      //   两者都映射到 failureKind='token_expired'（对模型而言动作都是「让用户重登」），
      //   但文案把确定性说清楚，避免用户在「疑似过期」上反复重试。
      if (ctx2.sessionHint === 'reauth_required') {
        return {
          ok: false,
          failureKind: 'token_expired',
          text: `${guidedPlatform(platform)} 平台登录态已失效（连续探测失败，重试无法恢复）。请引导用户到「账号连接」页面重新登录${guidedPlatformExtra(platform)}。`,
          exitCode: -1,
          skillId,
          message: '',
        } as any
      }
      if (ctx2.sessionHint === 'expired') {
        return { ok: false, failureKind: 'token_expired', text: `${guidedPlatform(platform)} 平台登录态疑似过期（可能是网络抖动）。可先重试一次；若仍失败，请到「账号连接」页面重新登录。`, exitCode: -1, skillId, message: '' } as any
      }
      if (ctx2.sessionHint === 'risk_control') {
        // 预检就撞上风控 —— 与脚本路径共用同一份「什么算坑位」判定，
        // 避免两条路径对同一个 failureKind 给出不同行为（实测踩过）。
        if (isRecordableFailure('risk_control')) {
          try {
            await pitfalls.record({ skillId, platform, failureKind: 'risk_control', message: '会话被风控拦截（平台侧）' })
          } catch { /* 静默 */ }
        }
        return { ok: false, failureKind: 'risk_control', text: `${platform} 平台会话被风控拦截。请调用 dsagent_risk_verify（platform=${platform}）拉起验证页完成滑块验证，凭证会自动写回账号，然后重新执行本技能。`, exitCode: -1, skillId, message: '' } as any
      }
      // 选定账号（含第 ④ 级唯一候选）→ 透传给网关，保证 host 预检与网关选号一致
      resolvedShopKey = ctx2.shopKey || resolvedShopKey
    }

    /**
     * 坑位提示（P3）：把**已复现达阈值**的历史坑位挂到返回里。
     *
     * 必须是**惰性**的 —— 只在失败路径上才计算。原因：
     *   · 成功路径不需要它（成功时附一段「这技能历史上老失败」纯属噪声）
     *   · `activeFor()` 要读盘 + 过滤，成功是常态，白做一次 IO 不划算
     *
     * 必须在 platform 解析之后定义 —— 平台维度的坑（同平台所有技能共享，
     * 如频控）需要 platform 才能取到。
     *
     * 与 tool_triggers 是互补关系：
     *   - tool_triggers 来自技能**作者声明**（静态、人工维护）→ 管「事先该读哪个文件」
     *   - 坑位提示来自**真实失败统计**（动态、机器累积）→ 管「事后这是什么问题」
     *
     * 只取 confirmed（证据 ≥ 阈值）且未陈旧的条目 —— 单次偶发失败不会进入提示。
     */
    let pitfallHint: string | null = null
    async function ensurePitfallHint(): Promise<string> {
      if (pitfallHint !== null) return pitfallHint
      try {
        const active = await pitfalls.activeFor({ skillId })
        // 平台维度的坑也一并带出（同一平台下所有技能共享的坑，如频控）
        const byPlatform = platform ? await pitfalls.activeFor({ platform }) : []
        const uniqSeen = new Set<string>()
        const deduped = [...active, ...byPlatform].filter(e => {
          const k = `${e.platform}::${e.failureKind}::${e.signature}`
          if (uniqSeen.has(k)) return false
          uniqSeen.add(k)
          return true
        }).slice(0, PITFALL.MAX_HINT_ITEMS)
        pitfallHint = deduped.length ? renderPitfallHint(deduped) : ''
      } catch (e) {
        console.warn('[dsagent] 坑位提示生成失败（不影响技能执行）:', e instanceof Error ? e.message : String(e))
        pitfallHint = ''
      }
      return pitfallHint
    }

    // 从本地凭证库获取 Cookie 注入环境变量
    // 先等本地代理网关就绪，拿到动态端口
    const gw = await gatewayReady
    const env: Record<string, string> = {
      DSAGENT_WORKSPACE: process.env.DSAGENT_WORKSPACE ?? process.cwd(),
      DSAGENT_SKILL_ROOT: cfg.skillRoot,
      DSAGENT_REQUEST: requestStr,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      // ── 网关三件套：指向本地代理网关 ──
      DSCONNECT_URL: gw.url,
      DSCONNECT_TOKEN: 'local',   // 占位值，本地网关不验签
      // 当前会话（= 智能体）ID：网关据此走「会话绑定」这一级选号
      DSCONNECT_AGENT_ID: agentId,
    }
    // 已选定的账号：网关据此走「显式 shopKey」这一级，保证与 host 预检同号
    if (resolvedShopKey) env.DSCONNECT_SHOP_KEY = resolvedShopKey

    // 如果技能需要平台绑定，刷新 Cookie 到网关（QIWork 模式：Cookie 不出网关）
    // 脚本通过 DSCONNECT_URL 网关代理发请求，不需要 DSAGENT_COOKIE 环境变量
    if (platform) {
      const stored = account.findStoredAccount(platform, agentId, resolvedShopKey)
      if (stored) {
        // 闲鱼平台：网关通过 Set-Cookie 合并自动刷新 _m_h5_tk，无需浏览器刷新
        // （FAIL_SYS_TOKEN_EXPIRED / FAIL_SYS_ILLEGAL_ACCESS 响应的 Set-Cookie 会自动合并回凭证库）
        // 保留 DSAGENT_COOKIE 作为向后兼容（旧脚本可能需要）
        env.DSAGENT_COOKIE = stored.cookie_str
        env.DSAGENT_PLATFORM = stored.platform
        env.DSAGENT_ACCOUNT_ID = stored.account_id
        env.DSAGENT_TB_TOKEN = stored.tb_token
        // 选定账号的 shopKey：脚本透传给网关，避免网关重新走选择链选到别的号
        env.DSCONNECT_SHOP_KEY = stored.shop_key
      }
    }

    const result = await skill.run(skillId, requestStr, env, { args: explicitArgs, fromContract })
    if (!result.ok) {
      // 失败类型：优先采用脚本自报的 failure_kind（管线层已从 payload 提取），
      // 仅在缺失时才用 stderr 关键词反推兜底
      let failureKind = result.failureKind || ''
      if (!failureKind) {
        failureKind = 'skill_error'
        const errMsg = (result.message + ' ' + result.stderr).toLowerCase()
        if (errMsg.includes('risk_control') || errMsg.includes('风控')) {
          failureKind = 'risk_control'
        } else if (errMsg.includes('rate_limit') || errMsg.includes('限流') || errMsg.includes('too many')) {
          failureKind = 'rate_limit'
        } else if (errMsg.includes('no_permission') || errMsg.includes('无权限') || errMsg.includes('权限不足') || errMsg.includes('无权访问') || errMsg.includes('无权')) {
          // ★ 必须排在 token_expired 之前：权限错误曾被 `没有权限` 归到 token_expired，
          //   导致模型引导用户「重新登录」，而登录态其实完全有效，重登不解决任何问题。
          failureKind = 'no_permission'
        } else if (errMsg.includes('token_expired') || errMsg.includes('FAIL_BIZ_LOGIN') || errMsg.includes('site_illegal') || errMsg.includes('登录站点非法') || errMsg.includes('请登录')) {
          failureKind = 'token_expired'
        } else if (errMsg.includes('parse_error') || errMsg.includes('parse')) {
          failureKind = 'parse_error'
        }
      }
      // 附上技能用法：多数失败是参数没给对，模型可据此补参数重试
      const usageHint = result.usage ? `\n\n用法：${result.usage}\n如需参数，请补全后重新调用 ${invokedTool}。` : ''

      // 坑位累积（P3）：把本次真实失败记入统计。达阈值的坑位下次调用会进 pitfallHint。
      // 「哪些失败算坑位」的判定收口在 pitfall-memory::isRecordableFailure，
      // 与上面预检分支共用同一份策略（原先两处各写一套，实测已分叉）。
      if (isRecordableFailure(failureKind)) {
        try {
          await pitfalls.record({
            skillId,
            platform: platform ?? undefined,
            failureKind,
            message: result.message || result.stderr || '',
          })
        } catch { /* 记忆写入失败不能影响错误上报 */ }
      }

      // 坑位提示（惰性计算：只在失败路径上真的读盘取一次）
      const pitfallHint = await ensurePitfallHint()

      return {
        ok: false,
        failureKind,
        text: `技能执行失败：${result.message || result.stderr || '未知错误'}${usageHint}\n\n${skillDirHint}`
          + (triggerHint ? `\n\n${triggerHint}` : '')
          + (pitfallHint ? `\n\n${pitfallHint}` : ''),
        usage: result.usage ?? null,
        exitCode: result.exitCode,
        skillId,
        message: result.message || '',
      } as any
    }

    let reportPath: string | undefined
    let csvPath: string | undefined
    if (result.payload) {
      const payload = typeof result.payload === 'string' ? (() => { try { return JSON.parse(result.payload) } catch { return null } })() : result.payload
      if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>
        reportPath = typeof p.report_path === 'string' ? p.report_path : undefined
        csvPath = typeof p.csv_path === 'string' ? p.csv_path : undefined
      }
    }

    // 指令型技能的正文必须原样直传（截断/落盘都会让模型读不到完整指令）
    const isInstructions = typeof result.payload === 'object' && result.payload !== null
      && (result.payload as Record<string, unknown>).mode === 'instructions'

    const rawPayload = result.payload != null
      ? (typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2))
      : result.stdout.slice(-4000)

    const payloadStr = isInstructions ? rawPayload : spillPayload(skillId, rawPayload)

    const supportsReport = await skill.supportsReport(skillId)
    const textParts: string[] = [`技能「${skillId}」执行成功。\n\n${payloadStr}`]
    if (reportPath) textParts.push(`\n\n📊 HTML 报告已生成：${reportPath}`)
    if (csvPath) textParts.push(`\n📎 CSV：${csvPath}`)
    if (supportsReport && !reportPath) textParts.push(`\n\n💡 该技能支持生成 HTML 报告，请基于数据撰写洞察后调用 dsagent_generate_report。`)
    // 技能目录 + 资源清单：数据层为空/结果异常时，模型据此读技能自带 references/ 排查
    textParts.push(`\n\n${skillDirHint}`)
    // 工具触发提示：相关技能 + 内置风控预提示
    if (triggerHint) textParts.push(`\n\n${triggerHint}`)

    return { ok: true, text: textParts.join(''), exitCode: result.exitCode, skillId, message: result.message, reportPath: reportPath ?? null, csvPath: csvPath ?? null, supportsReport } as any
  }

  /**
   * 技能契约 → 一个独立的 DSH 工具（一技能一工具，参数表来自 contract.json）。
   *
   * 这是「真 MCP 式」的落点：模型直接看到该技能自己的参数名/类型/是否必填/可选值，
   * 不再靠统一 args 字符串 + 正则猜。无契约的技能不会走到这里。
   */
  function buildContractTool(row: SkillRow, contract: SkillContract): ToolDefinition | null {
    const name = contractToolName(row.id)
    const params = contractToolParameters(contract)
    const platform = requiredPlatform(row.id)
    // 平台账号选择是宿主注入的能力（不属于技能 argparse），按需附加
    if (platform && !params.account) {
      params.account = { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' }
    }
    const descParts = [row.description || row.name]
    if (platform) descParts.push(`需要 ${guidedPlatform(platform)} 平台授权。`)
    return defineTool({
      name,
      description: descParts.join(' '),
      parameters: params,
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        const rawArgs = (args ?? {}) as Record<string, unknown>
        let argv: string[]
        try {
          argv = buildContractArgv(contract, rawArgs)
        } catch (e) {
          return {
            ok: false,
            failureKind: 'invalid_args',
            text: `调用 ${name} 的参数不正确：${e instanceof Error ? e.message : String(e)}`,
            skillId: row.id,
            message: '',
          } as any
        }
        // 契约工具没有自然语言 request：用参数拼一条可读描述，供 DSAGENT_REQUEST 与日志使用
        const requestStr = Object.entries(rawArgs)
          .filter(([k, v]) => k !== 'account' && v !== undefined && v !== null && String(v).trim() !== '')
          .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
          .join(' ')
        return executeSkillCore({
          skillId: row.id,
          requestStr,
          explicitArgs: argv,
          chosenShopKey: args?.account ? String(args.account).trim() : '',
          agentId: agentIdOf(exec),
          fromContract: true,
          invokedTool: name,
          contractArgs: rawArgs,
        })
      },
    })
  }

  const tools = [

    /* ─── 账号查询工具 ─── */

    defineTool({
      name: 'dsagent_list_accounts',
      description: '列出当前已连接的平台账号及其登录态。只读。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤。不传时返回全部' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.list(args.platform)
        if (!rows.length) {
          return { text: '当前没有已连接的平台账号。请引导用户打开「账号连接」页面添加账号。', count: 0 }
        }
        // 必须显式给出「店铺名」字段：生意参谋系技能（巡店管家、market-trend 等）要求
        // `--shop-name` 必填，但凭证库里只有一个展示标签，模型无法自行推断该填什么，
        // 会卡在反复追问用户。这里把标签直接标注为「店铺名」并说明它就是 --shop-name 的取值。
        return {
          text: [
            '已连接账号（「店铺名」即技能参数 --shop-name 的取值）：',
            ...rows.map(a => `- 平台=${a.platformId} | 店铺名=${a.nickname} | 账号ID=${a.platformUid} | 状态=${a.status} | 检查时间=${a.lastCheckAt}`),
          ].join('\n'),
          count: rows.length,
        }
      },
    }),

    defineTool({
      name: 'dsagent_check_account_health',
      description: '检查指定平台账号的登录态是否有效。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.checkHealth(args.platform)
        const bad = rows.filter(r => r.status !== 'valid')
        if (!bad.length) return { text: `已检查 ${rows.length} 个账号，全部有效。`, allOk: true } as any
        return {
          text: `以下 ${bad.length} 个账号需重新登录：\n` + bad.map(r => `- ${r.platformId} | ${r.nickname} | ${r.status}`).join('\n'),
          allOk: false,
          needRelogin: bad.length,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_search_accounts',
      description: '根据关键词或 token 自动查找匹配的账号。',
      parameters: {
        keyword: { type: 'string', required: true, description: '关键词、店铺 ID 或自然语言' },
        platform: { type: 'string', description: '可选，限定平台' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await account.findByKeyword(args.keyword, args.platform)
        if (!rows.length) return { text: `未找到与「${args.keyword}」匹配的账号。`, count: 0 }
        return { text: rows.map(a => `- ${a.platformId} | ${a.nickname} | UID: ${a.platformUid} | ${a.status}`).join('\n'), count: rows.length }
      },
    }),

    /* ─── 浏览器登录工具（host 半区，用 Playwright 启动浏览器） ─── */

    defineTool({
      name: 'dsagent_browser_login',
      description: '启动浏览器并导航到平台登录页，等待用户扫码登录。登录成功后自动提取 Cookie 并存入本地凭证库。这是内嵌浏览器登录方案的核心工具。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao / douyin' },
        loginUrl: { type: 'string', required: true, description: '平台登录页 URL' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        freshLogin: { type: 'boolean', description: '为 true 时使用全新的空浏览器环境登录，用于在同一平台添加「其他账号」（避免复用已绑定账号的登录态导致误判登录成功）' },
        shopKey: { type: 'string', description: '「重新登录」场景传入被刷新账号的凭证库主键 {platform}_{accountId}，登录成功后旧条目被替换、绑定关系继承；不传则视为新增账号' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        // ★ 不可独立登录的平台（生意参谋系 / 天猫）：凭证层复用淘宝登录态，无独立登录流程。
        //   模型可能推断出 platform=sycm 并试图登录，这里必须挡住（FIX-LOG #67）。
        const owner = loginOwnerPlatform(platform)
        if (owner) {
          return {
            ok: false,
            error: `「${platform}」复用 ${owner} 登录态，没有独立登录流程。请改为登录 ${owner}（登录后 ${platform} 技能即可直接用）。`,
          } as any
        }
        const loginUrl = String(args.loginUrl ?? '')
        // ★ 授权流程 operation 化（吸收 Accio 的 managed-auth start/advance/poll/cancel）：
        //   每次登录都登记一个 operation，模型可 poll 进度、resume 续推、cancel 放弃。
        //   同平台重复 start 会**复用**未结束的 operation（幂等），
        //   避免模型重试时拉起第二个浏览器撞上 Chrome 的 userDataDir 独占锁。
        const op = authOp.startOperation({
          kind: 'login',
          platform,
          onCancel: async () => {
            // 取消 = 关掉浏览器窗口。窗口一关，登录进度自然作废，无需额外状态。
            await closeBrowser()
          },
        })
        const result = await doBrowserLogin(platform, loginUrl, store, {
          freshLogin: args.freshLogin === true,
          replaceShopKey: String(args.shopKey ?? '') || undefined,
          operationId: op.operationId,
        })
        // 把 operationId 一并返回，模型后续可据此 poll / cancel
        const finalOp = authOp.getOperation(op.operationId)
        return {
          ...result,
          operationId: op.operationId,
          ...(finalOp ? { phase: finalOp.phase, awaitingUser: finalOp.awaitingUser } : {}),
        } as any
      },
    }),

    /* ─── 关闭浏览器工具 ─── */

    defineTool({
      name: 'dsagent_browser_close',
      description: '关闭由 dsagent_browser_login 启动的浏览器窗口。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute() {
        const result = await closeBrowser()
        return result as any
      },
    }),

    /* ─── 授权流程查询 / 续推 / 取消（吸收 Accio 的 managed-auth advance/poll/cancel） ───
     *
     * 登录与风控验证都是「需要用户参与、可能中途停顿、超时后窗口仍开着」的长流程。
     * 改造前它们是一次阻塞调用，中途状态对模型是黑盒；现在各有 operationId，
     * 模型可据此查询进度、续推、取消 —— 而不必重新走一遍登录（会重开浏览器）。
     */

    defineTool({
      name: 'dsagent_auth_status',
      description:
        '查询登录 / 风控验证流程的当前进度（不传 operationId 则列出所有进行中的流程）。'
        + '当 dsagent_browser_login 或 dsagent_risk_verify 返回「等待用户操作」或「等待超时」时，'
        + '用本工具查看当前阶段：是在等用户扫码 / 拖滑块，还是需要补充输入，还是已经完成。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        operationId: { type: 'string', description: '流程 ID（login / risk_verify 返回的 operationId）；省略则列出全部进行中流程' },
        platform: { type: 'string', description: '按平台过滤（仅列出模式下有效）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        if (operationId) {
          const op = authOp.getOperation(operationId)
          if (!op) {
            return { ok: false, error: `未找到授权流程 ${operationId}（可能已过期，请重新发起登录）` } as any
          }
          return { ok: true, text: authOp.describeOperation(op), operation: op } as any
        }
        const platform = String(args.platform ?? '').trim() || undefined
        const list = authOp.listOperations({ platform, liveOnly: false })
        if (!list.length) {
          return { ok: true, text: '当前没有进行中的登录 / 风控验证流程。' } as any
        }
        return {
          ok: true,
          text: list.map(authOp.describeOperation).join('\n\n'),
          operations: list,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_auth_advance',
      description:
        '推进一个已暂停的登录 / 风控验证流程（对应 Accio 的 managed-auth advance）。'
        + '典型用法：① 流程显示「等待超时」但用户其实已经完成了扫码 → action=resume 让它重新检查；'
        + '② 流程要求补充输入 → action=submit 并传 value；'
        + '③ 流程要求在多选项中选一个 → action=choose 并传 value；'
        + '④ action=retry 让它重试一次。',
      parameters: {
        operationId: { type: 'string', required: true, description: '流程 ID（来自 dsagent_browser_login / dsagent_risk_verify / dsagent_auth_status）' },
        action: { type: 'string', required: true, description: '动作：resume（超时后继续检查）/ submit（提交输入）/ choose（选择候选）/ confirm（确认）/ retry（重试）' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        value: { type: 'string', description: 'action=submit / choose 时的值（验证码、候选项 id 等）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        const action = String(args.action ?? '').trim()
        if (!operationId || !action) {
          return { ok: false, error: '缺少 operationId 或 action' } as any
        }
        const res = await authOp.advanceOperation(operationId, {
          action,
          value: String(args.value ?? '') || undefined,
        })
        if (!res.ok) {
          return { ok: false, error: res.error, operation: res.operation } as any
        }
        return {
          ok: true,
          text: res.operation ? authOp.describeOperation(res.operation) : '已推进',
          operation: res.operation,
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_auth_cancel',
      description:
        '取消一个进行中的登录 / 风控验证流程，并关闭其浏览器窗口。'
        + '用于用户明确放弃、或在错误的平台上发起了登录时清理，避免浏览器窗口一直开着占用 Profile 锁。',
      parameters: {
        operationId: { type: 'string', required: true, description: '流程 ID' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const operationId = String(args.operationId ?? '').trim()
        if (!operationId) return { ok: false, error: '缺少 operationId' } as any
        const res = await authOp.cancelOperation(operationId)
        if (!res.ok) return { ok: false, error: res.error, operation: res.operation } as any
        return { ok: true, text: '已取消该授权流程并关闭浏览器窗口。', operation: res.operation } as any
      },
    }),

    /* ─── 网关响应缓存观测（吸收 Accio 本地快照体系的核心目的：不重复打平台）─── */

    defineTool({
      name: 'dsagent_gateway_cache',
      description:
        '查看或清理网关响应缓存。网关会对「参数完全相同的 GET 请求」在短时间内复用上一次的结果，'
        + '从而减少对平台的重复请求（降低风控风险、省掉账号级节流的等待）。'
        + '本工具用于查看缓存命中情况；当怀疑读到的是陈旧数据时可用 action=clear 强制刷新。'
        + '注意：POST（发布/提交类）与失败响应从不进入缓存。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段
        action: { type: 'string', description: 'stats（默认，查看命中率）/ clear（清空全部缓存）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const action = String(args.action ?? 'stats').trim().toLowerCase()
        if (action === 'clear') {
          const n = clearGatewayCache()
          console.log(`[dsagent] 网关缓存已手动清空（${n} 条）`)
          return { ok: true, cleared: n, text: `已清空网关缓存（${n} 条）。后续请求将重新向平台取数。` } as any
        }
        const s = gatewayCacheStats()
        const skipLines = Object.entries(s.skips).length
          ? Object.entries(s.skips).map(([k, v]) => `${k}=${v}`).join('，')
          : '（无）'
        return {
          ok: true,
          ...s,
          text: [
            `网关缓存：${s.enabled ? '已启用' : '已关闭（DSAGENT_GATEWAY_CACHE=off）'}`,
            `条目 ${s.entries}/${s.maxEntries}，TTL ${s.ttlMs / 1000}s`,
            `命中 ${s.hits} / 未命中 ${s.misses}（命中率 ${s.hitRate}），写入 ${s.stores}，LRU 淘汰 ${s.evictions}`,
            `未缓存原因：${skipLines}`,
          ].join('\n'),
        } as any
      },
    }),

    /* ─── 风控验证助手（补上「完成验证」半个动作） ─── */

    defineTool({
      name: 'dsagent_risk_verify',
      description:
        '当平台技能因安全风控失败（failure_kind = risk_control，淘宝表现为 RGV587_ERROR）时调用本工具。'
        + '它会用该平台账号已有 Cookie 弹出一个可见浏览器窗口打开平台验证页，'
        + '用户完成滑块验证后，插件自动提取验证凭证（x5sec 等）写回账号并解除风控冷却；'
        + '随后重新执行刚才失败的技能即可正常获取数据。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao / tmall / xianyu' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        verifyUrl: { type: 'string', description: '验证页地址；省略时自动取该平台最近一次风控返回的入口' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        const explicit = String(args.verifyUrl ?? '').trim()
        const url = explicit || getLastVerifyUrlByPlatform(store, platform)
        if (!url) {
          return {
            ok: false,
            passed: false,
            error: `未找到平台 ${platform} 最近一次风控返回的验证入口。`
              + `请先执行一次失败的技能以触发风控（插件会自动记录入口），再调用本工具。`,
          } as any
        }
        // ★ 与登录一致地登记 operation：风控验证同样是「需要用户拖滑块、可能超时后继续」
        //   的长流程，operation 让模型能 poll 进度、cancel 放弃。
        const op = authOp.startOperation({
          kind: 'risk_verify',
          platform,
          onCancel: async () => { await closeBrowser() },
        })
        const verified = await riskVerify(store, platform, url, undefined, op.operationId)
        const finalOp = authOp.getOperation(op.operationId)
        return {
          ...verified,
          operationId: op.operationId,
          ...(finalOp ? { phase: finalOp.phase, awaitingUser: finalOp.awaitingUser } : {}),
        } as any
      },
    }),

    /* ─── 本地代理出网工具（委托给 gateway-proxy.ts 的 handleProxy） ─── */

    defineTool({
      name: 'dsagent_proxy',
      description: '代替技能向平台发 HTTP 请求，自动从本地凭证库取 Cookie 注入。三种 kind：http_get / http_post / mtop_jsonp。这是技能访问平台的唯一出口。',
      parameters: {
        kind: { type: 'string', required: true, description: '请求类型：http_get / http_post / mtop_jsonp' },
        platform: { type: 'string', required: true, description: '平台 ID，如 taobao' },
        url: { type: 'string', required: true, description: '目标 URL' },
        params: { type: 'string', description: '查询参数 JSON' },
        headers: { type: 'string', description: '额外请求头 JSON' },
        body: { type: 'string', description: 'POST body JSON（http_post 用）' },
        data: { type: 'string', description: 'MTOP API data JSON（mtop_jsonp 用）' },
        extraParams: { type: 'string', description: '额外查询参数 JSON（mtop_jsonp 用）' },
        injectToken: { type: 'boolean', description: '是否自动注入 _tb_token_（默认 true）' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        // 直接委托给 gateway-proxy.ts 的 handleProxy，确保所有代理逻辑统一
        const proxyBody: Record<string, any> = {
          kind: String(args.kind ?? ''),
          platform: String(args.platform ?? ''),
          url: String(args.url ?? ''),
          // 会话 ID：网关据此走「会话绑定」这一级选号
          agent_id: agentIdOf(exec),
          inject_token: args.injectToken !== false,
        }
        // 显式指定账号：网关据此走「显式 shopKey」这一级，避免重新选号
        if (args.account) proxyBody.shop_key = String(args.account).trim()
        // 解析可选 JSON 参数
        try { if (args.params) proxyBody.params = JSON.parse(args.params) } catch { /* 忽略 */ }
        try { if (args.headers) proxyBody.headers = JSON.parse(args.headers) } catch { /* 忽略 */ }
        if (args.body) {
          const bodyStr = String(args.body)
          // 如果以 { 或 [ 开头，尝试 JSON.parse；否则当作 form-urlencoded 字符串
          if (bodyStr.trim().startsWith('{') || bodyStr.trim().startsWith('[')) {
            try { proxyBody.json_body = JSON.parse(bodyStr) } catch { proxyBody.json_body = bodyStr }
          } else {
            proxyBody.json_body = bodyStr
          }
        }
        try { if (args.data) proxyBody.data = JSON.parse(args.data) } catch { /* 忽略 */ }
        try { if (args.extraParams) proxyBody.extra_params = JSON.parse(args.extraParams) } catch { /* 忽略 */ }

        try {
          const result = await handleProxy(proxyBody, store)
          return { ok: result.status === 'success', ...result } as any
        } catch (err) {
          return { ok: false, status: 'error', text: `代理请求失败：${err instanceof Error ? err.message : String(err)}`, failure_kind: 'api_error' } as any
        }
      },
    }),

    /* ─── 手动 Cookie 导入工具 ─── */

    defineTool({
      name: 'dsagent_save_cookie',
      description: '手动导入 Cookie 字符串并存储到本地凭证库。用于用户从浏览器开发者工具复制 Cookie 后导入。',
      parameters: {
        platform: { type: 'string', required: true, description: '平台 ID' },
        cookieStr: { type: 'string', required: true, description: 'Cookie 字符串，如 a=1; b=2' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const platform = String(args.platform ?? '')
        const cookieStr = String(args.cookieStr ?? '')
        if (!platform || !cookieStr) return { ok: false, text: '缺少 platform 或 cookieStr' } as any

        try {
          const jar = parseCookieStr(cookieStr)
          const kc = keyCookies(platform)
          const missing = kc.filter(name => !jar[name])
          if (missing.length > 0) {
            return { ok: false, text: `Cookie 缺少关键字段：${missing.join(', ')}（${platform} 需要）` } as any
          }
          const saved = await store.save(platform, jar)
          return {
            ok: true,
            text: `Cookie 导入成功！账号 ${saved.display_label}（${saved.shop_key}）已保存。`,
            shopKey: saved.shop_key,
          } as any
        } catch (err) {
          return { ok: false, text: `导入失败：${err instanceof Error ? err.message : String(err)}` } as any
        }
      },
    }),

    /* ─── 抖音投稿工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_douyin_publish',
      description: '发布视频到抖音（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动抖音创作服务平台投稿页完成「上传视频 → 填标题/描述 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        videoPath: { type: 'string', required: true, description: '本地视频文件的绝对路径' },
        title: { type: 'string', required: true, description: '作品标题，抖音限 30 字' },
        description: { type: 'string', description: '作品描述/文案（可选），可含 #话题，抖音限 1000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await douyinPublish(store, {
            videoPath: String(args.videoPath ?? ''),
            title: String(args.title ?? ''),
            description: args.description != null ? String(args.description) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `抖音发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 知乎文章发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_zhihu_publish',
      description: '发布文章到知乎专栏（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动知乎写文章编辑器完成「填标题 → 填正文 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        title: { type: 'string', required: true, description: '文章标题，知乎限 100 字' },
        content: { type: 'string', required: true, description: '文章正文纯文本，用 \\n 分段，知乎限 50000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await zhihuPublish(store, {
            title: String(args.title ?? ''),
            content: String(args.content ?? ''),
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `知乎发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── B站投稿工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_bilibili_publish',
      description: '发布视频到 B站（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动 B站创作中心投稿页完成「上传视频 → 填标题/简介/标签/分区/创作声明 → 点立即投稿」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        videoPath: { type: 'string', required: true, description: '本地视频文件的绝对路径' },
        title: { type: 'string', required: true, description: '稿件标题，B站限 80 字' },
        description: { type: 'string', description: '简介（可选），B站限 2000 字' },
        tags: { type: 'string', description: '标签（可选），多个用逗号分隔，B站上限约 10 个、单个 ≤ 20 字' },
        partition: { type: 'string', description: '分区名（可选，如「科技数码」「知识」）。不传则沿用页面自动预选的分区' },
        statement: { type: 'string', description: '创作声明（可选，必填项）。不传则自动选「内容无需标注」' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正投稿' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await bilibiliPublish(store, {
            videoPath: String(args.videoPath ?? ''),
            title: String(args.title ?? ''),
            description: args.description != null ? String(args.description) : '',
            tags: args.tags != null ? String(args.tags) : '',
            partition: args.partition != null ? String(args.partition) : '',
            statement: args.statement != null ? String(args.statement) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `B站发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── B站下载工具（只读平台 + 写本地文件，无真实副作用） ─── */

    defineTool({
      name: 'dsagent_bilibili_download',
      description: '下载 B站 视频/音频到本地（内容下载，无平台副作用）。'
        + '通过 yutto CLI 完成「解析 → 拉流 → ffmpeg 合流 → 落盘」，支持指定清晰度/音质/格式、合集批量、选集、仅音频等。'
        + '★ 大文件不走代理网关，由本工具直接调本地 CLI 子进程完成。',
      parameters: {
        url: { type: 'string', required: true, description: 'B站 视频/番剧/收藏夹链接（支持 b23.tv 短链），如 https://www.bilibili.com/video/BV1xx411c7mD' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        dir: { type: 'string', description: '输出目录（可选）。不传默认 ~/.dsh/downloads/bilibili' },
        quality: { type: 'string', description: '清晰度（可选）。可传数字码（127=8K / 120=4K / 116=1080P60 / 80=1080P / 64=720P / 32=480P / 16=360P）或名称（8K / 4K / 1080P / 720P）' },
        audioQuality: { type: 'string', description: '音质（可选）。数字码（30251=Hi-Res / 30280=320kbps / 30232=128kbps / 30216=64kbps）或名称（320kbps / 128kbps）' },
        outputFormat: { type: 'string', description: '输出容器格式（可选）：infer（默认，按源推断）/ mp4 / mkv / mov' },
        batch: { type: 'boolean', description: '批量下载（可选）。番剧/合集/多 P 视频需要时传 true' },
        episodes: { type: 'string', description: '选集范围（可选）。如 1~-1（全部）、1,3,5、2~6' },
        videoOnly: { type: 'boolean', description: '仅下载视频轨，不要音频（可选）' },
        audioOnly: { type: 'boolean', description: '仅下载音频（可选）' },
        noDanmaku: { type: 'boolean', description: '不下载弹幕（可选）' },
        noSubtitle: { type: 'boolean', description: '不下载字幕（可选）' },
        withMetadata: { type: 'boolean', description: '附带下载元数据 nfo（可选）' },
        saveCover: { type: 'boolean', description: '保存视频封面（可选）' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await bilibiliDownload(store, {
            url: String(args.url ?? ''),
            dir: args.dir != null ? String(args.dir) : '',
            quality: args.quality != null ? String(args.quality) : '',
            audioQuality: args.audioQuality != null ? String(args.audioQuality) : '',
            outputFormat: args.outputFormat != null ? String(args.outputFormat) : '',
            batch: args.batch === true,
            episodes: args.episodes != null ? String(args.episodes) : '',
            videoOnly: args.videoOnly === true,
            audioOnly: args.audioOnly === true,
            noDanmaku: args.noDanmaku === true,
            noSubtitle: args.noSubtitle === true,
            withMetadata: args.withMetadata === true,
            saveCover: args.saveCover === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `B站下载异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 小红书发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_xiaohongshu_publish',
      description: '发布笔记到小红书（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动小红书创作服务平台发布页完成「上传素材（视频或图片）→ 填标题/正文 → 点发布笔记」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        title: { type: 'string', required: true, description: '笔记标题，小红书限 20 字' },
        videoPath: { type: 'string', description: '本地视频文件绝对路径（视频笔记用，与 imagePaths 二选一）' },
        imagePaths: { type: 'string', description: '本地图片文件绝对路径（图文笔记用，与 videoPath 二选一，最多 18 张）。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        content: { type: 'string', description: '笔记正文（可选），可含 #话题，小红书限 1000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // imagePaths 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).imagePaths ?? '').trim()
          let imagePaths: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) imagePaths = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'imagePaths 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              imagePaths = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          const result = await xiaohongshuPublish(store, {
            videoPath: args.videoPath != null ? String(args.videoPath) : '',
            imagePaths,
            title: String(args.title ?? ''),
            content: args.content != null ? String(args.content) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `小红书发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 拼多多采集工具（只读，无平台副作用） ─── */

    defineTool({
      name: 'dsagent_pdd_crawl',
      description: '采集拼多多商品数据（首页推荐流 / 关键词搜索 / 单品详情，只读操作，无副作用）。'
        + '拼多多 H5 业务接口需要页面 JS 生成的 anti_content 签名，纯 HTTP 请求必被拒，'
        + '因此本工具通过 puppeteer 打开拼多多 H5 页面、注入账号 Cookie 取数：'
        + 'feed 走「拦截页面自身发出的 /proxy/api/ 响应」，search 走「解析页面 SSR 内联数据 ssrListData」。'
        + '★ 前提：凭证库中必须已有拼多多账号（未登录访问拼多多会强制跳登录页）。'
        + '★ 取数路径：实测 search / goods 接口有较强账号级频控（常 429 error_code=40002「系统繁忙」），'
        + '而 mode=feed（首页推荐流）稳定可用，用户未指定关键词/商品 ID 时优先用 feed。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        mode: { type: 'string', description: '采集模式（可选）：feed（首页推荐流，推荐，稳定可用）/ search（关键词搜索）/ goods（单品详情）。省略时自动推断：有 goodsId → goods，有 keyword → search，都没有 → feed' },
        keyword: { type: 'string', description: '搜索关键词。mode=search 时必填，如「手机壳」' },
        goodsId: { type: 'string', description: '商品 ID。mode=goods 时必填' },
        limit: { type: 'string', description: '返回条数上限（可选，字符串数字），默认 20，最大 100' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await pddCrawl(store, {
            mode: args.mode != null ? String(args.mode) : '',
            keyword: args.keyword != null ? String(args.keyword) : '',
            goodsId: args.goodsId != null ? String(args.goodsId) : '',
            limit: args.limit != null ? String(args.limit) : '',
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多采集异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 闲鱼发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_xianyu_publish',
      description: '发布商品到闲鱼（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动闲鱼网页版发布页（https://www.goofish.com/publish）完成「上传图片 → 填描述/价格 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 前提：只需绑定**淘宝**账号即可 —— 闲鱼复用阿里 SSO，登录淘宝成功后自动派生闲鱼登录态并同步 goofish 域 Cookie，无需扫码闲鱼 APP。'
        + '若报登录失效（token_expired），引导用户对该淘宝账号执行「重新登录」以重新同步。',
      parameters: {
        description: { type: 'string', required: true, description: '宝贝描述（必填）。闲鱼要求描述必填，且**不能包含 emoji**' },
        price: { type: 'string', required: true, description: '价格（元，字符串数字）。闲鱼要求 0 ~ 1 亿元之间' },
        images: { type: 'string', required: true, description: '本地图片文件绝对路径，至少 1 张、最多 9 张，单张不超过 10MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        title: { type: 'string', description: '宝贝标题（可选）。闲鱼网页版标题多由描述/类目派生，页面有标题框时会一并填入' },
        originalPrice: { type: 'string', description: '原价/入手价（元，字符串数字，可选），需在 1 亿元之内' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // images 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).images ?? '').trim()
          let images: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) images = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'images 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              images = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          const result = await xianyuPublish(store, {
            images,
            description: String(args.description ?? ''),
            title: args.title != null ? String(args.title) : '',
            price: String(args.price ?? ''),
            originalPrice: args.originalPrice != null ? String(args.originalPrice) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `闲鱼发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 淘宝 / 天猫 发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_taobao_publish',
      description: '发布商品到淘宝 / 天猫卖家中心（商品发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动淘宝/天猫网页版发布页完成「上传主图 → 填通用字段 → 提交宝贝信息」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 只自动填通用字段（主图/标题/一口价/库存/货号）；类目属性、商品详情、发货与售后设置不会自动填，'
        + '需用户在弹出窗口内人工补全后提交；发布第一步需选类目，传 categoryKeyword 可自动搜索并选第一个类目，否则需在窗口内人工选。'
        + '★ 淘宝与天猫共用同一套淘宝登录态（账号连接页只需连淘宝）。',
      parameters: {
        title: { type: 'string', required: true, description: '商品标题（必填）。淘宝/天猫要求标题必填且不超过 60 个字符' },
        images: { type: 'string', required: true, description: '本地图片文件绝对路径，至少 1 张、最多 5 张，单张不超过 3MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        channel: { type: 'string', description: '发布渠道（可选）：taobao（淘宝，默认）/ tmall（天猫）。两者共用同一套淘宝登录态' },
        price: { type: 'string', description: '一口价（元，字符串数字，可选）。填则尝试自动填写，正数、1 亿元以内' },
        stock: { type: 'string', description: '库存（件，字符串数字，可选）。填则尝试自动填写，需为非负整数' },
        itemNo: { type: 'string', description: '商家编码/货号（可选）。填则尝试自动填写（天猫发布页有独立输入框）' },
        categoryKeyword: { type: 'string', description: '选类目关键词（可选）。发布入口先落在「选类目」页，填了则自动搜索该关键词并选第一个类目后进入表单；不填需用户在窗口内人工选类目' },
        brand: { type: 'string', description: '品牌（可选）。部分类目（如「AI软件订阅/Token充值」）在选类目页把「品牌」列为必填属性，不填则无法进入表单；填了会优先在品牌下拉里匹配，匹配不到则取列表第一项' },
        model: { type: 'string', description: '型号（可选）。部分类目在选类目页把「型号」列为必填属性，不填则无法进入表单' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // images 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).images ?? '').trim()
          let images: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) images = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'images 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              images = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          const result = await taobaoPublish(store, {
            images,
            title: String(args.title ?? ''),
            channel: args.channel != null ? String(args.channel) : '',
            price: args.price != null ? String(args.price) : '',
            stock: args.stock != null ? String(args.stock) : '',
            itemNo: args.itemNo != null ? String(args.itemNo) : '',
            categoryKeyword: args.categoryKeyword != null ? String(args.categoryKeyword) : '',
            brand: args.brand != null ? String(args.brand) : '',
            model: args.model != null ? String(args.model) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `淘宝发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 拼多多商家后台 发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_pdd_publish',
      description: '发布商品到拼多多商家后台（商品发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动 mms.pinduoduo.com 商家后台走真实两步式链路（商品列表 →「发布新商品」→ 第一步填主图+标题 →'
        + '「下一步」→ 第二步表单填通用字段 →「提交并上架」）。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 类目由平台按发布入口自动推荐带出，本工具不自动选类目。'
        + '★ 自动填通用字段（主图/标题/参考价/库存/货号）+ 详情页图片 + SKU 多规格（规格值/预览图/拼单价，'
        + '单买价自动按「拼单价 + 1」计算）；商品属性尽力自动选（品牌除外）。'
        + '★ 发货与售后设置、运费模板、商品资质不会自动填，需用户在弹出窗口内人工补全后提交。'
        + '★ 拼多多商家后台与拼多多买家账号（dsagent_pdd_crawl 用的那套）是**两套完全独立的登录态**，'
        + '需在账号连接页单独绑定「拼多多商家后台」。',
      parameters: {
        title: { type: 'string', required: true, description: '商品标题（必填）。拼多多要求标题必填且不超过 60 个字符' },
        images: { type: 'string', required: true, description: '本地图片文件绝对路径，至少 1 张、最多 10 张（拼多多主轮播图上限），单张不超过 3MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        detailImages: { type: 'string', description: '商品详情页图片的本地绝对路径（可选），最多 50 张、单张不超过 3MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        skus: { type: 'string', description: 'SKU 多规格（可选），JSON 数组字符串，形如 [{"name":"白色","image":"C:/img/w.jpg","price":"9.9","stock":"1000"}]。name 为规格值名（必填，如「白色」）；image 为该规格的预览图本地绝对路径（平台必填：宽高比 1:1、宽高均 >480px、单张 <3MB、仅 JPG/PNG）；price 为拼单价（元）；stock 为库存。★ 单买价由工具自动按「拼单价 + 1」填写，无需传。★ 用户没给 SKU 就别传本参数' },
        category: { type: 'string', description: '类目关键词或完整路径（可选，如「纸杯」）。★ 实测：拼多多类目由平台按发布入口自动推荐带出，本参数仅作提示，不会自动选类目；如需改类目请在第二步页面点「修改分类」' },
        price: { type: 'string', description: '商品参考价（元，字符串数字，可选）。填则尝试自动填写，正数、1 亿元以内' },
        stock: { type: 'string', description: '库存（件，字符串数字，可选）。需为非负整数；★ 用户没提库存时直接省略本参数，工具会按默认 1000 填' },
        itemNo: { type: 'string', description: '商家编码/货号（可选）。★ 默认不写：用户没给货号就别传本参数' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // images / detailImages 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const parsePaths = (raw: any): string[] | null => {
            const s = String(raw ?? '').trim()
            if (!s) return []
            if (!s.startsWith('[')) return s.split(',').map(p => p.trim()).filter(Boolean)
            try {
              const parsed = JSON.parse(s)
              return Array.isArray(parsed) ? parsed.map(p => String(p ?? '').trim()).filter(Boolean) : []
            } catch {
              return null
            }
          }
          const images = parsePaths((args as any).images)
          if (images === null) {
            return { ok: false, failureKind: 'api_error', text: 'images 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
          }
          const detailImages = parsePaths((args as any).detailImages)
          if (detailImages === null) {
            return { ok: false, failureKind: 'api_error', text: 'detailImages 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\d1.jpg","D:\\\\img\\\\d2.jpg"]），或改用英文逗号分隔。' } as any
          }
          // skus：JSON 数组字符串（也容忍直接传数组），形如 [{"name":"白色","image":"C:/w.jpg","price":"9.9","stock":"1000"}]
          const rawSkusArg: any = (args as any).skus
          let skus: any[] = []
          if (Array.isArray(rawSkusArg)) {
            skus = rawSkusArg
          } else if (String(rawSkusArg ?? '').trim()) {
            try {
              const parsed = JSON.parse(String(rawSkusArg).trim())
              if (!Array.isArray(parsed)) throw new Error('不是数组')
              skus = parsed
            } catch {
              return { ok: false, failureKind: 'api_error', text: 'skus 解析失败，请传 JSON 数组字符串（如 [{"name":"白色","image":"C:/img/w.jpg","price":"9.9","stock":"1000"}]）。' } as any
            }
          }
          const result = await pddPublish(store, {
            images,
            detailImages,
            skus,
            title: String(args.title ?? ''),
            category: args.category != null ? String(args.category) : '',
            price: args.price != null ? String(args.price) : '',
            stock: args.stock != null ? String(args.stock) : '',
            itemNo: args.itemNo != null ? String(args.itemNo) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 闲鱼数据分析工具（只读，无平台副作用） ─── */

    defineTool({
      name: 'dsagent_xianyu_analytics',
      description: '统计闲鱼账号的商品表现数据（曝光/想要/收藏、爆款与滞销排行，只读操作，无副作用）。'
        + '闲鱼账号类接口需要页面 JS 生成的 sign 签名与真实 goofish 会话，纯 HTTP 请求必被拒，'
        + '因此本工具通过 puppeteer 打开闲鱼个人页、注入账号 Cookie、拦截页面自身发出的账号类接口响应取数。'
        + '★ 前提：只需绑定**淘宝**账号即可 —— 闲鱼复用阿里 SSO，登录淘宝成功后自动派生闲鱼登录态并同步 goofish 域 Cookie，无需扫码闲鱼 APP。'
        + '若报登录失效（token_expired），引导用户对该淘宝账号执行「重新登录」以重新同步。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        mode: { type: 'string', description: '分析模式（可选）：overview（账号概况 + 爆款/滞销排行，默认）/ items（全量商品明细）' },
        limit: { type: 'string', description: '返回条数上限（可选，字符串数字），默认 50，最大 100' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await xianyuAnalytics(store, {
            mode: args.mode != null ? String(args.mode) : '',
            limit: args.limit != null ? String(args.limit) : '',
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `闲鱼数据分析异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),
  ]

  /* ─── 技能类工具 ─── */

  tools.push(
    defineTool({
      name: 'dsagent_list_skills',
      description: '列出 DSAgent 插件管理的业务技能。',
      parameters: {
        platform: { type: 'string', description: '可选，按平台过滤' },
        onlyEnabled: { type: 'boolean', description: '可选，仅返回已启用技能' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const rows = await skill.list({ platform: args.platform, onlyEnabled: args.onlyEnabled })
        if (!rows.length) return { text: '没有匹配的业务技能。', count: 0 }
        return {
          text: rows.map(s => {
            const patch = s.hasPatch ? ' [有补丁]' : ''
            const used = s.useCount > 0 ? ` | 用过 ${s.useCount} 次` : ''
            return `- ${s.name}（${s.id}）| ${s.enabled ? '已启用' : '已停用'} | ${s.platform} | 质量 ${s.quality.toFixed(2)}${patch}${used}`
          }).join('\n'),
          count: rows.length,
        }
      },
    }),

    defineTool({
      name: 'dsagent_get_skill_detail',
      description: '查看单个业务技能详情，含文档质量分与校验问题清单。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const s = await skill.get(args.id)
        if (!s) return { text: `未找到技能：${args.id}` }
        const bound = s.platform === 'common' ? true : await account.isBound(s.platform)

        // 质量诊断：把 error（结构性缺陷）与 warn（可改进）分开列，
        // 让模型/用户能直接知道这个技能差在哪、怎么改。
        const errors = s.issues.filter(i => i.severity === 'error')
        const warns = s.issues.filter(i => i.severity === 'warn')
        const qualityLines: string[] = [`文档质量：${s.quality.toFixed(2)} / 1.00`]
        if (errors.length) {
          qualityLines.push(`结构性问题（${errors.length}）：`)
          qualityLines.push(...errors.map(i => `  ✗ ${i.message}`))
        }
        if (warns.length) {
          qualityLines.push(`可改进（${warns.length}）：`)
          qualityLines.push(...warns.map(i => `  • ${i.message}`))
        }
        if (!errors.length && !warns.length) qualityLines.push('文档结构完整，无校验问题。')

        // 现场修正层：patch 存在时给出内容，因为它是「与主文档冲突时以它为准」的部分
        const patchLines: string[] = []
        if (s.hasPatch) {
          const p = await skill.patchOf(s.id)
          patchLines.push('', `现场修正（SKILL.patch.md${p?.truncated ? '，已截断' : ''}）：`, p?.content || '（读取失败）')
        }

        return {
          text: [
            `技能：${s.name}（${s.id}）`,
            `版本：${s.version}　风险：${s.risk}`,
            `状态：${s.enabled ? '已启用' : '已停用'}`,
            `所需平台：${s.platform === 'common' ? '无' : s.platform}`,
            `授权：${bound ? '已授权' : '未授权'}`,
            `使用：${s.useCount > 0 ? `成功 ${s.useCount} 次` : '尚未成功使用过'}`,
            ...qualityLines,
            ...patchLines,
            '', s.description,
          ].join('\n'),
        }
      },
    }),

    defineTool({
      name: 'dsagent_execute_skill',
      description: '执行指定技能并返回结果。',
      parameters: {
        id: { type: 'string', required: true, description: '技能 id' },
        request: { type: 'string', required: true, description: '自然语言描述要做什么' },
        args: { type: 'string', description: '命令行参数（可选）。技能需要参数时必填，如 "手机壳" 或 "--keyword 手机壳 --page 2"' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        console.log(`[dsagent-execute] execute() called with args=${JSON.stringify(args)}`)
        // 当前会话（= 智能体）ID：账号绑定的维度就是它；account 为多账号待选时由模型回传的主键
        return executeSkillCore({
          skillId: String(args.id ?? ''),
          requestStr: String(args.request ?? ''),
          explicitArgs: args.args ? parseArgString(String(args.args)) : undefined,
          chosenShopKey: args.account ? String(args.account).trim() : '',
          agentId: agentIdOf(exec),
          fromContract: false,
          invokedTool: 'dsagent_execute_skill',
        })
      },
    }),

    defineTool({
      name: 'dsagent_generate_report',
      description: '基于 AI 洞察 Markdown 文件生成 HTML 报告。',
      parameters: {
        skillId: { type: 'string', required: true, description: '技能 id' },
        insightsMdPath: { type: 'string', required: true, description: '洞察 Markdown 文件路径' },
        seedKeyword: { type: 'string', description: '种子关键词，可选' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        const skillId = String(args.skillId ?? '')
        const insightsMdPath = String(args.insightsMdPath ?? '')
        const seedKeyword = args.seedKeyword ? String(args.seedKeyword) : undefined

        const supports = await skill.supportsReport(skillId)
        if (!supports) return { ok: false, text: `技能「${skillId}」不支持报告生成。`, skillId } as any

        const gw = await gatewayReady
        const env: Record<string, string> = {
          DSAGENT_WORKSPACE: process.env.DSAGENT_WORKSPACE ?? process.cwd(),
          DSAGENT_SKILL_ROOT: cfg.skillRoot,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          DSCONNECT_URL: gw.url,
          DSCONNECT_TOKEN: 'local',
          DSCONNECT_AGENT_ID: agentIdOf(exec),
        }

        const result = await skill.runReport(skillId, insightsMdPath, { seedKeyword }, env)
        if (!result.ok) {
          return { ok: false, text: `报告生成失败：${result.message || result.stderr || '未知错误'}`, exitCode: result.exitCode, skillId } as any
        }

        const textParts: string[] = ['报告生成成功！']
        if (result.reportPath) textParts.push(`\n\n📊 HTML 报告：${result.reportPath}`)
        if (result.csvPath) textParts.push(`\n📎 CSV：${result.csvPath}`)

        return { ok: true, text: textParts.join(''), exitCode: result.exitCode, skillId, reportPath: result.reportPath ?? null, csvPath: result.csvPath ?? null } as any
      },
    }),

    defineTool({
      name: 'dsagent_wiki_schema',
      description: '查看商家知识 Wiki 的八域本体 Schema（商品/店铺/客户/经营/平台/资产/接待/概念）。'
        + '不传 domain 返回八域路由表；传 domain 返回该域完整字段定义（含必抓标记与披露等级）。',
      parameters: {
        domain: { type: 'string', description: '可选，域中文名（商品/店铺/客户/经营/平台/资产/接待/概念）。不传则返回八域路由表' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const domain = args.domain ? String(args.domain).trim() : ''
        if (!domain) {
          return {
            text: [
              '商家知识 Wiki 八域本体（移植自 Accio merchant-wiki-compiler）。',
              '',
              '【总原则】实时数据不入 wiki —— 平台能直接导出的价格/库存/当日流量走实时工具；',
              'wiki 只存对这些数据的理解、口径与策略。',
              '',
              domainRoutingTable(),
              '',
              `受控接待意图（8 个，封闭词表）：${RECEPTION_INTENTS.map(i => i.label).join('、')}`,
              '',
              '用 dsagent_wiki_schema(domain="商品") 查看某域的完整字段定义。',
            ].join('\n'),
          }
        }
        const d = getDomain(domain)
        if (!d) return { text: `未知领域「${domain}」。可选：${DOMAIN_NAMES.join('、')}` }
        return { text: describeDomain(domain) }
      },
    }),

    defineTool({
      name: 'dsagent_wiki_template',
      description: '生成指定域的 Wiki 页面「锁定模板」。'
        + '★ 硬规则：frontmatter 必须经本工具生成，模型只替换模板中的 null 为有依据的值，'
        + '不得增加、删除、改名或移动任何 key，再用 dsagent_wiki_write 渲染写入。',
      parameters: {
        domain: { type: 'string', required: true, description: '域中文名（商品/店铺/客户/经营/平台/资产/接待/概念）' },
        kind: { type: 'string', description: '页面形态（可选）：实体（默认）/ 概念' },
        subtype: { type: 'string', description: '实体子类型（可选）。经营/平台/资产/接待/概念五域必填，取值须落在该域枚举内；商品/店铺/客户为单一形态域，不要传' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const domain = String(args.domain ?? '').trim()
        const kindRaw = String(args.kind ?? '实体').trim()
        const kind = kindRaw === '概念' ? '概念' : '实体'
        const subtype = args.subtype ? String(args.subtype).trim() : undefined
        try {
          const tpl = buildTemplate(domain, kind, subtype)
          return {
            text: [
              templateGuide(tpl),
              '',
              '## 空白模板（复制后只改值）',
              '```yaml',
              templateToYaml(tpl),
              '```',
              '',
              '填好后调用 dsagent_wiki_write(domain, kind, title, frontmatterYaml, body) 写入。',
            ].join('\n'),
          }
        } catch (e) {
          return { ok: false, text: `生成模板失败：${e instanceof Error ? e.message : String(e)}` }
        }
      },
    }),

    defineTool({
      name: 'dsagent_wiki_write',
      description: '校验并写入一个 Wiki 页面（action=write，默认），或删除一个页面（action=delete）。'
        + '写入时 frontmatter 必须来自 dsagent_wiki_template 的锁定模板（只填值、不改 key），正文写在 body 参数里；'
        + '校验不过会拒绝写入并列出问题。删除时只需给 path。',
      parameters: {
        action: { type: 'string', description: '可选：write（默认，写入）/ delete（删除页面，删除时只认 path）' },
        path: { type: 'string', description: '要删除的页面相对路径（action=delete 时必填，如「商品/entities/xxx.md」）' },
        domain: { type: 'string', description: '域中文名（action=write 时必填）' },
        kind: { type: 'string', description: '页面形态（可选）：实体（默认）/ 概念' },
        title: { type: 'string', description: '页面标题，将作为文件名（action=write 时必填，须与正文 H1 一致）' },
        frontmatterYaml: { type: 'string', description: '填充后的 frontmatter 内容（action=write 时必填，不含首尾 --- 行），须与模板 key 完全一致' },
        body: { type: 'string', description: '正文 Markdown（可选，建议以 # 标题 开头）' },
        force: { type: 'boolean', description: '校验不通过时是否强制写入（默认 false；强制会记日志）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const action = String(args.action ?? 'write').trim().toLowerCase()

        // ── 删除分支：只认 path，不做 frontmatter 校验 ──
        if (action === 'delete') {
          const p = String(args.path ?? '').trim()
          if (!p) return { ok: false, text: 'action=delete 时必须提供 path（如「商品/entities/xxx.md」）' }
          const del = await wiki.deletePage(p)
          if (!del.ok) {
            return {
              ok: false,
              text: [`页面未删除：${del.error}`, '', '用 dsagent_wiki_search 确认正确的页面路径。'].join('\n'),
            } as any
          }
          return {
            ok: true,
            text: `页面已删除：${del.path}\nINDEX.md 已同步刷新（不会留死链）。`,
            path: del.path,
          } as any
        }

        const domain = String(args.domain ?? '').trim()
        const kind = String(args.kind ?? '实体').trim() === '概念' ? '概念' : '实体'
        const title = String(args.title ?? '').trim()
        const fmYaml = String(args.frontmatterYaml ?? '').trim()
        const body = String(args.body ?? '').trim() || `# ${title}\n`
        if (!getDomain(domain)) return { ok: false, text: `未知领域「${domain}」。可选：${DOMAIN_NAMES.join('、')}` }
        if (!title) return { ok: false, text: 'title 必填' }
        if (!fmYaml) return { ok: false, text: 'frontmatterYaml 必填 —— 请先用 dsagent_wiki_template 生成锁定模板' }

        const content = `---\n${fmYaml}\n---\n\n${body}\n`
        const res = await wiki.savePage({ domain, kind, title, content, force: args.force === true })
        if (!res.ok) {
          return {
            ok: false,
            text: [`页面未写入：${res.error}`, '', '修正后重新调用本工具。', '', `提示：用 dsagent_wiki_template(domain="${domain}") 重新取模板，确保 key 与 Schema 完全一致。`].join('\n'),
            issues: res.issues ?? [],
          } as any
        }
        // 索引随写入自动刷新，保证 INDEX.md 的链接始终可达（Accio 验收项 1）
        await wiki.buildIndex()
        return {
          ok: true,
          text: `页面已写入：${res.path}\nINDEX.md 已同步刷新。`,
          path: res.path,
          issues: res.issues ?? [],
        } as any
      },
    }),

    defineTool({
      name: 'dsagent_wiki_search',
      description: '检索商家知识 Wiki：列出全部页面（可按域 / 形态过滤），或读取指定页面全文。',
      parameters: {
        domain: { type: 'string', description: '可选，按域过滤' },
        kind: { type: 'string', description: '可选，按形态过滤：实体 / 概念' },
        path: { type: 'string', description: '可选，传入页面相对路径则返回该页全文' },
        keyword: { type: 'string', description: '可选，按标题/描述关键词过滤' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        const pathArg = args.path ? String(args.path).trim() : ''
        if (pathArg) {
          const r = await wiki.readPage(pathArg)
          if (!r.ok) return { ok: false, text: `读取失败：${r.error}` }
          return { text: r.content ?? '', path: pathArg }
        }
        const kindArg = args.kind ? String(args.kind).trim() : ''
        const kind = kindArg === '实体' || kindArg === '概念' ? kindArg : undefined
        const domainArg = args.domain ? String(args.domain).trim() : ''
        const kw = args.keyword ? String(args.keyword).trim() : ''
        let entries = await wiki.listEntries({ domain: domainArg || undefined, kind })
        if (kw) entries = entries.filter(e => e.title.includes(kw) || e.description.includes(kw))
        if (!entries.length) {
          const st = await wiki.stats()
          return {
            text: st.total === 0
              ? `Wiki 暂无页面（根目录：${wiki.root}）。用 dsagent_wiki_schema 了解八域，再用 dsagent_wiki_template + dsagent_wiki_write 写入。`
              : '没有匹配的页面。',
            count: 0,
            root: wiki.root,
          }
        }
        return {
          text: entries.map(e =>
            `- [${e.domain}/${e.kind}] ${e.title}\n  path=${e.path}\n  ${e.description || '(无描述)'}${e.disclosure ? `　披露=${e.disclosure}` : ''}`,
          ).join('\n'),
          count: entries.length,
          root: wiki.root,
        }
      },
    }),

    defineTool({
      name: 'dsagent_wiki_stats',
      description: '商家知识 Wiki 概览：总页数、各域分布、实体/概念占比、有校验问题的页面数，并重建 INDEX.md。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute() {
        await wiki.init()
        const st = await wiki.stats()
        const idx = await wiki.buildIndex()
        if (!st.total) {
          return {
            text: [
              `Wiki 根目录：${wiki.root}`,
              '暂无页面。',
              '',
              '入门：dsagent_wiki_schema → 了解八域边界；',
              'dsagent_wiki_template(domain="商品") → 取锁定模板；',
              'dsagent_wiki_write(...) → 校验并写入。',
            ].join('\n'),
            ...st,
          }
        }
        return {
          text: [
            `Wiki 根目录：${wiki.root}`,
            `总页数：${st.total}（实体 ${st.entities} / 概念 ${st.concepts}）`,
            `有校验问题：${st.invalid}`,
            '',
            '各域分布：',
            ...DOMAIN_NAMES.map(d => `  ${d}：${st.byDomain[d] ?? 0}`),
            '',
            `INDEX.md 已重建：${idx.path}`,
          ].join('\n'),
          ...st,
        }
      },
    }),

    defineTool({
      name: 'dsagent_pitfalls',
      description: '查看本机累积的「平台坑位记忆」：从真实执行失败中统计出的可复现问题'
        + '（证据 ≥3 次才计入），可导出草稿供人工审核后沉淀到 SKILL.patch.md。',
      parameters: {
        skillId: { type: 'string', description: '可选，只看该技能相关的坑位' },
        platform: { type: 'string', description: '可选，只看该平台的坑位（如 taobao / pdd_mms）' },
        mode: { type: 'string', description: '可选：summary（默认，概览）/ all（全部记录）/ draft（导出可粘贴的草稿）' },
        clear: { type: 'boolean', description: '可选，清空全部坑位记录（谨慎使用）' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        if (args.clear === true) {
          await pitfalls.clear()
          return { ok: true, text: '坑位记忆已清空。' }
        }
        const mode = String(args.mode ?? 'summary').trim()
        const skillId = args.skillId ? String(args.skillId).trim() : undefined
        const platform = args.platform ? String(args.platform).trim() : undefined

        if (mode === 'all') {
          const all = await pitfalls.list()
          if (!all.length) return { text: '暂无坑位记录。', count: 0 }
          return {
            text: all.map(e =>
              `- [${e.confirmed ? '已确认' : '观察中'}] ${e.platform} / ${e.failureKind}　复现 ${e.count} 次\n`
              + `  签名：${e.signature || '(无)'}\n`
              + `  最近：${new Date(e.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ')}　涉及：${e.skillIds.join('、') || '—'}`,
            ).join('\n'),
            count: all.length,
          }
        }

        if (mode === 'draft') {
          const entries = skillId
            ? (await pitfalls.list()).filter(e => e.skillIds.includes(skillId) && e.confirmed)
            : await pitfalls.listConfirmed()
          return {
            text: exportPitfallDraft(entries, skillId ? { skillId } : undefined),
            count: entries.length,
            hint: '审核后可直接粘贴到对应技能的 SKILL.patch.md。',
          }
        }

        // summary：默认只给「当前有效」的坑位（已确认 + 未陈旧）
        const active = await pitfalls.activeFor({ skillId, platform })
        const st = await pitfalls.stats()
        if (!active.length) {
          return {
            text: [
              '当前没有达到阈值的活跃坑位。',
              '',
              `统计：共 ${st.total} 条记录，其中已确认 ${st.confirmed} 条，已陈旧（>${PITFALL.STALE_DAYS} 天未复现）${st.stale} 条。`,
              '',
              `坑位在技能失败时自动累积，同一问题复现 ${PITFALL.PROMOTE_THRESHOLD} 次后才会进入提示。`,
              '用 mode=all 查看全部记录（含观察中的），用 mode=draft 导出可粘贴的草稿。',
            ].join('\n'),
            ...st,
          }
        }
        return {
          text: [
            `活跃坑位 ${active.length} 条（已确认 + ${PITFALL.STALE_DAYS} 天内复现过）：`,
            '',
            ...active.map(e =>
              `- [${e.platform} / ${e.failureKind}] 复现 ${e.count} 次，最近 ${new Date(e.lastSeenAt).toISOString().slice(0, 10)}\n`
              + `  ${e.signature || '(无签名)'}`,
            ),
            '',
            `总计 ${st.total} 条记录 / 已确认 ${st.confirmed} 条。用 mode=draft 导出草稿沉淀到 SKILL.patch.md。`,
          ].join('\n'),
          active,
          ...st,
        }
      },
    }),

    defineTool({
      name: 'dsagent_list_platforms',
      description: '列出支持连接的平台及授权状态。',
      parameters: {},
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute() {
        const rows = await account.list()
        const platforms: Array<[string, string]> = [
          ['taobao', '淘宝'], ['douyin', '抖音'], ['xiaohongshu', '小红书'],
          ['bilibili', 'B站'], ['kuaishou', '快手'], ['wechat_mp', '微信公众号'],
          ['pinduoduo', '拼多多'], ['pdd_mms', '拼多多商家后台'],
          ['xianyu', '闲鱼'], ['wechat_store', '微信小店'],
          ['zhihu', '知乎'],
        ]
        return {
          text: platforms.map(([pid, label]) => {
            const hit = rows.find(r => r.platformId === pid)
            const state = !hit ? '未连接' : hit.status === 'valid' ? `已连接（${hit.nickname}）` : `异常（${hit.status}）`
            return `- ${label}（${pid}）：${state}`
          }).join('\n'),
        }
      },
    }),

    defineTool({
      name: 'dsagent_chat_with_context',
      description: '基于技能执行结果生成自然语言回复。',
      parameters: {
        skillResult: { type: 'string', required: true, description: '技能返回结果' },
        userQuestion: { type: 'string', required: true, description: '用户的问题' },
        style: { type: 'string', description: '回复风格：brief/detailed/report' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args) {
        let data: unknown
        try { data = JSON.parse(args.skillResult) } catch { data = args.skillResult }
        const style = args.style ?? 'brief'
        const styleGuide = style === 'report' ? '请以结构化报告格式输出。' : style === 'detailed' ? '请详细分析数据。' : '请简洁直接回答。'
        const dataSummary = typeof data === 'object' && data !== null ? JSON.stringify(data, null, 2).slice(0, 4000) : String(data).slice(0, 4000)
        return { text: `用户问题：${args.userQuestion}\n\n技能数据：\n${dataSummary}\n\n回复要求：${styleGuide}`, style, hasData: data !== null && data !== '' }
      },
    }),
  )

  /* ─── 批量注册工具 ─── */

  ctx.effect(() => {
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const d of disposers) d() }
  }, 'dsagent: tools')

  /* ─── 按契约注册「每技能独立工具」（真 MCP 式：一技能一工具一参数表）─── */

  // 有 contract.json 的技能直接以独立工具暴露给模型，参数表由契约生成，
  // 对齐原项目「每个技能一个 function tool」的形态；无契约的技能不受影响，
  // 仍走 dsagent_execute_skill 单工具 + 正则回退路径。
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    let disposed = false
    void (async () => {
      let rows: SkillRow[] = []
      try {
        rows = await skill.list({ onlyEnabled: true })
      } catch (e) {
        console.warn('[dsagent] 契约工具注册：列出技能失败', e)
        return
      }
      if (disposed) return
      const taken = new Set(tools.map(t => t.name))
      let registered = 0
      for (const row of rows) {
        if (!row.dir) continue
        const contract = loadContract(row.dir)
        if (!contract) continue
        // 契约没给出任何输入（args 与 subcommands 都空）时不注册：参数表为空的独立工具
        // 对模型是纯噪声。生成器已按此口径产出契约，这里兜住手写/过期契约的情况，
        // 让这类技能继续留在 dsagent_execute_skill + 系统提示词清单那条路径上。
        if (!contract.input?.args?.length && !contract.input?.subcommands?.length) continue
        // 与既有工具（含 17 个平台专用工具）重名时跳过：既有工具优先
        if (taken.has(contractToolName(row.id))) continue
        const tool = buildContractTool(row, contract)
        if (!tool) continue
        taken.add(tool.name)
        disposers.push(ctx.tools.register(tool))
        registered += 1
      }
      console.log(`[dsagent] 契约工具注册完成：${registered} 个技能已暴露为独立工具`)
    })()
    return () => { disposed = true; for (const d of disposers) d() }
  }, 'dsagent: contract-tools')

  /* ─── 定时巡检（吸收 QIWork 定时健康检查）─── */

  ctx.effect(() => {
    // 启动后 30s 执行首次巡检，之后每 2h 巡检一次
    const doCheck = async () => {
      // ★ 启动期凭证库健康检查（吸收 Accio 的 StartupStorageHealth）：
      //   扫一遍凭证库，发现自愈迁移管不到的异常（Cookie 缺失/状态矛盾/绑定孤立），
      //   记日志让用户知道 —— 不是等用户跑技能时才撞上。
      try {
        store.healthCheck()
      } catch { /* 健康检查本身不应阻断巡检 */ }
      // 阿里系 SSO：淘宝账号存在时自动派生闲鱼账号，避免用户重复扫码
      await ensureXianyuFromTaobao(store)
      // 生意参谋系：补齐 csrfId/loginPointId（万相台、达摩盘技能依赖）
      await ensureAlimamaTokens(store)
      try {
        const results = await account.checkHealthReal()
        // reauth_required 也算「失效」——它表示连续探测失败已达阈值，必须重登。
        // 漏掉它会让巡检对这批发不报警（问题只能等用户撞上）。
        const bad = results.filter(r =>
          r.status === 'expired' || r.status === 'invalid' || r.status === 'reauth_required')
        if (bad.length) {
          const needReauth = bad.filter(r => r.status === 'reauth_required')
          console.warn(
            `[dsagent] 巡检发现 ${bad.length} 个账号失效: ${bad.map(r => r.platformId).join(', ')}` +
            (needReauth.length ? `（其中 ${needReauth.length} 个必须重新登录）` : ''),
          )
        }
      } catch { /* 忽略 */ }
    }

    const startupTimer = setTimeout(doCheck, 30_000)
    const intervalTimer = setInterval(doCheck, 2 * 60 * 60 * 1000)
    // 启动即派生一次，避免等 30s 才能跑闲鱼技能
    void ensureXianyuFromTaobao(store)
    // 启动即补齐阿里妈妈 token，避免等 30s 才能跑万相台/达摩盘技能
    void ensureAlimamaTokens(store)
    return () => { clearTimeout(startupTimer); clearInterval(intervalTimer) }
  }, 'dsagent: health-check')

  /* ─── 卸载清理 ─── */

  ctx.effect(() => () => {
    account.dispose()
    skill.dispose()
    closeBrowser().catch(() => {})
  })
}
