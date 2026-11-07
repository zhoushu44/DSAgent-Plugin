import { execSync } from 'node:child_process'
const out = execSync('git diff aa44518 HEAD -- skills/pdd-publish-http/scripts/publish-flow.mjs', {
  cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
})
const lines = out.split('\n')
// 第 3 个 hunk: @@ -264,6 +272,32 @@
const start = lines.findIndex(l => l.startsWith('@@ -264,6 +272,32 @@'))
const end = lines.findIndex((l, i) => i > start && l.startsWith('@@'))
console.log(lines.slice(start, end < 0 ? undefined : end).join('\n'))
