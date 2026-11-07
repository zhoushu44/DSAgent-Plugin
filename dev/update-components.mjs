import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/SKILL.md'
let s = fs.readFileSync(f, 'utf8')

// 在组件清单里补上 2 个新组件
const oldBlock = `| \`stage-nav.mjs\` | 类目导航 |
| \`stage-fill.mjs\` | 表单填写 |`

const newBlock = `| \`stage-nav.mjs\` | 类目导航（catId 直达，2026-11-02） |
| \`stage-fill.mjs\` | 表单填写 |
| \`attr-template-direct.mjs\` | **模板直填**（零扫描，2026-11-02） |
| \`category-template-v2.mjs\` | **类目模板 v2**（带 options + 防污染，2026-11-02） |`

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock)
  fs.writeFileSync(f, s, 'utf8')
  console.log('OK: 组件清单已补 2 个新组件')
} else {
  // 组件清单格式可能不同，找一下
  const i = s.indexOf('十点五、组件清单')
  console.log('组件清单段落:')
  console.log(s.slice(i, i + 1400))
}
