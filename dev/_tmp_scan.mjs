import fs from 'node:fs'
const t=fs.readFileSync('PUBLISH-MATRIX.md','utf8').split('\n')
for(let i=246;i<262&&i<t.length;i++)console.log((i+1)+': '+t[i])
console.log('=== files registering dsagent_taobao_publish')
import path from 'node:path'
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)])
for(const f of walk('src')){ if(!/\.(ts|tsx)$/.test(f)) continue; const s=fs.readFileSync(f,'utf8'); if(/dsagent_taobao_publish/.test(s)) console.log(f) }
console.log('=== jd anywhere in src')
for(const f of walk('src')){ if(!/\.(ts|tsx)$/.test(f)) continue; const s=fs.readFileSync(f,'utf8'); if(/jd\b|jingdong|wares-jdm/i.test(s)) console.log(f) }
