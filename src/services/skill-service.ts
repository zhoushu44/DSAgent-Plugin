/**
 * 技能服务：技能市场页与技能类工具的唯一数据出口。
 *
 * 技能来源：真实扫描 skillRoot 下的 <name>/SKILL.md（Harness 的目录约定）。
 * 启用/停用：直接改写 SKILL.md frontmatter 的 disable-model-invocation 行
 *           —— 这是唯一能让「停用后模型真的看不见」的做法。
 *
 * 安全：只允许在 skillRoot 范围内读写，越界一律拒绝。
 *
 * 原项目对应：
 *   - app/backend/skills/loader.py — SkillLoader
 *   - app/backend/skills/runner.py — SkillRunner
 *   - runtime/skill_bootstrap.py — 技能入口引导
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { delimiter, join, resolve, sep } from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { extractTokens } from './account-service.js'

/**
 * 技能脚本实际用到的第三方依赖全集（扫技能目录下所有 .py 的 import 得到）。
 * 用于探测「哪个解释器真的能跑技能」，而不是「哪个命令存在」。
 */
const SKILL_DEPS = [
  'httpx', 'requests', 'bs4', 'jieba', 'lxml', 'markdown', 'numpy', 'openpyxl',
  'pandas', 'PIL', 'docx', 'pptx', 'yaml', 'matplotlib',
  'pdfplumber', 'pypdf', 'pdf2image', 'defusedxml', 'pywencai', 'akshare',
]

/**
 * 统计某个解释器能 import 的技能依赖数；解释器不可用时返回 -1。
 *
 * 用 `python -` 从 stdin 读脚本，避免 Windows 下 `-c` 里带换行/引号的转义地狱。
 */
function probeInterpreter(exe: string): number {
  const list = SKILL_DEPS.map(m => `'${m}'`).join(', ')
  const code = [
    'import importlib.util as u',
    `mods = [${list}]`,
    'n = 0',
    'for m in mods:',
    '    try:',
    '        if u.find_spec(m): n += 1',
    '    except Exception:',
    '        pass',
    'print(n)',
    '',
  ].join('\n')
  try {
    const out = execSync(`"${exe}" -`, { input: code, stdio: 'pipe', timeout: 6000, encoding: 'utf8' })
    const n = Number.parseInt(String(out).trim(), 10)
    return Number.isFinite(n) ? n : -1
  } catch {
    return -1
  }
}

/**
 * 候选解释器清单（按优先级排序）：
 *   1. 环境变量 DSAGENT_PYTHON 显式指定
 *   2. `py -0p` 列出的各版本绝对路径（Windows py launcher）
 *   3. PATH 上的 python / python3 / py
 */
function pythonCandidates(): string[] {
  const list: string[] = []
  const push = (v?: string | null) => {
    const s = v?.trim()
    if (s && !list.includes(s)) list.push(s)
  }
  push(process.env.DSAGENT_PYTHON)
  try {
    const out = execSync('py -0p', { stdio: 'pipe', timeout: 5000, encoding: 'utf8' })
    for (const line of String(out).split(/\r?\n/)) {
      const m = line.match(/^\s*-V:[\d.]+\s*\*?\s+(.+\.exe)\s*$/)
      if (m) push(m[1])
    }
  } catch { /* 无 py launcher（非 Windows 或未安装），继续走 PATH 候选 */ }
  push('python')
  push('python3')
  push('py')
  return list
}

/**
 * 解析可用的 Python 解释器。
 *
 * 只探「命令是否存在」是不够的：本机 python/python3 都不在 PATH，只有 py.exe，
 * 而 py 默认解析到 Python 3.13 —— 该版本零技能依赖，所有走进程的技能会在
 * import 阶段 ModuleNotFoundError（product-wdj 的 `import markdown` 即如此）。
 *
 * 因此改为「依赖探测式」解析：对每个候选跑一次依赖统计，选中命中数最高的解释器。
 * 对应原项目 SkillRunner._python() 的「首选随包自带运行时」思路 —— 原项目靠固定路径，
 * 这里靠实际可运行性判定，不依赖机器特定的安装位置。
 */
let _pyCache: string | null | undefined
function resolvePython(): string {
  if (_pyCache !== undefined) return _pyCache!
  const candidates = pythonCandidates()
  let best: string | null = null
  let bestScore = -1
  const report: string[] = []
  for (const exe of candidates) {
    const score = probeInterpreter(exe)
    if (score >= 0) report.push(`${exe}=${score}`)
    if (score > bestScore) {
      bestScore = score
      best = exe
    }
    if (score === SKILL_DEPS.length) break  // 满分，无需继续探测
  }
  _pyCache = best ?? 'python'
  console.log(
    `[dsagent] Python 解释器探测：${report.join(' | ') || '（无可用候选）'}` +
    ` → 选用 ${_pyCache}（命中 ${bestScore}/${SKILL_DEPS.length} 个技能依赖）`,
  )
  return _pyCache!
}

export interface SkillRow {
  id: string
  name: string
  description: string
  version: string
  /** 所属平台（从技能名前缀推断，如 taobao-auth → taobao）；无则为 common */
  platform: string
  /** 能力分组，用于 chips 筛选 */
  capability: string
  /** 风险等级 L0-L3，取自 frontmatter，缺省 L1 */
  risk: string
  /** 是否启用（= disable-model-invocation 不为 true） */
  enabled: boolean
  /** 技能目录绝对路径 */
  dir: string
  /** SKILL.md 正文（用于入口判定和指令型技能） */
  body: string
}

/** 技能执行结果 —— 对应原项目 SkillResult */
export interface SkillResult {
  ok: boolean
  payload: unknown
  stdout: string
  stderr: string
  exitCode: number
  message: string
  /** 缺少必要参数时回传的技能用法（供模型据此补 args 重试） */
  usage?: string
  /** 失败类型（吸收 QIWork failure_kind） */
  failureKind?: string
}

/**
 * 平台推断：本项目 skills/ 的技能名不带平台前缀，
 * 因此按「技能名 → 平台」显式映射；未命中的归为 common（通用）。
 */
