/**
 * 拼多多上架验证脚本（统一商品数据 → 拼多多商家后台）。
 *
 * 用法：
 *   node dev/publish-pdd2.mjs                     # dry-run（只解析 + 打印映射，不执行）
 *   node dev/publish-pdd2.mjs --confirm           # 真实提交（弹出 Chrome、实际发布商品）
 *   node dev/publish-pdd2.mjs --confirm --mode2   # 模式2：图片 HTTP 预上传 + 提交体改包重放
 *   node dev/publish-pdd2.mjs --product <file>    # 用统一 product JSON 文件替代内置示例
 *   node dev/publish-pdd2.mjs --account <shopKey> # 显式指定账号（否则走账号选择链）
 *
 * 默认示例演示**二维规格矩阵**（颜色 × 尺码 = 4 个 SKU）。
 * 图片取自 skills/pdd-link-matrix/assets/src（真实素材）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const CONFIRM = process.argv.includes('--confirm')
const MODE2 = process.argv.includes('--mode2')
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? i + 1 < process.argv.length ? process.argv[i + 1] : undefined : undefined
}

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { parseProduct, validateProduct } = await import('../lib/services/product-schema.js')
const { pddPublish2, toPddOptions } = await import('../lib/pdd-publish2.js')

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const img = (n) => join(SRC, n)

// ── 内置示例：颜色(2) × 尺码(2) 二维矩阵 ──
const demoProduct = {
  title: '秋冬新款儿童宽松睡衣 摇粒绒卡通家居服套装（上架2验证）',
  images: [img('main_06.jpg'), img('main_07.jpg'), img('main_08.jpg')],
  detailImages: [img('detail_10.jpg'), img('detail_11.jpg'), img('detail_12.jpg')],
  category: '童装 套装',
  price: '79.9',
  stock: '1000',
  specs: [
    { name: '颜色', values: [
      { value: '格蕾灰', image: img('main_06.jpg') },
      { value: '奶油黄', image: img('main_07.jpg') },
    ] },
    { name: '尺码', values: [{ value: '110cm' }, { value: '120cm' }] },
  ],
  skus: [
    { specs: { 颜色: '格蕾灰', 尺码: '110cm' }, price: '49.9', stock: '1000' },
    { specs: { 颜色: '格蕾灰', 尺码: '120cm' }, price: '49.9', stock: '1000' },
    { specs: { 颜色: '奶油黄', 尺码: '110cm' }, price: '49.9', stock: '1000' },
    { specs: { 颜色: '奶油黄', 尺码: '120cm' }, price: '49.9', stock: '1000' },
  ],
  attributes: [{ name: '主面料成分', value: '棉' }],
}

const productFile = argOf('--product')
const raw = productFile ? readFileSync(productFile, 'utf-8') : demoProduct

// ── 1. 解析 + 校验（不触网、不启浏览器）──
const parsed = parseProduct(raw)
if (parsed.error || !parsed.product) {
  console.error(`✗ 解析失败：${parsed.error}`)
  process.exit(1)
}
const invalid = validateProduct(parsed.product)
if (invalid) {
  console.error(`✗ 校验未通过：${invalid}`)
  process.exit(1)
}
console.log('===== 统一数据解析结果 =====')
console.log(JSON.stringify(parsed.product, null, 2))

const account = argOf('--account')
const extra = { product: raw, confirm: CONFIRM }
if (account) extra.account = account
if (MODE2) {
    extra.mode2 = true
    // ★ 规格池（规格值→spec_id）：从 workspace 的 spec-pool.json 读，供改包行数重建用。
    //   采集脚本：artifacts/collect_spec_pool.mjs
    const poolPaths = [
        'artifacts/pdd-re/spec-pool.json',
        join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', '童装', 'artifacts', 'pdd-re', 'spec-pool.json'),
    ]
    for (const pp of poolPaths) {
        if (!existsSync(pp))
            continue
        try {
            const poolJson = JSON.parse(readFileSync(pp, 'utf8'))
            const specIds = {}
            for (const vals of Object.values(poolJson.pool || {})) {
                for (const [v, rec] of Object.entries(vals)) {
                    specIds[v] = { spec_id: rec.spec_id, parent_id: rec.parent_spec_id }
                }
            }
            extra.specIds = specIds
            console.log(`规格池已加载：${Object.keys(specIds).length} 个规格值（${pp}）`)
        }
        catch (e) {
            console.log(`规格池读取失败（${pp}）：${e.message}`)
        }
        break
    }
}
console.log('\n===== 映射为拼多多发布选项 =====')
console.log(JSON.stringify(toPddOptions(parsed.product, extra), null, 2))

// ── 2. 调 pddPublish2（dry-run 只出预览；--confirm 才真正提交）──
const result = await pddPublish2(
  new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json')),
  extra,
)

console.log(`\n===== 结果（confirm=${CONFIRM}） =====`)
console.log(JSON.stringify(result, null, 2))
// 退出码：0=已发布；2=需要用户动作（预览 needConfirm / 需选账号 need_account_choice），非错误；1=真失败
const needsUser = result.needConfirm === true || result.failureKind === 'need_account_choice'
process.exit(result.ok ? 0 : (needsUser ? 2 : 1))
