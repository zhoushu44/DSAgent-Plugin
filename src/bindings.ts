/**
 * 技能 → 平台绑定规则（单一真源）。
 *
 * 原先收在 index.ts 里，工作流预览服务器（dev/preview-server.ts）需要同一份
 * 规则来组装真实执行链路，故抽出。生产侧 index.ts 从这里导入。
 */

/** 需要绑定账号的技能（用于前置校验） */
export const BINDING_RULES: Array<[string, string]> = [
  // sycm 平台（生意参谋系技能 —— 凭证层复用淘宝登录态，登录淘宝后即可用，账号页无独立登录入口）
  ['sycm-customer', 'sycm'],
  ['competitor-strategy-comparison', 'sycm'],
  ['competitor-indicator', 'sycm'],
  ['keyword-assistant', 'sycm'],
  ['keyword-traffic', 'sycm'],
  ['market-trend', 'sycm'],
  ['store-patrol-manager', 'sycm'],
  // sycm 平台（参谋长分析包转换的诊断类技能 —— 凭证层同样复用淘宝登录态）
  ['category-structure-diagnosis', 'sycm'],
  ['product-layering-diagnosis', 'sycm'],
  ['shop-promotion-diagnosis', 'sycm'],
  // taobao 平台（淘宝登录态）
  ['product-reviews', 'taobao'],
  ['product-wdj', 'taobao'],
  ['market-analysis', 'taobao'],
  // douyin 平台
  ['douyin-crawl', 'douyin'],
  ['douyin-publish', 'douyin'],
  ['douyin-comment', 'douyin'],
  ['douyin-im', 'douyin'],
  ['douyin-analytics', 'douyin'],
  // zhihu 平台
  ['zhihu-crawl', 'zhihu'],
  ['zhihu-publish', 'zhihu'],
  // xhs 平台（小红书）
  ['xiaohongshu-crawl', 'xhs'],
  ['xiaohongshu-publish', 'xhs'],
  ['xiaohongshu-analytics', 'xhs'],
  // xianyu 平台（闲鱼）
  ['xianyu-crawl', 'xianyu'],
  ['xianyu-publish', 'xianyu'],
  ['xianyu-order', 'xianyu'],
  ['xianyu-im', 'xianyu'],
  ['xianyu-analytics', 'xianyu'],
  // bilibili 平台（B站）
  ['bilibili-crawl', 'bilibili'],
  ['bilibili-download', 'bilibili'],
  ['bilibili-publish', 'bilibili'],
  // pdd 平台（拼多多）
  ['pdd-crawl', 'pdd'],
  // pdd_mms 平台（拼多多商家后台 —— 与买家 H5 是两套独立登录态）
  ['pdd-publish', 'pdd_mms'],
  // taobao 平台（淘宝 / 天猫，共用同一套登录态）
  ['taobao-publish', 'taobao'],
]

/** 技能 id → 需绑定的平台（无绑定返回 null） */
export function requiredPlatform(skillId: string): string | null {
  for (const [id, platform] of BINDING_RULES) {
    if (skillId === id || skillId.startsWith(id)) return platform
  }
  return null
}

/**
 * 账号引导文案里的平台名。
 *
 * 生意参谋系（sycm/万相台/达摩盘/天猫洞察）在凭证层复用淘宝登录态，
 * 账号连接页**没有**「生意参谋」入口 —— 引导文案必须说「淘宝」。
 * 否则用户按提示去账号页却找不到该平台，形成死路（「登录淘宝后生意参谋即可用」的文案侧收口）。
 */
const GUIDED_PLATFORM: Record<string, string> = {
  sycm: '淘宝',
  alimama: '淘宝',
  dmp: '淘宝',
  sycm_insight: '淘宝',
  xianyu: '淘宝',
}

export function guidedPlatform(platform: string): string {
  return GUIDED_PLATFORM[platform] ?? platform
}

/** 复用淘宝登录态的平台在引导文案里的补充说明（说明为什么让用户去连淘宝） */
export function guidedPlatformExtra(platform: string): string {
  if (!GUIDED_PLATFORM[platform]) return ''
  if (platform === 'xianyu') {
    return '（闲鱼复用淘宝登录态，登录淘宝后会自动同步闲鱼登录态，无需单独登录闲鱼）'
  }
  return '（生意参谋 / 万相台 / 达摩盘共用淘宝登录态，无需单独登录生意参谋）'
}
