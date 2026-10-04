/**
 * 客户端 bundle 冒烟测试（构建期把关）
 *
 * 为什么必须有这个文件：
 *   DSH 客户端的插件注册是"顺序执行 + 重复注册即抛错"，而 dsh-client-hmr 会在
 *   lib/client.js 变化后自动热重载（dispose 旧 fiber → 重新 apply）。一旦 apply()
 *   里任何一步抛错，后面的步骤全部不执行，**侧边栏入口和面板一起静默消失**：
 *   界面不报错、插件管理页不显示失败，只有 DevTools Console 里有一行
 *   `[cordis-client-runner] ... failed`。这类故障在 App 里极难自查。
 *
 *   本测试在构建后立刻用 node:vm 忠实重放 bundle：
 *     1) 首次挂载       —— 导出齐全、两个 slot 都注册上
 *     2) dispose + 重挂 —— 模拟 HMR 热重载，必须仍能挂载（这是最容易踩的坑）
 *     3) 严格模式       —— locale/slots 重复注册即抛错，与 DSH 真实行为一致
 *
 * 用法：node dev/smoke-client.mjs   （build 脚本已串联，构建后自动执行）
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = resolve(root, 'lib/client.js')
const PLUGIN_ID = '@dsagent/dsagent-plugin'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    failures++
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * DSH 客户端 locale 服务的忠实迷你实现。
 * 关键行为：同一命名空间重复注册同一语言 → 抛错（与 dsh-client-locale 一致）。
 */
function makeLocaleService() {
  const dicts = new Map()
  return {
    _dicts: dicts,
    register(ns, localeOrDicts, dict) {
      const pairs =
        typeof localeOrDicts === 'string' ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts)
      let locales = dicts.get(ns)
      if (!locales) {
        locales = new Map()
        dicts.set(ns, locales)
      }
      for (const [locale] of pairs) {
        if (locales.has(locale)) {
          throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
        }
      }
      for (const [locale, entries] of pairs) locales.set(locale, entries)
      return () => {
        for (const [locale, entries] of pairs) {
          if (locales.get(locale) === entries) locales.delete(locale)
        }
      }
    },
    bind: () => (k) => k,
  }
}

/**
 * DSH 客户端 slots 服务的忠实迷你实现。
 * 关键行为：list/keyed/single 槽位的同一 id/key 重复注册 → 抛错（与 dsh-client-ui-slots 一致）。
 */
function makeSlotsService() {
  const entries = [] // { name, id, key }
  const declared = new Set(['sidebar.panellist', 'main'])
  return {
    _entries: entries,
    inject(_key, callback) {
      // 真实实现里 inject 内部也会用 ctx.effect 包裹；这里同步执行以满足冒烟需求
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options) {
      if (!declared.has(options.name)) {
        throw new Error(`slot '${options.name}' is not declared`)
      }
      const same = entries.filter(
        (e) => e.name === options.name && e.id === options.id && e.key === options.key,
      )
      if (same.length > 0) {
        const ident = options.id ?? options.key
        throw new Error(`slot "${options.name}" already has an entry with ${options.id ? 'id' : 'key'} "${ident}"`)
      }
      entries.push({ name: options.name, id: options.id, key: options.key })
      return () => {
        const i = entries.findIndex(
          (e) => e.name === options.name && e.id === options.id && e.key === options.key,
        )
        if (i >= 0) entries.splice(i, 1)
      }
    },
  }
}

const React = {
  createElement: (tag, props, ...kids) => ({ tag, props, kids }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
}

/** 把 lib/client.js 载入 vm，取得 ModuleLoader 注册项与其 factory 产物。 */
function loadBundle() {
  const code = readFileSync(BUNDLE, 'utf8')
  const registrations = []
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, set innerHTML(_v) {} }),
      head: { appendChild() {} },
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.__ModuleLoader__ = {
    mode: 'queue',
    pendingQueue: registrations,
    load: (reg) => registrations.push(reg),
  }
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'lib/client.js' })

  if (registrations.length !== 1) {
    throw new Error(`expected exactly 1 ModuleLoader registration, got ${registrations.length}`)
  }
  const reg = registrations[0]
  if (reg.id !== PLUGIN_ID) {
    throw new Error(`registration id is "${reg.id}", expected "${PLUGIN_ID}"`)
  }
  const factory = reg.factory
  const moduleObj = { exports: {} }
  const exported = factory((spec) => {
    if (spec === 'react') return React
    throw new Error(`bundle requested unexpected external module: ${spec}`)
  })
  return exported ?? moduleObj.exports
}

/**
 * 按 Cordis 语义构造一个客户端 ctx。
 * ctx.effect 会登记回调返回的 disposer；dispose 时逆序执行（与 cordis 一致）。
 */
function makeCtx(locale, slots) {
  const disposables = []
  return {
    _disposeAll() {
      for (const d of [...disposables].reverse()) {
        try {
          d()
        } catch {}
      }
      disposables.length = 0
    },
    _disposableCount: () => disposables.length,
    locale,
    slots,
    effect(callback, _label) {
      const result = callback()
      if (typeof result === 'function') disposables.push(result)
      return () => {}
    },
    on() {},
    get() {
      return undefined
    },
  }
}

