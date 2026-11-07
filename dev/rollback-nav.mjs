import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/stage-nav.mjs'
let s = fs.readFileSync(f, 'utf8')

// 找到「等类目搜索框」那段（从注释到 return page），整段替换
const start = s.indexOf('  // ★ 2026-11-03：选类目页异步渲染')
const endMarker = "    log('  无类目搜索框（可能已在表单页）')\n    return page\n  }"
const end = s.indexOf(endMarker)

if (start < 0 || end < 0) {
  console.log('NOT FOUND', start, end)
  // 打印实际内容
  const i = s.indexOf('等类目搜索框')
  console.log(s.slice(Math.max(0, i - 700), i + 200))
  process.exit(1)
}

const NEW = `  // ★ 2026-11-03：只做一次「是否已在表单页」的兜底判断，不轮询
  //   ⚠ 教训：加 15s 轮询会和外层 openPublishEntry 的重试叠加成死循环（实测收纳盒卡死）
  let hasSearch = await safeEval(() =>
    !!document.querySelector('input[placeholder*="搜索分类"]')
  ).catch(() => false)

  if (!hasSearch) {
    // 没有搜索框 → 可能已经在表单页
    log('  无类目搜索框（可能已在表单页）')
    return page
  }`

s = s.slice(0, start) + NEW + s.slice(end + endMarker.length)
fs.writeFileSync(f, s, 'utf8')
console.log('OK: 已回退为单次检测')
