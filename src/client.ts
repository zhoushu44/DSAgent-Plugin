/**
 * DSAgent 插件 — Browser 半区（运行在 DSH Web GUI 浏览器侧）
 *
 * 注册两个 slot：
 *   1. sidebar.panellist（list）— 侧边栏图标按钮，点击切换到 dsagent 面板
 *   2. main（keyed，key=dsagent）— 中心面板，包含账号连接 + 技能市场两个 tab
 *
 * 必须使用 React.createElement，不能用 JSX（动态插件不经 babel/tsc 编译）
 */

/// <reference path="./dsh-client.d.ts" />
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { Config } from './index.js'
import { accountPage } from './ui/account-page.js'
import { skillMarketPage } from './ui/skill-market-page.js'
import { workflowPage } from './workflow/page.js'
import { createAccountService } from './services/account-service.js'
import { createSkillService } from './services/skill-service.js'

// React 由 DSH 运行时注入，构建时不安装 react 包
declare const React: {
  createElement: any
  useState: any
  useEffect: any
  useRef: any
}

// 类型别名，避免 any 上使用泛型报错
type _State<S> = S

export const name = 'dsagent-client'

/** 依赖声明：等 slots 和 locale 服务就绪后再调用 apply */
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext, cfg?: Config) {
  const config: Config = cfg ?? {
    skillRoot: '',
    storePath: '',
    guideOnUnbound: true,
  }

  /* ─── HTTP 路由已由 host 半区 (index.ts) 通过 ctx.inject(['webServer']) 注册 ─── */

  const NS = 'dsagent'

  /**
   * 隔离执行一个挂载步骤。
   *
   * 背景（这是本插件最脆弱的一环）：DSH 的 slots / locale 在**重复注册**时一律抛错
   * （`list slot "sidebar.panellist" already has an entry with id "dsagent"`、
   * `locale namespace "dsagent" already has locale "zh"` …），而客户端热重载
   * （dsh-client-hmr 轮询 lib/client.js，重建后自动 dispose 旧 fiber 再重新 apply）
   * 恰好会走到"重复注册"这条路径。apply() 是顺序执行的，任何一步抛错都会让
   * **后面所有步骤都不执行**——侧边栏图标和面板一起消失，且界面不报错、插件管理页
   * 也不显示失败，只有 DevTools Console 有 `[cordis-client-runner] ... failed`。
   *
   * 所以每个步骤独立 try/catch：某一步失败只损失它对应的功能，不会殃及其它步骤。
   * 失败一律 console.error 带步骤名，保证"看得见"。
   */
  function step(label: string, run: () => void) {
    try {
      run()
    } catch (error) {
      console.error(`[dsagent] 挂载步骤失败（${label}）：`, error)
    }
  }

  // ★ 必须放进 ctx.effect：locale.register 返回的 disposer 只有在 effect 里才会
  //   被 Cordis 登记，dispose 时才会撤下字典。裸调用会把 disposer 丢掉，于是热重载
  //   时 locale.register 会抛 `already has locale "zh"`。
  //   try/catch 兜住"由旧版本裸注册遗留、无法撤下"的字典，保证这种情况也能挂载。
  step('locale 字典', () => {
    ctx.effect(() => {
      const dicts = {
        zh: {
          'entry.label': 'DSAgent',
          'entry.tooltip': '账号连接与业务技能',
          'tab.account': '账号连接',
          'tab.market': 'DSAgent 技能',
          'tab.workflow': '工作流',
        },
        en: {
          'entry.label': 'DSAgent',
          'entry.tooltip': 'Account & Business Skills',
          'tab.account': 'Accounts',
          'tab.market': 'DSAgent Skills',
          'tab.workflow': 'Workflow',
        },
      }
      try {
        const disposeDicts = ctx.locale.register(NS, dicts)
        return typeof disposeDicts === 'function' ? disposeDicts : () => {}
      } catch (error) {
        // 已存在同命名空间字典（旧 fiber 遗留）：沿用已有字典，不阻断 UI 挂载
        console.warn('[dsagent] locale 字典已存在，跳过注册：', error)
        return () => {}
      }
    }, 'dsagent: dictionaries')
  })

  const tt = ctx.locale.bind(NS)

  // ── 侧边栏图标按钮 ──
  step('侧边栏入口', () => {
    ctx.effect(() => {
      const disposeSidebar = ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'dsagent',
            order: 80,
            locale: NS,
            label: () => tt('entry.label'),
          },
          SidebarButton,
        ),
      )
      return () => disposeSidebar()
    }, 'dsagent: sidebar entry')
  })

  // ── 中心面板（keyed slot，key=dsagent）──
  // 与侧边栏入口分开成独立步骤：即使入口注册失败，面板仍可挂载（反之亦然）。
  step('中心面板', () => {
    ctx.effect(() => {
      const disposeMain = ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'dsagent',
            locale: NS,
            label: () => tt('entry.label'),
          },
          DSAgentPanel,
        ),
      )
      return () => disposeMain()
    }, 'dsagent: main panel')
  })

  // ── 对话页输入框上方：动态推荐指令条（点击填充输入框，等用户确认发送）──
  // 机制（官方通道，与 ui-goal/todo 同款）：
  //   'conversation.input.dock' 是 session-scope list slot，渲染在 composer 上方；
  //   标准注入两组 props：
  //   - ui-conversation: props.inputActions（setDraft/submit/...）、props.session（含 blank）
  //   - ui-chat:        props.useChat（hooks ['chat'] → useChat），可读聊天记录
  //   推荐逻辑：读 useChat().navigation.items() 的 prompt/response 文本预览，
  //   跑平台/动作关键词匹配 → 推断「平台 × 链路阶段」→ 换 chips。
  step('示例指令条', () => {
    ctx.effect(() => {
      const disposeSuggest = ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'dsagent-suggest',
            order: 15,
            locale: NS,
          },
          SuggestDock,
        ),
      )
      return () => disposeSuggest()
    }, 'dsagent: suggest dock')
  })

  // ── 动态推荐：数据 ──
  // 链路：collect（采集）→ analyze（分析）→ publish（发布）→ manage（账号/工具）
  type Stage = 'collect' | 'analyze' | 'publish' | 'manage'
  interface Suggestion {
    readonly label: string
    readonly text: string
    readonly platform?: string
    readonly stage: Stage
  }

  // 平台词表：聊天文本命中即判定当前平台（含别名）
  const PLATFORM_WORDS: ReadonlyArray<{ readonly platform: string; readonly words: readonly string[] }> = [
    { platform: 'douyin', words: ['抖音', 'douyin', 'tiktok'] },
    { platform: 'taobao', words: ['淘宝', 'taobao', '天猫'] },
    { platform: '1688', words: ['1688', '阿里巴巴批发', '批发市场'] },
    { platform: 'xiaohongshu', words: ['小红书', 'xiaohongshu', '红书'] },
    { platform: 'zhihu', words: ['知乎', 'zhihu'] },
    { platform: 'bilibili', words: ['b站', '哔哩哔哩', 'bilibili', '哔站'] },
    { platform: 'xianyu', words: ['闲鱼', 'xianyu'] },
    { platform: 'pdd', words: ['拼多多', 'pdd'] },
    { platform: 'dingtalk', words: ['钉钉', 'dingtalk'] },
  ]

  // 动作词表：判定最近完成的链路阶段
  // ★ 2026-10-24 补：
  //   · collect 加「看下/查一下/数据/多少」等口语词——用户说
  //     「看下多多视频的带货数据」时旧词表判不出 stage，推荐直接掉到初始态。
  //   · publish 加「上传」单词（不是「上传视频」四连字）——用户实际说
  //     「帮我上传一条多多视频」，「上传」和「视频」不连续，四连词匹配不到。
  //   · publish 加「开推广/提价/改日限额」——推广写操作也是 publish 阶段。
  const STAGE_WORDS: ReadonlyArray<{ readonly stage: Stage; readonly words: readonly string[] }> = [
    { stage: 'collect', words: ['采集', '爬取', '抓取', '爬虫', '抓取数据', '获取数据', '拿数据', '看下', '查一下', '查拼多多', '数据', '多少'] },
    { stage: 'analyze', words: ['分析', '统计', '对比', '选品', '分层', '诊断', '平衡', '评价分析'] },
    { stage: 'publish', words: ['发布', '上传', '投稿', '发笔记', '上架', '铺货', '开推广', '提价', '改日限额'] },
    { stage: 'manage', words: ['账号', '绑定', '连接状态', '登录', '风控', '权限'] },
  ]

  // 推荐清单：按「平台 × 链路阶段」索引；platform 缺省 = 任意平台可用
  const SUGGESTIONS: readonly Suggestion[] = [
    // 初始态：平台入口（各平台代表动作）
    { label: '采集抖音热门视频', text: '采集抖音热门视频数据', platform: 'douyin', stage: 'collect' },
    { label: '采集小红书笔记', text: '采集小红书笔记数据', platform: 'xiaohongshu', stage: 'collect' },
    { label: '1688智能选品', text: '帮我做1688选品分析', platform: '1688', stage: 'analyze' },
    { label: '分析商品评价', text: '分析这个商品的评价，链接：', stage: 'analyze' },
    { label: '查看账号连接状态', text: '查看我的账号连接状态', stage: 'manage' },
    // 抖音链路
    { label: '分析刚采集的视频', text: '分析刚才采集的抖音视频数据', platform: 'douyin', stage: 'analyze' },
    { label: '采集抖音商品榜', text: '采集抖音商品榜数据', platform: 'douyin', stage: 'collect' },
    { label: '发布抖音视频', text: '帮我发布一条抖音视频', platform: 'douyin', stage: 'publish' },
    // 淘宝链路
    { label: '分析淘宝商品评价', text: '分析这个淘宝商品的评价，链接：', platform: 'taobao', stage: 'analyze' },
    { label: '发布淘宝商品', text: '帮我上架一个淘宝商品', platform: 'taobao', stage: 'publish' },
    // 小红书链路
    { label: '分析小红书笔记', text: '分析采集到的小红书笔记数据', platform: 'xiaohongshu', stage: 'analyze' },
    { label: '发布小红书笔记', text: '帮我发布一篇小红书笔记', platform: 'xiaohongshu', stage: 'publish' },
    // ════════════ 拼多多链路（9 技能闭环，2026-10-24 补全）════════════
    // 真实运营链路：选品 → 发布 → 视频 → ★拿数据 → 推广 → 优化 → 风控
    // collect 阶段的四个数据入口按「发布后最可能点的」排序：
    //   视频带货数据 → 单个视频 → 推广数据 → 店铺数据 → 机会商品
    // （publish 的下一阶段是 collect，会取 collect 前几项，顺序即优先级）
    { label: '看多多视频带货数据', text: '看下多多视频的带货数据', platform: 'pdd', stage: 'collect' },
    { label: '看单个视频的数据', text: '看下刚发布那条视频的数据', platform: 'pdd', stage: 'collect' },
    { label: '看拼多多推广数据', text: '看下拼多多推广花了多少钱、ROI 多少', platform: 'pdd', stage: 'collect' },
    { label: '查拼多多店铺数据', text: '看下拼多多店铺的经营数据', platform: 'pdd', stage: 'collect' },
    { label: '看拼多多机会商品', text: '看下拼多多机会商品，平台推荐卖什么', platform: 'pdd', stage: 'collect' },
    { label: '采集拼多多商品', text: '采集拼多多商品数据', platform: 'pdd', stage: 'collect' },
    { label: '分析拼多多商品', text: '分析拼多多商品数据', platform: 'pdd', stage: 'analyze' },
    // 选品/分析后 → 发布
    { label: '上架拼多多商品', text: '帮我上架一个拼多多商品', platform: 'pdd', stage: 'publish' },
    { label: '一款铺多条链接', text: '帮我把一个款铺多条拼多多链接', platform: 'pdd', stage: 'publish' },
    // 发布后 → 视频（第二增长曲线）
    { label: '上传多多视频', text: '帮我上传一条多多视频', platform: 'pdd', stage: 'publish' },
    // 拿数据后 → 推广诊断/优化
    { label: '查推广商品图 CTR', text: '看下拼多多推广里哪个商品的主图点击率低', platform: 'pdd', stage: 'analyze' },
    { label: '推广诊断该加价还是降价', text: '帮我做拼多多推广平衡分析，看该加价还是降价', platform: 'pdd', stage: 'analyze' },
    // 优化后 → 管理/风控/权限
    { label: '看拼多多账号状态', text: '看下拼多多账号的连接状态和风控情况', platform: 'pdd', stage: 'manage' },
    { label: '看多多视频权限', text: '看下多多视频的带货权限和流量卡奖励', platform: 'pdd', stage: 'manage' },
    // 通用下一步
    { label: '发布到其他平台', text: '把结果整理后发布到', stage: 'publish' },
  ]

  // ── 动态推荐：规则引擎 ──
  /** 从最近几轮 prompt/response 文本推断「平台 × 已完成阶段」。 */
  function inferContext(items: readonly { readonly prompt: string; readonly response: string }[]): { platform?: string; stage?: Stage } {
    // 取最近 3 轮，从最新往回扫：最新一轮命中的才算数（话题会切换，
    // 旧轮次的动作词不该覆盖新话题；如「查看账号连接状态」的「账号」
    // 不该把之后的「分析商品评价」阶段抢成 manage）。
    const recent = items.slice(-3)
    if (recent.length === 0) return {}

    // 平台：逐轮（新→旧）在 prompt+response 里找；助手回复也常提平台名
    // （如「已采集抖音视频 50 条」），可作辅助。轮内 prompt 优先于
    // response——用户说的是主话题，回复里顺带提到其他平台（如「也可
    // 试试闲鱼」）不该抢走平台；同段内词表序先命中先得。
    let platform: string | undefined
    for (let i = recent.length - 1; i >= 0 && !platform; i--) {
      const { prompt, response } = recent[i]
      for (const segment of [prompt, response]) {
        for (const entry of PLATFORM_WORDS) {
          if (entry.words.some((w) => segment.includes(w))) {
            platform = entry.platform
            break
          }
        }
        if (platform) break
      }
    }

    // 阶段：逐轮（新→旧）只看用户 prompt——助手回复常含「账号 xxx」
    // 「分析完成」等系统噪声，会把刚完成的动作误判成 manage/analyze（实测踩坑）。
    // 轮内取词表序最后一个命中（collect→analyze→publish→manage，越靠后越是刚完成的动作）。
    let stage: Stage | undefined
    for (let i = recent.length - 1; i >= 0 && !stage; i--) {
      const prompt = recent[i].prompt
      for (const entry of STAGE_WORDS) {
        if (entry.words.some((w) => prompt.includes(w))) stage = entry.stage
      }
    }
    return { platform, stage }
  }

  /** 依「平台 × 链路阶段」生成推荐 chips（最多 5 条）。 */
  function pickSuggestions(context: { platform?: string; stage?: Stage }): readonly Suggestion[] {
    const { platform, stage } = context
    if (!platform && !stage) {
      // 初始态：清单前 5 条即平台入口组（见 SUGGESTIONS 排列，避免误捞后段链路 chips）
      return SUGGESTIONS.slice(0, 5)
    }

    // ★ 平台专属链路覆盖（2026-10-24）
    //   通用链路是 collect→analyze→publish→manage→collect，
    //   但拼多多的真实运营链路是「发布后要拿数据」：
    //     选品(collect) → 分析(analyze) → 发布(publish) → ★拿数据(collect)
    //       → 推广数据(collect) → 诊断优化(analyze) → 风控权限(manage)
    //   所以 pdd 的 publish 下一阶段必须是 collect，不是 manage。
    const PLATFORM_NEXT: Record<string, Partial<Record<Stage, Stage>>> = {
      pdd: { publish: 'collect', analyze: 'publish', collect: 'analyze', manage: 'collect' },
    }
    const override = platform ? PLATFORM_NEXT[platform] : undefined

    // 链路推进：当前 stage 的下一阶段，同平台优先
    const order: Record<Stage, Stage> = { collect: 'analyze', analyze: 'publish', publish: 'manage', manage: 'collect' }
    const nextStage = (stage && override?.[stage]) || (stage ? order[stage] : 'collect')
    const next = SUGGESTIONS.filter((s) => s.stage === nextStage)
    const samePlatform = next.filter((s) => s.platform === platform)
    const anyPlatform = next.filter((s) => s.platform === undefined)
    // 同阶段相邻动作作补位（如采集完视频 → 再采集商品榜），排在下阶段项之后
    const sameStage = SUGGESTIONS.filter((s) => s.platform === platform && s.stage === stage)
    // 无平台场景（如「查看账号连接状态」后的 manage→collect）同平台下阶段项可能全空，
    // 回落到其他平台的下阶段项——否则只剩用户刚用过的那条，推荐原地踏步
    const nextPool = samePlatform.length + anyPlatform.length > 0 ? [...samePlatform, ...anyPlatform] : next
    // ★ 2026-10-24：同阶段补位保底占 2 席。
    //   拼多多同一 stage 下有多个并列入口（collect 有 机会商品/店铺数据/
    //   视频带货数据/推广数据 四条），若全被下阶段项挤掉，用户只能看到
    //   「分析」而看不到他想点的下一条数据入口 —— 链路看起来是断的。
    const head = nextPool.slice(0, 3)
    const tail = sameStage.slice(0, 2)
    const rest = nextPool.slice(3)
    const pool = [...head, ...tail, ...rest]
    // 去重保序，最多 5 条
    const seen = new Set<string>()
    return pool.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true))).slice(0, 5)
  }

  // ── 动态推荐指令条组件 ──
  // useChat 签名（SnapshotSelectorHook）：<S>(sel: (s: ChatSnapshot) => S) => S
  interface ChatNavItem { readonly prompt: string; readonly response: string }
  // 稳定空数组：selector 里「?? []」若每次新建数组，getSnapshot 身份不稳定
  // 会让 useSyncExternalStore 判定持续变化（可能无限重渲），必须用常量。
  const NO_CHAT_ITEMS: readonly ChatNavItem[] = []
  // 无 ui-chat 时的占位 hook（保持调用数恒定，满足 Rules of Hooks）
  const NO_CHAT_HOOK = (sel: (s: { navigation?: { items(): readonly ChatNavItem[] } }) => readonly ChatNavItem[]) =>
    sel({ navigation: undefined })
  interface SuggestDockProps {
    inputActions?: { setDraft: (text: string) => void } | undefined
    session?: { blank?: boolean } | undefined
    useChat?: (<S>(sel: (s: { navigation?: { items(): readonly ChatNavItem[] } }) => S) => S) | undefined
    [key: string]: unknown
  }

  function SuggestDock(props: SuggestDockProps) {
    // useChat 是 React hook，必须无条件、每次渲染以相同顺序调用
    //（早退 return 之前），否则违反 Rules of Hooks。
    const useChat = props.useChat ?? NO_CHAT_HOOK
    const items = useChat((s) => s.navigation?.items() ?? NO_CHAT_ITEMS)
    // ★ 2026-10-24：setDraft 不再是「必需」。宿主不注入 inputActions 时
    //   原来直接 return null → 整条推荐消失（v11.0 引入至今从未渲染过，
    //   实测 DSH 确实不给这个 prop）。现在降级为「无 setDraft 也渲染」，
    //   点击走三级兜底：inputActions.setDraft → 直写 composer → 复制到剪贴板。
    const setDraft = props.inputActions?.setDraft

    // 读聊天记录推断上下文；hook 不存在或无消息时回落初始态
    const blankSession = props.session?.blank === true || items.length === 0
    const context = blankSession ? {} : inferContext(items)
    const suggestions = pickSuggestions(context)

    /** 点击兜底链：优先用宿主 API，其次直写输入框，最后复制到剪贴板 */
    const fillInput = (text: string) => {
      if (setDraft) { try { setDraft(text); return true } catch { /* 继续降级 */ } }
      // 直写 composer：优先 contenteditable（DSH 用的是它），其次 textarea/input
      const editable = document.querySelector(
        '[contenteditable="true"], textarea, input[type="text"]',
      ) as HTMLElement | null
      if (editable) {
        try {
          if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
            editable.value = text
          } else {
            editable.innerText = text
          }
          editable.dispatchEvent(new Event('input', { bubbles: true }))
          editable.dispatchEvent(new Event('change', { bubbles: true }))
          editable.focus?.()
          // 把光标移到末尾，方便直接接着改
          const sel = window.getSelection()
          const range = document.createRange()
          range.selectNodeContents(editable)
          range.collapse(false)
          sel?.removeAllRanges()
          sel?.addRange(range)
          return true
        } catch { /* 继续降级 */ }
      }
      // 最后：复制到剪贴板，用户手动粘贴
      try {
        void navigator.clipboard?.writeText(text)
        return false
      } catch { return false }
    }

    return React.createElement(
      'div',
      {
        style: {
          // 与宿主 composer 卡片左对齐 + 随宽度自适应：直接用宿主的
          // --dsh-composer-card-max-width（卡片实际宽度变量），margin: 0 auto。
          maxWidth: 'var(--dsh-composer-card-max-width, 720px)',
          margin: '0 auto',
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '4px 0',
        },
      },
      ...suggestions.map((s) =>
        React.createElement(
          'button',
          {
            type: 'button',
            key: s.label,
            onClick: () => {
              const ok = fillInput(s.text)
              if (!ok) {
                // 剪贴板兜底：给一眼可见的反馈（改标题 2 秒）
                const btn = document.activeElement as HTMLElement | null
                if (btn) {
                  const old = btn.textContent
                  btn.textContent = '已复制，请粘贴'
                  setTimeout(() => { btn.textContent = old }, 2000)
                }
              }
            },
            style: {
              // 暗色主题适配：跟随宿主前景/描边语义变量，缺省回退到中性灰
              border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12))',
              borderRadius: '999px',
              background: 'transparent',
              color: 'inherit',
              padding: '5px 12px',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            },
          },
          s.label,
        ),
      ),
    )
  }

  // ── 侧边栏图标组件 ──
  // ★ 必须渲染 span 而非 button：宿主 PanelRow 外层已是 <button onClick=selectPanel>，
  //   button 嵌套 button 是非法 HTML，浏览器解析时会把内层 button 拆出 DOM 层级，
  //   导致点击区域错乱（外层按钮被截断、只剩文字附近可点）。
  //   点击行为完全由宿主外层按钮接管，这里只负责显示图标。
  function SidebarButton(props: { active?: boolean; onClick?: () => void; size?: number; [key: string]: unknown }) {
    const size = props.size ?? 18
    return React.createElement(
      'span',
      {
        'data-slot-id': 'dsagent',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${size}px`,
          lineHeight: 1,
          // 继承宿主 panelRow 的颜色（active 态宿主自己会变色）
          color: 'inherit',
          // 纯图标：不吃 pointer 事件，点击穿透到宿主外层按钮
          pointerEvents: 'none',
          userSelect: 'none',
        },
      },
      '🔌',
    )
  }

  // ── 中心面板组件（含 tab 切换）──
  function DSAgentPanel() {
    const [tab, setTab] = React.useState('account') as ['account' | 'market' | 'workflow', (t: 'account' | 'market' | 'workflow') => void]
    const containerRef = React.useRef(null) as { current: HTMLDivElement | null }

    React.useEffect(() => {
      const el = containerRef.current
      if (!el) return

      // 每次切 tab 创建新的内部容器，避免旧 page 的监听叠加
      const inner = document.createElement('div')
      inner.style.height = '100%'
      el.innerHTML = ''
      el.appendChild(inner)

      let dispose: (() => void) | undefined
      let cancelled = false
      void (async () => {
        const page =
          tab === 'account'
            ? accountPage({ account: createAccountService(config.storePath) as never, config })
            : tab === 'market'
            ? skillMarketPage({ skill: createSkillService(config.skillRoot) as never, config })
            : workflowPage({ config })

        const raw = await page.html()
        // 提取 <style> 块
        const body = raw.replace(/<style>([\s\S]*?)<\/style>/g, (_m: string, css: string) => {
          const styleEl = document.createElement('style')
          styleEl.textContent = css
          document.head.appendChild(styleEl)
          return ''
        })
        if (cancelled) return
        inner.innerHTML = body
        dispose = page.mount(inner)
      })()

      return () => {
        cancelled = true
        if (dispose) dispose()
        // 清空容器，彻底移除旧 DOM 节点及其监听
        el.innerHTML = ''
      }
    }, [tab])

    return React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      // Tab 栏
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            borderBottom: '1px solid #e6eaf2',
            background: '#fff',
            padding: '0 16px',
          },
        },
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setTab('account'),
            style: {
              border: 'none',
              background: 'none',
              padding: '12px 16px',
              cursor: 'pointer',
              color: tab === 'account' ? '#2b6cff' : '#67708a',
              borderBottom: `2px solid ${tab === 'account' ? '#2b6cff' : 'transparent'}`,
              fontWeight: tab === 'account' ? 600 : 400,
              fontSize: '13px',
              fontFamily: 'inherit',
            },
          },
          tt('tab.account'),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setTab('market'),
            style: {
              border: 'none',
              background: 'none',
              padding: '12px 16px',
              cursor: 'pointer',
              color: tab === 'market' ? '#2b6cff' : '#67708a',
              borderBottom: `2px solid ${tab === 'market' ? '#2b6cff' : 'transparent'}`,
              fontWeight: tab === 'market' ? 600 : 400,
              fontSize: '13px',
              fontFamily: 'inherit',
            },
          },
          tt('tab.market'),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setTab('workflow'),
            style: {
              border: 'none',
              background: 'none',
              padding: '12px 16px',
              cursor: 'pointer',
              color: tab === 'workflow' ? '#2b6cff' : '#67708a',
              borderBottom: `2px solid ${tab === 'workflow' ? '#2b6cff' : 'transparent'}`,
              fontWeight: tab === 'workflow' ? 600 : 400,
              fontSize: '13px',
              fontFamily: 'inherit',
            },
          },
          tt('tab.workflow'),
        ),
      ),
      // 内容区
      React.createElement('div', {
        ref: containerRef,
        style: { flex: 1, overflow: 'auto', padding: '16px', background: '#f4f6fa' },
      }),
    )
  }
}
