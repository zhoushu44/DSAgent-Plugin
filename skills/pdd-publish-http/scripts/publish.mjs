/**
 * 拼多多商品上架（HTTP 逆向模式）—— 技能入口脚本
 *
 * 链路（实测 2026-10-21 跑通，真实上架验证）：
 *   ① HTTP  图片预上传（主图/详情图/SKU预览图）→ CDN URL
 *   ② 本地 规格池（spec-pool.json：规格值 → spec_id）
 *   ③ 页面 点「发布新商品」→ 拿 goods_commit_id / goods_id（URL 参数）
 *   ④ 页面 选类目并确认（会话注册）
 *   ⑤ 页面 DOM 石填：标题 + 1 张主图（过页面「轮播图不能为空」校验）
 *   ⑥ 页面 点「提交并上架」→ 拦截 goodsCommit/action/edit
 *          → 改包（注入 gallery 8 张 + skus 8 行矩阵 + spec_id + 预览图 + 价格库存）
 *          → abort 原请求 → 页面 fetch 带 Anti-Content 签名重放
 *   ⑦ 页面 fetch 调 /glide/v2/mms/edit/commit/submit（确认上架，6 字段）
 *
 * 为什么必须借页面：Anti-Content 签名由页面风控 SDK（fbeZ 模块）采集真实浏览器
 * 行为生成，Node 侧算不出；且提交会话（commit_id）需页面注册。但**所有数据传输
 * （图片/规格/价格/SKU/提交体）全部 HTTP 化**，DOM 只负责过校验的最小石填。
 *
 * 用法：
 *   node scripts/publish.mjs --product-file <json> [--confirm true] [--account <shopKey>]
 *
 * 输出协议：dsagent-result（__DSAGENT_RESULT__ 前缀 + ---[OUTPUT_FILES] 标记）
 */
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { homedir } from 'node:os'

const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const PLUGIN_ROOT = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'

// ─── 参数解析 ───
const argOf = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const productFile = argOf('product-file')
const productStr = argOf('product')
const confirm = hasFlag('confirm') && argOf('confirm') !== 'false'
const account = argOf('account')

const emit = (obj) => {
  process.stdout.write('__DSAGENT_RESULT__' + JSON.stringify(obj) + '\n')
}

if (!productFile && !productStr) {
  emit({ ok: false, failureKind: 'api_error', text: '缺少 --product-file 或 --product 参数。' })
  process.exit(2)
}

// ─── 1. 读取商品数据 ───
let raw = ''
try {
  raw = productFile ? fs.readFileSync(productFile, 'utf8') : productStr
} catch (e) {
  emit({ ok: false, failureKind: 'api_error', text: `读取商品文件失败：${e.message}` })
  process.exit(2)
}

// 校验必填
let parsed = null
try {
  parsed = JSON.parse(raw)
} catch (e) {
  emit({ ok: false, failureKind: 'api_error', text: `product 不是合法 JSON：${e.message}` })
  process.exit(2)
}
if (!parsed.title || !Array.isArray(parsed.images) || parsed.images.length === 0) {
  emit({ ok: false, failureKind: 'api_error', text: 'product 缺少必填字段：title 或 images（至少 1 张本地图片绝对路径）。' })
  process.exit(2)
}

