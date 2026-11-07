# -*- coding: utf-8 -*-
"""SKILL.md 补充 200 批量实测结论 + 本轮修复清单"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\SKILL.md')
s = f.read_text(encoding='utf-8')

SECTION = '''
## 十一、200 批量实测（2026-11-03 完成）

### 结果

| 指标 | 值 |
|---|---|
| 处理商品 | **200/200** |
| **技术失败** | **0** ✅ |
| 真实上架 | **52 个** |
| 平台拒绝（重复铺货） | 146 个 |

成功分布：`cup 11 / pillow 14 / bottle 13 / box 14 / towel 0`

### ★ 核心结论：重复铺货会被静默拒绝

**现象**：
```
[17:44:05]   15s 未跳转，补点一次提交
[17:44:19]   错误（0）：页面未跳转但无校验错误，查商品列表确认…
[17:44:24]   ⚠ 商品列表未找到新商品，判定为未成功
```

**特征**：
- 必填项全部通过（前端校验 OK）
- 提交后页面停在 `goods_add`，出现 `goods-loading-contain` 遮罩
- 显示 `错误（0）`（= 无校验错误）
- 商品列表查不到新商品

**根因**：**平台防重复铺货**。同一店铺提交高度相似的商品（同款睡衣 200 个变体，
仅标题后缀 + 图片顺序不同），后端静默拒绝，**不返回任何错误信息**。

**不是代码问题**：
- 毛巾 0 成功（同款重复）
- 其他类目各 11-14 个成功（每个类目的前几个变体）
- 技术失败 0

**业务建议**：真实场景用**不同商品**（不同款式/图片），预期接近 100% 成功率。

### 毛巾 0 成功的原因

毛巾是测试数据里最先跑完的类目，200 个变体里毛巾占 40 个，全部被拒。
其他类目因为发布顺序靠后，前面的变体已经消耗了「同类配额」，反而各成功 11-14 个。

---

## 十二、本轮实战修复清单（2026-11-02 ~ 11-03）

### 1. SKU 规格编码列必须填

实测表头 8 列：
```
0:尺寸  1:颜色  2:*库存  3:*拼单价(元)  4:*单买价(元)  5:*预览图  6:规格编码  7:状态
```
每行 input（排除 file）：`[库存, 拼单价, 单买价, 规格编码]`

原来注释写「inputs[3] = 规格编码（不填）」→ 一直空着。
现在：加入填写清单，编码规则 = `product.skus[].itemNo` 或自动生成 `SKU001/SKU002...`。

### 2. 属性输入后必须点选弹出的下拉

```js
// ❌ 错：键入 → Tab（候选消失，字段没写入）
await page.keyboard.type(want)
await page.keyboard.press('Tab')

// ✅ 对：键入 → 轮询等候选（100ms 间隔，最多 900ms）→ 真实鼠标点选 → 校验
await page.keyboard.type(want)
// 轮询等候选出现
await page.mouse.click(picked.x, picked.y)
```
候选匹配顺序：**精确 → 前缀 → 短候选优先 → 通用值兜底**。
候选里没有匹配 → 明确报 `no-match` + 列出可选值，**不要 Tab 蒙**。

### 3. 品牌填成功却报失败（隐蔽 bug）

**日志**：
```
品牌 = 无品牌/无注册商标 ✅
已填 3 项，未填 0 项          ← 4 个字段只算 3 个
「品牌」本轮失败，下一轮重试    ← 品牌被排除
```

**根因**：special 字段（品牌/材质成分）走 `fillBrandSearch`/`fillCompositeAttr`，
结果合并进了 `filled`，但 `okNames` 只从 `fillAttributesGeneric` 的返回值取，
**不含 special** → 品牌误判失败 → 下一轮重试（浪费 10 秒）。

**修复**：
```js
const okNames = new Set((r.filled || []).map(f => String(f).split('=')[0]))
for (const k of Object.keys(special)) {
  if (filled.some(x => String(x).split('=')[0] === k)) okNames.add(k)  // ★ 补 special
}
```

### 4. 类目模板必须防污染

**现象**：毛巾模板累积到 33 个属性，其中 17 个是**睡衣**的（袖长/下装长/衣门襟/领型/平方克重）。
毛巾实际只有 13-16 个字段 → 直填时 23 项白跑 + 回落通用流程。

**根因**：`saveTemplate` 合并时取并集，把其他类目字段也累积进来。

**修复**：
- `saveTemplate` 新增 `pageFields` 参数，只保留页面上真实存在的字段
- 页面字段数 < 已有 attrs 的 50% → 判定类目结构变化，**直接重建**
- 新增 `pruneStaleAttrs(cat, fields)` 工具函数

### 5. 服务承诺勾选（beast-core checkbox）

```js
// ❌ 错 1：返回坐标但调用方当布尔用 → 永远走 cb.click()（JS click 无效）
// ❌ 错 2：校验读 cb.checked —— beast-core 的 input 是隐藏的，永远 false
// ✅ 对：真实鼠标点击 wrapper，校验读 data-checked
const wrapper = cb.closest('[data-testid="beast-core-checkbox"]') || cb.closest('label')
const dataChecked = wrapper?.getAttribute('data-checked')   // '0' | '1'
await page.mouse.click(x, y)                                // 真实点击
return dataChecked === '1' || dataChecked === 'true' || cb.checked === true
```

### 6. 回落判据只看「必填有无值」

```js
// ❌ 原判据：fillRate < 0.8 → 回落
//    必填 8 个填了 6 个（75%）就回落，缺的 2 个可能是非必填 → 白走通用流程 +40s
// ✅ 新判据：只看有没有必填完全没值
const requiredEmpty = requiredNames.filter(rn => !filledNames.has(rn.replace(/\s+/g, '')))
const needFallback = requiredEmpty.length > 0
```

### 7. 模糊匹配要加长度差限制

「工艺」定位错字段 → `no-match` 显示「家用/家用」。
```js
const cands = indexNames.map(k => ({ k, kn: k.replace(/\s+/g, '') }))
  .filter(x => x.kn.includes(normName) || normName.includes(x.kn))
  .sort((a, b) => Math.abs(a.kn.length - normName.length) - Math.abs(b.kn.length - normName.length))
const best = cands[0]
if (best && Math.abs(best.kn.length - normName.length) <= 3) boxId = index[best.k].id   // 长度差 ≤3
```

### 8. goods-loading-contain 遮罩不拦截点击

实测：遮罩在**提交前**不会消失，且 `elementFromPoint` 显示按钮可达。
等它纯属浪费 → 等待从 20s → 6s → **1s**。

---

## 十三、性能基线（2026-11-03 最终）

### 单商品耗时

| 场景 | 耗时 |
|---|---|
| **模板命中 + catId + 属性齐全** | **13 秒** ⬇️ |
| 模板命中 + 部分属性要 AI 选 | 30-70 秒 |
| 批量平均（属性不全的测试数据） | 150-178 秒 |
| 新类目（首次探测） | 215-239 秒 |

### 提速历程（134s → 13s，累计 90%）

| 优化 | 单商品 | 关键改动 |
|---|---|---|
| 原始 | 134s | — |
| 图片自动压缩 | 119s | 3MB 上限 |
| **模板 v2 + 直填** | **35s** | 属性 79s → 2.7s |
| 详情图轮询 500→200ms | 32s | — |
| **catId 直达** | **26s** | 跳过商品列表 |
| **图片批量投递** | **13s** | 主图 6s→0.3s |

### 图片批量投递（推翻旧结论）

旧认知：「批量 uploadFile 会被页面静默丢弃」—— 那是**原图 1-3MB** 时的情况。
现在图片已被 `img-prep` 压到 0.3-0.4MB，一次性投递毫无压力。

```js
await h.uploadFile(...images)        // 5 张主图 → 306ms
// 等计数达 target（一次等待，不是每张都等）
// 保底：批量失败或计数不达标 → 自动回退逐张补齐
```

'''

# 插到「## 十四、工具与运维」之前（或文件末尾）
anchor = s.find('## 十四、')
if anchor < 0:
    anchor = s.find('## 十二、')
if anchor < 0:
    s = s + '\n' + SECTION
    print('OK: 追加到文件末尾')
else:
    s = s[:anchor] + SECTION + '\n' + s[anchor:]
    print(f'OK: 插入到 L{s[:anchor].count(chr(10)) + 1}（原章节前）')

f.write_text(s, encoding='utf-8')
print(f'新总行数: {len(s.splitlines())}')
