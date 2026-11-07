import { execSync } from 'node:child_process'
const out = execSync('git diff aa44518 HEAD -- skills/pdd-publish-http/scripts/publish-flow.mjs', {
  cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
})
// 找所有 @@ hunk，列出行号和标题
const hunks = out.split('\n').filter(l => /^@@/.test(l))
console.log('所有 hunk:')
hunks.forEach(h => console.log('  ' + h))

// 关键：找 fillDimByVision 调用处和循环条件附近的差异
console.log('\n=== fillDimByVision 相关 diff ===')
const lines = out.split('\n')
lines.forEach((l, i) => {
  if (/fillDimByVision|usedVision|addSpecDimension|specs\.length/.test(l)) {
    console.log(`${String(i).padStart(4)}: ${l}`)
  }
})
