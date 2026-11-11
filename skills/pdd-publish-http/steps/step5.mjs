/**
 * step5.mjs — 步骤 5：白底图（JS 直接塞 input，不点任何可见区，不弹系统文件框）
 */
export async function step5_uploadWhiteBg(page, opts = {}) {
  const files = opts.files || []
  if (!files.length) return { ok: false, errors: ['未提供图片'] }

  // ★ 直接找隐藏的 input（display:none 也能塞），不点上传区、不弹窗
  const sel = 'input[data-tracking-click-viewid="white_bg_img_localfile_upload"]'
  const input = await page.$(sel)
  if (!input) {
    const alt = await page.$('input[type="file"][accept*="image/jpeg"]')
    if (!alt) return { ok: false, errors: ['找不到白底图 file input（' + sel + '）'] }
    await alt.uploadFile(files[0])
  } else {
    await input.uploadFile(files[0])
  }

  // 读结果：缩略图或状态
  const after = await page.evaluate(() => {
    const box = document.querySelector('.goods-basic-materials-pic-wrapper-v2, .activity-materials-pic')
    if (!box) return { hasImg: false }
    const imgs = [...box.querySelectorAll('[style*="background-image"]')]
      .map(e => (e.style.backgroundImage || '').match(/url\(["']?([^"')]+)/))
      .filter(Boolean).map(m => m[1])
    const status = box.querySelector('.imageStatus')
    return { hasImg: imgs.length > 0, imgUrl: imgs[0] || '', status: status ? (status.innerText || '').trim() : '' }
  }).catch(() => ({ hasImg: false }))

  return { ok: true, uploaded: 1, method: 'js-input-no-dialog', ...after }
}

export default step5_uploadWhiteBg
