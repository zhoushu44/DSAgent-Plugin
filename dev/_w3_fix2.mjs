import fs from 'node:fs'
const p = 'dev/verify-mqs-tools.mjs'
let t = fs.readFileSync(p, 'utf8')

// 1) 去掉凭空发明的 jd.hk（京东发布域只有 jd.com），避免误报
t = t.replace("domains: ['jd.com', 'jd.hk']", "domains: ['jd.com']")

// 2) 平台工具别名：同引擎换域的工具也算「本平台工具」
//    tmall 与 taobao 共用 goods_manager 引擎（channel 切域），天猫技能声明的是 dsagent_taobao_publish_mqs；
//    抖店工具名是 dsagent_douyin_shop_publish_mqs，中间夹了 shop_，用前缀硬匹配会漏。
const oldExp = `export const EXPECTED = [
  { id: '1688-publish-mqs', platform: '1688', domains: ['1688.com'], words: ['1688', '阿里巴巴'] },
  { id: 'douyin-publish-mqs', platform: 'douyin', domains: ['douyin.com'], words: ['抖音', 'douyin'] },
  { id: 'jd-publish-mqs', platform: 'jd', domains: ['jd.com'], words: ['京东', 'jd'] },
  { id: 'taobao-publish-mqs', platform: 'taobao', domains: ['taobao.com'], words: ['淘宝', 'taobao'] },
  { id: 'tmall-publish-mqs', platform: 'tmall', domains: ['tmall.com'], words: ['天猫', 'tmall'] },
]`
const newExp = `export const EXPECTED = [
  {
    id: '1688-publish-mqs',
    platform: '1688',
    domains: ['1688.com'],
    words: ['1688', '阿里巴巴'],
    toolPatterns: [/^dsagent_1688_[a-z0-9_]*publish/],
  },
  {
    id: 'douyin-publish-mqs',
    platform: 'douyin',
    domains: ['douyin.com'],
    words: ['抖音', 'douyin'],
    toolPatterns: [/^dsagent_douyin_[a-z0-9_]*publish/],
  },
  {
    id: 'jd-publish-mqs',
    platform: 'jd',
    domains: ['jd.com'],
    words: ['京东', 'jd'],
    toolPatterns: [/^dsagent_jd_[a-z0-9_]*publish/],
  },
  {
    id: 'taobao-publish-mqs',
    platform: 'taobao',
    domains: ['taobao.com'],
    words: ['淘宝', 'taobao'],
    toolPatterns: [/^dsagent_taobao_[a-z0-9_]*publish/],
  },
  {
    // 天猫与淘宝共用同一 goods_manager 引擎，只按 channel 切发布域：
    // 天猫技能声明的工具就是 dsagent_taobao_publish_mqs，因此天猫的合法工具前缀包含 taobao_。
    id: 'tmall-publish-mqs',
    platform: 'tmall',
    domains: ['tmall.com'],
    words: ['天猫', 'tmall'],
    toolPatterns: [/^dsagent_(?:tmall|taobao)_[a-z0-9_]*publish/],
  },
]`
if (!t.includes(oldExp)) throw new Error('EXPECTED block not found')
t = t.replace(oldExp, newExp)

// 3) isPlatformTool 支持 expected.toolPatterns 别名
const oldFn = `/** 该平台「自己的」发布工具名：dsagent_<platform>_publish 前缀。 */
export function isPlatformTool(tool, platform) {
  return tool.indexOf('dsagent_' + platform + '_publish') === 0
}`
const newFn = `/** 该平台「自己的」发布工具名：优先用 EXPECTED 里声明的 toolPatterns（含同引擎换域别名）。 */
export function isPlatformTool(tool, platform) {
  const expected = EXPECTED.find((e) => e.platform === platform)
  if (expected && expected.toolPatterns) return expected.toolPatterns.some((re) => re.test(tool))
  return tool.indexOf('dsagent_' + platform + '_') === 0 && /publish/.test(tool)
}`
if (!t.includes(oldFn)) throw new Error('isPlatformTool block not found')
t = t.replace(oldFn, newFn)

// 4) 自测补两条别名用例
const oldT = `  check('isPlatformTool 只认平台前缀', () => {
    assert(isPlatformTool('dsagent_1688_publish_mqs', '1688') === true, '1688 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'taobao') === true, 'taobao 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'tmall') === false, 'tmall 不该命中 taobao 工具')
    assert(isPlatformTool('dsagent_risk_verify', 'jd') === false, 'risk_verify 不该算平台发布工具')
  })`
const newT = `  check('isPlatformTool 认平台前缀 + 同引擎别名', () => {
    assert(isPlatformTool('dsagent_1688_publish_mqs', '1688') === true, '1688 前缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish', 'taobao') === true, 'taobao 前缀未命中')
    assert(isPlatformTool('dsagent_douyin_shop_publish_mqs', 'douyin') === true, '抖店 shop_ 中缀未命中')
    assert(isPlatformTool('dsagent_taobao_publish_mqs', 'tmall') === true, '天猫应接受同引擎 taobao_ 别名')
    assert(isPlatformTool('dsagent_taobao_publish', 'jd') === false, 'jd 不该命中 taobao 工具')
    assert(isPlatformTool('dsagent_risk_verify', 'jd') === false, 'risk_verify 不该算平台发布工具')
  })`
if (!t.includes(oldT)) throw new Error('isPlatformTool selftest not found')
t = t.replace(oldT, newT)

fs.writeFileSync(p, t, 'utf8')
console.log('patched bytes', t.length)
