import fs from 'node:fs'

// 1) 1688: description 427 -> <=420 字符
const p1688 = 'skills/1688-publish-mqs/SKILL.md'
let s = fs.readFileSync(p1688, 'utf8')
const before = '、用统一商品数据发 1688、批发商品上架。排除：1688 选品找货用 ali1688-pick、找供应商用 alibaba-source-suppliers、'
const after = '、用统一商品数据发 1688。排除：1688 选品找货用 ali1688-pick、'
if (!s.includes(before)) throw new Error('1688 desc pattern not found')
s = s.replace(before, after)
fs.writeFileSync(p1688, s)

// 2) taobao: 悬空路径 docs/mqs-publish-platform-matrix.md
const pTb = 'skills/taobao-publish-mqs/SKILL.md'
let t = fs.readFileSync(pTb, 'utf8')
const bad = '- 觅千手 v5.61 平台矩阵与字符偏移坐标：`docs/mqs-publish-platform-matrix.md`。'
const good = '- 觅千手 v5.61 平台矩阵与字符偏移坐标：见 `PUBLISH-MATRIX.md` 第八节「各平台现状对照」。'
if (!t.includes(bad)) throw new Error('taobao dangling line not found')
t = t.replace(bad, good)
fs.writeFileSync(pTb, t)

console.log('patched ok')
