import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const dj = c.result.data.Root.fields.dataJson

for (const mod of ['offerBaseInfo', 'detailModel', 'tempModel', 'mixModel']) {
  if (!dj[mod]) continue
  console.log(`=== ${mod} ===`)
  const keys = Object.keys(dj[mod])
  console.log('字段:', keys.slice(0, 30).join(', '))
  console.log('')
}

// 深挖 offerBaseInfo
const ob = dj.offerBaseInfo || {}
console.log('offerBaseInfo 详情:')
for (const [k, v] of Object.entries(ob)) {
  if (typeof v === 'string' || typeof v === 'number') {
    console.log(`  ${k} = ${String(v).slice(0, 60)}`)
  } else if (Array.isArray(v)) {
    console.log(`  ${k} = Array(${v.length})`)
    if (v.length && typeof v[0] === 'object') console.log(`     [0]: ${JSON.stringify(v[0]).slice(0, 180)}`)
  } else if (v && typeof v === 'object') {
    console.log(`  ${k} = {${Object.keys(v).slice(0, 8).join(', ')}}`)
  }
}
