---
name: pdd-publish-http
description: "拼多多商品上架（HTTP 逆向模式）：统一 JSON 描述商品，图片全部 HTTP 上传到 CDN，提交体在浏览器层拦截改包后以页面身份（带 Anti-Content 签名）HTTP 重放，并调 commit/submit 确认上架。数据传输 100% HTTP，浏览器只做「签名生成+会话注册+最小石填」。支持颜色×尺码矩阵、SKU 预览图、属性显式指定。触发：拼多多上架、拼多多发布、拼多多HTTP上架、改包上架、拼多多批量上架准备。排除：采集比价（pdd-crawl）、订单/库存/客服/分析、淘宝/闲鱼发布。需绑定拼多多商家后台账号；上架为 L2，须先给预览并获同意。"
metadata:
  builtin_skill_version: "1.1"
  dsagent:
    display_name: "拼多多·HTTP上架"
    emoji: "🚀"
    requires: {}
---

# 拼多多 · HTTP 逆向上架

## ★ 多类目实测（2026-10-31 最新，真实上架 + AI 看图为证）

| 类目 | 规格形态 | goods_id / 结果 | 属性 | 必填 | 耗时 |
|---|---|---|---|---|---|
| 纸杯 | 1 维（容量 mL） | `1023381759702` 真实上架 ✅ | 8/9 | 4/4 ✅ | — |
| 手机壳 | 2 维（型号×颜色）+ 级联 | `1023382208344` 真实上架 ✅ | 8/8 | 6/6 ✅ | — |
| 抱枕 | 1 维（尺寸）+ 级联 | `1023385539665` 真实上架 ✅ | 16/16 | 12/12 ✅ | — |
| 毛巾 | 2 维（尺寸×颜色）**全新类目** | 第1次 229s / **第2次 63s**（真实提交 `1023496708207`） | 25→35 | 6/6 ✅ | **提速 54%** |
| 水杯 | 1 维（容量）**全新类目** | 155s | 28 | **8/8 ✅** | — |
| 收纳盒 | 2 维（尺寸×颜色）**全新类目** | 58s | 39 | **4/4 ✅** | — |

**毛巾两次运行证明模板复用 + 性能优化有效：**
```
第 1 次：[template] 无「毛巾」模板，本次从头探测（229s）
        [template] ✅ 沉淀模板：catId=205041314615 维度 2 属性 11
第 2 次：[template] 命中模板（2 维 / 11 属性）
        [template] 从模板补全 10 条属性
        用 catId=205041314615 直达表单页 → 直达页已就绪
        主图 5 张 6s / 详情图 10 张 12s / 属性 35 项 13s
        总耗时 63s（原 137s，提速 54%）
```

---

## 一、推荐入口

```bash
# 填到提交前（人工核对，浏览器保留 30 分钟）
node scripts/publish-v2.mjs --product-file <product.json> --account <shopKey> --confirm true --no-submit true

# 真正上架
node scripts/publish-v2.mjs --product-file <product.json> --account <shopKey> --confirm true
```

---

## 一点五、批量上架（batch-publish.mjs）

### 用法

```bash
# 目录结构：每个子目录一个 product.json
# batches/
#   ├── item1/product.json
#   ├── item2/product.json
#   └── item3/product.json

# 仅填表（人工核对，不提交）
node scripts/batch-publish.mjs --dir <目录> --account <shopKey> --no-submit

# 真实提交
node scripts/batch-publish.mjs --dir <目录> --account <shopKey> --confirm
```

### 行为

```
for each product.json:
  ① 查类目模板（命中则用 catId 直达 + 属性补全）
  ② 启动独立浏览器（避免 Profile 锁冲突）
  ③ 段1→段4 完整填表
  ④ （--confirm 时）提交并验证
  ⑤ 沉淀模板
  ⑥ 关闭浏览器 + 清理 Profile 锁
  ⑦ 等 3 秒再处理下一个
```

### 输出

- 每个商品的耗时/已填项数/结果
- 汇总 `成功 N/M`
- `batch-results.json`（结构化结果）

### 实测（3 个商品）

```
✅ bottle: 110s | 已填 34 项
✅ box:     41s | 已填 35 项
✅ towel:   92s | 已填 30 项
成功 3/3
```

### 注意

- **每个商品独立浏览器进程**：Profile 是互斥的，不能多开
- **串行执行**：不并行，因为共用同一个店铺账号
- 单个失败不影响后续（catch 后继续）

---


## 一点六、标题长度校验（提交前必查，2026-11-01）

### 关键：拼多多的「60 字符」= 30 个汉字

汉字算 **2 字符**。所以两个判据都要查：

```js
const hanziCount = (t.match(/[一-龥]/g) || []).length
const asPddLen = hanziCount * 2 + (t.length - hanziCount)   // 汉字算 2
if (hanziCount > 30 || asPddLen > 60) → 拦截
```

**踩过的坑**：只查 `t.length > 60`，遇到 33 字符但 31 汉字的标题会放过去，批量跑到第 3 个才在提交时被平台拒，白跑几分钟。

**现在**：`publish-v2` 在数据校验阶段就拦住：

```
商品数据校验未通过：标题汉字超限（31 个汉字，上限 30）
```

### 批量场景尤其重要

100 个商品里只要有一个标题超限，那个商品会失败但不影响后续（catch 后继续）。不过提前拦住能省下整个浏览器启动 + 填表的时间（约 2 分钟/个）。

---

## 二、段4 正确顺序（不可改）

```
① 规格（逐行 + 补勾）→ ② 价格库存 → ③ SKU 预览图 → ④ 属性（多轮级联）
→ ⑤ 【补】价格库存（新增行）→ ⑥ 【补】SKU 预览图（新增行）
→ ⑦ 发货售后 → ⑧ 服务承诺 → 段5 提交
```

**为什么要有 ⑤⑥**：属性级联会让 SKU 表**新增行**（抱枕 2→3 行）。
新行没有价格/预览图 → 提交报「请输入第3行规格的库存」「请上传第3行规格的预览图」。

---

## 三、规格填写（spec-row-fill.mjs）

### 真机结构

```html
<div id="newSpec">
  <input type="checkbox" checked>                 <!-- 平台自动勾选 -->
  <input placeholder="自定义容量" value="250">     <!-- 值必须纯数字 -->
  <div class="IPT_appendCell">mL</div>            <!-- 单位，固定不可填 -->
  <input placeholder="备注">
</div>
```

### 三条铁律

| 规则 | 说明 |
|---|---|
| **值必须纯数字** | `250` 不是 `250ml`。单位在 `[class*="appendCell"]` 里 |
| **逐行模式** | 填**最后一个空框** → Enter/失焦 → 平台追加新行 → 继续。**不能按索引依次填** |
| **补勾 checkbox** | 最后一个值的 checkbox 常不自动勾 → SKU 表少 1 行。填完必须补勾所有「有值未勾」的行 |

### 单位剥离（通用，无白名单）

```js
stripUnit(raw, pageUnit)
// ① 页面有单位 → 精确剥离该单位
// ② 页面无单位 → 剥离末尾非数字（保留 40x40 的 x）
```

实测：
```
250ml+mL→250   1.5kg+kg→1.5   65W+W→65   110码+码→110
40x40cm+无→40x40   256GB+GB→256   3.5寸+寸→3.5   100件+件→100
```

