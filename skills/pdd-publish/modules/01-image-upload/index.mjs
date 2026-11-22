/**
 * 01-image-upload/index.mjs — 拼多多「图片上传模块」（主图 + 详情图 + 视频）
 *
 * ════════════════════════════════════════════════════════════════
 *  三个上传区（实测）
 *
 *  ① 商品主图  goodsCarousel
 *     <section class="goodsCarousel_uploadImgEnter__9UMu8">
 *       <div class="goodsCarousel_selected__1bK2N">(0/10)</div>
 *       <section class="goodsCarousel_btns__22KMn" style="display:none">
 *         <button data-tracking-viewid="image_space_upload">图片空间上传</button>
 *         <span class="MmsUiUploadPicVideoButton___fileButton___2b-vY2-163-0">
 *           <button>
 *             <span>本地上传</span>
 *             <input data-tracking-click-viewid="local_upload"      ← ★
 *                    type="file" accept="image/jpeg,image/png" multiple>
 *           </button>
 *         </span>
 *       </section>
 *     </section>
 *
 *  ② 商品详情图
 *     <span class="MmsUiUploadPicVideoButton___fileButton___2b-vY2-163-0">
 *       <button class="BTN_secondary">
 *         <span class="MmsUiUploadPicVideoButton___title___1CXCO2-163-0">本地上传</span>
 *         <input data-tracking-click-viewid="detail_img_localfile_upload"   ← ★
 *                type="file" accept="image/jpeg,image/png" multiple>
 *       </button>
 *     </span>
 *
 *  ③ 视频（主图视频 / 详情视频）
 *     <div class="uploadImgEnter">
 *       <svg data-testid="beast-core-icon-video">
 *       <div class="uploadBtnText">上传视频</div>          ← ★ 先点这里展开
 *     </div>
 *     （展开后出现）
 *     <input type="file" accept="video/mp4,video/quicktime,video/x-m4v,
 *            video/x-flv,video/x-matroska,video/x-ms-wmv,video/x-msvideo,
 *            application/vnd.rn-realmedia-vbr,video/3gpp" multiple>
 *
 *  ★ 关键：主图和详情图的 input class 完全一样，
 *    只能靠 data-tracking-click-viewid 区分：
 *      主图   = local_upload
 *      详情图 = detail_img_localfile_upload
 *    视频 input 无 tracking-id，只能靠 accept 含 video/ 判断，
 *    且必须先点「上传视频」把按钮组展开
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { uploadImages, probeImageRegion, UPLOAD_TARGETS } from './01-image-upload/index.mjs'
 *
 *   // 主图
 *   await uploadImages(page, { files: ['E:/a.png'], target: 'carousel' })
 *
 *   // 详情图（支持多图）
 *   await uploadImages(page, { files: ['E:/d1.png','E:/d2.png'], target: 'detail' })
 *
 *   // 视频（自动先点「上传视频」展开）
 *   await uploadImages(page, { files: ['E:/v.mp4'], target: 'video' })

 *   // 详情图
 *   await uploadImages(page, { files: ['E:/d1.png','E:/d2.png'], target: 'detail' })
 */

import fs from 'node:fs'
import path from 'node:path'

/** 上传目标配置（实测：第1步 / 第2步 的 tracking-id 不同） */
export const UPLOAD_TARGETS = {
  // ── 第1步（goods/category）──
  'carousel-step1': {
    name: '主图（第1步）',
    trackingIds: ['local_upload'],
    countRoot: 'section[class*="goodsCarousel_uploadImgEnter"]',
    max: 10,
  },
  // ── 第2步（goods_add/index）──
  carousel: {
    name: '商品主图（第2步）',
    trackingIds: ['carousel_img_localfile_upload'],
    countRoot: null,
    max: 10,
  },
  detail: {
    name: '商品详情图',
    trackingIds: ['detail_img_localfile_upload'],
    countRoot: null,
    max: 50,
  },
  whiteBg: {
    name: '白底图',
    trackingIds: ['white_bg_img_localfile_upload'],
    countRoot: null,
    max: 1,
  },
  imageLabel: {
    name: '图片标签',
    trackingIds: ['upload_image_label'],
    countRoot: null,
    max: 1,
  },
  // ── 视频（3 个不同位置）──
  merchandiseVideo: {
    name: '商品视频',
    trackingIds: ['merchandise_video_localfile_upload'],
    acceptRe: /video\//,
    max: 1,
    triggerText: '上传视频',
    maxSizeMB: 100,
  },
  introVideo: {
    name: '介绍视频',
    trackingIds: ['intro_video_localfile_upload'],
    acceptRe: /video\//,
    max: 1,
    triggerText: '上传视频',
    maxSizeMB: 100,
  },
  detailVideo: {
    name: '详情视频',
    trackingIds: ['detail_video_localfile_upload'],
    acceptRe: /video\//,
    max: 1,
    triggerText: '上传视频',
    maxSizeMB: 100,
  },
  // 通用兜底：按类型找第一个
  video: {
    name: '视频（第一个）',
    trackingIds: [],
    acceptRe: /video\//,
    max: 1,
    triggerText: '上传视频',
    maxSizeMB: 100,
  },
}