// ─── 2.5 前置处理（图片规整 + 品牌默认 + spec_id 借位）───
// ★ 2026-10-26 补：解决三类实测驳回/失败
//    ① 详情图尺寸不合规 → 自动压缩；外部超长整图 → 拆成合规单图
//    ② 品牌未指定 → 自动填「无」
//    ③ 新规格值没有 spec_id → 借池里现成 id（显示名保持我们的）
let pre = { main: parsed.images, detail: parsed.detailImages || [], spec: [], actions: [] }
try {
  const { prepImages, ensureBrand } = await import('./preflight.mjs')
  parsed = ensureBrand(parsed)
  pre = prepImages(parsed, { scriptDir: path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')) })
  if (pre.actions.length) {
    console.log(`[pdd-publish-http] 图片规整 ${pre.actions.length} 处：`)
    for (const a of pre.actions) console.log(`  ${a.file}: ${a.action} ${a.before} → ${a.after}`)
  }
  // 用规整后的图片路径回填（切分后张数会变）
  parsed.images = pre.main
  if (parsed.detailImages) parsed.detailImages = pre.detail
  // 规格预览图路径同步（切分不影响它们，但补白后路径不变）
  raw = JSON.stringify(parsed)
} catch (e) {
  console.log(`[pdd-publish-http] 前置处理异常（继续）：${e?.message || e}`)
}
// 图片存在性 + 大小校验（≤3MB，与平台一致）
for (const p of parsed.images) {
  // 绝对路径判定：Windows 盘符（C:\ 或 C:/）或 POSIX（/...）；两种斜杠都认
  if (!/^([a-zA-Z]:[\\/]|\/)/.test(p)) {
    emit({ ok: false, failureKind: 'api_error', text: `images 必须为本机绝对路径：${p}` })
    process.exit(2)
  }
  if (!fs.existsSync(p)) {
    emit({ ok: false, failureKind: 'api_error', text: `图片文件不存在：${p}` })
    process.exit(2)
  }
  const sz = fs.statSync(p).size
  if (sz > 3 * 1024 * 1024) {
    emit({ ok: false, failureKind: 'api_error', text: `图片超过 3MB：${p}（${(sz / 1024 / 1024).toFixed(2)}MB）` })
    process.exit(2)
  }
}

// ─── 2. 规格池定位（workspace 优先，其次技能 assets） ───
const poolCandidates = [
  path.join(process.cwd(), 'artifacts', 'pdd-re', 'spec-pool.json'),
  path.join(process.cwd(), 'spec-pool.json'),
  path.join(PLUGIN_ROOT, 'skills', 'pdd-publish-http', 'assets', 'spec-pool.json'),
  'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pdd-re/spec-pool.json',
]
let specPool = null
for (const c of poolCandidates) {
  if (fs.existsSync(c)) {
    try {
      specPool = JSON.parse(fs.readFileSync(c, 'utf8'))
      console.log(`[pdd-publish-http] 规格池已加载：${c}（${Object.keys(specPool.pool || {}).length} 个维度）`)
      break
    } catch { /* 下一个 */ }
  }
}
if (!specPool) {
  console.log('[pdd-publish-http] 未找到规格池，将不带 spec_id 提交（平台按 spec_value 自解析）')
}

// ─── 3. 预览 or 确认 ───
if (!confirm) {
  const dims = (parsed.specs || []).map(d => `${d.name}（${d.values.length} 个值：${d.values.map(v => v.value).join('/')}）`)
  const skuRows = parsed.skus || []
  const text = [
    '【拼多多上架预览 · 需用户确认】',
    `标题：${parsed.title}`,
    `类目：${parsed.category || '（从标题推断）'}`,
    `主图：${parsed.images.length} 张`,
    `详情图：${(parsed.detailImages || []).length} 张`,
    dims.length ? `规格维度：${dims.join('；')}` : '规格：无（单 SKU）',
    skuRows.length ? `SKU 组合：${skuRows.length} 行` : '',
    skuRows.length ? skuRows.slice(0, 8).map(r => `  - ${Object.entries(r.specs || {}).map(([k, v]) => `${k}=${v}`).join(' / ')}：拼单价 ${r.price ?? parsed.price ?? '—'} / 库存 ${r.stock ?? parsed.stock ?? '1000'}`).join('\n') : '',
    specPool ? `规格池：已加载（${Object.keys(specPool.pool || {}).reduce((n, k) => n + Object.keys(specPool.pool[k]).length, 0)} 个规格值）` : '规格池：未找到',
    pre.actions.length ? `图片规整：${pre.actions.length} 处（${pre.actions.map(a => `${a.file}→${a.action}`).join('；')}）` : '图片规整：全部合规，无需处理',
    (parsed.attributes || []).length ? `商品属性：${(parsed.attributes || []).map(a => `${a.name}=${a.value}`).join(' / ')}` : '',
    '',
    '执行链路：HTTP 上传全部图片 → 拦截提交包改包（SKU + 预览图）→ 页面签名重放 → commit/submit 确认上架',
    '品牌已默认填「无」；商品资质仍需在弹出的浏览器窗口内人工补全。',
    '',
    '确认无误后请带 --confirm true 重新调用。注意：发布是不可撤销的真实操作（L2）。',
  ].filter(Boolean).join('\n')
  emit({ ok: false, needConfirm: true, text })
  process.exit(0)
}

// ─── 4. 真实发布（调插件 lib） ───
try {
  // ★ 2026-10-24 补：前置账号检查（冷却中/健康分过低 → 不发请求）
  const { checkAccountUsable } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-error.mjs`)
  const store0 = new (await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)).CredentialStore(
    path.join(homedir(), '.dsh', 'dsagent-accounts.json'))
  const mmsAccs = store0.listAccounts().filter(a => a.platform === 'pdd_mms' && a.cookies?.['PASS_ID'])
  const shopKey0 = account || mmsAccs.slice(-1)[0]?.shop_key
  if (shopKey0) {
    const chk = await checkAccountUsable(shopKey0, '商品发布')
    if (chk.blocked) {
      emit({ ok: false, failureKind: chk.failureKind, shopKey: shopKey0, text: chk.text })
      process.exit(2)
    }
  }

  const { pddPublish2 } = await import(`file:///${PLUGIN_ROOT}/lib/pdd-publish2.js`)
  const extra = { product: raw, confirm: true, mode2: true }
  if (account)
    extra.account = account
  // ★ 规格解析 v3（2026-10-26）：自由维度 + 字典维度
  //   自由维度（款式/型号/容量/尺寸等）→ 值原样提交，parent_spec_id 从 dim-parent.json 取
  //   字典维度（颜色分类/参考分类）→ 必须命中 spec-pool，否则中止
  // ★ 规格解析 v3（2026-10-27）：所有维度都走 DOM 填规格，值写什么就是什么
  //   颜色分类/参考分类 → 页面上有输入框/checkbox，直接填
  //   款式/型号 → 页面上没有就点「添加规格类型」创建
  //   ❌ 废弃：borrowSpecIds（借位会让平台还原成别人的名字）
  try {
    const { resolveSpecs } = await import('./spec-resolve.mjs')
    const r = resolveSpecs(parsed, specPool?.pool || {})
    for (const n of r.notes) console.log('[pdd-publish-http] ' + n)

    // ★ DOM 填规格：全部维度（预置的直接填，没有的添加规格类型）
    const { fillSpecsOnPage } = await import('./dom-fill-spec.mjs')
    const domSpecs = (parsed.specs || [])
      .filter(d => d && d.name && Array.isArray(d.values) && d.values.length)
      .map(d => ({
        name: d.name,
        values: d.values.map(v => (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()).filter(Boolean)
      }))
      .filter(d => d.values.length)
    if (domSpecs.length) {
      // ★ 构建预览图映射：规格值 → 本地图片路径（从商品 JSON 的 specs[].values[].image）
      const thumbMap = {}
      for (const d of (parsed.specs || [])) {
        for (const v of (d.values || [])) {
          const val = (v && typeof v === 'object') ? String(v.value ?? '').trim() : String(v ?? '').trim()
          const img = (v && typeof v === 'object') ? v.image : null
          if (val && img && typeof img === 'string' && fs.existsSync(img)) thumbMap[val] = img
        }
      }
      extra.domFillSpecs = async (page) => {
        console.log('[pdd-publish-http] DOM 填规格开始')
        const result = await fillSpecsOnPage(page, domSpecs, {
          price: parsed.price || '29.9',
          stock: parsed.stock || '999',
          fillPriceTable: false,
          fillRefPrice: false,
          thumbMap,
        })
        console.log('[pdd-publish-http] DOM 填规格结果: ' + result.message)
        return result
      }
      console.log('[pdd-publish-http] DOM 填规格已挂载: ' + domSpecs.length + ' 维度 → ' +
        domSpecs.map(d => d.name + '(' + d.values.length + ')').join(', ') +
        (Object.keys(thumbMap).length ? '，预览图 ' + Object.keys(thumbMap).length + ' 个' : '（无预览图）'))
    }
  } catch (e) {
    console.log('[pdd-publish-http] 规格解析异常（继续）：' + (e?.message || e))
  }
  const result = await pddPublish2(
    new (await import(`file:///${PLUGIN_ROOT}/lib/services/credential-store.js`)).CredentialStore(
      path.join(homedir(), '.dsh', 'dsagent-accounts.json')),
    extra,
  )
  // ★ 记账号健康分（成功/失败都记）
  if (shopKey0) {
    try {
      const { recordToAntiban } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-error.mjs`)
      await recordToAntiban(shopKey0, result?.ok ? 1000000 : null, result?.ok ? 'ok' : null)
    } catch { /* ignore */ }
  }
  emit({
    ok: !!result?.ok,
    failureKind: result?.failureKind,
    shopKey: result?.shopKey,
    finalUrl: result?.finalUrl,
    text: result?.text || (result?.ok ? '发布成功' : '发布失败（无详细信息）'),
  })
  process.exit(result?.ok ? 0 : 1)
} catch (e) {
  // ★ 错误归一（detached Frame = 风控关页面）
  try {
    const { normalizeError, recordToAntiban } = await import(`file:///${PLUGIN_ROOT}/skills/_shared/pdd-error.mjs`)
    const n = normalizeError(e, '商品发布')
    if (account) await recordToAntiban(account, null, n.failureKind === 'risk_control' ? 'captcha' : null).catch(() => {})
    emit({ ok: false, failureKind: n.failureKind, text: n.text })
    process.exit(2)
  } catch { /* ignore */ }
  emit({ ok: false, failureKind: 'api_error', text: `发布异常：${e?.message || String(e)}` })
  process.exit(1)
}
