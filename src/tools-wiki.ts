/**
 * Wiki 类工具定义（从 index.ts 原样迁移，行为不变）。
 *
 * 包含 5 个工具：dsagent_wiki_schema / wiki_template / wiki_write / wiki_search / wiki_stats。
 * Wiki store 为 apply() 内创建的服务实例，通过 deps 注入；
 * wiki-schema 与 wiki-frontmatter 为纯函数，直接 import。
 */
import { defineTool, renderToolOutput } from './tool-runtime.js'
import { getDomain, describeDomain, domainRoutingTable, DOMAIN_NAMES, RECEPTION_INTENTS } from './services/wiki-schema.js'
import { buildTemplate, templateToYaml, templateGuide } from './services/wiki-frontmatter.js'
import type { WikiStore } from './services/wiki-store.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

export interface WikiToolsDeps {
  wiki: WikiStore
}

export function buildWikiTools(deps: WikiToolsDeps): ToolDefinition[] {
  const { wiki } = deps

  return [
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
  ]
}