// 别名：step1 主图也叫 carousel（自动兼容）
UPLOAD_TARGETS['carousel-any'] = {
  name: '主图（自动兼容两步）',
  trackingIds: ['carousel_img_localfile_upload', 'local_upload'],
  countRoot: 'section[class*="goodsCarousel_uploadImgEnter"]',
  max: 10,
}
/** 页面内：按 tracking-id 找 input（支持多个 id + 自动展开视频区） */
const FIND_INPUT = `
function (cfg) {
  // ① 按 tracking-click-viewid（最精确，支持多个候选）
  const ids = cfg.trackingIds || (cfg.trackingId ? [cfg.trackingId] : []);
  for (const tid of ids) {
    const el = document.querySelector('[data-tracking-click-viewid="' + tid + '"]');
    if (el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'file') return el;
  }
  // ② 按 accept 特征
  if (cfg.acceptRe) {
    const re = new RegExp(cfg.acceptRe.source || cfg.acceptRe, 'i');
    const all = [...document.querySelectorAll('input[type="file"]')];
    for (const el of all) if (re.test(el.accept || '')) return el;
  }
  // ③ 兜底：在指定容器内找
  if (cfg.countRoot) {
    const root = document.querySelector(cfg.countRoot);
    if (root) {
      const el = root.querySelector('input[type="file"]');
      if (el) return el;
    }
  }
  // ④ 最后兜底：第一个图片 input
  const imgs = [...document.querySelectorAll('input[type="file"]')].filter(e => /jpeg|png/i.test(e.accept || ''));
  return imgs[0] || null;
}
`

/**
 * 页面内：展开「上传视频」入口（幂等，已展开则跳过）
 * 视频区的 input 默认不渲染，必须先点这个入口把按钮组展开
 */
const EXPAND_VIDEO = `
function (cfg) {
  const txt = cfg.triggerText || '上传视频';
  // 已经是展开状态（input 已存在）就跳过
  for (const tid of (cfg.trackingIds || [])) {
    if (document.querySelector('[data-tracking-click-viewid="' + tid + '"]')) return { ok: true, already: true };
  }
  if (cfg.acceptRe) {
    const re = new RegExp(cfg.acceptRe.source || cfg.acceptRe, 'i');
    for (const el of document.querySelectorAll('input[type="file"]')) {
      if (re.test(el.accept || '')) return { ok: true, already: true };
    }
  }
  // 找入口文字：优先精确等于「上传视频」，其次包含
  const all = [...document.querySelectorAll('div,span,section,button')];
  let hit = all.find(e => (e.textContent || '').replace(/\\s+/g, '') === txt && e.getBoundingClientRect().width > 30)
         || all.find(e => (e.textContent || '').replace(/\\s+/g, '').includes(txt) && e.getBoundingClientRect().width > 30 && (e.textContent || '').length < 12);
  if (!hit) return { ok: false, error: '找不到「' + txt + '」入口' };
  // 点最近的 uploadImgEnter 容器（点了才会展开按钮组）
  const box = hit.closest('[class*="uploadImgEnter"], [class*="uploadBtn"]') || hit;
  box.scrollIntoView({ block: 'center' });
  box.click();
  if (hit !== box) hit.click();
  return { ok: true, clicked: (box.textContent || '').replace(/\\s+/g, '').slice(0, 20) };
}
`

/** 页面内：读计数 */
const READ_COUNT = `
function (cfg) {
  // 主图：从 goodsCarousel 容器读 (n/10)
  if (cfg.countRoot) {
    const root = document.querySelector(cfg.countRoot);
    if (root) {
      const t = (root.textContent || '').replace(/\\s+/g, '');
      const m = t.match(/\\((\\d+)\\/(\\d+)\\)/);
      if (m) return { got: Number(m[1]), max: Number(m[2]), src: 'carousel' };
    }
  }
  // 详情图：找「已上传 n 张」或 (n/50)
  const body = document.body.innerText || '';
  const m1 = body.match(/已上传\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*张/);
  if (m1) return { got: Number(m1[1]), max: Number(m1[2]), src: 'uploaded-text' };
  // 找详情图区附近的计数
  const detailInput = document.querySelector('[data-tracking-click-viewid="detail_img_localfile_upload"]');
  if (detailInput) {
    let scope = detailInput.closest('div[class*="Form_item"], section, div[class*="detailsImage"]');
    for (let i = 0; i < 6 && scope; i++) {
      const t = (scope.textContent || '').replace(/\\s+/g, '');
      const m = t.match(/\\((\\d+)\\/(\\d+)\\)/);
      if (m) return { got: Number(m[1]), max: Number(m[2]), src: 'detail-scope' };
      scope = scope.parentElement;
    }
  }
  return { got: -1, max: -1, src: 'none' };
}
`