### 焦点定位

**必须用 XPath**，纯坐标点击键不进去：
```js
document.evaluate('.//input[contains(@placeholder,"自定义")]', root, ...)
// → focus() + click()
```

---


## 四、价格库存（sku-table.mjs）

### 列映射（真机 dump 定论）

```
表头：[容量, *库存, *拼单价(元), *单买价(元), *预览图, 规格编码, 状态]
每行 input（排除 file）：
  inputs[0] = 库存
  inputs[1] = 拼单价
  inputs[2] = 单买价
  inputs[3] = 规格编码（不填）
```

**容量列是纯文本不是 input** —— 之前全部错位就是因为按 `[0]=库存` 算。

### 单买价规则

平台要求 **单买价 ≥ 拼单价 + 1 元**：
```js
single = (price + 1.01).toFixed(2)
```

### 补填模式

`fillPriceTable` 支持 **skip-existing**：已有值不覆盖，只补空行（用于属性后补填新增行）。

---

## 五、SKU 预览图（sku-thumb.mjs）

| 坑 | 解法 |
|---|---|
| 上传后 DOM 重排 | **每行重新查 file input**，不缓存 handle |
| 有图时 file input 消失 | 完成判据用背景图 `computedStyle.backgroundImage` 含 `url(` |
| 行数异步增长 | 等行数到预期（补勾后 2→3 行） |

**二维场景**：平台会自动把同色的图下发给同色的各行，所以只上传缺图的行即可。

---

## 六、属性填写（attr-fill-generic.mjs）

### 真机结构

```html
<div class="property-item">
  <label>重要适用型号</label>
  <div id="basic.propertys.7.value">
    <input data-testid="beast-core-select-htmlInput">
  </div>
</div>
```

### 两种控件（必须区分）

| 类型 | 行为 | 校验判据 |
|---|---|---|
| 单选下拉 | 点后自动关闭，`input.value` 写入 | `inputValue` 包含值 |
| **多选下拉** | 点后**面板不关闭**，`input.value` 仍空，`box.innerText` 显示已选值 | **`boxText`** 包含值 |

只校验 `inputValue` → 多选全部误报失败。

### ★ 属性级联（最关键的坑）

**「适用型号」必须等「适用品牌」填完后才会出现**（实测 7 → 8 个字段）。
抱枕的「平方克重」同理（15 → 16 个字段）。

**解法：填一轮 → 重新采集 → 补齐新出现的字段，最多 3 轮**

```
第 1 轮：填 7 个字段
第 2 轮：属性区从 7 个增加到 8 个（级联字段出现）
        「适用型号」= iPhone 15 ✅
第 3 轮：无可填字段，结束
```

### 「重要」= 必填

带「重要」标记的字段必须填，否则平台拦。流程：
1. `harvestAttributes()` 返回 `required` 标记
2. 填完后 `checkFieldFilled()` 逐项复核
3. 必填未填 → 明确报错 `★必填未填：xxx`
4. **AI 没选中的必填字段 → 强制取候选第一个可用值**（跳过「请选择/其他」）

实测必填数：纸杯 4、手机壳 6、抱枕 12、毛巾 6。

### 字段采集（异步渲染，会漏）

属性区异步渲染，`basic.propertys.N.value` 出现时间不一致。双路径采集：

```
路径 A：扫 [id^="basic.propertys."]，从 box 内部/向上找 label
路径 B：扫所有 <label>，找它后面的 select box（补齐 A 漏掉的）
```

加渲染稳定等待（连续 4 次数量不变 **且** 已等 ≥3 秒）。

### 值的选择优先级

```
① 用户提供（product.attributes）→ 清洗脏后缀（（缓存命中）（显式指定））
② 用户没给的字段 → AI 从**真实候选**里选（pickAttrValuesByAI）
③ 必须命中候选原值（防 AI 编造）
④ AI 没选中且必填 → 兜底取第一个可用候选
```

**字段名匹配必须严格**：`填充物` 不能匹配到 `填充物净重`（只允许「页面字段名 = 用户字段名 + ≤2字后缀」）。

### AI 选值（pickAttrValuesByAI）

- 模型：`cn:glm-5.3-flash`（文本，快）
- **prompt 写临时 JSON 文件**传给 Python（直接拼 `-c` 会因换行/引号报语法错误）
- 配置来源：`pajama/imgkit.py` 的 `BASE/KEY`（**不是** aiimgnew1 的 .env）
- 实测：4/4、6/6 全部命中

### 点击选项（clickOption）

```
严格顺序：精确 > 去空格精确 > 最短包含匹配
「纸」不能匹配到「纸+PE膜」→ 取最短候选
```

失败**重试一次**（材质这类带特殊字符的候选，首次点击可能没落到正确项）。

### checkFieldFilled 判定

必须剔除所有**提示文字**，否则会把提示误判成已填值：
```
误判案例：✅ 平方克重 = 重要 / ✅ 填充物 = 重要请确保该商品中含有所选材质
剔除清单：重要 / 必填 / 请选择 / 请输入 / 点击申请 / 未找到需要的品牌
         / 请确保该商品中含有所选材质 / 标点符号
```
8/8 单元测试通过。

---


## 六点五、复合字段与搜索式下拉（attr-composite.mjs，2026-11-01）

真机上架睡衣时踩到的两类字段，形状和普通属性完全不同。**判断错交互模型就会一直填不上，而且看不出原因**。

### 类型 A：弹窗勾选型（材质成分）

**错误认知**：以为它是「加行 + 输入框」结构 → 点了按钮，等输入框出现，等不到 → 判失败。

**真实结构**（截图实证）：

```
点「添加材质成分(0/7)」→ 弹出选择面板：
  搜索框：请输入搜索内容
  ☐ 棉   ☐ 麻   ☐ 蚕丝   ☐ 羊毛   ☐ 羊绒   ☐ 其它
  ☐ 亚麻  ☐ 氨纶  ☐ 涤纶（聚酯纤维）  ...
  [确定(0/7)]  [取消]
```

**正确流程**：

```
① 点「添加XX」按钮 → 等弹窗（判据：出现「确定(N/M)」按钮 + ≥3 个 checkbox）
② （可选）在搜索框键入关键词过滤
③ 找目标选项的 checkbox → 点击勾选
④ 点「确定」
⑤ 校验：看「确定」按钮的计数变化 0 → 1，以及弹窗是否关闭
```

**★ 校验判据必须是「计数变化」，不能是「字段文本包含成分名」**
平台会改写名称：输入「聚酯纤维（涤纶）」，勾选后显示「涤纶（聚酯纤维）」。
字符串匹配 `text.includes('聚酯纤维')` 会因为顺序颠倒而失败，但实际已经填好了。

### 类型 B：搜索式下拉（品牌）

**结构**：

```html
<input placeholder="请输入品牌名称搜索">
「未找到需要的品牌？点击申请」
```

**必须先键入搜索，等候选出现，再点选**。直接 `input.value = '其他'` 不会触发候选加载，也不会被平台接受。

流程：

