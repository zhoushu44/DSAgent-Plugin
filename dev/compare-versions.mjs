import { execSync } from 'node:child_process'

const COMMITS = ['e3f3697', '4442ed3', 'd6b5913', 'c18a0ff']
const FILE = 'skills/pdd-publish-http/scripts/vision-fill.mjs'

for (const c of COMMITS) {
  let src = ''
  try {
    src = execSync(`git show ${c}:${FILE}`, {
      cwd: 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin',
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    })
  } catch { console.log(`${c}: 读取失败`); continue }

  const lines = src.split('\n')
  const total = lines.length
  // 找自定义输入框相关的关键函数
  const has = (re) => lines.some(l => re.test(l))
  const findFn = (name) => lines.findIndex(l => l.includes(name))

  console.log(`\n===== ${c}（${total} 行）=====`)
  console.log(`  fillSpecValuesRowByRow: ${findFn('function fillSpecValuesRowByRow') >= 0 ? '有' : '无'}`)
  console.log(`  #newSpec 结构处理:      ${has(/#newSpec/) ? '有' : '无'}`)
  console.log(`  自定义输入框检测:        ${has(/ph\.includes\('自定义'\)|placeholder.*自定义/) ? '有' : '无'}`)
  console.log(`  预设/checkbox 点选:     ${has(/预设|check-wrapper|package-item/) ? '有' : '无'}`)
  console.log(`  addSpecDimension:       ${findFn('function addSpecDimension') >= 0 ? '有' : '无'}`)
}
