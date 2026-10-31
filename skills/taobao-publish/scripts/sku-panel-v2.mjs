/**
 * 淘宝发布组件 · 新版 SKU 面板（"+ 创建规格" 链路）
 *
 * ★ 为什么需要这个组件
 *   淘宝 2026-10 全类目改版了 SKU 面板。新版是「+ 创建规格」按钮 + 属性卡
 *   + 交叉乘积表，与旧版单属性输入框语义完全不同。原引擎（lib/taobao-publish.js
 *   的 fillSkus）检测到新面板就直接 push missed 转人工，等于二维 SKU 完全不可用。
 *
 * ★ 机制已由 SOURCE.md §4.6 完整逆向（7 条结构 + 9 条已证伪假说），本组件按那份
 *   记录实现，不再靠猜。关键几条：
 *
 *   ① 值提交：**键入 + Tab 是唯一有效方式**
 *      （Enter 无效会把值 append；仅键入的值在「确认创建」时被直接丢弃）
 *   ② 计数锚点：`属性名(N)` 只在新槽位收到 Tab 提交时 +1
 *   ③ 多值：一个框一个值，多值要点区块级 `+` 按钮（button.next-btn.add）加行
 *      同一槽位再键入再 Tab = 值拼接，不是覆盖
 *   ④ 确认门槛：每个已选属性须 ≥1 已提交值，否则点确认无效果、无报错、面板不关
 *   ⑤ 定位：全局按 placeholder 找框必错（永远命中第一个属性的主色框）。
 *      正解是 ownerOf —— 向上爬「唯一含 `属性名(N)` 计数文本」的最高祖先 = 属性块
 *   ⑥ 输入：不要坐标点击（面板动画致 stale），用 scrollIntoView + focus() + keyboard.type
 *
 * 用法：
 *   const r = await fillSkuPanelV2(page, specs, skuRows, { log })
 *   // r.filled / r.missed / r.created（是否成功创建 SKU 表）
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 检测当前页面是否是新版 SKU 面板
 * ★ 这是 fillSkus 分流的唯一依赖锚点（SOURCE.md §4.6 验证点 ①）
 */
export async function detectNewSkuPanel(page) {
  return page.evaluate(() => {
    const box = document.getElementById('struct-sku') || document.getElementById('struct-saleProp')
    if (!box) return false
    return [...box.querySelectorAll('button, a, div, span')].some(el => {
      const e = el
      return e.offsetParent !== null && /^\s*\+\s*创建规格/.test((e.innerText || '').trim())
    })
  }).catch(() => false)
}

/**
 * 打开「+ 创建规格」弹层
 * ★ 2026-10-31 实测：SKU 区在「销售信息」标签页，不在「基础信息」。
 *   所以先切标签页，再找按钮。
 */
