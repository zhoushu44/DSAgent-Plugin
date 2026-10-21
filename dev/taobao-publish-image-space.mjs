/**
 * 淘宝上架「逆向 HTTP 图片上传 + 觅千手 replay」端到端真机验证（单条）。
 *
 * 用法：
 *   node dev/taobao-publish-image-space.mjs                    # 预览（不启浏览器，零副作用）
 *   node dev/taobao-publish-image-space.mjs --confirm          # 真实发布 1 条
 *   node dev/taobao-publish-image-space.mjs --confirm --no-space  # 对照：关掉逆向上传走 DOM
 *   node dev/taobao-publish-image-space.mjs --keyword=儿童裤子 --confirm
 *
 * 前置：npm run build:host
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const CONFIRM = process.argv.includes('--confirm')
const NO_SPACE = process.argv.includes('--no-space')
const argOf = (n) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))

let account = argOf('account')
if (!account) {
  const valid = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')
  account = valid[0]?.shop_key
}
if (!account) { console.error('没有 valid 的淘宝账号'); process.exit(1) }
console.log('使用账号：', account)

// ── 素材：与批量脚本同一批（pdd-link-matrix/assets/src）──
const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src')
const MAIN = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg', 'main_09.jpg', 'main_10.jpg']
const DETAIL = ['detail_10.jpg', 'detail_11.jpg', 'detail_12.jpg', 'detail_13.jpg', 'detail_14.jpg',
  'detail_15.jpg', 'detail_16.jpg', 'detail_17.jpg', 'detail_18.jpg', 'detail_19.jpg',
  'detail_20.jpg', 'detail_21.jpg']
for (const n of [...MAIN, ...DETAIL]) {
  if (!existsSync(join(SRC, n))) { console.error('缺素材：', join(SRC, n)); process.exit(1) }
}

const keyword = argOf('keyword') || '儿童裤子'
const stamp = String(Date.now()).slice(-6)
// --direct 时直达发布页（跳过选类目）：实测属性区完整渲染，必填可填
const DIRECT = process.argv.includes('--direct')
const CAT = argOf('cat') || '50013618'

const t0 = Date.now()
const result = await taobaoPublish(store, {
  channel: 'taobao',
  title: '秋冬儿童休闲长裤摇粒绒加绒男童女童运动家居裤',
  price: '59.9',
  stock: '1000',
  itemNo: `IMGSPACE-${stamp}`,
  images: MAIN.map((n) => join(SRC, n)),
  detailImages: DETAIL.map((n) => join(SRC, n)),
  categoryKeyword: keyword,
  ...(DIRECT ? { directPublishUrl: `https://item.upload.taobao.com/sell/v2/publish.htm?catId=${CAT}` } : {}),
  attributes: [
    { name: '裤长', value: '100-140cm' },
    { name: '裤型', value: '休闲长裤' },
    { name: '裤子分类', value: '九分裤' },
    { name: '适用年龄', value: '3岁' },
    { name: '适用性别', value: '男女通用' },
    { name: '产地', value: '中国大陆' },
  ],
  skus: [
    { name: '格蕾灰', price: '59.9', stock: '500' },
    { name: '奶油黄', price: '59.9', stock: '500' },
  ],
  // ★ 被测能力：逆向 HTTP 图片空间预上传（默认开，这里显式传便于对照）
  imageSpaceUpload: !NO_SPACE,
  imageSpaceConcurrency: 3,
  account,
  confirm: CONFIRM,
})

console.log(`\n===== 结果（${Date.now() - t0}ms）=====`)
console.log('ok =', result.ok, ' needConfirm =', result.needConfirm, ' failureKind =', result.failureKind || '')
console.log(result.text || '')
process.exit(result.ok ? 0 : 1)
