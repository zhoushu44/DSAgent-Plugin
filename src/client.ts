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
  ctx.locale.register(NS, {
    zh: {
      'entry.label': 'DSAgent',
      'entry.tooltip': '账号连接与业务技能',
      'tab.account': '账号连接',
      'tab.market': 'DSAgent 技能',
    },
    en: {
      'entry.label': 'DSAgent',
      'entry.tooltip': 'Account & Business Skills',
      'tab.account': 'Accounts',
      'tab.market': 'DSAgent Skills',
    },
  })

  const tt = ctx.locale.bind(NS)

  // ── 侧边栏图标按钮 ──
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

    // ── 中心面板（keyed slot，key=dsagent）──
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

    return () => {
      disposeSidebar()
      disposeMain()
    }
  }, 'dsagent: client UI')

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
    const [tab, setTab] = React.useState('account') as ['account' | 'market', (t: 'account' | 'market') => void]
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
            : skillMarketPage({ skill: createSkillService(config.skillRoot) as never, config })

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
      ),
      // 内容区
      React.createElement('div', {
        ref: containerRef,
        style: { flex: 1, overflow: 'auto', padding: '16px', background: '#f4f6fa' },
      }),
    )
  }
}