async function openSkuPanel(page, opts = {}) {
  const log = opts.log || (() => {})

  // ① 先切到「销售信息」标签页
  //   ★ 2026-10-31 实测定论（别再猜）：
  //     「销售信息」不是 next-tabs，而是**顶部导航菜单项**：
  //       <li class="next-menu-item next-nav-item sell-component-navigation-bar-nav">
  //         <div class="next-menu-item-inner"><span class="next-menu-item-text">销售信息</span></div>
  //       </li>
  //     位置固定在页面顶部（y≈60）。所以必须点这个 LI，且不能排除 inMenu。
  const switched = await page.evaluate(() => {
    const hits = []
    for (const el of document.querySelectorAll('li, .next-menu-item, [role="menuitem"], [role="tab"], .next-tabs-tab')) {
      if ((el.innerText || '').trim() !== '销售信息') continue
      if (el.offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) continue
      // 取最内层的 LI（避免重复点到外层容器）
      hits.push({
        el,
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 60),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        isNavItem: /next-nav-item|next-menu-item/.test((el.className || '').toString()),
      })
    }
    if (!hits.length) return { ok: false, reason: 'no hit' }
    // 优先导航项
    const pick = hits.find(h => h.isNavItem) || hits[0]
    // 派发完整事件序列
    const r = pick.el.getBoundingClientRect()
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      pick.el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: pick.x, clientY: pick.y,
      }))
    }
    return { ok: true, tag: pick.tag, cls: pick.cls, x: pick.x, y: pick.y, count: hits.length }
  }).catch(e => ({ ok: false, reason: e.message }))

  if (switched.ok) {
    log(`[sku-v2] 已点导航「销售信息」（${switched.tag}.${switched.cls}，共 ${switched.count} 处）`)
    // 真实鼠标再点一次
    await page.mouse.click(switched.x, switched.y).catch(() => {})
    await sleep(3000)

    // 验证：页面上应出现「销售属性」区块
    const confirmed = await page.evaluate(() => {
      const bodyText = document.body.innerText || ''
      const skuBox = document.getElementById('struct-sku') || document.getElementById('struct-saleProp')
      const hasCreateSpec = !!([...document.querySelectorAll('button, a, div, span')]
        .find(e => e.offsetParent !== null && /^\s*\+\s*创建规格/.test((e.innerText || '').trim())))
      return {
        hasCreateSpec,
        skuVisible: !!(skuBox && skuBox.offsetParent !== null),
        hasSalesAttr: /销售属性/.test(bodyText),
        navActive: [...document.querySelectorAll('.next-menu-item.active, .next-nav-item.active, [class*="active"][class*="nav"]')]
          .map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 5),
      }
    }).catch(() => ({ hasCreateSpec: false, skuVisible: false, hasSalesAttr: false, navActive: [] }))
    log(`[sku-v2] 切换后：创建规格按钮=${confirmed.hasCreateSpec} SKU区=${confirmed.skuVisible} 销售属性=${confirmed.hasSalesAttr} 激活项=${JSON.stringify(confirmed.navActive)}`)
  } else {
    log(`[sku-v2] ⚠ 未找到「销售信息」导航项（${switched.reason || ''}）`)
  }

  // ② 找「+ 创建规格」按钮
  //   ★ 2026-10-31 实测定论：
  //     「基础信息/销售信息」是**同一页的锚点导航**（不是 tab 切换）。
  //     点导航只会高亮+滚动，页面内容仍是连续的长表单。
  //     所以点完导航后必须**主动滚动到 SKU 区域**，按钮才会进入视口。
  await page.evaluate(() => {
    // 优先滚到 #struct-sku / #struct-saleProp
    const skuBox = document.getElementById('struct-sku') || document.getElementById('struct-saleProp')
    if (skuBox) {
      skuBox.scrollIntoView({ block: 'center' })
      return
    }
    // 兜底：滚到「销售属性」文字
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && /^销售属性/.test((el.textContent || '').trim())) {
        el.scrollIntoView({ block: 'center' })
        return
      }
    }
    // 再兜底：滚到底部附近
    window.scrollTo(0, document.body.scrollHeight * 0.5)
  }).catch(() => {})
  await sleep(1200)

  // ③ 找并点击「+ 创建规格」按钮
  //   ★ 2026-10-31 实测：匹配到 8 个元素，外层是 DIV 容器（点它无效）。
  //     必须取**最内层**、**有最小 innerText 长度**、且**没有同类子元素**的那个。
  const clicked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button, a, div, span, [role="button"]')]
      .filter(el => el.offsetParent !== null && /^\s*\+\s*创建规格/.test((el.innerText || '').trim()))

    if (!all.length) return { ok: false, reason: 'no button' }

    // 取「不包含其它同类匹配元素」的最内层
    const innermost = all.filter(el => !all.some(o => o !== el && el.contains(o)))
    const cands = innermost.length ? innermost : all

    // 优先级：button > [role=button] > span > div
    const rank = el => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'button') return 0
      if (el.getAttribute('role') === 'button') return 1
      if (tag === 'a') return 2
      if (tag === 'span') return 3
      return 4
    }
    cands.sort((a, b) => rank(a) - rank(b))

    const btn = cands[0]
    btn.scrollIntoView({ block: 'center' })
    const r = btn.getBoundingClientRect()
    if (r.width < 10 || r.height < 8) return { ok: false, reason: 'zero size' }

    const x = Math.round(r.x + r.width / 2)
    const y = Math.round(r.y + r.height / 2)

    // ★ 只返回坐标，**不在这里 dispatchEvent**（否则等于点两次 → 第二次点到遮罩把抽屉关掉）
    return {
      ok: true,
      tag: btn.tagName,
      cls: (btn.className || '').toString().slice(0, 50),
      x, y,
      total: all.length,
      innermost: innermost.length,
      text: (btn.innerText || '').trim().slice(0, 40),
    }
  }).catch(e => ({ ok: false, reason: e.message }))

  if (!clicked.ok) {
    log(`[sku-v2] ⚠ 找不到「+ 创建规格」按钮（${clicked.reason}）`)
    return false
  }
  log(`[sku-v2] 已点「+ 创建规格」（${clicked.tag}.${clicked.cls}，总${clicked.total}个/最内层${clicked.innermost}个，text="${clicked.text}"）`)
  // ★ 只点一次（真实鼠标）
  await page.mouse.click(clicked.x, clicked.y).catch(() => {})

  // ④ 等弹层出现
  //   ★ 2026-10-31 实测踩坑：`/确认创建/.test(o.innerText)` 太宽泛 ——
  //     页面任何包含「确认创建」的容器都会命中，导致**误判弹层已打开**。
  //   正确判据（三选一，必须都指向真弹层）：
  //     ① 存在 `.next-drawer`（实测定论：规格弹层是右侧抽屉，不是 dialog）且**可见**
  //     ② 该容器里有「确认创建」**按钮**（button/next-btn）
  //     ③ 该容器里有「属性 N/N」计数文本
  for (let i = 0; i < 30; i++) {
    await sleep(400)
    const state = await page.evaluate(() => {
      // ★ fixed 定位元素 offsetParent 恒为 null，只能用 rect 判断
      const isVisible = el => {
        const r = el.getBoundingClientRect()
        return r.width > 100 && r.height > 80
      }

      // 候选弹层容器
      const overlays = [
        ...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer, .next-drawer-right, .next-dialog'),
      ].filter(isVisible)

      for (const o of overlays) {
        const txt = o.innerText || ''
        // 必须有「确认创建」按钮
        const hasConfirmBtn = [...o.querySelectorAll('button, .next-btn, [role="button"]')]
          .some(b => /确认创建/.test((b.innerText || '').trim()))
        // 或有「属性 N/N」计数
        const hasAttrCount = /属性\s*\d+\/\d+/.test(txt)
        if (hasConfirmBtn || hasAttrCount) {
          return {
            ready: true,
            via: hasConfirmBtn ? 'confirm-btn' : 'attr-count',
            size: { w: Math.round(o.getBoundingClientRect().width), h: Math.round(o.getBoundingClientRect().height) },
            cls: (o.className || '').toString().slice(0, 50),
            textPreview: txt.replace(/\s+/g, ' ').slice(0, 100),
          }
        }
      }
      return { ready: false, overlayCount: overlays.length }
    }).catch(() => ({ ready: false }))

    if (state.ready) {
      log(`[sku-v2] 弹层已打开（via ${state.via}，${state.size.w}x${state.size.h}，${state.cls}）`)
      log(`[sku-v2] 弹层内容: ${state.textPreview}`)

      // ★ 2026-10-31 实测：抽屉对**页面失焦**敏感，任何多余的 evaluate/轮询
      //   都可能让它自动关闭。所以这里**不做任何检测**，只用固定等待让动画走完。
      await sleep(2500)
      return true
    }
  }
  log('[sku-v2] ⚠ 弹层 12s 内未出现')
  return false
}

