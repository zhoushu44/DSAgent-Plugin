/**
 * 内容发布 / 采集类工具（host 半区）。
 *
 * 职责：定义 10 个「平台内容发布 + 数据采集 + 下载」工具：
 *   dsagent_douyin_publish / dsagent_zhihu_publish / dsagent_bilibili_publish /
 *   dsagent_bilibili_download / dsagent_xiaohongshu_publish / dsagent_pdd_crawl /
 *   dsagent_xianyu_publish / dsagent_taobao_publish /
 *   dsagent_pdd_publish2 / dsagent_xianyu_analytics
 *
 * 统一模式：
 *   - 发布类是 L2 真实副作用工具，两步走：先不带 confirm 拿「发布预览」→
 *     用户同意后再带 confirm=true 才真正提交
 *   - try/catch 兜底 failureKind:'api_error'
 *   - images 类参数支持双写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
 *
 * 物理隔离：本文件不 import index.ts；凭证库由 index.ts 接线时注入，
 * 各平台函数直接从对应模块 import（与 index.ts 原先的做法一致）。
 */
import type { CredentialStore } from './services/credential-store.js'
import { douyinPublish } from './douyin-publish.js'
import { zhihuPublish } from './zhihu-publish.js'
import { bilibiliPublish } from './bilibili-publish.js'
import { bilibiliDownload } from './bilibili-download.js'
import { xiaohongshuPublish } from './xiaohongshu-publish.js'
import { pddCrawl } from './pdd-crawl.js'
import { xianyuPublish } from './xianyu-publish.js'
import { xianyuAnalytics } from './xianyu-analytics.js'
import { taobaoPublish, type TaobaoSkuInput } from './taobao-publish.js'
import { pddPublish2 } from './pdd-publish2.js'
import { mqsPublish, type MqsChannel } from './mqs-publish.js'
import { parseProduct, validateProduct } from './services/product-schema.js'
import { defineTool, renderToolOutput, agentIdOf, agentModelRouteOf } from './tool-runtime.js'

/** 宿主 LLM 服务的最小接口（`ctx.llm`）；宿主未提供时为 undefined。 */
type HostLlm = { stream: (options: any) => AsyncIterable<any> }

/** 插件依赖注入：index.ts apply() 内创建的服务，全部从这里进 */
export interface PublishToolsDeps {
  /** 凭证库（各平台函数用它取 Cookie / 选号） */
  store: CredentialStore
  /**
   * 宿主 LLM 服务解析器（`ctx.llm`），供「商品属性」自动选值调用宿主对话模型。
   *
   * 传**解析函数**而非对象：宿主 LLM 服务可能晚于本插件注册，执行期再取才拿得到；
   * 宿主未提供时返回 undefined，属性区自动降级（只走缓存），不影响发布。
   */
  getLlm?: () => HostLlm | undefined
}

