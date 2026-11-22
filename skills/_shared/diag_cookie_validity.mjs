/** diag_cookie_validity.mjs — 判断连接器 Cookie 是否还有效（纯 API 探测，不开浏览器） */
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const PLUGIN = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const SHOP = process.argv[2]

const { CredentialStore } = _require(path.join(PLUGIN, 'lib/services/credential-store.js'))
const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const acc = await store.get(SHOP)
const jar = acc.cookies || {}
console.log('店铺:', acc.display_label)
console.log('Cookie 条数:', Object.keys(jar).length)
console.log('关键 Cookie:', ['PASS_ID', 'SUB_PASS_ID', 'SUB_SYS_ID', 'api_uid', 'mms_b84d1838'].map(k => `${k}=${jar[k] ? '有' : '无'}`).join('  '))
console.log('status:', acc.status, ' 最后检查:', acc.last_checked_at || acc.checked_at || '—')

const cookieStr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
const UA = acc.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

// 用最轻量的「我是不是登录用户」接口探测
const tests = [
  { name: 'earth mallInfo', url: 'https://mms.pinduoduo.com/earth/api/mallInfo/commonMallInfo', method: 'POST' },
  { name: 'userInfo', url: 'https://mms.pinduoduo.com/janus/api/new/userinfo', method: 'GET' },
]

for (const t of tests) {
  try {
    const res = await fetch(t.url, {
      method: t.method,
      headers: {
        'cookie': cookieStr,
        'user-agent': UA,
        'content-type': 'application/json',
        'referer': 'https://mms.pinduoduo.com/goods/goods_list',
      },
      body: t.method === 'POST' ? JSON.stringify({}) : undefined,
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    const loginHdr = res.headers.get('checklogin') || res.headers.get('Check-Login') || ''
    let brief = text.slice(0, 200)
    try {
      const j = JSON.parse(text)
      brief = `success=${j.success} error_code=${j.error_code ?? '—'} msg=${(j.error_msg || '').slice(0, 60)}`
      if (j.result?.mall_name || j.result?.mallName) brief += ` mall=${j.result.mall_name || j.result.mallName}`
    } catch { }
    console.log(`\n[${t.name}] HTTP ${res.status} checklogin=${loginHdr || '—'}`)
    console.log('  ', brief)
  } catch (e) {
    console.log(`\n[${t.name}] 请求失败: ${String(e.message).slice(0, 100)}`)
  }
}
