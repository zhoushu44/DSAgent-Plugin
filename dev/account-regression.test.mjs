/**
 * 账户侧改进的回归测试。
 *
 * 覆盖点（对应本次改造的 5 项）：
 *   1. 凭证加密：加密落盘 / 解密读回 / 存量明文自动迁移 / 硬失效标记 / reason code
 *   2. reauth_required：连续失败达阈值落该状态、成功自愈回 valid
 *   3. 五级选号链**未被破坏**（回归重点 —— 本次不应改变任何选号行为）
 *   4. 派生关系数据化：derivedPlatformsOf / ownerPlatformOf / 级联断开规划
 *   5. Profile 引用计数与 CDP 端口归属校验
 *
 * 运行：node dev/account-regression.test.mjs
 * （需先 npm run build，测试直接跑编译产物 lib/）
 *
 * ★ 刻意**不用** `node --test`：沙箱下 test runner 会为每个文件 spawn 子进程，
 *   而子进程的 stdio 命名管道被沙箱禁止（EPERM）。本文件自带极简 runner，
 *   在当前进程内顺序执行，既绕开该限制，也让输出更紧凑。
 */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')

// ── 极简 runner（进程内，规避沙箱的 spawn EPERM）─────────────

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
    console.log('账户侧回归测试全部通过。')
  }
}

const { CredentialStore, planCascadeDisconnect, derivedPlatformsOf, ownerPlatformOf, derivationChainFor, resolveAccountForRequest, sortAccountsByPreference } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
const secure = await import(pathToFileURL(path.join(LIB, 'services', 'secure-store.js')).href)
const authOp = await import(pathToFileURL(path.join(LIB, 'services', 'auth-operation.js')).href)

// ── 测试夹具 ────────────────────────────────────────────────

function tmpStorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-acct-test-'))
  return path.join(dir, 'dsagent-accounts.json')
}

/** 每个用例用独立的密钥文件，避免相互干扰 */
function isolateKeys(storePath) {
  process.env.DSAGENT_CREDENTIALS_KEYFILE = secure.keyFilePathFor(storePath) + '.' + crypto.randomBytes(4).toString('hex')
}

function cleanup(storePath) {
  try { fs.rmSync(path.dirname(storePath), { recursive: true, force: true }) } catch { /* 忽略 */ }
  delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  delete process.env.DSAGENT_CREDENTIALS_MODE
  secure.resetStorageModeCache()
}

const TAOBAO_JAR = { unb: '2218891961201', _nk_: 'tb957985228335', cookie2: 'abc123' }
const XIANYU_JAR = { unb: '2218891961201', _m_h5_tk: 'tok', isg: 'isg-val' }

// ── 1. 凭证加密 ─────────────────────────────────────────────
suite('1. 凭证加密')

test('加密落盘：磁盘上不应出现明文 Cookie', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    const store = new CredentialStore(p)
    await store.save('taobao', TAOBAO_JAR)

    const raw = fs.readFileSync(p, 'utf-8')
    // 关键断言：明文凭据绝不能出现在磁盘上
    assert.ok(!raw.includes('2218891961201'), '磁盘上不应出现 unb 值')
    assert.ok(!raw.includes('tb957985228335'), '磁盘上不应出现昵称值')
    const env = JSON.parse(raw)
    assert.equal(typeof env.data, 'string', '应为信封结构')
    assert.equal(typeof env.iv, 'string')
    assert.equal(typeof env.tag, 'string')

    // 读回应与写入一致
    const list = store.listAccounts()
    assert.equal(list.length, 1)
    assert.equal(list[0].cookies.unb, '2218891961201')
    assert.equal(list[0].cookies._nk_, 'tb957985228335')
  } finally { cleanup(p) }
})

