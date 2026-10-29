/**
 * 发布组件 · 图片上传（主图 / 详情图）
 *
 * 全类目通用。
 *   · uploadMainImages   主图区（最多 5 张，逐张 + CDP 兜底）
 *   · uploadDetailImages 详情图区（逐张 + 计数验证）
 *   · readUploadCount    读「已上传 N/M 张」计数
 */
import { sleep } from './spec-dims.mjs'

/** 主图 file input 锚点 */
export const MAIN_IMAGE_INPUT = 'input[data-tracking-click-viewid="carousel_img_localfile_upload"]'
/** 详情图 file input 锚点 */
export const DETAIL_IMAGE_INPUT = 'input[data-tracking-click-viewid="detail_img_localfile_upload"]'

/**
 * 读某个上传控件所属区块的「已上传 N/M 张」计数
 * ★ 真机实测：文本在第 5 层祖先出现；旧版只爬 10 层且 i<10 边界易卡住 → 改 14 层 + body 兜底
 */
export async function readUploadCount(page, inputSelector) {
  return page.evaluate((sel) => {
    const inp = document.querySelector(sel)
    if (!inp) return { cur: -1, max: -1 }
    let box = inp
    for (let i = 0; i < 14 && box?.parentElement; i++) {
      box = box.parentElement
      const m = (box?.innerText || '').replace(/\s+/g, ' ')
        .match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
      if (m) return { cur: Number(m[1]), max: Number(m[2]) }
    }
    // 兜底：body 全文（主图区在 DOM 顺序靠前）
    const m2 = (document.body?.innerText || '').replace(/\s+/g, ' ')
      .match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/)
    if (m2) return { cur: Number(m2[1]), max: Number(m2[2]) }
    return { cur: -1, max: -1 }
  }, inputSelector).catch(() => ({ cur: -1, max: -1 }))
}

/**
 * 主图逐张上传（最多 maxCount 张）
 * @param opts { maxCount?: 5, onProgress?: (i, total, cnt) => void }
 * @returns { ok, uploaded, total, detail }
 */
export async function uploadMainImages(page, images, opts = {}) {
  const maxCount = opts.maxCount || 5
  const localImgs = (images || []).filter(im => typeof im === 'string' && !/^https?:\/\//i.test(im)).slice(0, maxCount)
  if (!localImgs.length) return { ok: false, uploaded: 0, total: 0, detail: [] }

  const detail = []
  let uploaded = 0
  for (let mi = 0; mi < localImgs.length; mi++) {
    const localImg = localImgs[mi]
    // ★ 2026-10-29：每步加超时保护（page.$ / createCDPSession 在页面忙时会挂住）
    const withTimeout = (p, ms, label) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms)),
    ])

    let input = null
    try {
      input = await withTimeout(page.$(MAIN_IMAGE_INPUT), 5000, 'query-input')
    } catch (e) {
      detail.push({ i: mi, ok: false, via: 'query-timeout' })
      if (opts.onProgress) opts.onProgress(mi + 1, localImgs.length, { cur: -1, max: -1 })
      continue
    }
    if (!input) { detail.push({ i: mi, ok: false, via: 'no-input' }); break }

    try {
      await withTimeout(input.uploadFile(localImg), 20000, 'upload')
    } catch { /* 继续，靠计数判定 */ }

    // 轮询计数（400ms × 8 = 3.2s 上限）
    let cnt = { cur: -1, max: -1 }
    for (let w = 0; w < 8; w++) {
      await sleep(400)
      cnt = await readUploadCount(page, MAIN_IMAGE_INPUT)
      if (cnt.cur > mi) break
    }
    // 没生效 → CDP 兜底
    if (cnt.cur <= mi) {
      try {
        const client = await withTimeout(page.createCDPSession(), 5000, 'cdp-session')
        const doc = await withTimeout(client.send('DOM.getDocument'), 5000, 'cdp-doc')
        const node = await withTimeout(
          client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: MAIN_IMAGE_INPUT }),
          5000, 'cdp-query'
        )
        if (node?.nodeId) {
          await withTimeout(
            client.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [localImg] }),
            15000, 'cdp-set'
          )
          for (let w = 0; w < 10; w++) {
            await sleep(500)
            cnt = await readUploadCount(page, MAIN_IMAGE_INPUT)
            if (cnt.cur > mi) break
          }
        }
      } catch (e) {
        detail.push({ i: mi, ok: false, via: 'cdp-error:' + (e.message || '').slice(0, 20) })
      }
    }
    if (cnt.cur > mi) uploaded++
    detail.push({ i: mi, ok: cnt.cur > mi, via: cnt.cur > mi ? 'upload' : 'fail', count: `${cnt.cur}/${cnt.max}` })
    if (opts.onProgress) opts.onProgress(mi + 1, localImgs.length, cnt)
  }
  return { ok: uploaded === localImgs.length, uploaded, total: localImgs.length, detail }
}

/**
 * 详情图逐张上传
 * @returns { ok, uploaded, note }
 */
export async function uploadDetailImages(page, files, opts = {}) {
  const list = (files || []).filter(f => typeof f === 'string' && !/^https?:\/\//i.test(f))
  if (!list.length) return { ok: true, uploaded: 0, note: '无详情图' }

  const base = await readUploadCount(page, DETAIL_IMAGE_INPUT)
  let counted = base.cur > 0 ? base.cur : 0

  for (let i = 0; i < list.length; i++) {
    let uploaded = false
    for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
      const h = await page.$(DETAIL_IMAGE_INPUT).catch(() => null)
      if (!h) break
      await h.uploadFile(list[i]).catch(() => {})
      const start = Date.now()
      while (Date.now() - start < 30_000) {
        await sleep(400)   // ★ 提速：2s → 400ms
        const fail = await page.evaluate(() => /图片格式不正确|文件过大|超过大小限制|不支持的文件/.test(document.body?.innerText || '')).catch(() => false)
        if (fail) return { ok: false, uploaded: counted, note: '详情图被页面判为失败（格式或大小不符）' }
        const st = await readUploadCount(page, DETAIL_IMAGE_INPUT)
        if (st.cur > counted) { counted = st.cur; uploaded = true }
        if (uploaded) break
      }
    }
    if (!uploaded) {
      const st = await readUploadCount(page, DETAIL_IMAGE_INPUT)
      return { ok: false, uploaded: counted, note: `详情图第 ${i + 1} 张投递后计数未增长（${st.cur < 0 ? '无计数' : st.cur + '/' + st.max}）` }
    }
    await sleep(500)
  }
  return { ok: true, uploaded: counted, note: `已上传 ${counted} 张详情图` }
}
