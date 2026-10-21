/**
 * 拼多多图片空间「逆向 HTTP 上传」—— **逐行照抄觅千手 v5.61**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 来源
 * ══════════════════════════════════════════════════════════════════════
 *   C:\Users\Administrator\AppData\Local\Temp\mqs-swarm\rea-gm-modules\m_042_8087.js
 *   模块 m_042_8087 内的 `uploadToPddCdn` / `getUploadSignature` /
 *   `createFileRecord` / `queryFileDetail`（@97364 附近）。
 *
 *   本文**不做任何「优化」**——凡是与原文不同的地方都会失败（已实测踩坑）：
 *
 *   ┌ 觅千手原文 ────────────────────────────────────────────────
 *   │ async getUploadSignature() {
 *   │   const e = await _()                        // Anti-Content
 *   │   const t = await fetch(".../galerie/business/get_signature", {
 *   │     method:"POST",
 *   │     headers:{"Content-Type":"application/json","Anti-Content":e},  ← 带签名
 *   │     body:JSON.stringify({bucket_tag:"mms-material-img"})          ← 这个 bucket
 *   │   })
 *   │   return r.result.signature
 *   │ }
 *   │
 *   │ async uploadToPddCdn(e, t, r) {
 *   │   await sleep(500 + 1000*Math.random())     ← 先随机等
 *   │   const i = await this.getUploadSignature()
 *   │   const n = new FormData
 *   │   n.append("image", e, t)                   ← 只有这两个字段
 *   │   n.append("upload_sign", i)                ← 没有 pic_operations
 *   │   const s = await fetch("https://file.pinduoduo.com/v3/store_image",
 *   │                        {method:"POST", body:n})
 *   │   const o = await s.json()
 *   │   if (o.error_msg) return null
 *   │   const l = o.url                           ← 取 o.url（顶层，不是 result.url）
 *   │   const c = await this.createFileRecord(l, t)
 *   │   await sleep(500 + 1000*Math.random())     ← 再随机等
 *   │   return c.result
 *   │     ? (this.uploadedCount++, await this.queryFileDetail(c.result, l))
 *   │     : c.error_msg && c.error_msg.includes("稍后重试")
 *   │       && (this.uploadRetryCount++, await sleep(2000), this.uploadRetryCount<=10)
 *   │         ? await this.uploadToPddCdn(e, t, r)   ← 重试 10 次
 *   │         : null
 *   │ }
 *   │
 *   │ async createFileRecord(e, t) {
 *   │   const r = await _()                       // Anti-Content
 *   │   const i = {create_time:Date.now(), extension:"jpeg", name:t, url:e}
 *   │   // ← 没有 pic_operations；extension 硬编码 "jpeg"
 *   │   this.imageFolderId && (i.dir_id_list = [this.imageFolderId])
 *   │   const n = await fetch(".../garner/mms/file/create", {
 *   │     method:"POST",
 *   │     headers:{"Content-Type":"application/json","Anti-Content":r},
 *   │     body:JSON.stringify(i)})
 *   │   return await n.json()
 *   │ }
 *   │
 *   │ async queryFileDetail(e, t) {
 *   │   const r = await _()
 *   │   const i = await fetch(".../garner/mms/file/queryFileDetail", {
 *   │     method:"POST",
 *   │     headers:{"Content-Type":"application/json","Anti-Content":r},
 *   │     body:JSON.stringify({file_id:e, file_url:t})})
 *   │   return (await i.json()).result
 *   │ }
 *   └────────────────────────────────────────────────────────────
 *
 * ★ 两种签名必须区分（混用必失败，实测）：
 *     · `upload_sign`（来自 get_signature，约 620 字符）→ 只给 store_image 的 form 字段
 *     · `Anti-Content`（来自页面 fbeZ 模块，约 455 字符）→ 只给 garner/mms/file/* 的请求头
 *   ✗ 给 create 不带 Anti-Content → 40002「操作太过频繁」（假象，实为缺签名）
 *   ✗ 把 fbeZ 签名当 upload_sign → 48005「签名已过期」
 *
 * ★ 性能实测：16 张 13.4 秒（约 0.84s/张）。DOM 上传需 2~5 分钟。
 */