test('存量明文库自动迁移为密文', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    // 手工写入一个「旧版明文库」（模拟升级前的用户数据）
    const plaintext = {
      accounts: {
        taobao_2218891961201: {
          shop_key: 'taobao_2218891961201',
          platform: 'taobao',
          credential_platform: 'taobao',
          account_id: '2218891961201',
          display_label: 'tb957985228335',
          cookies: { ...TAOBAO_JAR },
          cookie_str: 'unb=2218891961201; _nk_=tb957985228335',
          tb_token: '', csrf_id: '', login_point_id: '',
          status: 'valid', session_hint: 'ok', bound_agent_ids: [],
          account_meta: {}, created_at: '2025-01-01T00:00:00', last_checked_at: '2025-01-01T00:00:00',
        },
      },
    }
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(plaintext, null, 2), 'utf-8')

    // 迁移前：确实是明文
    assert.ok(fs.readFileSync(p, 'utf-8').includes('2218891961201'), '前置条件：迁移前应为明文')

    const store = new CredentialStore(p)
    // 读取应正常（明文兼容）
    const before = store.listAccounts()
    assert.equal(before.length, 1, '旧明文库应能被正常读取')

    // 触发迁移（等价于任意一次保存动作）
    const migrated = await store.migrateIfNeeded()
    assert.equal(migrated, true, '应报告完成了一次迁移')

    const raw = fs.readFileSync(p, 'utf-8')
    assert.ok(!raw.includes('2218891961201'), '迁移后磁盘上不应再有明文')
    assert.equal(typeof JSON.parse(raw).data, 'string', '迁移后应为信封结构')

    // 迁移后数据仍可读回，且内容未变
    const after = store.listAccounts()
    assert.equal(after.length, 1)
    assert.equal(after[0].cookies.unb, '2218891961201')
  } finally { cleanup(p) }
})

test('硬失效标记：置上后读取返回空库，清除后恢复', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    const store = new CredentialStore(p)
    await store.save('taobao', TAOBAO_JAR)
    assert.equal(store.listAccounts().length, 1)

    store.invalidateSession()
    assert.equal(store.listAccounts().length, 0, '硬失效后应读不到账号')
    assert.equal(store.loadFailureReason(), 'invalidated')

    store.clearInvalidation()
    assert.equal(store.listAccounts().length, 1, '清除失效标记后应恢复')
  } finally { cleanup(p) }
})

test('reason code：密钥文件被替换导致解密失败时报 decrypt_failed 而非静默空库', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    const store = new CredentialStore(p)
    await store.save('taobao', TAOBAO_JAR)
    assert.equal(store.listAccounts().length, 1)

    // 模拟「换了机器 / 密钥文件被替换」：换一个密钥文件路径
    process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(p), 'other.key')

    const store2 = new CredentialStore(p)
    const list = store2.listAccounts()
    assert.equal(list.length, 0, '解不开时应返回空库（不崩）')
    const reason = store2.loadFailureReason()
    assert.ok(
      reason === 'decrypt_failed' || reason === 'safe_unavailable',
      `应报出明确原因，实际=${reason}`,
    )
    assert.notEqual(reason, null, '绝不能静默当作正常空库')
  } finally { cleanup(p) }
})

test('safe 模式下加密不可用应抛错（显式要求加密的部署应失败得响）', () => {
  const p = tmpStorePath()
  try {
    process.env.DSAGENT_CREDENTIALS_MODE = 'safe'
    process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(p), 'nonexistent-dir', 'x.key')
    secure.resetStorageModeCache()
    // 用一个不可能派生出密钥的显式密钥（长度非法 → 走机器标识；若机器标识可用仍会成功）
    // 故这里只断言「要么成功加密、要么抛出而不是静默明文」
    const res = (() => {
      try { return { threw: false, out: secure.encodeCredentials(p, { accounts: {} }) } }
      catch (e) { return { threw: true, err: e } }
    })()
    if (res.threw) {
      assert.ok(/safe_unavailable|无法派生/.test(String(res.err?.message ?? '')), '抛错应说明原因')
    } else {
      assert.equal(res.out.encrypted, true, 'safe 模式下不允许产出明文')
    }
  } finally { cleanup(p) }
})

// ── 2. reauth_required ──────────────────────────────────────
suite('2. reauth_required 状态')