const SKILL_PLATFORM: Record<string, string> = {
  // sycm 平台（生意参谋登录态）
  'sycm-customer': 'sycm',
  'competitor-strategy-comparison': 'sycm',
  'competitor-indicator': 'sycm',
  'keyword-assistant': 'sycm',
  'keyword-traffic': 'sycm',
  'market-trend': 'sycm',
  'store-patrol-manager': 'sycm',
  // sycm 平台（参谋长分析包转换的诊断类技能）
  'category-structure-diagnosis': 'sycm',
  'product-layering-diagnosis': 'sycm',
  'shop-promotion-diagnosis': 'sycm',
  // taobao 平台（淘宝登录态）
  'taobao-publish': 'taobao',
  'product-reviews': 'taobao',
  'product-wdj': 'taobao',
  'market-analysis': 'taobao',
  // xianyu 平台
  'xianyu-crawl': 'xianyu',
  'xianyu-publish': 'xianyu',
  'xianyu-order': 'xianyu',
  'xianyu-im': 'xianyu',
  'xianyu-analytics': 'xianyu',
  // zhihu 平台
  'zhihu-crawl': 'zhihu',
  'zhihu-publish': 'zhihu',
  // douyin 平台
  'douyin-crawl': 'douyin',
  'douyin-publish': 'douyin',
  'douyin-comment': 'douyin',
  'douyin-im': 'douyin',
  'douyin-analytics': 'douyin',
  // xhs 平台（小红书）
  'xiaohongshu-crawl': 'xhs',
  'xiaohongshu-publish': 'xhs',
  'xiaohongshu-comment': 'xhs',
  'xiaohongshu-im': 'xhs',
  'xiaohongshu-analytics': 'xhs',
  // bilibili 平台（B站）
  'bilibili-crawl': 'bilibili',
  'bilibili-download': 'bilibili',
  'bilibili-publish': 'bilibili',
  // pdd 平台（拼多多）
  'pdd-crawl': 'pdd',
  'pdd-publish': 'pdd',
}

/**
 * 能力归类：决定技能页的「能力」标签与页签归属。
 *   - `vertical` → 垂直业务技能页签；其余（office / core / agent / meta / connector / channel）→ 内置技能页签
 *   - 平台技能（*-crawl / *-publish / *-comment / *-im）按后缀归纳为功能组
 *   - 通用技能走显式映射，取值与规范 §6 的 category 体系一致
 */
const SKILL_CAPABILITY: Record<string, string> = {
  // office：Office 文档处理
  docx: 'office',
  pdf: 'office',
  pptx: 'office',
  xlsx: 'office',
  // core：核心基础能力
  file_reader: 'core',
  cron: 'core',
  // agent：Agent 协作
  make_plan: 'agent',
  chat_with_agent: 'agent',
  multi_agent_collaboration: 'agent',
  // meta：技能元能力
  'skill-creator': 'meta',
  'make-skill': 'meta',
  // connector：平台连接
  platform_bindings: 'connector',
  browser_cdp: 'connector',
  browser_visible: 'connector',
  // channel：消息频道
  channel_message: 'channel',
  dingtalk_channel: 'channel',
  dws: 'channel',
  // vertical：垂直业务（无平台后缀的店铺 / 行业 / 金融类）
  'store-patrol-manager': 'vertical',
  // 参谋长分析包转换的诊断类技能
  'category-structure-diagnosis': 'vertical',
  'product-layering-diagnosis': 'vertical',
  'shop-promotion-diagnosis': 'vertical',
  'competitor-strategy-comparison': 'vertical',
  'competitor-indicator': 'vertical',
  'market-trend': 'vertical',
  'sycm-customer': 'vertical',
  'keyword-traffic': 'vertical',
  'keyword-assistant': 'vertical',
  'market-analysis': 'vertical',
  'product-reviews': 'vertical',
  'product-wdj': 'vertical',
  'industry-data-mcp': 'vertical',
  'pywencai-stock': 'vertical',
  'valuation-investment-strategy': 'vertical',
  'financial-statement-analyzer': 'vertical',
  'industry-competition-moat': 'vertical',
  'a-stock-diagnosis': 'vertical',
  'data-report': 'vertical',
  'smart-compose': 'vertical',
  'customer-service-reply': 'vertical',
}

/** 兜底：显式映射未覆盖的新技能，按名字后缀与关键词归纳 */
const CAPABILITY_RULES: Array<[RegExp, string]> = [
  [/(?:-crawl|-download|-analytics)$/, 'analytics'],
  [/-publish$/, 'copywriting'],
  [/(?:-comment|-im)$/, 'cs-script'],
  [/(?:report|chart|wordcloud|viz|cockpit)/, 'chart'],
  [/(?:competitor|market|industry|keyword|traffic|sycm)/, 'analytics'],
  [/(?:order|product|patrol|store|stock|店铺|巡店)/, 'shop-ops'],
]

function inferPlatform(id: string): string {
  return SKILL_PLATFORM[id] ?? 'common'
}

function inferCapability(id: string): string {
  const fixed = SKILL_CAPABILITY[id]
  if (fixed) return fixed
  for (const [re, cap] of CAPABILITY_RULES) {
    if (re.test(id)) return cap
  }
  return 'shop-ops'
}

/**
 * 从 SKILL.md 抽取 frontmatter 字段（不引入 YAML 依赖）。
 *
 * 必须支持 YAML 块标量：`description: |` / `>` 的取值是后续缩进行，不是那个竖线本身。
 * 只按单行正则取会把 description 解析成字面量 "|"，技能页的「功能说明」就变成一根竖线。
 * 解析逻辑与 index.ts::scanSkillCatalog() 保持一致（那边一直是正确的）。
 */
