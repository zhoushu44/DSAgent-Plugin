import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const pa = c.result.data.productAttributes
console.log('productAttributes 完整结构:')
console.log(JSON.stringify(pa, null, 2).slice(0, 2000))