test('连续失败达阈值落 reauth_required，探测成功自愈回 valid', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    const store = new CredentialStore(p)
    const saved = await store.save('taobao', TAOBAO_JAR)
    const key = saved.shop_key

    // 第 1、2 次失败：只记数，状态不变（防网络抖动误标）
    let r1 = await store.recordSessionProbe(key, 'expired')
    assert.equal(r1.status, 'valid', '单次失败不应改状态')
    assert.equal(r1.failCount, 1)
    let r2 = await store.recordSessionProbe(key, 'expired')
    assert.equal(r2.status, 'valid', '两次失败仍不应改状态')
    assert.equal(r2.failCount, 2)

    // 第 3 次达阈值 → reauth_required（不是 expired）
    const r3 = await store.recordSessionProbe(key, 'expired')
    assert.equal(r3.failCount, 3)
    assert.equal(r3.status, 'reauth_required', '达阈值应落 reauth_required')
    assert.equal(r3.flipped, true)

    // 库中确实持久化
    assert.equal(store.get(key).status, 'reauth_required')
    assert.equal(store.get(key).session_hint, 'reauth_required')

    // 探测成功 → 清零并自愈
    const r4 = await store.recordSessionProbe(key, 'valid')
    assert.equal(r4.failCount, 0)
    assert.equal(r4.status, 'valid', '成功后应自愈回 valid')
    assert.equal(store.get(key).session_hint, 'ok')
  } finally { cleanup(p) }
})

test('unknown 探测结果不累积失败计数', async () => {
  const p = tmpStorePath()
  isolateKeys(p)
  try {
    const store = new CredentialStore(p)
    const key = (await store.save('taobao', TAOBAO_JAR)).shop_key
    await store.recordSessionProbe(key, 'expired')
    const before = store.get(key).session_fail_count
    await store.recordSessionProbe(key, 'unknown')
    assert.equal(store.get(key).session_fail_count, before, 'unknown 不应改变计数')
    assert.equal(store.get(key).status, 'valid')
  } finally { cleanup(p) }
})

// ── 3. 选号链回归（本次不应改变行为）────────────────────────
suite('3. 选号链回归')

function mkAccount(platform, accountId, status, cookies = {}, bound = []) {
  return {
    shop_key: `${platform}_${accountId}`,
    platform,
    credential_platform: 'taobao',
    account_id: accountId,
    display_label: accountId,
    cookies,
    cookie_str: '',
    tb_token: '', csrf_id: '', login_point_id: '',
    status,
    session_hint: status === 'valid' ? 'ok' : 'expired',
    bound_agent_ids: bound,
    account_meta: {},
    created_at: '', last_checked_at: '',
  }
}

test('选号链① 显式 shopKey 优先', () => {
  const a = mkAccount('taobao', '111', 'valid', { unb: '111' })
  const b = mkAccount('taobao', '222', 'valid', { unb: '222' })
  const res = resolveAccountForRequest([a, b], { shopKey: 'taobao_222' })
  assert.equal(res.level, 1)
  assert.equal(res.account.shop_key, 'taobao_222')
})

test('选号链② 会话绑定优先于平台默认', () => {
  const a = mkAccount('taobao', '111', 'valid', { unb: '111' }, ['default'])
  const b = mkAccount('taobao', '222', 'valid', { unb: '222' }, ['session-x'])
  const res = resolveAccountForRequest([a, b], { agentId: 'session-x' })
  assert.equal(res.level, 2)
  assert.equal(res.account.shop_key, 'taobao_222')
})

test('选号链⑤ 多个可用账号时**不静默选择**，而是返回候选', () => {
  const a = mkAccount('taobao', '111', 'valid', { unb: '111' })
  const b = mkAccount('taobao', '222', 'valid', { unb: '222' })
  const res = resolveAccountForRequest([a, b], {})
  assert.equal(res.account, null, '多候选时必须交给用户确认，不能静默选')
  assert.equal(res.choices.length, 2)
})

