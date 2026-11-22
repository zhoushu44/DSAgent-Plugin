#!/usr/bin/env node
/**
 * verify-xhs-sign-parity.mjs —— x-s 签名的**逐字节**一致性验证
 *
 * 上一版 verify-xhs-sign.mjs 只比了结构（前缀/长度/字段序），不够 ——
 * x-s 是 144 字节 XOR 流，结构对但差一位照样 461。
 *
 * 这里做真比对：把随机源固定成同一条确定性序列，让 Python 与 Node
 * 对**同一组入参**算签名，然后逐字符比较。
 *
 * 固定随机的方式：
 *   Python  → 用自己实现的 `_FixedRandom` 顶掉模块里的 random
 *   Node    → 通过环境变量 XHS_SIGN_DETERMINISTIC=1 让模块走线性同余序列
 *
 * 用法：node skills/_shared/verify-xhs-sign-parity.mjs
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PURL = (p) => pathToFileURL(p).href
const CRAWL_PY = join(HERE, '..', 'xiaohongshu-crawl', 'scripts')

const A1 = '1a177c044964rl6883yjeiw2v7acsl'.padEnd(52, 'x').slice(0, 52)
const URI = '/api/sns/web/v1/note'
const PAYLOAD = { title: '童装新品测试', desc: '夏季纯棉儿童睡衣，亲肤透气', type: 'normal', ats: [], post_timer: '' }
const TS = 1792602069.123
const SEED = 20260101
const FIXED_NOW = 1792602069123

/* ── Python 侧：注入固定随机 ─────────────────────────────── */
const PY = `
import sys, json, math
sys.path.insert(0, ${JSON.stringify(CRAWL_PY)})
import xhs_sign as X

class FixedRandom:
    """线性同余：与 Node 侧 xhs-sign.mjs 的 deterministic 分支逐位对齐"""
    M = 1103515245
    A = 12345
    C = 12345
    def __init__(self, seed):
        self.s = seed % (2**31)
    def _next(self):
        self.s = (self.A * self.s + self.C) % (2**31)
        return self.s
    def random(self):
        return self._next() / (2**31)
    def randint(self, a, b):
        return a + self._next() % (b - a + 1)
    def choice(self, seq):
        return seq[self._next() % len(seq)]
    def choices(self, seq, weights=None, k=1):
        return [self.choice(seq)]
    def randbytes(self, n):
        return bytes((self._next() >> 7) % 256 for _ in range(n))

X.random = FixedRandom(${SEED})
X.secrets = type("S", (), {"token_bytes": staticmethod(lambda n: X.random.randbytes(n))})()

import hashlib as _h
_orig_md5 = _h.md5
X.hashlib = type("H", (), {
    "md5": staticmethod(lambda b=b"": _orig_md5(b)),
    "hexdigest": None,
})()

# 固定时钟：x44 用的是 int(time.time()*1000)
import time as _t
_t.time = lambda: ${FIXED_NOW} / 1000.0

sig = X.sign_xs("POST", ${JSON.stringify(URI)}, ${JSON.stringify(A1)}, payload=json.loads(${JSON.stringify(JSON.stringify(PAYLOAD))}), timestamp=${TS})
X.random = FixedRandom(${SEED})
common = X.sign_xs_common({"a1": ${JSON.stringify(A1)}, "web_session": "abc"}, user_agent=X.PUBLIC_USERAGENT)
print(json.dumps({"x_s": sig, "x_s_common": common}))
`

/* ── Node 侧 ─────────────────────────────────────────────── */
process.env.XHS_SIGN_DETERMINISTIC = String(SEED)
process.env.XHS_SIGN_FIXED_NOW = String(FIXED_NOW)
const mod = await import(PURL(join(HERE, 'xhs-sign.mjs')))

let py = null
try {
  const out = execFileSync('python', ['-c', PY], { encoding: 'utf8' })
  py = JSON.parse(out.trim())
} catch (e) {
  console.error('Python 侧失败（无法做比对，请检查 xhs_sign.py 路径）：')
  console.error(String(e.stderr || e.message).slice(0, 800))
  process.exit(2)
}

const js = mod.signXs('POST', URI, A1, 'xhs-pc-web', PAYLOAD, TS)

const rows = []
const cmp = (name, a, b) => rows.push({ name, ok: a === b, a, b })

cmp('x-s 完整字符串逐字节一致', js, py.x_s)

// x-s-common：b1 指纹走 ARC4 + 自定义 Base64，比 x-s 更容易错位
// 注意 Python 侧生成 common 前要重置随机源（见 PY 脚本）
const jsHeaders = mod.signHeaders('POST', URI, `a1=${A1}; web_session=abc`, { payload: PAYLOAD })
cmp('x-s-common 完整字符串逐字节一致', jsHeaders.headers['x-s-common'], py.x_s_common)

for (const [label, got, want] of [
  ['x-s', js, py.x_s],
  ['x-s-common', jsHeaders.headers['x-s-common'], py.x_s_common],
]) {
  if (got === want)
    continue
  let i = 0
  while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++
  rows.push({
    name: `${label} 首个差异位置 index=${i}（共 js=${got.length} / py=${want.length}）`,
    ok: false,
    a: got.slice(Math.max(0, i - 24), i + 24),
    b: want.slice(Math.max(0, i - 24), i + 24),
  })
}

for (const r of rows) {
  if (r.ok) {
    console.log(`PASS  ${r.name}`)
  } else {
    console.log(`FAIL  ${r.name}`)
    console.log(`      js: ${r.a}`)
    console.log(`      py: ${r.b}`)
  }
}

const failed = rows.filter((r) => !r.ok).length
console.log(`\n${rows.length - failed}/${rows.length} passed`)
process.exit(failed ? 1 : 0)
