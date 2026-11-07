import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/spec-dims.mjs'
const s = fs.readFileSync(f, 'utf8')
const i = s.indexOf('export function alignDims')
console.log(s.slice(i, i + 2600))
