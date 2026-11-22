/**
 * dl2.mjs — 下载 webp 图片（拼多多可能不收 webp，后面转 jpg）
 */
import fs from 'node:fs'
import path from 'node:path'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const data = JSON.parse(fs.readFileSync(P + '/tmp/scraped5.json', 'utf8'))
const OUT = P + '/artifacts/taobao-3cats'
fs.mkdirSync(OUT, { recursive: true })

async function dl(url, file) {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
        'Referer': 'https://item.taobao.com/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return { ok: false, err: 'HTTP ' + r.status }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 3000) return { ok: false, err: '太小 ' + buf.length }
    fs.writeFileSync(file, buf)
    return { ok: true, size: Math.round(buf.length / 1024) }
  } catch (e) {
    return { ok: false, err: String(e.message).slice(0, 60) }
  }
}

for (const [key, d] of Object.entries(data)) {
  console.log(`\n=== ${d.name} ===`)
  const dir = path.join(OUT, key)
  fs.mkdirSync(dir, { recursive: true })
  const got = []
  // 去重（同一图有多种后缀变体）
  const uniq = []
  const seenBase = new Set()
  for (const u of d.images) {
    const base = u.split('_!!')[0]
    if (seenBase.has(base)) continue
    seenBase.add(base)
    uniq.push(u)
  }
  console.log(`  去重后 ${uniq.length} 张`)
  for (let i = 0; i < Math.min(uniq.length, 6); i++) {
    const file = path.join(dir, `img${i + 1}.webp`)
    const r = await dl(uniq[i], file)
    if (r.ok) { got.push(file); console.log(`  ✅ img${i + 1}.webp ${r.size}KB`) }
    else console.log(`  ❌ img${i + 1}: ${r.err}`)
  }
  d.localImages = got
  console.log(`  共 ${got.length} 张`)
}

fs.writeFileSync(P + '/tmp/scraped6.json', JSON.stringify(data, null, 2), 'utf8')
