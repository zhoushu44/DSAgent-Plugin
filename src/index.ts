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
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createAccountService } from './services/account-service.js'
import { createSkillService, detectEntry, extractUsage, renderSkillDirHint, type SkillRow } from './services/skill-service.js'
import { createToolTriggerRegistry, type TriggerSourceSkill } from './services/tool-triggers.js'
import { createWikiStore } from './services/wiki-store.js'
import { createPitfallMemory, renderPitfallHint, isRecordableFailure, PITFALL } from './services/pitfall-memory.js'
import { loadContract, contractToolName, contractToolParameters, buildContractArgv, type SkillContract } from './services/arguments.js'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CredentialStore, parseCookieStr, keyCookies, resolveDisplayNick, loginOwnerPlatform, planCascadeDisconnect } from './services/credential-store.js'
import { doBrowserLogin, closeBrowser, ensureXianyuFromTaobao, riskVerify, removeAccountProfile } from './browser-login.js'
import { startGatewayProxy, ensureAlimamaTokens, getLastVerifyUrlByPlatform, probeRemoteSession } from './gateway-proxy.js'
import { registerHttpRoutes } from './http-routes.js'
import { requiredPlatform, guidedPlatform, guidedPlatformExtra } from './bindings.js'
import { buildSystemPromptText } from './prompt.js'
import { createWorkflowService } from './workflow/service.js'
import { registerWorkflowApi, buildWorkflowTool } from './workflow/api.js'
import { createWorkflowScheduler } from './workflow/scheduler.js'
import { runKeepaliveSweep } from './services/session-keepalive.js'
import { defineTool, renderToolOutput, agentIdOf, spillPayload } from './tool-runtime.js'
import { buildPlatformTools } from './tools-platform.js'
import { buildPublishTools } from './tools-publish.js'
import { zhihuPublish } from './zhihu-publish.js'
import { douyinPublish } from './douyin-publish.js'
import { bilibiliPublish } from './bilibili-publish.js'
import { xiaohongshuPublish } from './xiaohongshu-publish.js'
import { xianyuPublish } from './xianyu-publish.js'
import { taobaoPublish } from './taobao-publish.js'
import { mqsPublish } from './mqs-publish.js'
import { pddPublish2 } from './pdd-publish2.js'
import { dispatchPlatformPublish, type PlatformPublishHandlers } from './platform-publish.js'
import { buildSkillTools } from './tools-skill.js'
import { buildWikiTools } from './tools-wiki.js'
import * as nodePath from 'node:path'
import * as nodeOs from 'node:os'

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
 * 查 GitHub latest Release，解析出远端 commit 与版本号。
 *
 * ★ 为什么不直接调 api.github.com：
 *   匿名调 api.github.com 每小时仅 60 次，用户多点几下就 403（实测 IP 已被限流）。
 *   改抓 Release 页 HTML（github.com/.../releases/tag/latest）—— 不走 API、无限流。
 *
 * ★ 怎么从页面拿版本（按优先级）：
 *   1) Release 标题/tag 本身：页面有 "DSAgent vX.Y" 标题（CI 以 tag 为 Release 标题）。
 *      版本号纪律是「版本跟着 tag 走」，tag 就是最权威的版本。
 *   2) Release body 里的 "package.json x.y.z"（旧版说明格式，向后兼容）。
 *   3) 都没有 → 留空，UI 仍可用 commit 比对。
 *   4) 远端 commit：页面里指向本次提交的链接，href 含 /commit/<40位sha>，取 7 位短 sha。
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

    // 版本号优先级 1：Release 标题「DSAgent X.Y」/「DSAgent vX.Y」（tag 即版本）
    let version = ''
    const tm = html.match(/DSAgent\s+v?(\d+(?:\.\d+)+)/)
    if (tm) version = tm[1]

    // 版本号优先级 2：Release body 里 "package.json x.y.z"（兼容旧格式）
    if (!version) {
      const vm = html.match(/package\.json[^\d]{0,4}(\d+\.\d+\.\d+)/)
      if (vm) version = vm[1]
    }

    return { version, commit, ok: true }
  } catch (e: any) {
    return { version: '', commit: '', ok: false, error: e?.message || String(e) }
  }
}

/**
 * 是否有更新：本地 commit 与远端不同（且本地有 commit），或本地 version 与远端不同。
 * ★ 版本号按 tag 走（如 6.0.0），而 Release 标题可能是 6.0（无第三位）——
 *   比较时按「主.次」对齐，避免 6.0 vs 6.0.0 误报有更新。
 */
