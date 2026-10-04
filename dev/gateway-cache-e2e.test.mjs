/**
 * 网关缓存**端到端**测试 —— 走完整链路：技能 → 网关 → 平台。
 *
 * 与 gateway-cache.test.mjs（纯单元）的区别：这里起真实的本地网关与一个假的
 * 「平台」HTTP 服务器，断言**平台实际收到的请求次数**。这才能证明缓存真的生效，
 * 而不只是单元逻辑正确。
 *
 * 验证链路：
 *   ① 相同 GET 请求两次 → 平台只收到 1 次（第二次命中缓存）
 *   ② 第二次应**明显更快**（命中缓存跳过了 4~6s 账号节流）
 *   ③ POST 请求两次 → 平台收到 2 次（写操作绝不缓存）
 *   ④ 失败响应（HTTP 500）两次 → 平台收到 2 次（失败不缓存）
 *   ⑤ 不同账号 → 各自独立取数（防跨账号串数据）
 *   ⑥ 返回结构与技能契约一致（status / failure_kind / payload 齐全）
 *
 * 运行：node dev/gateway-cache-e2e.test.mjs
 */
import assert from 'node:assert/strict'
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const LIB = path.resolve(import.meta.dirname, '..', 'lib')

// ── 极简 runner ─────────────────────────────────────────────

const CASES = []
let currentSuite = ''
function suite(name) { currentSuite = name }
function test(name, fn) { CASES.push({ suite: currentSuite, name, fn }) }

async function runAll() {
  let pass = 0
  const failures = []
  for (const c of CASES) {
    // ★ 每条用例加超时保护：账号节流是 4~6s 硬编码（生产行为，不该为测试改动），
    //   个别用例含多次真实请求，若某处逻辑挂住会让整个进程不退出。
    //   超时即判失败并继续，保证测试一定跑完并退出。
    let timer
    try {
      await Promise.race([
        c.fn(),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error('用例超时（60s）')), 60_000)
        }),
      ])
      clearTimeout(timer)
      pass++
      console.log(`  ✓ ${c.name}`)
    } catch (err) {
      clearTimeout(timer)
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
      console.log(`    ${f.err?.stack?.split('\n').slice(0, 4).join('\n    ') ?? f.err}`)
    }
    process.exitCode = 1
  } else {
    console.log('网关缓存端到端测试全部通过。')
  }
  // ★ 强制退出：网关的 http server、keep-alive socket 等会让事件循环保持存活。
  //   用例内部已 close()，但断言失败时会跳过 close() —— 这里兜底，确保 CI 不挂起。
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref()
}

// ── 假「平台」服务器 ────────────────────────────────────────

/**
 * 起一个假平台，记录收到的每个请求。
 * 可按路径控制响应，用于验证「失败不缓存」。
 */
function startFakePlatform() {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body })
      // /fail 路径固定返回 500（用于验证失败不缓存）
      if (req.url.includes('/fail')) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'boom' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rows: [{ id: 1 }], at: received.length }))
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port })
    })
  })
}

// ── 夹具：临时凭证库 + 网关 ─────────────────────────────────

function makeTmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsagent-e2e-'))
  return path.join(dir, 'dsagent-accounts.json')
}

/** 建两个淘宝账号，用于验证跨账号不串数据 */
function taobaoAccount(accountId, unb) {
  return {
    shop_key: `taobao_${accountId}`,
    platform: 'taobao',
    credential_platform: 'taobao',
    account_id: accountId,
    display_label: `tb${accountId}`,
    cookies: { unb, _nk_: `tb${accountId}`, _m_h5_tk: 'tok_abc_123' },
    cookie_str: `unb=${unb}; _nk_=tb${accountId}; _m_h5_tk=tok_abc_123`,
    tb_token: 'tbtok-1',
    csrf_id: '', login_point_id: '',
    status: 'valid',
    session_hint: 'ok',
    bound_agent_ids: ['default'],
    account_meta: {},
    created_at: '', last_checked_at: '',
  }
}