/**
 * 找某个属性名对应的「属性块容器」
 * ★ SOURCE.md 已证伪：全局 .find() 按 placeholder 找框永远命中第一个属性的主色框。
 *   正解是向上爬「唯一含 `属性名(N)` 计数文本」的最高祖先。
 *
 * @returns 属性块信息（在 page.evaluate 内部使用）
 */
const OWNER_OF_FN = `
function ownerOf(anchorEl, attrName) {
  const re = new RegExp('^' + attrName.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\(\\\\d+\\\\)$')
  let cur = anchorEl
  let best = null
  for (let d = 0; d < 12 && cur; d++) {
    // 该祖先的「直接文本片段」里是否有 属性名(N)
    const texts = [...cur.querySelectorAll('*')]
      .filter(e => e.children.length === 0)
      .map(e => (e.textContent || '').trim())
    if (texts.some(t => re.test(t))) best = cur
    cur = cur.parentElement
  }
  return best
}
`

/**
 * 读抽屉里所有属性块
 * ★ 2026-10-31 实测结构（手机壳类目）：
 *   <div class="sell-info"><div class="info-content help-padding">
 *     <span class="props-label">颜色分类(0)</span>
 *   </div></div>
 *   输入框：input[placeholder="主色(必选)"] / input[placeholder="请输入"]
 *   注意：props-label 的 children.length === 1（内有文本节点），不能用 children 过滤。
 */
