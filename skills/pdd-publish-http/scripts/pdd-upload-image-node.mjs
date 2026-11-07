/**
 * pdd-upload-image-node.mjs — Node 侧直接上传图片到 PDD 图片空间
 *
 * 为什么要重写：lib/pdd-image-space.js 的整条上传链路都在 page.evaluate 里跑，
 * 而 Chrome 渲染器节流会把 page.evaluate 拖死（实测 commit/submit 会挂 120s+）。
 * 这里只在页面里取一次 Anti-Content token，后续全部 Node fetch。
 *
 * 流程（与 pdd-image-space.js 一致）：
 *   ① 页面取 getAntiContent()
 *   ② POST get_signature  {bucket_tag: 'mms-material-img'}  → signature
 *   ③ POST store_image    FormData(image, upload_sign)      → url
 *   ④ POST file/create    {extension,name,url}              → file_id
 *   ⑤ POST file/getImagePro/queryFileDetail                 → 最终 CDN url
 */
import fs from 'node:fs'
import path from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const BASE = 'https://mms.pinduoduo.com'

const SIG_URL = 'https://mms.pinduoduo.com/galerie/business/get_signature'
const STORE_URL = 'https://file.pinduoduo.com/v3/store_image'
const CREATE_URL = `${BASE}/garner/mms/file/create`
const DETAIL_URL = 'https://mms.pinduoduo.com/garner/mms/file/queryFileDetail'
const BUCKET = 'mms-material-img'

const log = console.log

/**
 * 从页面取一次 Anti-Content
 */
async function getAntiContent(page) {
  for (let i = 0; i < 10; i++) {
    const t = await page.evaluate(() => {
      try {
        // ★ 先注入 webpack hook（ensurePddAntiContent 的逻辑）
        const w = window
        if (typeof w.getAntiContent !== 'function') {
          const wp = w.webpackJsonp
          if (!Array.isArray(wp)) return ''
          const webpackRequire = function (moduleId) {
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
          w.sj = webpackRequire
          w.getAntiContent = function () {
            const anti = w.sj('fbeZ')
            if (typeof anti !== 'function') throw new Error('sj("fbeZ") 不是构造函数')
            const res = new anti()
            res.updateServerTime(new Date().getTime())
            return res.messagePack()
          }
        }
        return String(w.getAntiContent() || '')
      } catch { }
      return ''
    }).catch(() => '')
    if (t) return t
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('拿不到 Anti-Content（需在 goods_list 等主应用页面，且 webpackJsonp 存在）')
}

/**
 * 上传一张图
 * @returns {{ok:boolean, url?:string, fileId?:string, error?:string}}
 */
async function uploadOne(cookie, anti, filePath) {
  const name = path.basename(filePath).replace(/\.[^.]+$/, '')
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const buf = fs.readFileSync(filePath)

  // ★ 补全浏览器特征头：file/create 对非浏览器请求会直接报 40002
  const H = {
    'cookie': cookie,
    'origin': BASE,
    'referer': `${BASE}/goods/goods_list`,
    'user-agent': UA,
    'Anti-Content': anti,
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  }

  // ② 取签名
  const r1 = await fetch(SIG_URL, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ bucket_tag: BUCKET }),
    signal: AbortSignal.timeout(30000),
  })
  const j1 = await r1.json().catch(() => ({}))
  const sig = j1?.result?.signature
  if (!sig) return { ok: false, error: 'getUploadSign: ' + JSON.stringify(j1).slice(0, 200) }

  // ③ 上传到对象存储
  const fd = new FormData()
  fd.append('image', new Blob([buf], { type: mime }), path.basename(filePath))
  fd.append('upload_sign', String(sig))
  const r2 = await fetch(STORE_URL, { method: 'POST', headers: H, body: fd, signal: AbortSignal.timeout(60000) })
  const j2 = await r2.json().catch(() => ({}))
  if (j2?.error_msg) return { ok: false, error: 'storeImage: ' + j2.error_msg }
  const pfsUrl = j2?.url
  if (!pfsUrl) return { ok: false, error: 'storeImage 无 url: ' + JSON.stringify(j2).slice(0, 200) }

  // ④ 建文件记录
  const r3 = await fetch(CREATE_URL, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ create_time: Date.now(), extension: 'jpeg', name, url: pfsUrl }),
    signal: AbortSignal.timeout(30000),
  })
  const j3 = await r3.json().catch(() => ({}))
  const fileId = j3?.result
  if (!fileId) return { ok: false, error: 'file/create: ' + JSON.stringify(j3).slice(0, 250) }

  // ⑤ 取最终 CDN url
  await new Promise(r => setTimeout(r, 600))
  const r4 = await fetch(DETAIL_URL, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, file_url: pfsUrl }),
    signal: AbortSignal.timeout(30000),
  })
  const j4 = await r4.json().catch(() => ({}))
  const finalUrl = j4?.result?.url
  if (!finalUrl) return { ok: false, error: 'getImagePro 无 url: ' + JSON.stringify(j4).slice(0, 200) }

  return { ok: true, url: finalUrl, fileId }
}

/**
 * 批量上传
 * @param page   puppeteer page（用于取 Anti-Content）
 * @param cookie 浏览器 Cookie 字符串
 * @param files  本地图片绝对路径数组
 * @param logFn  日志函数
 */
export async function uploadImagesViaNode(page, cookie, files, logFn = log) {
  const out = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    let r = null
    // ★ 每张图重新取 Anti-Content（一个 token 只能用于一次签名）
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const anti = await getAntiContent(page)
        r = await uploadOne(cookie, anti, f)
      } catch (e) {
        r = { ok: false, error: String(e.message || e).slice(0, 150) }
      }
      if (r.ok) break
      const wait = r.error?.includes('40002') ? 8000 : 4000
      logFn(`   第 ${i + 1}/${files.length} 张失败（${r.error}），${wait / 1000}s 后重试…`)
      await new Promise(x => setTimeout(x, wait))
    }
    logFn(`   ${r.ok ? '✅' : '❌'} ${i + 1}/${files.length} ${path.basename(f)}${r.ok ? '' : ' → ' + r.error}`)
    if (r.ok) out.push({ path: f, url: r.url, fileId: r.fileId })
    // ★ 图与图之间留间隔，避免 40002
    if (i < files.length - 1) await new Promise(x => setTimeout(x, 3500))
  }
  return out
}