import { readFileSync } from 'node:fs'

/** 上传结果 */
export interface PddImageUploadResult {
  ok: boolean
  /** 正式 CDN URL（img.pddpic.com/...），可直接进 commitBody.gallery */
  url?: string
  /** 图片空间 file_id */
  fileId?: number
  width?: number
  height?: number
  size?: number
  error?: string
  ms?: number
}

/** 接口常量（照抄原文 URL） */
export const PDD_STORE_IMAGE_URL = 'https://file.pinduoduo.com/v3/store_image'
export const PDD_GET_SIGNATURE_URL = 'https://mms.pinduoduo.com/galerie/business/get_signature'
/** ★ 原文用的 bucket_tag 是 mms-material-img（不是 mms-goods-image） */
export const PDD_IMAGE_BUCKET_TAG = 'mms-material-img'
export const PDD_FILE_CREATE_URL = 'https://mms.pinduoduo.com/garner/mms/file/create'
export const PDD_FILE_DETAIL_URL = 'https://mms.pinduoduo.com/garner/mms/file/queryFileDetail'
export const PDD_FILE_PRECHECK_URL = 'https://mms.pinduoduo.com/garner/mms/file/preCheck'

/** 上传重试次数上限（原文 uploadRetryCount <= 10） */
const MAX_RETRY = 10
/** 随机等待（原文 500 + 1000*Math.random()） */
const randSleep = () => new Promise<void>(r => setTimeout(r, 500 + Math.round(1000 * Math.random())))

