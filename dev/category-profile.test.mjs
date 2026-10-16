/**
 * 类目档案（category-profile）回归测试 —— g5 三条铁律 + 持久化纪律。
 *
 * 用户定案（2026-10）：
 *   1. 档案身份 = 平台 + catId 精确匹配（不做文件名模糊兜底）
 *   2. 发布成功自动保存（实际生效值全量写回）
 *   3. 自动修复（属性变化时新值写回 json；页面已不存在的旧属性清除）
 *
 * 运行：node dev/category-profile.test.mjs
 *   ★ 须先 npm run build:host（import 的是 lib/ 编译产物）
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')
const { createCategoryProfileStore } = await import(
  pathToFileURL(path.join(LIB, 'services', 'category-profile.js')).href
)

/** 每个用例独立临时目录实例，互不污染 */
async function freshStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cat-profile-test-'))
  const store = createCategoryProfileStore(path.join(dir, 'profiles'))
  return {
    store, dir,
    profilesDir: path.join(dir, 'profiles'),
    async cleanup() { await fs.rm(dir, { recursive: true, force: true }) },
  }
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
    console.log('类目档案回归测试全部通过。')
  }
}

// ────────────────────────────────────────────────────────────
// A. 铁律 1：平台 + catId 精确匹配（不做文件名模糊）
// ────────────────────────────────────────────────────────────
suite('A. 精确匹配')

test('save 后 load 同平台同 catId 命中', async () => {
  const { store, cleanup } = await freshStore()
  try {
    const saved = await store.save('taobao', '50012345', '童装>>儿童外套', {
      attributes: { 风格: '休闲', 袖长: '长袖' },
      schemaNames: ['风格', '袖长'],
    })
    assert.ok(saved, 'save 应返回档案')
    const hit = await store.load('taobao', '50012345')
    assert.ok(hit, 'load 应命中')
    assert.equal(hit.attributes.风格, '休闲')
    assert.equal(hit.attributes.袖长, '长袖')
    assert.equal(hit.categoryName, '童装>>儿童外套')
  } finally { await cleanup() }
})

test('平台不同不串档（taobao vs tmall 同 catId）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '50012345', 'A', { attributes: { 风格: '休闲' } })
    await store.save('tmall', '50012345', 'A', { attributes: { 风格: '通勤' } })
    assert.equal((await store.load('taobao', '50012345')).attributes.风格, '休闲')
    assert.equal((await store.load('tmall', '50012345')).attributes.风格, '通勤')
  } finally { await cleanup() }
})

test('catId 字符串精确相等，前缀/部分数字不命中', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '50012345', 'A', { attributes: { 风格: '休闲' } })
    assert.equal(await store.load('taobao', '5001234'), null, '前缀不命中')
    assert.equal(await store.load('taobao', '500123456'), null, '后缀延伸不命中')
    assert.equal((await store.load('taobao', '  50012345  '))?.attributes.风格, '休闲', '两侧空白被 trim 后命中')
  } finally { await cleanup() }
})

test('空 catId load/save 都返回 null（不建垃圾档案）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    assert.equal(await store.load('taobao', ''), null)
    assert.equal(await store.load('taobao', '  '), null)
    assert.equal(await store.save('taobao', '', 'A', {}), null)
    assert.equal(await store.save('', '123', 'A', {}), null)
  } finally { await cleanup() }
})

// ────────────────────────────────────────────────────────────
// B. 铁律 3：自动修复合并语义（覆盖 / 清除 / 保留 三分）
// ────────────────────────────────────────────────────────────
suite('B. 自动修复合并')

test('patch.attributes 覆盖旧同名键（过期值被实际生效值修复）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '111', 'A', {
      attributes: { 风格: '休闲', 袖长: '长袖' },
      schemaNames: ['风格', '袖长'],
    })
    // 下次发布：风格候选变了，实际生效值变成「百搭」
    await store.save('taobao', '111', 'A', {
      attributes: { 风格: '百搭' },
      schemaNames: ['风格', '袖长'],
    })
    const hit = await store.load('taobao', '111')
    assert.equal(hit.attributes.风格, '百搭', '新值覆盖旧值（自动修复）')
    assert.equal(hit.attributes.袖长, '长袖', '未提及的旧属性保留')
  } finally { await cleanup() }
})