function pickFrontmatter(raw: string, key: string): string | null {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fm) return null
  const block = fm[1]
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.+?)[ \\t]*$`, 'm')
  const hit = block.match(re)
  if (!hit) return null
  const inline = hit[1].replace(/^["']|["']$/g, '').trim()
  // 非块标量：直接就是值
  if (!/^[|>][+-]?$/.test(inline)) return inline
  // 块标量：从下一行起收集缩进行，遇到顶格行（下一个 frontmatter 键）即结束
  const rest = block.slice(block.indexOf(hit[0]) + hit[0].length)
  const lines: string[] = []
  for (const line of rest.split(/\r?\n/)) {
    if (line.trim() === '') { lines.push(''); continue }
    if (!/^[ \t]/.test(line)) break
    lines.push(line.trim())
  }
  return lines.join(' ').trim() || null
}

/** 判断技能是否启用（disable-model-invocation 为 true 时视为停用） */
function readEnabled(raw: string): boolean {
  const v = pickFrontmatter(raw, 'disable-model-invocation')
  if (v === null) return true
  return !['true', 'yes', 'on', '1'].includes(v.toLowerCase())
}

/** 改写 SKILL.md 的 disable-model-invocation，返回改写后的内容 */
function toggleFrontmatter(raw: string, enabled: boolean): string {
  const value = enabled ? 'false' : 'true'
  // 必须写成合法布尔，否则 Harness 会「整个技能丢弃」
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) {
    // 没有 frontmatter：补一个最小可用的
    return `---\ndisable-model-invocation: ${value}\n---\n\n${raw}`
  }
  const body = fmMatch[1]
  const head = '---\n'
  const tail = '\n---'
  const rest = raw.slice(fmMatch[0].length)

  const lineRe = /^\s*disable-model-invocation\s*:\s*.+?\s*$/m
  const nextBody = lineRe.test(body)
    ? body.replace(lineRe, `disable-model-invocation: ${value}`)
    : `${body}\ndisable-model-invocation: ${value}`

  return head + nextBody + tail + rest
}

const RESULT_PREFIX = '__DSAGENT_RESULT__'
const IDLE_TIMEOUT = 60_000       // 60 秒 idle 超时
const MAX_OUTPUT = 64 * 1024
/** 缓存 TTL：过期后下次 list() 自动重扫 skills/，新技能目录无需重启即可见 */
const CACHE_TTL = 60_000

/**
 * 通过 host 半区 HTTP 路由拉取技能列表。
 *
 * browser 半区没有文件系统（node:fs 被打桩），scan() 必然返回空数组，
 * 因此必须由 host 半区扫描 skillRoot 后回传，否则技能页会回退到内置假数据（FIX-LOG #54）。
 * host 半区调用时 fetch('/dsagent/api') 会因相对路径失败并返回 null，不影响本机扫描路径。
 */
async function fetchHostSkills(): Promise<SkillRow[] | null> {
  try {
    const resp = await fetch('/dsagent/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_skills' }),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { ok?: boolean; rows?: SkillRow[] }
    if (!data?.ok || !Array.isArray(data.rows)) return null
    return data.rows.map(r => ({ ...r, body: r.body || '' }))
  } catch {
    return null
  }
}

export function createSkillService(skillRoot: string) {
  const root = resolve(skillRoot || '.')
  let cache: SkillRow[] | null = null
  /** 缓存写入时间：超过 CACHE_TTL 视为过期，下次 list() 重扫 */
  let cacheAt = 0

  /** 越界防护：目标路径必须落在 skillRoot 内 */
  function assertInsideRoot(target: string) {
    const abs = resolve(target)
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`拒绝越界访问：${abs} 不在技能根目录 ${root} 内`)
    }
    return abs
  }

  async function scan(): Promise<SkillRow[]> {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch (e) {
      console.error('[dsagent] scan() readdir 失败:', root, e instanceof Error ? e.message : String(e))
      return []
    }

    const rows: SkillRow[] = []
    for (const entry of entries) {
      const dir = join(root, entry)
      const skillFile = join(dir, 'SKILL.md')
      try {
        const st = await stat(skillFile)
        if (!st.isFile()) continue
        const raw = await readFile(skillFile, 'utf8')
        const id = pickFrontmatter(raw, 'name') || entry
        const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const body = fmMatch ? raw.slice(fmMatch[0].length) : raw
        rows.push({
          id,
          name: pickFrontmatter(raw, 'display_name') || pickFrontmatter(raw, 'name') || entry,
          description: pickFrontmatter(raw, 'description') || '',
          version: pickFrontmatter(raw, 'version') || pickFrontmatter(raw, 'builtin_skill_version') || '1.0.0',
          platform: inferPlatform(id),
          capability: inferCapability(id),
          risk: pickFrontmatter(raw, 'risk') || 'L1',
          enabled: readEnabled(raw),
          dir,
          body,
        })
      } catch (e) {
        // 不是合法技能目录，跳过（但记录调试信息）
        console.error('[dsagent] scan() 跳过技能目录:', entry, e instanceof Error ? e.message : String(e))
      }
    }
    rows.sort((a, b) => a.id.localeCompare(b.id))
    console.log(`[dsagent] scan() 完成：扫描 ${entries.length} 个条目，找到 ${rows.length} 个技能`)
    return rows
  }

  return {
    /** 列出技能（带 TTL 缓存：过期 / toggle 后自动重扫；browser 半区回退 host 路由） */
    async list(opts?: { platform?: string; capability?: string; onlyEnabled?: boolean }): Promise<SkillRow[]> {
      // ★ TTL 过期即重扫：往 skills/ 加新目录后无需重启 DSH 即可见。
      //   扫描本身只是 readdir + 逐个读 SKILL.md（几十个小文件），成本低，
      //   60s 一次完全没有压力；真正的网络请求（技能执行）不受此缓存影响。
      const expired = cache !== null && Date.now() - cacheAt > CACHE_TTL
      if (!cache || expired) {
        cache = await scan()
        cacheAt = Date.now()
        // browser 半区无文件系统，本地扫描恒为空 → 回退到 host 半区路由取真实列表
        if (!cache.length) {
          const remote = await fetchHostSkills()
          if (remote && remote.length) {
            cache = remote
            cacheAt = Date.now()
          }
        }
      }
      let rows = cache
      if (opts?.platform) rows = rows.filter(r => r.platform === opts.platform)
      if (opts?.capability) rows = rows.filter(r => r.capability === opts.capability)
      if (opts?.onlyEnabled) rows = rows.filter(r => r.enabled)
      return rows
    },

    /** 取单个技能详情 */
    async get(id: string): Promise<SkillRow | null> {
      const rows = await this.list()
      return rows.find(r => r.id === id) ?? null
    },

    /**
     * 启用/停用技能：改写 SKILL.md 的 disable-model-invocation。
     * Harness 会热更新，模型侧免重启生效。
     */
    async setEnabled(id: string, enabled: boolean): Promise<SkillRow> {
      const row = await this.get(id)
      if (!row) throw new Error(`技能不存在：${id}`)

      // 技能行来自 host 半区（browser 半区无 dir）→ 必须回 host 落盘
      if (!row.dir) {
        const resp = await fetch('/dsagent/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_skill_enabled', skillId: id, enabled }),
        }).then(r => r.json()).catch(() => null) as { ok?: boolean; error?: string } | null
        if (!resp?.ok) throw new Error(resp?.error || '启停失败：无法写入 SKILL.md')
        row.enabled = enabled
        return row
      }

      const skillFile = assertInsideRoot(join(row.dir, 'SKILL.md'))
      const raw = await readFile(skillFile, 'utf8')
      const next = toggleFrontmatter(raw, enabled)
      if (next !== raw) await writeFile(skillFile, next, 'utf8')

      row.enabled = enabled
      return row
    },

    /** 强制重新扫描（页面刷新用） */
    async refresh(): Promise<SkillRow[]> {
      cache = null
      cacheAt = 0
      return this.list()
    },

    /**
     * 执行技能 —— 对应原项目 SkillRunner.run()
     *
     * 流程：
     *   1. 从 SKILL.md 正文判断入口形态（包入口 / 脚本入口 / 纯指令型）
     *   2. 从用户 request 提取 token 关键词作为命令行参数
     *   3. 注入 5 个环境变量 + PYTHONPATH
     *   4. 启动子进程，实时读 stdout/stderr
     *   5. 从 stdout 解析 __DSAGENT_RESULT__ 行
     *
     * @param id 技能 id
     * @param request 用户的自然语言请求
     * @param env 环境变量（含 DSCONNECT_URL / DSCONNECT_TOKEN / DSCONNECT_AGENT_ID 等）
     * @param opts.args 模型显式给出的命令行参数（优先级高于从 request 提取）
     * @param opts.fromContract 参数来自技能契约：原样透传，不做正则补全
     */
    async run(
      id: string,
      request: string,
      env: Record<string, string>,
      opts?: { args?: string[]; fromContract?: boolean },
    ): Promise<SkillResult> {
      const skill = await this.get(id)
      if (!skill) return { ok: false, payload: null, stdout: '', stderr: '', exitCode: -1, message: `未知技能：${id}` }
      if (!skill.enabled) return { ok: false, payload: null, stdout: '', stderr: '', exitCode: -1, message: `技能已停用：${id}` }

      const explicitArgs = opts?.args && opts.args.length > 0 ? opts.args : undefined

      // 判定入口形态
      const command = buildCommand(skill, request, explicitArgs, opts?.fromContract === true)
      if (command === null) {
        // 纯指令型技能：没有可执行入口，把正文交给模型自己照做。
        // 正文里的 {baseDir} / {this_skill_dir} 必须替换成技能真实绝对路径，
        // 否则模型会按「工作区相对路径」去找 docs/、references/ 等资源，
        // 找不到就静默降级成自造内容（如 customer-service-reply 找不到话术模板）。
        return {
          ok: true,
          payload: { mode: 'instructions', body: renderInstructionBody(skill) },
          stdout: '',
          stderr: '',
          exitCode: 0,
          message: 'instruction-only',
        }
      }

      // PYTHONPATH 注入：技能脚本靠它 import .dsagent.runtime。
      // runtime 可能在 skillRoot 内（skills/.dsagent）或其父目录（项目根/.dsagent），两处都挂上。
      const pyPathEntries = [join(root, '.dsagent'), join(resolve(root, '..'), '.dsagent')]
        .filter(p => existsSync(p))
      const pythonPath = [...pyPathEntries, env.PYTHONPATH ?? process.env.PYTHONPATH ?? '']
        .filter(Boolean)
        .join(delimiter)

      // 执行子进程
      return new Promise<SkillResult>(resolve => {
        const proc = spawn(command[0], command.slice(1), {
          cwd: skill.dir,
          env: { ...process.env, ...env, PYTHONPATH: pythonPath },
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        let stdout = ''
        let stderr = ''
        let lastBeat = Date.now()
        const started = Date.now()
        const timeout = 300_000  // 5 分钟总超时

        proc.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
          lastBeat = Date.now()
          if (stdout.length > MAX_OUTPUT * 2) stdout = stdout.slice(-MAX_OUTPUT)
        })

        proc.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
          // stderr 同样算心跳。技能输出协议（skill-spec §9.1）要求「进度日志一律走 stderr，
          // stdout 只留最终结果」，因此长任务的进度只可能出现在 stderr。若只把 stdout 算心跳，
          // 任何遵守协议且耗时超过 idle 阈值的技能都会被看门狗误杀
          // （product-wdj 拉 50 条回答详情时零 stdout 输出，61 秒被 kill）。
          lastBeat = Date.now()
          if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(-MAX_OUTPUT)
        })

        const idleCheck = setInterval(() => {
          if (Date.now() - started > timeout) {
            proc.kill('SIGKILL')
            clearInterval(idleCheck)
            resolve({
              ok: false,
              payload: null,
              stdout: stdout.slice(-MAX_OUTPUT),
              stderr,
              exitCode: -1,
              message: `技能超时（${timeout / 1000} 秒）被终止`,
            })
          }
          if (Date.now() - lastBeat > IDLE_TIMEOUT) {
            proc.kill('SIGKILL')
            clearInterval(idleCheck)
            resolve({
              ok: false,
              payload: null,
              stdout: stdout.slice(-MAX_OUTPUT),
              stderr,
              exitCode: -1,
              message: `技能 ${Math.round((Date.now() - lastBeat) / 1000)} 秒无输出，按 idle 超时终止`,
            })
          }
        }, 1000)

        proc.on('close', (code: number) => {
          clearInterval(idleCheck)

          // 从 stdout 解析 __DSAGENT_RESULT__ 行
          let payload: unknown = null
          const lines = stdout.split('\n')
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i]
            if (line.startsWith(RESULT_PREFIX)) {
              const jsonStr = line.slice(RESULT_PREFIX.length)
              try {
                payload = JSON.parse(jsonStr)
              } catch {
                payload = { raw: jsonStr }
              }
              break
            }
          }

          // 回退：尝试从 stdout 尾部找松散 JSON
          if (payload === null) {
            payload = tryLooseJson(stdout)
          }

          // 「无产出」判定：退出码 0，但既没有结果载荷、也没有产出文件（---[OUTPUT_FILES]）。
          // 说明脚本只打印了用法/帮助就退出（market-analysis / sycm-customer 缺参数时的典型行为），
          // 必须判失败并回传用法让模型补 args 重试，否则会出现「静默空数据」的 false PASS。
          // 注意：market-analysis 这类技能不走 __DSAGENT_RESULT__ 协议，成功时靠 ---[OUTPUT_FILES] 判定。
          const noResult = payload === null && !stderr.includes('---[OUTPUT_FILES]')

          // ok 判定：退出码为 0，且 payload 未显式声明失败（ok:false / status:'error'）
          let payloadOk = true
          if (typeof payload === 'object' && payload !== null) {
            const p = payload as Record<string, unknown>
            if ('ok' in p) payloadOk = p.ok !== false
            else if (typeof p.status === 'string') payloadOk = p.status !== 'error'
          }
          const ok = code === 0 && payloadOk && !noResult
          // 失败原因可能写在 message / error / error_message / detail / reason 任一个字段，全部兜住
          let message = ''
          if (typeof payload === 'object' && payload !== null) {
            const p = payload as Record<string, unknown>
            message = String(p.message ?? p.error ?? p.error_message ?? p.detail ?? p.reason ?? '')
          }
          // 兜底：argparse 报错 / 未捕获异常只写 stderr，取最后一行含错误关键字的，退路取最后一行非空
          if (!message) {
            const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean)
            message = [...lines].reverse().find(l => /(error|错误|失败|异常|exception|traceback)/i.test(l))
              ?? lines[lines.length - 1]
              ?? ''
          }
          // 只打印用法就退出（无任何结果载荷）时，给出明确的缺参数提示
          if (noResult && !message) {
            message = '技能未输出结果（通常表示缺少参数），请参考用法补 args 后重试'
          }
          // 失败时回传技能用法，模型可据此补 args 重试
          const usage = ok ? undefined : (extractUsage(skill.body, detectEntry(skill.dir, skill.id, skill.body)) ?? undefined)
          // 提取脚本自报的失败类型（脚本按 runtime 规范输出 failure_kind / failureKind），
          // 供上层直接采用，避免靠 stderr 关键词反推导致业务码失败被降级为 skill_error
          let failureKind: string | undefined
          if (!ok && typeof payload === 'object' && payload !== null) {
            const p = payload as Record<string, unknown>
            const fk = p.failure_kind ?? p.failureKind
            if (typeof fk === 'string' && fk) failureKind = fk
          }

          resolve({
            ok,
            payload,
            stdout: stdout.slice(-MAX_OUTPUT),
            stderr,
            exitCode: code,
            message,
            usage,
            failureKind,
          })
        })

        proc.on('error', (err: Error) => {
          clearInterval(idleCheck)
          resolve({
            ok: false,
            payload: null,
            stdout: '',
            stderr: err.message,
            exitCode: -1,
            message: `无法启动技能进程：${err.message}`,
          })
        })
      })
    },

    /**
     * 导入技能 — 从 SKILL.md 内容或 ZIP 解压后入库
     *
     * 流程：
     *   1. 校验 SKILL.md frontmatter 合法性（必须有 name 字段）
     *   2. 在 skillRoot 下创建 <name>/ 目录
     *   3. 写入 SKILL.md
     *   4. 失效缓存，下次 list 重新扫描
     */
    async importSkill(mdContent: string): Promise<{ ok: boolean; skillId?: string; error?: string }> {
      // 校验 frontmatter
      const fmMatch = mdContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!fmMatch) {
        return { ok: false, error: 'SKILL.md 缺少 frontmatter（--- 包裹的头部）' }
      }
      const name = pickFrontmatter(mdContent, 'name')
      if (!name) {
        return { ok: false, error: 'SKILL.md frontmatter 必须包含 name 字段' }
      }
      // 拒绝不安全的 name（路径遍历、特殊字符等）
      if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) {
        return { ok: false, error: `技能 name 不合法（仅允许字母数字开头，含字母数字下划线短横线点号）：${name}` }
      }

      let skillDir: string
      try {
        skillDir = assertInsideRoot(join(root, name))
      } catch (err) {
        return { ok: false, error: `技能 name 越界：${err instanceof Error ? err.message : String(err)}` }
      }
      const skillFile = join(skillDir, 'SKILL.md')

      // 如果目录已存在，提示覆盖
      try {
        const st = await stat(skillFile)
        if (st.isFile()) {
          // 不阻止，允许覆盖更新
        }
      } catch {
        // 目录不存在，需要创建
      }

      // 创建目录 + 写入
      try {
        const { mkdir } = await import('node:fs/promises')
        await mkdir(skillDir, { recursive: true })
        await writeFile(skillFile, mdContent, 'utf8')
      } catch (err) {
        return { ok: false, error: `无法创建技能目录：${err instanceof Error ? err.message : String(err)}` }
      }

      // 失效缓存
      cache = null
      cacheAt = 0

      return { ok: true, skillId: name }
    },

    /**
     * 生成 HTML 报告（三步流程的第 3 步）。
     * 对应原项目：python -m <pkg> inject-report --insights_md <md_path>
     *
     * @param skillId  技能 ID
     * @param insightsMdPath  AI 洞察 Markdown 文件路径
     * @param opts     可选参数：seed_keyword / run_id / mode
     * @param env      环境变量（与 run() 相同）
     */
    async runReport(
      skillId: string,
      insightsMdPath: string,
      opts?: { seedKeyword?: string; runId?: string; mode?: string },
      env?: Record<string, string>,
    ): Promise<SkillResult & { reportPath?: string; csvPath?: string }> {
      const skill = await this.get(skillId)
      if (!skill) {
        return { ok: false, payload: null, stdout: '', stderr: '', exitCode: -1, message: `技能不存在：${skillId}` }
      }
      if (!supportsInjectReport(skill)) {
        return { ok: false, payload: null, stdout: '', stderr: '', exitCode: -1, message: `技能 ${skillId} 不支持 inject-report` }
      }
      // 构造 inject-report request
      let request = `inject-report --insights_md ${insightsMdPath}`
      if (opts?.seedKeyword) request += ` --seed_keyword ${opts.seedKeyword}`
      if (opts?.runId) request += ` --run_id ${opts.runId}`
      if (opts?.mode) request += ` --mode ${opts.mode}`

      const result = await this.run(skillId, request, env ?? {})

      // 解析 report_path / csv_path
      if (result.ok && result.payload) {
        const payload = typeof result.payload === 'string'
          ? tryLooseJson(result.payload) as Record<string, unknown> | null
          : result.payload as Record<string, unknown>
        if (payload && typeof payload === 'object') {
          const reportPath = payload.report_path as string | undefined
          const csvPath = payload.csv_path as string | undefined
          if (reportPath) {
            return { ...result, reportPath, csvPath }
          }
        }
      }
      return result
    },

    /**
     * 检测技能是否支持三步流程（取数 → AI 洞察 → inject-report 生成 HTML）。
     */
    async supportsReport(skillId: string): Promise<boolean> {
      const skill = await this.get(skillId)
      if (!skill) return false
      return supportsInjectReport(skill)
    },

    /**
     * 检测技能取数时是否直接生成 HTML 报告（无需 AI 洞察）。
     */
    async hasDirectReport(skillId: string): Promise<boolean> {
      const skill = await this.get(skillId)
      if (!skill) return false
      return hasDirectReport(skill)
    },

    dispose() {
      cache = null
      cacheAt = 0
    },
  }
}

export type SkillService = ReturnType<typeof createSkillService>

/**
 * 构建技能执行命令 —— 对应原项目 SkillRunner._build_command()
 *
 * 三种入口形态：
 *   1. 包入口：skill.dir 下存在含 __main__.py 的包目录 → [python, -m, package, *args]
 *   2. 脚本入口：SKILL.md 首条命令是 `python[3] .../scripts/xxx.py` → [python, script, *args]
 *   3. 纯指令型：无可执行入口 → null
 *
 * @param explicitArgs 模型显式给出的命令行参数（最高优先级）
 * @param fromContract 参数是否来自技能契约（contract.json）。
 *        契约已给出完整 argv（含子命令），此时**跳过**「按用法模板猜补子命令/flag」
 *        与 inject-report 正则分支，原样透传，避免二次猜测把正确的 argv 改坏。
 */
function buildCommand(skill: SkillRow, request: string, explicitArgs?: string[], fromContract = false): string[] | null {
  const body = skill.body
  const py = resolvePython()
  const entry = detectEntry(skill.dir, skill.id, body)

  if (fromContract) {
    const args = explicitArgs ?? []
    if (entry.form === 'package' && entry.pkg) return [py, '-m', entry.pkg, ...args]
    if (entry.form === 'script' && entry.script) return [py, join(skill.dir, entry.script), ...args]
    return null
  }

  const raw = explicitArgs && explicitArgs.length > 0 ? explicitArgs : extractArgsFromRequest(request)
  const args = normalizeArgs(extractUsage(body, entry), raw)

  // 形态零：inject-report 子命令（三步流程的第 3 步）
  if (request.includes('inject-report')) {
    const mod = entry.pkg ?? skill.id.replace(/-/g, '_')
    const cmd: string[] = [py, '-m', mod, 'inject-report']
    const mdMatch = request.match(/--insights_md\s+(\S+)/)
    if (mdMatch) cmd.push('--insights_md', mdMatch[1])
    const seedMatch = request.match(/--seed_keyword\s+(\S+)/)
    if (seedMatch) cmd.push('--seed_keyword', seedMatch[1])
    const runIdMatch = request.match(/--run_id\s+(\S+)/)
    if (runIdMatch) cmd.push('--run_id', runIdMatch[1])
    const modeMatch = request.match(/--mode\s+(\S+)/)
    if (modeMatch) cmd.push('--mode', modeMatch[1])
    return cmd
  }

  // 形态一：包入口
  if (entry.form === 'package' && entry.pkg) {
    return [py, '-m', entry.pkg, ...args]
  }

  // 形态二：脚本入口
  if (entry.form === 'script' && entry.script) {
    return [py, join(skill.dir, entry.script), ...args]
  }

  // 形态三：纯指令型
  return null
}

/**
 * 脚本调用点：同一行内先出现显式占位符，再出现 scripts/xxx.py。
 *
 * 覆盖两种真实写法：
 *   - `python3 {baseDir}/scripts/fetch_data.py --keyword x`（xianyu-crawl / a-stock-diagnosis）
 *   - `cd "{this_skill_dir}" && python scripts/search_notes.py "关键词"`（xiaohongshu-crawl）
 *
 * 刻意不匹配裸 `python scripts/xxx.py`（docx/pptx/xlsx/skill-creator 用的是这种），
 * 也与原项目「只认 {baseDir}/」的判定保持一致。
 */
const SCRIPT_CALL_RE = /\{(?:baseDir|this_skill_dir)\}[^\n]{0,120}?(scripts\/[\w./-]+\.py)/
/**
 * 用法行：正文里的 `python -m xxx ...` 或 `python .../xxx.py ...`（含 `{baseDir}` 占位符与裸路径）。
 *
 * 只认这两类可执行入口，具体是不是**本技能**的入口由 extractUsage 按 entry 过滤，
 * 因此这里放宽到裸 `python scripts/xxx.py`（xiaohongshu-crawl 的正文就是这种写法）。
 */
const USAGE_CMD_RE = /(?:python3?|uv\s+run)\s+(?:-m\s+[\w.]+|\S*\.py)([^\n`|]*)/