```
① 点击搜索框 → Ctrl+A → Delete 清空
② 键入品牌名（delay 55ms，太快候选来不及出）
③ 等 1.5s 让候选加载
④ 精确匹配 → 包含匹配 → 「其他/其它/无」时取第一个
⑤ 点选后校验 input.value 或容器文本包含品牌名
```

### 判断规则（看 label 文本就知道是哪种）

| label 特征 | 交互模型 | 处理方式 |
|---|---|---|
| 有 input，placeholder 含「搜索」 | 搜索式下拉 | 键入 → 等候选 → 点选 |
| 文本形如 `添加XX(N/M)`，**无 input** | 弹窗勾选 | 点按钮 → 弹窗 → 勾选 → 确定 |
| 有 input，placeholder 含「请选择」 | 普通下拉 | 点开 → 点选项 |
| 有 input，可自由输入 | 文本型 | 直接填 |

**排查口诀**：字段无 input 时，不要以为它坏了 —— 先看 label 里有没有「添加XX(N/M)」。

---


## 七、参考价与默认值

### 标题（新增约束）

| 规则 | 值 |
|---|---|
| 汉字数上限 | **30** |
| 拼多多算法字符上限 | **60**（汉字算 2） |
| 校验时机 | `publish-v2` 数据校验阶段（提交前） |


| 项 | 规则 |
|---|---|
| **参考价** | **默认 = `max(SKU 拼单价) + 1.02`**<br>原因：平台校验「参考价应大于商品最大**单买价**」，而单买价 = 拼单价 + 1.01<br>例：毛巾 SKU 价 19.9/29.9 → 最大单买价 30.91 → 参考价 **30.92**<br>`product.price` 显式给了且合规就用显式的，否则自动修正 |
| 默认库存 | **100**（每 SKU） |
| 默认发货时间 | **48 小时** |
| 主图数量 | **按输入全量**（1-10 张，不写死 5） |
| 提交判定 | `错误（0）` 不算错，只有 `错误（N>0）` 才停 |

---

## 七点五、服务承诺（field-service.mjs）

### 为什么需要

某些类目**强制要求**勾选「7天无理由退货」，不勾提交报：
```
该类商品，必须支持【7天无理由退换货】服务
```
纸杯/手机壳/抱枕默认已勾选，**毛巾类目需要手动勾**（2026-10-31 实测）。

### 真机结构（beast-core checkbox）

```html
<label class="CBX_outerWrapper CBX_checkbox CBX_active CBX_disabled"
       data-testid="beast-core-checkbox" data-checked="1">
  <input type="checkbox" checked disabled style="display:none">
  ...
</label>
```

**关键**：`input` 是**隐藏的**（`w=0 h=0`），真实选中状态在 `data-checked` 属性上。
- `data-checked="1"` + `CBX_disabled` → 平台强制勾选且禁用（视为已完成）
- `data-checked="0"` 且未禁用 → 需要勾选

### 判定逻辑

```js
const dataChecked = wrapper?.getAttribute('data-checked')
const isChecked = dataChecked === '1' || cb.checked
const isDisabled = cb.disabled || /CBX_disabled/.test(wrapper?.className)
```

### 扫描方式（通用，不写死文案）

```
① 找所有含「必须支持/强制要求/必须勾选/该类商品」的提示
② 从提示向上找 5 层容器，找该容器内的 checkbox
③ 未勾选 + 未禁用 → 点击 label（不是 input）
④ 校验 data-checked 变为 "1"
```

---

## 八、发货售后（field-shipping.mjs）

lib 版写死服装类目文案，非服装类目填 0 项。改为：

```
① 先试 lib 版
② 没命中 → 通用模糊匹配
   发货方式：非预售 / 现货 / 48小时内发货 / 现货发售
   发货时间：48小时发货及揽收 / 48小时发货 / 当日发货 / 24小时发货
```

---

## 九、类目模板（category-template.mjs）

### 模板结构

```json
{
  "毛巾": {
    "catId": "205041314615",
    "catePath": "...",
    "dims": [{"user":"尺寸","page":"尺寸","type":"text-input"}, ...],
    "requiredAttrs": [{"name":"品牌","value":"无品牌/无注册商标"}, ...],
    "price": "", "stock": "", "successCount": 2
  }
}
```

### 模板的两大作用

1. **catId 直达**：跳过类目搜索，直接跳表单页（省 5s）
2. **属性补全**：模板里有值的属性直接填，不用 AI 再选一遍

### ★ `--no-submit` 也沉淀模板

之前只在真正发布成功时才保存模板 → 第 2 次同类目还从零开始。
现在 `--no-submit` 填完也保存（字段已填对，值得复用）。

### 模板失效条件

- 属性结构变化（`checkSchemaFingerprint` 检测）
- 类目路径变化

---


## 图片预处理（img-prep.mjs，2026-11-01）

### 为什么必须做

拼多多主图/详情图**单张 ≤ 3MB**。AI 生成的 PNG 常在 3-4MB，直接上传的结果：

- `publish-v2` 走了 `--no-submit` 时可能**静默通过**（校验在 lib 层，preview 阶段没拦住）
- 真提交时被平台拒，或 lib 层直接 return 错误，整单失败

实测这批 15 张 AI 图：**7 张超 3MB**（最大 3.76MB）。

### 自动处理（已接入）

`publish-v2` 和 `batch-publish` 在填表前自动跑 `prepareImages()`：

```
图片预处理 → 压缩 7/15 张（上限 3MB/张）
```

**实测效果**：

| 原图 | 处理后 | 压缩率 | 策略 |
|---|---|---|---|
| 3.35MB PNG | 0.37MB | **-89%** | jpeg q=92 |
| 3.58MB PNG | 0.39MB | -89% | jpeg q=92 |
| 3.76MB PNG | 0.39MB | -90% | jpeg q=92 |

耗时 1.6 秒处理 7 张。**q=92 是高质量 JPEG，画质几乎无损**。

### 压缩策略（按顺序尝试直到达标）

1. **PNG → JPEG q=92**（通常这一步就够了，体积降 90%）
2. JPEG q=85 → q=78
3. 尺寸缩到长边 1440px + q=78
4. 长边 1440 + q=72
5. 长边 1200 + q=72
6. 长边 1000 + q=68
7. 仍超标 → 保留原图并告警

**关键**：PNG 转 JPEG 是最大杀器。AI 生成的 PNG 是无损压缩，白底图转 JPEG q=92 后肉眼几乎无差别，但体积差 9 倍。

### 工具链

优先 `sharp`，没有则用 Python PIL：

```js
const sharp = getSharp()          // 尝试 require('sharp')
const py = sharp ? null : findPython()   // 兜底找带 PIL 的 Python
```

PIL 兜底脚本做了同样的事（白底填充 → JPEG → 逐级降质/缩放 → 达标即止）。

### 产物位置

压缩后的图写到 **`<原图目录>/.publish-ready/`**，文件名改为 `.jpg`。
**原图不动**（避免破坏素材）。

### 独立使用

```bash
# 只检查（不处理）
node scripts/compress-images.mjs --dir ./img --check

# 压缩到默认 .publish-ready/
node scripts/compress-images.mjs --dir ./img

# 指定上限和输出目录
node scripts/compress-images.mjs --dir ./img --max-mb 5 --out ./compressed

# 指定文件
node scripts/compress-images.mjs --files a.png,b.png
```

### 平台上限参考

