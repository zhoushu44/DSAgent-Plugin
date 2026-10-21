/**
 * 淘宝发布页 window.Json 结构诊断（零风险：走主流程 diagDumpJson，到表单页 dump 结构后不点提交）。
 * 复用主流程完整链路（选类目→新标签页→表单就绪），只把最后「上传主图+填表+提交」换成 dump。
 * 用法：node dev/diag-taobao-json.mjs [--account=shop_key] [--category=儿童睡衣]
 * 产出：dev/.ui-shots/taobao-json-dump.json + taobao-json-dump.png
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const argOf = (n) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : undefined }

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
let account = argOf('account')
if (!account) account = store.listAccounts().find((a) => a.platform === 'taobao' && a.status === 'valid')?.shop_key
if (!account) { console.error('无 valid 淘宝账号'); process.exit(1) }
const categoryKeyword = argOf('category') || '儿童睡衣'
const useReplay = process.argv.includes('--replay')

// 复用 pdd-link-matrix 素材图
const img = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src', 'main_06.jpg')

console.log(`账号=${account} 类目词=${categoryKeyword}`)
const result = await taobaoPublish(store, {
  images: [img],
  title: '诊断专用-勿提交',
  price: '99.9',
  stock: '10',
  itemNo: 'DIAG-001',
  categoryKeyword,
  confirm: false, // diagDumpJson 模式下 confirm 无意义，但显式 false 防御
  diagDumpJson: true,
  replayMode: useReplay,
  account,
})

console.log('\n=== 结果 ===')
console.log('ok=', result.ok, 'failureKind=', result.failureKind)
console.log(result.text)
process.exit(result.ok ? 0 : 1)
