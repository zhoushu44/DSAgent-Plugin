/**
 * 重新生成 100 个测试商品（标题符合 30 汉字限制）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const base = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama/out/wf/1/ai'
const src = JSON.parse(fs.readFileSync(base + '/product-pdd.json', 'utf8'))
const outDir = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/batch100'

if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true })

// 标题模板：控制在 30 汉字内（拼多多限制 60 字符 = 30 汉字）
const TITLE_BASE = '女童珊瑚绒睡衣秋冬加厚家居服'   // 15 汉字
const SUFFIXES = ['粉色', '咖啡', '加绒', '保暖', '套装', '新款', '柔软', '亲肤', '透气', '舒适']

for (let i = 1; i <= 100; i++) {
  const d = path.join(outDir, 'item-' + String(i).padStart(3, '0'))
  fs.mkdirSync(d, { recursive: true })

  const p = JSON.parse(JSON.stringify(src))
  // 标题：基础 15 字 + 后缀 2 字 + 编号 3-4 字 = 20-21 汉字，安全
  const suffix = SUFFIXES[(i - 1) % SUFFIXES.length]
  p.title = `${TITLE_BASE}${suffix}${i}号`

  fs.writeFileSync(path.join(d, 'product.json'), JSON.stringify(p, null, 2))
}

// 校验标题长度
const lens = []
for (let i = 1; i <= 100; i++) {
  const p = JSON.parse(fs.readFileSync(path.join(outDir, 'item-' + String(i).padStart(3, '0'), 'product.json'), 'utf8'))
  // 汉字算 2 字符（拼多多按字符算，60 字符上限）
  const charLen = p.title.length
  const hanziCount = (p.title.match(/[\u4e00-\u9fa5]/g) || []).length
  lens.push({ title: p.title, charLen, hanziCount })
}
const maxChar = Math.max(...lens.map(l => l.charLen))
const maxHanzi = Math.max(...lens.map(l => l.hanziCount))
console.log(`已生成 100 个商品`)
console.log(`标题最大字符数: ${maxChar}（上限 60）${maxChar <= 60 ? '✅' : '❌'}`)
console.log(`标题最大汉字数: ${maxHanzi}（上限 30）${maxHanzi <= 30 ? '✅' : '❌'}`)
console.log(`示例: ${lens[0].title}（${lens[0].charLen} 字符 / ${lens[0].hanziCount} 汉字）`)
console.log(`末例: ${lens[99].title}（${lens[99].charLen} 字符 / ${lens[99].hanziCount} 汉字）`)