test('选号链：平台默认绑定账号失效且另有可用账号时，降级到候选而非硬用失效号', () => {
  const expiredDefault = mkAccount('taobao', '111', 'reauth_required', { unb: '111' }, ['default'])
  const good = mkAccount('taobao', '222', 'valid', { unb: '222' })
  const res = resolveAccountForRequest([expiredDefault, good], {})
  // 不应把失效的默认绑定号静默选中
  assert.notEqual(res.account?.shop_key, 'taobao_111')
  assert.equal(res.account.shop_key, 'taobao_222')
})

test('排序：valid 优于 expired 优于 reauth_required', () => {
  const list = [
    mkAccount('taobao', '1', 'reauth_required', {}),
    mkAccount('taobao', '2', 'expired', {}),
    mkAccount('taobao', '3', 'valid', {}),
  ]
  const sorted = sortAccountsByPreference(list).map(a => a.status)
  assert.deepEqual(sorted, ['valid', 'expired', 'reauth_required'])
})

// ── 4. 派生关系数据化 ───────────────────────────────────────
suite('4. 派生关系与级联断开')

test('派生关系：淘宝派生出闲鱼与生意参谋系', () => {
  const derived = derivedPlatformsOf('taobao').map(r => r.derived).sort()
  assert.ok(derived.includes('xianyu'), '应含闲鱼')
  assert.ok(derived.includes('sycm'), '应含生意参谋')
  assert.ok(derived.includes('alimama'), '应含万相台')

  // keepsOwnRow 语义：闲鱼保留独立行，生意参谋不保留
  const xy = derivedPlatformsOf('taobao').find(r => r.derived === 'xianyu')
  const sy = derivedPlatformsOf('taobao').find(r => r.derived === 'sycm')
  assert.equal(xy.keepsOwnRow, true, '闲鱼需保留独立凭证行（goofish 域 Cookie）')
  assert.equal(sy.keepsOwnRow, false, '生意参谋复用淘宝 Cookie，不保留独立行')
})

test('派生关系：ownerPlatformOf 能解析上游所有者', () => {
  assert.equal(ownerPlatformOf('sycm'), 'taobao')
  assert.equal(ownerPlatformOf('xianyu'), 'taobao')
  assert.equal(ownerPlatformOf('tmall'), 'taobao')
  // 可独立登录的平台，owner 是自身
  assert.equal(ownerPlatformOf('douyin'), 'douyin')
  assert.equal(ownerPlatformOf('pdd_mms'), 'pdd_mms')
})

test('派生关系：derivationChainFor 给出上游链', () => {
  assert.deepEqual(derivationChainFor('sycm'), ['taobao'])
  assert.deepEqual(derivationChainFor('douyin'), [])
})

test('级联断开：删淘宝会列出受影响的闲鱼派生行（同 unb）', () => {
  const tb = mkAccount('taobao', '2218891961201', 'valid', { unb: '2218891961201' })
  const xy = mkAccount('xianyu', '2218891961201', 'valid', { unb: '2218891961201' })
  // 不同 unb 的闲鱼号不该被算进来
  const xyOther = mkAccount('xianyu', '999', 'valid', { unb: '999' })

  const plan = planCascadeDisconnect('taobao_2218891961201', [tb, xy, xyOther])
  assert.equal(plan.affected.length, 1, '只应影响同 unb 的闲鱼行')
  assert.equal(plan.affected[0].shop_key, 'xianyu_2218891961201')
  assert.ok(plan.summary.includes('xianyu'), '提示里应说明影响了闲鱼')
  assert.ok(plan.relations.length > 0)
})

test('级联断开：独立平台（无派生关系）不产生提示', () => {
  const dy = mkAccount('douyin', 'abc', 'valid', { sessionid: 'x' })
  const plan = planCascadeDisconnect('douyin_abc', [dy])
  assert.equal(plan.relations.length, 0)
  assert.equal(plan.affected.length, 0)
  assert.equal(plan.summary, '')
})

