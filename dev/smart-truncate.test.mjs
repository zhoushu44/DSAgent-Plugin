/**
 * 智能截断回归测试。
 *
 * 重点验证：
 *   1. 未超限原样返回（零行为变化）
 *   2. 超限时头尾都保留（尾部 summary/total/结论不丢）
 *   3. 省略标记明示「省略了多少」（防 false PASS）
 *   4. JSON 感知：尾部对齐到字段边界
 *   5. 策略开关：head / off / smart 三种模式
 *
 * 运行：node dev/smart-truncate.test.mjs
 */
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')
const st = await import(pathToFileURL(path.join(LIB, 'services', 'smart-truncate.js')).href)

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    try {
      st.resetTruncateModeCache()
      delete process.env.DSAGENT_TRUNCATE
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
    console.log('智能截断回归测试全部通过。')
  }
}

// ── 1. 基本行为 ─────────────────────────────────────────────

suite('1. 基本行为')

test('未超限原样返回', () => {
  const s = '短文本'
  assert.equal(st.smartTruncate(s, 32000), s)
  assert.equal(st.smartTruncate('正好', 4), '正好')
})

test('恰好等于上限不截断', () => {
  const s = 'x'.repeat(32000)
  assert.equal(st.smartTruncate(s, 32000), s)
})

test('超限时总长不超过上限+标记容差', () => {
  const s = 'x'.repeat(100000)
  const out = st.smartTruncate(s, 32000)
  // 标记本身有长度，容差 200 字符
  assert.ok(out.length <= 32200, `输出应 ≤32200，实际 ${out.length}`)
  assert.ok(out.length >= 31000, `输出应保留大部分内容，实际 ${out.length}`)
})

// ── 2. 头尾保留（核心）──────────────────────────────────────

suite('2. 头尾保留')

test('尾部内容必须保留（防 false PASS 的根本）', () => {
  // 模拟数据型技能输出：长列表 + 尾部 summary
  const rows = Array.from({ length: 500 }, (_, i) => `{"id":${i},"name":"商品${i}"}`).join(',')
  const s = `{"rows":[${rows}],"total":500,"summary":"共5类商品"}`
  const out = st.smartTruncate(s, 2000)
  // ★ 尾部 summary 必须保留 —— 旧实现 slice(0,2000) 会把它丢掉
  assert.ok(out.includes('"summary"'), '尾部 summary 字段必须保留')
  assert.ok(out.includes('"total":500'), '尾部 total 字段必须保留')
  assert.ok(out.includes('商品0'), '头部数据必须保留')
})

test('多行文本尾部结论保留', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `第${i}行: 数据内容`.repeat(10))
  lines.push('结论: 这份数据表明...（关键结论）')
  const s = lines.join('\n')
  const out = st.smartTruncate(s, 3000)
  assert.ok(out.includes('结论: 这份数据表明'), '尾部结论必须保留')
  assert.ok(out.includes('第0行'), '头部必须保留')
})

test('尾部错误信息保留（日志类）', () => {
  const log = Array.from({ length: 300 }, (_, i) => `[INFO] processing item ${i}`).join('\n')
  const s = `${log}\n[ERROR] Failed: connection refused (root cause)`
  const out = st.smartTruncate(s, 2000)
  assert.ok(out.includes('[ERROR] Failed: connection refused'), '尾部错误行必须保留')
})

// ── 3. 省略标记 ─────────────────────────────────────────────

suite('3. 省略标记')

test('省略标记必须出现且含省略量', () => {
  const s = 'x'.repeat(100000)
  const out = st.smartTruncate(s, 5000)
  assert.ok(out.includes('中间省略'), '必须有省略标记')
  assert.ok(/中间省略\s+[\d,]+\s+字符/.test(out), `标记应含省略量，实际: ${out.slice(2000, 2100)}`)
})

test('大省略量标记应提示落盘文件', () => {
  const s = 'x'.repeat(100000)
  const out = st.smartTruncate(s, 5000)
  // 省略 >4000 时应提示
  assert.ok(out.includes('全量数据见落盘'), '大省略量应提示落盘文件')
})

test('小省略量不提示落盘（避免噪声）', () => {
  const s = 'x'.repeat(6000)
  const out = st.smartTruncate(s, 5000)
  assert.ok(out.includes('中间省略'), '应有省略标记')
  assert.ok(!out.includes('落盘'), '小省略量不应提示落盘')
})

