/**
 * DSAgent 技能页：插件管理的业务技能查看与启停入口。
 *
 * 与 DSH 宿主原生的 skill 系统隔离：
 *   - 技能目录由插件 Config.skillRoot 指定，不放进 ~/.dsh/skills 等原生扫描路径
 *   - 工具名 dsagent_ 前缀，不模拟原生 skill 工具
 *   - UI 标题为「DSAgent 技能」，与原生 skill 列表区分
 *
 * 功能：
 *   - 三页签：垂直业务技能 / 内置技能 / 已安装
 *   - 垂直业务技能：vertical 类（生意参谋、股票金融等）+ 各平台特定技能（采集/发布/评论/客服/分析）
 *   - 内置技能：通用核心能力（core/office/agent/meta/connector/channel，非 vertical）
 *   - 平台筛选 chips
 *   - 搜索、卡片网格、详情抽屉
 *   - 启用/停用开关 → 改写 SKILL.md 的 disable-model-invocation（免重启生效）
 *
 * 页面取数：注入优先 + 回退（无宿主时读技能服务，服务不可用时用内置回退数据）。
 */

import type { SkillService, SkillRow } from '../services/skill-service.ts'
import type { Config } from '../index.ts'

const CAPABILITIES: Array<[string, string]> = [
  ['all', '全部'],
  // 通用技能：取值与规范 §6 的 category 体系一致
  ['office', '文档处理'],
  ['core', '核心基础'],
  ['agent', '协作'],
  ['meta', '元能力'],
  ['connector', '平台连接'],
  ['channel', '消息频道'],
  // 垂直业务
  ['vertical', '垂直业务'],
  // 平台技能：按功能组归纳
  ['copywriting', '文案'],
  ['cs-script', '客服'],
  ['chart', '图表'],
  ['shop-ops', '店铺'],
  ['analytics', '分析'],
]

const PLATFORMS: Array<[string, string]> = [
  ['all', '全部平台'],
  ['douyin', '抖音'],
  ['xiaohongshu', '小红书'],
  ['bilibili', 'B站'],
  ['kuaishou', '快手'],
  ['wechat_mp', '公众号'],
  ['taobao', '淘宝'],
  ['sycm', '生意参谋'],
  ['pinduoduo', '拼多多'],
  ['xianyu', '闲鱼'],
  ['wechat_store', '微信小店'],
  ['zhihu', '知乎'],
  ['common', '通用'],
]

const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(PLATFORMS)
const CAP_LABEL: Record<string, string> = Object.fromEntries(CAPABILITIES)

/**
 * 后端平台名 → 前端筛选名。
 * 技能 SKILL.md 的 platform 字段用后端名（xhs / pdd），而筛选器沿用原项目的前端名
 * （xiaohongshu / pinduoduo）。#54 让技能列表改读真实注册表后，两边命名差异会
 * 导致「小红书」筛选零命中，这里统一归一化。
 */
const PLATFORM_ALIAS: Record<string, string> = {
  xhs: 'xiaohongshu',
  pdd: 'pinduoduo',
  mp: 'wechat_mp',
  wechat_mp: 'wechat_mp',
}

/** 归一化平台名，用于筛选比较（前端名与后端名视为同一平台） */
function normPlatform(p: string): string {
  return PLATFORM_ALIAS[p] || p
}

const RISK_META: Record<string, { label: string; color: string; bg: string }> = {
  L0: { label: 'L0 只读', color: '#1a9f4d', bg: '#e8f7ee' },
  L1: { label: 'L1 低危', color: '#2b6cff', bg: '#eef3ff' },
  L2: { label: 'L2 中危', color: '#c47f00', bg: '#fff6e5' },
  L3: { label: 'L3 高危', color: '#d93b3b', bg: '#fdecec' },
}

/**
 * 从技能描述里抽「触发词」。
 * 来源依次为：`触发：/触发词：/TRIGGER:` 行 → `适用于…` 列举 → `当…时` 条件从句。
 * 只做切分与截断，不新增任何描述里没有的词。
 */
function pickTriggers(desc: string): string[] {
  const cut = (raw: string): string[] => {
    const items = raw
      .split(/[、,，;；]/)
      .map(t => t.replace(/^(?:Use when|包括|或)\s*[:：]?\s*/i, '').replace(/[。；;]$/, '').trim())
      .filter(t => t.length >= 2 && t.length <= 20)
    return [...new Set(items)]
  }
  const byKeyword = desc.match(/(?:触发词|触发|TRIGGER)\s*[:：]\s*([^。]+)/i)
  if (byKeyword) {
    const items = cut(byKeyword[1])
    if (items.length) return items.slice(0, 12)
  }
  const byApplicable = desc.match(/适用于([^。]{4,120})/)
  if (byApplicable) {
    const items = cut(byApplicable[1])
    if (items.length) return items.slice(0, 8)
  }
  const byCondition = desc.match(/当(?:用户|你|需要)([^。]{2,120}?)时/)
  if (byCondition) {
    const items = cut(byCondition[1])
    if (items.length) return items.slice(0, 8)
  }
  return []
}

/**
 * 提炼「用户会怎么问」。
 * 优先抽描述里真实出现过的引号原话；没有原话时退化为触发词（同样是描述里的原词）。
 * 不臆造例句 —— 两者都取不到时返回空数组，由 UI 给出通用引导。
 */
