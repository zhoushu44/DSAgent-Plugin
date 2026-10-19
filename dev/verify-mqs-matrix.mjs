#!/usr/bin/env node
/**
 * verify-mqs-matrix.mjs —— 复验 docs/mqs-publish-platform-matrix.md 里登记的全部字符偏移坐标。
 *
 * 背景：该文档的每条结论都挂在「觅千手 v5.61」压缩包 `_gm.js`（单行 ~5.83M 字符）
 * 的字符偏移上。压缩产物没有行号语义，只能按字符偏移切片复读，因此坐标本身
 * 必须可被机器复验，否则文档一过期就无人能判断「是平台改版还是提取过时」。
 *
 * 用法：
 *   node dev/verify-mqs-matrix.mjs            # 有源镜像则逐条断言；无源镜像则整体 SKIP
 *   node dev/verify-mqs-matrix.mjs --src <path/to/_gm.js>
 *
 * 退出码：0 = 全部通过或整体跳过；1 = 有断言失败。
 *
 * 源镜像不在本仓库内（第三方扩展的只读副本，不入库），因此本脚本
 * 只依赖一个路径：默认读环境变量 MQS_GM_PATH，其次回落到下列已知位置。
 */
import fs from 'node:fs'
import path from 'node:path'

const CANDIDATES = [
  process.env.MQS_GM_PATH,
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js',
].filter(Boolean)

const argv = process.argv.slice(2)
const argIdx = argv.indexOf('--src')
const explicit = argIdx >= 0 ? argv[argIdx + 1] : null

function pickSource() {
  if (explicit) return fs.existsSync(explicit) ? explicit : null
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p } catch { /* 无权限/盘符不存在，继续找下一个 */ }
  }
  return null
}

const srcPath = pickSource()
if (!srcPath) {
  console.log('[SKIP] 未找到 _gm.js 源镜像（设置 MQS_GM_PATH 或用 --src 指定）。')
  console.log('       本脚本的全部断言依赖该文件，缺失时无法复验坐标；文档结论不受影响。')
  process.exit(0)
}

const GM = fs.readFileSync(srcPath, 'utf8')
console.log(`源镜像：${srcPath}`)
console.log(`字符数：${GM.length}（文档登记 5,832,042）\n`)

let pass = 0
let fail = 0

/** 断言 offset 处切片（去掉换行）包含给定 needle。 */
function at(label, offset, needle, span = 400) {
  const slice = GM.slice(offset, offset + span)
  const flat = slice.replace(/\s+/g, '')
  const want = needle.replace(/\s+/g, '')
  if (flat.includes(want)) {
    console.log(`  ✓ ${label} @${offset}`)
    pass++
  } else {
    console.log(`  ✗ ${label} @${offset}`)
    console.log(`      期望包含: ${needle}`)
    console.log(`      实际切片: ${slice.slice(0, 160).replace(/\n/g, '⏎')}`)
    fail++
  }
}

/** 断言某个 needle 在全文首次出现的位置等于 offset。 */
function firstAt(label, offset, needle) {
  const idx = GM.indexOf(needle)
  if (idx === offset) {
    console.log(`  ✓ ${label} 首次出现 @${offset}`)
    pass++
  } else {
    console.log(`  ✗ ${label} 期望首次出现 @${offset}，实际 @${idx}`)
    fail++
  }
}

/** 断言 needle 全文存在（位置不敏感，用于常量/字段名）。 */
function present(label, needle) {
  if (GM.includes(needle)) {
    console.log(`  ✓ ${label} 存在`)
    pass++
  } else {
    console.log(`  ✗ ${label} 未找到: ${needle}`)
    fail++
  }
}

console.log('[1] L2 注册表：平台中文名表与域名表')
at('平台中文名表起点', 392304, 'taobao:"淘宝"')
at('pinduoduo 域名表', 392510, 'mms.pinduoduo.com')
at('douyin/jd/xhs 域名表', 392949, 'wares-jdm.jd.com')
at('1688 三子域', 393029, 'offer-new.1688.com')
at('闲鱼 hosts', 393099, 'goofish.com')
at('闲鱼 pathIncludes=/publish', 393129, '/publish')

console.log('\n[2] 主机名/路径/组合三个判定函数')
at('主机名后缀匹配', 393581, 'endsWith')
at('路径包含匹配', 393743, 'indexOf')

console.log('\n[3] L4 字段填充：transformRequestBody 四步流水线')
at('transformRequestBody 定义', 912763, 'transformRequestBody')
at('四步调用点', 913216, 'fillImageData')
at('fillImageData', 913599, 'fillImageData')
at('fillSkuPriceData', 914335, 'fillSkuPriceData')
at('fillShippingConfig', 922380, 'fillShippingConfig')
at('applyPddElecGoodsAttributes', 912064, 'elec_goods_attributes')

console.log('\n[4] SKU 价格矩阵相关辅助函数')
at('buildStablePriceDetailForFill', 781534, 'buildStablePriceDetailForFill')
at('getPddStockMode', 718934, 'getPddStockMode')
at('fillNoSpecSkuPriceDataInRequest', 722502, 'fillNoSpecSkuPriceDataInRequest')

console.log('\n[5] 拼多多专有字段（字段名级断言）')
for (const f of ['cost_template_id', 'is_default_template_id', 'shipment_limit_second', 'two_pieces_discount', 'out_goods_sn', 'price_detail', 'stock_mode']) {
  present(`字段 ${f}`, f)
}

console.log('\n[6] 其它锚点')
at('包内 cdnHost 兜底', 329503, 'cdnHost')
at('postMessage 消息监听器', 664431, 'pdd_transform_request')
at('IndexedDB 前缀表', 358985, 'goods_manager_product_')

console.log('\n[7] 一致性：文档声称 8 个 publisher 共用同一份产物')
const remoteCfg = path.join(path.dirname(srcPath), '_remote-config.json')
if (fs.existsSync(remoteCfg)) {
  const cfg = JSON.parse(fs.readFileSync(remoteCfg, 'utf8'))
  const mods = cfg.modules || []
  const sharing = mods.filter(m => JSON.stringify(m.remoteScripts || []).includes('dist2/goods_manager/js/index.js'))
  if (sharing.length === 8) {
    console.log(`  ✓ 共 ${sharing.length} 个模块的 remoteScripts 指向同一份 index.js`)
    pass++
  } else {
    console.log(`  ✗ 期望 8 个模块共用产物，实际 ${sharing.length} 个：${sharing.map(m => m.name).join(', ')}`)
    fail++
  }
} else {
  console.log('  - 跳过（同目录无 _remote-config.json）')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