test('级联断开：拿不到 unb 时不误列其他账号', () => {
  const tb = mkAccount('taobao', '111', 'valid', {})  // 无 unb
  const xy = mkAccount('xianyu', '222', 'valid', { unb: '222' })
  const plan = planCascadeDisconnect('taobao_111', [tb, xy])
  // 无法证明同号 → 宁可漏报也不误报
  assert.equal(plan.affected.length, 0)
  assert.ok(plan.relations.length > 0, '关系说明仍应给出（只是不点名具体账号）')
})

// ── 5. Profile 引用计数与端口归属 ───────────────────────────
suite('5. Profile 锁与端口归属')

const bl = await import(pathToFileURL(path.join(LIB, 'browser-login.js')).href)

test('Profile 引用计数：同 owner 重复 acquire 幂等，计数归零才释放', () => {
  const dir = '/tmp/fake-profile-' + crypto.randomBytes(4).toString('hex')
  assert.equal(bl.tryAcquireProfile(dir, '任务A'), true)
  // 同 owner 重复 acquire 应成功（不自我阻塞）
  assert.equal(bl.tryAcquireProfile(dir, '任务A'), true, '同 owner 重复占用应幂等成功')
  assert.equal(bl.isProfileBusy(dir), true)

  // 不同 owner 必须被拒绝（Chrome userDataDir 独占）
  assert.equal(bl.tryAcquireProfile(dir, '任务B'), false, '不同 owner 应被拒绝')

  // 一次 release 不足以释放（还有一次引用）
  bl.releaseProfile(dir)
  assert.equal(bl.isProfileBusy(dir), true, '计数未归零不应释放')
  bl.releaseProfile(dir)
  assert.equal(bl.isProfileBusy(dir), false, '计数归零才释放')

  // 幂等重复释放不应抛错
  bl.releaseProfile(dir)
})

test('Profile 占用者列表可查询（排障用）', () => {
  const dir = '/tmp/fake-profile-' + crypto.randomBytes(4).toString('hex')
  bl.tryAcquireProfile(dir, '任务A')
  assert.deepEqual(bl.profileBorrowers(dir), ['任务A'])
  assert.equal(bl.profileOwner(dir), '任务A')
  bl.releaseProfile(dir)
  assert.deepEqual(bl.profileBorrowers(dir), [])
})

test('CDP 端口归属：未登记=unknown，一致=match，不一致=mismatch', () => {
  const dir = '/tmp/fake-profile-' + crypto.randomBytes(4).toString('hex')
  assert.equal(bl.verifyPortOwnership(dir, 9222), 'unknown', '未登记时应为 unknown（允许复用但留痕）')

  bl.registerProfilePort(dir, 9222)
  assert.equal(bl.verifyPortOwnership(dir, 9222), 'match')
  // 关键：端口与登记不符 → mismatch，调用方必须拒绝复用（防串号）
  assert.equal(bl.verifyPortOwnership(dir, 9333), 'mismatch', '端口不符必须判为 mismatch')

  bl.unregisterProfilePort(dir)
  assert.equal(bl.verifyPortOwnership(dir, 9222), 'unknown')
})

// ── 6. 授权流程 operation 状态机 ────────────────────────────
suite('6. 授权流程 operation')

test('operation：start → 上报阶段 → 查询快照', () => {
  authOp.__resetOperations()
  const op = authOp.startOperation({ kind: 'login', platform: 'taobao' })
  assert.ok(op.operationId.startsWith('auth_'))
  assert.equal(op.phase, 'launching')
  assert.equal(op.awaitingUser, false)

  authOp.report(op.operationId, 'waiting_user', '等待扫码')
  const got = authOp.getOperation(op.operationId)
  assert.equal(got.phase, 'waiting_user')
  assert.equal(got.awaitingUser, true, '等待用户阶段应标记 awaitingUser')
  assert.equal(got.done, false)
})

test('operation：同平台重复 start 复用而非新建（防多浏览器撞锁）', () => {
  authOp.__resetOperations()
  const a = authOp.startOperation({ kind: 'login', platform: 'taobao' })
  const b = authOp.startOperation({ kind: 'login', platform: 'taobao' })
  assert.equal(a.operationId, b.operationId, '同平台未结束的流程应复用')
})

