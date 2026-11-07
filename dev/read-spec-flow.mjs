import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/publish-flow.mjs'
const s = fs.readFileSync(f, 'utf8')
const i = s.indexOf('if (specs.length)')
console.log(`specs 段起点: L${s.slice(0, i).split('\n').length}`)
console.log(s.slice(i, i + 4200))