/** 从路径取文件名去扩展名（原文 extension 硬编码 jpeg，这里只取 name） */
export function imageBaseName(filePath: string): string {
  const base = String(filePath || '').replace(/\\/g, '/').split('/').pop() || 'image'
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 判断已是拼多多图床 URL（可跳过上传） */
export function isPddCdnUrl(u: unknown): boolean {
  const s = String(u || '')
  return /^https?:\/\/(img|pfs|video\d*)\.pddpic\.com\//i.test(s)
    || /^https?:\/\/pfs\.pinduoduo\.com\//i.test(s)
}

/**
 * 注入 `window.getAntiContent`（照抄觅千手 m_062_8174 的**兜底分支**）。
 *
 * 原文主路径是 `chunk.length>=4 && typeof chunk[3]==="function"`，
 * 但拼多多现在是 webpack v4（chunk 只有 2 个元素 `[ids, modules]`），主路径命中不了，
 * 必须走兜底：在 `chunk[1]` 里按**字符串键** `'fbeZ'` 查模块表。
 * （只扫数字键会误报 module not found —— 实测踩过）
 *
 * ★ 只能在**主应用页面**（如 /goods/goods_list）执行；
 *   图片空间页 /material/upload 是独立子应用（只有 58 个模块），不含 fbeZ。
 */
export async function ensurePddAntiContent(page: any): Promise<{ ok: boolean; len?: number; error?: string }> {
  try {
    return await page.evaluate(() => {
      const w = window as any
      const wp = w.webpackJsonp
      if (!Array.isArray(wp)) return { ok: false, error: 'webpackJsonp 不存在' }

      // 原文 findWebpackRequire 的兜底实现
      const webpackRequire = function (moduleId: string) {
        for (const chunk of wp) {
          if (!Array.isArray(chunk)) continue
          const table = chunk[1]
          if (!table || typeof table !== 'object') continue
          if (table[moduleId]) {
            const module = { exports: {} as any }
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
        if (typeof anti !== 'function') throw new Error('sj("fbeZ") 不是构造函数（页面可能不含主应用）')
        const res = new anti()
        res.updateServerTime(new Date().getTime())
        return res.messagePack()
      }
      try {
        const test = w.getAntiContent()
        return { ok: true, len: String(test).length }
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e).slice(0, 200) }
      }
    })
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}

/**
 * 单张上传（照抄 uploadToPddCdn）。
 *
 * @param page 主应用页面（已登录）
 * @param b64  图片 base64（Node 侧读好传入）
 * @param name 文件名去扩展名（原文的 t 参数）
 * @param mime 仅用于 FormData 的 Blob 类型（原文由 blob 自带，这里显式给）
 */
export async function uploadPddImage(
  page: any,
  b64: string,
  name: string,
  mime = 'image/jpeg',
): Promise<PddImageUploadResult> {
  const t0 = Date.now()
  try {
    const r = await page.evaluate(async (args: {
      storeUrl: string; sigUrl: string; createUrl: string; detailUrl: string
      bucketTag: string; b64: string; mime: string; name: string
    }) => {
      const out: any = { ok: false }
      const w = window as any

      /** 原文 `_()`：取 Anti-Content */
      const anti = () => {
        const fn = w.getAntiContent
        if (typeof fn !== 'function') throw new Error('getAntiContent 不存在（需主应用页面）')
        return String(fn() || '')
      }

      /** 原文 getUploadSignature —— 带 Anti-Content，bucket_tag=mms-material-img */
      const getUploadSignature = async () => {
        const e = anti()
        const t = await fetch(args.sigUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': e },
          body: JSON.stringify({ bucket_tag: args.bucketTag }),
        })
        const r: any = await t.json().catch(() => ({}))
        const sig = r?.result?.signature
        if (!sig) throw new Error('get_signature 未返回签名：' + JSON.stringify(r).slice(0, 200))
        return String(sig)
      }

      /** 原文 createFileRecord —— extension 硬编码 "jpeg"，无 pic_operations */
      const createFileRecord = async (url: string, nameArg: string) => {
        const r = anti()
        const i: any = { create_time: Date.now(), extension: 'jpeg', name: nameArg, url }
        const n = await fetch(args.createUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': r },
          body: JSON.stringify(i),
        })
        return await n.json().catch(() => ({}))
      }

      /** 原文 queryFileDetail —— 返回 result */
      const queryFileDetail = async (fileId: any, url: string) => {
        const r = anti()
        const i = await fetch(args.detailUrl, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Anti-Content': r },
          body: JSON.stringify({ file_id: fileId, file_url: url }),
        })
        const n: any = await i.json().catch(() => ({}))
        return n.result
      }

      try {
        // ── 原文：await sleep(500 + 1000*Math.random()) ──
        await new Promise(res => setTimeout(res, 500 + Math.round(1000 * Math.random())))

        const uploadSign = await getUploadSignature()
        out.uploadSignLen = uploadSign.length

        // ── 原文：FormData 只有 image + upload_sign ──
        const bin = atob(args.b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const blob = new Blob([bytes], { type: args.mime })

        const fd = new FormData()
        fd.append('image', blob, args.name)          // ★ 原文 n.append("image", e, t)
        fd.append('upload_sign', uploadSign)         // ★ 原文 n.append("upload_sign", i)

        const resp = await fetch(args.storeUrl, { method: 'POST', body: fd })
        const j: any = await resp.json().catch(() => ({}))
        if (j?.error_msg) {
          out.error = `store_image: ${j.error_msg}（code=${j.error_code ?? '?'}）`
          return out
        }
        // ★ 原文取 o.url（顶层）
        const pfsUrl = j?.url
        if (!pfsUrl) {
          out.error = 'store_image 未返回 url：' + JSON.stringify(j).slice(0, 200)
          return out
        }
        out.pfsLen = String(pfsUrl).length

        // ── 原文：createFileRecord → sleep → queryFileDetail ──
        const created: any = await createFileRecord(pfsUrl, args.name)
        if (!created?.result) {
          out.error = `file/create: ${JSON.stringify(created).slice(0, 250)}`
          out.retryable = !!created?.error_msg && String(created.error_msg).includes('稍后重试')
          return out
        }
        out.fileId = created.result

        await new Promise(res => setTimeout(res, 500 + Math.round(1000 * Math.random())))

        const detail: any = await queryFileDetail(created.result, pfsUrl)
        if (!detail?.url) {
          out.error = 'queryFileDetail 无 url：' + JSON.stringify(detail).slice(0, 200)
          return out
        }

        out.ok = true
        out.url = detail.url
        out.width = detail.width ?? detail?.extra_info?.width
        out.height = detail.height ?? detail?.extra_info?.height
        out.size = detail.size ?? detail?.extra_info?.size
        return out
      } catch (e: any) {
        out.error = String(e?.message || e).slice(0, 250)
        return out
      }
    }, {
      storeUrl: PDD_STORE_IMAGE_URL,
      sigUrl: PDD_GET_SIGNATURE_URL,
      createUrl: PDD_FILE_CREATE_URL,
      detailUrl: PDD_FILE_DETAIL_URL,
      bucketTag: PDD_IMAGE_BUCKET_TAG,
      b64, mime, name,
    })

    // ── 原文重试：error_msg 含「稍后重试」→ sleep 2s → 最多 10 次 ──
    if (!r?.ok && r?.retryable) {
      return { ok: false, error: `需重试：${r.error}`, ms: Date.now() - t0, retryable: true } as PddImageUploadResult
    }

    return {
      ok: !!r?.ok,
      url: r?.url,
      fileId: r?.fileId,
      width: r?.width,
      height: r?.height,
      size: r?.size,
      error: r?.error,
      ms: Date.now() - t0,
    }
  } catch (e: any) {
    return { ok: false, error: `上传异常：${e?.message || String(e)}`, ms: Date.now() - t0 }
  }
}