| 平台 | 主图上限 | 详情图上限 |
|---|---|---|
| 拼多多 | **3MB** | 3MB |
| 淘宝/天猫 | 5MB | 5MB |

### 压缩失败怎么办

代码里会明确列出仍超标的文件：

```
⚠ 仍有 2 张超过 3MB，请手工处理：
  - E:/path/to/detail_5.jpg
```

手工处理的选项：
- 用 Photoshop / 在线工具降到 3MB 以下
- 调低分辨率（1440px 长边足够电商用）
- 换更简单的构图（纯白底比复杂背景小得多）


## 十、性能

### 实测耗时（2026-11-02 优化后，模板复用）

| 场景 | 耗时 |
|---|---|
| **老类目（模板 + catId）** | **13 秒** ⬇️ |
| 新类目（首次探测） | 215-239s |

**累计提速：134s → 13s（90%）**

### 13 秒构成

| 阶段 | 耗时 |
|---|---|
| 模板补全属性 | 1s |
| catId 直达表单页 | 2s |
| **主图 5 张**（批量投递 306ms + 渲染） | **3s** |
| 建规格维度 | 1s |
| 视觉填规格（缓存命中） | 3s |
| 价格库存 | 1s |
| SKU 预览图 | 1s |
| **属性直填**（15 项，必填 9/9） | **2.5s** |
| 其他 | 0.5s |

### 提速清单（省 121 秒）

| 优化 | 效果 | 省时 |
|---|---|---|
| **图片批量投递** | 主图 6s→0.3s，详情图 10s→2.5s | **-10s** |
| **模板直填** | 属性环节 79s→2.7s（零扫描） | **-76s** |
| **catId 直达** | 段1+2：6s→2s（跳过商品列表） | **-4s** |
| 详情图轮询 500→200ms | 更早发现计数增长 | -3s |
| 图片自动压缩 | 7 张超 3MB 自动处理，上传更顺 | -3s（顺带） |
| 等页面稳定轮询 | 6433ms→259ms | -6s |
| 属性两阶段 + 批量校验 | 先全点选再统一校验 | -20s |

### ★ 批量投递（推翻旧结论，2026-11-02）

**旧认知**：「批量 uploadFile 会被页面静默丢弃」—— 那是**原图 1-3MB** 时的情况。

**现在**：图片已被 `img-prep` 压到 0.3-0.4MB，一次性投递毫无压力。

```js
// 主图：一次投递全部
const h = await page.$(preferredSelector)
await h.uploadFile(...images)          // 5 张 → 306ms
// 等计数达到 target（不是每张都等）

// 详情图：同理
await hBulk.uploadFile(...files)       // 10 张 → 2.5s
```

**保底**：批量失败或计数不达标 → 自动回退逐张补齐。

### ★ 模板直填（零扫描，2026-11-02）

**问题**：v1 模板只存 `{name, value}`，没存 options，导致每次都要重新扫描读候选（3 次 × 3-6s = 10-18s）。

**v2 模板结构**：
```json
{
  "attrs": [
    {
      "name": "品牌",
      "value": "其他",
      "required": true,
      "kind": "select",
      "options": ["其他", "无品牌/无注册商标", "..."],
      "optionCount": 10
    }
  ]
}
```

**直填流程**（`attr-template-direct.mjs`）：
```
① 一次 DOM 索引（~50ms）建立「字段名 → boxId」
② 逐字段直接点选（不读候选）
③ 必填填充率 <80% 或必填字段缺失 → 才回落通用流程
```

实测：15 项 / 2.5 秒，必填 9/9。

### ★ catId 直达（跳过商品列表）

模板里有 catId 时，直接 `goto` 表单页：

```js
if (!connected && catIdDirect) {
  await page.goto(`https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${catIdDirect}`)
  // 等表单就绪（出现 basic.propertys.* 或标题输入框）
}
```

省掉：打开商品列表（3s）+ 等加载（3s）+ 点发布新商品（2s）+ 等跳转（2s）。

### 失败快速检测（2026-11-02）

原逻辑无脑轮询 90 秒。现在 5 秒后开始检测明确失败信号：

| 信号 | 判定 |
|---|---|
| 跳到 `/login/` 或出现「扫码登录」 | 登录失效，立即失败 |
| 「请先完成/无权访问/操作频繁/系统繁忙」 | 页面拦截，立即失败 |
| 「加载失败/出错了/网络异常」 | 加载失败 |
| 白屏连续 5 次（2.5s） | 立即失败 |

**批次级登录预检**：批量开始前先检查一次，失效则立即 `exit(2)`，不让 200 个商品逐个失败（5 小时 → 5 秒）。

### 回滚记录（失败尝试）

**模板 dims 直建规格维度** —— 不可行
```
[tpl] 第 1/1 维「尺寸」用模板 type=custom-input 直接建
（卡 29 秒）[spec-row] 读取规格区失败：no #newSpec
```
原因：模板记录的 type 是**上次的页面状态**，但页面每次渲染结构不同。
结论：规格维度必须走视觉探测（缓存后仅 3s）。


## 十一、组件清单

| 文件 | 职责 |
|---|---|
| `publish-v2.mjs` | 主入口（参数解析 + 浏览器 + 5 段编排 + 模板沉淀） |
| `batch-publish.mjs` | 批量上架（扫描目录 + 逐个处理 + 汇总） |
| `field-service.mjs` | 服务承诺（7天无理由等强制勾选项） |
| `publish-flow.mjs` | 段3+段4 组件编排 |
| `stage-nav.mjs` | 段1 打开列表 + 段2 选类目 |
| `stage-submit.mjs` | 段5 提交 + 校验 |
| `spec-row-fill.mjs` | 规格逐行填写 + 单位剥离 + 补勾 |
| `spec-dims.mjs` | 规格维度（scanDims / alignDims） |
| `sku-table.mjs` | 库存/拼单价/单买价（列映射 + skip-existing） |
| `sku-thumb.mjs` | 每行预览图 |
| `attr-fill-generic.mjs` | 属性采集 + 填写 + AI 选值 + 必填复核 |
| `attr-composite.mjs` | **复合字段**（弹窗勾选型 / 搜索式下拉，2026-11-01 新增） |
| `attr-harvest.mjs` | 属性候选采集入库（attr-schema.json） |
| `category-template.mjs` | 类目模板读写 |
| `field-basic.mjs` | 标题 / 参考价 |
| `field-images.mjs` | 主图 / 详情图 |
| `field-shipping.mjs` | 发货售后（通用模糊匹配） |
| `vision-fill.mjs` | 视觉分析规格区 |
| `vision-cache.mjs` | 视觉分析结果缓存 |
| `analyze_spec_ui.py` | 视觉模型调用（截图 → JSON） |
| `img-prep.mjs` | **图片自动压缩**（3MB 上限，PNG→JPEG q92，2026-11-01 新增） |
| `compress-images.mjs` | **独立压缩工具**（--dir / --files / --check，2026-11-01 新增） |
| `imgprep.py` | 图片规整（旧版，Python） |

### 新增组件说明（2026-11-01）

**`attr-composite.mjs`** —— 处理两类「看起来是属性、实际交互完全不同」的字段：

