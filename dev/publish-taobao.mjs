/**
 * 真实上架脚本：本地图片 → 淘宝（卖家中心网页版发布页）
 *
 * 用法：
 *   node dev/publish-taobao.mjs                       # dry-run（只出「发布预览」，不启动浏览器）
 *   node dev/publish-taobao.mjs --confirm             # 真实提交（弹出 Chrome，实际发布商品）
 *   node dev/publish-taobao.mjs --account=taobao_xxx  # 指定账号（默认取第一个 valid 的淘宝账号）
 *   node dev/publish-taobao.mjs --channel=tmall       # 发到天猫（默认 taobao）
 *   node dev/publish-taobao.mjs --category=儿童睡衣   # 自动选类目（★传叶子类目词，不传一级大类名或整段标题）
 *   node dev/publish-taobao.mjs --brand=某某 --model=X1 # 类目把「品牌/型号」列为必填属性时自动填（如 AI软件订阅/Token充值）
 *
 * 前置：先 `npm run build:host` 产出 lib/（脚本 import 的是 lib/ 编译产物，不是 src/）。
 * 账号库是 AES-256-GCM 加密的，无法离线读 shopKey，故本脚本用 CredentialStore 现场解析。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIRM = process.argv.includes('--confirm')
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))

// ── 解析淘宝账号（--account 显式指定；否则取第一个 valid 的淘宝账号）──
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
  console.error('\n没有可用的淘宝账号（valid）。请先在「账号连接」页登录淘宝，或用 --account=<shop_key> 指定。')
  process.exit(1)
}

const channel = argOf('channel') || 'taobao'
const categoryKeyword = argOf('category')
const brand = argOf('brand')
const model = argOf('model')

// ── 测试商品（复用 pdd-link-matrix 的本地素材）──
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const img = (n) => join(SRC, n)

const result = await taobaoPublish(store, {
  channel,
  title: '秋冬新款儿童宽松睡衣秋季摇粒绒卡通糖果男童女童家居服套装开衫',
  price: '79.9',
  stock: '1000',
  images: [img('main_06.jpg'), img('main_07.jpg'), img('main_08.jpg')],
  categoryKeyword,
  brand,
  model,
  account,
  confirm: CONFIRM,
  // 显式属性——前序真机实测页面「平台推荐值」+ 候选列表中的合理值
  attributes: [
    { name: '适用季节', value: '秋季' },
    { name: '适用性别', value: '女' },
    { name: '版型', value: '宽松' },
    { name: '衣门襟', value: '单排扣' },
    { name: '袖长', value: '长袖' },
    { name: '内衣质地', value: '夹棉' },
    { name: '安全等级', value: 'A类' },
    { name: '产地', value: '中国大陆' },
    { name: '可外穿性', value: '适合外出' },
    { name: '裤长', value: '长裤' },
    { name: '款式', value: '分体式' },
    { name: '领型', value: '连帽' },
    { name: '柔软度', value: '柔软' },
    { name: '适用年龄', value: '3-8周岁' },
  ],
})

console.log(`\n===== 结果（confirm=${CONFIRM}） =====`)
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : (result.needConfirm ? 2 : 1))