/** 构建发布 / 采集类工具定义 */
export function buildPublishTools(deps: PublishToolsDeps): import('@deepseek-ai/dsh-tools').ToolDefinition[] {
  const { store, getLlm } = deps

  return [

    /* ─── 抖音投稿工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_douyin_publish',
      description: '发布视频到抖音（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动抖音创作服务平台投稿页完成「上传视频 → 填标题/描述 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        videoPath: { type: 'string', required: true, description: '本地视频文件的绝对路径' },
        title: { type: 'string', required: true, description: '作品标题，抖音限 30 字' },
        description: { type: 'string', description: '作品描述/文案（可选），可含 #话题，抖音限 1000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await douyinPublish(store, {
            videoPath: String(args.videoPath ?? ''),
            title: String(args.title ?? ''),
            description: args.description != null ? String(args.description) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `抖音发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 知乎文章发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_zhihu_publish',
      description: '发布文章到知乎专栏（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动知乎写文章编辑器完成「填标题 → 填正文 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        title: { type: 'string', required: true, description: '文章标题，知乎限 100 字' },
        content: { type: 'string', required: true, description: '文章正文纯文本，用 \\n 分段，知乎限 50000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await zhihuPublish(store, {
            title: String(args.title ?? ''),
            content: String(args.content ?? ''),
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `知乎发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── B站投稿工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_bilibili_publish',
      description: '发布视频到 B站（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动 B站创作中心投稿页完成「上传视频 → 填标题/简介/标签/分区/创作声明 → 点立即投稿」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正投稿。',
      parameters: {
        videoPath: { type: 'string', required: true, description: '本地视频文件的绝对路径' },
        title: { type: 'string', required: true, description: '稿件标题，B站限 80 字' },
        description: { type: 'string', description: '简介（可选），B站限 2000 字' },
        tags: { type: 'string', description: '标签（可选），多个用逗号分隔，B站上限约 10 个、单个 ≤ 20 字' },
        partition: { type: 'string', description: '分区名（可选，如「科技数码」「知识」）。不传则沿用页面自动预选的分区' },
        statement: { type: 'string', description: '创作声明（可选，必填项）。不传则自动选「内容无需标注」' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正投稿' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await bilibiliPublish(store, {
            videoPath: String(args.videoPath ?? ''),
            title: String(args.title ?? ''),
            description: args.description != null ? String(args.description) : '',
            tags: args.tags != null ? String(args.tags) : '',
            partition: args.partition != null ? String(args.partition) : '',
            statement: args.statement != null ? String(args.statement) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `B站发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── B站下载工具（只读平台 + 写本地文件，无真实副作用） ─── */

    defineTool({
      name: 'dsagent_bilibili_download',
      description: '下载 B站 视频/音频到本地（内容下载，无平台副作用）。'
        + '通过 yutto CLI 完成「解析 → 拉流 → ffmpeg 合流 → 落盘」，支持指定清晰度/音质/格式、合集批量、选集、仅音频等。'
        + '★ 大文件不走代理网关，由本工具直接调本地 CLI 子进程完成。',
      parameters: {
        url: { type: 'string', required: true, description: 'B站 视频/番剧/收藏夹链接（支持 b23.tv 短链），如 https://www.bilibili.com/video/BV1xx411c7mD' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        dir: { type: 'string', description: '输出目录（可选）。不传默认 ~/.dsh/downloads/bilibili' },
        quality: { type: 'string', description: '清晰度（可选）。可传数字码（127=8K / 120=4K / 116=1080P60 / 80=1080P / 64=720P / 32=480P / 16=360P）或名称（8K / 4K / 1080P / 720P）' },
        audioQuality: { type: 'string', description: '音质（可选）。数字码（30251=Hi-Res / 30280=320kbps / 30232=128kbps / 30216=64kbps）或名称（320kbps / 128kbps）' },
        outputFormat: { type: 'string', description: '输出容器格式（可选）：infer（默认，按源推断）/ mp4 / mkv / mov' },
        batch: { type: 'boolean', description: '批量下载（可选）。番剧/合集/多 P 视频需要时传 true' },
        episodes: { type: 'string', description: '选集范围（可选）。如 1~-1（全部）、1,3,5、2~6' },
        videoOnly: { type: 'boolean', description: '仅下载视频轨，不要音频（可选）' },
        audioOnly: { type: 'boolean', description: '仅下载音频（可选）' },
        noDanmaku: { type: 'boolean', description: '不下载弹幕（可选）' },
        noSubtitle: { type: 'boolean', description: '不下载字幕（可选）' },
        withMetadata: { type: 'boolean', description: '附带下载元数据 nfo（可选）' },
        saveCover: { type: 'boolean', description: '保存视频封面（可选）' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await bilibiliDownload(store, {
            url: String(args.url ?? ''),
            dir: args.dir != null ? String(args.dir) : '',
            quality: args.quality != null ? String(args.quality) : '',
            audioQuality: args.audioQuality != null ? String(args.audioQuality) : '',
            outputFormat: args.outputFormat != null ? String(args.outputFormat) : '',
            batch: args.batch === true,
            episodes: args.episodes != null ? String(args.episodes) : '',
            videoOnly: args.videoOnly === true,
            audioOnly: args.audioOnly === true,
            noDanmaku: args.noDanmaku === true,
            noSubtitle: args.noSubtitle === true,
            withMetadata: args.withMetadata === true,
            saveCover: args.saveCover === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `B站下载异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 小红书发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_xiaohongshu_publish',
      description: '发布笔记到小红书（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动小红书创作服务平台发布页完成「上传素材（视频或图片）→ 填标题/正文 → 点发布笔记」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。',
      parameters: {
        title: { type: 'string', required: true, description: '笔记标题，小红书限 20 字' },
        videoPath: { type: 'string', description: '本地视频文件绝对路径（视频笔记用，与 imagePaths 二选一）' },
        imagePaths: { type: 'string', description: '本地图片文件绝对路径（图文笔记用，与 videoPath 二选一，最多 18 张）。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        content: { type: 'string', description: '笔记正文（可选），可含 #话题，小红书限 1000 字' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // imagePaths 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).imagePaths ?? '').trim()
          let imagePaths: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) imagePaths = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'imagePaths 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              imagePaths = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          const result = await xiaohongshuPublish(store, {
            videoPath: args.videoPath != null ? String(args.videoPath) : '',
            imagePaths,
            title: String(args.title ?? ''),
            content: args.content != null ? String(args.content) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `小红书发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 拼多多采集工具（只读，无平台副作用） ─── */

    defineTool({
      name: 'dsagent_pdd_crawl',
      description: '采集拼多多商品数据（首页推荐流 / 关键词搜索 / 单品详情，只读操作，无副作用）。'
        + '拼多多 H5 业务接口需要页面 JS 生成的 anti_content 签名，纯 HTTP 请求必被拒，'
        + '因此本工具通过 puppeteer 打开拼多多 H5 页面、注入账号 Cookie 取数：'
        + 'feed 走「拦截页面自身发出的 /proxy/api/ 响应」，search 走「解析页面 SSR 内联数据 ssrListData」。'
        + '★ 前提：凭证库中必须已有拼多多账号（未登录访问拼多多会强制跳登录页）。'
        + '★ 取数路径：实测 search / goods 接口有较强账号级频控（常 429 error_code=40002「系统繁忙」），'
        + '而 mode=feed（首页推荐流）稳定可用，用户未指定关键词/商品 ID 时优先用 feed。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        mode: { type: 'string', description: '采集模式（可选）：feed（首页推荐流，推荐，稳定可用）/ search（关键词搜索）/ goods（单品详情）。省略时自动推断：有 goodsId → goods，有 keyword → search，都没有 → feed' },
        keyword: { type: 'string', description: '搜索关键词。mode=search 时必填，如「手机壳」' },
        goodsId: { type: 'string', description: '商品 ID。mode=goods 时必填' },
        limit: { type: 'string', description: '返回条数上限（可选，字符串数字），默认 20，最大 100' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await pddCrawl(store, {
            mode: args.mode != null ? String(args.mode) : '',
            keyword: args.keyword != null ? String(args.keyword) : '',
            goodsId: args.goodsId != null ? String(args.goodsId) : '',
            limit: args.limit != null ? String(args.limit) : '',
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多采集异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 闲鱼发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_xianyu_publish',
      description: '发布商品到闲鱼（内容发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动闲鱼网页版发布页（https://www.goofish.com/publish）完成「上传图片 → 填描述/价格 → 点发布」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 前提：只需在「账号连接」绑定**闲鱼**账号（闲鱼 App 扫码登录 goofish.com/login）。'
        + '闲鱼凭证层与淘宝同源（credentialPlatform→taobao），但 goofish 域 Cookie 必须落在闲鱼自己的条目上，'
        + '因此淘宝登录只能作为兜底自动派生，正式用法是单独连一个闲鱼号。'
        + '若报登录失效（token_expired），引导用户对该闲鱼账号执行「重新登录」。'
        + '若报「你已被限制发布」（punishId），那是平台处罚，重登无效，需去闲鱼 App「我的-安全中心-违规记录」处理。',
      parameters: {
        description: { type: 'string', required: true, description: '宝贝描述（必填）。闲鱼要求描述必填，且**不能包含 emoji**' },
        price: { type: 'string', required: true, description: '价格（元，字符串数字）。闲鱼要求 0 ~ 1 亿元之间' },
        images: { type: 'string', required: true, description: '本地图片文件绝对路径，至少 1 张、最多 9 张，单张不超过 10MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        title: { type: 'string', description: '宝贝标题（可选）。闲鱼网页版标题多由描述/类目派生，页面有标题框时会一并填入' },
        originalPrice: { type: 'string', description: '原价/入手价（元，字符串数字，可选），需在 1 亿元之内' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // images 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).images ?? '').trim()
          let images: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) images = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'images 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              images = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          const result = await xianyuPublish(store, {
            images,
            description: String(args.description ?? ''),
            title: args.title != null ? String(args.title) : '',
            price: String(args.price ?? ''),
            originalPrice: args.originalPrice != null ? String(args.originalPrice) : '',
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `闲鱼发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 淘宝 / 天猫 发布工具（L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_taobao_publish',
      description: '发布商品到淘宝 / 天猫卖家中心（商品发布，L2 风险，有真实副作用）。'
        + '通过 puppeteer 驱动淘宝/天猫网页版发布页完成「上传主图 → 填通用字段 → 提交宝贝信息」。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 只自动填通用字段（主图/标题/一口价/库存/货号/多规格 SKU）；类目属性、商品详情、发货与售后设置不会自动填，'
        + '需用户在弹出窗口内人工补全后提交；发布第一步需选类目，传 categoryKeyword 可自动搜索并按与标题的相关性挑最匹配类目，否则需在窗口内人工选。'
        + '★ 淘宝与天猫共用同一套淘宝登录态（账号连接页只需连淘宝）。',
      parameters: {
        title: { type: 'string', required: true, description: '商品标题（必填）。淘宝/天猫要求标题必填且不超过 60 个字符' },
        images: { type: 'string', required: true, description: '本地图片文件绝对路径，至少 1 张、最多 5 张，单张不超过 3MB。多张用英文逗号分隔，也可传 JSON 数组字符串' },
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        channel: { type: 'string', description: '发布渠道（可选）：taobao（淘宝，默认）/ tmall（天猫）。两者共用同一套淘宝登录态' },
        price: { type: 'string', description: '一口价（元，字符串数字，可选）。填则尝试自动填写，正数、1 亿元以内' },
        stock: { type: 'string', description: '库存（件，字符串数字，可选）。填则尝试自动填写，需为非负整数' },
        itemNo: { type: 'string', description: '商家编码/货号（可选）。填则尝试自动填写（天猫发布页有独立输入框）' },
        skus: { type: 'string', description: '多规格（销售属性）JSON 数组字符串（可选），形如 [{"name":"红色","price":"99","stock":"10","outerId":"SKU001"}]，一项 = 一个规格值 = SKU 表一行。传了则自动添加销售属性值并回填 SKU 表的价格/数量/商家编码；不传则沿用单 SKU。仅旧版 SKU 面板类目生效，新版 SKU 面板（「+ 创建规格」按钮）的多规格需人工补填' },
        categoryKeyword: { type: 'string', description: '选类目关键词（可选）。发布入口先落在「选类目」页，填了则自动搜索该关键词，候选按与商品标题的相关性（叶子类目名与标题的字词重叠）降序尝试，挑第一个能让「确认，下一步」可用的类目。★ 请传具体叶子类目词（如「儿童睡衣」「家居服」），不要传一级大类名（如「童装」）或整段标题。不填需用户在窗口内人工选类目' },
        brand: { type: 'string', description: '品牌（可选）。部分类目（如「AI软件订阅/Token充值」）在选类目页把「品牌」列为必填属性，不填则无法进入表单；填了会优先在品牌下拉里匹配，匹配不到则取列表第一项' },
        model: { type: 'string', description: '型号（可选）。部分类目在选类目页把「型号」列为必填属性，不填则无法进入表单' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        replayMode: { type: 'boolean', description: '觅千手式「Json/Json2 劫持重放」模式（可选，默认 false）。true 时进入发布页前注入劫持脚本：框架把表单 state 赋给 window.Json/Json2 的瞬间，把本地组装的商品数据原地 merge 进表单（一次门禁），命中则跳过 DOM 逐格填写（仅保留类目属性/运费模板兜底），未命中自动降级回 DOM 填写。适合框架走 Json 赋值的发布页；遇到结构变更时建议先关本参数验证。★ 传了 imageSpaceUpload（默认开）并上传成功时会自动启用，无需手动传' },
        imageSpaceUpload: { type: 'boolean', description: '逆向 HTTP 上传（可选，默认 true）。true 时本地主图/详情图先用图片空间接口（stream-upload.taobao.com/api/upload.api，纯 HTTP multipart，无 mtop 签名、无浏览器）传成 img.alicdn.com URL，再随 Json 劫持重放注入发布表单，主图与详情图都不再走页面文件控件——与觅千手 v5.61「预上传」同链路。任一批整体失败会自动回退原 DOM 上传链路。传 false 则完全走旧的 DOM 文件上传' },
        imageSpaceFolderId: { type: 'string', description: '图片空间目录 id（可选，默认 0＝全部图片根目录）。想把素材归进自定义目录时传该目录 id' },
        imageSpaceConcurrency: { type: 'string', description: '图片空间上传并发（可选，字符串数字，默认 3，上限 6）。并发过高易触发账号级限流' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // images 支持两种写法：JSON 数组字符串（["a.jpg","b.jpg"]）或英文逗号分隔
          const rawImages = String((args as any).images ?? '').trim()
          let images: string[] = []
          if (rawImages) {
            if (rawImages.startsWith('[')) {
              try {
                const parsed = JSON.parse(rawImages)
                if (Array.isArray(parsed)) images = parsed.map(p => String(p ?? '').trim()).filter(Boolean)
              } catch {
                return { ok: false, failureKind: 'api_error', text: 'images 看起来是 JSON 数组但解析失败，请检查格式（如 ["D:\\\\img\\\\1.jpg","D:\\\\img\\\\2.jpg"]），或改用英文逗号分隔。' } as any
              }
            } else {
              images = rawImages.split(',').map(p => p.trim()).filter(Boolean)
            }
          }
          // skus 支持 JSON 数组字符串：[{"name":"红色","price":"99","stock":"10","outerId":"SKU001"}]
          let skus: TaobaoSkuInput[] | undefined
          const rawSkus = String((args as any).skus ?? '').trim()
          if (rawSkus) {
            try {
              const parsed = JSON.parse(rawSkus)
              if (Array.isArray(parsed)) {
                skus = parsed.map((s: any) => ({
                  name: String(s?.name ?? '').trim(),
                  price: s?.price != null ? String(s.price).trim() : undefined,
                  stock: s?.stock != null ? String(s.stock).trim() : undefined,
                  outerId: s?.outerId != null ? String(s.outerId).trim() : undefined,
                })).filter(s => s.name)
              }
            } catch {
              return { ok: false, failureKind: 'api_error', text: 'skus 看起来不是合法的 JSON 数组字符串，请检查格式（如 [{"name":"红色","price":"99","stock":"10"}]）。' } as any
            }
          }
          const route = agentModelRouteOf(exec)
          const llm = getLlm?.()
          const attrModel = route && llm
            ? { stream: (o: any) => llm.stream(o), provider: route.provider, model: route.model }
            : undefined
          const result = await taobaoPublish(store, {
            images,
            title: String(args.title ?? ''),
            channel: args.channel != null ? String(args.channel) : '',
            price: args.price != null ? String(args.price) : '',
            stock: args.stock != null ? String(args.stock) : '',
            itemNo: args.itemNo != null ? String(args.itemNo) : '',
            skus,
            categoryKeyword: args.categoryKeyword != null ? String(args.categoryKeyword) : '',
            brand: args.brand != null ? String(args.brand) : '',
            model: args.model != null ? String(args.model) : '',
            confirm: args.confirm === true,
            replayMode: (args as any).replayMode === true,
            imageSpaceUpload: (args as any).imageSpaceUpload !== false,
            imageSpaceFolderId: (args as any).imageSpaceFolderId != null ? String((args as any).imageSpaceFolderId) : '',
            imageSpaceConcurrency: (args as any).imageSpaceConcurrency != null
              ? Number((args as any).imageSpaceConcurrency) || 3
              : 3,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
            attrModel,
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `淘宝发布异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 闲鱼数据分析工具（只读，无平台副作用） ─── */

    defineTool({
      name: 'dsagent_xianyu_analytics',
      description: '统计闲鱼账号的商品表现数据（曝光/想要/收藏、爆款与滞销排行，只读操作，无副作用）。'
        + '闲鱼账号类接口需要页面 JS 生成的 sign 签名与真实 goofish 会话，纯 HTTP 请求必被拒，'
        + '因此本工具通过 puppeteer 打开闲鱼个人页、注入账号 Cookie、拦截页面自身发出的账号类接口响应取数。'
        + '★ 前提：只需在「账号连接」绑定**闲鱼**账号（闲鱼 App 扫码登录 goofish.com/login）。'
        + '闲鱼凭证层与淘宝同源（credentialPlatform→taobao），但 goofish 域 Cookie 必须落在闲鱼自己的条目上，'
        + '因此淘宝登录只能作为兜底自动派生，正式用法是单独连一个闲鱼号。'
        + '若报登录失效（token_expired），引导用户对该闲鱼账号执行「重新登录」。',
      parameters: {
        // DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败
        mode: { type: 'string', description: '分析模式（可选）：overview（账号概况 + 爆款/滞销排行，默认）/ items（全量商品明细）' },
        limit: { type: 'string', description: '返回条数上限（可选，字符串数字），默认 50，最大 100' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const result = await xianyuAnalytics(store, {
            mode: args.mode != null ? String(args.mode) : '',
            limit: args.limit != null ? String(args.limit) : '',
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `闲鱼数据分析异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ─── 拼多多商家后台 发布工具（统一商品数据格式；L2：真实副作用，必须用户确认后才执行） ─── */

    defineTool({
      name: 'dsagent_pdd_publish2',
      description: '发布商品到拼多多商家后台（基于**统一商品数据格式**；L2 风险，有真实副作用）。'
        + '入参只有一个统一的 product（JSON），'
        + '规格用「维度数组」表达（如 颜色 / 尺码，最多 2 维），SKU 用「维度名 → 规格值」组合表达，'
        + '天然支持**颜色 × 尺码 二维矩阵**；商品属性可显式指定 name→value（比让模型猜更可控）。'
        + '执行链路：puppeteer 驱动 mms.pinduoduo.com 商家后台（商品列表 →「发布新商品」→'
        + '类目选择页 →「确认发布该类商品」→ 表单页填字段 →「提交并上架」）。'
        + '★ 必须两步调用：先不带 confirm 调用拿到「发布预览」给用户看，用户明确同意后再带 confirm=true 调用才会真正提交。'
        + '★ 发货与售后（非预售+当日发货）、运费模板（如指定）会自动填；品牌和商品资质不会自动填，需用户在弹出窗口内人工补全。'
        + '★ 拼多多商家后台与拼多多买家账号（dsagent_pdd_crawl 用的那套）是**两套完全独立的登录态**，'
        + '需在账号连接页单独绑定「拼多多商家后台」。',
      parameters: {
        product: { type: 'string', required: true, description: '统一商品数据（必填），JSON 字符串。结构：{ title(必填,≤60字), images(必填,本地绝对路径数组,1~10张,单张≤3MB), detailImages?(详情图,≤50张), category?(类目关键词/路径,不传则从标题推断), price?(参考价,元), stock?(默认库存), itemNo?(货号), specs?(规格维度数组:[{name:"颜色",values:[{value:"奶油黄",image?:"C:/img/1.jpg"}]},{name:"尺码",values:[{value:"110cm"}]}],最多2维,每维值≤20,预览图仅第1维可带), skus?(SKU行数组:[{specs:{颜色:"奶油黄",尺码:"110cm"},price:"34",stock:"999"}],每行需覆盖全部维度), attributes?([{name:"主面料成分",value:"棉"}]), account?(指定账号) }。' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正发布' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
        mode2: { type: 'boolean', description: '觅千手式「请求劫持改包」模式（可选，默认 false）。true 时**跳过 UI 逐行填价格表/SKU**，改为：页面照常填主图/标题/详情图/规格，点「提交并上架」时在浏览器层拦下原生 goodsCommit 请求，只替换 sku 价格/库存/货号、图片、运费字段，再用页面身份（带 Anti-Content 签名）重放。优点：不受 30 行 SKU 表格渲染/滚动限制，价格一次改完；缺点：依赖平台内部接口与签名模块，改版会失效。' },
        costTemplate: { type: 'string', description: '运费模板名（可选）。模式2 下由 buildGoodsDetailFromProduct 解析为模板 ID；模式1 下走 UI 搜索模板名' },
        deliveryTime: { type: 'string', description: '发货时间（可选，字符串数字）：1=当日发货、2=24小时发货、3=48小时发货；默认 1' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          // 商品属性自动选值走「本会话正在用的聊天模型」：从会话请求头解析 provider/model，
          // 与宿主 LLM 服务一起组装成句柄；任一缺失则不传，属性区只走缓存兜底。
          const route = agentModelRouteOf(exec)
          const llm = getLlm?.()
          const attrModel = route && llm
            ? { stream: (o: any) => llm.stream(o), provider: route.provider, model: route.model }
            : undefined
          const result = await pddPublish2(store, {
            product: (args as any).product,
            confirm: args.confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
            attrModel,
            mode2: (args as any).mode2 === true,
            costTemplate: args.costTemplate ? String(args.costTemplate).trim() : undefined,
            deliveryTime: args.deliveryTime != null && String(args.deliveryTime).trim() !== ''
              ? Number(args.deliveryTime)
              : undefined,
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多发布（上架2）异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),

    /* ═══ mqs 同引擎三平台（京东 / 抖店 / 1688）════════════════════════
     * 觅千手 v5.61 里这三个平台与淘宝/天猫共用 goods_manager 引擎，只是换锚点集。
     * 这里用 `mqsPublish` 一份实现 + 三份 publish-config/*.json 暴露成三个工具，
     * 参数表与 dsagent_pdd_publish2 同构（统一商品数据 product + confirm 门禁）。
     * ═════════════════════════════════════════════════════════════════ */
    defineTool({
      name: 'dsagent_jd_publish_mqs',
      description: '发布商品到京东商家后台（觅千手 goods_manager 同引擎；L2 风险，有真实副作用）。'
        + '入参为统一商品数据 product（JSON）：标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性。'
        + '执行链路：puppeteer 驱动 wares-jdm.jd.com 商品发布页，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段。'
        + '★ 必须两步调用：先不带 confirm 取「发布预览」，用户明确同意后才带 confirm=true 真正提交。'
        + '★ 品牌、商品资质/3C 与部分类目属性不会自动填，需在弹出窗口内人工补全。'
        + '★ 京东登录态独立（不是阿里 SSO），需在账号连接页单独绑定京东账号。',
      parameters: MQS_PRODUCT_PARAMS,
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        return await runMqs(store, getLlm, 'jd', args, exec)
      },
    }),

    defineTool({
      name: 'dsagent_douyin_shop_publish_mqs',
      description: '发布商品到抖音小店（抖店）商家后台（觅千手 goods_manager 同引擎；L2 风险，有真实副作用）。'
        + '入参为统一商品数据 product（JSON）：标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性。'
        + '执行链路：puppeteer 驱动 fxg.jinritemai.com/ffa/g/create 商品创建页，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段。'
        + '★ 必须两步调用：先不带 confirm 取「发布预览」，用户明确同意后才带 confirm=true 真正提交。'
        + '★ 品牌、商品资质与部分类目属性不会自动填，需在弹出窗口内人工补全。'
        + '★ 抖店用抖音登录态（.jinritemai.com + .douyin.com 双域 Cookie），与淘宝/京东完全不通用。',
      parameters: MQS_PRODUCT_PARAMS,
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        return await runMqs(store, getLlm, 'douyin_shop', args, exec)
      },
    }),

    defineTool({
      name: 'dsagent_1688_publish_mqs',
      description: '发布商品到 1688（阿里巴巴）卖家工作台（觅千手 goods_manager 同引擎；L2 风险，有真实副作用）。'
        + '入参为统一商品数据 product（JSON）：标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性。'
        + '执行链路：puppeteer 驱动 offer-new.1688.com/<unit>/publish.htm 商品发布页，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段。'
        + '★ 必须两步调用：先不带 confirm 取「发布预览」，用户明确同意后才带 confirm=true 真正提交。'
        + '★ 1688 是批发平台：阶梯价/起订量属批发专属字段，工具只填一档；品牌与商品资质不自动填。'
        + '★ 阿里 SSO 与淘宝同源，但必须是 1688 卖家（诚信通/实力商家）账号，纯买家号会在选类目阶段被挡。',
      parameters: MQS_PRODUCT_PARAMS,
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        return await runMqs(store, getLlm, '1688', args, exec)
      },
    }),
    defineTool({
      name: 'dsagent_taobao_publish_mqs',
      description: '用**统一商品数据**发布商品到淘宝 C 店 / 天猫（觅千手 goods_manager 同引擎；L2 风险，有真实副作用）。'
        + '入参只有一个 product（JSON）：标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性，规格最多 2 维、SKU 用「维度名→规格值」组合表达。'
        + '执行链路：puppeteer 驱动淘宝/天猫发布页，按 publish-config/taobao.json 的 flow 走「选类目 → 填标题/价格/库存 → 主图 → SKU → 类目属性 → 运费模板 → 提交」，'
        + '类目档案按「平台 + catId」精确匹配回放（同级目第二次发布直接复用上次生效的属性值）。'
        + '★ 渠道靠 product 里可选的 channel 字段区分：taobao（默认）/ tmall；两者共用同一套淘宝登录态。'
        + '★ 必须两步调用：先不带 confirm 取「发布预览」，用户明确同意后才带 confirm=true 真正提交。'
        + '★ 品牌、商品资质与部分类目属性不会自动填，需在弹出窗口内人工补全。'
        + '★ 与 dsagent_taobao_publish 的区别：那个是「扁平参数 + 相关性选类目」的旧入口，本工具是统一商品 JSON 形态（与京东/抖店/1688/拼多多同构）。',
      parameters: {
        product: { type: 'string', required: true, description: '统一商品数据（必填），JSON 字符串。结构：{ title(必填,≤60字), images(必填,本地绝对路径数组,1~5张,单张≤20MB), detailImages?(详情图,≤20张), channel?("taobao" 默认 / "tmall"), category?(类目关键词), price?(一口价,元), stock?(库存), itemNo?(商家编码/货号), specs?(规格维度数组:[{name:"颜色分类",values:[{value:"黑色"}]}],最多2维), skus?(SKU 行数组:[{specs:{颜色分类:"黑色"},price:"99",stock:"10",itemNo:"SKU001"}],每行需覆盖全部维度), attributes?([{name:"内衣质地",value:"云朵棉"}]), account?(指定账号) }。' },
        confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正提交' },
        account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
      },
      output: { schema: { type: 'json' }, render: renderToolOutput },
      async execute(args, exec) {
        try {
          const route = agentModelRouteOf(exec)
          const llm = getLlm?.()
          const attrModel = route && llm
            ? { stream: (o: any) => llm.stream(o), provider: route.provider, model: route.model }
            : undefined
          const parsed = parseProduct((args as any).product)
          if (parsed.error || !parsed.product) {
            return {
              ok: false,
              failureKind: 'api_error',
              text: parsed.error || '商品数据解析失败。',
            } as any
          }
          const invalid = validateProduct(parsed.product)
          if (invalid) {
            return { ok: false, failureKind: 'api_error', text: `商品数据校验未通过：${invalid}` } as any
          }
          const p = parsed.product
          // 统一数据的 specs/skus → 淘宝「一项 = 一个规格值 = SKU 表一行」形态
          const skus: TaobaoSkuInput[] = (p.skus?.length
            ? p.skus
            : (p.specs?.[0]?.values || []).map(v => ({ specs: { [p.specs![0].name]: v.value }, price: p.price, stock: p.stock })))
            .map((s: any) => ({
              name: String(Object.values(s.specs || {})[0] || '').trim(),
              price: s.price != null ? String(s.price) : undefined,
              stock: s.stock != null ? String(s.stock) : undefined,
              outerId: s.itemNo != null ? String(s.itemNo) : undefined,
            }))
            .filter(s => s.name)
          const result = await taobaoPublish(store, {
            images: p.images || [],
            detailImages: p.detailImages || [],
            title: p.title,
            channel: String((parsed.product as any).channel || '').trim() || 'taobao',
            price: p.price || '',
            stock: p.stock || '',
            itemNo: p.itemNo || '',
            skus,
            categoryKeyword: p.category || '',
            attributes: p.attributes,
            confirm: (args as any).confirm === true,
            account: args.account ? String(args.account).trim() : '',
            agentId: agentIdOf(exec),
            attrModel: attrModel as any,
          })
          return result as any
        } catch (err) {
          return {
            ok: false,
            failureKind: 'api_error',
            text: `淘宝/天猫发布（mqs）异常：${err instanceof Error ? err.message : String(err)}`,
          } as any
        }
      },
    }),
  ]
}

/**
 * mqs 三平台共用的参数表（统一商品数据 + confirm 门禁 + 账号 + 诊断开关）。
 * ★ DSH 校验器要求：可选参数必须整体省略 required 字段，写 false 会导致插件加载失败。
 */
const MQS_PRODUCT_PARAMS = {
  product: { type: 'string', required: true, description: '统一商品数据（必填），JSON 字符串。结构：{ title(必填,≤60字), images(必填,本地绝对路径数组,1~5张,单张≤3MB), detailImages?(详情图), category?(类目关键词), price?(价格,元), stock?(库存), itemNo?(货号), specs?(规格维度数组:[{name:"颜色",values:[{value:"黑色"}]}],最多2维), skus?(SKU 行数组:[{specs:{颜色:"黑色"},price:"99",stock:"999"}],每行需覆盖全部维度), attributes?([{name:"主面料成分",value:"棉"}]), account?(指定账号) }。' },
  confirm: { type: 'boolean', description: '是否已获用户确认。省略或 false 时只返回发布预览，不产生任何写操作；用户同意后传 true 才真正提交' },
  account: { type: 'string', description: '要使用的账号 shopKey（可选）。该平台有多个可用账号时，先按返回的候选向用户确认，再把选定的 shopKey 填到这里' },
  diagDom: { type: 'boolean', description: 'DOM 诊断模式（可选，默认 false）。true 时只打开发布页 dump 可见 input/button/file 清单 + 截图后返回，不上传不填表不提交（零风险，绕过 confirm 门禁）。用于首次接入某平台时修正锚点集' },
} as const

/** mqs 工具共用执行体：解析入参 → 交给 mqsPublish（引擎内含 confirm 门禁与账号选择） */
async function runMqs(
  store: CredentialStore,
  getLlm: (() => HostLlm | undefined) | undefined,
  channel: MqsChannel,
  args: any,
  exec: any,
) {
  try {
    // 属性自动选值走「本会话正在用的聊天模型」（与拼多多发布同一套装配逻辑）
    const route = agentModelRouteOf(exec)
    const llm = getLlm?.()
    const attrModel = route && llm
      ? { stream: (o: any) => llm.stream(o), provider: route.provider, model: route.model }
      : undefined
    const result = await mqsPublish(store, channel, {
      product: args?.product,
      confirm: args?.confirm === true,
      account: args?.account ? String(args.account).trim() : '',
      diagDom: args?.diagDom === true,
      agentId: agentIdOf(exec),
      attrModel: attrModel as any,
    })
    return result as any
  } catch (err) {
    return {
      ok: false,
      failureKind: 'api_error',
      text: `${channel} 发布异常：${err instanceof Error ? err.message : String(err)}`,
    } as any
  }
}
