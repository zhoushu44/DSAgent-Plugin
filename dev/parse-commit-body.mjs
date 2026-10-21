/** 解 previewDraftSubmit 的 jsonBody，看完整结构（这是用户说的 commitBody 原型） */
import { readFileSync, writeFileSync } from 'node:fs'

const bodies = JSON.parse(readFileSync('dev/.ui-shots/commit-bodies.json', 'utf8'))
const hit = bodies.find((b) => /previewDraftSubmit/.test(b.url))
if (!hit) { console.error('没抓到 previewDraftSubmit'); process.exit(1) }

// 抓包时只存了 head(3000)，这里需要完整体 —— 从 head 里切 jsonBody 只能拿到前段
const m = hit.head.match(/jsonBody=([^&]+)/)
if (!m) { console.error('head 里没有 jsonBody'); process.exit(1) }
let json = ''
try { json = decodeURIComponent(m[1]) } catch { json = m[1] }

console.log('head 内 jsonBody 解码长度:', json.length, '（完整体需 19228，这里只截到 head）')
let obj = null
try { obj = JSON.parse(json) } catch (e) {
  console.log('解析失败（预期：head 截断）:', e.message)
  console.log('前 600 字:', json.slice(0, 600))
}

if (obj) {
  console.log('\n=== 顶层 key ===')
  console.log(Object.keys(obj).join(', '))
  writeFileSync('dev/.ui-shots/commit-body-parsed.json', JSON.stringify(obj, null, 2))
}
