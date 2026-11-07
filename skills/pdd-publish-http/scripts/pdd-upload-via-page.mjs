/**
 * pdd-upload-via-page.mjs — 在页面内上传图片（一次 evaluate 一张）
 *
 * 为什么不用 lib/pdd-image-space.js：
 *   那个实现把「5 张图 + 签名 + 建记录」全塞进一个 page.evaluate，
 *   一旦渲染器被节流，整个 Promise 挂死（实测 >120s）。
 *
 * 本实现：一张图一次 evaluate，单次执行时间短，配合页面保活，
 * 即使偶发慢也不会整体挂死。
 */
import fs from 'node:fs'
import path from 'node:path'

const log = console.log

/**
 * 在页面内上传一张图
 * @param page puppeteer page（须是 /goods/goods_list 主应用页）
 * @param filePath 本地图片绝对路径
 * @param idx 序号（用于日志）
 * @param total 总数
 */
async function uploadOneInPage(page, filePath, idx, total) {
  const name = path.basename(filePath).replace(/\.[^.]+$/, '')
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const b64 = fs.readFileSync(filePath).toString('base64')

  const r = await Promise.race([
    page.evaluate(async (args) => {
      const out = { ok: false, step: '' }
      const w = window

      // ── 确保 getAntiContent 可用 ──
      if (typeof w.getAntiContent !== 'function') {
        const wp = w.webpackJsonp
        if (!Array.isArray(wp)) { out.error = 'webpackJsonp 不存在'; return out }
        w.sj = function (moduleId) {
          for (const chunk of wp) {
            if (!Array.isArray(chunk)) continue
            const table = chunk[1]
            if (!table || typeof table !== 'object') continue
            if (table[moduleId]) {
              const module = { exports: {} }
              const exportsObj = {}
              const fakeReq = () => ({})
              table[moduleId](module, exportsObj, fakeReq)
              return module.exports.default || module.exports
            }
          }
          return {}
        }
        w.getAntiContent = function () {
          const anti = w.sj('fbeZ')
          if (typeof anti !== 'function') throw new Error('sj("fbeZ") 非构造函数')
          const res = new anti()
          res.updateServerTime(new Date().getTime())
          return res.messagePack()
        }
      }
      const anti = () => String(w.getAntiContent() || '')

      try {
        // ① 取签名
        out.step = 'signature'
        const sigResp = await fetch('https://mms.pinduoduo.com/galerie/business/get_signature', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': anti() },
          body: JSON.stringify({ bucket_tag: 'mms-material-img' }),
        })
        const sigJson = await sigResp.json().catch(() => ({}))
        const sig = sigJson?.result?.signature
        if (!sig) { out.error = 'signature: ' + JSON.stringify(sigJson).slice(0, 180); return out }

        // ② 传对象存储
        out.step = 'store'
        const bin = atob(args.b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const blob = new Blob([bytes], { type: args.mime })
        const fd = new FormData()
        fd.append('image', blob, args.fileName)
        fd.append('upload_sign', String(sig))
        const storeResp = await fetch('https://file.pinduoduo.com/v3/store_image', { method: 'POST', body: fd })
        const storeJson = await storeResp.json().catch(() => ({}))
        if (storeJson?.error_msg) { out.error = 'store: ' + storeJson.error_msg; return out }
        const pfsUrl = storeJson?.url
        if (!pfsUrl) { out.error = 'store 无 url: ' + JSON.stringify(storeJson).slice(0, 180); return out }

        // ③ 建文件记录（关键：在本页面内发，带完整浏览器上下文）
        out.step = 'file/create'
        await new Promise(res => setTimeout(res, 400 + Math.round(Math.random() * 600)))
        const createResp = await fetch('https://mms.pinduoduo.com/garner/mms/file/create', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': anti() },
          body: JSON.stringify({ create_time: Date.now(), extension: 'jpeg', name: args.name, url: pfsUrl }),
        })
        const createJson = await createResp.json().catch(() => ({}))
        if (!createJson?.result) { out.error = 'file/create: ' + JSON.stringify(createJson).slice(0, 220); return out }
        const fileId = createJson.result

        // ④ 取最终 URL
        out.step = 'detail'
        await new Promise(res => setTimeout(res, 400 + Math.round(Math.random() * 600)))
        const detailResp = await fetch('https://mms.pinduoduo.com/garner/mms/file/queryFileDetail', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': anti() },
          body: JSON.stringify({ file_id: fileId, file_url: pfsUrl }),
        })
        const detailJson = await detailResp.json().catch(() => ({}))
        const finalUrl = detailJson?.result?.url
        if (!finalUrl) { out.error = 'detail 无 url: ' + JSON.stringify(detailJson).slice(0, 180); return out }

        out.ok = true
        out.url = finalUrl
        out.fileId = fileId
        return out
      } catch (e) {
        out.error = String(e?.message || e).slice(0, 200)
        return out
      }
    }, { b64, mime, name, fileName: path.basename(filePath) }).catch(e => ({ ok: false, error: 'evaluate: ' + e.message.slice(0, 100) })),
    new Promise(res => setTimeout(() => res({ ok: false, error: 'evaluate timeout 60s' }), 60000)),
  ])

  return r
}

/**
 * 批量上传（一次 evaluate 一张，带重试）
 * @param page   puppeteer page（/goods/goods_list）
 * @param files  本地图片路径数组
 * @param logFn  日志
 */
export async function uploadImagesViaPage(page, files, logFn = log) {
  const out = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    let r = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        r = await uploadOneInPage(page, f, i + 1, files.length)
      } catch (e) {
        r = { ok: false, error: String(e.message || e).slice(0, 150) }
      }
      if (r?.ok) break
      const wait = String(r?.error || '').includes('40002') ? 10000 : 5000
      logFn(`   第 ${i + 1}/${files.length} 张失败（${r?.error}），${wait / 1000}s 后重试…`)
      await new Promise(x => setTimeout(x, wait))
    }
    logFn(`   ${r?.ok ? '✅' : '❌'} ${i + 1}/${files.length} ${path.basename(f)}${r?.ok ? '' : ' → ' + r?.error}`)
    if (r?.ok) out.push({ path: f, url: r.url, fileId: r.fileId })
    if (i < files.length - 1) await new Promise(x => setTimeout(x, 2500))
  }
  return out
}
