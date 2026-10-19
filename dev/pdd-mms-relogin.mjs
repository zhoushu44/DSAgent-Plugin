/**
 * 终端侧拼多多商家后台（pdd_mms）重登脚本 —— 真机验收辅助。
 *
 * 用法：node dev/pdd-mms-relogin.mjs [shopKey 子串]
 *   不传参数 → 重新登录第一个 pdd_mms 账号（按凭证库顺序）
 *   传子串   → 精确锁定要刷新的账号（如 3b422bc）
 *
 * 做什么：
 *   复用 lib/browser-login.js 的 doBrowserLogin（生产登录内核）：
 *     1. 启动 Chrome（账号专属 Profile，设备身份延续）
 *     2. 打开 https://mms.pinduoduo.com/login
 *     3. 等用户扫码（窗口保持打开，有活动续时）
 *     4. Cookie 轮询 → store.save(replaceShopKey) 替换旧条目并继承绑定
 *
 * 依赖：npm run build:host（lib/ 编译产物）。
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, ''), '..', 'lib')
const libImport = (rel) => import(pathToFileURL(join(LIB, rel)).href)

const filter = process.argv[2] || ''

const { CredentialStore } = await libImport('services/credential-store.js')
const { doBrowserLogin } = await libImport('browser-login.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const all = store.listAccounts().filter(a => a.platform === 'pdd_mms')
if (!all.length) {
  console.error('❌ 凭证库中没有 pdd_mms 账号')
  process.exit(1)
}
const target = filter ? all.find(a => String(a.shop_key || '').includes(filter)) : all[0]
if (!target) {
  console.error(`❌ 没有匹配「${filter}」的 pdd_mms 账号。现有：`)
  for (const a of all) console.error(`   ${a.shop_key}（${a.status}）`)
  process.exit(1)
}

console.log(`重登账号：${target.shop_key}（当前状态：${target.status}）`)
console.log('即将打开浏览器登录页，请在窗口内扫码完成拼多多商家后台登录…')
console.log('（窗口保持打开，完成扫码后自动保存凭证并关闭）')

const res = await doBrowserLogin('pdd_mms', 'https://mms.pinduoduo.com/login', store, {
  replaceShopKey: target.shop_key,
})

if (res.ok) {
  console.log(`\n✅ ${res.text || '登录成功'}`)
  console.log(`   shopKey=${res.shopKey} accountId=${res.accountId}`)
  process.exit(0)
}
console.error(`\n❌ 登录未完成：${res.error || '未知错误'}`)
process.exit(1)
