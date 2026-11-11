/**
 * pdd-native-ize.mjs —— 让 jsdom 里注入的假 getter 伪装成原生函数
 *
 * 背景（2026-11-09）：
 *   推广域 SDK 是**纯 JS**（无 VM），比 mms 的 JVM2 验得更细。
 *   它会用 `Function.prototype.toString.call(getter)` 检查属性是不是原生实现：
 *       const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
 *       Function.prototype.toString.call(d.get).includes('[native code]')
 *   jsdom 里我们用 `Object.defineProperty(navigator, 'plugins', {get: () => [...]})` 注入，
 *   getter 是普通 JS 箭头函数 → 源码不含 [native code] → **一眼假**。
 *
 * 做法：
 *   1. 代理 w.Object.defineProperty，把所有注入的 get/set 记进 WeakSet
 *   2. 代理 w.Function.prototype.toString，对 WeakSet 里的函数返回原生外观
 *   3. 代理函数本身也加入 WeakSet（避免补丁自身露馅）
 *
 * 注意：必须在**所有环境注入完成之后**、SDK eval 之前调用。
 */

export function nativeIze(w) {
  if (!w || w.__PDD_NATIVE_IZED__) return false
  const NATIVE = new WeakSet()
  const win = w

  // ① 拦截 defineProperty，标记注入的访问器
  const origDefineProperty = w.Object.defineProperty
  function patchedDefineProperty(target, key, desc) {
    try {
      if (desc && typeof desc.get === 'function') NATIVE.add(desc.get)
      if (desc && typeof desc.set === 'function') NATIVE.add(desc.set)
    } catch (e) { }
    return origDefineProperty.call(this, target, key, desc)
  }
  try {
    Object.defineProperty(patchedDefineProperty, 'name', { value: 'defineProperty', configurable: true })
  } catch (e) { }
  NATIVE.add(patchedDefineProperty)
  w.Object.defineProperty = patchedDefineProperty

  // ② toString 对标记函数返回原生外观
  const origToString = w.Function.prototype.toString
  function patchedToString() {
    try {
      if (NATIVE.has(this)) {
        const nm = this.name || ''
        return `function ${nm}() { [native code] }`
      }
    } catch (e) { }
    return origToString.call(this)
  }
  try {
    Object.defineProperty(patchedToString, 'name', { value: 'toString', configurable: true })
  } catch (e) { }
  NATIVE.add(patchedToString)
  w.Function.prototype.toString = patchedToString

  // ③ 其它常见原生函数外观校验点
  const extra = ['toString', 'valueOf', 'hasOwnProperty', 'constructor']
  for (const k of extra) {
    try {
      const d = origDefineProperty.call(w.Object, k, {})
      void d
    } catch (e) { }
  }

  // ④ 标记 jsdom 自己的 Object / Array / Function 原型方法已由引擎提供，无需处理
  win.__PDD_NATIVE_IZED__ = true
  win.__PDD_NATIVE_SET__ = NATIVE
  return true
}

export default nativeIze