function askExamples(s: SkillRow): { asks: string[]; triggers: string[]; fromQuote: boolean } {
  const desc = s.description || ''
  const quoted: string[] = []
  for (const re of [/「([^」]{2,40})」/g, /“([^”]{2,40})”/g, /"([^"]{2,40})"/g, /'([^']{2,40})'/g]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(desc))) quoted.push(m[1].trim())
  }
  const triggers = pickTriggers(desc)
  const VERB = /帮我|我要|给我|请|把|导出|抓取|采集|看看|查下|诊断|分析|生成|做份|出份|怎么|如何/
  const score = (t: string): number => {
    let n = 0
    if (VERB.test(t)) n += 2
    if (t.length >= 6) n += 1
    if (/[0-9]|XX/.test(t)) n += 1
    // 纯技术词（.docx / competitorIds / PPT）不是「问法」
    if (/^[.\w\s-]+$/.test(t) && t.length <= 12) n -= 3
    return n
  }
  const fromQuote = quoted.filter(t => score(t) >= 1)
  let asks = [...new Set([
    ...fromQuote,
    ...triggers.filter(t => VERB.test(t)),
  ])].slice(0, 4)
  // 描述里没有口语原话时，退化为触发词本身（仍是描述原词，非臆造）
  if (!asks.length) asks = triggers.slice(0, 3)
  return { asks, triggers, fromQuote: fromQuote.length > 0 }
}

