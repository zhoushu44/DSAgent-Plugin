#!/usr/bin/env node
/**
 * 直接加载觅千手完整发布模块（真正的复刻）。
 *
 * 做法：把 mqs-swarm/rea-gm-modules/ 下 215 个 webpack 模块全部读进来，
 * 搭一个最小 webpack 运行时（__webpack_require__），然后取 m_042_8087
 * 的导出（发布类 S），调用它的 startFill。
 *
 * 这不是模仿，是直接运行原代码。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MOD_DIR = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules'

// ── 收集所有模块 ──
const modules = {}
const files = readdirSync(MOD_DIR).filter(f => f.startsWith('m_') && f.endsWith('.js'))
console.log(`发现 ${files.length} 个模块`)

for (const f of files) {
  // 文件名形如 m_042_8087.js → id = 8087
  const m = f.match(/^m_\d+_(\d+)\.js$/)
  if (!m) continue
  const id = m[1]
  const code = readFileSync(join(MOD_DIR, f), 'utf8')
  // 每个模块是 `function(e,t,r){...}` 形式（webpack 模块工厂）
  modules[id] = code
}

console.log(`已收集 ${Object.keys(modules).length} 个模块`)

// ── 搭最小 webpack 运行时 ──
// 每个模块函数签名是 function(e, t, r)，其中：
//   e = module（有 exports）
//   t = module.exports
//   r = __webpack_require__
// 导出通过 r.d(t, {key: getter}) 定义（webpack 的导出辅助）

const moduleCache = {}

function createWebpackRequire() {
  function requireFn(moduleId) {
    const id = String(moduleId)
    if (moduleCache[id]) return moduleCache[id].exports

    const factory = modules[id]
    if (!factory) {
      console.warn(`模块未找到: ${id}`)
      return {}
    }

    const module = { exports: {} }
    moduleCache[id] = module

    // 提供 r.d（定义导出）和 r.n（ESM 互操作）
    const localRequire = Object.assign(
      function (subId) { return requireFn(subId) },
      {
        d: (exports, definition) => {
          for (const key in definition) {
            if (!Object.prototype.hasOwnProperty.call(exports, key)) {
              Object.defineProperty(exports, key, {
                enumerable: true,
                get: definition[key],
              })
            }
          }
        },
        n: (mod) => {
          const getter = mod && mod.__esModule ? () => mod.default : () => mod
          localRequire.d(getter, { a: getter })
          return getter
        },
        o: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
        r: (exports) => {
          if (typeof Symbol !== 'undefined' && Symbol.toStringTag) {
            Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
          }
          Object.defineProperty(exports, '__esModule', { value: true })
        },
      }
    )

    try {
      // 模块工厂是字符串，eval 成函数后调用
      const fn = eval(`(${factory})`)
      fn(module, module.exports, localRequire)
    } catch (err) {
      console.warn(`模块 ${id} 执行失败: ${err.message}`)
      delete moduleCache[id]
      return {}
    }

    return module.exports
  }

  return requireFn
}

const __webpack_require__ = createWebpackRequire()

// ── 加载主模块 ──
console.log('\n加载 m_042_8087（拼多多发布主模块）…')
const main = __webpack_require__('8087')

console.log('导出键:', Object.keys(main))
const PublisherClass = main.A || main.default || main
console.log('主类类型:', typeof PublisherClass)

if (typeof PublisherClass === 'function') {
  // 类是静态挂载的：window.__PDD_PUBLISHER_INSTANCE 或 S.getOrCreate()
  console.log('有 getOrCreate:', typeof PublisherClass.getOrCreate)
  console.log('有 startFill:', typeof PublisherClass.prototype?.startFill)

  // 打印类上所有方法
  const proto = PublisherClass.prototype || {}
  const methods = Object.getOwnPropertyNames(proto).filter(k => typeof proto[k] === 'function')
  console.log(`实例方法数: ${methods.length}`)
  console.log('关键方法:', methods.filter(m =>
    /startFill|fillSku|fillTitle|uploadAll|fillPrice|fillImage|transform|hijack|anti/i.test(m)
  ).join(', '))

  // 静态常量
  const staticKeys = Object.keys(PublisherClass).filter(k => /^[A-Z_]/.test(k))
  console.log('静态常量:', staticKeys.slice(0, 15).join(', '), '…')
} else {
  console.log('导出内容:', JSON.stringify(Object.keys(main)).slice(0, 500))
}

// 把运行时和类暴露出去，供后续调用
export { __webpack_require__, PublisherClass, modules }