/**
 * 探测某个上传区状态
 */
export async function probeImageRegion(page, target = 'carousel') {
  const cfg = UPLOAD_TARGETS[target]
  if (!cfg) return { exists: false, error: `未知 target: ${target}` }

  return page.evaluate(
    new Function('cfg', `
      const findInput = ${FIND_INPUT};
      const readCount = ${READ_COUNT};
      const input = findInput(cfg);
      const count = readCount(cfg);
      return {
        exists: !!input,
        target: cfg.name,
        hasFileInput: !!input,
        trackingId: input ? (input.getAttribute('data-tracking-click-viewid') || '') : '',
        accept: input ? (input.accept || '') : '',
        multiple: input ? !!input.multiple : false,
        got: count.got,
        max: count.max,
        countSrc: count.src,
      };
    `),
    cfg
  ).catch(e => ({ exists: false, error: String(e.message).slice(0, 120) }))
}

/**
 * 上传图片
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} opts.files        本地图片绝对路径
 * @param {'carousel'|'detail'|'video'} [opts.target='carousel']
 * @param {number} [opts.max]          覆盖该区上限
 * @param {number} [opts.timeoutMs=120000]
 * @param {function} [opts.onProgress] (got, max) => void
 * @returns {Promise<{ok, uploaded, before, after, target, errors}>}
 */
