import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync('dev/.ui-shots/taobao-json-dump.json', 'utf8'))
const J = j.Json || {}
const req = J.request || {}
console.log('request keys:', Object.keys(req).slice(0, 40).join(','))
const s = JSON.stringify(J)
const m = s.match(/"id":(\d{10,})/)
console.log('id in Json:', m ? m[1] : null)
const m2 = s.match(/1091\d{9}/g)
console.log('109xxx occurrences:', m2 ? [...new Set(m2)].slice(0, 5) : null)
