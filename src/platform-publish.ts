/**
 * 平台发布路由 —— 把 12 个发布技能的 host 实现，暴露成一个统一 HTTP action。
 *
 * ## 为什么要这一层
 *
 * 工作流引擎（workflow/service.ts）的六项校验里，第二项会拒绝**纯指令型**技能当步骤：
 *    「第 N 个步骤的技能「xxx」是纯指令型（无可执行入口），不能作为步骤」
 * 而 12 个发布技能里有 11 个都是纯指令型（只有 SKILL.md，靠模型直接调 host 工具）。
 * 结果是「取数 → 成文 → 发布」无法整条编排进工作流。
 *
 * 修法不是在 TS 里给每个平台写一遍参数映射（那样只是把重复搬个地方），
 * 而是：**共享桥 + 薄壳**
 *
 *     skills/_shared/publish_bridge.py     一份传输实现（HTTP / 错误归一 / 预览处理）
 *         ↑ 引用
 *     skills/<platform>-publish/scripts/publish.py    薄壳：只声明 platform + 参数映射
 *         ↓ POST /dsagent/api  action=publish_platform
 *     本文件 dispatchPlatformPublish()     按 platform 分发到各平台真实实现
 *
 * ## 为什么不统一参数
 *
 * 各平台签名差异是本质的，硬统一会造出畸形结构：
 *   zhihu        title + content
 *   douyin       videoPath + title
 *   bilibili     videoPath + title
 *   xiaohongshu  title + (videoPath | imagePaths)
 *   xianyu       images + description + price
 *   taobao       images + title (+ 一堆类目/图片空间开关)
 *   taobao-mqs   product(JSON)
 *   jd/douyin_shop/1688-mqs  product(JSON)
 *   pdd2         product(JSON)
 *
 * 所以统一的是**传输层与确认门禁**，payload 原样透传给各平台实现。
 *
 * ## L2 门禁
 *
 * 所有平台实现内部都有 `confirm !== true → 只返回预览、不启动浏览器、不产生写操作`。
 * 本层不做任何放行：confirm 未 true 时保持原样透传，由平台实现决定走预览还是提交。
 * 唯一的例外是 `diagDom`（DOM 诊断，零写操作），它按 mqs 既有语义放行。
 */

import { parseProduct, validateProduct } from './services/product-schema.js'

/** 支持的发布平台标识（与 skills/<id>/scripts/publish.py 的 --platform 取值一致） */
export const PUBLISH_PLATFORMS = [
  'zhihu',
  'douyin',
  'bilibili',
  'xiaohongshu',
  'xianyu',
  'taobao',
  'taobao-mqs',
  'tmall-mqs',
  'jd',
  'douyin-shop',
  '1688',
  'pdd2',
] as const

export type PublishPlatform = typeof PUBLISH_PLATFORMS[number]

/**
 * 各平台真实实现句柄。由 index.ts 注入（保持本文件不直接依赖 puppeteer 实现细节，
 * 也避免与 tools-publish.ts 形成循环引用）。
 */
export interface PlatformPublishHandlers {
  zhihu: (opts: any) => Promise<unknown>
  douyin: (opts: any) => Promise<unknown>
  bilibili: (opts: any) => Promise<unknown>
  xiaohongshu: (opts: any) => Promise<unknown>
  xianyu: (opts: any) => Promise<unknown>
  taobao: (opts: any) => Promise<unknown>
  /** mqs 引擎：仅 jd / douyin_shop / 1688 三平台（淘宝天猫走 taobaoPublish 的 MQS 形态） */
  mqs: (channel: 'jd' | 'douyin_shop' | '1688', opts: any) => Promise<unknown>
  /** 淘宝/天猫的「统一商品数据」形态（对应 dsagent_taobao_publish_mqs） */
  taobaoMqs: (opts: any) => Promise<unknown>
  pdd2: (opts: any) => Promise<unknown>
}

/** images / imagePaths 这类字段：既接受 JSON 数组字符串，也接受英文逗号分隔 */
function parsePathList(raw: unknown): { list: string[]; error?: string } {
  const s = String(raw ?? '').trim()
  if (!s) return { list: [] }
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) {
        return { list: parsed.map(p => String(p ?? '').trim()).filter(Boolean) }
      }
    } catch {
      return {
        list: [],
        error: '图片字段看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg"]），或改用英文逗号分隔。',
      }
    }
  }
  return { list: s.split(',').map(p => p.trim()).filter(Boolean) }
}

function asStr(v: unknown): string {
  return v != null ? String(v) : ''
}

function asBool(v: unknown): boolean {
  if (v === true) return true
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y'
}

