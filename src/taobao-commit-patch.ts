/**
 * 淘宝提交「拦改重放」—— 把觅千手拼多多侧的 transformRequestBody 思路移植过来。
 *
 * 用户提出的思路（2026-10）：
 *   先让页面正常提交一次拿到真实 commitBody，再按它的结构拼装数据，然后改包上传。
 *   优点：完全不依赖页面把 SKU 表 / 属性控件渲染出来 —— 直接对齐后端契约。
 *
 * 实现方式（比「先提交再拼装」更省事，也更稳）：
 *   一次提交中完成拦截与改写。用 CDP Fetch 域在请求发出前拦下
 *   `partEdit/previewDraftSubmit.htm` 的 POST，把 jsonBody 里我们关心的字段
 *   （title / price / quantity / mainImagesGroup / catProp / saleProp / sku /
 *     descRepublicOfSell / tbExtractWay …）替换成本地组装的值，再放行。
 *
 *   ★ 这样做的关键好处：页面自己已经把所有「我们不会填的字段」都填好了
 *     （catPath / stuffStatus / guaranteeService / 各种 card / skyLightRule …），
 *     我们只需做**增量覆盖**，不必从零构造完整契约（那等于把平台 schema 抄一遍，
 *     任何版本变更都会崩）。
 *
 * 用法：由 taobao-publish.ts 在 clickSubmit 前挂载，提交后取回改写报告。
 */

export interface CommitOverride {
  /** 字段名 → 新值（直接覆盖 jsonBody 顶层同名字段） */
  fields: Record<string, unknown>
  /** 为 true 时，若目标字段在提交体里不存在也会写入（默认 true） */
  allowCreate?: boolean
  /** 是否把改写前后的对比写进返回值（诊断用） */
  keepDiff?: boolean
}

export interface CommitPatchResult {
  /** 是否拦到目标请求 */
  intercepted: boolean
  /** 是否成功改写并放行 */
  patched: boolean
  /** 被改写的字段 */
  patchedFields: string[]
  /** 跳过原因 */
  reason?: string
  /** 改写前/后的长度（诊断） */
  beforeLen?: number
  afterLen?: number
  /** 提交接口 URL（诊断） */
  url?: string
}

/** 提交接口的 URL 特征（真实实测：/sell/partEdit/previewDraftSubmit.htm） */
const SUBMIT_URL_RE = /previewDraftSubmit\.htm|\/sell\/partEdit\//i

/**
 * 在页面里挂 CDP 拦截，改写提交体的 jsonBody。
 *
 * 返回一个「等结果」的函数：调用方点完提交后 await 它，拿到改写报告。
 * 内部用 Fetch.enable 拦请求，改完 continueRequest 放行。
 */
export async function installCommitPatcher(
  page: any,
  override: CommitOverride,
  opts: { timeoutMs?: number } = {},
): Promise<{ wait: () => Promise<CommitPatchResult>; dispose: () => Promise<void> }> {
  const cdp = await page.target().createCDPSession()
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*previewDraftSubmit*', requestStage: 'Request' }],
  }).catch(() => { /* 老内核可能不支持，下面会超时返回 */ })

  let resolved = false
  let result: CommitPatchResult = { intercepted: false, patched: false, patchedFields: [] }
  let resolveFn: ((r: CommitPatchResult) => void) | null = null
  const done = new Promise<CommitPatchResult>((res) => { resolveFn = res })

  const finish = (r: CommitPatchResult) => {
    if (resolved) return
    resolved = true
    result = r
    resolveFn?.(r)
  }

  cdp.on('Fetch.requestPaused', async (ev: any) => {
    try {
      const url = String(ev.request?.url || '')
      if (!SUBMIT_URL_RE.test(url)) {
        await cdp.send('Fetch.continueRequest', { requestId: ev.requestId })
        return
      }
      const post = String(ev.request?.postData || '')
      if (!post.includes('jsonBody=')) {
        await cdp.send('Fetch.continueRequest', { requestId: ev.requestId })
        finish({ intercepted: false, patched: false, patchedFields: [], reason: 'no_jsonBody', url })
        return
      }

      // 拆 form：jsonBody 单独解，其余字段原样保留
      const parts = post.split('&')
      let changed = false
      const patchedFields: string[] = []
      const out: string[] = []
      for (const kv of parts) {
        const eq = kv.indexOf('=')
        if (eq < 0) { out.push(kv); continue }
        const key = kv.slice(0, eq)
        const rawVal = kv.slice(eq + 1)
        if (key !== 'jsonBody') { out.push(kv); continue }

        let body: any = null
        try { body = JSON.parse(decodeURIComponent(rawVal)) } catch { body = null }
        if (!body || typeof body !== 'object') { out.push(kv); continue }

        for (const [k, v] of Object.entries(override.fields || {})) {
          const exists = Object.prototype.hasOwnProperty.call(body, k)
          if (!exists && override.allowCreate === false) continue
          body[k] = v
          patchedFields.push(k)
          changed = true
        }

        const reenc = encodeURIComponent(JSON.stringify(body))
        out.push(`jsonBody=${reenc}`)
      }

      if (!changed) {
        await cdp.send('Fetch.continueRequest', { requestId: ev.requestId })
        finish({ intercepted: true, patched: false, patchedFields: [], reason: 'no_target_field', url })
        return
      }

      const newBody = out.join('&')
      await cdp.send('Fetch.continueRequest', {
        requestId: ev.requestId,
        postData: Buffer.from(newBody, 'utf8').toString('base64'),
      })
      finish({
        intercepted: true, patched: true, patchedFields,
        beforeLen: post.length, afterLen: newBody.length, url,
      })
    } catch (e) {
      // 出错也要放行，绝不能把用户的提交卡死
      try { await cdp.send('Fetch.continueRequest', { requestId: ev.requestId }) } catch { /* 忽略 */ }
      finish({ intercepted: true, patched: false, patchedFields: [], reason: `err:${e instanceof Error ? e.message : String(e)}` })
    }
  })

  const timeoutMs = opts.timeoutMs ?? 120_000
  const wait = async (): Promise<CommitPatchResult> => {
    const t = new Promise<CommitPatchResult>((res) =>
      setTimeout(() => res({ ...result, reason: result.reason || 'timeout' }), timeoutMs))
    const r = await Promise.race([done, t])
    return r
  }
  const dispose = async () => {
    try { await cdp.send('Fetch.disable') } catch { /* 忽略 */ }
    try { await cdp.detach() } catch { /* 忽略 */ }
  }
  return { wait, dispose }
}

/**
 * 从「一次真实提交」里拿到服务端接受的字段清单 —— 用于校准 override 的字段名。
 * （诊断辅助：真正发布不需要它）
 */
export function pickKnownFields(body: Record<string, unknown>): string[] {
  return Object.keys(body || {})
}
