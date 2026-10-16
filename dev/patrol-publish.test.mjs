/**
 * 发布链路巡检回归测试（PUBLISH-SPEC §4 第 8 步 / §5 验收 5）。
 *
 * 覆盖 dev/patrol-publish.mjs 的纯函数区与配置一致性：
 *   A. splitTextCandidates —— text: 候选拆分（生产在平台层单独消费）
 *   B. substitutePlaceholders —— 占位符代入
 *   C. isShorthandAnchor / verdictOf / verdictLabel —— 分流与三级判定
 *   D. 表与 JSON 一致性（回归锁）—— 条件型/简写表 ⊆ anchors、反向简写登记、
 *      数量稳定性、JSON 占位符 ⊆ PLACEHOLDER_DEFAULTS、全量 anchorSpec 归一不 throw
 *   E. PLATFORM_META 完整性 —— 账号过滤/Cookie 域/cache 键
 *   F. 内置 selftest() 集成 —— 脚本自检纳入回归链
 *
 * 运行：node dev/patrol-publish.test.mjs
 *   ★ 须先 npm run build:host（selftest import lib/ 编译产物）
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as patrol from './patrol-publish.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIB = path.join(ROOT, 'lib')
const libImport = (rel) => import(pathToFileURL(path.join(LIB, rel)).href)

const {
  PLATFORM_META, CONDITIONAL_ANCHORS, PLACEHOLDER_DEFAULTS, SHORTHAND_KIND,
  splitTextCandidates, substitutePlaceholders, isShorthandAnchor,
  verdictOf, verdictLabel, selftest,
} = patrol

const PLATFORMS = ['pdd', 'taobao', 'xianyu']
const rawJson = Object.fromEntries(PLATFORMS.map((p) => [
  p, JSON.parse(fs.readFileSync(path.join(ROOT, 'publish-config', `${p}.json`), 'utf8')),
]))

/** 递归收集对象里全部字符串值（扫占位符用） */
function collectStrings(v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out))
  return out
}

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    try {
      await c.fn()
      pass++
      console.log(`  ✓ ${c.name}`)
    } catch (err) {
      failures.push({ ...c, err })
      console.log(`  ✗ ${c.name}`)
      console.log(`      ${err?.message ?? err}`)
    }
  }
  console.log(`\n结果：${pass}/${CASES.length} 通过`)
  if (failures.length) {
    console.log('\n失败用例：')
    for (const f of failures) {
      console.log(`  ✗ [${f.suite}] ${f.name}`)
      console.log(`    ${f.err?.stack?.split('\n').slice(0, 3).join('\n    ') ?? f.err}`)
    }
    process.exitCode = 1
  } else {
    console.log('发布链路巡检回归测试全部通过。')
  }
}

// ── A. splitTextCandidates ────────────────────────────────

suite('A. splitTextCandidates')

test('拆 pdd cateConfirmButton：CSS 与 text: 候选分离', async () => {
  const { anchorSpec } = await libImport('services/publish-config-loader.js')
  const cfg = anchorSpec.constructor // 占位，确保 loader 可加载
  void cfg
  const spec = anchorSpec(rawJson.pdd, 'cateConfirmButton')
  const { css, texts } = splitTextCandidates(spec)
  assert.ok(css.length >= 1, '应有 CSS 候选')
  assert.ok(texts.includes('确认发布该类商品'), `text: 候选应含确认文案：${JSON.stringify(texts)}`)
  assert.ok(css.every((c) => !String(c.selector).startsWith('text:')), 'CSS 列表不得混入 text: 前缀')
})

test('纯 CSS 锚点（taobao formReady）无 text: 候选', async () => {
  const { anchorSpec } = await libImport('services/publish-config-loader.js')
  const { css, texts } = splitTextCandidates(anchorSpec(rawJson.taobao, 'formReady'))
  assert.ok(css.length >= 1)
  assert.equal(texts.length, 0)
})

test('slice 语义：text: 前缀被剥掉而非保留', () => {
  const { texts } = splitTextCandidates({ candidates: [{ selector: 'text:确认' }] })
  assert.deepEqual(texts, ['确认'])
})

test('多个 text: 候选全部拆出且保序', () => {
  const { css, texts } = splitTextCandidates({
    candidates: [
      { selector: 'text:确认发布该类商品' },
      { selector: '.foo button' },
      { selector: 'text:下一步' },
    ],
  })
  assert.deepEqual(texts, ['确认发布该类商品', '下一步'])
  assert.equal(css.length, 1)
})

