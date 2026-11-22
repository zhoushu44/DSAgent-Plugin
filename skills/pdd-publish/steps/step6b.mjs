/**
 * step6b.mjs — 商品详情图上传
 *
 * 页面位置：「商品详情」区（在属性区下方）
 * 控件：input[type="file"]，通常 multiple 且 accept 含 image
 *
 * 与主图的区别：
 *   主图  section[class*="goodsCarousel_uploadImgEnter"] input[type=file]
 *   详情  在「商品详情 / 详情图 / 图文详情」区块内
 *
 * 上传后必须补派发 input + change 事件（React 才认）
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 找详情图 file input 的定位描述（在页面内执行）
 * 返回 { found, index, total, why, nearText }
 */
export async function locateDetailInput(page) {
  return page.evaluate(() => {
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
    const all = [...document.querySelectorAll('input[type="file"]')]

    // ★ 实测结构（2026-11-11）：
    //   商品详情区文字：「已上传0/50张 仅支持上传图片 图片空间上传 本地上传」
    //   两个 file input：0=图片空间上传 1=本地上传  → 用【本地上传】那个（index 1）
    const detailBlocks = []
    for (const el of document.querySelectorAll('section, div')) {
      const t = norm(el.innerText)
      if (!/已上传\s*\d+\s*\/\s*50\s*张/.test(t) && !/仅支持上传图片/.test(t)) continue
      if (t.length > 800) continue
      const files = [...el.querySelectorAll('input[type="file"]')]
      if (files.length) detailBlocks.push({ el, files, t })
    }

    if (detailBlocks.length) {
      // 取最内层（files 最少）的那个区块
      detailBlocks.sort((a, b) => a.files.length - b.files.length)
      const blk = detailBlocks[0]
      // 优先找「本地上传」那个 input
      let chosen = blk.files[blk.files.length - 1]
      let why = 'detail-block-last'
      // 用邻近文字确认
      for (const f of blk.files) {
        let anc = f.parentElement, txt = ''
        for (let d = 0; d < 5 && anc; d++) { txt = norm(anc.innerText); if (txt.length > 2) break; anc = anc.parentElement }
        if (/本地上传/.test(txt) && txt.length < 40) { chosen = f; why = 'detail-benDi'; break }
      }
      const idx = all.indexOf(chosen)
      return { found: true, index: idx >= 0 ? idx : blk.files.length - 1, total: all.length, why, blockText: blk.t.slice(0, 100) }
    }

    // 兜底：排除主图区后，multiple + accept 含 image 的最后一个
    const rest = all.map((e, i) => ({ e, i })).filter(x =>
      x.e.multiple && /image/.test(x.e.accept || '') && !x.e.closest('section[class*="goodsCarousel"]')
    )
    if (rest.length) {
      const pick = rest[rest.length - 1]
      return { found: true, index: pick.i, total: all.length, why: 'multiple-fallback' }
    }

    return { found: false, total: all.length }
  }).catch(e => ({ found: false, error: String(e.message).slice(0, 100) }))
}

/**
 * 上传详情图
 * @param {object} page
 * @param {object} opts { files: string[], verify?: boolean }
 */
export async function step6b_uploadDetailImages(page, opts = {}) {
  const files = (opts.files || []).filter(f => f && typeof f === 'string')
  const result = { ok: false, count: 0, errors: [], warnings: [] }
  if (!files.length) { result.ok = true; result.skipped = true; return result }

  // 记录上传前的计数
  const countInPage = async () => page.evaluate(() => {
    const norm = s => String(s || '').replace(/\s+/g, ' ')
    const t = document.body.innerText || ''
    // 「已上传 N/M 张」或「上传图片 (N/M)」
    const m1 = t.match(/已上传\s*(\d+)\s*\/\s*(\d+)/)
    const m2 = t.match(/上传图片\s*[（(]\s*(\d+)\s*\/\s*(\d+)/)
    // 详情区缩略图数量（img 数）
    const imgs = document.querySelectorAll('div[class*="description"] img, div[class*="Detail"] img, div[class*="detail"] img').length
    return { a: m1 ? +m1[1] : -1, b: m2 ? +m2[1] : -1, imgs }
  }).catch(() => ({ a: -1, b: -1, imgs: -1 }))

  const before = await countInPage(result)

  // 定位
  const loc = await locateDetailInput(page)
  result.locate = loc
  if (!loc.found) {
    result.errors.push('找不到详情图上传控件（共 ' + (loc.total || 0) + ' 个 file input）')
    return result
  }

  // 最多重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 重新取 handle（页面可能重渲染）
      const handles = await page.$$('input[type="file"]')
      const fi = handles[loc.index]
      if (!fi) { await sleep(800); continue }

      // 清空避免同文件被忽略
      await fi.evaluate(el => { try { el.value = '' } catch { } }).catch(() => { })

      await fi.uploadFile(...files).catch(e => { result.warnings.push('uploadFile: ' + String(e.message).slice(0, 60)) })

      // 补派发事件（React 才认）
      await fi.evaluate(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }).catch(() => { })

      // 轮询看数量是否变化（最多 15s）
      for (let i = 0; i < 50; i++) {
        const now = await countInPage(result)
        const changed = (now.a > before.a && before.a >= 0) || (now.b > before.b && before.b >= 0) || (now.imgs > before.imgs && before.imgs >= 0)
        if (changed) {
          result.ok = true
          result.count = files.length
          result.after = now
          result.attempt = attempt + 1
          return result
        }
        await sleep(300)
      }

      result.warnings.push(`第 ${attempt + 1} 次上传后计数未变`)
    } catch (e) {
      result.warnings.push(`第 ${attempt + 1} 次异常: ${String(e.message).slice(0, 80)}`)
      await sleep(1000)
    }
  }

  // 3 次都没检测到计数变化 → 保守判定失败
  result.errors.push('详情图上传后计数未变化（已重试 3 次）')
  result.before = before
  result.after = await countInPage(result)
  return result
}

export default step6b_uploadDetailImages