const pkgCache = new Map<string, string | null>()

/**
 * 解析技能包名 —— 扫 skill.dir 下含 `__main__.py` 的包目录。
 *
 * 不能只用 `id.replace('-', '_')`：如 sycm-customer 的真实包目录是 customer_analysis，
 * keyword-assistant 的正文写的是 `-m keyword_assistant` 但包名可能是别的。
 * 直接扫目录得到真实包名，避免 slug 推导名与包名不一致时找不到入口。
 */
function resolvePackageByDir(dir: string): string | null {
  const cached = pkgCache.get(dir)
  if (cached !== undefined) return cached
  let pkg: string | null = null
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (existsSync(join(dir, entry.name, '__main__.py'))) {
        pkg = entry.name
        break
      }
    }
  } catch { /* 目录不可读，视为无包入口 */ }
  pkgCache.set(dir, pkg)
  return pkg
}

/** 技能入口形态 */
export interface SkillEntry {
  form: 'package' | 'script' | 'instructions'
  /** 包入口时的包名（含 `__main__.py` 的目录名） */
  pkg?: string
  /** 脚本入口时的相对路径，如 `scripts/fetch_data.py` */
  script?: string
}

/**
 * 判定技能入口形态 —— 对应原项目 SkillRunner._build_command()。
 *
 * 顺序与原项目一致：
 *   1. 包入口：skill.dir 下有含 `__main__.py` 的包，且正文提到 `-m <包名>`
 *   2. 脚本入口：正文里有带显式占位符的 `{baseDir|this_skill_dir}/scripts/xxx.py`，且文件真实存在
 *   3. 纯指令型：以上都不满足
 *
 * 刻意不把裸 `python scripts/xxx.py` 当入口：docx/pptx/xlsx/skill-creator/data-report
 * 正文里的 scripts 是辅助工具，主流程要靠模型照 SKILL.md 编排，误判会让它们永远跑错脚本。
 */