test('空候选与 undefined 输入安全', () => {
  assert.deepEqual(splitTextCandidates({ candidates: [] }), { css: [], texts: [] })
  assert.deepEqual(splitTextCandidates(undefined), { css: [], texts: [] })
})

// ── B. substitutePlaceholders ─────────────────────────────

suite('B. substitutePlaceholders')

test('三个占位符全部代入', () => {
  assert.equal(substitutePlaceholders('//label[.//text()="{shipmentLimitText}"]'), '//label[.//text()="当日发货"]')
  assert.ok(!substitutePlaceholders('//li[.//text()="{templateName}"]').includes('{templateName}'))
  assert.equal(substitutePlaceholders('#struct-p-{propId}'), '#struct-p-1627207')
})

test('同选择器多占位符混合代入', () => {
  const out = substitutePlaceholders('div[data-x="{templateName}"] input[data-y="{propId}"]')
  assert.ok(out.includes('巡检样例模板') && out.includes('1627207'))
  assert.ok(!/\{[A-Za-z]+\}/.test(out))
})

test('无占位符选择器原样返回', () => {
  assert.equal(substitutePlaceholders('#goods-category'), '#goods-category')
})

test('非字符串输入安全（null/undefined/数字）', () => {
  assert.equal(substitutePlaceholders(null), '')
  assert.equal(substitutePlaceholders(undefined), '')
  assert.equal(substitutePlaceholders(123), '123')
})

// ── C. 分流与三级判定 ─────────────────────────────────────

suite('C. isShorthandAnchor / verdict')

test('isShorthandAnchor 按原始 JSON 类型判断', () => {
  assert.equal(isShorthandAnchor('nav, aside'), true)
  assert.equal(isShorthandAnchor({ candidates: [] }), false)
  assert.equal(isShorthandAnchor(undefined), false)
})

test('verdictOf 三级判定：红 > 黄 > 绿', () => {
  assert.equal(verdictOf([]), 'green')
  assert.equal(verdictOf([{ status: 'ok' }]), 'green')
  assert.equal(verdictOf([{ status: 'ok' }, { status: 'conditional' }, { status: 'shorthand' }, { status: 'skipped' }, { status: 'first' }]), 'green')
  assert.equal(verdictOf([{ status: 'ok' }, { status: 'fingerprint-changed' }]), 'yellow')
  assert.equal(verdictOf([{ status: 'fingerprint-changed' }, { status: 'lost' }]), 'red')
  assert.equal(verdictOf([{ status: 'ok' }, { status: 'lost' }]), 'red')
})

test('verdictLabel 三档映射 + 未知值原样返回', () => {
  assert.equal(verdictLabel('green'), '全绿')
  assert.equal(verdictLabel('yellow'), '指纹变化')
  assert.equal(verdictLabel('red'), '失联')
  assert.equal(verdictLabel('???'), '???')
})

// ── D. 表与 JSON 一致性（回归锁） ─────────────────────────

suite('D. 表与 JSON 一致性')

for (const p of PLATFORMS) {
  test(`条件型/简写表键全部存在于 ${p}.json anchors（正向）`, () => {
    const anchors = rawJson[p].anchors || {}
    for (const k of [...Object.keys(CONDITIONAL_ANCHORS[p] || {}), ...Object.keys(SHORTHAND_KIND[p] || {})]) {
      assert.ok(k in anchors, `${p} 表引用了不存在的锚点 "${k}"`)
    }
  })

  test(`${p}.json 字符串简写锚点全部登记 SHORTHAND_KIND（反向）`, () => {
    const short = SHORTHAND_KIND[p] || {}
    for (const [k, v] of Object.entries(rawJson[p].anchors || {})) {
      if (isShorthandAnchor(v)) {
        assert.ok(k in short, `${p}.json 简写锚点 "${k}" 未登记 SHORTHAND_KIND（会被误当 CSS 打点）`)
      }
    }
  })

  test(`${p}.json 占位符全部有默认值（PLACEHOLDER_DEFAULTS）`, () => {
    const found = [...new Set(collectStrings(rawJson[p]).flatMap((s) => s.match(/\{[A-Za-z][A-Za-z0-9]*\}/g) || []))]
    for (const ph of found) {
      assert.ok(ph in PLACEHOLDER_DEFAULTS, `${p}.json 出现未登记占位符 ${ph}（巡检打点会原样塞给 querySelector）`)
    }
  })

  test(`${p}.json 全量锚点 anchorSpec 归一不 throw 且候选非空`, async () => {
    const { anchorSpec } = await libImport('services/publish-config-loader.js')
    const anchors = rawJson[p].anchors || {}
    for (const k of Object.keys(anchors)) {
      const spec = anchorSpec(rawJson[p], k)
      assert.ok(Array.isArray(spec.candidates) && spec.candidates.length >= 1, `${p}.${k} 归一后候选为空`)
    }
  })
}