async function readPanelBlocks(page) {
  return page.evaluate(() => {
    // ★ fixed 定位，只能用 rect 判断
    const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
      .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
    const drawer = drawers[drawers.length - 1]
    if (!drawer) return { err: 'no drawer' }

    // ① 找所有 .props-label（"属性名(N)"）
    const labels = [...drawer.querySelectorAll('.props-label, [class*="props-label"]')]
    const blocks = []
    for (const lb of labels) {
      const t = (lb.textContent || '').trim()
      const m = t.match(/^(.+?)\((\d+)\)$/)
      if (!m) continue
      const name = m[1].trim()
      const count = parseInt(m[2], 10)
      if (!name) continue

      // ② 从 label 向上找属性块容器
      //    ★ 判据：有可见 input **且** .props-label 数量 === 1（不跨到别的属性块）
      let container = lb
      let found = null
      for (let d = 0; d < 12 && container; d++) {
        const ins = [...container.querySelectorAll('input[type="text"], input:not([type])')]
          .filter(i => { const r = i.getBoundingClientRect(); return r.width > 50 })
        const labelCount = container.querySelectorAll('.props-label, [class*="props-label"]').length
        if (ins.length && labelCount === 1) {
          found = { container, inputs: ins }
          // 继续向上，取「仍只有 1 个 label」的最高层
        } else if (ins.length && labelCount > 1 && found) {
          break   // 已跨块，停下
        }
        container = container.parentElement
      }
      if (!found) continue

      // ③ 区块级 + 按钮（next-icon-add 或文字为 +）
      const addBtn = [...found.container.querySelectorAll('button')]
        .find(b => b.querySelector('.next-icon-add, [class*="next-icon-add"]'))

      blocks.push({
        name,
        count,
        inputCount: found.inputs.length,
        hasAddBtn: !!addBtn,
        placeholders: found.inputs.map(i => i.placeholder || ''),
      })
    }

    return { blocks, drawerCount: drawers.length }
  }).catch(e => ({ err: e.message }))
}

/**
 * 填一个属性的所有值
 * ★ 机制（SOURCE.md §4.6 已验证）：
 *   ① 键入 + **Tab** = 唯一有效提交方式（Enter 无效，仅键入会被丢弃）
 *   ② 计数 `属性名(N)` 只在新槽位 Tab 提交时 +1
 *   ③ 一个框一个值，多值要点区块 `+` 加行
 *   ④ 输入用 scrollIntoView + focus() + keyboard.type（坐标点击会 stale）
 *
 * ★ 实测结构：颜色分类 → input[placeholder="主色(必选)"]（每行 1 个主色框 + 1 个备注框）
 *             适用型号   → input[placeholder="请输入"]
 */