function hasUpdate(local: { version: string; commit: string }, remote: { version: string; commit: string }): boolean {
  if (local.commit && remote.commit) return local.commit !== remote.commit
  if (local.version && remote.version) {
    const norm = (v: string) => {
      const m = v.match(/^(\d+)\.(\d+)/)
      return m ? `${m[1]}.${m[2]}` : v
    }
    return norm(local.version) !== norm(remote.version)
  }
  return false
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
 * 需要绑定账号的技能 → 平台映射已抽出至 bindings.ts（单一真源，
 * dev/preview-server.ts 的真实执行链路也要用同一份规则）。
 */

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
  // 技能根目录：cordis.yml 未配置时回退到插件根下的 skills/
  const skillRoot = cfg.skillRoot || nodePath.join(PLUGIN_ROOT, 'skills')
  const skill = createSkillService(skillRoot, { statsPath })
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

  /* ─────────────── 工作流服务（模板/任务/引擎/浏览器锁） ─────────────── */
  const workflowDir = nodePath.join(skillRoot, 'workflows')
  const workflowTasksPath = nodePath.join(nodePath.dirname(storePath), 'workflow-tasks.json')
  const workflowService = createWorkflowService({
    skill,
    executeSkill: (opts) => executeSkillCore(opts),
    workflowDir,
    tasksPath: workflowTasksPath,
  })
  // ★ 定期执行调度器（读模板里的 schedule 配置，到点自动跑）
  const workflowScheduler = createWorkflowScheduler({
    workflowService,
    workflowDir,
    log: (msg: string) => { try { console.error(msg) } catch { /* ignore */ } },
  })
  const workflowApi = registerWorkflowApi({ service: workflowService, scheduler: workflowScheduler })

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
  // 全部 action 已迁往 src/http-routes.ts（依赖注入，仿 workflow/api.ts 模式）；
  // 可变状态经回调注入：set_skill_enabled 后置 triggersBuiltAt = 0 在此接线。
  registerHttpRoutes({
    ctx,
    store,
    skill,
    pitfalls,
    triggers,
    workflowApi,
    doBrowserLogin,
    closeBrowser,
    riskVerify,
    removeAccountProfile,
    getLastVerifyUrlByPlatform,
    probeRemoteSession,
    parseCookieStr,
    resolveDisplayNick,
    loginOwnerPlatform,
    planCascadeDisconnect,
    readLocalVersion,
    fetchRemoteVersion,
    hasUpdate,
    updateRepo: UPDATE_REPO,
    onTriggersInvalidated: () => { triggersBuiltAt = 0 },
    // 平台发布：暴露给脚本型薄壳（skills/*-publish/scripts/publish.py），
    // 使「取数 → 成文 → 发布」能整条编排进工作流。confirm 门禁仍在各平台实现内。
    // ★ attrModel 不在此注入：HTTP 路径没有会话 LLM 路由上下文，
    //   类目属性自动选值退化为「缓存兜底」，属预期行为（不会误填）。
    publishPlatform: async (body) => {
      const handlers: PlatformPublishHandlers = {
        zhihu: (o) => zhihuPublish(store, o),
        douyin: (o) => douyinPublish(store, o),
        bilibili: (o) => bilibiliPublish(store, o),
        xiaohongshu: (o) => xiaohongshuPublish(store, o),
        xianyu: (o) => xianyuPublish(store, o),
        taobao: (o) => taobaoPublish(store, o),
        mqs: (channel, o) => mqsPublish(store, channel, o),
        taobaoMqs: (o) => taobaoPublish(store, o),
        pdd2: (o) => pddPublish2(store, o),
      }
      return dispatchPlatformPublish(handlers, body)
    },
  })

  /* ─────────────── 1. 系统提示词 ─────────────── */

  ctx.effect(() => {
    // 扫描技能清单，拼进系统提示词——这是模型触发技能调用的唯一入口
    const catalog = scanSkillCatalog()
    // 启动时构建一次工具触发注册表（异步，不阻塞提示词注入；
    // 首次工具调用若早于构建完成，executeSkillCore 里会按 TTL 再补建一次）
    void rebuildTriggers()

    const dispose = ctx.systemPrompt.section({
      name: 'dsagent-tools',
      order: 50,
      // 提示词文本（动态清单 + 静态文案）已迁往 src/prompt.ts
      text: buildSystemPromptText(catalog),
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

    // ★ 优先展示 payload.text（技能自带的「人类可读结论」/一屏总结/表格），
    //   整包 JSON 放到后面。否则工作流日志只保留 JSON 前半段，
    //   真正的结论（如「待执行/受控/不动」表格）被挤没。
    //   指令型技能（mode=instructions）必须原样直传，不适用。
    let readableText = ""
    {
      // payload 可能是对象，也可能是 JSON 字符串（脚本 stdout 直出），两种都试
      let pj: Record<string, unknown> | null = null
      if (result.payload) {
        if (typeof result.payload === "object") pj = result.payload as Record<string, unknown>
        else if (typeof result.payload === "string") {
          try { pj = JSON.parse(result.payload) as Record<string, unknown> } catch { pj = null }
        }
      }
      if (!isInstructions && pj) {
        const pt = pj.text
        if (typeof pt === "string" && pt.trim()) readableText = pt
      }
    }
    const textParts: string[] = readableText
      ? [`技能「${skillId}」执行成功。\n\n${readableText}\n\n---\n数据（JSON）：\n${payloadStr}`]
      : [`技能「${skillId}」执行成功。\n\n${payloadStr}`]
    if (reportPath) textParts.push(`\n\n📊 HTML 报告已生成：${reportPath}`)
    if (csvPath) textParts.push(`\n📎 CSV：${csvPath}`)
    if (supportsReport && !reportPath) textParts.push(`\n\n💡 该技能支持生成 HTML 报告，请基于数据撰写洞察后调用 dsagent_generate_report。`)
    // 技能目录 + 资源清单：数据层为空/结果异常时，模型据此读技能自带 references/ 排查
    textParts.push(`\n\n${skillDirHint}`)
    // 工具触发提示：相关技能 + 内置风控预提示
    if (triggerHint) textParts.push(`\n\n${triggerHint}`)

    return { ok: true, text: textParts.join(''), exitCode: result.exitCode, skillId, message: result.message, reportPath: reportPath ?? null, csvPath: csvPath ?? null, supportsReport, payload: result.payload ?? null } as any
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
    // 工具定义已按域拆分（工具本体在各 tools-*.ts，服务经依赖注入接线）：
    //   tools-platform.ts  13 个：账号 / 浏览器登录 / 授权流程 / 风控 / 代理 / Cookie 导入 / 平台清单
    //   tools-publish.ts   10 个：各平台内容发布 / 采集 / 下载
    //   tools-skill.ts      6 个：技能清单 / 详情 / 执行 / 报告 / 坑位记忆 / 对话
    //   tools-wiki.ts       5 个：商家知识 Wiki 的 schema / 模板 / 写入 / 搜索 / 统计
    ...buildPlatformTools({
      account,
      store,
      doBrowserLogin,
      closeBrowser,
      riskVerify,
      parseCookieStr,
      keyCookies,
      loginOwnerPlatform,
    }),
    ...buildPublishTools({
      store,
      // 宿主 LLM 服务（`ctx.llm`）：供拼多多发布的「商品属性」自动选值调用
      // 本会话正在用的聊天模型。此处传**惰性解析函数**——服务可能晚于本插件注册，
      // 且宿主测试桩不提供该服务，故不在 inject 里硬依赖，取不到时属性区自动降级。
      getLlm: () => {
        const get = (ctx as any).get
        const svc = typeof get === 'function'
          ? (get.call(ctx, 'llm') ?? get.call(ctx, 'llm', false))
          : (ctx as any).llm
        return typeof svc?.stream === 'function' ? svc : undefined
      },
    }),
    ...buildSkillTools({
      skill,
      account,
      pitfalls,
      executeSkillCore,
      gatewayReady,
      // ★ 与原 executeSkillCore 内 DSAGENT_SKILL_ROOT 的取值保持一致：
      //   用原始配置值（可能为 ''），不是 apply() 内解析后的 skillRoot 局部变量
      skillRoot: cfg.skillRoot,
    }),
    ...buildWikiTools({ wiki }),
  ]


  /* ─── 工作流工具（模型对话入口：list/get/create/update/delete/run/stop/tasks）─── */
  tools.push(
    defineTool(
      buildWorkflowTool({
        service: workflowService,
        render: renderToolOutput,
      }),
    ),
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
      // 工作流任务重启对账：把上次中断的 running 任务恢复为 failed
      try {
        await workflowService.reconcile()
      }
      catch { /* 对账失败不阻断巡检 */ }
      // ★ 启动定期执行调度器
      try {
        workflowScheduler.start()
      }
      catch (e) {
        console.error('[schedule] 调度器启动失败：' + (e instanceof Error ? e.message : String(e)))
      }

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

      // ★ P0-3 会话保活：巡检触发轻访问续期（runKeepaliveSweep 内部按
      //   last_keepalive_at 跳过未到期账号，且整体永不抛错，不会阻断巡检）。
      //   放在 checkHealthReal 之后：探测刚确认失效的账号不会白跑一轮浏览器。
      await runKeepaliveSweep(store)
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