test('schemaNames 清单外的旧属性被清除（类目改版）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '222', 'A', {
      attributes: { 风格: '休闲', 旧属性: 'X' },
      schemaNames: ['风格', '旧属性'],
    })
    // 类目改版：页面上「旧属性」消失了
    await store.save('taobao', '222', 'A', {
      attributes: { 风格: '休闲' },
      schemaNames: ['风格', '袖长'],  // 旧属性不在 schema 里
    })
    const hit = await store.load('taobao', '222')
    assert.equal(hit.attributes.旧属性, undefined, '页面已不存在的属性被清除')
    assert.equal(hit.attributes.风格, '休闲')
  } finally { await cleanup() }
})

test('schemaNames 为空 = 保守不清除（全部保留）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '333', 'A', {
      attributes: { 风格: '休闲', 袖长: '长袖' },
      schemaNames: ['风格', '袖长'],
    })
    // 某些原因没收集到 schema（空清单）→ 不清除旧属性
    await store.save('taobao', '333', 'A', { attributes: {} })
    const hit = await store.load('taobao', '333')
    assert.equal(hit.attributes.风格, '休闲', '空 schema 保守保留')
    assert.equal(hit.attributes.袖长, '长袖')
  } finally { await cleanup() }
})

test('空值不写入档案（patch 里 value 为 null/空串的键被丢弃）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '444', 'A', {
      attributes: { 风格: null, 袖长: '', 面料: '棉' },
      schemaNames: ['风格', '袖长', '面料'],
    })
    const hit = await store.load('taobao', '444')
    assert.equal(hit.attributes.风格, undefined)
    assert.equal(hit.attributes.袖长, undefined)
    assert.equal(hit.attributes.面料, '棉')
  } finally { await cleanup() }
})

test('categoryName/freightTemplate 空则保留旧值（没收集到不清空）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', '555', '童装>>儿童外套', {
      attributes: { 风格: '休闲' },
      freightTemplate: '默认模板',
    })
    // 下次没收集到类目名与模板（如手动选类目/类目无模板下拉）
    await store.save('taobao', '555', '', { attributes: {} })
    const hit = await store.load('taobao', '555')
    assert.equal(hit.categoryName, '童装>>儿童外套', '类目名保留')
    assert.equal(hit.freightTemplate, '默认模板', '模板保留')
  } finally { await cleanup() }
})

test('schemaFp 更新；updatedAt 刷新', async () => {
  const { store, cleanup } = await freshStore()
  try {
    const first = await store.save('taobao', '666', 'A', {
      attributes: {}, schemaNames: ['X', 'Y'], schemaFp: 'fp1',
    })
    await new Promise(r => setTimeout(r, 20))
    await store.save('taobao', '666', 'A', {
      attributes: {}, schemaNames: ['X', 'Y', 'Z'], schemaFp: 'fp2',
    })
    const hit = await store.load('taobao', '666')
    assert.equal(hit.schemaFp, 'fp2')
    assert.ok(hit.updatedAt > first.updatedAt)
  } finally { await cleanup() }
})

// ────────────────────────────────────────────────────────────
// C. 铁律 2：发布成功自动保存（落盘形态）
// ────────────────────────────────────────────────────────────
suite('C. 落盘形态')

test('档案落盘为 JSON 文件，文件名 = 平台-叶子名.json', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    const saved = await store.save('taobao', '50012345', '童装/婴儿装/亲子装>>儿童外套', {
      attributes: { 风格: '休闲' },
    })
    assert.equal(saved.file, 'taobao-儿童外套.json')
    const raw = JSON.parse(await fs.readFile(path.join(profilesDir, 'taobao-儿童外套.json'), 'utf8'))
    assert.equal(raw.platform, 'taobao')
    assert.equal(raw.catId, '50012345')
    assert.equal(raw.attributes.风格, '休闲')
    assert.ok(raw.updatedAt > 0)
    assert.equal(raw.file, undefined, 'file 诊断字段不落盘')
  } finally { await cleanup() }
})

test('类目改名 → 文件名跟随 + 旧文件被删（同一 catId 永远一份）', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    await store.save('taobao', '777', '童装>>儿童外套', { attributes: { 风格: '休闲' } })
    assert.ok(await fs.stat(path.join(profilesDir, 'taobao-儿童外套.json')).then(() => true, () => false))
    // 类目改名（平台侧类目名变化）
    await store.save('taobao', '777', '童装>>儿童风衣', { attributes: { 风格: '休闲' } })
    const files = await fs.readdir(profilesDir)
    assert.ok(files.includes('taobao-儿童风衣.json'), '新文件名存在')
    assert.ok(!files.includes('taobao-儿童外套.json'), '旧文件已删除')
    assert.equal(files.filter(f => f.endsWith('.json')).length, 1, '只有一份档案')
    const hit = await store.load('taobao', '777')
    assert.equal(hit.categoryName, '童装>>儿童风衣')
  } finally { await cleanup() }
})

