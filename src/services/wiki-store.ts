/**
 * 商家知识 Wiki 存储层 —— 八域本体知识库的落盘与检索。
 *
 * 目录结构（对齐 Accio `_index.md` 的输出结构）：
 *
 *   <wikiRoot>/
 *   ├── INDEX.md                  八域总索引（自动生成，不要手改）
 *   ├── PRINCIPLES.md             披露边界与使用原则（人工维护）
 *   ├── log.md                    编译日志与「达标待办」
 *   ├── raw/                      原始素材（只读，编译的输入）
 *   ├── 商品/
 *   │   ├── entities/             实体页（一个商品一页）
 *   │   └── concepts/             概念页（该域相关的口径定义）
 *   ├── 店铺/ 客户/ 经营/ 平台/ 资产/ 接待/
 *   └── 概念/                     跨域概念页
 *
 * ★ 关键设计（来自 Accio）：
 *   ① **实体页与概念页分目录**（entities / concepts）—— 概念是跨域复用的口径，
 *      把它和实体混在一起会让「口径的唯一出处」这个定位失效。
 *   ② **实时数据不入 wiki**。本模块只落「判断与口径」，不落平台能直接导出的数字。
 *   ③ **写页面必走锁定模板**（见 wiki-frontmatter.ts），
 *      本模块的 savePage 接受已渲染好的内容，不提供「直接写 YAML」的入口。
 *
 * 安全：所有读写都限制在 wikiRoot 内，越界一律拒绝。
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { join, resolve, sep, relative } from 'node:path'
import { DOMAIN_NAMES, getDomain } from './wiki-schema.js'
import { checkPageText, type ValidationIssue } from './wiki-frontmatter.js'

/** 索引条目 */
export interface WikiEntry {
  /** 相对 wikiRoot 的路径 */
  path: string
  /** 所属域 */
  domain: string
  /** 页面形态 */
  kind: '实体' | '概念' | '未知'
  /** 标题（取自 frontmatter title） */
  title: string
  /** 一句话描述 */
  description: string
  /** 披露等级 */
  disclosure: string
  /** 最后修订时间（取自 frontmatter timestamp） */
  timestamp: string
  /** 文件字节数 */
  size: number
}

export interface WikiStats {
  /** wikiRoot 是否存在 */
  exists: boolean
  /** 总页数 */
  total: number
  /** 各域页数 */
  byDomain: Record<string, number>
  /** 实体 / 概念页数 */
  entities: number
  concepts: number
  /** 有校验问题的页面数 */
  invalid: number
}

