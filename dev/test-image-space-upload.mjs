/**
 * 逆向 HTTP 图片空间上传 —— 端到端实测。
 *
 * 用法：
 *   node dev/test-image-space-upload.mjs                 # 用 refs 里 2 主图 + 3 详情图
 *   node dev/test-image-space-upload.mjs --dir=<dir>     # 指定目录取图
 *   node dev/test-image-space-upload.mjs --account=xxx
 *
 * 前置：npm run build:host（产出 lib/）
 * 产物：dev/.ui-shots/image-space-upload.json
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'

const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { uploadImagesToSpace, checkLoginCookies } = await import('../lib/taobao-image-space.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))

// ── 账号 ──
let account = argOf('account')
if (!account) {
  const valid = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')
  account = valid[0]?.shop_key
  console.log('可用淘宝账号：', valid.map((a) => `${a.shop_key}(${a.display_label})`).join(', '))
}
if (!account) { console.error('没有 valid 的淘宝账号'); process.exit(1) }
const acc = store.get(account)
if (!acc) { console.error('取不到账号：', account); process.exit(1) }
console.log(`\n使用账号：${acc.shop_key}（${acc.display_label}），Cookie ${Object.keys(acc.cookies || {}).length} 项`)
const loginErr = checkLoginCookies(acc.cookies || {})
if (loginErr) console.log('⚠ 登录态自检：', loginErr)

// ── 取图 ──
const DIR = argOf('dir') || join('E:', '360MoveData', 'Users', 'Administrator', 'Desktop', '童装', 'refs')
let files = []
if (existsSync(DIR)) {
  const all = readdirSync(DIR).filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n))
  const main = all.filter((n) => /^[fps]\d/.test(n)).slice(0, 2)
  const detail = all.filter((n) => /^[fps]\d/.test(n)).slice(2, 5)
  files = [...main, ...detail].map((n) => join(DIR, n))
}
if (!files.length) { console.error('没找到测试图：', DIR); process.exit(1) }
console.log(`\n待上传 ${files.length} 张：`)
for (const f of files) console.log('  ' + f)

// ── 上传 ──
const t0 = Date.now()
const results = await uploadImagesToSpace(files, {
  cookies: acc.cookies || {},
  folderId: argOf('folder') || '0',
  concurrency: Number(argOf('concurrency') || 3),
})
const ms = Date.now() - t0

console.log(`\n===== 结果（${ms}ms）=====`)
let ok = 0
for (const r of results) {
  if (r.ok) {
    ok++
    console.log(`✓ ${r.fileName}  ${r.pix}  ${r.size}B  q=${r.quality}`)
    console.log(`    fileId=${r.fileId}`)
    console.log(`    url=${r.url}`)
  } else {
    console.log(`✗ ${r.local}\n    ${r.error}`)
  }
}
console.log(`\n成功 ${ok}/${results.length}`)

mkdirSync(join('dev', '.ui-shots'), { recursive: true })
const out = join('dev', '.ui-shots', 'image-space-upload.json')
writeFileSync(out, JSON.stringify({ account, ms, results }, null, 2))
console.log('已写入', out)

// replay payload 预览（证明 URL 能直接进觅千手文档结构）
const { buildTaobaoJsonDocument } = await import('../lib/taobao-publish-replay.js')
const urls = results.filter((r) => r.ok).map((r) => r.url)
const doc = buildTaobaoJsonDocument({
  title: '测试标题',
  price: '59.9',
  stock: '100',
  images: [],
  skus: [{ name: '格蕾灰', price: '59.9', stock: '50' }],
  imageUrls: urls.slice(0, 5),
  detailImageUrls: urls.slice(5),
})
const fv = doc.models.formValues
console.log('\n===== replay payload 预览 =====')
console.log('mainImagesGroup.images =', JSON.stringify((fv.mainImagesGroup || {}).images))
console.log('wirelessDesc 条数 =', Array.isArray(fv.wirelessDesc) ? fv.wirelessDesc.length : 0)
console.log('desc 前 120 字 =', String(fv.desc || '').slice(0, 120))
process.exit(ok === results.length ? 0 : 1)