async function fillAttrBlock(page, attrName, values, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const isDrawerOpen = () => page.evaluate(() => {
    const ds = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
      .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
    return ds.length > 0
  }).catch(() => false)

  const openDrawer = async () => {
    const ok = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button, a, div, span')]
        .filter(el => /^\s*\+\s*创建规格/.test((el.innerText || '').trim()))
      const inner = all.filter(el => !all.some(o => o !== el && el.contains(o)))
      const b = inner[0] || all[0]
      if (!b) return false
      b.scrollIntoView({ block: 'center' })
      return true
    }).catch(() => false)
    if (!ok) return false
    // 用真实鼠标点击（只点一次）
    const xy = await page.evaluate(() => {
      const all = [...document.querySelectorAll('button, a, div, span')]
        .filter(el => /^\s*\+\s*创建规格/.test((el.innerText || '').trim()))
      const inner = all.filter(el => !all.some(o => o !== el && el.contains(o)))
      const b = inner[0] || all[0]
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
    }).catch(() => null)
    if (xy) await page.mouse.click(xy.x, xy.y).catch(() => {})
    // 等抽屉出现 + 动画稳定
    for (let i = 0; i < 25; i++) {
      await sleep(300)
      const st = await page.evaluate(() => {
        const ds = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
          .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
        const d = ds[ds.length - 1]
        if (!d) return null
        const r = d.getBoundingClientRect()
        const ins = [...d.querySelectorAll('input[type="text"], input:not([type])')]
          .filter(i => { const rc = i.getBoundingClientRect(); return rc.width > 50 })
        return { x: Math.round(r.x), inputs: ins.length }
      }).catch(() => null)
      if (st && st.inputs > 0) {
        // 等 x 稳定
        await sleep(700)
        return true
      }
    }
    return false
  }

  for (let vi = 0; vi < values.length; vi++) {
    const v = String(values[vi] || '').trim()
    if (!v) continue

    // ★ 每个值开始前确保抽屉打开
    if (!(await isDrawerOpen())) {
      log(`[sku-v2] 抽屉已关，重开…`)
      if (!(await openDrawer())) {
        missed.push(`${attrName}=${v}（抽屉重开失败）`)
        break
      }
    }

    let success = false

    // 最多 2 轮（第 1 轮失败 → 重开抽屉 → 第 2 轮）
    for (let round = 0; round < 2 && !success; round++) {
      if (round > 0) {
        log(`[sku-v2] 「${attrName}」= ${v} 第 1 轮失败，重开抽屉重试`)
        if (!(await openDrawer())) break
      }

      // ① 定位输入框坐标
      const pos = await page.evaluate(({ attrName, idx }) => {
        const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
          .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
        const drawer = drawers[drawers.length - 1]
        if (!drawer) return { err: 'no drawer' }

        let labelEl = null
        for (const lb of drawer.querySelectorAll('.props-label, [class*="props-label"]')) {
          if ((lb.textContent || '').trim().startsWith(attrName + '(')) { labelEl = lb; break }
        }
        if (!labelEl) return { err: 'label not found' }

        let cur = labelEl
        let container = null
        for (let d = 0; d < 12 && cur; d++) {
          const ins = [...cur.querySelectorAll('input[type="text"], input:not([type])')]
            .filter(i => { const r = i.getBoundingClientRect(); return r.width > 50 })
          const lc = cur.querySelectorAll('.props-label, [class*="props-label"]').length
          if (ins.length && lc === 1) container = cur
          else if (ins.length && lc > 1 && container) break
          cur = cur.parentElement
        }
        if (!container) return { err: 'container not found' }

        const inputs = [...container.querySelectorAll('input[type="text"], input:not([type])')]
          .filter(i => {
            const r = i.getBoundingClientRect()
            if (r.width < 50 || r.height < 20) return false
            if (/备注|可选|搜索|查询/.test(i.placeholder || '')) return false
            return true
          })
        if (!inputs.length) return { err: 'no input' }

        const empties = inputs.filter(i => !(i.value || '').trim())
        const el = empties[Math.min(idx, Math.max(0, empties.length - 1))] || inputs[inputs.length - 1]
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), total: inputs.length }
      }, { attrName, idx: 0 }).catch(e => ({ err: e.message }))

      if (pos.err) {
        log(`[sku-v2] 「${attrName}」定位失败: ${pos.err}`)
        continue
      }

      // ② 点击聚焦（3 次）
      let focusOk = false
      for (let a = 0; a < 3 && !focusOk; a++) {
        await page.mouse.click(pos.x, pos.y).catch(() => {})
        await sleep(600 + a * 300)
        const fr = await page.evaluate(() => {
          const ae = document.activeElement
          return (!ae || ae.tagName !== 'INPUT') ? { ok: false, tag: ae?.tagName || '' } : { ok: true }
        }).catch(() => ({ ok: false }))
        focusOk = fr.ok
        if (!focusOk && a < 2) log(`[sku-v2] 「${attrName}」聚焦第 ${a + 1} 次失败（${fr.tag}）`)
      }

      if (!focusOk) {
        log(`[sku-v2] 「${attrName}」= ${v} 无法聚焦，准备重开重试`)
        continue
      }

      // ③ 键入 + Tab
      await page.keyboard.type(v, { delay: 45 }).catch(() => {})
      await sleep(350)
      await page.keyboard.press('Tab').catch(() => {})
      await sleep(600)

      // ④ 校验计数
      const after = await page.evaluate((name) => {
        const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
          .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
        const drawer = drawers[drawers.length - 1]
        if (!drawer) return -1
        for (const lb of drawer.querySelectorAll('.props-label, [class*="props-label"]')) {
          const t = (lb.textContent || '').trim()
          const m = t.match(/^(.+?)\((\d+)\)$/)
          if (m && m[1].trim() === name) return parseInt(m[2], 10)
        }
        return -1
      }, attrName).catch(() => -1)

      if (after > 0) {
        success = true
        filled.push(`${attrName}=${v}`)
        log(`[sku-v2] 「${attrName}」= ${v} ✅（计数 ${after}）`)
      } else {
        log(`[sku-v2] 「${attrName}」= ${v} ❌（计数 ${after}）`)
      }
    }

    if (!success) missed.push(`${attrName}=${v}（2 轮均失败）`)

    // ⑤ 不是最后一个值 → 点 `+` 加行
    if (vi < values.length - 1 && (await isDrawerOpen())) {
      const added = await page.evaluate((name) => {
        const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
          .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
        const drawer = drawers[drawers.length - 1]
        if (!drawer) return false
        let labelEl = null
        for (const lb of drawer.querySelectorAll('.props-label, [class*="props-label"]')) {
          if ((lb.textContent || '').trim().startsWith(name + '(')) { labelEl = lb; break }
        }
        if (!labelEl) return false
        let cur = labelEl, container = null
        for (let d = 0; d < 12 && cur; d++) {
          const ins = [...cur.querySelectorAll('input[type="text"], input:not([type])')]
            .filter(i => { const r = i.getBoundingClientRect(); return r.width > 50 })
          const lc = cur.querySelectorAll('.props-label, [class*="props-label"]').length
          if (ins.length && lc === 1) container = cur
          else if (ins.length && lc > 1 && container) break
          cur = cur.parentElement
        }
        if (!container) return false
        const addBtn = [...container.querySelectorAll('button')]
          .find(b => b.querySelector('.next-icon-add, [class*="next-icon-add"]'))
        if (!addBtn) return false
        addBtn.scrollIntoView({ block: 'center' })
        addBtn.click()
        return true
      }, attrName).catch(() => false)

      if (added) {
        log(`[sku-v2] 「${attrName}」已点 + 加行`)
        await sleep(600)
      }
    }
  }

  return { filled, missed }
}


