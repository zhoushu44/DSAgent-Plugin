import * as fs from 'node:fs'
const d = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/real20/item-001-保温杯'
const c = JSON.parse(fs.readFileSync(`${d}/context.json`, 'utf8'))
const r = c.result || {}
const data = r.data || {}

console.log('result.data 下的模块:')
console.log(Object.keys(data).join(', '))
console.log('')

// 逐模块看 fields 的 key
for (const [mod, v] of Object.entries(data)) {
  const f = v?.fields
  if (!f || typeof f !== 'object') continue
  const keys = Object.keys(f)
  // 只打印可能是属性的模块
  if (/attr|prop|param|spec|detail|desc|base|info/i.test(mod) || keys.some(k => /attr|prop/i.test(k))) {
    console.log(`--- ${mod}.fields ---`)
    console.log('  ' + keys.slice(0, 25).join(', '))
  }
}