| 导出函数 | 用途 |
|---|---|
| `fillCompositeAttr(page, boxId, name, value, opts)` | 弹窗勾选型（材质成分）：点按钮 → 弹窗 → 勾 checkbox → 点确定 |
| `fillBrandSearch(page, boxId, brand, opts)` | 搜索式下拉（品牌）：键入搜索 → 等候选 → 点选 |
| `parseCompositeValue(raw)` | 值解析（`'聚酯纤维（涤纶）'` → `{name, pct}`） |

**`img-prep.mjs`** —— 上传前自动压缩：

| 导出函数 | 用途 |
|---|---|
| `prepareImages(files, {maxBytes, log})` | 批量预处理（达标复用，超标压缩），返回 `{files, detail, stats}` |
| `checkImageSizes(files, maxBytes)` | 只检查不处理 |

**`compress-images.mjs`** —— 命令行入口：

```bash
node scripts/compress-images.mjs --dir ./img --check
node scripts/compress-images.mjs --dir ./img --max-mb 3
```

---

## 十二、组件化铁律

**组件化 = 结构化拆分，不是重写逻辑。**

已验证的函数直接 re-export，只改真正需要改的。
之前把验证过的属性/规格逻辑重写，导致上架全线崩，浪费了大量时间。

## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> ```
> dsagent_wiki_search(keyword="风控")            # 两页都列出来
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")
> ```

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| `54001` | `risk_control` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| `40002` | `rate_limit` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| `100001` | `rate_limit` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| `43001` | `token_expired` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| `40001` | `token_expired` | 未登录 | 重新扫码登录 |
| `40010` | `no_permission` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| `2000000` | `no_permission` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| `48143` | `api_error` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| `3000000` | `api_error` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP `430` | `rate_limit` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| `detached Frame` / `Target closed` | `risk_control` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 三条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。

### 其他已知坑

- **两个登录态不通用**：`pdd`（H5 买家态，`.yangkeduo.com`）与 `pdd_mms`（商家后台态，`mms.pinduoduo.com`）是两套独立账号，各跑一套风控评分。
- **`Failed to launch the browser process!`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：`~/.dsh/pdd-account-locks` 无关，要杀占用该 Profile 的 chrome 进程 + 删 `SingletonLock`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，`_shared/pdd-risk.mjs` 的账号锁会拦住，看到「正被其他任务占用」就等等。

<!-- RISK-CHEATSHEET:END -->


> **重要:** 上架是**不可撤销的真实操作（L2）**。必须两步走：先拿「上架预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `--confirm true`。

## 何时使用

- 用户说「拼多多上架」「拼多多发布」「拼多多HTTP上架」→ 用本技能
- 用户给出一件商品的**统一 JSON**（标题 + 图片 + 规格 + SKU 行）要求发到拼多多 → 用本技能
- 商品规格是**二维**（颜色 × 尺码）→ 用本技能（原生支持矩阵）
- 想让**图片/价格/SKU 全部走 HTTP**（不依赖 DOM 逐格填表，快且抗页面结构变动）→ 用本技能
- 用户明确要求「逆向」「改包」「HTTP 提交」→ 用本技能

## 前置条件

调用本技能前必须满足：

1. **账号已绑定**：「账号连接」页已绑定**拼多多商家后台**（mms.pinduoduo.com）。
   ★ 它与买家端拼多多是两套完全独立的登录态，买家账号不能用于上架。
2. **登录态有效**：`dsagent_check_account_health(platform=pdd_mms)` 返回 valid；
   失效时引导用户到「账号连接」重新登录（需商家版 App 扫码）。
3. **图片就绪**：主图 1~10 张（单张 ≤3MB、JPG/PNG）；如发带规格商品，第 1 维每个规格值
   都要有预览图（宽高比 1:1、宽高 >480px）——否则 submit 报「请上传规格缩略图」。
4. **规格池就绪**（可选但推荐）：`assets/spec-pool.json` 或 workspace 的
   `artifacts/pdd-re/spec-pool.json`。没有也能发（平台按 spec_value 自解析），但规格 ID
   可能与店铺历史不一致。
5. **Chrome 可用**：本机装有 Chrome/Edge（浏览器驱动用）。
6. **无并发**：同一时刻不要跑两个拼多多发布任务（浏览器 Profile 独占锁会互斥）。

## 能力

| 项 | 说明 |
|---|---|
| 图片上传 | **纯 HTTP**：`get_signature` → `file.pinduoduo.com/v3/store_image` → `garner/mms/file/create` → `queryFileDetail`，主图/详情图/SKU 预览图全走 CDN |
| 规格矩阵 | 颜色×尺码二维，`skus[]` 按 `sku_key` **行数重建**（页面只建 1 行空壳也能改成 8 行） |
| spec_id | **规格池**（`assets/spec-pool.json`，店铺历史商品采集）本地查表，含 cm 归一匹配 |
| SKU 预览图 | `upload_spec_img_map`（颜色值 → CDN URL+fileId）→ 写入 `skus[].thumb_url` |
| 商品属性 | `draco-ms` 模板查询 + 改包写 `goods_properties[]`（vid/content） |
| 提交 | 拦截 `goodsCommit/action/edit` → 改包 → **abort 原请求** → 页面 fetch 带签名重放 |
| 确认上架 | `POST /glide/v2/mms/edit/commit/submit`（6 字段：commit_id/goods_id/is_onsale/third_type/if_allow_submit_mall_checking/crawlerInfo） |

## 边界

- **不做商品采集与比价** → 用 `pdd-crawl`
- **不做订单 / 售后 / 库存 / 客服 / 数据分析** → 用对应平台技能
- **不做淘宝 / 天猫 / 闲鱼发布** → 用 `taobao-publish` / `xianyu-publish`
- ★ **Anti-Content 签名必须由页面生成**（风控 SDK 采集浏览器行为，Node 算不出）——这是唯一必须开浏览器的原因
- ★ **提交会话必须由页面注册**（点「发布新商品」→ URL 分配 commit_id/goods_id）
- ★ **品牌默认填「无」**：商品 JSON 未给 `attributes` 里的品牌时，自动补 `品牌=无`（DEFAULT_BRAND 可改）。
  若某类目要求真实品牌资质，「无」可能仍被审核拦，需人工补品牌授权
- ★ **图片会自动规整**（`scripts/imgprep.py`，Python+PIL）：
  详情图统一到 750 宽，超高（>1500）按均分切分（不切断文字/人脸）；
  主图/规格图 → 补白成 1:1（不裁切商品）；>3MB → 质量阶梯压缩
- ★ **规格值完全自定义**（`scripts/dom-fill-spec.mjs` + `scripts/spec-resolve.mjs`）：
  - **自由维度**（款式/型号/容量/尺寸/口味/器型/材质/适用人群等）→ 值原样提交，**写什么就是什么**
  - **字典维度**（颜色分类/参考分类）→ 必须命中规格池，否则报错中止
  - 全类目通用：不硬编码「颜色分类」，读页面预置行 + 按维度名匹配（`specTypeScore` 扩展 10+ 类维度）
  - DOM 填规格 7 步流程：
    ① 打开类目 → 表单页
    ② 等任意规格容器（`detectAnySpecRow`，不再只等「颜色分类」）
    ③ 读页面实际有哪些预置行
    ④ 用户 specs 按维度名匹配页面行（`specTypeScore` 模糊匹配）
    ⑤ 逐个值：键入 → 失焦 → 等平台分配 spec_id
    ⑥ 价格表逐行填价 + 参考价
    ⑦ commit/submit
  - 维度 parent_id 来自 `assets/dim-parent.json`（来源：`POST /glide/v2/mms/query/spec/name/list`）
  - 单维 SKU 和二维 SKU 都支持
  - ❌ 废弃：`preflight.mjs → borrowSpecIds`（借位会让平台按 id 还原成别人的名字）
- ★ **商品资质**仍需人工补全（平台因类目而异）

## 输入

脚本入口 `{baseDir}/scripts/publish.mjs`，对话内也可直接调 host 工具 `dsagent_pdd_publish2`。

★ **2026-10-28：`mode2` 改包不再是默认路径。** `publish.mjs` 按"商品是否有规格维度"
自动决定提交模式：

| 商品形态 | 提交模式 | 说明 |
|---|---|---|
| 有 `specs`（颜色/尺码等） | **DOM 全填，mode2 关闭** | 规格/价格/预览图/参考价全部由页面填，走页面自然提交 |
| 无 `specs`（单 SKU） | **mode2 改包** | 注入 gallery/skus，无需建规格 |

原因：改包会和页面状态冲突（参考价被覆盖回商品 price）导致提交被拦/超时，
而平台校验的就是页面状态。所以带规格的商品一律走 DOM 路线。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `--product-file` | string | 是* | 统一商品数据 JSON 文件路径（*与 `--product`/`--from-pack` 三选一） |
| `--product` | string | 是* | 统一商品数据 JSON 字符串 |
| `--from-pack` | string | 是* | **1688 素材包目录**（含 `product.json` + `src/`）：自动组装商品并上架 |
| `--gen` | string | 否 | AI 生图输出目录（含 `main_1..5` / `detail_1..10`）；`--from-pack` 时必填 |
| `--price-factor` | number | 否 | 价格系数（1688 均价 × 该系数），默认 `2` |
| `--max-colors` | number | 否 | 最多取几个颜色，默认 `3` |
| `--max-sizes` | number | 否 | 最多取几个尺码，默认 `3` |
| `--category` | string | 否 | 拼多多类目搜索词，`--from-pack` 时用于组装，默认 `儿童睡衣` |
| `--confirm` | flag | 否 | 省略 → **只返回预览，不产生任何写操作**；带 `true` → 真正上架 |
| `--account` | string | 否 | 账号 shopKey；多账号未绑定时先向用户确认 |

### `--from-pack` 模式（1688 抓货 → AI 生图 → 上架 一条龙）

```bash
node scripts/publish.mjs \
  --from-pack "<1688素材包目录>" \
  --gen "<AI生图输出目录>" \
  --category 儿童睡衣 --price-factor 2 \
  --account <shopKey> --confirm true