console.log(`\n[smoke] 重放 ${BUNDLE}`)

// ── 1. bundle 结构 ────────────────────────────────────────────────
let plugin
try {
  plugin = loadBundle()
  check('bundle 可载入并完成 ModuleLoader 注册', true)
} catch (error) {
  check('bundle 可载入并完成 ModuleLoader 注册', false, error.message)
  console.error('\n冒烟测试失败：bundle 无法载入\n')
  process.exit(1)
}

check('导出 apply', typeof plugin.apply === 'function', `实际类型 ${typeof plugin.apply}`)
check('导出 inject', Array.isArray(plugin.inject), `实际类型 ${typeof plugin.inject}`)
check('声明依赖 slots + locale', Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('locale'), JSON.stringify(plugin.inject))

// ── 2. 首次挂载 ───────────────────────────────────────────────────
const locale = makeLocaleService()
const slots = makeSlotsService()

let ctx1
try {
  ctx1 = makeCtx(locale, slots)
  plugin.apply(ctx1, { skillRoot: '/tmp/skills', storePath: '/tmp/accounts.json', guideOnUnbound: true })
  check('首次挂载 apply() 不抛错', true)
} catch (error) {
  check('首次挂载 apply() 不抛错', false, error.message)
}

const mounted1 = slots._entries.map((e) => `${e.name}:${e.id ?? e.key}`)
check('注册侧边栏入口 sidebar.panellist:dsagent', mounted1.includes('sidebar.panellist:dsagent'), mounted1.join(', ') || '(无)')
check('注册中心面板 main:dsagent', mounted1.includes('main:dsagent'), mounted1.join(', ') || '(无)')

// ── 3. dispose + 热重载重挂（最关键：这是历史事故点）────────────────
try {
  ctx1?._disposeAll()
  check('dispose 旧 fiber 不抛错', true)
} catch (error) {
  check('dispose 旧 fiber 不抛错', false, error.message)
}

const entriesAfterDispose = slots._entries.length
check('dispose 后 slot 注册项被撤下', entriesAfterDispose === 0, `仍剩 ${entriesAfterDispose} 项`)

let ctx2
try {
  ctx2 = makeCtx(locale, slots)
  plugin.apply(ctx2, { skillRoot: '/tmp/skills', storePath: '/tmp/accounts.json', guideOnUnbound: true })
  check('热重载后重新 apply() 不抛错（HMR 回归）', true)
} catch (error) {
  check('热重载后重新 apply() 不抛错（HMR 回归）', false, error.message)
}

const mounted2 = slots._entries.map((e) => `${e.name}:${e.id ?? e.key}`)
check('热重载后侧边栏入口仍在', mounted2.includes('sidebar.panellist:dsagent'), mounted2.join(', ') || '(无)')
check('热重载后中心面板仍在', mounted2.includes('main:dsagent'), mounted2.join(', ') || '(无)')

// ── 4. 连续多次重载（HMR 可能连触发）─────────────────────────────
let reloadOk = true
let reloadDetail = ''
let lastCtx = ctx2
for (let i = 0; i < 3; i++) {
  try {
    lastCtx?._disposeAll()
    const c = makeCtx(locale, slots)
    plugin.apply(c, { skillRoot: '/tmp/skills', storePath: '/tmp/accounts.json', guideOnUnbound: true })
    lastCtx = c
  } catch (error) {
    reloadOk = false
    reloadDetail = `第 ${i + 2} 次重载失败：${error.message}`
    break
  }
}
check('连续多次热重载仍能挂载', reloadOk, reloadDetail)

// ── 5. 步骤隔离（某一步失败不得殃及其它步骤）──────────────────────
// 模拟未来某天 slots 约定变化 / 重复注册：让 sidebar.panellist 的注册必然抛错，
// 中心面板 main 必须仍能独立挂载，且 apply() 不得向外抛错。
const failSlots = makeSlotsService()
const realRegister = failSlots.register.bind(failSlots)
failSlots.register = (options) => {
  if (options.name === 'sidebar.panellist') {
    throw new Error('list slot "sidebar.panellist" already has an entry with id "dsagent"')
  }
  return realRegister(options)
}

let isolationThrew = null
const isolationCtx = makeCtx(makeLocaleService(), failSlots)
try {
  plugin.apply(isolationCtx, { skillRoot: '/tmp/skills', storePath: '/tmp/accounts.json', guideOnUnbound: true })
} catch (error) {
  isolationThrew = error
}
check('某步骤失败时 apply() 不向外抛错', isolationThrew === null, isolationThrew?.message)
const isolationMounted = failSlots._entries.map((e) => `${e.name}:${e.id ?? e.key}`)
check('侧边栏步骤失败后，中心面板仍独立挂载', isolationMounted.includes('main:dsagent'), isolationMounted.join(', ') || '(无)')


// ── 结论 ─────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n[smoke] ❌ 冒烟测试失败：${failures} 项未通过`)
  console.error('[smoke] 这类故障在 App 里的表现是"插件 UI 静默消失"，务必先修好再重载。\n')
  process.exit(1)
}
console.log('[smoke] ✅ 全部通过：bundle 结构、首次挂载、HMR 热重载重挂、连续重载\n')
