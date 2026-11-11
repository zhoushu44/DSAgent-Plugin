/**
 * video-upload.mjs — 视频上传（含裁剪对话框处理）
 *
 * 实测 2026-11-08：
 *   塞入视频文件后，页面会弹出「裁剪视频」对话框：
 *
 *     ┌─────────────────────────────────────┐
 *     │ 裁剪视频   宽高比为1:1或16:9或3:4   × │
 *     │ 选择比例： ◉ 1:1  ○ 16:9  ○ 3:4      │
 *     │ ┌───────────────────────────────┐   │
 *     │ │      视频预览 + 裁剪框         │   │
 *     │ └───────────────────────────────┘   │
 *     │         [取消]   [确定]              │
 *     └─────────────────────────────────────┘
 *
 *   ★ 必须选比例 → 点确定，视频才真正上传，否则 cards 永远 0
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 检测裁剪对话框是否出现 */
export async function detectCropDialog(page) {
  return page.evaluate(() => {
    const texts = ['裁剪视频', '选择比例', '宽高比为1:1或16:9或3:4']
    const body = document.body.innerText || ''
    const hasText = texts.some(t => body.includes(t))
    if (!hasText) return { found: false }

    // 找对话框容器
    const dialogs = [...document.querySelectorAll('[class*="Modal"],[class*="modal"],[role="dialog"],[class*="Dialog"]')]
      .filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 300 && r.height > 200
      })
    const dlg = dialogs.find(e => /裁剪视频|选择比例/.test(e.innerText || ''))
    if (!dlg) return { found: false }

    // 读比例选项
    const radios = [...dlg.querySelectorAll('input[type="radio"]')].map((r, i) => {
      const label = r.closest('label') || r.parentElement
      const txt = (label?.innerText || '').replace(/\s+/g, '').trim()
      return { i, text: txt, checked: r.checked }
    })
    // 找按钮
    const btns = [...dlg.querySelectorAll('button')].map(e => ({
      text: (e.innerText || '').replace(/\s+/g, ' ').trim(),
      disabled: !!e.disabled,
    }))

    return { found: true, radios, buttons: btns }
  }).catch(() => ({ found: false }))
}

/** 等裁剪对话框出现（默认 60s） */
export async function waitCropDialog(page, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const d = await detectCropDialog(page)
    if (d.found) return { ok: true, ...d }
    await sleep(1500)
  }
  return { ok: false, found: false }
}

/**
 * 在裁剪对话框里选比例并点确定
 * @param {'1:1'|'16:9'|'3:4'} ratio
 */
export async function confirmCrop(page, ratio = '1:1') {
  const r = await page.evaluate((want) => {
    const dialogs = [...document.querySelectorAll('[class*="Modal"],[class*="modal"],[role="dialog"],[class*="Dialog"]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 300 && r.height > 200 })
    const dlg = dialogs.find(e => /裁剪视频|选择比例/.test(e.innerText || ''))
    if (!dlg) return { ok: false, reason: '找不到裁剪对话框' }

    // ① 选比例
    const norm = s => (s || '').replace(/\s+/g, '').trim()
    let picked = false
    for (const r of dlg.querySelectorAll('input[type="radio"]')) {
      const label = r.closest('label') || r.parentElement
      const txt = norm(label?.innerText || '')
      if (txt === want || txt.includes(want)) {
        if (!r.checked) { r.click() }
        picked = true
        break
      }
    }

    // ② 点「确定」（不是「取消」）
    const btns = [...dlg.querySelectorAll('button')]
    const ok = btns.find(b => /^(确定|确认|完成|下一步|提交)$/.test(norm(b.innerText)))
      || btns.find(b => /确定|确认|完成/.test(norm(b.innerText)))
    if (!ok) return { ok: false, reason: '找不到确定按钮', buttons: btns.map(b => norm(b.innerText)) }
    if (ok.disabled) return { ok: false, reason: '确定按钮禁用' }

    ok.scrollIntoView({ block: 'center' })
    ok.click()
    return { ok: true, picked, btn: norm(ok.innerText) }
  }, ratio).catch(e => ({ ok: false, reason: String(e.message).slice(0, 120) }))

  if (r.ok) await sleep(2000)
  return r
}

/**
 * 上传视频完整流程：塞文件 → 等裁剪弹窗 → 选比例 → 确认
 *
 * @param {object} page
 * @param {object} opts
 * @param {string} opts.inputSelector  input[type=file] 选择器
 * @param {string} opts.file           视频本地路径
 * @param {string} opts.rowId          视频区 form-item id（用于读卡片数）
 * @param {string} [opts.ratio='1:1']  裁剪比例
 * @param {number} [opts.timeoutMs=300000] 等转码
 * @param {function} [opts.onProgress]
 */
export async function uploadVideoWithCrop(page, opts = {}) {
  const {
    inputSelector, file, rowId,
    ratio = '1:1',
    timeoutMs = 300000,
    onProgress,
  } = opts

  const result = { ok: false, stage: '', cardsBefore: 0, cardsAfter: 0, cropDone: false, errors: [] }

  const readCards = async () => {
    return page.evaluate((rid) => {
      const box = document.querySelector(`[id="${rid}"]`)
      if (!box) return -1
      return box.querySelectorAll('.video-cards > *').length
    }, rowId).catch(() => -1)
  }

  // ① 记上传前
  const before = await readCards()
  result.cardsBefore = before
  if (before < 0) { result.errors.push(`找不到视频区 ${rowId}`); return result }

  // ② 塞文件
  const inp = await page.$(inputSelector).catch(() => null)
  if (!inp) { result.errors.push(`找不到 input: ${inputSelector}`); return result }
  try {
    await inp.uploadFile(file)
    result.stage = 'uploaded'
  } catch (e) {
    result.errors.push('uploadFile 失败: ' + String(e.message).slice(0, 100))
    return result
  }

  // ③ 等裁剪对话框
  const cd = await waitCropDialog(page, 45000)
  if (cd.ok) {
    if (onProgress) onProgress({ stage: 'crop-dialog', radios: cd.radios })
    const cr = await confirmCrop(page, ratio)
    result.cropDone = cr.ok
    if (!cr.ok) {
      result.errors.push('裁剪确认失败: ' + (cr.reason || ''))
      // 试试点关闭也能继续（有些情况不需要裁剪）
      await page.evaluate(() => {
        const dlgs = [...document.querySelectorAll('[class*="Modal"],[class*="modal"]')]
        const d = dlgs.find(e => /裁剪视频/.test(e.innerText || ''))
        const x = d?.querySelector('[class*="close"],[class*="Close"]')
        if (x) x.click()
      }).catch(() => { })
      await sleep(2000)
    } else {
      result.stage = 'crop-confirmed'
    }
  } else {
    // 没弹裁剪框，可能不需要
    result.stage = 'no-crop-dialog'
  }

  // ④ 等卡片出现
  const t0 = Date.now()
  let after = before
  while (Date.now() - t0 < timeoutMs) {
    await sleep(3000)
    after = await readCards()
    if (onProgress) onProgress({ stage: 'waiting', cards: after, elapsed: Date.now() - t0 })
    if (after > before) break
  }
  result.cardsAfter = after
  result.ok = after > before

  if (!result.ok) {
    result.errors.push(`等 ${Math.round((Date.now() - t0) / 1000)}s 卡片仍是 ${before}→${after}`)
  }
  return result
}

export default uploadVideoWithCrop