```

组装规则（全自动，无需手写 product.json）：

| 字段 | 来源 |
|---|---|
| 颜色 / 尺码 / SKU 行（价格+库存） | **1688 真实 `skus[]`** 命中筛选，不造假 |
| 标题 | 1688 `product.title`（截 60 字） |
| 主图 5 + 详情 10 | AI 生图目录 `main_1..5` / `detail_1..10` |
| 规格/SKU 预览图 | **按颜色分配**（第 i 个颜色用第 i 张主图） |
| 价格 | 1688 均价 × `--price-factor` + `.9` 尾数 |
| 属性 | 1688 原始属性名直传 → `fillAttributes` 里 `ATTR_ALIAS` 21 组别名映射 |

### `product` 统一结构

```jsonc
{
  "title": "儿童摇粒绒家居服套装 男童女童加厚保暖睡衣",   // 必填，≤60 字符
  "images": ["D:\\imgs\\main1.jpg", "D:\\imgs\\main2.jpg"], // 必填，本地绝对路径，1~10 张，单张 ≤3MB
  "detailImages": ["D:\\imgs\\d1.jpg"],                  // 选填，详情图，≤50 张，单张 ≤3MB
                                                        // ★ 平台硬规则：宽 480~1200px，高 ≤1500px
                                                        // ★ 逐张单图按顺序传，不要拼长图
  "category": "儿童家居服 家居服套装",                    // 选填，类目关键词；不传从标题推断
  "price": "69.9",                                        // 选填，参考价
  "stock": "1000",                                        // 选填，默认库存（SKU 行缺项回落）

  // ── 规格维度（选填，≤2 维；与 skus 配合）──
  "specs": [
    { "name": "颜色", "values": [
        { "value": "格蕾灰", "image": "D:\\imgs\\c1.jpg" },  // 第1维可带预览图（宽高比1:1、>480px、JPG/PNG）
        { "value": "银河蓝", "image": "D:\\imgs\\c2.jpg" }
    ] },
    { "name": "尺码", "values": [ { "value": "110cm" }, { "value": "120cm" } ] }
  ],

  // ── SKU 行（每行 specs 覆盖全部维度）──
  "skus": [
    { "specs": { "颜色": "格蕾灰", "尺码": "110cm" }, "price": "69.9", "stock": "200" },
    { "specs": { "颜色": "格蕾灰", "尺码": "120cm" }, "price": "69.9", "stock": "200" }
  ],

  // ── 商品属性（显式 name→value；命中页面选项才生效）──
  "attributes": [ { "name": "主面料成分", "value": "棉" } ],

  "account": "pdd_mms_xxxx"                              // 选填，指定账号 shopKey
}
```

**字段规则**

- `title` 必填 ≤60 字符；`images` 必填 1~10 张、单张 ≤3MB、本机绝对路径且真实存在
- `specs` ≤2 维；仅第 1 维的值可带 `image`（SKU 预览图）
- `skus` 每行 `specs` 覆盖全部维度；`price` 正数、`stock` 非负整数
- 兼容富格式：`colors[]` + `sizes[]` 会自动合成两维

**默认值**（用户没提就照此，不要追问）：库存省略 → 1000；单买价 → 拼单价 +1 元；货号 → 不写。

## 输出

| 字段 | 类型 | 含义 |
|------|------|------|
| `ok` | boolean | 业务是否成功。★ **预览时是 `ok=false` + `needConfirm=true`，正常流程不是报错** |
| `needConfirm` | boolean? | `true` 表示等用户确认 |
| `text` | string | 面向用户的中文文案（预览/成功详情/失败原因），原样转述 |
| `failureKind` | string? | `not_bound` / `need_account_choice` / `token_expired` / `risk_control` / `api_error` |
| `accounts` | array? | 仅 `need_account_choice` 时出现 |
| `shopKey` / `finalUrl` | string? | 实际账号 / 当时页面 URL |

三种典型返回：**① 预览**（无 `--confirm`）→ `ok=false` + `needConfirm=true`；**② 成功** → `ok=true` + text 含「已确认上架」；**③ 失败** → `ok=false` + `failureKind`。

## 工作流

### W1：上架一个新商品（标准链路）

```
① 从用户话提取商品信息，组装 product JSON
   （title + images 必需；缺 title 或 images 要主动问，不要猜）
② 先取预览：不带 --confirm
   → 返回 ok=false + needConfirm=true + 预览文案（不启浏览器、零写操作）