/**
 * 点「确认创建」并等 SKU 表渲染
 * ★ 实测（2026-10-31）：
 *   · 按钮 class = next-btn next-medium next-btn-primary，文本「确认创建」
 *   · 门槛：每个已选属性须 >=1 已提交值，否则点击无效果、无报错、抽屉不关
 *   · 成功后抽屉关闭，#struct-sku 渲染 SKU 表
 */
async function confirmCreate(page, opts = {}) {
  const log = opts.log || (() => {})

  const clicked = await page.evaluate(() => {
    const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
      .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
    for (let i = drawers.length - 1; i >= 0; i--) {
      const d = drawers[i]
      const btn = [...d.querySelectorAll('button, .next-btn')]
        .find(b => (b.innerText || '').trim() === '确认创建')
      if (btn) {
        btn.scrollIntoView({ block: 'center' })
        const r = btn.getBoundingClientRect()
        return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }
    }
    return { ok: false }
  }).catch(() => ({ ok: false }))

  if (!clicked.ok) {
    log('[sku-v2] ⚠ 找不到「确认创建」按钮')
    return false
  }

  await page.mouse.click(clicked.x, clicked.y).catch(() => {})
  log('[sku-v2] 已点「确认创建」')

  // 等抽屉关闭 + SKU 表渲染
  for (let i = 0; i < 25; i++) {
    await sleep(400)
    const st = await page.evaluate(() => {
      const drawers = [...document.querySelectorAll('.next-drawer, .next-overlay-inner.next-drawer')]
        .filter(o => { const r = o.getBoundingClientRect(); return r.width > 200 && r.height > 200 })
      const skuBox = document.getElementById('struct-sku')
      const rows = skuBox ? skuBox.querySelectorAll('tbody tr').length : 0
      return { drawerOpen: drawers.length > 0, rows }
    }).catch(() => ({ drawerOpen: true, rows: 0 }))
    if (!st.drawerOpen && st.rows > 0) {
      log(`[sku-v2] SKU 表已渲染 ${st.rows} 行`)
      return true
    }
  }
  log('[sku-v2] ⚠ 确认创建后抽屉未关或表未渲染')
  return false
}