export async function uploadImages(page, opts = {}) {
  const target = opts.target || 'carousel'
  const cfg = UPLOAD_TARGETS[target]
  const res = { ok: false, uploaded: 0, target, before: -1, after: -1, errors: [] }
  if (!cfg) { res.errors.push(`未知 target: ${target}（可用: ${Object.keys(UPLOAD_TARGETS).join(', ')}）`); return res }

  const isVideo = !!(cfg.acceptRe && /video/i.test(String(cfg.acceptRe)))
  const files = (opts.files || []).filter(f => {
    if (!fs.existsSync(f)) { res.errors.push(`不存在: ${f}`); return false }
    const size = fs.statSync(f).size
    const limitMB = isVideo ? 100 : 3
    if (size > limitMB * 1024 * 1024) {
      res.errors.push(`超 ${limitMB}MB: ${path.basename(f)} (${(size / 1024 / 1024).toFixed(1)}MB)`)
      return false
    }
    if (isVideo) {
      if (!/\.(mp4|mov|m4v|flv|mkv|wmv|avi|rmvb|3gp)$/i.test(f)) { res.errors.push(`视频格式不支持: ${path.basename(f)}`); return false }
    } else {
      if (!/\.(png|jpe?g)$/i.test(f)) { res.errors.push(`图片只收 jpg/png: ${path.basename(f)}`); return false }
    }
    return true
  })
  if (!files.length) { res.errors.push('没有可上传的文件'); return res }

  // ③ 找 input（视频区会自动先展开「上传视频」）
  let probe = await probeImageRegion(page, target)

  if (!probe.hasFileInput && cfg.triggerText) {
    // ★ 内部自动展开：点「上传视频」→ 按钮组出现 → input 才渲染
    const expanded = await page.evaluate(new Function('cfg', `return (${EXPAND_VIDEO})(cfg)`), cfg)
      .catch(e => ({ ok: false, error: String(e.message).slice(0, 100) }))
    res.expanded = !!expanded?.ok
    if (expanded?.ok) {
      // 等 input 渲染出来（最多 6 秒）
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => new Promise(r => setTimeout(r, 500)))
        probe = await probeImageRegion(page, target)
        if (probe.hasFileInput) break
      }
    } else {
      res.errors.push('展开「' + cfg.triggerText + '」失败: ' + (expanded?.error || ''))
    }
  }

  if (!probe.hasFileInput) {
    res.errors.push(`找不到${cfg.name}的 file input（trackingIds=${(cfg.trackingIds || []).join('/') || 'accept=' + cfg.acceptRe}）`)
    return res
  }
  res.before = probe.got

  // ④ 算可传数量
  const max = opts.max || probe.max || cfg.max
  const space = probe.got >= 0 ? max - probe.got : files.length
  if (space <= 0) { res.errors.push(`${cfg.name}已满（${probe.got}/${max}）`); return res }
  const toUpload = files.slice(0, space)

  // ⑤ 找 handle 并上传（CDP DOM.setFileInputFiles，hidden 也能用）
  let input = null
  for (const tid of (cfg.trackingIds || [])) {
    for (const h of await page.$$(`[data-tracking-click-viewid="${tid}"]`)) {
      const isFile = await page.evaluate(el => el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'file', h).catch(() => false)
      if (isFile) { input = h; break }
    }
    if (input) break
  }
  // 兜底：accept 匹配
  if (!input && cfg.acceptRe) {
    const re = new RegExp(cfg.acceptRe.source || cfg.acceptRe, 'i')
    for (const h of await page.$$('input[type="file"]')) {
      const acc = await page.evaluate(el => el.accept || '', h).catch(() => '')
      if (re.test(acc)) { input = h; break }
    }
  }
  if (!input) { res.errors.push('拿到 input 句柄失败'); return res }

  // ⑤ 塞文件
  //   ★ 策略（2026-11 实测，纯 JS 注入耗时）：
  //     0.33MB→29ms  1.4MB→115ms  4.6MB→342ms  10.2MB→587ms  29.8MB→2021ms
  //     → 纯 JS 完全够用，默认全走 JS
  //     仅当总量 > 50MB（base64 膨胀到 ~67MB，evaluate 往返易超时）才降级 CDP
  const totalMB = toUpload.reduce((a, f) => a + fs.statSync(f).size, 0) / 1024 / 1024
  const useJS = totalMB <= (opts.jsMaxMB ?? 50) && opts.forceCdp !== true

  if (useJS) {
    try {
      const { jsInjectFiles } = await import('./js-file-inject.mjs')
      const jr = await jsInjectFiles(page, {
        files: toUpload,
        trackingId: (cfg.trackingIds || [])[0],
        acceptRe: cfg.acceptRe,
      })
      res.method = 'js-datatransfer'
      res.injectMs = jr.ms
      res.totalMB = jr.totalMB
      if (!jr.ok) {
        res.errors.push('JS 注入失败: ' + (jr.errors || []).join(', '))
        // 失败则降级 CDP
        if (input) {
          try { await input.uploadFile(...toUpload); res.method = 'cdp-fallback' } catch (e) { }
        }
      }
    } catch (e) {
      res.errors.push('JS 注入异常: ' + String(e.message).slice(0, 100))
      try { await input.uploadFile(...toUpload); res.method = 'cdp-fallback' } catch (e2) { }
    }
  } else {
    try {
      await input.uploadFile(...toUpload)
      res.method = 'cdp-uploadFile'
      res.totalMB = +totalMB.toFixed(2)
    } catch (e) {
      res.errors.push('uploadFile 失败: ' + String(e.message || e).slice(0, 120))
      return res
    }
  }

  // ⑥ 轮询等计数上涨
  const want = probe.got >= 0 ? probe.got + toUpload.length : -1
  const timeout = opts.timeoutMs ?? 120000
  const t0 = Date.now()
  let cur = probe.got
  let polls = 0
  while (Date.now() - t0 < timeout) {
    try {
      await page.evaluate(() => new Promise(r => setTimeout(r, 2000)))
      const p2 = await probeImageRegion(page, target)
      if (p2 && typeof p2.got === 'number' && p2.got >= 0) {
        cur = p2.got
        if (typeof opts.onProgress === 'function') opts.onProgress(cur, p2.max || max)
      }
      polls++
    } catch (e) {
      // 页面导航/关闭：停止轮询，按已观察到的计数返回
      res.errors.push('轮询中断: ' + String(e.message || e).slice(0, 60))
      break
    }
    if (want < 0) {
      if (polls >= 4) break
    } else if (cur >= want) break
  }

  res.after = cur
  res.uploaded = want >= 0 ? Math.max(0, cur - probe.got) : toUpload.length
  res.ok = res.uploaded > 0

  if (!res.ok) {
    res.errors.push(
      want >= 0
        ? `计数未变（${probe.got} → ${cur}），可能文件不合规或页面未响应`
        : `未能确认计数，请人工核对（已塞入 ${toUpload.length} 个文件）`
    )
  }
  return res
}

/**
 * 一次性上传主图 + 详情图
 *
 * @param {object} page
 * @param {object} opts { carousel?: string[], detail?: string[] }
 */
export async function uploadAll(page, opts = {}) {
  const out = {}
  if (opts.carousel?.length) {
    out.carousel = await uploadImages(page, { files: opts.carousel, target: 'carousel', onProgress: opts.onProgress })
    await page.evaluate(() => new Promise(r => setTimeout(r, 1500)))
  }
  if (opts.detail?.length) {
    out.detail = await uploadImages(page, { files: opts.detail, target: 'detail', onProgress: opts.onProgress })
  }
  return out
}