export function createWikiStore(wikiRoot: string) {
  const root = resolve(wikiRoot || join(process.cwd(), 'wiki'))

  function assertInside(target: string): string {
    const abs = resolve(target)
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`拒绝越界访问：${abs} 不在 wiki 根目录 ${root} 内`)
    }
    return abs
  }

  /** 域目录：实体页与概念页分开 */
  function domainDir(domain: string): string {
    return join(root, domain)
  }

  /**
   * 生成页面的目标路径。
   *
   * Accio 约定：**文件名应能唯一映射 title**。这里用 `<title>.md`，
   * 但必须清洗掉路径分隔符与 Windows 保留字符，否则标题里的 `/`（如「服装/男装/T恤」）
   * 会意外创建子目录。
   */
  function pagePath(domain: string, kind: '实体' | '概念', title: string): string {
    const safe = sanitizeFilename(title)
    if (!safe) throw new Error(`页面标题无法转成合法文件名：${title}`)
    const sub = kind === '概念' ? 'concepts' : 'entities'
    return join(root, domain, sub, `${safe}.md`)
  }

  return {
    root,

    /** 初始化目录骨架（幂等） */
    async init(): Promise<void> {
      await mkdir(join(root, 'raw'), { recursive: true })
      for (const d of DOMAIN_NAMES) {
        await mkdir(join(root, d, 'entities'), { recursive: true })
        await mkdir(join(root, d, 'concepts'), { recursive: true })
      }
      await mkdir(join(root, 'meta'), { recursive: true })
      // PRINCIPLES.md：披露边界，人工维护，首次生成骨架
      const principles = join(root, 'PRINCIPLES.md')
      if (!existsSync(principles)) {
        await writeFile(principles, PRINCIPLES_TEMPLATE, 'utf8')
      }
      // log.md：编译日志与达标待办
      const logFile = join(root, 'log.md')
      if (!existsSync(logFile)) {
        await writeFile(logFile, LOG_TEMPLATE, 'utf8')
      }
    },

    /**
     * 写入一个页面。
     *
     * ★ 刻意要求调用方传入**已渲染**的内容（由 wiki-frontmatter.renderPage 产出），
     *   本方法不负责生成 YAML —— 这是 Accio「frontmatter 必须经脚本生成」的落点。
     *   写入前会做一次静态校验，有问题默认拒绝写入（可 force 绕过并记日志）。
     */
    async savePage(opts: {
      domain: string
      kind: '实体' | '概念'
      title: string
      content: string
      force?: boolean
    }): Promise<{ ok: boolean; path?: string; issues?: ValidationIssue[]; error?: string }> {
      if (!getDomain(opts.domain)) return { ok: false, error: `未知领域：${opts.domain}` }
      const issues = checkPageText(opts.content)
      const errors = issues.filter(i => i.severity === 'error')
      if (errors.length && !opts.force) {
        return {
          ok: false,
          issues,
          error: `页面未通过校验（${errors.length} 项）：\n` + errors.map(i => `- [${i.code}] ${i.message}`).join('\n'),
        }
      }
      let file: string
      try {
        file = assertInside(pagePath(opts.domain, opts.kind, opts.title))
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      try {
        await mkdir(join(file, '..'), { recursive: true })
        await writeFile(file, opts.content, 'utf8')
      } catch (e) {
        return { ok: false, error: `写入失败：${e instanceof Error ? e.message : String(e)}` }
      }
      if (errors.length) {
        console.warn(`[dsagent-wiki] 页面 ${opts.title} 已强制写入，但存在 ${errors.length} 项校验问题`)
      }
      return { ok: true, path: relative(root, file).replace(/\\/g, '/'), issues }
    },

    /** 读取一个页面 */
    async readPage(relPath: string): Promise<{ ok: boolean; content?: string; error?: string }> {
      let abs: string
      try {
        abs = assertInside(join(root, relPath))
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      try {
        return { ok: true, content: await readFile(abs, 'utf8') }
      } catch (e) {
        return { ok: false, error: `读取失败：${e instanceof Error ? e.message : String(e)}` }
      }
    },

    /** 列出全部页面（含 frontmatter 摘要） */
    async listEntries(opts?: { domain?: string; kind?: '实体' | '概念' }): Promise<WikiEntry[]> {
      if (!existsSync(root)) return []
      const out: WikiEntry[] = []
      const domains = opts?.domain ? [opts.domain] : DOMAIN_NAMES
      for (const d of domains) {
        if (!getDomain(d)) continue
        const subs: Array<{ dir: string; kind: '实体' | '概念' }> = []
        if (!opts?.kind || opts.kind === '实体') subs.push({ dir: join(root, d, 'entities'), kind: '实体' })
        if (!opts?.kind || opts.kind === '概念') subs.push({ dir: join(root, d, 'concepts'), kind: '概念' })
        for (const { dir, kind } of subs) {
          let files: string[]
          try {
            files = (await readdir(dir)).filter(f => f.endsWith('.md'))
          } catch { continue }
          for (const f of files) {
            const abs = join(dir, f)
            try {
              const st = await stat(abs)
              const text = await readFile(abs, 'utf8')
              const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
              const block = fm?.[1] ?? ''
              out.push({
                path: relative(root, abs).replace(/\\/g, '/'),
                domain: d,
                kind,
                title: pick(block, 'title') || f.replace(/\.md$/, ''),
                description: pick(block, 'description'),
                disclosure: pick(block, '披露等级'),
                timestamp: pick(block, 'timestamp'),
                size: st.size,
              })
            } catch { /* 单文件失败不影响整体列举 */ }
          }
        }
      }
      out.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path))
      return out
    },

    /** 统计概览 */
    async stats(): Promise<WikiStats> {
      const entries = await this.listEntries()
      const byDomain: Record<string, number> = {}
      for (const d of DOMAIN_NAMES) byDomain[d] = 0
      for (const e of entries) byDomain[e.domain] = (byDomain[e.domain] ?? 0) + 1
      let invalid = 0
      for (const e of entries) {
        try {
          const text = await readFile(join(root, e.path), 'utf8')
          if (checkPageText(text).some(i => i.severity === 'error')) invalid++
        } catch { /* 读不到就不计 */ }
      }
      return {
        exists: existsSync(root),
        total: entries.length,
        byDomain,
        entities: entries.filter(e => e.kind === '实体').length,
        concepts: entries.filter(e => e.kind === '概念').length,
        invalid,
      }
    },

    /**
     * 生成 INDEX.md —— 八域总索引。
     *
     * Accio 验收项 1：**INDEX.md 内跳转链接必须可达**。
     * 因此这里只索引实际存在的文件，不做「预留条目」。
     */
    async buildIndex(): Promise<{ ok: boolean; path: string; total: number }> {
      const entries = await this.listEntries()
      const lines: string[] = [
        '# 商家知识 Wiki 索引',
        '',
        '> 本文件由插件自动生成，请勿手工编辑（下次生成会覆盖）。',
        `> 共 ${entries.length} 页：实体 ${entries.filter(e => e.kind === '实体').length} / 概念 ${entries.filter(e => e.kind === '概念').length}`,
        '',
        '## 使用须知',
        '',
        '- 本 wiki 只存**判断与口径**，平台能直接导出的实时数字（价格、库存、当日流量）请走实时工具。',
        '- 机密字段（价格底线、成本、客户名单、财务数据）不得进入对外回答，详见 [PRINCIPLES.md](PRINCIPLES.md)。',
        '',
      ]
      for (const d of DOMAIN_NAMES) {
        const domain = getDomain(d)!
        const items = entries.filter(e => e.domain === d)
        lines.push(`## ${d}（${items.length}）`, '', `> ${domain.boundary}`, '')
        if (!items.length) {
          lines.push('_暂无页面。_', '')
          continue
        }
        const ents = items.filter(e => e.kind === '实体')
        const cons = items.filter(e => e.kind === '概念')
        if (ents.length) {
          lines.push('### 实体')
          for (const e of ents) {
            lines.push(`- [${e.title}](${encodeURI(e.path)})${e.description ? ` — ${e.description}` : ''}`)
          }
          lines.push('')
        }
        if (cons.length) {
          lines.push('### 概念')
          for (const e of cons) {
            lines.push(`- [${e.title}](${encodeURI(e.path)})${e.description ? ` — ${e.description}` : ''}`)
          }
          lines.push('')
        }
      }
      const file = join(root, 'INDEX.md')
      await mkdir(root, { recursive: true })
      await writeFile(file, lines.join('\n'), 'utf8')
      return { ok: true, path: file, total: entries.length }
    },

    /**
     * 追加一条编译日志 / 达标待办。
     *
     * Accio 要求：raw 中确无某必抓字段时不允许「硬凑覆盖率」，
     * 而是记入 log.md 的「达标待办」。日志**只追加不覆盖**。
     */
    async appendLog(line: string): Promise<void> {
      const file = join(root, 'log.md')
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      try {
        await mkdir(root, { recursive: true })
        const prev = existsSync(file) ? await readFile(file, 'utf8') : LOG_TEMPLATE
        await writeFile(file, `${prev.trimEnd()}\n\n- [${stamp}] ${line}\n`, 'utf8')
      } catch (e) {
        console.warn('[dsagent-wiki] 日志写入失败:', e instanceof Error ? e.message : String(e))
      }
    },

    /** 原始的 frontmatter 字段取值（供索引/检索用，导出以便测试） */
    _pick: pick,
  }
}