/**
 * 填新版 SKU 面板（主入口）
 */
export async function fillSkuPanelV2(page, specs, skuRows, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const isV2 = await detectNewSkuPanel(page)
  if (!isV2) {
    log('[sku-v2] 未检测到新版面板，应由旧版 fillSkus 处理')
    return { filled, missed, created: false, isV2: false }
  }
  log('[sku-v2] 检测到新版 SKU 面板')

  // ① 打开弹层
  if (!(await openSkuPanel(page, { log }))) {
    return { filled, missed: ['SKU 面板打开失败'], created: false, isV2: true }
  }

  // ② 读属性块（属性卡默认已选，跳过；直接读区块）
  const info = await readPanelBlocks(page)
  if (info.err) {
    return { filled, missed: [`读取面板失败：${info.err}`], created: false, isV2: true }
  }
  log(`[sku-v2] 面板属性块：${info.blocks.map(b => `${b.name}(${b.count})`).join(' / ')}`)

  // ③ 逐属性填值
  for (const spec of specs) {
    const vals = (spec.values || [])
      .map(v => (v && typeof v === 'object') ? String(v.value || '').trim() : String(v || '').trim())
      .filter(Boolean)
    if (!vals.length) continue

    // 面板里有这个属性块才填
    const block = info.blocks.find(b => b.name === spec.name || b.name.includes(spec.name) || spec.name.includes(b.name))
    if (!block) {
      log(`[sku-v2] ⚠ 面板里没有「${spec.name}」属性块，跳过`)
      missed.push(`${spec.name}（面板无此属性）`)
      continue
    }

    log(`[sku-v2] 填「${spec.name}」${vals.length} 个值`)
    const r = await fillAttrBlock(page, block.name, vals, { log })
    filled.push(...r.filled)
    missed.push(...r.missed)
  }

  // ④ 确认创建
  const created = await confirmCreate(page, { log })
  if (!created) {
    missed.push('确认创建失败（可能某属性已提交值数为 0）')
  }

  log(`[sku-v2] 完成：已填 ${filled.length} 项，未填 ${missed.length} 项，SKU 表${created ? '已创建' : '未创建'}`)
  return { filled, missed, created, isV2: true }
}

/**
 * 填新版 SKU 表的 价格 / 数量
 *
 * ★ 表结构（SOURCE.md §4.6）：
 *   列：☑ | 颜色分类 | 适用型号 | 价格(元) | 数量(件) | SKU分类 | 流行元素 | 图案类型 | 商家编码 | 是否上架 | 操作
 *   数据行 td id 带 `{row}-` 前缀（如 `1-skuPrice` / `1-skuStock`）
 *   **不能依赖 tr.sku-table-row**（新表 class 未证实）
 *
 * @param page
 * @param skuRows [{ specs, price, stock }]
 * @param opts { log? }
 */
