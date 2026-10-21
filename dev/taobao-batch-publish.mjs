/**
 * 淘宝批量发布实测：3 个类目 × 每类 10 次（对齐拼多多实测口径）。
 *
 * 用法：
 *   node dev/taobao-batch-publish.mjs                        # dry-run（30 条预览，不启浏览器）
 *   node dev/taobao-batch-publish.mjs --confirm              # 真实发布（30 次依次提交）
 *   node dev/taobao-batch-publish.mjs --confirm --replay     # 走觅千手式 Json/Json2 劫持重放
 *   node dev/taobao-batch-publish.mjs --account=taobao_xxx   # 指定账号
 *   node dev/taobao-batch-publish.mjs --only=0               # 只跑第 0 个类目（调试用）
 *
 * 前置：npm run build:host 产出 lib/。账号库 AES 加密，用 CredentialStore 现场解析。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const CONFIRM = process.argv.includes('--confirm')
const REPLAY = process.argv.includes('--replay')
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { taobaoPublish } = await import('../lib/taobao-publish.js')

const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))

// ── 账号解析 ──
const tbAccounts = store.listAccounts().filter((a) => a.platform === 'taobao')
console.log('===== 账号库里的淘宝账号 =====')
for (const a of tbAccounts) console.log(`  ${a.shop_key}  (${a.display_label})  ${a.status}`)
let account = argOf('account')
if (!account) {
  const valid = tbAccounts.filter((a) => a.status === 'valid')
  account = valid[0]?.shop_key
  if (account) console.log(`\n未指定 --account，自动选用第一个 valid 账号：${account}`)
}
if (!account) {
  console.error('\n没有可用的淘宝账号（valid）。请先在「账号连接」页登录淘宝。')
  process.exit(1)
}

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const img = (n) => join(SRC, n)
// 多主图 5 张（main_06~10）+ 详情图 12 张（detail_10~21）
const MAIN_IMGS = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg', 'main_09.jpg', 'main_10.jpg']
const DETAIL_IMGS = ['detail_10.jpg', 'detail_11.jpg', 'detail_12.jpg', 'detail_13.jpg', 'detail_14.jpg',
  'detail_15.jpg', 'detail_16.jpg', 'detail_17.jpg', 'detail_18.jpg', 'detail_19.jpg', 'detail_20.jpg', 'detail_21.jpg']
for (const n of [...MAIN_IMGS, ...DETAIL_IMGS]) {
  if (!existsSync(img(n))) { console.error(`缺素材：${img(n)}`); process.exit(1) }
}

// ── COS URL 模式（复刻觅千手搬品：图片走 replay URL 注入，跳过 DOM 上传）──
//   先跑 dev/upload-to-cos.mjs 把素材传 COS 生成 cos-urls.json。存在即启用 URL 模式。
const COS_URLS_FILE = join('dev', '.ui-shots', 'cos-urls.json')
let COS_MAIN = [], COS_DETAIL = []
if (existsSync(COS_URLS_FILE)) {
  try {
    const j = JSON.parse(readFileSync(COS_URLS_FILE, 'utf8'))
    COS_MAIN = Array.isArray(j.main) ? j.main : []
    COS_DETAIL = Array.isArray(j.detail) ? j.detail : []
    if (COS_MAIN.length) console.log(`COS URL 模式：主图×${COS_MAIN.length}，详情图×${COS_DETAIL.length}（replay URL 注入）`)
  } catch (e) { console.error('cos-urls.json 解析失败：', e.message) }
}
const USE_COS = COS_MAIN.length > 0

// ── 3 个类目 × 每类 10 次 ──
// ★ 2026-10-20 实测选定：三个类目均无「材质成分」复合表必填（睡衣/卫衣/T恤都有，按
//   「不写类目特化」既定决策不自动填，已避开）。儿童套装语义对齐拼多多实测「童装 套装」。
const CATEGORIES = [
  { keyword: '儿童套装', title: '秋冬儿童宽松套装摇粒绒卡通男童女童家居两件套',
    price: '79.9', attributes: [
      { name: '产地', value: '中国大陆' },
    ] },
  { keyword: '儿童裤子', title: '秋冬儿童休闲长裤摇粒绒加绒男童女童运动家居裤',
    price: '59.9', attributes: [
      // 值须命中页面真实候选（2026-10-20 实测候选，见 diag-pants2.log / batch-full.log）
      { name: '裤长', value: '100-140cm' },      // 候选为尺寸段（100-140cm/100cm/...），非「长裤」
      { name: '裤型', value: '休闲长裤' },        // 候选：休闲长裤/卫裤/打底裤/...
      { name: '裤子分类', value: '九分裤' },      // 候选：七分裤/中裤/九分裤/...
      { name: '适用年龄', value: '3岁' },         // 候选为单值年龄（3岁/4岁/...），非「3-8周岁」
      { name: '适用性别', value: '男女通用' },    // 候选：女/女童/男童/男/男女通用
      { name: '产地', value: '中国大陆' },
    ],
    // 儿童裤子「销售属性*」必填：淘宝 SKU = 一项一个规格值（TaobaoSkuInput.name），
    // 非拼多多二维 specs 矩阵。给 2 个颜色规格值。
    skus: [
      { name: '格蕾灰', price: '59.9', stock: '500' },
      { name: '奶油黄', price: '59.9', stock: '500' },
    ] },
  { keyword: '儿童连衣裙', title: '春秋儿童连衣裙卡通印花女童公主裙洋气裙子',
    price: '69.9', attributes: [
      // 值须命中页面真实候选（2026-10-20 实测候选，见 batch-dress-1.log）
      { name: '裙型', value: '碎花裙' },        // 候选：POLO裙/T恤裙/仙女裙/碎花裙/...
      { name: '面料', value: '全棉' },          // 候选：全棉/人棉/...（「棉」不在候选）
      { name: '适用年龄', value: '3岁' },       // 候选为单值年龄（3岁/4岁/...）
      { name: '适用性别', value: '女' },
      { name: '产地', value: '中国大陆' },
    ] },
]
const TIMES = Number(argOf('times') || 10)

const only = argOf('only')
const cats = only != null ? CATEGORIES.slice(Number(only), Number(only) + 1) : CATEGORIES
const jobs = []
for (const c of cats) for (let i = 1; i <= TIMES; i++) jobs.push({ ...c, round: i })

console.log(`\n===== 批量发布计划：${cats.length} 类目 × ${TIMES} 次 = ${jobs.length} 条（confirm=${CONFIRM}，replay=${REPLAY}） =====`)

let ok = 0, fail = 0, needAction = 0
const results = []
for (const [idx, j] of jobs.entries()) {
  const tag = `[${idx + 1}/${jobs.length}] ${j.keyword} #${j.round}`
  console.log(`\n----- ${tag} -----`)
  const t0 = Date.now()
  try {
    const result = await taobaoPublish(store, {
      channel: 'taobao',
      title: j.title, // ★ 标题≤60字符（30汉字），不加批量后缀（批次区分靠 itemNo 货号）
      price: j.price,
      stock: '1000',
      itemNo: `BATCH-${j.keyword}-${String(j.round).padStart(2, '0')}`,
      // 图片：COS URL 模式走 replay 注入（复刻觅千手搬品）；否则本地文件走 DOM 上传
      ...(USE_COS
        ? { imageUrls: COS_MAIN, detailImageUrls: COS_DETAIL }
        : { images: MAIN_IMGS.map(img), detailImages: DETAIL_IMGS.map(img) }),
      categoryKeyword: j.keyword,
      attributes: j.attributes,
      skus: j.skus, // 销售属性必填类目（儿童裤子）的二维规格矩阵
      account,
      confirm: CONFIRM,
      replayMode: REPLAY,
    })
    const ms = Date.now() - t0
    results.push({ tag, ok: result.ok, needConfirm: result.needConfirm, kind: result.failureKind, ms, text: (result.text || '').slice(0, 200) })
    if (result.ok) { ok++; console.log(`✓ 已发布（${ms}ms）${result.itemId ? ` 商品ID=${result.itemId}` : ''}`) }
    else if (result.needConfirm) { needAction++; console.log(`… 预览（${ms}ms）`) }
    else { fail++; console.log(`✗ 失败（${ms}ms）${result.failureKind || ''}：${(result.text || '').slice(0, 160)}`) }
  } catch (e) {
    fail++
    results.push({ tag, ok: false, kind: 'exception', ms: Date.now() - t0, text: String(e?.message || e).slice(0, 200) })
    console.log(`✗ 异常：${String(e?.message || e).slice(0, 160)}`)
  }
  // 真实发布间隔，防风控
  if (CONFIRM && idx < jobs.length - 1) await new Promise((r) => setTimeout(r, 4000))
}

console.log('\n===== 汇总 =====')
console.log(`总数=${jobs.length}  成功=${ok}  预览=${needAction}  失败=${fail}`)
if (fail) {
  console.log('\n失败明细：')
  for (const r of results.filter((x) => !x.ok && !x.needConfirm)) console.log(`  ${r.tag}  [${r.kind}] ${r.text}`)
}
process.exit(fail ? 1 : 0)