export function detectEntry(dir: string, id: string, body: string): SkillEntry {
  const pkg = resolvePackageByDir(dir)
  if (pkg && (body.includes(`-m ${pkg}`) || body.includes(`-m ${id}`))) {
    return { form: 'package', pkg }
  }
  const m = body.match(SCRIPT_CALL_RE)
  if (m && existsSync(join(dir, m[1]))) {
    return { form: 'script', script: m[1] }
  }
  return { form: 'instructions' }
}

/**
 * 渲染指令型技能的正文。
 *
 * SKILL.md 正文里的 `{baseDir}` / `{this_skill_dir}` 是「技能自身目录」的占位符，
 * 直接原样交给模型会退化成按**工作区相对路径**查找资源（如 `docs/data/templates.json`），
 * 找不到就静默降级成模型自造内容 —— customer-service-reply 就因此丢掉了 1435 条话术模板。
 *
 * 这里做两件事：
 *   1. 把占位符替换成技能真实绝对路径
 *   2. 在正文前补一段「技能目录 + 自带资源绝对路径清单」，让模型知道文件真实位置
 */
export function renderInstructionBody(skill: { dir: string; body: string }): string {
  const dir = skill.dir
  const body = (skill.body ?? '').replace(/\{(?:baseDir|this_skill_dir)\}/g, dir)
  return [renderSkillDirHint(dir), '', body].join('\n')
}