export async function fillSkuTableV2(page, skuRows, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const info = await page.evaluate(() => {
    const box = document.getElementById('struct-sku')
    if (!box) return { err: 'no struct-sku' }
    const rows = [...box.querySelectorAll('tbody tr')]
    return {
      rows: rows.length,
      // 探测 td id 前缀是否可用
      sampleIds: rows.slice(0, 3).map(tr => [...tr.querySelectorAll('td[id]')].map(td => td.id).slice(0, 4)),
    }
  }).catch(e => ({ err: e.message }))

  if (info.err) {
    return { filled, missed: [`SKU 表读取失败：${info.err}`] }
  }
  log(`[sku-v2] SKU 表 ${info.rows} 行，td id 样本：${JSON.stringify(info.sampleIds)}`)

  for (let ri = 0; ri < info.rows; ri++) {
    const row = skuRows[ri] || skuRows[skuRows.length - 1] || {}
    const price = String(row.price || '').trim()
    const stock = String(row.stock || '100').trim()

    for (const [label, suffix, val] of [['价格', 'skuPrice', price], ['数量', 'skuStock', stock]]) {
      if (!val) continue
      const ok = await page.evaluate(({ rowIdx, suf, v }) => {
        const box = document.getElementById('struct-sku')
        if (!box) return false
        const trs = [...box.querySelectorAll('tbody tr')]
        const tr = trs[rowIdx]
        if (!tr) return false
        // 优先用 id 前缀定位
        let el = tr.querySelector(`td[id^="${rowIdx + 1}-${suf}"] input`)
          || tr.querySelector(`td[id*="${suf}"] input`)
        // 兜底：按列序（价格第4列=index 3，数量第5列=index 4）
        if (!el) {
          const tds = [...tr.querySelectorAll('td')]
          const idx = suf === 'skuPrice' ? 3 : 4
          el = tds[idx]?.querySelector('input')
        }
        if (!el) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        el.focus()
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
        return true
      }, { rowIdx: ri, suf: suffix, v: val }).catch(() => false)

      await sleep(120)
      const back = await page.evaluate(({ rowIdx, suf }) => {
        const box = document.getElementById('struct-sku')
        if (!box) return ''
        const tr = [...box.querySelectorAll('tbody tr')][rowIdx]
        if (!tr) return ''
        let el = tr.querySelector(`td[id^="${rowIdx + 1}-${suf}"] input`) || tr.querySelector(`td[id*="${suf}"] input`)
        if (!el) {
          const tds = [...tr.querySelectorAll('td')]
          const idx = suf === 'skuPrice' ? 3 : 4
          el = tds[idx]?.querySelector('input')
        }
        return el?.value || ''
      }, { rowIdx: ri, suf: suffix }).catch(() => '')

      // ★ 2026-10-31：平台会把价格格式化（29.9 → 29.90），用**数值比较**而非字符串
      const backNum = parseFloat(String(back).replace(/[^\d.]/g, ''))
      const wantNum = parseFloat(String(val).replace(/[^\d.]/g, ''))
      const match = Number.isFinite(backNum) && Number.isFinite(wantNum)
        ? Math.abs(backNum - wantNum) < 0.005
        : String(back).trim() === val

      if (match) {
        filled.push(`第${ri + 1}行${label}=${val}`)
      } else {
        // 再等 500ms 重读一次（平台可能异步格式化）
        await sleep(500)
        const back2 = await page.evaluate(({ rowIdx, suf }) => {
          const box = document.getElementById('struct-sku')
          if (!box) return ''
          const tr = [...box.querySelectorAll('tbody tr')][rowIdx]
          if (!tr) return ''
          let el = tr.querySelector(`td[id^="${rowIdx}-${suf}"] input`) || tr.querySelector(`td[id*="${suf}"] input`)
          if (!el) {
            const tds = [...tr.querySelectorAll('td')]
            const idx = suf === 'skuPrice' ? 3 : 4
            el = tds[idx]?.querySelector('input')
          }
          return el?.value || ''
        }, { rowIdx: ri, suf: suffix }).catch(() => '')
        const back2Num = parseFloat(String(back2).replace(/[^\d.]/g, ''))
        const match2 = Number.isFinite(back2Num) && Number.isFinite(wantNum)
          ? Math.abs(back2Num - wantNum) < 0.005
          : false
        if (match2) {
          filled.push(`第${ri + 1}行${label}=${val}`)
        } else {
          missed.push(`第${ri + 1}行${label}（写入后回读 "${back2 || back}"，期望 "${val}"）`)
        }
      }
    }
  }

  log(`[sku-v2] 价格库存：已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed }
}