// ── 4. JSON 感知 ────────────────────────────────────────────

suite('4. JSON 感知')

test('JSON 截断后尾部对齐到字段边界', () => {
  const rows = Array.from({ length: 300 }, (_, i) => `{"id":${i}}`).join(',')
  const s = `{"rows":[${rows}],"total":300,"summary":"ok"}`
  const out = st.smartTruncateJsonAware(s, 1500)
  assert.ok(out.includes('"summary"'), '尾部 summary 保留')
  // 标记后的尾部不应以半个字段名开头（如 "id":1 应完整）
  // 找到省略标记后的实际内容起点
  const markerIdx = out.indexOf('中间省略')
  if (markerIdx >= 0) {
    const tailStart = out.indexOf('）…', markerIdx)
    if (tailStart >= 0) {
      const tailContent = out.slice(tailStart + 2).trim()
      // 不应以 , 或 "id" 这种残片开头 —— 应从字段名完整开始
      assert.ok(
        !tailContent.startsWith(',') && !tailContent.startsWith('"id":'),
        `尾部不应以残片开头，实际: "${tailContent.slice(0, 30)}"`,
      )
    }
  }
})

test('非 JSON 文本不走对齐（原样头尾保留）', () => {
  const s = 'A'.repeat(10000) + 'B'.repeat(100)
  const out = st.smartTruncateJsonAware(s, 5000)
  assert.ok(out.includes('B'.repeat(100).slice(0, 50)), '尾部 B 保留')
  assert.ok(out.includes('A'.repeat(50)), '头部 A 保留')
})

// ── 5. 策略开关 ─────────────────────────────────────────────

suite('5. 策略开关')

test('head 模式：纯头部截断（旧行为兼容）', () => {
  process.env.DSAGENT_TRUNCATE = 'head'
  st.resetTruncateModeCache()
  const s = 'HEAD' + 'x'.repeat(10000) + 'TAIL'
  const out = st.smartTruncate(s, 100)
  assert.ok(out.startsWith('HEAD'), '应从头部开始')
  assert.ok(!out.includes('TAIL'), '纯头部模式不应保留尾部')
  assert.ok(out.includes('截断'), '应有截断标记')
})

test('off 模式：不截断', () => {
  process.env.DSAGENT_TRUNCATE = 'off'
  st.resetTruncateModeCache()
  const s = 'x'.repeat(100000)
  const out = st.smartTruncate(s, 5000)
  assert.equal(out, s, 'off 模式应原样返回')
})

test('smart 模式：默认', () => {
  st.resetTruncateModeCache()
  assert.equal(st.truncateMode(), 'smart')
})

test('非法值退回 smart', () => {
  process.env.DSAGENT_TRUNCATE = 'garbage'
  st.resetTruncateModeCache()
  assert.equal(st.truncateMode(), 'smart')
})

// ── 6. 边界情况 ─────────────────────────────────────────────

suite('6. 边界')

test('空字符串原样返回', () => {
  assert.equal(st.smartTruncate('', 100), '')
})

test('null/undefined 安全处理', () => {
  assert.equal(st.smartTruncate(null, 100), null)
  assert.equal(st.smartTruncate(undefined, 100), undefined)
})

test('尾部保底不小于最小值', () => {
  // 总长刚好略超上限时，尾部按比例可能很小，但不应低于保底。
  // limit=50 对 117 字符的输入只够保留很少内容，故用更大的 limit 让保底有意义。
  const s = 'H'.repeat(200) + 'TAIL_CONTENT_HERE'
  const out = st.smartTruncate(s, 100)
  // 尾部保底至少 600 字符或 limit/4=25，取 min = 25；17<25 故完整保留
  assert.ok(out.includes('TAIL_CONTENT_HERE'), `尾部保底内容应保留，实际尾部: "${out.slice(-30)}"`)
})

test('头尾不重叠（省略量 > 0）', () => {
  const s = 'x'.repeat(10000)
  const out = st.smartTruncate(s, 5000)
  // 省略标记的存在意味着确实有内容被省略
  assert.ok(out.includes('中间省略'), '有省略即证明头尾没重叠')
  const marker = out.match(/中间省略\s+([\d,]+)\s+字符/)
  if (marker) {
    const omitted = Number(marker[1].replace(/,/g, ''))
    assert.ok(omitted > 0, `省略量应 >0，实际 ${omitted}`)
  }
})

await runAll()