test('operation：终态后拒绝重复上报与推进', async () => {
  authOp.__resetOperations()
  const op = authOp.startOperation({ kind: 'login', platform: 'douyin' })
  authOp.report(op.operationId, 'succeeded', '完成', { result: { shopKey: 'douyin_x' } })
  const done = authOp.getOperation(op.operationId)
  assert.equal(done.phase, 'succeeded')
  assert.equal(done.done, true)

  // 终态后上报应被忽略（防止「已完成又被改回失败」）
  authOp.report(op.operationId, 'failed', '不应生效')
  assert.equal(authOp.getOperation(op.operationId).phase, 'succeeded')

  // 终态后 advance 应被拒绝
  const adv = await authOp.advanceOperation(op.operationId, { action: 'resume' })
  assert.equal(adv.ok, false)
})

test('operation：timed_out 可续推（窗口仍开、进度未丢）', async () => {
  authOp.__resetOperations()
  let advanced = false
  const op = authOp.startOperation({
    kind: 'login',
    platform: 'xhs',
    onAdvance: async (input) => {
      advanced = true
      authOp.report(op.operationId, 'succeeded', `续推成功(${input.action})`)
    },
  })
  authOp.report(op.operationId, 'timed_out', '超时但窗口还开着')
  assert.equal(authOp.getOperation(op.operationId).done, false, '超时不是终态')

  const res = await authOp.advanceOperation(op.operationId, { action: 'resume' })
  assert.equal(res.ok, true)
  assert.equal(advanced, true, '续推回调应被调用')
  assert.equal(authOp.getOperation(op.operationId).phase, 'succeeded')
})

test('operation：needs_input 阶段缺 value 时拒绝推进并说明要什么', async () => {
  authOp.__resetOperations()
  const op = authOp.startOperation({ kind: 'login', platform: 'pdd', onAdvance: async () => {} })
  authOp.report(op.operationId, 'needs_input', '需要验证码', { inputPrompt: '短信验证码' })

  const noValue = await authOp.advanceOperation(op.operationId, { action: 'submit' })
  assert.equal(noValue.ok, false)
  assert.ok(noValue.error.includes('短信验证码'), '错误信息应说明需要什么输入')

  const withValue = await authOp.advanceOperation(op.operationId, { action: 'submit', value: '123456' })
  assert.equal(withValue.ok, true)
})

test('operation：cancel 触发清理回调并置终态', async () => {
  authOp.__resetOperations()
  let cancelled = false
  const op = authOp.startOperation({
    kind: 'login',
    platform: 'bilibili',
    onCancel: async () => { cancelled = true },
  })
  authOp.report(op.operationId, 'waiting_user', '等待扫码')

  const res = await authOp.cancelOperation(op.operationId)
  assert.equal(res.ok, true)
  assert.equal(cancelled, true, '取消应触发清理（关窗放锁）')
  assert.equal(authOp.getOperation(op.operationId).phase, 'cancelled')
  // 取消后内核查询应能立刻感知（用于退出长循环）
  assert.equal(authOp.isCancelled(op.operationId), true)
})

test('operation：取消后上报不应覆盖 cancelled 状态', () => {
  authOp.__resetOperations()
  const op = authOp.startOperation({ kind: 'login', platform: 'zhihu' })
  authOp.report(op.operationId, 'waiting_user', '等待')
  authOp.cancelOperation(op.operationId)
  authOp.report(op.operationId, 'succeeded', '不应生效')
  assert.equal(authOp.getOperation(op.operationId).phase, 'cancelled')
})

test('operation：describeOperation 给出「下一步该做什么」', () => {
  authOp.__resetOperations()
  const op = authOp.startOperation({ kind: 'login', platform: 'taobao' })
  authOp.report(op.operationId, 'waiting_user', '等待扫码')
  const text = authOp.describeOperation(authOp.getOperation(op.operationId))
  assert.ok(text.includes('用户'), '应提示让用户操作')
  assert.ok(text.includes('resume'), '应告诉模型如何续推')
})

// ── 执行 ────────────────────────────────────────────────────

await runAll()