/**
 * 批量上传（照抄顺序：串行 + 每张独立取签名 + 「稍后重试」退避 10 次）。
 */
export async function uploadPddImages(
  page: any,
  items: Array<{ path: string; b64: string; mime?: string }>,
  onProgress?: (done: number, total: number, last: PddImageUploadResult) => void,
): Promise<PddImageUploadResult[]> {
  const out: PddImageUploadResult[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const name = imageBaseName(it.path)
    let r = await uploadPddImage(page, it.b64, name, it.mime || 'image/jpeg')

    // 原文：error_msg 含「稍后重试」→ sleep 2s → uploadRetryCount++ → 最多 10 次
    let retry = 0
    while (!r.ok && (r as any).retryable && retry < MAX_RETRY) {
      retry++
      await new Promise(res => setTimeout(res, 2000))
      r = await uploadPddImage(page, it.b64, name, it.mime || 'image/jpeg')
    }

    out.push(r)
    onProgress?.(i + 1, items.length, r)
  }
  return out
}

/** 容量预检（原文用 preCheck，同样带 Anti-Content） */
export async function pddCanUpload(page: any): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await page.evaluate(async (url: string) => {
      const w = window as any
      const anti = typeof w.getAntiContent === 'function' ? String(w.getAntiContent() || '') : ''
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Anti-Content': anti },
        body: '{}',
      })
      return await resp.json().catch(() => null)
    }, PDD_FILE_PRECHECK_URL)
    return { ok: !!r?.result?.can_upload, reason: r?.result?.reason || undefined }
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) }
  }
}

/** 便捷：直接从本地路径上传（内部读文件 + base64） */
export async function uploadPddImageFromPath(
  page: any,
  filePath: string,
): Promise<PddImageUploadResult> {
  try {
    const b64 = readFileSync(filePath).toString('base64')
    const mime = /\.png$/i.test(filePath) ? 'image/png' : 'image/jpeg'
    return await uploadPddImage(page, b64, imageBaseName(filePath), mime)
  } catch (e: any) {
    return { ok: false, error: `读文件失败：${e?.message || String(e)}` }
  }
}