/** 内置回退数据：宿主与技能目录都不可用时用于预览 */
const FALLBACK_SKILLS: SkillRow[] = [
  /* ── 内置技能（7 个，platform: common）── */
  { id: 'content-repurpose', name: '一稿多平台改写', description: '输入一份素材，自动改写为各平台风格的标题、正文与话题标签，适配字数与调性差异。', version: '1.0.0', platform: 'common', capability: 'copywriting', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'publish-scheduler', name: '跨平台定时发布', description: '统一调度多平台发布队列，自动避开平台限流窗口，冲突检测与失败自动重排。', version: '1.0.0', platform: 'common', capability: 'shop-ops', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'data-export', name: '数据导出', description: '将任意采集结果导出为 CSV / Excel / JSON，支持字段映射与批量合并导出。', version: '1.0.0', platform: 'common', capability: 'chart', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'wordcloud-report', name: '词云与情感报告', description: '对评论、弹幕、评价做分词与情感分析，生成词云图与 HTML 报告，导出 PNG / CSV。', version: '1.0.0', platform: 'common', capability: 'chart', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'risk-guard', name: '限流与熔断护栏', description: '令牌桶限流（写 1 次/分钟）+ 端点级熔断，被所有写操作技能依赖，命中风控码立即停止。', version: '1.0.0', platform: 'common', capability: 'shop-ops', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'content-compliance-check', name: '违禁词合规扫描', description: '发布前置检查：扫描违禁词 / 引流词 / 极限词，输出风险分级与安全替换建议，生成合规报告。', version: '1.0.0', platform: 'common', capability: 'copywriting', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'backend-router', name: '多后端路由降级', description: '为同一能力维护 preferred + fallback 有序后端，主后端被风控时自动降级，保障任务可用性。', version: '1.0.0', platform: 'common', capability: 'shop-ops', risk: 'L1', enabled: true, dir: '', body: '' },

  /* ── 平台市场技能（45 个）── */
  /* 抖音 */
  { id: 'douyin-crawl', name: '抖音·数据采集', description: '按关键词 / 视频 ID 采集作品详情、二级评论、创作者主页作品与热点榜，导出 CSV / JSON。', version: '1.0.0', platform: 'douyin', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'douyin-publish', name: '抖音·内容发布', description: '上传视频或图文到抖音，支持标题、描述、话题、封面、位置与合集；支持定时发布。', version: '1.0.0', platform: 'douyin', capability: 'copywriting', risk: 'L2', enabled: false, dir: '', body: '' },
  { id: 'douyin-comment', name: '抖音·评论互动', description: '批量回复评论、点赞、删除自己的评论，并采集评论数据生成互动报表。', version: '1.0.0', platform: 'douyin', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'douyin-im', name: '抖音·私信管理', description: '读取私信会话列表、收发消息，按规则自动回复，支持关键词触发与转人工。', version: '1.0.0', platform: 'douyin', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'douyin-analytics', name: '抖音·数据分析', description: '拉取作品播放 / 点赞 / 评论 / 转发数据与粉丝增长曲线，生成账号健康分与趋势报告。', version: '1.0.0', platform: 'douyin', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 小红书 */
  { id: 'xiaohongshu-crawl', name: '小红书·数据采集', description: '关键词搜索笔记、采集笔记详情与二级评论、用户主页、商品与话题聚合数据，导出 CSV / JSON。', version: '1.0.0', platform: 'xiaohongshu', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'xiaohongshu-publish', name: '小红书·内容发布', description: '发布图文笔记或视频笔记，支持标题、正文、话题、图片与合集；每日发帖上限 50 篇。', version: '1.0.0', platform: 'xiaohongshu', capability: 'copywriting', risk: 'L2', enabled: false, dir: '', body: '' },
  { id: 'xiaohongshu-comment', name: '小红书·评论互动', description: '回复评论、点赞收藏、处理 @ 提醒，支持按热度或时间排序批量互动。', version: '1.0.0', platform: 'xiaohongshu', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'xiaohongshu-im', name: '小红书·私信管理', description: '收发私信与群聊消息，支持批量触达与话术模板；引流类内容为官方重点打击对象。', version: '1.0.0', platform: 'xiaohongshu', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'xiaohongshu-analytics', name: '小红书·数据分析', description: '统计笔记曝光量、互动率、涨粉数据与粉丝画像，分析搜索词表现生成选品参考。', version: '1.0.0', platform: 'xiaohongshu', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* B站 */
  { id: 'bilibili-crawl', name: 'B站·数据采集', description: '采集视频详情、UP 主投稿列表、账号资料、关键词搜索、用户搜索、排行榜、热门视频、相关推荐与评论，导出 CSV / JSON。', version: '1.0.0', platform: 'bilibili', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'bilibili-publish', name: 'B站·内容发布', description: '把本地视频文件投稿到 B站，自动上传视频、填写标题与简介、创建标签、选择分区与创作声明并提交。', version: '1.0.0', platform: 'bilibili', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'bilibili-download', name: 'B站·视频下载', description: '把 B站 视频、番剧、合集或收藏夹下载到本地，自动拉流并 ffmpeg 合流，可指定清晰度、音质、输出格式与选集范围。', version: '1.0.0', platform: 'bilibili', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'bilibili-comment', name: 'B站·评论互动', description: '回复评论、点赞、发送弹幕，并采集评论数据做舆情分析。', version: '1.0.0', platform: 'bilibili', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'bilibili-analytics', name: 'B站·数据分析', description: '统计播放量、完播率、三连数据与粉丝增长，对比稿件分 P 表现生成优化建议。', version: '1.0.0', platform: 'bilibili', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 快手 */
  { id: 'kuaishou-crawl', name: '快手·数据采集', description: '按关键词采集作品详情、二级评论、创作者主页与直播榜单数据，导出 CSV / JSON。', version: '1.0.0', platform: 'kuaishou', capability: 'analytics', risk: 'L1', enabled: false, dir: '', body: '' },
  { id: 'kuaishou-publish', name: '快手·内容发布', description: '上传视频或图文到快手，支持话题、位置与定时发布。', version: '1.0.0', platform: 'kuaishou', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'kuaishou-comment', name: '快手·评论互动', description: '回复评论、点赞并采集评论数据，支持批量互动与关键词过滤。', version: '1.0.0', platform: 'kuaishou', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'kuaishou-im', name: '快手·私信管理', description: '收发私信、按规则自动回复，支持会话分配与转人工。', version: '1.0.0', platform: 'kuaishou', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'kuaishou-analytics', name: '快手·数据分析', description: '统计作品数据、粉丝画像与直播数据，生成运营日报。', version: '1.0.0', platform: 'kuaishou', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 公众号 */
  { id: 'wechat-mp-crawl', name: '公众号·数据采集', description: '抓取历史文章、按关键词搜索文章、采集阅读量 / 在看数与留言内容，导出 CSV。', version: '1.0.0', platform: 'wechat_mp', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'wechat-mp-publish', name: '公众号·内容发布', description: '创建图文草稿、上传素材、群发或定时群发，支持多图文编排；优先走官方发布接口。', version: '1.0.0', platform: 'wechat_mp', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'wechat-mp-comment', name: '公众号·评论互动', description: '留言精选与回复、评论管理，支持按关键词筛选待回复留言。', version: '1.0.0', platform: 'wechat_mp', capability: 'cs-script', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'wechat-mp-analytics', name: '公众号·数据分析', description: '生成阅读量 / 分享 / 涨粉日报，对比多篇文章效果并输出选题建议。', version: '1.0.0', platform: 'wechat_mp', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 淘宝 */
  { id: 'taobao-crawl', name: '淘宝·数据采集', description: '采集商品搜索、竞品价格与销量、评价内容与问大家，生成竞品监控报表。', version: '1.0.0', platform: 'taobao', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'taobao-publish', name: '淘宝·商品管理', description: '发布或编辑商品（alibaba.item.publish.submit），上传图片空间素材、装修详情页。', version: '1.0.0', platform: 'taobao', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'taobao-order', name: '淘宝·订单履约', description: '查询订单（taobao.trade.fullinfo.get）、发货、改价与退款处理；资金类操作需强确认。', version: '1.0.0', platform: 'taobao', capability: 'shop-ops', risk: 'L3', enabled: true, dir: '', body: '' },
  { id: 'taobao-stock', name: '淘宝·库存管理', description: '更新库存（tmall.item.quantity.update）、管理 SKU、批量上下架。', version: '1.0.0', platform: 'taobao', capability: 'shop-ops', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'taobao-im', name: '淘宝·客服消息', description: '收发千牛客服消息，支持自动回复、快捷短语与转人工规则。', version: '1.0.0', platform: 'taobao', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'taobao-analytics', name: '淘宝·数据分析', description: '拉取生意参谋核心指标，分析流量来源、转化率与客单价，生成经营诊断报告。', version: '1.0.0', platform: 'taobao', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 拼多多 */
  { id: 'pdd-crawl', name: '拼多多·数据采集', description: '采集商品搜索、竞品价格销量与评价数据，生成竞品对比报表。', version: '1.0.0', platform: 'pinduoduo', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'pdd-publish', name: '拼多多·商品管理', description: '发布商品（pdd.goods.add）、查询商品列表（pdd.goods.list.get）并更新商品信息。', version: '1.0.0', platform: 'pinduoduo', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'pdd-order', name: '拼多多·订单履约', description: '查询订单、发货、电子面单取号与售后处理；资金类操作需强确认。', version: '1.0.0', platform: 'pinduoduo', capability: 'shop-ops', risk: 'L3', enabled: true, dir: '', body: '' },
  { id: 'pdd-stock', name: '拼多多·库存管理', description: '更新库存（pdd.goods.quantity.update）、上下架与 SKU 管理。', version: '1.0.0', platform: 'pinduoduo', capability: 'shop-ops', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'pdd-im', name: '拼多多·客服消息', description: '收发商家客服消息，支持自动回复规则与话术模板。', version: '1.0.0', platform: 'pinduoduo', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'pdd-analytics', name: '拼多多·数据分析', description: '统计店铺核心数据、流量来源与转化分析，生成经营日报。', version: '1.0.0', platform: 'pinduoduo', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 闲鱼 */
  { id: 'xianyu-crawl', name: '闲鱼·数据采集', description: '关键词搜索闲鱼商品、采集商品详情与卖家主页，支持同类比价与到手价计算。', version: '1.0.0', platform: 'xianyu', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'xianyu-publish', name: '闲鱼·内容发布', description: '发布商品（标题 / 描述 / 图片 / 价格 / 类目），支持 AI 类目识别、一键擦亮与批量下架。', version: '1.0.0', platform: 'xianyu', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'xianyu-order', name: '闲鱼·订单履约', description: '查询订单、按分级规则自动发货、管理卡密库存；资金类操作需强确认。', version: '1.0.0', platform: 'xianyu', capability: 'shop-ops', risk: 'L3', enabled: true, dir: '', body: '' },
  { id: 'xianyu-im', name: '闲鱼·客服消息', description: '实时 IM 长连（WebSocket + 自动重连）、会话列表管理与 AI 客服自动回复。', version: '1.0.0', platform: 'xianyu', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'xianyu-analytics', name: '闲鱼·数据分析', description: '统计曝光 / 咨询 / 成交转化漏斗与商品表现排行，输出爆款与滞销分析。', version: '1.0.0', platform: 'xianyu', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 微信小店 */
  { id: 'wechat-store-product', name: '微信小店·商品管理', description: '商品添加（/channels/ec/product/add）、查询与列表（/channels/ec/product/list/get）、图片上传。', version: '1.0.0', platform: 'wechat_store', capability: 'shop-ops', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'wechat-store-order', name: '微信小店·订单履约', description: '查询订单（/channels/ec/order/get）、发货、电子面单取号与售后（补寄 / 商家协商）。', version: '1.0.0', platform: 'wechat_store', capability: 'shop-ops', risk: 'L3', enabled: true, dir: '', body: '' },
  { id: 'wechat-store-crawl', name: '微信小店·数据采集', description: '采集商品、竞品与评价数据，生成选品与定价参考报表。', version: '1.0.0', platform: 'wechat_store', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'wechat-store-publish', name: '微信小店·内容发布', description: '视频号商品挂车、直播间商品上架、商品卡投放到内容场景。', version: '1.0.0', platform: 'wechat_store', capability: 'copywriting', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'wechat-store-im', name: '微信小店·客服消息', description: '收发客服消息与售后沟通，支持自动回复与话术模板。', version: '1.0.0', platform: 'wechat_store', capability: 'cs-script', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'wechat-store-analytics', name: '微信小店·数据分析', description: '统计店铺 GMV、商品转化率与履约时效，生成经营分析报告。', version: '1.0.0', platform: 'wechat_store', capability: 'analytics', risk: 'L0', enabled: true, dir: '', body: '' },
  /* 知乎 */
  { id: 'zhihu-crawl', name: '知乎·数据采集', description: '按关键词搜索知乎问题/回答/文章，采集回答详情、评论、用户主页与热榜数据，导出 CSV / JSON。', version: '1.0.0', platform: 'zhihu', capability: 'analytics', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'zhihu-publish', name: '知乎·内容发布', description: '发布知乎专栏文章，支持标题与正文，自动打开写文章编辑器完成填写与提交；发布前需用户确认。', version: '1.0.0', platform: 'zhihu', capability: 'copywriting', risk: 'L2', enabled: false, dir: '', body: '' },

  /* ── 移植技能（8 个，platform: common，capability 按原项目分类）── */
  { id: 'product-wdj', name: '淘宝商品问大家分析', description: '获取淘宝/天猫商品「问大家」问答列表与回答详情，导出 CSV / JSON / HTML 报告。需绑定 taobao（淘宝买家）账号。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'docx', name: 'Word 文档', description: '创建 / 读取 / 编辑 .docx，支持目录、标题、页码、信头、修订与批注处理，产物写入 artifacts/。', version: '1.0.0', platform: 'common', capability: 'office', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'pdf', name: 'PDF 处理', description: '读取提取文本表格、合并拆分、旋转、水印、表单填写、加解密、提取图片、扫描件 OCR。', version: '1.0.0', platform: 'common', capability: 'office', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'pptx', name: 'PPTX 演示文稿', description: '创建幻灯片 / 路演材料，读取解析 .pptx 文本，编辑现有演示文稿，处理模板、布局与演讲者备注。', version: '1.0.0', platform: 'common', capability: 'office', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'xlsx', name: '电子表格', description: '读写 .xlsx / .xlsm / .csv / .tsv，计算公式、格式化、制图，清理重构混乱表格数据。', version: '1.0.0', platform: 'common', capability: 'office', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'channel_message', name: '频道消息推送', description: '向用户 / 会话 / 频道单向推送消息（任务完成、提醒、告警），不等待回复；正常回复不要使用。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'dingtalk_channel', name: '钉钉频道连接', description: '用可视浏览器自动完成钉钉应用创建与频道绑定，遇到登录页暂停等待用户登录后继续。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'dws', name: '钉钉全产品', description: '管理钉钉 AI表格 / 日历 / 通讯录 / 群聊 / 待办 / 审批 / 考勤 / 日志 / 文档 / 钉盘 / 听记 / 邮箱。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L2', enabled: true, dir: '', body: '' },

  /* ── 在线技能（18 个，platform: common，capability: vertical）── */
  { id: 'store-patrol-manager', name: '巡店管家', description: '基于绑定店铺与指定周期完成综合巡店，分析店铺、类目、商品、推广与退款，行业数据可用时校准市场表现。适用于巡店、涨跌归因、周复盘与经营诊断。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'competitor-strategy-comparison', name: '竞品策略对比分析', description: '基于生意参谋（sycm）店铺会话在后台请求 DMP 接口，做竞品策略对比。Cookie 由 Gateway 携带，不读取或持久化凭证。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L2', enabled: true, dir: '', body: '' },
  { id: 'competitor-indicator', name: '达摩盘竞品指标对比', description: '拉取达摩盘竞品核心指标做横向对比，输出差距归因与优化建议。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L2', enabled: false, dir: '', body: '' },
  { id: 'market-trend', name: '生意参谋市场排行分析', description: '指定类目 4 周期（周/月）商品排行，分析上升/下降/新上榜/跌出榜/持平，输出 JSON + CSV。榜单含交易总量、交易增速、流量总量、加购收藏、新品流量。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'sycm-customer', name: '生意参谋客户分析', description: '分析店铺客户结构、新老客占比、复购与流失，输出分层运营建议。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'keyword-traffic', name: '万相台关键词流量趋势', description: '解析万相台关键词流量趋势，定位高潜词与低效词，指导投放优化。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'keyword-assistant', name: '生意参谋关键词排行', description: '生意参谋关键词排行与拓词，挖掘类目高转化词与机会词。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'market-analysis', name: '淘宝搜索结果页分析', description: '分析淘宝搜索结果页大盘，统计竞品卡位、价格带与卖点分布。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'product-reviews', name: '淘宝商品评价分析', description: '采集并分析商品评价，做情感归类、痛点提取与卖点提炼。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'industry-data-mcp', name: '淘宝行业类目分析', description: '基于行业库（参谋长）做类目全维度分析：类目归属、汇总指标、按天趋势、热搜词、商品榜单，生成交互式 HTML 报告。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L1', enabled: true, dir: '', body: '' },
  { id: 'pywencai-stock', name: 'A股行情数据查询', description: '基于东方财富公开接口获取A股涨幅榜/跌幅榜、涨停跌停股池、概念与行业板块、个股行情财务、主力资金流、龙虎榜、市盈率/ROE/净利润排行。无需登录、无需 API Key。', version: '2.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'valuation-investment-strategy', name: '估值与投资策略分析', description: '个股估值建模与投资策略分析，输出估值区间与策略建议。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'financial-statement-analyzer', name: '财务报表深度分析', description: '三张表深度解析，识别财务质量、盈利结构与风险信号。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'industry-competition-moat', name: '行业竞争护城河分析', description: '分析行业竞争格局与护城河，评估长期竞争优势与壁垒。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'a-stock-diagnosis', name: 'A股个股技术诊断', description: '基于 60 日 K 线计算 MA5/10/20/60、量价关系、支撑压力位与风险信号，输出结构化诊断报告。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'data-report', name: '数据可视化报告', description: '将结构化数据生成可视化图表与交互式 HTML 报告。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'smart-compose', name: '智能排版', description: '对文案内容做智能排版与版式优化，输出可直接发布的成品。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
  { id: 'customer-service-reply', name: '电商客服话术生成', description: '根据场景与商品信息生成客服话术，支持售前咨询、售后安抚与催单场景。', version: '1.0.0', platform: 'common', capability: 'vertical', risk: 'L0', enabled: true, dir: '', body: '' },
]

type Tab = 'vertical' | 'builtin' | 'installed'

export interface SkillMarketPageDeps {
  skill?: SkillService
  config: Config
}

export function skillMarketPage(deps: SkillMarketPageDeps) {
  const skill = deps.skill!

  let all: SkillRow[] = []
  let tab: Tab = 'vertical'
  let cap = 'all'
  let plat = 'all'
  let kw = ''

  async function load() {
    const host = (globalThis as { __PLUGIN__?: { skills?: SkillRow[] } }).__PLUGIN__
    let scanned: SkillRow[] = []
    if (host?.skills?.length) {
      scanned = host.skills
    } else if (skill) {
      try { scanned = await skill.list() } catch { scanned = [] }
    }
    all = scanned.length ? scanned : FALLBACK_SKILLS
  }

  /** 三页签的过滤差异 */
  function inTab(s: SkillRow): boolean {
    if (tab === 'installed') return s.enabled
    if (tab === 'builtin') {
      // 内置技能：通用核心能力（非垂直业务、非平台特定）
      return s.platform === 'common' && s.capability !== 'vertical'
    }
    // 垂直业务技能：vertical 类 + 各平台特定技能
    return s.capability === 'vertical' || s.platform !== 'common'
  }

  function visible(): SkillRow[] {
    return all.filter(s =>
      inTab(s) &&
      (plat === 'all' || normPlatform(s.platform) === normPlatform(plat)) &&
      (!kw || s.name.includes(kw) || s.id.includes(kw) || s.description.includes(kw)))
  }

  function esc(s: string): string {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  function card(s: SkillRow): string {
    return `
      <article class="dsm-card" data-id="${esc(s.id)}">
        <div class="dsm-card-hd">
          <span class="dsm-ico">🔌</span>
          <div class="dsm-card-t">
            <b>${esc(s.name)}</b>
          </div>
        </div>
        <p class="dsm-desc">${esc(s.description || '暂无描述')}</p>
        <div class="dsm-card-ft">
          <label class="dsm-switch" title="改写 SKILL.md 的 disable-model-invocation">
            <input type="checkbox" data-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''}>
            <span class="dsm-slider"></span>
            <em>${s.enabled ? '已启用' : '已停用'}</em>
          </label>
          <a class="dsm-link" data-detail="${esc(s.id)}">详情</a>
        </div>
      </article>`
  }

  function renderGrid(): string {
    const rows = visible()
    if (!rows.length) {
      return `<div class="dsm-empty">没有匹配的技能，换个筛选条件试试。</div>`
    }
    return `<div class="dsm-grid">${rows.map(card).join('')}</div>`
  }

  function renderChips(): string {
    const platRow = PLATFORMS.map(([k, label]) =>
      `<button class="dsm-chip dsm-chip-plat ${plat === k ? 'on' : ''}" data-plat="${k}">${label}</button>`).join('')
    return `
      <div class="dsm-filter" data-chips>
        <div class="dsm-filter-row"><span class="dsm-fl">平台</span>${platRow}</div>
      </div>`
  }

  function renderTabs(): string {
    const verticalCount = all.filter(s => s.capability === 'vertical' || s.platform !== 'common').length
    const builtinCount = all.filter(s => s.platform === 'common' && s.capability !== 'vertical').length
    const installedCount = all.filter(s => s.enabled).length
    const tabs: Array<[Tab, string, number]> = [
      ['vertical', '垂直业务技能', verticalCount],
      ['builtin', '内置技能', builtinCount],
      ['installed', '已安装', installedCount],
    ]
    return `<div class="dsm-tabs">${tabs.map(([k, label, n]) =>
      `<button class="dsm-tab ${tab === k ? 'on' : ''}" data-tab="${k}">${label}<em>${n}</em></button>`).join('')}</div>`
  }

  return {
    async html(): Promise<string> {
      await load()
      return `
        <div class="dsm-page">
          <header class="dsm-hd">
            <div>
              <h2>DSAgent 技能</h2>
            </div>
            <button class="dsm-btn" data-act="import">导入本地技能</button>
          </header>
          ${renderTabs()}
          ${renderChips()}
          <div class="dsm-search">
            <input type="search" placeholder="搜索技能名称或功能…" data-kw>
          </div>
          <div class="dsm-body" data-body>${renderGrid()}</div>

          <div class="dsm-drawer" hidden>
            <div class="dsm-drawer-bd">
              <div class="dsm-drawer-hd"><b data-d-title></b><button data-act="close">✕</button></div>
              <div data-d-content></div>
            </div>
          </div>
          <div class="dsm-toast" hidden></div>
        </div>
        <style>${MARKET_CSS}</style>`
    },

    mount(root: HTMLElement) {
      const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T
      const toast = q('.dsm-toast')
      const drawer = q('.dsm-drawer')

      function say(msg: string) {
        toast.textContent = msg
        toast.hidden = false
        window.setTimeout(() => { toast.hidden = true }, 2000)
      }

      function repaint() {
        q('[data-body]').innerHTML = renderGrid()
        // 内置技能页签不显示平台筛选器
        const chipsEl = q('[data-chips]')
        if (chipsEl) chipsEl.style.display = tab === 'builtin' ? 'none' : ''
        root.querySelectorAll('.dsm-tab').forEach(el => {
          const k = (el as HTMLElement).dataset.tab as Tab
          el.classList.toggle('on', k === tab)
          const em = el.querySelector('em')
          if (em) {
            const vCount = all.filter(s => s.capability === 'vertical' || s.platform !== 'common').length
            const bCount = all.filter(s => s.platform === 'common' && s.capability !== 'vertical').length
            em.textContent = String(k === 'vertical' ? vCount
              : k === 'builtin' ? bCount
              : all.filter(s => s.enabled).length)
          }
        })
      }

      async function openDetail(id: string) {
        const s = all.find(x => x.id === id)
        if (!s) return
        const { asks, triggers, fromQuote } = askExamples(s)
        const askSec = `
          <div class="dsm-d-sec">
            <h4>怎么问（使用对话案例）</h4>
            ${asks.length
              ? `<ul class="dsm-asks">${asks.map(a =>
                  `<li><span>${esc(a)}</span><button class="dsm-copy" data-copy="${esc(a)}">复制</button></li>`).join('')}</ul>`
              : `<p class="dsm-hint">直接用自然语言说明你的目标即可，例如「${esc(s.name)}」相关的具体需求。</p>`}
            <p class="dsm-hint">${fromQuote
              ? '在对话里说出上面的任意一句，就会自动调用本技能。'
              : '提到上面的关键词并说明目标，就会自动调用本技能。'}</p>
          </div>
          ${triggers.length && fromQuote
            ? `<div class="dsm-d-sec">
                <h4>触发词</h4>
                <div class="dsm-tags">${triggers.map(t => `<span class="dsm-tag">${esc(t)}</span>`).join('')}</div>
              </div>`
            : ''}`
        q('[data-d-content]').innerHTML = `
          <div class="dsm-d-sec">
            <h4>功能说明</h4><p>${esc(s.description || '暂无描述')}</p>
          </div>
          ${askSec}
          <div class="dsm-d-sec">
            <h4>元信息</h4>
            <div class="dsm-meta">
              <span>技能 id</span><b>${esc(s.id)}</b>
              <span>版本</span><b>${esc(s.version)}</b>
              <span>平台</span><b>${esc(PLATFORM_LABEL[normPlatform(s.platform)] || s.platform)}</b>
              <span>能力</span><b>${esc(CAP_LABEL[s.capability] || s.capability)}</b>
              <span>风险等级</span><b>${esc(RISK_META[s.risk]?.label || s.risk)}</b>
              <span>当前状态</span><b>${s.enabled ? '已启用' : '已停用'}</b>
            </div>
          </div>
          <div class="dsm-d-sec">
            <h4>SKILL.md 片段</h4>
            <pre class="dsm-pre">name: ${esc(s.id)}
description: ${esc(s.description || '—')}
disable-model-invocation: ${s.enabled ? 'false' : 'true'}</pre>
          </div>`
        drawer.hidden = false
      }

      const onClick = async (e: Event) => {
        const t = e.target as HTMLElement

        const tabEl = t.closest('[data-tab]') as HTMLElement | null
        if (tabEl) { tab = tabEl.dataset.tab as Tab; repaint(); return }

        const platEl = t.closest('[data-plat]') as HTMLElement | null
        if (platEl) {
          plat = platEl.dataset.plat as string
          root.querySelectorAll('[data-plat]').forEach(el => el.classList.toggle('on', (el as HTMLElement).dataset.plat === plat))
          repaint(); return
        }

        const dEl = t.closest('[data-detail]') as HTMLElement | null
        if (dEl) { await openDetail(dEl.dataset.detail as string); return }

        const cEl = t.closest('[data-copy]') as HTMLElement | null
        if (cEl) {
          const text = cEl.dataset.copy as string
          try {
            await navigator.clipboard.writeText(text)
            say('已复制，可直接粘贴到对话框')
          } catch {
            say(`复制失败，请手动输入：${text}`)
          }
          return
        }

        const actEl = t.closest('[data-act]') as HTMLElement | null
        if (actEl?.dataset.act === 'close') { drawer.hidden = true; return }
        if (actEl?.dataset.act === 'import') {
          // 导入本地技能：选择 SKILL.md 后校验入库
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.md'
          input.onchange = async () => {
            const f = input.files?.[0]
            if (!f) return
            if (!skill) { say('技能服务未就绪'); return }
            say(`正在校验「${f.name}」…`)
            try {
              const mdContent = await f.text()
              const res = await skill.importSkill(mdContent)
              if (res.ok) {
                say(`导入成功：${res.skillId}，已写入 SKILL.md`)
                // 刷新列表
                all = await skill.list()
                repaint()
              } else {
                say(`导入失败：${res.error ?? '校验未通过'}`)
              }
            } catch (err) {
              say(`导入失败：${(err as Error).message}`)
            }
          }
          input.click()
          return
        }
      }
      root.addEventListener('click', onClick)

      // 启停开关：真实改写 SKILL.md
      const onChange = async (e: Event) => {
        const input = e.target as HTMLInputElement
        const id = input.dataset.toggle
        if (!id) return
        if (!skill) { say('技能服务未就绪'); return }
        const next = input.checked
        try {
          await skill.setEnabled(id, next)
          const row = all.find(s => s.id === id)
          if (row) row.enabled = next
          const label = input.parentElement?.querySelector('em')
          if (label) label.textContent = next ? '已启用' : '已停用'
          say(next
            ? `已启用「${id}」，已写入 SKILL.md，模型立即可见`
            : `已停用「${id}」，已写入 SKILL.md，模型不再可见`)
          repaint()
        } catch (err) {
          input.checked = !next
          say(`操作失败：${(err as Error).message}`)
        }
      }
      root.addEventListener('change', onChange)

      // 搜索
      const search = q<HTMLInputElement>('[data-kw]')
      const onSearch = () => { kw = search.value.trim(); repaint() }
      search.addEventListener('input', onSearch)

      const onDrawerClick = (ev: Event) => { if (ev.target === drawer) drawer.hidden = true }
      drawer.addEventListener('click', onDrawerClick)

      return () => {
        root.removeEventListener('click', onClick)
        root.removeEventListener('change', onChange)
        search.removeEventListener('input', onSearch)
        drawer.removeEventListener('click', onDrawerClick)
      }
    },
  }
}

const MARKET_CSS = `
.dsm-page{font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2430}
.dsm-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}
.dsm-hd h2{margin:0 0 4px;font-size:17px}
.dsm-dim{color:#8b93a7;margin:0}
.dsm-btn{border:1px solid #d8dde8;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
.dsm-btn:hover{border-color:#2b6cff;color:#2b6cff}
.dsm-tabs{display:flex;gap:6px;border-bottom:1px solid #eceff5;margin-bottom:14px}
.dsm-tab{border:none;background:none;padding:8px 14px;cursor:pointer;color:#67708a;font-size:13px;border-bottom:2px solid transparent}
.dsm-tab em{font-style:normal;margin-left:6px;color:#a3abbd;font-size:11px}
.dsm-tab.on{color:#2b6cff;border-bottom-color:#2b6cff;font-weight:600}
.dsm-filter{margin-bottom:12px}
.dsm-filter-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.dsm-fl{width:34px;color:#8b93a7;font-size:12px;flex:none}
.dsm-chip{border:1px solid #e4e8f0;background:#fff;border-radius:14px;padding:3px 12px;cursor:pointer;font-size:12px;color:#4a5266}
.dsm-chip:hover{border-color:#b9c2d4}
.dsm-chip.on{background:#2b6cff;border-color:#2b6cff;color:#fff}
.dsm-chip-plat.on{background:#8a94a6;border-color:#8a94a6}
.dsm-search{margin-bottom:14px}
.dsm-search input{width:260px;border:1px solid #e4e8f0;border-radius:6px;padding:6px 12px;font-size:13px;outline:none}
.dsm-search input:focus{border-color:#2b6cff}
.dsm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.dsm-card{background:#fff;border:1px solid #eceff5;border-radius:9px;padding:14px;display:flex;flex-direction:column;gap:10px}
.dsm-card:hover{border-color:#c9d4ea;box-shadow:0 4px 14px rgba(43,108,255,.07)}
.dsm-card-hd{display:flex;align-items:center;gap:9px}
.dsm-ico{width:30px;height:30px;border-radius:8px;background:#f2f5fb;display:inline-flex;align-items:center;justify-content:center;font-size:15px;flex:none}
.dsm-card-t{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-badge{border-radius:4px;padding:1px 6px;font-size:11px}
.dsm-desc{margin:0;color:#67708a;font-size:12.5px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:54px}
.dsm-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-tag{background:#f2f5fb;color:#4a5266;border-radius:4px;padding:1px 7px;font-size:11px}
.dsm-tag-cap{background:#eef3ff;color:#2b6cff}
.dsm-auth{font-size:11px}
.dsm-auth.ok{color:#1a9f4d}
.dsm-auth.no{color:#d93b3b}
.dsm-card-ft{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f2f4f9;padding-top:9px;margin-top:auto}
.dsm-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:#4a5266}
.dsm-switch input{display:none}
.dsm-slider{width:32px;height:18px;border-radius:10px;background:#d8dde8;position:relative;transition:.18s;flex:none}
.dsm-slider::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.18s}
.dsm-switch input:checked + .dsm-slider{background:#2b6cff}
.dsm-switch input:checked + .dsm-slider::after{transform:translateX(14px)}
.dsm-switch em{font-style:normal}
.dsm-link{color:#2b6cff;cursor:pointer;font-size:12px}
.dsm-link:hover{text-decoration:underline}
.dsm-empty{text-align:center;padding:56px 20px;color:#8b93a7;border:1px dashed #dfe4ee;border-radius:8px;background:#fff}
.dsm-drawer{position:fixed;inset:0;background:rgba(16,20,32,.36);display:flex;justify-content:flex-end;z-index:99}
.dsm-drawer[hidden]{display:none}
.dsm-drawer-bd{width:440px;max-width:92vw;height:100%;background:#fff;overflow:auto;padding:18px 20px;box-shadow:-10px 0 30px rgba(16,20,32,.16)}
.dsm-drawer-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;font-size:15px}
.dsm-drawer-hd button{border:none;background:none;color:#8b93a7;cursor:pointer;font-size:14px}
.dsm-d-sec{margin-bottom:18px}
.dsm-d-sec h4{margin:0 0 6px;font-size:13px;color:#2b6cff}
.dsm-d-sec p{margin:0;color:#4a5266}
.dsm-hint{color:#8b93a7!important;font-size:12px;margin-top:6px!important}
.dsm-asks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dsm-asks li{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#f7f9fc;border:1px solid #eceff5;border-radius:6px;padding:6px 10px;font-size:12.5px;color:#1f2430}
.dsm-asks li span{flex:1;word-break:break-all}
.dsm-copy{border:1px solid #d8dde8;background:#fff;border-radius:4px;padding:2px 8px;font-size:11px;color:#4a5266;cursor:pointer;flex:none}
.dsm-copy:hover{border-color:#2b6cff;color:#2b6cff}
.dsm-auth-line{display:flex;align-items:center;gap:8px;color:#4a5266}
.dsm-dot{width:8px;height:8px;border-radius:50%;flex:none}
.dsm-dot.ok{background:#1a9f4d}
.dsm-dot.no{background:#d93b3b}
.dsm-meta{display:grid;grid-template-columns:78px 1fr;gap:6px 10px;color:#67708a;font-size:12.5px}
.dsm-meta b{color:#1f2430;font-weight:600}
.dsm-pre{background:#f7f9fc;border:1px solid #eceff5;border-radius:6px;padding:10px;font-size:12px;color:#4a5266;overflow:auto;margin:0;white-space:pre-wrap}
.dsm-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);background:rgba(24,28,40,.9);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:120}
.dsm-toast[hidden]{display:none}
`
