/**
 * 06-sku-thumb/index.mjs — 拼多多「SKU 预览图模块」
 *
 * 给每一行 SKU 设置预览图（改动 sku.thumb_url）
 *
 * ════════════════════════════════════════════════════════════════
 *  页面结构（实测）
 *
 *  SKU 表格每行预览图单元格：
 *    <span data-volta="680fc0f3-..." class="sku-preview-img">
 *      <svg data-testid="beast-core-icon-picture">...</svg>     ← 未设置时显示图标
 *    </span>
 *
 *  已设置时（图片替代图标）：
 *    <span class="sku-preview-img">
 *      <img src="https://img.pddpic.com/..." width="32" height="32">
 *    </span>
 *
 *  点击后弹出图片选择弹窗（从商品主图/图片空间选）
 *
 *  ★ 三条规则（实测）
 *    ① 每个 .sku-preview-img 对应一行 SKU
 *    ② 点击弹出选图窗口，窗口里是商品已上传的主图
 *    ③ 选图后弹窗关闭，该行 thumb_url 更新
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { setSkuThumbs, probeSkuThumbs } from './06-sku-thumb/index.mjs'
 *
 *   // 给每行按顺序配图（配到第几行就用第几张）
 *   await setSkuThumbs(page, { urls: ['https://...1.png','https://...2.png'] })
 *
 *   // 或按索引指定
 *   await setSkuThumbs(page, { map: { 0: 'https://...1.png', 2: 'https://...3.png' } })
 *
 *   // 探测现状
 *   await probeSkuThumbs(page)
 */

const norm = s => String(s || '').replace(/[\s\u3000]/g, '')

const HELPERS = `
(function () {
  if (window.__pddThumb) return;

  function vis(e){if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0}

  // 所有 SKU 预览图格子
  function cells(){
    return [...document.querySelectorAll('.sku-preview-img, [class*="sku-preview-img"], [class*="skuPreviewImg"]')];
  }

  // 格子当前是否有图
  function hasImg(el){
    if(!el)return false;
    const img=el.querySelector('img');
    return !!(img&&img.src);
  }

  // 弹窗（选图窗口）
  function findPopup(){
    const modals=[...document.querySelectorAll(
      '[class*="Modal"],[class*="modal"],[class*="Dialog"],[class*="dialog"],[class*="Drawer"],[class*="drawer"]'
    )].filter(e=>vis(e)&&e.getBoundingClientRect().width>200);
    // 取最后一个（最上层）
    return modals.length?modals[modals.length-1]:null;
  }

  // 弹窗里的可选图片
  function popupImages(){
    const p=findPopup();
    if(!p)return [];
    return [...p.querySelectorAll('img')].filter(vis).map(el=>({
      src: el.src||'',
      w: Math.round(el.getBoundingClientRect().width),
    })).filter(x=>x.src&&x.w>20);
  }

  window.__pddThumb={vis,cells,hasImg,findPopup,popupImages};
})();
true;
`

/**
 * 探测 SKU 预览图现状
 * @returns {Promise<{count:number, cells:Array<{index:number,hasImg:boolean,src:string}>}>}
 */
export async function probeSkuThumbs(page) {
  await page.evaluate(HELPERS).catch(() => { })
  return page.evaluate(() => {
    const T = window.__pddThumb
    const cs = T.cells()
    return {
      count: cs.length,
      cells: cs.map((el, i) => {
        const img = el.querySelector('img')
        return { index: i, hasImg: !!(img && img.src), src: img ? img.src.slice(0, 100) : '' }
      }),
    }
  }).catch(() => ({ count: 0, cells: [] }))
}

/**
 * 打开某一行的预览图选择弹窗
 */
export async function openThumbPicker(page, index = 0) {
  await page.evaluate(HELPERS).catch(() => { })
  const r = await page.evaluate((idx) => {
    const T = window.__pddThumb
    const cs = T.cells()
    const el = cs[idx]
    if (!el) return { ok: false, error: `第 ${idx} 行不存在（共 ${cs.length} 行）` }
    el.scrollIntoView({ block: 'center' })
    el.click()
    return { ok: true, total: cs.length }
  }, index).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))
  if (r.ok) await page.evaluate(() => new Promise(r => setTimeout(r, 1500)))
  return r
}

/**
 * 等选图弹窗出现
 */
export async function waitThumbPopup(page, timeoutMs = 8000) {
  await page.evaluate(HELPERS).catch(() => { })
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const r = await page.evaluate(() => {
      const T = window.__pddThumb
      const p = T.findPopup()
      if (!p) return { ok: false }
      const imgs = T.popupImages()
      return {
        ok: true,
        text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        imgCount: imgs.length,
        images: imgs.slice(0, 10).map(x => x.src.slice(0, 80)),
        buttons: [...p.querySelectorAll('button')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6),
      }
    }).catch(() => ({ ok: false }))
    if (r.ok) return r
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)))
  }
  return { ok: false, error: '弹窗未出现' }
}