③ 把预览完整展示给用户，征求明确同意（L2 门禁，不可跳过、不可自行假设同意）
   同时提醒：品牌已自动填「无」；商品资质（如 3C/A类检测报告）仍需在弹出窗口内人工补全
④ 用户明确同意后，带 --confirm true 重新调用
⑤ 报告结果：ok=true → 告知已上架 + 商品 ID + 平台仍会审核；
   failureKind → 按「错误处理」表走
```

### W2：批量上架同款多链接

```
① 为每个链接准备独立 product JSON（标题/主图差异化，避免被判重复铺货）
② 逐个走 W1（每次都要单独拿用户同意，不要一次同意批量执行）
③ 或改用 pdd-link-matrix 技能（一图多发主图变体）
```

### W3：规格/价格与历史商品对齐（省事路径）

```
① 有同类历史商品 → 走「三层查一复用」L2：拉 on_shop/detail 拿规格池，改 values 后提交
② 没有历史商品 → 走 L3：draco-ms 属性树 + cabernet 尺码树
③ 类目已知 → L1 直接命中 cat-memory.json
```

## 执行流程

```
① 组装 product JSON（从用户话提取；title + images 必需，缺了主动问）
② 先取预览：不带 --confirm          → ok=false + needConfirm=true（不启浏览器、零写操作）
③ 把预览完整展示给用户，征求明确同意（L2 门禁，不可跳过、不可自行假设同意）
   同时提醒：品牌已自动填「无」；商品资质（如 3C/A类检测报告）仍需在弹出窗口内人工补全
④ 用户同意后带 --confirm true 重新调用
⑤ 报告结果：ok=true → 告知已上架 + 商品 ID + 平台仍会审核；
   failureKind → 按「错误处理」走
```

### 内部执行链（`--confirm true` 时，约 60~90 秒）

```
① HTTP  图片预上传      主图/详情图/预览图 → CDN URL（0.8s/张）
② 本地 规格池查表       规格值 → spec_id（assets/spec-pool.json；空池自动跳过）
③ 页面 点「发布新商品」  → URL 拿 goods_commit_id / goods_id
④ 页面 选类目并确认     （会话注册）
⑤ 页面 DOM 逐张传主图   全部主图（最多 5 张），每张 CDP 兜底
⑥ 页面 DOM 填规格       有 specs 时：建/填维度 → 预览图 → 价格表 → 参考价
   （无 specs 则跳过，改由 mode2 改包注入 gallery/skus）
⑦ 页面 点提交           有 DOM 全填 → mode2 关闭，走页面自然提交
   （无 DOM 填 → mode2 改包：拦截 + 页面 fetch 重放）
⑧ 页面 fetch 调 commit/submit → 确认上架
```

### 全类目通用适配（2026-10-29 定稿）

**规格维度按页面结构自动适配，不假设固定名字：**

| 页面有什么 | 怎么填 |
|---|---|
| `input[placeholder*="主色"]` | 颜色输入框：真实键盘键入 → blur |
| `input[placeholder="自定义尺码"]` | 尺码：走自定义输入（不勾预设 S/M），取最后一个空框 → 键入 → blur |
| 待勾 checkbox `.package-item-container` | 精确匹配 → 语义匹配（110↔110cm/110-120）→ 自定义输入添加 |
| 都没有（新维度） | 点「添加规格类型」→ 下拉选词 → 输入框填值 |

**关键约束（改代码前先读）**

1. **规格值必须 `page.keyboard.type`** —— 平台只认真实键盘事件才注册 spec_id。JS setter 写入值但**不生成 SKU 行**（实测 0/6）。
2. **点击一律用 `jsClick`**（`document.elementFromPoint(x,y).click()`），不用 `page.mouse.click`；blur 用 `jsBlur`（`document.activeElement.blur()`）。
3. **价格/库存用 JS setter**（纯数字，React setter + input/change 事件足够）。
4. **图片路径必须短 ASCII** —— 中文长路径会让 `uploadFile` 静默失败（报「商品轮播图不能为空」）。`publish.mjs` 已自动复制到 `tmpdir/pddupl/`。
5. **主图 input 是隐藏控件** —— `uploadFile` 可能不生效（计数 `0/N`），必须读计数并 CDP `DOM.setFileInputFiles` 兜底。
6. **属性先填、规格后填** —— 属性下拉重渲染会把规格勾选/预览图状态冲掉。
7. **材质成分是 IngredientList** —— 按钮「添加材质成分(N/7)」+ 弹窗多选 + 「确定(N/7)」，不是下拉也不是输入框。
8. **尺码表要停用两次** —— 填规格前一次（如已存在）、填完尺码后一次（尺码值填完才生成）。

### 多类目实测结果（2026-10-29）

| 类目 | 结果 |
|---|---|
| 童装/儿童家居服 | ✅ 9 SKU（3 色 × 3 码） |
| 纸杯 | ✅ 1 维度 |
| 手机壳 | ✅ 2 个新建维度（色号 × 型号） |
| 连衣裙 | ✅ 4 SKU（颜色 + 尺码自定义输入） |
| 保温杯 / 零食 / 蓝牙耳机 / 抱枕 | ✅ 各 2-4 SKU |

**连续批量**：10 个不同款式全自动上架，成功率 10/10（单批 ~4 分钟/款）。


## 平台硬规则（实测踩坑记录，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| `goodsCommit/action/edit` 只**暂存** | 返回 success 但**不落库**；必须再调 `commit/submit` 才上架 |
| 提交前页面校验轮播图非空 | 「商品轮播图不能为空」→ 必须 DOM 传至少 1 张主图 |
| 标题必须进提交体 | DOM `fillTitle` 偶发不被 React 受理 → 改包时按 `detail.title` **强制写** `goods_name` |
| SKU 预览图提交必填 | 「请上传规格缩略图」→ 第 1 维每个值的 `image` 都要提供（宽高比 1:1、>480px、<3MB、JPG/PNG） |
| 单买价 ≥ 拼单价 +1 元 | 两列同值必被拦；工具自动按拼单价 +1 填 |
| `upload_sign` 一次性 | 每张图都要重新 `get_signature`（第 2 张起复用会 48005「签名已过期」） |
| anti_content 会失效 | 连续复用同一签名后续请求被拒；每次请求前重新生成 |
| 两种签名不可混用 | `upload_sign`（~620字符）只给 `store_image` 表单字段；`Anti-Content`（~500字符）只给请求头 |
| **详情图尺寸** | **宽 480~1200px，高 ≤1500px，逐张单图按顺序传**。**绝对不要自己拼长图** —— 把 9 屏拼成 750×9240 再传必被驳回「请重新上传第1张详情图」 |
| **新规格值直接键入即可** | 2026-10-27 实测：往页面「主色/自定义」输入框键入任意新值（如「清紫梅花」）平台直接接受，**不需要 spec_id、不需要借位**。借位反而会让平台按 id 还原成别人的名字 |

## 详情图正确做法

**拼多多详情图 = 多张独立单图，按顺序上传。** 不要拼长图。

```jsonc
"detailImages": [
  "D:\\imgs\\01-首屏.jpg",     // 750×960
  "D:\\imgs\\02-卖点.jpg",     // 750×900
  "D:\\imgs\\03-面料.jpg",     // 750×960
  "D:\\imgs\\04-花色.jpg"      // 750×1340
]
```

| 做法 | 结果 |
|------|------|
| ✅ 每屏单独出图，逐张按顺序传 | 合规，一次过 |
| ❌ 先拼成一张长图再传 | 驳回：高度超 1500px 上限 |

> 长图只在**淘宝详情 / 小红书**用，拼多多不吃。

## 图片规整（imgprep.py，自动执行）

`publish.mjs` 上传前自动调用 `scripts/imgprep.py`，无需手工处理。
**它的定位是「兜底」而不是「主流程」** —— 主流程应该是你直接出合规单图。

### 详情图处理顺序（固定，不跳步）

```
① 宽度统一到 750
   超宽（>750）→ 等比压到 750
   过窄（<750）→ 等比放大到 750