/** 通过真实 HTTP 打网关的 /api/v1/proxy */
function callGateway(gwUrl, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL('/api/v1/proxy', gwUrl)
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error(`网关返回非 JSON: ${data.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ── 测试 ────────────────────────────────────────────────────

suite('端到端：真实网关 + 假平台')

test('相同 GET 请求两次 → 平台只收到 1 次；第二次显著更快（跳过 4~6s 节流）', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')
  delete process.env.DSAGENT_GATEWAY_CACHE

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb957985228335', _m_h5_tk: 'tok_abc_123' })
    clearGatewayCache()

    const gw = await startGatewayProxy(store)
    const body = {
      kind: 'http_get',
      platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/api/list`,
      params: { page: '1', size: '20' },
      agent_id: 'session-1',
    }

    // 第一次：未命中，打平台（会等节流）
    const t1 = Date.now()
    const r1 = await callGateway(gw.url, body)
    const d1 = Date.now() - t1

    // 第二次：应命中缓存，不打平台、不等节流
    const t2 = Date.now()
    const r2 = await callGateway(gw.url, body)
    const d2 = Date.now() - t2

    console.log(`      第一次 ${d1}ms（未命中，含节流），第二次 ${d2}ms（命中）`)

    assert.equal(r1.status, 'success', `第一次应成功: ${r1.error_message ?? ''}`)
    assert.equal(r2.status, 'success', '第二次应成功')
    assert.equal(platform.received.length, 1, `平台应只收到 1 次请求，实际 ${platform.received.length} 次`)

    // 命中缓存应跳过 4~6s 节流，故第二次必须明显更快
    assert.ok(d2 < 1000, `命中缓存应 <1s，实际 ${d2}ms`)
    assert.ok(d2 < d1, '第二次应快于第一次')

    // 契约一致性：技能侧读的字段必须齐全
    assert.ok('status' in r2 && 'failure_kind' in r2 && 'payload' in r2, '响应结构应与技能契约一致')
    assert.deepEqual(r2.payload, r1.payload, '命中缓存应返回与首次相同的数据')
    assert.equal(r2.cache_hit, true, '应标记 cache_hit')
    assert.equal(r1.cache_hit, undefined, '首次未命中不应有 cache_hit 标记')

    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('POST 请求两次 → 平台收到 2 次（写操作绝不缓存）', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const body = {
      kind: 'http_post',
      platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/api/submit`,
      json_body: { title: '测试商品' },
      agent_id: 'session-1',
    }
    const r1 = await callGateway(gw.url, body)
    const r2 = await callGateway(gw.url, body)

    assert.equal(r1.status, 'success')
    assert.equal(r2.status, 'success')
    assert.equal(platform.received.length, 2, `写操作必须每次都打平台，实际 ${platform.received.length} 次`)
    assert.equal(r2.cache_hit, undefined, 'POST 不应命中缓存')

    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('失败响应（HTTP 500）两次 → 平台收到 2 次（失败不缓存）', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const body = {
      kind: 'http_get',
      platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/fail`,
      agent_id: 'session-1',
    }
    const r1 = await callGateway(gw.url, body)
    const r2 = await callGateway(gw.url, body)

    assert.equal(r1.status, 'error', '失败响应应报 error')
    assert.equal(r2.status, 'error')
    assert.equal(platform.received.length, 2, `失败不应缓存，实际 ${platform.received.length} 次`)
    assert.equal(r2.cache_hit, undefined, '失败响应不应命中缓存')

    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('不同参数（分页）不串数据 → 平台各收到 1 次', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const mk = page => ({
      kind: 'http_get', platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/api/list`,
      params: { page: String(page) },
      agent_id: 'session-1',
    })

    const r1 = await callGateway(gw.url, mk(1))
    const r2 = await callGateway(gw.url, mk(2))
    // 再取一次第 1 页 → 应命中缓存，不再打平台
    const r3 = await callGateway(gw.url, mk(1))

    assert.equal(platform.received.length, 2, `两个不同分页应各打一次平台，实际 ${platform.received.length}`)
    assert.equal(r3.cache_hit, true, '重复的第 1 页应命中缓存')
    assert.deepEqual(r3.payload, r1.payload, '命中缓存应返回第 1 页数据')
    assert.notDeepEqual(r2.payload, r1.payload, '第 2 页不应返回第 1 页数据')

    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('DSAGENT_GATEWAY_CACHE=off 时完全关闭 → 平台收到 2 次', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')
  process.env.DSAGENT_GATEWAY_CACHE = 'off'

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const gc = await import(pathToFileURL(path.join(LIB, 'services', 'gateway-cache.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    gc.resetCacheConfigCache()
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const body = {
      kind: 'http_get', platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/api/list`,
      agent_id: 'session-1',
    }
    await callGateway(gw.url, body)
    await callGateway(gw.url, body)

    assert.equal(platform.received.length, 2, `关闭缓存后应每次都打平台，实际 ${platform.received.length} 次`)
    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
    delete process.env.DSAGENT_GATEWAY_CACHE
    gc.resetCacheConfigCache()
  }
})

test('契约保护：命中缓存时必须回放 set_cookies（技能靠它取 _m_h5_tk 算签名）', async () => {
  // 假平台返回 Set-Cookie，模拟平台下发新的 _m_h5_tk
  const received = []
  const platform = http.createServer((req, res) => {
    received.push(req.url)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['_m_h5_tk=abc123def456_1700000000000; Path=/; Domain=.taobao.com'],
    })
    res.end(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { n: 1 } }))
  })
  await new Promise(r => platform.listen(0, '127.0.0.1', r))
  const port = platform.address().port

  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    // ★ 账号初始就带着与平台将下发的**相同** token：
    //   这样响应合并后 Cookie 不变 → 凭证指纹不变 → 缓存键不变 → 第二次才应命中。
    //   （若账号初始无 token，首次响应会写库改变 Cookie，键随之变化、不再命中 ——
    //     那是**正确**行为，见下一个用例。）
    await store.save('taobao', {
      unb: '2218891961201', _nk_: 'tb1',
      _m_h5_tk: 'abc123def456_1700000000000',
    })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const body = {
      kind: 'http_get', platform: 'taobao',
      url: `http://127.0.0.1:${port}/bootstrap`,
      agent_id: 'session-1',
    }
    const r1 = await callGateway(gw.url, body)
    const r2 = await callGateway(gw.url, body)   // 应命中缓存

    assert.equal(received.length, 1, `第二次应命中缓存，实际平台收到 ${received.length} 次`)
    assert.equal(r2.cache_hit, true, '应标记命中')

    // ★ 关键契约：set_cookies 必须原样回放。
    //   技能侧（fetch_data.py）从它里面提取 _m_h5_tk 的 token 段自行算 MTOP 签名；
    //   若这里被剥成空数组，技能会拿不到 token 而直接失败。
    assert.ok(Array.isArray(r2.set_cookies), 'set_cookies 必须是数组')
    assert.equal(r2.set_cookies.length, 1, 'set_cookies 应原样回放，不能剥空')
    assert.ok(
      String(r2.set_cookies[0]).includes('_m_h5_tk=abc123def456'),
      `set_cookies 应保留 _m_h5_tk，实际=${JSON.stringify(r2.set_cookies)}`,
    )
    assert.deepEqual(r2.set_cookies, r1.set_cookies, '回放的 set_cookies 应与首次一致')

    gw.close()
  } finally {
    platform.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('安全行为：首次响应刷新了 _m_h5_tk → 缓存键随之变化，不复用旧数据', async () => {
  // 这一条固化「凭证变化即换键」的设计意图：
  //   账号初始**没有** _m_h5_tk，首次响应下发并写库 → Cookie 变化 → 键变化 → 第二次必须重新取数。
  //   这比「命中旧缓存」更安全：token 换了就不该把旧响应喂回去。
  const received = []
  const platform = http.createServer((req, res) => {
    received.push(req.url)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['_m_h5_tk=freshtoken999_1700000000000; Path=/; Domain=.taobao.com'],
    })
    res.end(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { n: received.length } }))
  })
  await new Promise(r => platform.listen(0, '127.0.0.1', r))
  const port = platform.address().port

  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    // 初始无 _m_h5_tk
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const cookieBefore = store.get('taobao_2218891961201').cookie_str
    const body = {
      kind: 'http_get', platform: 'taobao',
      url: `http://127.0.0.1:${port}/bootstrap`,
      agent_id: 'session-1',
    }
    const r1 = await callGateway(gw.url, body)
    const cookieAfter = store.get('taobao_2218891961201').cookie_str
    const r2 = await callGateway(gw.url, body)

    assert.notEqual(cookieBefore, cookieAfter, '首次响应应把 _m_h5_tk 写入凭证库（前置条件）')
    assert.equal(received.length, 2, '凭证已变 → 键已变 → 第二次应重新取数，不复用旧缓存')
    assert.equal(r2.cache_hit, undefined, '不应命中旧缓存')
    assert.ok(r1.set_cookies.length > 0, '首次应带回 set_cookies')

    gw.close()
  } finally {
    platform.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

test('契约保护：payload 结构不被缓存包装破坏（技能直接读 payload.ret / payload.data）', async () => {
  const platform = await startFakePlatform()
  const storePath = makeTmpStore()
  process.env.DSAGENT_CREDENTIALS_KEYFILE = path.join(path.dirname(storePath), 'k.key')

  const { CredentialStore } = await import(pathToFileURL(path.join(LIB, 'services', 'credential-store.js')).href)
  const { startGatewayProxy, clearGatewayCache } = await import(pathToFileURL(path.join(LIB, 'gateway-proxy.js')).href)

  try {
    const store = new CredentialStore(storePath)
    await store.save('taobao', { unb: '2218891961201', _nk_: 'tb1' })
    clearGatewayCache()
    const gw = await startGatewayProxy(store)

    const body = {
      kind: 'http_get', platform: 'taobao',
      url: `http://127.0.0.1:${platform.port}/api/list`,
      agent_id: 'session-1',
    }
    await callGateway(gw.url, body)
    const hit = await callGateway(gw.url, body)

    assert.equal(hit.cache_hit, true, '前置条件：应命中缓存')
    // 技能读 payload.rows（见假平台的响应），命中时应能正常读到
    assert.ok(hit.payload && typeof hit.payload === 'object', 'payload 应是对象')
    assert.ok(Array.isArray(hit.payload.rows), 'payload.rows 应可直接读取')
    assert.equal(hit.payload.rows[0].id, 1)
    // 缓存内部字段不得混进 payload
    assert.equal(hit.payload.cache_hit, undefined, 'cache_hit 不应混进 payload')
    assert.equal(hit.payload._cache_shop_key, undefined, '内部字段不应混进 payload')

    gw.close()
  } finally {
    platform.server.close()
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
    delete process.env.DSAGENT_CREDENTIALS_KEYFILE
  }
})

// ── 执行 ────────────────────────────────────────────────────

await runAll()