/**
 * 渲染「技能目录 + 自带资源绝对路径清单」提示块。
 *
 * 可执行技能（package/script 型）同样需要这段信息：技能执行失败或数据层为空时，
 * 模型要读技能自带的 references/、scripts/ 才能排查，缺这段会退化成满盘搜索
 * 文件系统（Glob/Pwsh 连续探测数十步仍找不到技能安装位置）。
 */
export function renderSkillDirHint(dir: string): string {
  const files = listResourceFiles(dir)
  return [
    `【技能目录】${dir}`,
    '【技能自带资源】读取下列文件时必须使用给出的绝对路径，不要按工作区相对路径查找，也不要搜索文件系统找技能安装位置：',
    ...(files.length ? files.map(p => `- ${p}`) : ['（无）']),
  ].join('\n')
}

/** 资源清单上限：防止超大技能目录把提示词撑爆 */
const MAX_RESOURCE_FILES = 80

/**
 * 列出技能目录下的资源文件绝对路径（深度 ≤4，跳过隐藏目录与 __pycache__）。
 * 同步实现：与 existsSync 同源，browser 半区拿到的是 stub，天然返回空。
 */
function listResourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (abs: string, depth: number) => {
    if (out.length >= MAX_RESOURCE_FILES || depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= MAX_RESOURCE_FILES) return
      if (e.name.startsWith('.') || e.name === '__pycache__') continue
      const child = join(abs, e.name)
      if (e.isDirectory()) walk(child, depth + 1)
      else if (e.name !== 'SKILL.md') out.push(child)
    }
  }
  walk(dir, 0)
  return out
}

