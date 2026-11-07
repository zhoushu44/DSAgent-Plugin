import { execSync } from 'node:child_process'

const out = execSync('git diff aa44518 HEAD -- skills/pdd-publish-http/scripts/publish-flow.mjs', {
  cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
})
// 只看 specs 段附近的 diff
const lines = out.split('\n')
let inSpec = false
const shown = []
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (/^@@/.test(l)) {
    inSpec = /specs|fillDimByVision|添加规格|useVision|addSpecDimension/.test(lines.slice(i, i + 60).join('\n'))
  }
  if (inSpec) shown.push(l)
}
console.log(shown.slice(0, 120).join('\n'))
