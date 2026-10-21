/**
 * 探测图片空间上传接口对不同 bizCode / 参数的行为。
 * 目标：确认详情图是否用同一接口（觅千手也是走页面同一 uploader）。
 *
 * 用法：node dev/probe-upload-bizcode.mjs
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const { CredentialStore } = await import('../lib/services/credential-store.js')
const store = new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json'))
const account = store.listAccounts().filter((a) => a.platform === 'taobao' && a.status === 'valid')[0]?.shop_key
const acc = store.get(account)
const cookieHeader = Object.entries(acc.cookies || {})
  .filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `${k}=${v}`).join('; ')

const IMG = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin',
  'skills', 'pdd-link-matrix', 'assets', 'src', 'detail_10.jpg')
if (!existsSync(IMG)) { console.error('缺素材', IMG); process.exit(1) }
const buf = readFileSync(IMG)

const UPLOAD = 'https://stream-upload.taobao.com/api/upload.api'
const REFERER = 'https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu'

async function tryOne(label, params) {
  const qs = new URLSearchParams(params).toString()
  const form = new FormData()
  form.append('name', `probe_${label}.jpg`)
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), `probe_${label}.jpg`)
  try {
    const r = await fetch(`${UPLOAD}?${qs}`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        Referer: REFERER, Origin: 'https://qn.taobao.com',
        Accept: 'application/json, text/plain, */*', Cookie: cookieHeader,
      },
      body: form,
      signal: AbortSignal.timeout(60000),
    })
    const t = await r.text()
    let j = null; try { j = JSON.parse(t) } catch { }
    const ok = j?.success === true && j?.object?.fileId
    console.log(`[${label}] http=${r.status} ok=${ok}`)
    if (ok) console.log(`   url=${j.object.url}  pix=${j.object.pix}  q=${j.object.quality}`)
    else console.log(`   raw=${t.slice(0, 220)}`)
    return ok
  } catch (e) {
    console.log(`[${label}] ERR ${e.message}`)
    return false
  }
}

console.log('账号', account, '\n')
// 1) 素材图 bizCode=tu（已知可用）
await tryOne('tu_root', { _input_charset: 'utf-8', appkey: 'tu', folderId: '0', picCompress: 'false', watermark: 'false' })
// 2) tu + 压缩
await tryOne('tu_compress', { _input_charset: 'utf-8', appkey: 'tu', folderId: '0', picCompress: 'true', watermark: 'false' })
// 3) 详情图候选 bizCode
for (const bk of ['desc', 'detail', 'tu', 'pic', 'item']) {
  if (bk === 'tu') continue
  await tryOne(`bk_${bk}`, { _input_charset: 'utf-8', appkey: bk, folderId: '0', picCompress: 'false', watermark: 'false' })
}
// 4) 天猫统一上传端点（觅千手 detect 里提到 /tmall/uploadImage）
for (const path of ['/tmall/uploadImage', '/api/upload.api']) {
  try {
    const form = new FormData()
    form.append('name', 'probe_tm.jpg')
    form.append('file', new Blob([buf], { type: 'image/jpeg' }), 'probe_tm.jpg')
    const r = await fetch(`https://stream-upload.taobao.com${path}`, {
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: REFERER, Origin: 'https://qn.taobao.com', Cookie: cookieHeader },
      body: form, signal: AbortSignal.timeout(45000),
    })
    const t = await r.text()
    console.log(`[path${path}] http=${r.status} raw=${t.slice(0, 200)}`)
  } catch (e) { console.log(`[path${path}] ERR ${e.message}`) }
}
