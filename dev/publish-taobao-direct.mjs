/**
 * 真实上架脚本：手机支架（catId=150708）→ 淘宝，用 directPublishUrl 直达发布页。
 *
 * 用法：
 *   node dev/publish-taobao-direct.mjs            # 预览（不启动浏览器）
 *   node dev/publish-taobao-direct.mjs --confirm   # 真实提交（弹 Chrome，实际发布）
 *   node dev/publish-taobao-direct.mjs --catId=150708
 *   node dev/publish-taobao-direct.mjs --confirm --brand=007   # 显式声明品牌（手机支架类目「品牌」是唯一必填属性）
 *
 * 为什么用直达 URL：淘宝从「选类目页 → 确认下一步」进入发布页时，属性区是空壳
 * （struct-p-* 有 28 个但 label 0 个），必填类目属性读不到也填不上，提交被前端
 * 校验硬拦（连请求都发不出去）。从 catId 直达则属性区完整渲染（label.required 7 个）。
 * 详见 src/taobao-publish.ts §1 directPublishUrl 注释。
 *
 * 账号库是 AES-256-GCM 加密的，无法离线读 shopKey，故用 CredentialStore 现场解析。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const CONFIRM = process.argv.includes('--confirm')
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))

const tbAccounts = store.listAccounts().filter((a) => a.platform === 'taobao')
console.log('===== 账号库里的淘宝账号 =====')
for (const a of tbAccounts) console.log(`  ${a.shop_key}  (${a.display_label})  ${a.status}`)

const explicit = argOf('account')
let account = explicit
if (!account) {
  const valid = tbAccounts.filter((a) => a.status === 'valid')
  account = valid[0]?.shop_key
  if (account) console.log(`\n未指定 --account，自动选用第一个 valid 账号：${account}`)
}
if (!account) {
  console.error('\n没有可用的淘宝账号（valid）。请先在「账号连接」页登录淘宝。')
  process.exit(1)
}

const catId = argOf('catId') || '150708'
const directPublishUrl = `https://item.upload.taobao.com/sell/v2/publish.htm?catId=${encodeURIComponent(catId)}`

// 本地测试主图（800x800 占位图，非真实商品图）
const IMG = join('C:', 'Users', 'Administrator', '.dsh', 'profiles', 'desktop', 'artifacts', 'mqs_test', 'test1.jpg')
if (!existsSync(IMG)) {
  console.error(`测试主图不存在：${IMG}`)
  process.exit(1)
}

const result = await taobaoPublish(store, {
  channel: argOf('channel') || 'taobao',
  title: argOf('title') || '桌面手机支架懒人支撑架测试',
  price: argOf('price') || '19.9',
  stock: argOf('stock') || '100',
  images: [IMG],
  directPublishUrl,
  brand: argOf('brand'),
  account,
  confirm: CONFIRM,
  attributes: [
    { name: '材质', value: 'ABS' },
    { name: '适用场景', value: '桌面' },
  ],
})

console.log(`\n===== 结果（confirm=${CONFIRM}，catId=${catId}） =====`)
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : (result.needConfirm ? 2 : 1))