/**
 * 在弹窗里选中一张图
 *
 * @param {object} page
 * @param {object} opts
 * @param {number} [opts.imageIndex=0]  弹窗里第几张（0 开始）
 * @param {string} [opts.imageUrl]      按 URL 匹配
 * @param {boolean} [opts.confirm=true] 是否需要点确认
 */
export async function pickThumbInPopup(page, opts = {}) {
  await page.evaluate(HELPERS).catch(() => { })

  // ① 点图片
  const picked = await page.evaluate((wantIdx, wantUrl) => {
    const T = window.__pddThumb
    const p = T.findPopup()
    if (!p) return { ok: false, error: '无弹窗' }
    const imgs = [...p.querySelectorAll('img')].filter(T.vis)
    if (!imgs.length) return { ok: false, error: '弹窗里没有图片' }

    let hit = null
    if (wantUrl) hit = imgs.find(e => (e.src || '').includes(wantUrl) || wantUrl.includes((e.src || '').split('/').pop()))
    if (!hit) hit = imgs[wantIdx || 0]
    if (!hit) return { ok: false, error: `第 ${wantIdx} 张不存在（共 ${imgs.length} 张）` }

    // 点在 img 或其可点父元素
    const clickable = hit.closest('li, [class*="item"], [class*="Item"], label, div') || hit
    clickable.scrollIntoView({ block: 'center' })
    clickable.click()
    if (clickable !== hit) hit.click()
    return { ok: true, picked: (hit.src || '').slice(0, 100) }
  }, opts.imageIndex || 0, opts.imageUrl || '').catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))

  if (!picked.ok) return picked
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)))

  // ② 点确认（如果有）
  if (opts.confirm !== false) {
    const confirmed = await page.evaluate(() => {
      const T = window.__pddThumb
      const p = T.findPopup()
      if (!p) return { ok: true, closed: true }   // 选完自动关了
      const btns = [...p.querySelectorAll('button')]
      const ok = btns.find(b => /确定|确认|完成|保存/.test((b.textContent || '').replace(/\s+/g, '')))
      if (!ok) return { ok: true, noConfirmBtn: true }
      ok.click()
      return { ok: true, clicked: (ok.textContent || '').trim() }
    }).catch(() => ({ ok: false }))
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)))
    picked.confirm = confirmed
  }

  return picked
}

/**
 * 批量设置 SKU 预览图
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} [opts.urls]   按行顺序配图（第 i 行用 urls[i % urls.length]）
 * @param {object}   [opts.map]    指定行 → 图片 URL
 * @param {number}   [opts.maxRows] 最多处理几行（默认全部）
 * @returns {Promise<{ok:boolean, done:number, total:number, results:Array, errors:Array}>}
 */
export async function setSkuThumbs(page, opts = {}) {
  const res = { ok: false, done: 0, total: 0, results: [], errors: [] }
  await page.evaluate(HELPERS).catch(() => { })

  const probe = await probeSkuThumbs(page)
  res.total = probe.count
  if (!probe.count) { res.errors.push('页面上没有 .sku-preview-img（SKU 表格未渲染？）'); return res }

  const maxRows = opts.maxRows || probe.count
  const urls = opts.urls || []
  const map = opts.map || null
  if (!urls.length && !map) { res.errors.push('需要 urls 或 map'); return res }

  for (let i = 0; i < Math.min(maxRows, probe.count); i++) {
    const wantUrl = map ? map[i] : urls[i % urls.length]
    if (!wantUrl) continue

    // ① 开弹窗
    const opened = await openThumbPicker(page, i)
    if (!opened.ok) { res.results.push({ row: i, ok: false, error: opened.error }); continue }

    // ② 等弹窗
    const popup = await waitThumbPopup(page, 8000)
    if (!popup.ok) {
      res.results.push({ row: i, ok: false, error: '弹窗未出现' })
      // 关掉可能的遮罩
      await page.evaluate(() => { document.body.click(); return true }).catch(() => { })
      continue
    }

    // ③ 选图
    const picked = await pickThumbInPopup(page, { imageUrl: wantUrl, imageIndex: 0 })
    if (!picked.ok) {
      res.results.push({ row: i, ok: false, error: picked.error, popupImgCount: popup.imgCount })
      await page.evaluate(() => { document.body.click(); return true }).catch(() => { })
      continue
    }

    res.done++
    res.results.push({ row: i, ok: true, picked: picked.picked })
    await page.evaluate(() => new Promise(r => setTimeout(r, 600)))
  }

  res.ok = res.done > 0
  if (!res.ok) res.errors.push('没有一行设置成功')
  return res
}

export { norm }

