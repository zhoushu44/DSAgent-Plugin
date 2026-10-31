/**
 * 发布组件 · 服务承诺（7天无理由退货 / 假一赔十 等）
 *
 * ★ 2026-10-31 毛巾类目实测发现：
 *   某些类目**强制要求**勾选「7天无理由退货」，不勾提交报：
 *     「该类商品，必须支持【7天无理由退换货】服务」
 *   之前纸杯/手机壳/抱枕默认已勾选，所以没暴露。
 *
 * 处理策略：
 *   ① 扫描页面上的服务承诺复选框
 *   ② 找出**未勾选 + 强制要求**的项，勾上
 *   ③ 校验勾选成功
 *
 * 通用性：不写死「7天无理由」，而是找所有「必须支持/强制」提示附近的 checkbox。
 */
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 填服务承诺（勾选所有强制要求但未勾选的服务）
 *
 * @param page
 * @param opts { log? }
 * @returns { filled, missed, detail }
 */
export async function fillServiceCommitments(page, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []
  const detail = []

  // ① 扫描所有服务承诺项
  const items = await page.evaluate(() => {
    const out = []
    // 服务承诺区通常在「服务承诺 / 承诺 / 售后」等标题附近
    // 通用做法：找所有含「必须支持」的提示，然后找它附近的 checkbox
    const hints = []
    for (const el of document.querySelectorAll('*')) {
      const t = (el.innerText || '').trim()
      if (!t || t.length > 120) continue
      if (/必须支持|强制要求|必须勾选|该类商品/.test(t)) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) hints.push({ el, text: t })
      }
    }

    for (const hint of hints) {
      // 从提示元素向上找 3-5 层容器，在该容器里找 checkbox
      let container = hint.el
      for (let d = 0; d < 5 && container; d++) {
        const cbs = [...container.querySelectorAll('input[type=checkbox]')]
        if (cbs.length) {
          for (const cb of cbs) {
            // ★ 2026-10-31：beast-core checkbox 的 input 是**隐藏的**（w=0 h=0），
            //   真实选中状态在 `data-checked` 属性上。同时 disabled 的项是平台强制勾选，视为已完成。
            const wrapper = cb.closest('[data-testid="beast-core-checkbox"]') || cb.closest('label')
            const dataChecked = wrapper?.getAttribute('data-checked')
            const isChecked = dataChecked === '1' || cb.checked
            const isDisabled = cb.disabled || /CBX_disabled/.test((wrapper?.className || '').toString())

            const labelEl = cb.closest('label') || cb.parentElement?.parentElement
            const labelText = (labelEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            out.push({
              checked: isChecked,
              disabled: isDisabled,
              text: labelText,
              hintText: hint.text.replace(/\s+/g, ' ').trim().slice(0, 80),
              mark: (() => {
                const id = 'svc_cb_' + Math.random().toString(36).slice(2, 9)
                cb.setAttribute('data-svc-mark', id)
                return id
              })(),
            })
          }
          break
        }
        container = container.parentElement
      }
    }

    // 去重
    const seen = new Set()
    return out.filter(x => {
      if (seen.has(x.mark)) return false
      seen.add(x.mark)
      return true
    })
  }).catch(() => [])

  log(`[service] 发现 ${items.length} 个服务承诺项`)

  if (!items.length) {
    return { filled: [], missed: [], detail: [], note: '无需填写服务承诺' }
  }

  for (const item of items) {
    if (item.disabled) {
      detail.push({ ...item, ok: true, skip: 'disabled' })
      continue
    }
    if (item.checked) {
      log(`[service] 「${item.text}」已勾选`)
      detail.push({ ...item, ok: true, skip: 'already-checked' })
      continue
    }

    // ② 勾选（点击 checkbox 或其 label）
    const clicked = await page.evaluate((mark) => {
      const cb = document.querySelector(`[data-svc-mark="${mark}"]`)
      if (!cb) return false
      // 优先点 label（平台可能监听 label click）
      const label = cb.closest('label')
      if (label) { label.click(); return true }
      cb.click()
      return true
    }, item.mark).catch(() => false)

    if (!clicked) {
      missed.push(`服务承诺「${item.text}」（点击失败）`)
      detail.push({ ...item, ok: false })
      continue
    }
    await sleep(500)

    // ③ 校验
    const nowChecked = await page.evaluate((mark) => {
      const cb = document.querySelector(`[data-svc-mark="${mark}"]`)
      return cb ? cb.checked : false
    }, item.mark).catch(() => false)

    if (nowChecked) {
      filled.push(`服务承诺=${item.text || '已勾选'}`)
      log(`[service] 「${item.text}」→ 已勾选 ✅`)
    } else {
      missed.push(`服务承诺「${item.text}」（勾选后未生效）`)
      log(`[service] 「${item.text}」→ 勾选失败 ❌`)
    }
    detail.push({ ...item, ok: nowChecked })
  }

  // 清理临时标记
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-svc-mark]')) {
      el.removeAttribute('data-svc-mark')
    }
  }).catch(() => {})

  log(`[service] 已勾选 ${filled.length} 项，未勾选 ${missed.length} 项`)
  return { filled, missed, detail }
}
