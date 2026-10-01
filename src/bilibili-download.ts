/**
 * B站视频下载 — host 半区 yutto CLI 实现。
 *
 * 为什么走 CLI 子进程而不走网关：
 *   网关（gateway-proxy.ts）只支持 http_get / http_post / mtop_jsonp 三种 kind，
 *   视频/音频是裸二进制大文件（几十 MB ~ 数 GB），既不能走 JSON body 也不能走代理注入。
 *   且 B站 音视频分离（DASH），需要 ffmpeg 合流 —— 这条链路只能交给专用下载器。
 *
 * 选型：yutto（yutto-dev/yutto，v2.3.1，GPL-3.0）
 *   - 以 CLI 子进程方式调用，不链接其代码，不构成衍生作品（GPL 隔离）
 *   - biliup 的 download 子命令只支持直播，不支持 B站点播（VOD），已排除
 *
 * Cookie 注入（源码级确认 yutto/auth.py::parse_auth_inline）：
 *   内联 `--auth "SESSDATA=xxx; bili_jct=yyy"`，按 `;` 切分、key 转小写匹配，
 *   仅取 sessdata / bili_jct 两个字段 —— 无需落临时 cookie 文件，无残留。
 *   ★ 该字符串含凭证，日志与返回值一律脱敏，绝不出本模块。
 *
 * 沙箱约束：stdout/stderr 重定向到临时日志文件再读回（不走管道），
 *   避免大输出把子进程管道写满后死锁。
 */
import { CredentialStore, resolveAccountForRequest, type StoredAccount } from './services/credential-store.js'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 下载总超时（30 分钟）——大文件 + ffmpeg 合流，给足时间 */
const DOWNLOAD_TIMEOUT_MS = 1_800_000

/** 清晰度名 → yutto 码点（yutto -q 只接受 int） */
const QUALITY_ALIASES: Record<string, number> = {
  '8k': 127, '杜比视界': 126, 'dolbyvision': 126, '4k': 120,
  '1080p60': 116, '1080p+': 112, '1080p': 80, '720p60': 74, '720p': 64,
  '480p': 32, '360p': 16,
}

/** 音质名 → yutto 码点（yutto -aq 只接受 int） */
const AUDIO_QUALITY_ALIASES: Record<string, number> = {
  'hires': 30251, 'hi-res': 30251, 'dolbyaudio': 30255, 'dolbyatmos': 30250,
  '320k': 30280, '320kbps': 30280, '128k': 30232, '128kbps': 30232,
  '64k': 30216, '64kbps': 30216,
}

export interface BilibiliDownloadOptions {
  /** 视频 / 番剧 / 收藏夹 等 B站 URL（支持 b23.tv 短链） */
  url: string
  /** 输出目录，默认 ~/.dsh/downloads/bilibili */
  dir?: string
  /** 清晰度：数字码（127/120/80…）或名称（8K/4K/1080P/720P…） */
  quality?: string
  /** 音质：数字码（30280/30232…）或名称（320kbps/128kbps…） */
  audioQuality?: string
  /** 输出容器格式：infer / mp4 / mkv / mov */
  outputFormat?: string
  /** 合集 / 番剧 批量下载 */
  batch?: boolean
  /** 选集范围，如 `1~-1`（全部）、`1,3,5`、`2~6` */
  episodes?: string
  /** 只要视频（不要音频） */
  videoOnly?: boolean
  /** 只要音频 */
  audioOnly?: boolean
  /** 不下载弹幕 */
  noDanmaku?: boolean
  /** 不下载字幕 */
  noSubtitle?: boolean
  /** 附带元数据（nfo） */
  withMetadata?: boolean
  /** 保存封面 */
  saveCover?: boolean
  /** 指定账号 shopKey（多账号待选时由模型回传用户选择） */
  account?: string
  /** 当前会话（智能体）ID，用于账号选择链 */
  agentId?: string
}

export interface BilibiliDownloadResult {
  ok: boolean
  text: string
  failureKind?: string
  /** 多账号待选时的候选（不含 Cookie） */
  accounts?: unknown[]
  shopKey?: string
  /** 输出目录 */
  dir?: string
  /** 本次新产出的文件绝对路径 */
  files?: string[]
}

