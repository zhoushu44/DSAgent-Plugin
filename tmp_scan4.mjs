import fs from 'node:fs'
const re = /(八平台|8 个平台|平台矩阵|抖店|视频号|小红书|快手|得物|1688|淘宝|天猫|京东|拼多多)/
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8')
  const lines = s.split('\n')
  const hits = []
  lines.forEach((l, i) => { if (re.test(l)) hits.push((i + 1) + ': ' + l.trim().slice(0, 240)) })
  console.log('=== ' + f + ' (' + hits.length + ' hits)')
  for (const h of hits.slice(0, 60)) console.log(h)
}