test('anchors 数量稳定性：pdd=37 / taobao=16 / xianyu=14（增删请同步更新本用例与巡检预期）', () => {
  const expect = { pdd: 37, taobao: 16, xianyu: 14 }
  for (const p of PLATFORMS) {
    const n = Object.keys(rawJson[p].anchors || {}).length
    assert.equal(n, expect[p], `${p}.json anchors 数量变化（期望 ${expect[p]}，实际 ${n}）——若为有意增删请同步更新本用例`)
  }
})

test('简写锚点数量稳定性：pdd=6 / taobao=1 / xianyu=5', () => {
  const expect = { pdd: 6, taobao: 1, xianyu: 5 }
  for (const p of PLATFORMS) {
    const n = Object.values(rawJson[p].anchors || {}).filter((v) => isShorthandAnchor(v)).length
    assert.equal(n, expect[p], `${p}.json 简写锚点数量变化（期望 ${expect[p]}，实际 ${n}）`)
  }
})

// ── E. PLATFORM_META 完整性 ───────────────────────────────

suite('E. PLATFORM_META')

test('三平台 meta 字段齐全且类型正确', () => {
  for (const p of PLATFORMS) {
    const m = PLATFORM_META[p]
    assert.equal(typeof m.accountFilter, 'function', `${p}.accountFilter 应为函数`)
    assert.ok(Array.isArray(m.cookieDomains) && m.cookieDomains.length >= 1, `${p}.cookieDomains 应为非空数组`)
    assert.equal(typeof m.cachePlatform, 'string')
    assert.equal(typeof m.profilePlatform, 'string')
    assert.ok('defaultKeyword' in m)
  }
})

test('cachePlatform 与生产键一致：pdd_mms / taobao / xianyu', () => {
  assert.equal(PLATFORM_META.pdd.cachePlatform, 'pdd_mms')
  assert.equal(PLATFORM_META.taobao.cachePlatform, 'taobao')
  assert.equal(PLATFORM_META.xianyu.cachePlatform, 'xianyu')
})

test('账号过滤逻辑与生产原话一致', () => {
  const { accountFilter: f } = PLATFORM_META.pdd
  assert.equal(f({ platform: 'pdd_mms' }), true)
  assert.equal(f({ platform: 'taobao' }), false)
  const { accountFilter: t } = PLATFORM_META.taobao
  assert.equal(t({ platform: 'taobao', status: 'ok' }), true)
  assert.equal(t({ platform: 'taobao', status: 'invalid' }), false)
  assert.equal(t({ platform: 'other', credential_platform: 'taobao', status: 'ok' }), true)
  assert.equal(t({ platform: 'taobao', credential_platform: 'xianyu', status: 'ok' }), true) // 精确平台优先
  const { accountFilter: x } = PLATFORM_META.xianyu
  assert.equal(x({ platform: 'xianyu', status: 'ok' }), true)
  assert.equal(x({ platform: 'xianyu', status: 'invalid' }), false)
  assert.equal(x({ platform: 'taobao', status: 'ok' }), false)
})

test('Cookie 双域覆盖正确（pdd 域 / 淘系域 / 闲鱼+淘系 SSO）', () => {
  assert.deepEqual(PLATFORM_META.pdd.cookieDomains, ['.pinduoduo.com', 'mms.pinduoduo.com'])
  assert.deepEqual(PLATFORM_META.taobao.cookieDomains, ['.taobao.com', '.tmall.com'])
  assert.deepEqual(PLATFORM_META.xianyu.cookieDomains, ['.goofish.com', '.taobao.com'])
})

// ── F. 内置 selftest 集成 ─────────────────────────────────

suite('F. selftest 集成')

test('脚本内置 --selftest 全部通过（返回 true）', async () => {
  const ok = await selftest()
  assert.equal(ok, true)
})

runAll().catch((e) => { console.error(e); process.exit(1) })
