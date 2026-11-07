import * as fs from 'node:fs'

// 统计每个模块在历次真实运行里的成败
const LOGS = [
  'p1.txt', 'p2.txt', 'p3.txt', 'p5.txt', 'p6.txt', 'p7.txt',
  'real20_publish5.txt', 'pajama_run3.txt', 'pajama_run5.txt',
  'batch200_v7.txt',
]
const DIR = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts'

const MODULES = [
  { key: 'stage-nav',      label: '1 类目导航',        ok: [/直达页已就绪/, /选中类目/],                      bad: [/类目页.*未出现/, /无类目搜索框/] },
  { key: 'field-basic',    label: '2 标题/参考价',     ok: [/标题 → OK/, /参考价.*→ OK/],                   bad: [/标题.*失败/] },
  { key: 'field-images',   label: '3 主图/详情图',     ok: [/主图 → 已通过/, /详情图 → 本次上传/],            bad: [/未找到主图上传控件/, /未找到详情图上传控件/, /主图第.*投递后计数未增长/] },
  { key: 'spec',           label: '4 规格维度',        ok: [/规格（视觉）→ 已填/],                          bad: [/找不到「添加规格类型」按钮/, /建维度.*两次都失败/, /本维未完成/] },
  { key: 'sku-table',      label: '5 SKU 表',          ok: [/价格库存 → 已填.*未填 0 项/],                  bad: [/未填 [1-9]/] },
  { key: 'sku-thumb',      label: '6 SKU 预览图',      ok: [/表格共 \d+ 行 → 成功 \d+ 行，失败 0 行/],        bad: [/失败 [1-9] 行/, /未填 1 项/] },
  { key: 'attr',           label: '7 属性',            ok: [/✅ 所有必填项已填/],                           bad: [/必填未填：/, /属性区 0 字段/] },
  { key: 'submit',         label: '8 提交',            ok: [/✅ 上架成功/, /✅ 商品已创建/],                 bad: [/错误（[1-9]/, /错误（0）/] },
]

for (const m of MODULES) {
  let ok = 0, bad = 0, never = 0
  const badMsgs = new Set()
  for (const f of LOGS) {
    const p = `${DIR}/${f}`
    if (!fs.existsSync(p)) continue
    const t = fs.readFileSync(p, 'utf8')
    const hasOk = m.ok.some(r => r.test(t))
    const badHit = m.bad.find(r => r.test(t))
    if (badHit) { bad++; badMsgs.add(badHit.source) }
    else if (hasOk) ok++
    else never++
  }
  const status = bad === 0 && ok > 0 ? '✅ 稳定' : bad > 0 ? '❌ 有问题' : '⚠️ 未覆盖'
  console.log(`${m.label.padEnd(16)} ${status}  成功 ${ok} 次 / 失败 ${bad} 次 / 未出现 ${never} 次`)
  if (badMsgs.size) for (const b of badMsgs) console.log(`     问题: ${b}`)
}