const ok = (r: unknown) => (r && typeof r === 'object' ? r : { ok: false, failureKind: 'api_error', text: '平台返回空结果' })

/**
 * 按 platform 分发到真实实现。
 *
 * ★ confirm 语义完全交给各平台实现：这里只做「字符串 true → 布尔 true」的归一，
 *   绝不在 confirm 未 true 时放行写操作。
 */
export async function dispatchPlatformPublish(
  handlers: PlatformPublishHandlers,
  body: Record<string, unknown>,
): Promise<unknown> {
  const platform = String(body.platform ?? '').trim().toLowerCase()
  const confirm = asBool(body.confirm)
  const account = asStr(body.account).trim()
  const agentId = asStr(body.agentId) || 'default'
  const p = (body.payload && typeof body.payload === 'object')
    ? body.payload as Record<string, unknown>
    : {}

  if (!platform) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `缺少 platform。可选：${PUBLISH_PLATFORMS.join(' / ')}`,
    }
  }

  try {
    switch (platform) {
      case 'zhihu':
        return ok(await handlers.zhihu({
          title: asStr(p.title),
          content: asStr(p.content),
          confirm,
          account,
          agentId,
        }))

      case 'douyin':
        return ok(await handlers.douyin({
          videoPath: asStr(p.videoPath),
          title: asStr(p.title),
          description: asStr(p.description),
          confirm,
          account,
          agentId,
        }))

      case 'bilibili':
        return ok(await handlers.bilibili({
          videoPath: asStr(p.videoPath),
          title: asStr(p.title),
          description: asStr(p.description),
          tags: asStr(p.tags),
          partition: asStr(p.partition),
          statement: asStr(p.statement),
          confirm,
          account,
          agentId,
        }))

      case 'xiaohongshu': {
        const imgs = parsePathList(p.imagePaths)
        if (imgs.error) return { ok: false, failureKind: 'api_error', text: imgs.error }
        return ok(await handlers.xiaohongshu({
          videoPath: asStr(p.videoPath),
          imagePaths: imgs.list,
          title: asStr(p.title),
          content: asStr(p.content),
          confirm,
          account,
          agentId,
        }))
      }

      case 'xianyu': {
        const imgs = parsePathList(p.images)
        if (imgs.error) return { ok: false, failureKind: 'api_error', text: imgs.error }
        return ok(await handlers.xianyu({
          images: imgs.list,
          description: asStr(p.description),
          title: asStr(p.title),
          price: asStr(p.price),
          originalPrice: asStr(p.originalPrice),
          confirm,
          account,
          agentId,
        }))
      }

      case 'taobao': {
        const imgs = parsePathList(p.images)
        if (imgs.error) return { ok: false, failureKind: 'api_error', text: imgs.error }
        // skus：[{"name":"红色","price":"99","stock":"10","outerId":"SKU001"}]
        let skus: any[] | undefined
        const rawSkus = asStr(p.skus).trim()
        if (rawSkus) {
          try {
            const parsed = JSON.parse(rawSkus)
            if (Array.isArray(parsed)) {
              skus = parsed.map((s: any) => ({
                name: asStr(s?.name).trim(),
                price: s?.price != null ? asStr(s.price).trim() : undefined,
                stock: s?.stock != null ? asStr(s.stock).trim() : undefined,
                outerId: s?.outerId != null ? asStr(s.outerId).trim() : undefined,
              })).filter((s: any) => s.name)
            }
          } catch {
            return { ok: false, failureKind: 'api_error', text: 'skus 不是合法 JSON 数组，形如 [{"name":"红色","price":"99","stock":"10"}]。' }
          }
        }
        return ok(await handlers.taobao({
          images: imgs.list,
          title: asStr(p.title),
          channel: asStr(p.channel),
          price: asStr(p.price),
          stock: asStr(p.stock),
          itemNo: asStr(p.itemNo),
          skus,
          categoryKeyword: asStr(p.categoryKeyword),
          brand: asStr(p.brand),
          model: asStr(p.model),
          confirm,
          replayMode: asBool(p.replayMode),
          // 默认 true（与 dsagent_taobao_publish 一致）：只有显式传 false 才关闭
          imageSpaceUpload: !(p.imageSpaceUpload === false || String(p.imageSpaceUpload ?? '').toLowerCase() === 'false'),
          imageSpaceFolderId: asStr(p.imageSpaceFolderId),
          imageSpaceConcurrency: p.imageSpaceConcurrency != null ? Number(p.imageSpaceConcurrency) || 3 : 3,
          account,
          agentId,
        }))
      }

      case 'taobao-mqs':
      case 'tmall-mqs': {
        // 淘宝/天猫的「统一商品数据」形态（与京东/抖店/1688/拼多多同构）。
        // 走 taobaoMqs 而非 mqs：MqsChannel 只含 jd / douyin_shop / 1688，
        // 淘宝天猫的 MQS 入口是独立的 dsagent_taobao_publish_mqs。
        const product = p.product != null
          ? (typeof p.product === 'string' ? p.product : JSON.stringify(p.product))
          : ''
        // tmall-mqs 默认渠道钉成 tmall（product.channel 若显式给了则尊重它）。
        // ★ 必须在 parseProduct 之前提取 channel：parseProduct 是按白名单重建对象，
        //   不认识 channel 字段，解析后再读就永远读不到（实测 tmall-mqs 会被发成 taobao）。
        let explicitChannel = ''
        const withChannel = product
          ? (() => {
              try {
                const obj = JSON.parse(product)
                explicitChannel = asStr(obj.channel).trim()
                if (!explicitChannel) obj.channel = platform === 'tmall-mqs' ? 'tmall' : 'taobao'
                return JSON.stringify(obj)
              } catch {
                return product
              }
            })()
          : product
        // 统一商品数据 → 淘宝扁平参数（与 dsagent_taobao_publish_mqs 同一套转换）
        const parsed = parseProduct(withChannel)
        if (parsed.error || !parsed.product) {
          return { ok: false, failureKind: 'api_error', text: parsed.error || '商品数据解析失败。' }
        }
        const invalid = validateProduct(parsed.product)
        if (invalid) {
          return { ok: false, failureKind: 'api_error', text: `商品数据校验未通过：${invalid}` }
        }
        const prod: any = parsed.product
        // channel 用解析前抓到的值兜底（parseProduct 不保留该字段）
        const resolvedChannel = explicitChannel || (platform === 'tmall-mqs' ? 'tmall' : 'taobao')
        const taobaoSkus = (prod.skus?.length
          ? prod.skus
          : (prod.specs?.[0]?.values || []).map((v: any) => ({ specs: { [prod.specs![0].name]: v.value }, price: prod.price, stock: prod.stock })))
          .map((s: any) => ({
            name: asStr(Object.values(s.specs || {})[0]).trim(),
            price: s.price != null ? asStr(s.price) : undefined,
            stock: s.stock != null ? asStr(s.stock) : undefined,
            outerId: s.itemNo != null ? asStr(s.itemNo) : undefined,
          }))
          .filter((s: any) => s.name)
        return ok(await handlers.taobaoMqs({
          images: prod.images || [],
          detailImages: prod.detailImages || [],
          title: prod.title,
          channel: resolvedChannel,
          price: prod.price || '',
          stock: prod.stock || '',
          itemNo: prod.itemNo || '',
          skus: taobaoSkus,
          categoryKeyword: prod.category || '',
          attributes: prod.attributes,
          confirm,
          account,
          agentId,
        }))
      }

      case 'jd':
      case 'douyin-shop':
      case '1688': {
        const channelMap: Record<string, 'jd' | 'douyin_shop' | '1688'> = {
          jd: 'jd',
          'douyin-shop': 'douyin_shop',
          '1688': '1688',
        }
        const channel = channelMap[platform]
        const product = p.product != null
          ? (typeof p.product === 'string' ? p.product : JSON.stringify(p.product))
          : ''
        return ok(await handlers.mqs(channel, {
          product,
          confirm,
          account,
          diagDom: asBool(p.diagDom),
          agentId,
        }))
      }

      case 'pdd2': {
        const product = p.product != null
          ? (typeof p.product === 'string' ? p.product : JSON.stringify(p.product))
          : ''
        // deliveryTime 在 PddPublish2Options 里是 number（1=当日/2=24h/3=48h），
        // 传字符串会被原样赋给 opts.deliveryTime，导致类型与下游判断错位 → 这里显式转数字。
        const rawDelivery = asStr(p.deliveryTime).trim()
        const deliveryNum = rawDelivery ? Number(rawDelivery) : NaN
        return ok(await handlers.pdd2({
          product,
          confirm,
          account,
          agentId,
          mode2: asBool(p.mode2),
          costTemplate: asStr(p.costTemplate),
          deliveryTime: Number.isFinite(deliveryNum) ? deliveryNum : undefined,
        }))
      }

      default:
        return {
          ok: false,
          failureKind: 'api_error',
          text: `不支持的 platform：「${platform}」。可选：${PUBLISH_PLATFORMS.join(' / ')}`,
        }
    }
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `${platform} 发布异常：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
