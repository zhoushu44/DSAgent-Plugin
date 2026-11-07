import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/stage-nav.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')

const startIdx = lines.findIndex(l => l.includes('// ★ 2026-11-03：选类目页异步渲染'))
if (startIdx < 0) { console.log('NOT FOUND start'); process.exit(1) }

// 从 startIdx 往后找「return page」第一次出现的位置
let endIdx = -1
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].trim() === 'return page') { endIdx = i; break }
}
if (endIdx < 0) { console.log('NOT FOUND end'); process.exit(1) }

console.log(`替换 L${startIdx + 1} ~ L${endIdx + 1}（${endIdx - startIdx + 1} 行）`)
console.log('首行:', lines[startIdx].trim().slice(0, 60))
console.log('末行:', lines[endIdx].trim())

const NEW = [
  "  // ★ 2026-11-03：只做一次「是否已在表单页」的兜底判断，不轮询",
  "  //   ⚠ 教训：加轮询等待会和外层 openPublishEntry 的重试叠加成死循环（实测收纳箱卡死）",
  "  let hasSearch = await safeEval(() =>",
  "    !!document.querySelector('input[placeholder*=\"搜索分类\"]')",
  "  ).catch(() => false)",
  "",
  "  if (!hasSearch) {",
  "    // 没有搜索框 → 可能已经在表单页",
  "    log('  无类目搜索框（可能已在表单页）')",
  "    return page",
  "  }",
]

const out = [...lines.slice(0, startIdx), ...NEW, ...lines.slice(endIdx + 1)]
fs.writeFileSync(f, out.join('\n'), 'utf8')
console.log('OK: 已替换为单次检测')
