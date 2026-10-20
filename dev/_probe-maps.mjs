// 临时探测：upload_search_img_map / upload_spec_img_map 在 8087 里的读取点
import fs from 'node:fs'
const s = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8')
for (const k of ['upload_search_img_map', 'upload_spec_img_map']) {
  let from = 0, n = 0
  while (n < 8) {
    const i = s.indexOf(k, from)
    if (i < 0) break
    from = i + k.length
    n++
    console.log(`--- ${k} @${i}`)
    console.log(s.slice(Math.max(0, i - 200), i + 260).replace(/\n/g, '⏎'))
  }
  console.log(`${k} hits(shown):${n}`)
}