test('Windows 非法字符被清洗出文件名', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    const saved = await store.save('taobao', '888', 'A/B\\C:D*E"F<G>H|I', { attributes: {} })
    assert.ok(!/[\\/:*?"<>|>＞\s/／]/.test(saved.file), '文件名不含非法字符')
    assert.ok(saved.file.endsWith('.json'))
    const hit = await store.load('taobao', '888')
    assert.ok(hit, '清洗后仍能按 catId 精确命中（匹配不看文件名）')
    await fs.stat(path.join(profilesDir, saved.file))
  } finally { await cleanup() }
})

test('坏 JSON 档案被跳过，不影响其他档案', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    await store.save('taobao', '999', 'A', { attributes: { 风格: '休闲' } })
    await fs.writeFile(path.join(profilesDir, 'broken.json'), '{ not json', 'utf8')
    const hit = await store.load('taobao', '999')
    assert.ok(hit, '坏档案不影响好档案命中')
    const list = await store.list()
    assert.equal(list.length, 1, 'list 不含坏档案')
  } finally { await cleanup() }
})

// ────────────────────────────────────────────────────────────
// D. 手动编辑热加载（mtime 签名失效）
// ────────────────────────────────────────────────────────────
suite('D. 手动编辑热加载')

test('手动改 JSON 后 load 立即看到新值（无需重启）', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    await store.save('taobao', '1000', '儿童外套', { attributes: { 风格: '休闲' } })
    // 用户手动编辑档案
    const file = path.join(profilesDir, 'taobao-儿童外套.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    raw.attributes.风格 = '手写的值'
    await fs.writeFile(file, JSON.stringify(raw, null, 2), 'utf8')
    const hit = await store.load('taobao', '1000')
    assert.equal(hit.attributes.风格, '手写的值', '手动编辑即刻生效')
  } finally { await cleanup() }
})

test('用户新增手写属性可被读到（档案优先级链的上游）', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    await store.save('taobao', '1001', '儿童外套', { attributes: { 风格: '休闲' } })
    const file = path.join(profilesDir, 'taobao-儿童外套.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    raw.attributes['手写属性'] = '手写值'
    await fs.writeFile(file, JSON.stringify(raw, null, 2), 'utf8')
    const hit = await store.load('taobao', '1001')
    assert.equal(hit.attributes['手写属性'], '手写值')
  } finally { await cleanup() }
})

// ────────────────────────────────────────────────────────────
// E. 边界
// ────────────────────────────────────────────────────────────
suite('E. 边界')

test('目录不存在时 load 返回 null（首次发布无档案）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    assert.equal(await store.load('taobao', '12345'), null)
    assert.deepEqual(await store.list(), [])
  } finally { await cleanup() }
})

test('目录不存在时 save 自动创建目录', async () => {
  const { store, profilesDir, cleanup } = await freshStore()
  try {
    const saved = await store.save('taobao', '123', 'A', { attributes: { X: '1' } })
    assert.ok(saved)
    await fs.stat(profilesDir)
  } finally { await cleanup() }
})

test('save 串行化：连续多次 save 全部落盘（writeChain 不丢写）', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await Promise.all([
      store.save('taobao', 'a1', 'A1', { attributes: { X: '1' } }),
      store.save('taobao', 'a2', 'A2', { attributes: { X: '2' } }),
      store.save('taobao', 'a3', 'A3', { attributes: { X: '3' } }),
    ])
    // writeChain 只是排队，等一拍让队列跑完
    await new Promise(r => setTimeout(r, 100))
    assert.ok(await store.load('taobao', 'a1'))
    assert.ok(await store.load('taobao', 'a2'))
    assert.ok(await store.load('taobao', 'a3'))
  } finally { await cleanup() }
})

test('list 返回全部档案且含 file 字段', async () => {
  const { store, cleanup } = await freshStore()
  try {
    await store.save('taobao', 'b1', 'X>>A', { attributes: {} })
    await store.save('pdd', 'b2', 'Y>>B', { attributes: {} })
    const list = await store.list()
    assert.equal(list.length, 2)
    assert.ok(list.every(p => p.file && p.file.endsWith('.json')))
  } finally { await cleanup() }
})

await runAll()