/** 正则元字符转义，供把包名/脚本路径拼进正则时使用 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 提取 SKILL.md 里的调用示例（usage），供模型据此填写 args。
 *
 * 只保留指向**本技能自身入口**的示例：
 *   - 包入口技能 → 只认 `-m <本技能包名>` 的行
 *   - 脚本入口技能 → 只认含本技能脚本路径的行
 *   - 纯指令型技能 → 返回 null（没有可执行的用法可给）
 *
 * 这样能排除正文里对兄弟技能/外部工具（如 `python -m keyword_traffic`、
 * `python -m markitdown`）的引用，避免把别人的用法注入到本技能的提示词里。
 *
 * 同一技能内多条示例时，按「带引号实参 > 具体参数 > 占位式」择优，
 * 避免把 `cd "..." && python -m xxx ...` 这种无信息量的占位行喂给模型。
 */
export function extractUsage(body: string, entry: SkillEntry): string | null {
  if (entry.form === 'instructions') return null
  const re = new RegExp(USAGE_CMD_RE.source, 'g')
  const best: string[] = []      // 带引号的具体实参，最贴近真实调用
  const good: string[] = []      // 有具体参数（如 --cate_id 29）
  const fallback: string[] = []  // 占位式（如 `...` / `<子命令> ...`）
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const cmd = m[0]
    const isPkgLine = /-m\s/.test(cmd)
    if (isPkgLine) {
      if (entry.form !== 'package' || !entry.pkg) continue
      if (!new RegExp(`-m\\s+${escapeRe(entry.pkg)}(?![\\w.])`).test(cmd)) continue
    } else {
      if (entry.form !== 'script' || !entry.script) continue
      if (!cmd.includes(entry.script)) continue
    }
    const line = cmd.trim().replace(/[\\`]+$/, '').trim()
    const argStr = (m[1] ?? '').trim()
    if (/["'“][^"'”]+["'”]/.test(argStr)) best.push(line)
    else if (argStr && !/^[.…\s]*$/.test(argStr) && !/^<\S+>/.test(argStr)) good.push(line)
    else fallback.push(line)
  }
  return best[0] ?? good[0] ?? fallback[0] ?? null
}

/**
 * 按技能文档的用法模板校正参数。
 *
 * 自然语言里抓到的裸关键词往往缺子命令或缺 flag，直接透给 argparse 会被判为非法值：
 *   keyword-traffic  用法 `... -m keyword_traffic trend "充电宝"` → 补 `trend`
 *   store-patrol-manager 用法 `... -m store_patrol_manager analyze` → 补 `analyze`
 *   xianyu-crawl     用法 `... fetch_data.py --keyword "搜索关键词"` → 补 `--keyword`
 *
 * 只做两件事，且都以技能自己文档里的用法为准，不做通用猜测：
 *   1. 用法里入口后紧跟裸小写单词（子命令）→ 参数首项不是子命令时补上
 *   2. 用法里入口后紧跟 `--flag`（无子命令）→ 参数全是位置参数时，把首项转成该 flag 的值
 */
function normalizeArgs(usage: string | null, args: string[]): string[] {
  if (!usage) return args
  const tail = usage.replace(/^.*?(?:-m\s+[\w.]+|\S*\.py)\s*/, '')
  const sub = tail.match(/^([a-z][a-z0-9-]*)(?![\w-])/)
  if (sub) {
    // 模型已自行给出子命令（如 args="categories"）时不重复补
    return args[0] && /^[a-z][a-z0-9-]*$/.test(args[0]) ? args : [sub[1], ...args]
  }
  const flag = tail.match(/^(--[A-Za-z][\w-]*)/)
  if (flag && args.length > 0 && !args.some(a => a.startsWith('--'))) {
    return [flag[1], args[0], ...args.slice(1)]
  }
  return args
}

/** 引号感知的命令行分词 —— 支持 "带 空格" / '带 空格' / --flag=value */
export function parseArgString(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|“([^”]*)”|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const v = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (v) out.push(v)
  }
  return out
}

/**
 * 从自然语言 request 提取 argv。
 *
 * 优先级：
 *   1. 显式 `--flag value` / `--flag=value`（值可以是中文，如 --keyword 手机壳）
 *   2. 引号包裹的参数（含中文关键词，如 "手机壳"）
 *   3. 裸 token（商品号 / 股票代码 / 类目 ID）
 */
function extractArgsFromRequest(request: string): string[] {
  if (!request) return []
  // 1) 显式 flag（`(?!--)\S+` 避免把下一个 flag 当成值）
  const flagRe = /--([A-Za-z_][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|((?!--)\S+))|\s+(?:"([^"]*)"|'([^']*)'|((?!--)\S+)))?/g
  const flags: string[] = []
  let m: RegExpExecArray | null
  while ((m = flagRe.exec(request)) !== null) {
    flags.push(`--${m[1]}`)
    const val = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7]
    if (val !== undefined && val !== '') flags.push(val)
  }
  if (flags.length) return flags

  // 2) 引号包裹的参数
  const quoted: string[] = []
  for (const hit of request.matchAll(/"([^"]+)"|'([^']+)'|“([^”]+)”/g)) {
    const v = hit[1] ?? hit[2] ?? hit[3]
    if (v) quoted.push(v)
  }
  if (quoted.length) return quoted

  // 3) 裸 token
  return extractTokens(request)
}

/**
 * 检测技能是否支持 inject-report（三步流程的第 3 步）。
 * 判定依据：SKILL.md 正文里出现 inject-report 关键词。
 */
function supportsInjectReport(skill: SkillRow): boolean {
  return skill.body.includes('inject-report') || skill.body.includes('inject_report')
}

/**
 * 检测技能取数时是否直接生成 HTML 报告（无需 AI 洞察）。
 * 判定依据：SKILL.md 正文里出现 report_path 或 HTML 报告。
 */
function hasDirectReport(skill: SkillRow): boolean {
  const b = skill.body.toLowerCase()
  return b.includes('report_path') || b.includes('html 报告路径')
}

/** 从 stdout 尾部尝试找松散 JSON —— 对应原项目 _try_loose_json() */
function tryLooseJson(stdout: string): unknown {
  const text = stdout.trim()
  if (!text) return null
  let start = text.indexOf('{')
  if (start < 0) start = text.indexOf('[')
  if (start < 0) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}
