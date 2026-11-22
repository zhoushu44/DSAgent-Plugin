#!/usr/bin/env node
/**
 * verify-xhs-sign-matrix.mjs —— 签名**全场景**逐字节对照
 *
 * verify-xhs-sign-parity.mjs 只测了「POST + 固定 payload」一条路。
 * 实际链路里还有 GET、带 query 的 GET、中文/emoji 正文、数组字段、超长正文
 * —— 任何一条路径上 content_string 拼得不一样，签名就是错的。
 *
 * 这里把 Python 与 Node 的随机源/时钟都钉死，跑一整张用例矩阵，逐字符比对。
 *
 * 用法：node skills/_shared/verify-xhs-sign-matrix.mjs
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PURL = (p) => pathToFileURL(p).href
const CRAWL_PY = join(HERE, '..', 'xiaohongshu-crawl', 'scripts')

const A1 = '1a177c044964rl6883yjeiw2v7acsl'.padEnd(52, 'x').slice(0, 52)
const TS = 1792602069.123
const SEED = 20260101
const FIXED_NOW = 1792602069123

/* ── 用例矩阵 ─────────────────────────────────────────────── */
const CASES = [
  {
    name: 'POST 图文发布体（中文）',
    method: 'POST',
    url: 'https://creator.xiaohongshu.com/api/sns/web/v1/note',
    payload: {
      title: '童装新品测试', desc: '夏季纯棉儿童睡衣，亲肤透气', type: 'normal',
      ats: [], image_info: { images: [{ file_id: 'a/b/c.jpg' }] }, post_timer: '',
    },
  },
  {
    name: 'POST 视频发布体（含定时）',
    method: 'POST',
    url: 'https://creator.xiaohongshu.com/api/sns/web/v1/note',
    payload: {
      title: '视频测试', desc: 'ok', type: 'video', ats: [],
      video_info: { fileid: 'spectrum/g_abc123', duration: 12.5 },
      post_timer: '2026-10-25 20:00',
    },
  },
  {
    name: 'POST 含数组/emoji/引号转义',
    method: 'POST',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes',
    payload: {
      keyword: '童装 🧸 "纯棉"\\睡衣', page: 1, page_size: 20,
      search_id: 'abc123xyz', sort: 'general', note_type: 0,
      ext_flags: [], image_formats: ['jpg', 'webp', 'avif'],
    },
  },
  {
    name: 'POST 空对象 body',
    method: 'POST',
    url: 'https://creator.xiaohongshu.com/api/sns/web/v1/upload',
    payload: {},
  },
  {
    name: 'GET 无参数',
    method: 'GET',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/user/me',
    params: {},
  },
  {
    name: 'GET 带 query（含中文/逗号/空格）',
    method: 'GET',
    url: 'https://creator.xiaohongshu.com/api/sns/web/v1/note_list',
    params: { page: 0, page_size: 30, sort: 'time', kw: '童装 睡衣,x', note: 'a b' },
  },
  {
    name: 'GET 数组参数（逗号连接）',
    method: 'GET',
    url: 'https://creator.xiaohongshu.com/api/media/v1/upload/creator/permit',
    params: { biz_name: 'spectrum', scene: 'video', file_count: 1, version: 1, source: 'web', tags: ['a', 'b'] },
  },
  {
    name: 'POST 超长正文（1000 字）',
    method: 'POST',
    url: 'https://creator.xiaohongshu.com/api/sns/web/v1/note',
    payload: {
      title: '长文测试', desc: '一'.repeat(1000), type: 'normal', ats: [],
      image_info: { images: [{ file_id: 'x.jpg' }] }, post_timer: '',
    },
  },
]

