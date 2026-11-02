/**
 * 清理被污染的类目模板
 * 毛巾：只保留毛巾类目真实存在的 13 个字段
 */
import { loadTemplates, pruneStaleAttrs, templateAttrs } from '../skills/pdd-publish-http/scripts/category-template-v2.mjs'

const CLEAN = {
  // 毛巾：从日志「页面 13 个字段」+ 常见毛巾类目属性
  '毛巾': ['材质', '品牌', '成分含量', '产品类型', '风格', '适用场景', '安全等级',
          '工艺', '质检标准', '适用人群', '抗菌等级', '功能', '流行元素', '产地'],
}

for (const [cat, fields] of Object.entries(CLEAN)) {
  const r = pruneStaleAttrs(cat, fields)
  console.log(`${cat}: 清理 ${r.pruned} 个，保留 ${r.left} 个`)
  if (r.dropped) console.log('  移除:', r.dropped.join(', '))
}

// 验证
console.log('\n=== 验证 ===')
for (const cat of Object.keys(CLEAN)) {
  const t = loadTemplates()[cat]
  const attrs = templateAttrs(t)
  console.log(`${cat}: ${attrs.length} 个属性`)
  console.log('  ', attrs.map(a => a.name).join(', '))
}
