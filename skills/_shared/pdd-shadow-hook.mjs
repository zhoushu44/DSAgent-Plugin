/**
 * pdd-shadow-hook.mjs — 破解拼多多滑块的 closed Shadow DOM
 *
 * ═══ 为什么需要这个（2026-11-05，来源：影刀社区实测）═══
 *
 *   拼多多的滑块验证弹窗渲染在 `#shadow-root (closed)` 内。
 *   closed 模式下 `element.shadowRoot` 恒为 null，
 *   从外部 `document.querySelector('#slide-captcha-dialog')` **永远查不到**。
 *
 *   这就是为什么 pdd-slider-solver 的 diagnoseSlider 一直返回
 *   `{ ok:false, hasDialog:false, 没找到弹窗 }` ——
 *   看起来像"没有弹窗"，其实是弹窗存在但被 shadow boundary 挡住了。
 *
 * ═══ 解法 ═══
 *
 *   在页面脚本执行前（evaluateOnNewDocument）劫持 Element.prototype.attachShadow，
 *   把 `{mode:'closed'}` 改成 `{mode:'open'}`，
 *   之后 shadowRoot 可访问，滑块内部元素就能正常查询。
 *
 *   ★ 必须用 evaluateOnNewDocument（document-start 阶段注入），
 *     在页面已加载后再 hook 就晚了 —— SDK 已经把 shadow root 建好了。
 *
 * ═══ 用法 ═══
 *
 *   import { installShadowHook, queryDeep } from './pdd-shadow-hook.mjs'
 *   await installShadowHook(page)          // 必须在 goto 之前
 *   await page.goto(...)
 *   // 之后 page.evaluate 里可用 window.__pddDeepQuery('#slide-captcha-dialog')
 */

/** 注入脚本内容（会被序列化进页面） */
const HOOK_SRC = `
(function () {
  if (window.__pddShadowHooked) return;
  window.__pddShadowHooked = true;

  var oldAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    try {
      if (init && init.mode === 'closed') {
        // 复制一份再改，避免污染调用方对象
        var o = {};
        for (var k in init) o[k] = init[k];
        o.mode = 'open';
        return oldAttach.call(this, o);
      }
    } catch (e) { /* 失败则走原逻辑 */ }
    return oldAttach.call(this, init);
  };

  /**
   * 深度查询：穿透所有 open shadow root（递归）
   * @param {string} sel CSS 选择器
   * @param {Element} [root] 起点，默认 document
   * @returns {Element|null}
   */
  window.__pddDeepQuery = function (sel, root) {
    root = root || document;
    var hit = null;
    try { hit = root.querySelector(sel); } catch (e) { }
    if (hit) return hit;
    // 遍历所有元素，找带 shadowRoot 的继续下钻
    var all = [];
    try { all = Array.prototype.slice.call(root.querySelectorAll('*')); } catch (e) { }
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot;
      if (sr) {
        var r = window.__pddDeepQuery(sel, sr);
        if (r) return r;
      }
    }
    return null;
  };

  /** 深度查询全部匹配 */
  window.__pddDeepQueryAll = function (sel, root) {
    root = root || document;
    var out = [];
    try { out = out.concat(Array.prototype.slice.call(root.querySelectorAll(sel))); } catch (e) { }
    var all = [];
    try { all = Array.prototype.slice.call(root.querySelectorAll('*')); } catch (e) { }
    for (var i = 0; i < all.length; i++) {
      var sr = all[i].shadowRoot;
      if (sr) out = out.concat(window.__pddDeepQueryAll(sel, sr));
    }
    return out;
  };
})();
`

/**
 * 在页面上安装 shadow hook
 * ★ 必须在 page.goto() 之前调用，否则页面脚本已执行、shadow root 已建好，hook 失效
 *
 * @param {object} page puppeteer page
 * @returns {Promise<boolean>} 是否注入成功
 */
export async function installShadowHook(page) {
  try {
    await page.evaluateOnNewDocument(HOOK_SRC)
    return true
  } catch {
    return false
  }
}

/**
 * 对已经打开的页面补装 hook（尽力而为）
 * 说明：只能修复"之后新建"的 shadow root，已建好的 closed root 无法回溯打开
 * 所以推荐还是 goto 前装；这个只作为兜底
 */
export async function installShadowHookNow(page) {
  try {
    await page.evaluate(HOOK_SRC)
    return true
  } catch {
    return false
  }
}

/**
 * 在页面内做深度查询（穿透 shadow DOM）
 * @param {object} page
 * @param {string} selector
 * @returns {Promise<boolean>} 是否找到
 */
export async function deepQueryExists(page, selector) {
  return page.evaluate((sel) => {
    const q = window.__pddDeepQuery || ((s) => document.querySelector(s))
    return !!q(sel)
  }, selector).catch(() => false)
}

/**
 * 检测当前页面是否有滑块（穿透 shadow DOM）
 * @returns {Promise<{hasSlider:boolean, inShadow:boolean, hint:string}>}
 */
export async function detectSliderDeep(page) {
  return page.evaluate(() => {
    const SEL = '#slide-captcha-dialog, .captcha-wrapper__slider, .captcha-wrapper, .slide-handlebar'
    const q = window.__pddDeepQuery || ((s) => document.querySelector(s))

    // 普通查询
    const plain = document.querySelector(SEL)
    // 深度查询
    const deep = q(SEL)
    // 扫一遍是否有 closed shadow（无法访问，但能通过 host 判断）
    let hasShadowHost = false
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.shadowRoot) { hasShadowHost = true; break }
      }
    } catch { }

    return {
      hasSlider: !!deep,
      inShadow: !!deep && !plain,
      hasShadowHost,
      hooked: !!window.__pddShadowHooked,
      hint: !deep && !hasShadowHost
        ? '既没有滑块也没有 shadow host —— 可能是真没有弹窗'
        : !deep && hasShadowHost
          ? '有 shadow host 但查不到滑块 —— hook 可能未生效，或滑块在 closed root 内'
          : '查到滑块'
    }
  }).catch(() => ({ hasSlider: false, inShadow: false, hint: 'evaluate 失败' }))
}
