import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/stage-nav.mjs'
const lines = fs.readFileSync(f, 'utf8').split('\n')

const startIdx = lines.findIndex(l => l.includes('// ★ 2026-11-03：只等 1 轮'))
if (startIdx < 0) { console.log('NOT FOUND start'); process.exit(1) }

// 找结束：从 startIdx 往后第一个「return page」所在的 if 块结束
let endIdx = -1
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].includes("log('  无类目搜索框（可能已在表单页）')")) {
    // 往下找 return page 和右花括号
    for (let j = i; j < i + 4; j++) {
      if (lines[j].trim() === 'return page') { endIdx = j; break }
    }
    break
  }
}
if (endIdx < 0) { console.log('NOT FOUND end'); process.exit(1) }

console.log(`替换 L${startIdx + 1} ~ L${endIdx + 1}（${endIdx - startIdx + 1} 行）`)

const NEW = [
  "  // ★ 2026-11-03：只做一次「是否已在表单页」的兜底判断，不轮询",
  "  //   ⚠ 教训：加 15s 轮询会和外层 openPublishEntry 重试叠加成死循环（实测收纳盒卡死）",
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
