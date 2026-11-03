import * as fs from 'node:fs'

const WIKI = 'C:/Users/Administrator/.dsh/profiles/desktop/wiki'

const pages = [
  {
    path: '平台/实体/拼多多重复铺货静默拒绝.md',
    title: '拼多多重复铺货静默拒绝',
    body: `# 拼多多重复铺货静默拒绝

## 现象

同一店铺提交高度相似的商品（同款睡衣 200 个变体，仅标题后缀 + 图片顺序不同）：

\`\`\`
[17:44:05]   15s 未跳转，补点一次提交
[17:44:19]   错误（0）：页面未跳转但无校验错误，查商品列表确认…
[17:44:24]   ⚠ 商品列表未找到新商品，判定为未成功
\`\`\`

## 识别特征

| 特征 | 说明 |
|---|---|
| 必填项全过 | 前端校验全部通过 |
| 页面停留 | 提交后停在 \`goods_add\` 页 |
| 遮罩出现 | \`goods-loading-contain\` 全屏遮罩 |
| 错误（0） | 表示「无校验错误」，不是真的错误码 |
| 列表查不到 | 商品列表没有新商品 |

## 根因

平台**防重复铺货**机制。后端静默拒绝，**不返回任何错误信息**。

## 实测数据（2026-11-03）

200 个商品（5 类目 × 40 变体）：

| 类目 | 成功 |
|---|---|
| cup 纸杯 | 11 |
| pillow 抱枕 | 14 |
| bottle 水杯 | 13 |
| box 收纳盒 | 14 |
| towel 毛巾 | 0 |

**技术失败 0** —— 全部是平台拒绝，不是代码问题。

## 业务建议

- 真实场景用**不同商品**（不同款式/图片/规格）
- 同款多规格应该用**SKU 维度**，不是发多个商品
- 预期不同商品可接近 100% 成功率

## 排查要点

如果批量上架出现「错误（0）」：
1. 先看商品列表确认是否真的没创建
2. 检查是否同款重复（标题相似度、图片 MD5）
3. 换一个明显不同的商品测试，能成功就确认是铺货限制
`,
  },
  {
    path: '平台/实体/拼多多属性自动化的五个隐蔽坑.md',
    title: '拼多多属性自动化的五个隐蔽坑',
    body: `# 拼多多属性自动化的五个隐蔽坑

2026-11-02 实战踩坑记录，全部有日志证据。

## 1. 属性输入后必须点选弹出的下拉

**错误做法**：键入 → Tab
**后果**：候选消失，字段没写入

**正确做法**：
\`\`\`js
await page.keyboard.type(want)
// 轮询等候选出现（100ms 间隔，最多 900ms）
await page.mouse.click(picked.x, picked.y)   // 真实鼠标点选
// 校验 input.value
\`\`\`

候选匹配顺序：**精确 → 前缀 → 短候选优先 → 通用值兜底**。
候选里没有匹配 → 明确报 \`no-match\` + 列出可选值。

## 2. 品牌填成功却报失败

**日志证据**：
\`\`\`
品牌 = 无品牌/无注册商标 ✅
已填 3 项，未填 0 项          ← 4 个字段只算 3 个
「品牌」本轮失败，下一轮重试    ← 品牌被排除
\`\`\`

**根因**：special 字段（品牌/材质成分）走独立函数，
结果合并进了 \`filled\`，但 \`okNames\` 只从通用填写的返回值取。

**修复**：
\`\`\`js
for (const k of Object.keys(special)) {
  if (filled.some(x => String(x).split('=')[0] === k)) okNames.add(k)
}
\`\`\`

## 3. 类目模板会污染

**现象**：毛巾模板累积到 33 个属性，17 个是睡衣的（袖长/下装长/衣门襟/领型）。

**根因**：模板合并取并集，把其他类目字段也累积进来。

**修复**：保存时传 \`pageFields\`（页面上真实存在的字段），只保留这些；
页面字段数 < 已有 attrs 的 50% → 判定类目结构变化，直接重建。

## 4. 服务承诺勾选用 data-checked 校验

**两个错误**：
- 返回坐标但调用方当布尔用 → 永远走 \`cb.click()\`（JS click 对 beast-core 无效）
- 校验读 \`cb.checked\` —— beast-core 的 input 是隐藏的，永远 false

**正确**：
\`\`\`js
const wrapper = cb.closest('[data-testid="beast-core-checkbox"]') || cb.closest('label')
const dataChecked = wrapper?.getAttribute('data-checked')   // '0' | '1'
await page.mouse.click(x, y)
return dataChecked === '1' || cb.checked === true
\`\`\`

## 5. goods-loading-contain 遮罩不拦截点击

**实测**：遮罩在**提交前**不会消失，且 \`elementFromPoint\` 显示按钮可达。
等它纯属浪费 → 等待从 20s → 6s → **1s**。

## 附：SKU 表规格编码列

表头 8 列，每行 input 映射：

| 列 | 内容 | input 索引 |
|---|---|---|
| 0 | 尺寸 | 无（纯文本） |
| 1 | 颜色 | 无（纯文本） |
| 2 | *库存 | inputs[0] |
| 3 | *拼单价(元) | inputs[1] |
| 4 | *单买价(元) | inputs[2] |
| 5 | *预览图 | file input |
| 6 | 规格编码 | inputs[3] |
| 7 | 状态 | 无 |

原来注释写「inputs[3] 不填」→ 规格编码一直空着。
`,
  },
]

let written = 0
for (const page of pages) {
  const full = path_join(WIKI, page.path)
  fs.mkdirSync(dirname(full), { recursive: true })
  const fm = `---
title: ${page.title}
domain: 平台
kind: 实体
subtype: 平台机制
created: 2026-11-03
updated: 2026-11-03
verified: true
source: 200 批量上架实战
---

`
  fs.writeFileSync(full, fm + page.body, 'utf8')
  console.log(`✅ ${page.path}`)
  written++
}
console.log(`\n写入 ${written} 个知识库页面`)

function path_join(...p) { return p.join('/') }
function dirname(p) { return p.split('/').slice(0, -1).join('/') }
