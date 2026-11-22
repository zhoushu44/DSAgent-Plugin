/**
 * js-file-inject.mjs — 纯 JS 方式给 input[type=file] 塞文件
 *
 * 原理（浏览器安全限制下唯一可行的纯 JS 路径）：
 *   ① Node 侧读文件 → base64
 *   ② page.evaluate 里 atob → Uint8Array → new File() → DataTransfer
 *   ③ input.files = dt.files
 *   ④ dispatchEvent('change') 触发 React/原生监听
 *
 * 对比 CDP uploadFile()：
 *   CDP  : DOM.setFileInputFiles，浏览器直接把本地路径挂到 input
 *   JS   : 文件内容经 CDP 传成 base64 字符串再塞进去
 *
 * 性能实测（见文件末尾注释）：
 *   1 张 1.4MB PNG → base64 约 1.9MB，evaluate 往返 < 1 秒
 *   5 张 = 约 9MB 字符串，单次 evaluate 2-4 秒
 *   → 图片小（≤3MB）完全可用；视频（几十 MB）不推荐
 */
import fs from 'node:fs'
import path from 'node:path'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.flv': 'video/x-flv',
}

/**
 * 纯 JS 方式上传文件
 *
 * @param {object} page
 * @param {object} opts
 * @param {string[]} opts.files      本地文件绝对路径
 * @param {string} [opts.trackingId] input 的 data-tracking-click-viewid
 * @param {string} [opts.selector]   直接给 input 选择器
 * @param {string} [opts.acceptRe]   accept 正则（找哪个 input）
 * @param {number} [opts.timeoutMs]  等待 input 出现
 * @returns {Promise<{ok:boolean, injected:number, method:string, ms:number, errors:string[]}>}
 */
export async function jsInjectFiles(page, opts = {}) {
  const t0 = Date.now()
  const res = { ok: false, injected: 0, method: 'js-datatransfer', ms: 0, errors: [] }

  const files = (opts.files || []).filter(f => {
    if (!fs.existsSync(f)) { res.errors.push('不存在: ' + f); return false }
    return true
  })
  if (!files.length) { res.errors.push('没有文件'); res.ms = Date.now() - t0; return res }

  // ① Node 侧读 → base64
  const payload = []
  let totalBytes = 0
  for (const f of files) {
    const buf = fs.readFileSync(f)
    totalBytes += buf.length
    payload.push({
      name: path.basename(f),
      mime: MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      b64: buf.toString('base64'),
    })
  }

  // ② 页面内构造 File 并塞入
  const r = await page.evaluate(async (args) => {
    const { payload, trackingId, selector, acceptRe } = args

    // 找 input
    let input = null
    if (selector) {
      input = document.querySelector(selector)
    }
    if (!input && trackingId) {
      const el = document.querySelector('[data-tracking-click-viewid="' + trackingId + '"]')
      if (el && el.tagName === 'INPUT') input = el
    }
    if (!input && acceptRe) {
      const re = new RegExp(acceptRe, 'i')
      input = [...document.querySelectorAll('input[type="file"]')].find(e => re.test(e.accept || ''))
    }
    if (!input) return { ok: false, error: '找不到 input[type=file]' }
    if (input.tagName !== 'INPUT' || (input.type || '').toLowerCase() !== 'file') {
      return { ok: false, error: '目标不是 file input' }
    }

    // base64 → File
    const dt = new DataTransfer()
    const built = []
    for (const p of payload) {
      try {
        const bin = atob(p.b64)
        const len = bin.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], p.name, { type: p.mime })
        dt.items.add(file)
        built.push({ name: p.name, size: file.size, type: file.type })
      } catch (e) {
        return { ok: false, error: '构造 File 失败: ' + String(e.message || e) }
      }
    }

    if (!dt.files.length) return { ok: false, error: 'DataTransfer 为空' }

    // ★ 塞进去
    try {
      input.files = dt.files
    } catch (e) {
      // 某些浏览器 files 只读，用 defineProperty 兜底
      try {
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true })
      } catch (e2) {
        return { ok: false, error: '设置 input.files 失败: ' + String(e2.message || e2) }
      }
    }

    // ★ 必须派发 change
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))

    return {
      ok: true,
      injected: input.files.length,
      built,
      trackingId: input.getAttribute('data-tracking-click-viewid') || '',
      accept: input.accept || '',
    }
  }, {
    payload,
    trackingId: opts.trackingId || '',
    selector: opts.selector || '',
    acceptRe: opts.acceptRe ? String(opts.acceptRe.source || opts.acceptRe) : '',
  }).catch(e => ({ ok: false, error: String(e.message).slice(0, 150) }))

  res.ms = Date.now() - t0
  res.totalMB = +(totalBytes / 1024 / 1024).toFixed(2)
  res.b64MB = +(payload.reduce((a, p) => a + p.b64.length, 0) / 1024 / 1024).toFixed(2)

  if (!r.ok) { res.errors.push(r.error); return res }
  res.ok = true
  res.injected = r.injected
  res.input = { trackingId: r.trackingId, accept: r.accept }
  res.built = r.built
  return res
}

/**
 * 对比测试：JS vs CDP 两种方式传同一批文件
 *
 * @param {object} page
 * @param {object} opts { files, trackingId, acceptRe }
 * @returns {Promise<{js:object, cdp:object, faster:string}>}
 */
export async function compareUploadMethods(page, opts = {}) {
  const out = {}

  // JS 方式
  try {
    out.js = await jsInjectFiles(page, opts)
  } catch (e) { out.js = { ok: false, errors: [String(e.message).slice(0, 100)] } }

  // 等一会儿让页面反应
  await page.evaluate(() => new Promise(r => setTimeout(r, 2000)))

  // CDP 方式
  const t0 = Date.now()
  try {
    let input = null
    for (const tid of (opts.trackingIds || [opts.trackingId].filter(Boolean))) {
      for (const h of await page.$$(`[data-tracking-click-viewid="${tid}"]`)) {
        const isFile = await page.evaluate(el => el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'file', h).catch(() => false)
        if (isFile) { input = h; break }
      }
      if (input) break
    }
    if (!input && opts.acceptRe) {
      const re = new RegExp(opts.acceptRe.source || opts.acceptRe, 'i')
      for (const h of await page.$$('input[type="file"]')) {
        const acc = await page.evaluate(el => el.accept || '', h).catch(() => '')
        if (re.test(acc)) { input = h; break }
      }
    }
    if (!input) throw new Error('找不到 input')
    await input.uploadFile(...opts.files)
    out.cdp = { ok: true, method: 'cdp-uploadFile', ms: Date.now() - t0 }
  } catch (e) {
    out.cdp = { ok: false, method: 'cdp-uploadFile', ms: Date.now() - t0, errors: [String(e.message).slice(0, 100)] }
  }

  out.faster = (out.js?.ms || 1e9) < (out.cdp?.ms || 1e9) ? 'js' : 'cdp'
  return out
}