② 再看高度：高 > 1500 → 切分（宽度始终 750，绝不缩窄）
③ 高 ≤ 1500 → 直接用
```

**为什么不「压缩高度」**：750×1800 若按高缩到 1500，宽度会跟着变成 625 —— 竖版图被压窄、比例失真。平台要的是**宽度保持 750**，超高的唯一正确解法是切分。

### 切分规则：均分

`n = ceil(高 / 1500)`，每段高 ≈ 高/n。

| 输入 | 输出 |
|------|------|
| 750×1800 | 2 张（824 / 976） |
| 750×6000 | 4 张（1500 × 4） |
| 750×1501 | 2 张（660 / 841） |
| 1500×3000 | 先压 750×1500 → 正好合规，不切 |
| 1500×6000 | 先压 750×3000 → 切 2 张（1500 × 2） |

**均分而非「找平坦行切」**：均分后每段高度接近、没有碎片，切点固定不漂移。实测拼回原图逐像素比对，均值差仅 1.1（JPEG 重编码误差），**上下完全连贯**。

> 仅在均分点 ±12% 段高的小窗口内微调以避开切断文字/人脸，且强制每段 ≤1500。

### 其他图片

| 情况 | 处理 |
|------|------|
| 主图非 1:1 或边长 < 800 | **补白成正方形**（不裁切，避免切掉商品） |
| 规格图非 1:1 或边长 < 480 | 补白 + 放大到 480 |
| 体积 > 3MB | JPEG 质量阶梯压缩，必要时降分辨率 |

## 规格池维护

规格池是「规格值 → spec_id」映射（店铺内稳定复用），位于：
1. `<workspace>/artifacts/pdd-re/spec-pool.json`（优先）
2. `{baseDir}/assets/spec-pool.json`（技能自带兜底）

**★ 2026-10-28 修：空池不再遮蔽兜底池。**
`publish.mjs` 以前"找到第一个文件就用"，而 workspace 里那份常是采集失败留下的
空壳（`pool:{}` / `goodsScanned:0`），会把 `assets/spec-pool.json` 里有货的池
整个盖住，导致运行时永远拿到空池。现在按"有货"判定：`pool` 里至少 1 个维度、
1 个带 `spec_id` 的值；空文件会被跳过并打印 `规格池无货，跳过：…`。

**采集方式**（推荐，一条命令）：

```bash
node {baseDir}/../pdd-works/scripts/query.mjs --mode spec-pool
```

它遍历店铺全部历史商品，拉 SKU 详情抽出 `{颜色分类: {格蕾灰: {spec_id, parent_spec_id}}, 参考分类: {110: {...}}}`。
**新增颜色/尺码时**：先把带新规格的商品发布一次，再重跑采集，池子就更新了。

### spec_id 借位（已废弃）

**实测结论：DOM 填规格路线下「值写什么就是什么」，借位会让平台按 id 还原成别人的名字。**

- ❌ 2026-10-27 起 `borrowSpecIds` 已从 `preflight.mjs` 删除，不再自动借位。
- ❌ 不要再教用户"借 spec_id 让新花色过审"——那会把商品显示成别人的花色。
- ✅ 新规格值直接键入，平台会按文本自行注册。

## 三层查一复用（发布加速）

同类目重复发布时，可跳过「选类目 + 建规格」：

```bash
node {baseDir}/scripts/reuse.mjs --category "儿童家居服 家居服套装"
```

- **L1** 类目记忆（`artifacts/pdd-re/cat-memory.json`）→ 直接用该类目
- **L2** 存量商品（`/glide/v2/mms/query/commit/on_shop/detail`）→ 170 字段完整提交体 + 规格池提取
- **L3** 新类目 → 拉属性树（`draco-ms` 模板 + `cabernet` 尺码树）

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定拼多多商家后台账号 | `not_bound` | 引导到「账号连接」添加**拼多多商家后台**（mms.pinduoduo.com）；★ 买家端拼多多账号不能用于发布 |
| 平台多账号且会话未绑定 | `need_account_choice` | **把候选列表给用户选**，把选定 shopKey 填 `--account` 重调；★ 绝不要自己挑 |
| 登录态失效 | `token_expired` | 引导到「账号连接」重新登录拼多多商家后台 |
| 命中滑块 | `risk_control` | 调用 `dsagent_risk_verify(platform=pdd_mms)` 拉验证页，用户拖完滑块后重试 |
| product 非法 / 缺 title/images / 图超 3MB | `api_error` | 按文案修正后重试（校验在浏览器启动前，零写操作） |
| 提交被拦（校验错误） | `api_error` | text 里有平台原文（如「商品标题必须填写」「请上传规格缩略图」）；按提示补 product 字段重试 |
| commit/submit 失败 | `api_error` | text 含 error_code + error_msg；常见 100027（标题空，已自动强制写）/100055（缩略图缺） |
| 页面结构变更导致找不到入口 | `api_error` | 让用户在窗口内手动点「发布新商品」后重试；或检查插件 `lib/pdd-publish.js` 的锚点配置是否需更新 |

## 已知稳定现象（不要当故障）

- 发布全程约 60~90 秒（图片 HTTP 上传 ~22s + 页面链路 ~40s）
- 提交后跳转 `goods_add/success?...&wait_audit=false` 表示**免审直接上架**；`wait_audit=true` 则等平台审核
- 商品列表接口有索引延迟，发完立刻查可能查不到，等 1~2 分钟
- 「SKU 预览图上传未确认」是 DOM 回读探测的误报，提交体里 thumb_url 实际已注入（以 submit 结果为准）

## 技术背景

本技能是拼多多发布链路的 HTTP 化重构（原 DOM 逐格填表方案已废弃）。核心实现位于插件 lib：

| 模块 | 职责 |
|------|------|
| `lib/pdd-image-preupload.js` | 图片批量预上传编排（去重/校验/回填 URL） |
| `lib/pdd-image-space.js` | `store_image` 四步链（照抄觅千手原文） |
| `lib/pdd-mode2.js` | 改包引擎（行数重建/规格池/预览图/价格匹配/submit） |
| `lib/pdd-publish.js` | 页面链路（会话注册/最小石填/拦截/兜底） |

## 知识库

完整逆向笔记（含全部踩坑记录、接口清单、错误码攻关录）：
`E:\360MoveData\Users\Administrator\Documents\Obsidian Vault\逆向\平台\拼多多商品提交HTTP逆向.md`