/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(
  store: CredentialStore,
  opts: { account?: string; agentId?: string },
): { account: StoredAccount | null; error?: BilibiliDownloadResult } {
  const candidates = store.listAccounts().filter(a => a.platform === 'bilibili' && a.status !== 'invalid')
  if (!candidates.length) {
    return {
      account: null,
      error: {
        ok: false,
        failureKind: 'not_bound',
        text: '未找到 B站 账号。请引导用户打开「账号连接」页面添加 B站 账号（扫码登录）后再下载。',
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
          `B站 平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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

/** 定位 yutto 可执行文件（uv tool 安装，两处候选） */
function findYuttoPath(): string | null {
  const appData = process.env.APPDATA || ''
  const candidates = [
    join(homedir(), '.local', 'bin', 'yutto.exe'),
    appData ? join(appData, 'uv', 'tools', 'yutto', 'Scripts', 'yutto.exe') : '',
    join(homedir(), '.local', 'bin', 'yutto'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

/** 定位 ffmpeg（B站 音视频分离，必须合流） */
function findFfmpegPath(): string {
  const candidates = [
    'C:\\Program Files (x86)\\FFmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\FFmpeg\\bin\\ffmpeg.exe',
    join(homedir(), 'scoop', 'shims', 'ffmpeg.exe'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return 'ffmpeg' // 交给 PATH
}

/** 清晰度 / 音质入参归一为 yutto 需要的整数码点 */
function resolveQuality(raw: string, aliases: Record<string, number>): { code?: number; error?: string } {
  const s = raw.trim()
  if (!s) return {}
  if (/^\d+$/.test(s)) return { code: Number(s) }
  const hit = aliases[s.toLowerCase().replace(/\s+/g, '')]
  if (hit != null) return { code: hit }
  return { error: `无法识别的取值「${s}」，请传数字码或下列名称之一：${Object.keys(aliases).join(' / ')}` }
}

/** 递归收集目录下所有文件（用于下载前后差集） */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch {
      continue
    }
    for (const name of entries) {
      const p = join(cur, name)
      try {
        const st = statSync(p)
        if (st.isDirectory()) stack.push(p)
        else if (st.isFile()) out.push(p)
      } catch { /* 文件被占用/已删除，跳过 */ }
    }
  }
  return out
}

/** 日志脱敏：凭证串绝不外泄 */
function redact(text: string): string {
  return text
    .replace(/SESSDATA=[^;'"\s]+/gi, 'SESSDATA=***')
    .replace(/bili_jct=[^;'"\s]+/gi, 'bili_jct=***')
}

/** 从 yutto 日志尾部推断失败类型 */
function inferFailureKind(log: string): string {
  if (/风控|RGV587|-352|请求过于频繁|被挤爆/.test(log)) return 'risk_control'
  if (/SESSDATA|未登录|账号未登录|登录失效|登录状态|401|403/.test(log)) return 'token_expired'
  if (/不存在|404|稿件不可见|已失效|已删除/.test(log)) return 'api_error'
  if (/超时|timed out|timeout/i.test(log)) return 'api_error'
  return 'api_error'
}

/** 从 yutto 日志里抓取它自己报告的产物路径 */
function parseLoggedPaths(log: string): string[] {
  const hits: string[] = []
  const re = /(?:输出文件|合并输出|保存至|保存到|已保存)[：:\s]*([^\r\n]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(log)) !== null) {
    const p = m[1].trim().replace(/^["']|["']$/g, '')
    if (p) hits.push(p)
  }
  return hits
}

/**
 * B站视频下载主流程。
 *
 * 与发布不同，下载**没有真实副作用**（只读平台 + 写本地文件），
 * 因此不设 confirm 门禁，一次调用直接执行。
 */
export async function bilibiliDownload(
  store: CredentialStore,
  opts: BilibiliDownloadOptions,
): Promise<BilibiliDownloadResult> {
  // ── 入参校验 ────────────────────────────────────────────
  const url = String(opts.url || '').trim()
  if (!url) {
    return { ok: false, failureKind: 'api_error', text: '缺少 url（B站 视频/番剧/收藏夹链接）。' }
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, failureKind: 'api_error', text: `url 必须是 http(s) 开头的完整链接，当前为：${url}` }
  }
  if (!/bilibili\.com|b23\.tv/i.test(url)) {
    return { ok: false, failureKind: 'api_error', text: `url 不是 B站 链接（需含 bilibili.com 或 b23.tv）：${url}` }
  }

  const q = resolveQuality(String(opts.quality || ''), QUALITY_ALIASES)
  if (q.error) return { ok: false, failureKind: 'api_error', text: `quality 参数无效：${q.error}` }
  const aq = resolveQuality(String(opts.audioQuality || ''), AUDIO_QUALITY_ALIASES)
  if (aq.error) return { ok: false, failureKind: 'api_error', text: `audioQuality 参数无效：${aq.error}` }

  const outputFormat = String(opts.outputFormat || '').trim().toLowerCase()
  if (outputFormat && !['infer', 'mp4', 'mkv', 'mov'].includes(outputFormat)) {
    return { ok: false, failureKind: 'api_error', text: `outputFormat 只支持 infer / mp4 / mkv / mov，当前为：${outputFormat}` }
  }
  if (opts.videoOnly && opts.audioOnly) {
    return { ok: false, failureKind: 'api_error', text: 'videoOnly 与 audioOnly 不能同时为 true。' }
  }

  // ── 工具链可用性 ────────────────────────────────────────
  const yuttoPath = findYuttoPath()
  if (!yuttoPath) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: '未找到 yutto 可执行文件。请先安装：`uv tool install yutto`（需要 Python 3.11+ 与 FFmpeg）。',
    }
  }
  const ffmpegPath = findFfmpegPath()

  // ── 选号 ───────────────────────────────────────────────
  const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId })
  if (picked.error) return picked.error
  const account = picked.account!
  const shopKey = account.shop_key

  // ── 输出目录 ───────────────────────────────────────────
  const outDir = String(opts.dir || '').trim() || join(homedir(), '.dsh', 'downloads', 'bilibili')
  try {
    mkdirSync(outDir, { recursive: true })
  } catch (e) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `无法创建输出目录 ${outDir}：${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // ── 构造 yutto 命令 ────────────────────────────────────
  // ★ --auth 内联串含凭证，只进 argv，不进任何日志/返回值
  const sessdata = String(account.cookies?.SESSDATA || '').trim()
  const biliJct = String(account.cookies?.bili_jct || '').trim()
  const authArg = sessdata ? `SESSDATA=${sessdata}${biliJct ? `; bili_jct=${biliJct}` : ''}` : ''

  const args: string[] = ['download', url, '-d', outDir, '--no-progress', '--no-color', '--ffmpeg-path', ffmpegPath]
  if (authArg) args.push('--auth', authArg)
  if (q.code != null) args.push('-q', String(q.code))
  if (aq.code != null) args.push('-aq', String(aq.code))
  if (outputFormat) args.push('--output-format', outputFormat)
  if (opts.batch) args.push('--batch')
  if (String(opts.episodes || '').trim()) args.push('-p', String(opts.episodes).trim())
  if (opts.videoOnly) args.push('--video-only')
  if (opts.audioOnly) args.push('--audio-only')
  if (opts.noDanmaku) args.push('--no-danmaku')
  if (opts.noSubtitle) args.push('--no-subtitle')
  if (opts.withMetadata) args.push('--with-metadata')
  if (opts.saveCover) args.push('--save-cover')

  // 脱敏后的命令（仅用于日志）
  const safeCmd = ['yutto', ...args.map(a => (a === authArg ? 'SESSDATA=***; bili_jct=***' : a))]
    .map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')

  // ── 下载前快照 ─────────────────────────────────────────
  const before = new Set(walkFiles(outDir))

  // ── 执行 ───────────────────────────────────────────────
  const logDir = join(homedir(), '.dsh', 'logs')
  try {
    mkdirSync(logDir, { recursive: true })
  } catch { /* 忽略 */ }
  const logPath = join(logDir, `bilibili-download-${Date.now()}.log`)
  let fd = -1
  let exitCode = -1
  let timedOut = false

  console.log(`[dsagent-bilibili-download] 账号 ${shopKey} 开始下载：${safeCmd}`)

  try {
    fd = openSync(logPath, 'a')
    const proc = spawn(yuttoPath, args, {
      cwd: outDir,
      // 重定向到文件而非管道：yutto + ffmpeg 输出量大，管道写满会死锁
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    })
    // 子进程已持有 fd 副本，父进程可关闭
    try { closeSync(fd); fd = -1 } catch { /* 忽略 */ }

    exitCode = await new Promise<number>(resolve => {
      const timer = setTimeout(() => {
        timedOut = true
        try { proc.kill('SIGKILL') } catch { /* 忽略 */ }
      }, DOWNLOAD_TIMEOUT_MS)
      proc.on('error', (err: Error) => {
        clearTimeout(timer)
        console.warn('[dsagent-bilibili-download] 子进程启动失败:', err.message)
        resolve(-1)
      })
      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        resolve(code ?? -1)
      })
    })
  } catch (e) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      text: `启动 yutto 失败：${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    if (fd >= 0) { try { closeSync(fd) } catch { /* 忽略 */ } }
  }

  // ── 读取日志（脱敏后使用） ──────────────────────────────
  let log = ''
  try {
    log = redact(readFileSync(logPath, 'utf8'))
  } catch { /* 日志不可读时降级 */ }
  const logTail = log.length > 4000 ? log.slice(-4000) : log

  // ── 差集出新产物 ───────────────────────────────────────
  const after = walkFiles(outDir)
  const newFiles = after.filter(f => !before.has(f))

  if (timedOut) {
    return {
      ok: false,
      failureKind: 'api_error',
      shopKey,
      dir: outDir,
      files: newFiles,
      text: `下载超时（${DOWNLOAD_TIMEOUT_MS / 60000} 分钟）已被终止。`
        + (newFiles.length ? `\n已产出 ${newFiles.length} 个文件：\n${newFiles.join('\n')}` : '')
        + `\n日志：${logPath}`,
    }
  }

  if (exitCode === 0 && newFiles.length > 0) {
    try { await store.setStatus(shopKey, 'valid') } catch { /* 忽略 */ }
    const logged = parseLoggedPaths(logTail)
    return {
      ok: true,
      shopKey,
      dir: outDir,
      files: newFiles,
      text: [
        'B站 下载完成。',
        `账号：${account.display_label || account.account_id}（${shopKey}）`,
        `来源：${url}`,
        `输出目录：${outDir}`,
        `新文件（${newFiles.length} 个）：`,
        ...newFiles.map(f => `  ${f}`),
        logged.length ? `\nyutto 报告路径：${logged.join('、')}` : '',
        `\n日志：${logPath}`,
      ].filter(Boolean).join('\n'),
    }
  }

  // 失败：按日志归因
  const failureKind = inferFailureKind(logTail)
  if (failureKind === 'token_expired') {
    try { await store.setStatus(shopKey, 'expired') } catch { /* 忽略 */ }
  }
  const hint = failureKind === 'token_expired'
    ? '\n处理建议：请到「账号连接」页面重新登录 B站 后重试。'
    : failureKind === 'risk_control'
      ? '\n处理建议：B站 触发了风控，请稍后重试；必要时先在浏览器中正常浏览 B站 页面。'
      : ''

  return {
    ok: false,
    failureKind,
    shopKey,
    dir: outDir,
    files: newFiles,
    text: `B站 下载失败（yutto 退出码 ${exitCode}）。${hint}\n`
      + (newFiles.length ? `已产出 ${newFiles.length} 个文件（可能不完整）：\n${newFiles.join('\n')}\n` : '')
      + `\n日志尾部：\n${logTail.slice(-1500)}\n\n日志：${logPath}`,
  }
}