export type WikiStore = ReturnType<typeof createWikiStore>

/* ────────────────────────── 辅助 ────────────────────────── */

/** 从 frontmatter 文本取字段值（支持引号剥离；与 skill-quality 同一套口径） */
function pick(fm: string, key: string): string {
  if (!fm) return ''
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, 'm')
  const hit = fm.match(re)
  if (!hit) return ''
  let v = hit[1].trim()
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).trim()
  return v.replace(/^["']|["']$/g, '')
}

/**
 * 把标题转成安全文件名。
 *
 * 必须处理：路径分隔符（会意外建子目录）、Windows 保留字符、
 * 结尾的点与空格（Windows 上非法）、超长标题（截断到 100 字符）。
 */
export function sanitizeFilename(title: string): string {
  let s = String(title ?? '').trim()
  // 路径分隔符与 Windows 保留字符统一换成下划线
  s = s.replace(/[\\/:*?"<>|]/g, '_')
  // 控制字符
  s = s.replace(/[\u0000-\u001f]/g, '')
  // 结尾的点与空格（Windows 非法）
  s = s.replace(/[. ]+$/, '')
  // 折叠连续空白
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 100) s = s.slice(0, 100).trim()
  return s
}

/** 递归列出 wikiRoot 下所有 .md（供索引与排障） */
export function listMarkdownSync(wikiRoot: string): string[] {
  const out: string[] = []
  if (!existsSync(wikiRoot)) return out
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith('.md')) out.push(p)
    }
  }
  walk(wikiRoot, 0)
  return out
}