/* ── Python 探针：一次跑完所有用例 ────────────────────────── */
const pyProbe = `
import sys, json
sys.path.insert(0, ${JSON.stringify(CRAWL_PY)})
import xhs_sign as X
import time as _t
_t.time = lambda: ${FIXED_NOW} / 1000.0

class FixedRandom:
    A = 12345; C = 12345
    def __init__(self, seed): self.s = seed % (2**31)
    def _next(self):
        self.s = (self.A * self.s + self.C) % (2**31)
        return self.s
    def random(self): return self._next() / (2**31)
    def randint(self, a, b): return a + self._next() % (b - a + 1)
    def choice(self, seq): return seq[self._next() % len(seq)]
    def choices(self, seq, weights=None, k=1): return [self.choice(seq)]
    def randbytes(self, n): return bytes((self._next() >> 7) % 256 for _ in range(n))

cases = json.loads(sys.argv[1])
out = []
for c in cases:
    X.random = FixedRandom(${SEED})
    X.secrets = type("S", (), {"token_bytes": staticmethod(lambda n: X.random.randbytes(n))})()
    if c["method"] == "POST":
        sig = X.sign_xs("POST", c["url"], ${JSON.stringify(A1)}, payload=c["payload"], timestamp=${TS})
        body_str = json.dumps(c["payload"], separators=(",", ":"), ensure_ascii=False)
    else:
        sig = X.sign_xs("GET", c["url"], ${JSON.stringify(A1)}, payload=c.get("params") or {}, timestamp=${TS})
        body_str = None
    out.append({"sig": sig, "body": body_str})
print(json.dumps(out, ensure_ascii=False))
`

let pyOut
try {
  pyOut = JSON.parse(execFileSync('python', ['-c', pyProbe, JSON.stringify(CASES)], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).trim())
} catch (e) {
  console.error('Python 侧失败：')
  console.error(String(e.stderr || e.message).slice(0, 1200))
  process.exit(2)
}

/* ── Node 侧 ─────────────────────────────────────────────── */
process.env.XHS_SIGN_DETERMINISTIC = String(SEED)
process.env.XHS_SIGN_FIXED_NOW = String(FIXED_NOW)
const mod = await import(PURL(join(HERE, 'xhs-sign.mjs')))

let pass = 0
let fail = 0
const failures = []

CASES.forEach((c, i) => {
  const want = pyOut[i]
  let got = null
  let gotBody = null
  try {
    // 每个用例前重置随机源，与 Python 侧 FixedRandom(SEED) 逐用例重置对齐
    mod.__resetRandomForTest?.()
    if (c.method === 'POST') {
      const h = mod.signHeaders('POST', c.url, `a1=${A1}`, { payload: c.payload })
      got = h.headers['x-s']
      gotBody = h.bodyStr
    } else {
      const h = mod.signHeaders('GET', c.url, `a1=${A1}`, { params: c.params })
      got = h.headers['x-s']
      gotBody = h.bodyStr
    }
  } catch (e) {
    fail++
    failures.push({ name: c.name, why: `抛错：${e.message}` })
    return
  }

  const sigOk = got === want.sig
  const bodyOk = c.method === 'GET' ? gotBody === null : gotBody === want.body

  if (sigOk && bodyOk) {
    pass++
    console.log(`PASS  ${c.name}`)
  } else {
    fail++
    const detail = []
    if (!sigOk) {
      let k = 0
      while (k < Math.min(got.length, want.sig.length) && got[k] === want.sig[k]) k++
      detail.push(`x-s 首个差异 @${k}  js=${got.slice(Math.max(0, k - 12), k + 12)}`)
      detail.push(`                        py=${want.sig.slice(Math.max(0, k - 12), k + 12)}`)
    }
    if (!bodyOk) {
      detail.push(`body 不一致`)
      detail.push(`  js=${String(gotBody).slice(0, 160)}`)
      detail.push(`  py=${String(want.body).slice(0, 160)}`)
    }
    failures.push({ name: c.name, why: detail.join('\n      ') })
    console.log(`FAIL  ${c.name}`)
    for (const d of detail)
      console.log(`      ${d}`)
  }
})

console.log(`\n${pass}/${CASES.length} passed`)
if (fail) {
  console.log('\n失败用例明细：')
  for (const f of failures) {
    console.log(`  · ${f.name}`)
    console.log(`      ${f.why}`)
  }
  process.exit(1)
}
