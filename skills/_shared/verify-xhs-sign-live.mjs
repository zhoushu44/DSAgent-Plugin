#!/usr/bin/env node
/**
 * verify-xhs-sign-live.mjs —— 用真实平台响应验证签名是否被接受
 *
 * 为什么需要这个：签名对不对，只能由平台回答。但账号登录态过期时，
 * 所有需要登录的接口都会先返回 -100「登录已过期」，**签名根本没被走到**，
 * 于是「-100」既可能是签名对、也可能签名错，无法区分。
 *
 * 破解办法：找一条**免登录**的接口（homefeed），并做对照实验：
 *
 *   正确签名  → HTTP 200（平台收下请求，再按登录态判 -100）
 *   篡改 x-s → HTTP 406（请求层直接拒，连业务码都没有）
 *   去掉 x-s → HTTP 406
 *
 * 只要出现「正确 200 / 篡改 406」这个反差，就证明签名算法是对的。
 *
 * 用法：node skills/_shared/verify-xhs-sign-live.mjs
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PURL = (p) => pathToFileURL(p).href

const HOME_FEED = 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const sign = await import(PURL(join(HERE, 'xhs-sign.mjs')))
const lib = await import(PURL(join(HERE, 'xhs-browser.mjs')))
const L = await lib.loadXhsLibs()
const store = lib.openStore(L)
const acc = store.listAccounts().find((a) => a.platform === 'xiaohongshu')
if (!acc) {
  console.error('没有小红书账号，无法做在线验证')
  process.exit(2)
}

const cookieStr = Object.entries(acc.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ')
if (!acc.cookies?.a1) {
  console.error('账号缺少 a1 cookie，无法生成签名')
  process.exit(2)
}

const payload = {
  cursor_score: '', num: 20, refresh_type: 1, note_index: 0,
  unread_begin_note_id: '', unread_end_note_id: '', unread_note_count: 0,
  category: 'homefeed_recommend', search_key: '', need_num: 20,
  image_formats: ['jpg', 'webp', 'avif'], need_filter_image: false,
}

async function probe(headers, body) {
  const res = await fetch(HOME_FEED, {
    method: 'POST',
    headers: Object.assign({
      'content-type': 'application/json;charset=UTF-8',
      origin: 'https://www.xiaohongshu.com',
      referer: 'https://www.xiaohongshu.com/',
      'user-agent': UA,
      cookie: cookieStr,
    }, headers),
    body,
  })
  const text = await res.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* 忽略 */ }
  return { status: res.status, code: j?.code ?? null, msg: j?.msg ?? null }
}

const good = sign.signHeaders('POST', HOME_FEED, cookieStr, { payload })

// 篡改：改 x-s 中间一位
const tampered = { ...good.headers }
const xs = good.headers['x-s']
tampered['x-s'] = xs.slice(0, 120) + (xs[120] === 'A' ? 'B' : 'A') + xs.slice(121)

// 去掉 x-s
const missing = { ...good.headers }
delete missing['x-s']

const rGood = await probe(good.headers, good.bodyStr)
const rBad = await probe(tampered, good.bodyStr)
const rNone = await probe(missing, good.bodyStr)

const rows = [
  { name: '正确签名 → HTTP 200', ok: rGood.status === 200, got: `HTTP ${rGood.status} code=${rGood.code} ${rGood.msg || ''}` },
  { name: '篡改 x-s → HTTP 406', ok: rBad.status === 406, got: `HTTP ${rBad.status} code=${rBad.code}` },
  { name: '去掉 x-s → HTTP 406', ok: rNone.status === 406, got: `HTTP ${rNone.status} code=${rNone.code}` },
  {
    name: '签名有效性（正确 200 且篡改非 200）',
    ok: rGood.status === 200 && rBad.status !== 200,
    got: `${rGood.status} vs ${rBad.status}`,
  },
]

for (const r of rows)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  —  ${r.got}`)

const failed = rows.filter((r) => !r.ok).length
console.log('\n账号登录态：' + (rGood.code === 0
  ? '有效（homefeed 返回 code=0）'
  : `已失效（code=${rGood.code} ${rGood.msg || ''}）—— 需重新登录后才能验证到真实数据`))
console.log(`${rows.length - failed}/${rows.length} passed`)
process.exit(failed ? 1 : 0)