/* ────────────────────────── 模板 ────────────────────────── */

const PRINCIPLES_TEMPLATE = `# 使用原则与披露边界

> 本文件人工维护。编译 Wiki 前应先确定披露边界，再按披露等级过滤字段。

## 一、实时数据不入 Wiki

价格、库存、订单、物流、当日流量走实时工具；Wiki 只存对这些数据的理解、口径和策略。

## 二、平台客观数据不作为本体字段

平台后台能直接导出的挂牌价、销量、访客数、评分、等级属于 raw。
进入 Wiki 的应是「表现摘要 + 对比基准 + 判断」，而不是裸指标数值。

## 三、没有来源的判断不是知识

页级来源写在顶层 \`resource\`，正文中引用具体数值、报告或规则原文的段落带 \`[src: 文件名#L行号]\`。
由模型或商家推断得出的判断，必须在描述中说明是推断。

## 四、披露三档

| 等级 | 含义 |
|---|---|
| 可对外 | 可进入对买家的回答 |
| 仅内部 | 仅供内部运营决策 |
| 机密 | 价格底线、成本、客户名单、财务数据；**任何情况下不得对外** |

字段级披露声明优先于页级。机密字段不得进入话术模板与任何对外文档；
话术只存变量占位（\`{规格}\` / \`{包装形式}\` 等）。

## 五、缺席语义 = 留空不编造

raw 无数据的字段一律留空；建页锚点缺失时**放弃建页**而非编造；
必备章节因无数据留空的，记入 \`log.md\` 的「达标待办」，不硬凑覆盖率。
`

const LOG_TEMPLATE = `# 编译日志与达标待办

> 只追加不覆盖。记录本次编译做了什么、哪些必抓字段因 raw 无数据而留空。

## 达标待办

（raw 中确无某必抓字段时在此登记，不允许硬凑覆盖率）
`
