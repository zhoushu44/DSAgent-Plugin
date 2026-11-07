import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const ctx = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const gal = ctx?.result?.data?.gallery?.fields || {}
const imgs = gal.offerImgList || []
console.log('offerImgList 长度:', imgs.length)
console.log('第 1 个元素类型:', typeof imgs[0])
console.log('第 1 个元素:', JSON.stringify(imgs[0]).slice(0, 200))
console.log('')
const keys = imgs[0] && typeof imgs[0] === 'object' ? Object.keys(imgs[0]) : []
console.log('第 1 个元素的 keys:', keys.join(', '))
