/**
 * test-10cats.mjs — 10 个类目规格测试
 * ★ 不杀 chrome、不关闭浏览器（每个类目单独跑，跑完保留窗口）
 *
 * 用法：
 *   node test-10cats.mjs            → 只打印计划
 *   node test-10cats.mjs --run      → 真跑（会提交上架）
 *   node test-10cats.mjs --run --only 3   → 只跑第 3 个
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const ACCOUNT = 'pdd_mms_5899994461f5ae40c64d9bcf7e30c2a0'
const IMG_DIR = 'E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/ok'
const MAIN_IMG = IMG_DIR + '/D1_雪域哑光·双层中空_1024.jpg'

const args = process.argv.slice(2)
const RUN = args.includes('--run')
const onlyIdx = args.indexOf('--only')
const ONLY = onlyIdx >= 0 ? Number(args[onlyIdx + 1]) : 0

// ══ 10 个类目测试配置
// 每个：[名称, catId, 模板名, specs, skus(只写价格库存，specs 自动补)]
const CASES = [
  {
    n: '1 纸杯(1维-容量)',
    catId: 16675,
    tpl: '纸杯',
    specs: [{ name: '容量', values: ['200', '300', '400'] }],
    skus: [{ m: 9.9, p: 12.9 }, { m: 11.9, p: 14.9 }, { m: 13.9, p: 16.9 }],
  },
  {
    n: '2 T恤(2维-颜色×尺码)',
    catId: 8463,
    tpl: '女装T恤',
    specs: [{ name: '颜色分类', values: ['白色', '黑色'] }, { name: '尺码', values: ['M', 'L', 'XL'] }],
    skus: [{ m: 29.9, p: 39.9 }],
  },
  {
    n: '3 连衣裙(2维)',
    catId: 8477,
    tpl: '连衣裙',
    specs: [{ name: '颜色分类', values: ['白色', '黑色'] }, { name: '尺码', values: ['M', 'L', 'XL'] }],
    skus: [{ m: 49.9, p: 69.9 }],
  },
  {
    n: '4 休闲裤(2维)',
    catId: 8475,
    tpl: '休闲裤',
    specs: [{ name: '颜色分类', values: ['黑色', '灰色'] }, { name: '尺码', values: ['M', 'L'] }],
    skus: [{ m: 39.9, p: 59.9 }],
  },
  {
    n: '5 牛仔裤(2维)',
    catId: 8483,
    tpl: '牛仔裤',
    specs: [{ name: '颜色分类', values: ['蓝色', '黑色'] }, { name: '尺码', values: ['M', 'L'] }],
    skus: [{ m: 59.9, p: 89.9 }],
  },
  {
    n: '6 卫衣(2维)',
    catId: 7305,
    tpl: '卫衣',
    specs: [{ name: '颜色分类', values: ['黑色', '白色'] }, { name: '尺码', values: ['M', 'L', 'XL'] }],
    skus: [{ m: 69.9, p: 99.9 }],
  },
  {
    n: '7 跑步鞋(2维-颜色×鞋码)',
    catId: 12512,
    tpl: '跑步鞋',
    specs: [{ name: '颜色分类', values: ['黑色', '白色'] }, { name: '鞋码', values: ['40', '41', '42'] }],
    skus: [{ m: 129, p: 199 }],
  },
  {
    n: '8 童装家居服(2维-颜色×参考分类)',
    catId: 15021,
    tpl: '童装家居服',
    specs: [{ name: '颜色分类', values: ['咖色', '藏青'] }, { name: '参考分类', values: ['48', '52', '59'] }],
    skus: [{ m: 39.9, p: 59.9 }],
  },
  {
    n: '9 童装家居服(1维-只参考分类)',
    catId: 15021,
    tpl: '童装家居服',
    specs: [{ name: '参考分类', values: ['48', '52', '59', '66'] }],
    skus: [{ m: 39.9, p: 59.9 }],
  },
  {
    n: '10 四件套(2维-添加规格)',
    catId: 9524,
    tpl: '四件套',
    specs: [{ name: '颜色', values: ['米白', '灰色'] }, { name: '尺寸', values: ['1.5m床', '1.8m床'] }],
    skus: [{ m: 129, p: 149 }],
    attrs: {
      '品牌': '无品牌/无注册商标', '被里材质': '涤纶（聚酯纤维）', '被里面料俗称': '法兰绒',
      '安全等级': 'B类', '款式': '床单式', '织造工艺': '斜纹', '包装方式': '简装',
      '适用季节': '冬季', '适用人群': '通用', '适用性别': '通用', '风格': '简约',
      '图案': '纯色', '件数': '4件',
    },
    needThumb: true,
  },
]

// ══ 展开 SKU 组合
function expandSkus(specs, base) {
  const out = []
  const walk = (i, acc) => {
    if (i === specs.length) {
      out.push({ specs: { ...acc } })
      return
    }
    for (const v of specs[i].values) {
      acc[specs[i].name] = v
      walk(i + 1, acc)
    }
  }
  walk(0, {})
  return out.map((row, idx) => {
    const b = base[idx % base.length]
    return {
      specs: row.specs,
      stock: 100,
      multiPrice: b.m,
      price: b.p,
      itemNo: `T${String(idx + 1).padStart(3, '0')}`,
    }
  })
}

// ══ 生成商品 JSON
function makeProduct(c) {
  const skus = expandSkus(c.specs, c.skus)
  if (c.needThumb) for (const s of skus) s.thumb = MAIN_IMG
  const p = {
    title: `${c.tpl}测试商品`,
    images: [MAIN_IMG],
    category: c.tpl,
    specs: c.specs,
    skus,
  }
  if (c.attrs) p.attributes = c.attrs
  return p
}

const outDir = path.join(P, 'artifacts', '10cats')
fs.mkdirSync(outDir, { recursive: true })

console.log('════════════════════════════════════════════')
console.log('  10 个类目规格测试')
console.log('════════════════════════════════════════════\n')

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]
  const prod = makeProduct(c)
  console.log(`[${i + 1}] ${c.n}`)
  console.log(`    catId=${c.catId}  维度=${c.specs.map(s => s.name + '×' + s.values.length).join(' × ')}  行数=${prod.skus.length}`)
}

if (!RUN) {
  console.log('\n（只打印计划。加 --run 才真跑）')
  process.exit(0)
}

// ══ 真跑
const targets = ONLY ? [CASES[ONLY - 1]] : CASES
const results = []

for (let i = 0; i < targets.length; i++) {
  const c = targets[i]
  const idx = CASES.indexOf(c) + 1
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`▶ [${idx}/${CASES.length}] ${c.n}`)
  console.log('─'.repeat(50))

  const prod = makeProduct(c)
  const pf = path.join(outDir, `case${idx}.json`)
  fs.writeFileSync(pf, JSON.stringify(prod, null, 2), 'utf8')

  try {
    const out = execFileSync('node', [
      path.join(P, 'skills/pdd-publish-http/steps/index.mjs'),
      '--product-file', pf,
      '--account', ACCOUNT,
      '--confirm', 'true',
    ], { encoding: 'utf8', timeout: 600000, cwd: P })

    const m = out.match(/__DSAGENT_RESULT__(.+)/)
    const res = m ? JSON.parse(m[1]) : { ok: false, text: '无结果' }

    // 打印关键行
    for (const line of out.split('\n')) {
      if (/模板预置维度|→ |行数校验|停用尺码|规格|价格|提交|❌|✅ \d+ 行/.test(line) && !line.includes('__DSAGENT')) {
        console.log('   ' + line.replace(/^\[pdd\]\s*/, '').slice(0, 140))
      }
    }

    results.push({ idx, name: c.n, ok: res.ok, goodsId: res.goodsId || 0, text: (res.text || '').slice(0, 100) })
    console.log(res.ok ? `   ✅ 成功 goodsId=${res.goodsId}` : `   ❌ ${(res.text || '').slice(0, 120)}`)

  } catch (e) {
    const stdout = e.stdout || ''
    const m = stdout.match(/__DSAGENT_RESULT__(.+)/)
    const res = m ? JSON.parse(m[1]) : null
    results.push({ idx, name: c.n, ok: false, goodsId: 0, text: (res?.text || e.message || '').slice(0, 120) })
    console.log(`   ❌ ${(res?.text || e.message || '').slice(0, 120)}`)
  }

  // 类目之间等 8 秒
  if (i < targets.length - 1) {
    console.log('   …等 8 秒')
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 8'])
  }
}

// ══ 汇总
console.log('\n' + '═'.repeat(60))
console.log('  结果汇总')
console.log('═'.repeat(60))
let pass = 0
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} [${r.idx}] ${r.name.padEnd(32)} ${r.ok ? 'goodsId=' + r.goodsId : r.text}`)
  if (r.ok) pass++
}
console.log(`\n  通过 ${pass}/${results.length}`)
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8')
