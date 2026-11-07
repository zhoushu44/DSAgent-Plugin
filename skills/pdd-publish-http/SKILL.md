---
name: pdd-publish-http
description: "拼多多商品上架。两条路径：① publish-by-copy.mjs 复制本店同类目商品改包（快，6 单实测成功，但不能换主图）② publish-flow.mjs 页面全流程提交（慢，能换图/处理复杂属性）。改 SKU 支持 1~2 维、任意自定义规格名与数量。product.json 字段：title(≤30汉字)/images/imageUrls/price/stock/specs/skus。首次用新类目必须先跑 harvest-native-props.mjs 采类目模板（拿到 propertys_tid / template_module_id / 品牌 vid）。内置 pdd-antiban 节流与滑块 shadow hook。触发：拼多多上架、拼多多发布、拼多多批量上架、复制商品上架、改包上架、拼多多改SKU。排除：采集比价(pdd-crawl)、订单/库存/客服/分析、淘宝/闲鱼/抖店发布。需绑定拼多多商家后台账号；发布为 L2，须先 --dry 预览并获用户同意后才加 --confirm。"
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    display_name: "拼多多·商品上架"
    emoji: "🚀"
    requires: {}
---

# 拼多多 · 商品上架

> 本文档所有「实测」结论均来自真实运行日志（`artifacts/pdd-publish-by-copy/run-*.log`、`pdd_js_analysis/reports/flow-*.log`）。
> 未验证的内容明确标注「未验证」。

## 快速开始（30 秒决定用哪条路）

| 场景 | 用哪个脚本 | 限制 |
|---|---|---|
| 想快点发 | `publish-by-copy.mjs` | 复制**本店已有商品**再改包；规范记录 6 个成功 goods_id，但当前原始日志缺失，未验证。不要指望跨店复制或反复复制同一源商品。 |
| 必须换主图 | `publish-flow.mjs`（页面路径） | 不要把纯 HTTP `file/create` 当可用方案：规范记录其返回 `40002 操作太过频繁`。换主图仅有 goods_id `1026511479126` 的一次成功记录，之后无法复现；原始日志缺失，未验证。 |
| 批量发 | `batch-publish.mjs` | **未验证**：只有代码，无成功记录；不能因为脚本存在就按已跑通使用。 |
| 首次用新类目 | 先用 `harvest-native-props.mjs` 采集该类目模板，再选择发布路径 | 不复用其他类目的 `propertys_tid`、`template_module_id` 或品牌 `vid`。规范记录已采 cat16675 / cat22278，当前采集日志与产物缺失，未验证。 |

> 证据边界：上表的历史成功与失败范围均转述自 `_CLEANUP_SPEC.md`；规范点名的 `artifacts/pdd-publish-by-copy/run-*.log` 和 `pdd_js_analysis/reports/flow-*.log` 在当前工作树中缺失，因此不视为本次实测结论。发布前仍需核对店铺、类目、模板和商品归属。

## 目录

1. [一、两条发布路径](#一两条发布路径)
2. [二、脚本清单（按用途分组，不按文件名）](#二脚本清单按用途分组不按文件名)
3. [三、product.json 格式](#三productjson-格式)
4. [四、类目模板与品牌](#四类目模板与品牌)
5. [五、限流与风控](#五限流与风控)
6. [六、已知失败清单（不要重复踩）](#六已知失败清单不要重复踩)
7. [七、排障速查](#七排障速查)

---

## 一、两条发布路径

本章只区分**复制本店商品改包**与**页面全流程提交**两条主路径。命令依据当前脚本参数整理；成功编号与限制依据 `skills/pdd-publish-http/_CLEANUP_SPEC.md`。规范点名的原始运行日志未随当前工作区提供，因此下表是「规范记录」，不是本章重新实测的结果。

| 场景 | 路径 | 入口 | 结论 |
|---|---|---|---|
| 本店已有同类目商品，优先快速改包 | 复制路径（推荐） | `publish-by-copy.mjs` | 免选类目，继承源商品结构；规范记录 6 单成功 |
| 需要走页面表单、上传主图与详情图 | 页面路径 | `publish-flow.mjs`，由 `publish-v2.mjs` 调用 | 按页面顺序填表并提交；规范记录 4 单成功 |
| 批量执行页面路径 | 批量入口 | `batch-publish.mjs` | **未验证**：只有代码，无成功记录 |

### 1.1 复制本店商品改包：`publish-by-copy.mjs`（推荐）

#### 用途

复制**本店同类目**的已有商品为草稿，再修改标题、规格/SKU、价格库存及可选图片并提交。类目和属性结构随源商品继承，不从空白发布页重新搭建。

#### 前提

1. 浏览器账号 Profile 已登录拼多多商家后台，`--shop <shopKey>` 指向该账号。
2. 本店有同类目商品可作为 `--source`；跨店复制会报「该商品不属于该店铺」（旧 `SKILL.md` 记录）。
3. 同一源商品不能连续重复复制；旧 `SKILL.md` 记录再次复制会报 `600102 该商品已被新建过,请勿连续新建`，应准备多个源商品轮换。
4. 先执行 `--dry` 预览。`--confirm` 是真实发布的 L2 写操作，须取得用户明确同意。
5. `product.json` 的标题、规格组合、SKU 与图片要求见「三、product.json 格式」。

#### 命令

以下命令在 `skills/pdd-publish-http/` 目录执行：

```bash
# 列出本店商品，选择同类目复制源；catId 可选
node scripts/publish-by-copy.mjs --shop <shopKey> --list [--catId <类目ID>]

# 预览：不做真实发布
node scripts/publish-by-copy.mjs --shop <shopKey> --product <product.json> --source <goodsId> --dry

# 真实发布：L2，须先预览并取得用户同意
node scripts/publish-by-copy.mjs --shop <shopKey> --product <product.json> --source <goodsId> --confirm
```

#### 优点

| 优点 | 说明 |
|---|---|
| 免选类目 | 类目跟随源商品，避免重新搜索、选择类目 |
| 复用属性结构 | 以源商品和对应类目的原生提交 body 为基础改业务字段 |
| 支持源图/无图改包 | 不传 `images` 时可沿用源商品图；规范也记录了无图成功单 |
| 有预览门禁 | `--dry` 与 `--confirm` 分离，避免未经确认直接写店铺 |

#### 限制与处理

| 限制或现象 | 正确处理 |
|---|---|
| 源商品已复制过，出现 `600102` | 换一个本店同类目源商品，不要连续重试同一个源 |
| `brand_limit=true` 类目的品牌/属性校验失败 | 先按「四、类目模板与品牌」采集该类目模板，使用对应 `propertys_tid`、`template_module_id` 与品牌 `vid`；不要把页面路径描述成可以绕过必填校验 |
| 需要商详装修，`detail_gallery` 或 `decorationDetail` 不完整 | 同时处理详情图与装修楼层；脚本在 `action/edit` 后打开草稿页尝试「保存草稿」重建装修，再提交。保存按钮经常找不到，**自动处理未验证为稳定成功** |
| 纯 HTTP 调用 `file/create` 上传新主图 | **已知失败**：恒返回 `40002 操作太过频繁`；Node 直连、页面内执行、补浏览器头、换 Anti-Content、4 种参数组合及三个账号均未成功 |
| 换主图 | 规范仅记录 `1026511479126` 换图 5 张成功一次，之后无法复现；不能当成稳定能力 |
| `commit/detail` 与 `goodsCommit/action/edit` body 混用 | 不混用。以 `harvest-native-props.mjs` 保存的原生提交 body 为底座，只改业务字段；schema 差异见第四章 |

#### 规范记录的成功 goods_id（6 单）

| goods_id | 当次图片情况 |
|---|---|
| `1026511479126` | 换图 5 张；此后无法复现 |
| `1026569086908` | 源图 |
| `1026569940637` | 源图 |
| `1026574634568` | 无图 |
| `1026709254803` | 无图（退化 body） |
| `1026710800048` | 源图 |

证据：`_CLEANUP_SPEC.md`「publish-by-copy.mjs 真实成功记录（6 单）」。`artifacts/pdd-publish-by-copy/run-*.log` 当前未找到，原始日志**未复核**。

### 1.2 页面全流程提交：`publish-flow.mjs`

#### 用途

在发布页按既定顺序填写标题、参考价、主图、详情图、规格、SKU 价格库存、商品属性、发货售后，再由提交组件点击发布并核验结果。它适合需要明确走页面表单、页面图片上传和属性交互的场景。

**入口关系必须分清：**`publish-flow.mjs` 导出 `publishFlow(page, product, opts)`，是表单编排组件，不是带 `--product-file` 参数的独立命令行入口；当前由 `publish-v2.mjs` 导入并调用。下面给的是当前可调用的 `publish-v2.mjs` 命令。

#### 前提

1. 浏览器账号已登录，`--account <shopKey>` 对应有效账号 Profile。
2. 准备符合第四章 schema 的 `product.json`；需要主图/详情图时提供可访问的本地图片。
3. 新类目需要先确认类目及必填属性；品牌与模板参数按目标类目采集，不能复用其他类目的值。
4. 页面路径不是规避平台校验的通道：品牌必填、详情图数量、规格及 SKU 完整性仍由平台校验。
5. `--confirm true` 会执行真实发布；需先预览/人工核对并取得用户明确同意。

#### 命令

以下命令在 `skills/pdd-publish-http/` 目录执行：

```bash
# 填到提交前，保留页面供人工核对，不点击发布
node scripts/publish-v2.mjs --product-file <product.json> --account <shopKey> --confirm true --no-submit true

# 页面全流程真实发布：L2，须取得用户明确同意
node scripts/publish-v2.mjs --product-file <product.json> --account <shopKey> --confirm true
```

代码结构核对：`publish-v2.mjs` 第 144 行动态导入 `./publish-flow.mjs`，第 314 行调用 `publishFlow(...)`；`publish-flow.mjs` 本身只导出组件函数。

#### 优点

| 优点 | 说明 |
|---|---|
| 页面原生交互 | 由页面自己处理图片上传、属性级联及提交，不依赖纯 HTTP `file/create` |
| 表单覆盖完整 | 组件覆盖标题、参考价、主图/详情图、规格、价格库存、属性、发货售后 |
| 可停在提交前 | `--no-submit true` 支持人工核对，避免直接发布 |
| 属性级联可补填 | 多轮采集新出现字段，再补新增 SKU 行的价格库存和预览图 |

#### 限制

| 限制 | 说明与处理 |
|---|---|
| 比复制路径步骤多 | 需要打开发布入口、选择类目并完成整页表单，不把复制路径的耗时记录套用到页面路径 |
| 属性级联与异步渲染 | 填完一轮需重新采集；带「重要」的必填项仍要逐项复核，不能只看首轮字段数 |
| 新增 SKU 行可能缺值 | 属性填写后补价格库存及 SKU 预览图，否则提交会被平台拦截 |
| 图片与详情仍受平台约束 | 页面路径的 4 单记录全是源图，不能据此宣称换主图或任意详情装修已稳定验证 |
| 滑块、会话与限流 | 仍需按「五、限流与风控」处理；页面路径不等于免风控 |

#### 规范记录的成功 goods_id（4 单）

| goods_id | 当次图片情况 |
|---|---|
| `1025462371503` | 源图 |
| `1025846514486` | 源图 |
| `1026312995086` | 源图 |
| `1026321720727` | 源图 |

证据：`_CLEANUP_SPEC.md`「publish-flow.mjs 真实成功记录（4 单）」。`pdd_js_analysis/reports/flow-*.log` 当前未找到，原始日志**未复核**。

### 1.3 选择结论与证据边界

| 问题 | 结论 |
|---|---|
| 默认选哪条？ | 本店有合适的同类目源商品时优先复制路径；需要完整页面表单与页面图片操作时选页面路径 |
| 能否用页面路径绕过品牌必填？ | 不能。仍需目标类目正确的模板与品牌参数 |
| 能否宣称换主图已稳定解决？ | 不能。只有复制路径 `1026511479126` 一次成功记录，之后无法复现；纯 HTTP 新主图上传明确失败 |
| 能否由这两条路径的成功外推批量成功？ | 不能。`batch-publish.mjs` 仍标为**未验证** |
| 成功记录的证据强度 | 10 个编号均来自整理规范；当前工作区没有规范点名的原始日志，不能写成「本章已复核日志」 |

---

## 二、脚本清单

按用途分组。每个脚本只做一件事，由主流程编排。

### 2.1 主流程（入口）

| 脚本 | 作用 | 何时用 |
|---|---|---|
| `publish-by-copy.mjs` | **主路径**：复制本店商品 → 改 SKU/标题/价格 → 提交 | 店里已有同类目商品，且不需要换主图 |
| `publish-flow.mjs` | 页面全流程编排：选类目 → 填基础 → 填规格 → 填价格 → 提交 | 需要换主图，或 `publish-by-copy` 被属性校验拦住 |
| `publish-v2.mjs` | 页面流程 v2（含图片预上传、AI 视觉填表） | 类目属性复杂、需要 AI 看图填 |
| `publish.mjs` | 页面流程 v1（保留兼容） | 老脚本线性编排，一般不用 |
| `batch-publish.mjs` | 批量：遍历目录下多个 `product.json` 顺序发布 | 一次发多个商品 |

### 2.2 类目与属性

| 脚本 | 作用 |
|---|---|
| `harvest-native-props.mjs` | **关键**：拦截页面提交时的 `action/edit` body，拿到权威 `propertys_tid` / `template_module_id` / 品牌 `vid` / 全量属性值 |
| `category-template.mjs` | 类目模板库：成功上架后沉淀模板，同目录下次直接复用 |
| `attr-harvest.mjs` | 采集类目属性清单入库 |
| `attr-fill-generic.mjs` | 通用属性填写（v3，基于真机验证） |
| `attr-composite.mjs` | 复合字段处理（「添加XX」类多行） |

### 2.3 表单填写（DOM 流程内部使用）

| 脚本 | 作用 |
|---|---|
| `stage-nav.mjs` | 段1 导航 + 段2 选类目 |
| `stage-submit.mjs` | 点「提交并上架」+ 判定结果 |
| `field-basic.mjs` | 基础字段（标题 / 通用字段 / 类目读回） |
| `field-images.mjs` | 图片上传（主图 / 详情图 / 计数） |
| `field-service.mjs` | 服务承诺（7天无理由 / 假一赔十 等） |
| `field-shipping.mjs` | 发货与售后 + 运费模板 |
| `spec-dims.mjs` | 规格维度（specs） |
| `spec-row-fill.mjs` | 规格值逐行填写（v2） |
| `sku-table.mjs` | SKU 价格表 |
| `sku-thumb.mjs` | SKU 预览图 |

### 2.4 图片

| 脚本 | 作用 |
|---|---|
| `img-prep.mjs` | 图片预处理（尺寸归一 + 压缩到平台上限） |
| `compress-images.mjs` | 单独压缩图片 |
| `imgprep.py` | Python 版图片预处理 |

### 2.5 视觉辅助

| 脚本 | 作用 |
|---|---|
| `vision-fill.mjs` | AI 看截图填规格 |
| `vision-cache.mjs` | 视觉分析结果缓存 |
| `analyze_spec_ui.py` | 规格区 UI 结构分析 |

### 2.6 依赖关系

```
publish-by-copy.mjs
  └── harvest-native-props.mjs（产物在 artifacts/pdd-native-props/）

publish-flow.mjs
  ├── stage-nav.mjs → stage-submit.mjs
  ├── field-basic.mjs / field-images.mjs / field-service.mjs / field-shipping.mjs
  ├── spec-dims.mjs → spec-row-fill.mjs
  ├── sku-table.mjs / sku-thumb.mjs
  ├── attr-composite.mjs / attr-fill-generic.mjs
  └── vision-fill.mjs → vision-cache.mjs → analyze_spec_ui.py

batch-publish.mjs
  └── publish-flow.mjs（每个商品一次）
```

### 2.7 共享依赖（技能外）

| 路径 | 作用 |
|---|---|
| `skills/_shared/pdd-antiban.mjs` | 节流引擎（账号级 4-6s / 接口级 1.8s / 40002 冷却 240s） |
| `skills/_shared/pdd-shadow-hook.mjs` | 破解滑块 closed shadow root |
| `skills/_shared/pdd-slider-solver.mjs` | 滑块识别与拖拽 |
| `skills/_shared/pdd-http.mjs` | 凭证库 HTTP 通道 |
| `lib/pdd-image-preupload.js` | 页面内图片上传（依赖 `page.evaluate`，慢但能过 `file/create`） |

---

## 三、product.json 格式

以下结构用于 `publish-by-copy.mjs --product <product.json>`。字段类型以该脚本的参数说明与现有文档为准；下方示例是结构说明，**不是一次已执行的平台发布记录**。

### 3.1 字段表

| 字段 | 类型 | 是否必填 | 说明 |
|---|---|---|---|
| `title` | `string` | 是 | 商品标题。脚本会统计其中的汉字数，超过 30 个汉字直接终止；平台也会拦截超长标题。旧文档写有「30 汉字 / 60 字符」，实际发布应优先满足 **30 个汉字上限**，不能把 60 字符当作保证可提交的条件。 |
| `images` | `string[]` | 否（`publish-by-copy.mjs`） | 本地图片**绝对路径**数组；复制路径脚本注释标为 1～5 张。不传则沿用源商品主图。传新图不等于换图必然成功：换主图仅记录 goods_id `1026511479126` 成功过一次，之后无法复现；原始日志当前缺失，该记录未重新验证。 |
| `imageUrls` | `string[]` | 未确认支持 | 本次在保留的 `skills/pdd-publish-http/scripts/*.mjs` 中未检索到 `imageUrls` / `image_urls` 读取点。不要把它当作已验证的 `images` 替代品；远程 URL 输入支持状态标为**未验证**，实际使用本地绝对路径的 `images`。 |
| `price` | `string`（兼容数字值未单独验证） | 否 | 商品参考价，建议用十进制字符串避免精度歧义。显式值仍需通过平台校验；参考价必须大于商品最大单买价。 |
| `stock` | `string` | 否 | 默认库存，在 SKU 行未提供库存时作为默认值。旧文档统一结构还记录过默认 `1000`，但复制路径的参数说明未给出固定默认值，因此不要依赖隐式默认，建议每个 SKU 明写 `stock`。 |
| `specs` | `Array<{name:string, values:Array<{value:string, image?:string}>}>` | 是（复制路径要求至少 1 维） | 规格维度，最多 2 维。`name` 是维度名，`values` 是该维度全部取值；每个取值放在 `{ "value": "..." }` 对象中，不能直接把 `values` 写成字符串数组。旧统一结构的预览图扩展允许第 1 维取值带 `image`，复制路径中的实际效果未单独验证。 |
| `skus` | `Array<{specs:Object, price:string, stock:string, itemNo?:string}>` | 是 | SKU 行。每行 `specs` 用「维度名 → 维度值」标识组合，`price` 是该 SKU 拼单价，`stock` 是该行库存，`itemNo` 是可选规格编码。必须覆盖 `specs` 产生的全部笛卡尔积组合，且不得重复或引用未声明的维度值。 |

> `images` 与 `imageUrls` 不是已确认的同义字段。这里保留 `imageUrls` 一行是为了明确当前证据边界，而不是新增输入能力或承诺兼容。

### 3.2 完整示例：2 个维度、4 个 SKU

示例使用「颜色」2 个值 × 「容量」2 个值，共 4 个组合；每行都显式给出价格、库存和规格编码。图片路径需替换为发布机器上真实存在的绝对路径。

```json
{
  "title": "一次性纸杯家用加厚饮水杯多规格可选",
  "images": [
    "D:/pdd-images/paper-cup/main-01.jpg",
    "D:/pdd-images/paper-cup/main-02.jpg"
  ],
  "price": "24.92",
  "stock": "100",
  "specs": [
    {
      "name": "颜色",
      "values": [
        { "value": "原木色" },
        { "value": "白色" }
      ]
    },
    {
      "name": "容量",
      "values": [
        { "value": "250ml" },
        { "value": "350ml" }
      ]
    }
  ],
  "skus": [
    {
      "specs": { "颜色": "原木色", "容量": "250ml" },
      "price": "19.90",
      "stock": "100",
      "itemNo": "CUP-NATURAL-250"
    },
    {
      "specs": { "颜色": "原木色", "容量": "350ml" },
      "price": "22.90",
      "stock": "100",
      "itemNo": "CUP-NATURAL-350"
    },
    {
      "specs": { "颜色": "白色", "容量": "250ml" },
      "price": "19.90",
      "stock": "100",
      "itemNo": "CUP-WHITE-250"
    },
    {
      "specs": { "颜色": "白色", "容量": "350ml" },
      "price": "22.90",
      "stock": "100",
      "itemNo": "CUP-WHITE-350"
    }
  ]
}
```

示例中最大拼单价为 `22.90`。按现有脚本文档的单买价计算规则 `拼单价 + 1.01`，最大单买价为 `23.91`；示例参考价 `24.92` 大于该值。这里展示的是数值关系，**不代表该示例商品已实际上架**。

### 3.3 校验规则与发布前检查

| 检查项 | 规则 | 不满足时怎么处理 |
|---|---|---|
| 标题 | `title` 中汉字数不得超过 30；平台会拦截超长标题 | 缩短标题后重新生成 JSON，不要用截断 SKU 或图片的方式规避 |
| 规格维度数 | `specs` 最多 2 维；复制路径还要求不能为空 | 合并多余维度，或重新设计 SKU；无规格商品不能直接套用本示例 |
| 维度结构 | 每维必须有非空 `name` 和 `values`；值必须来自对应维度 | 修正维度名、取值及类型，避免空值和重名造成组合歧义 |
| SKU 覆盖 | 若第 1 维有 `m` 个值、第 2 维有 `n` 个值，则二维商品应有 `m × n` 行；一维商品应有 `m` 行 | 补齐缺失组合；对不售卖的组合不能静默省略，应先确认业务及页面是否支持停用 |
| SKU 唯一性 | 每行 `specs` 必须包含全部维度，组合不可重复 | 以维度名和值逐行核对；不要仅靠 `itemNo` 区分重复组合 |
| 价格与参考价 | 每个 SKU 的 `price` 应明确填写；参考价必须大于最大单买价 | 先计算全部 SKU 的单买价，再设置合规参考价，不要直接照抄示例金额 |
| 库存 | 建议逐 SKU 明写 `stock`，不要依赖各路径可能不同的默认值 | 使用非负整数库存字符串，并检查缺项是否意外继承 `product.stock` |
| 图片 | `images` 使用真实本地绝对路径；不传会继承源商品主图 | 发布前检查文件存在、路径可读；需要换主图时优先走页面路径并保留失败预期 |
| 远程图字段 | `imageUrls` 支持情况未验证，保留脚本中未找到读取点 | 不要仅提供 `imageUrls`；需要图片时提供已确认的 `images` 本地路径 |

### 3.4 证据与适用范围

- 字段结构与校验依据：`scripts/publish-by-copy.mjs` 顶部参数说明及商品校验代码、旧版 `SKILL.md` 的 product 统一结构说明。
- 本次文档只校验 JSON 结构和规格组合，不调用平台接口，不宣称新增发布成功记录。
- `_CLEANUP_SPEC.md` 点名的 `artifacts/pdd-publish-by-copy/run-*.log` 与 `pdd_js_analysis/reports/flow-*.log` 当前工作树中缺失，历史成功结论均不作为本次实测。

---

## 四、类目模板与品牌

### 4.1 为什么需要类目模板

`propertys_tid` 是类目的**属性模板 ID**，必须与目标类目匹配。

| 现象 | 原因 | 处理 |
|---|---|---|
| `输入的属性值XXX不可用，请更换！`（如「倾听果」） | `propertys_tid` 用了别的类目的值，平台回退到默认模板，带出错误类目的品牌值 | 用目标类目重新采集模板，替换 `propertys_tid` / `template_module_id` / 品牌 `vid` |
| `属性[品牌]校验错误：该属性必填，需在编辑页确认后重新提交` | 品牌条目的 `vid` 或模板字段不符合该类目 | 按该类目的 `brandRule` 填写，不能复用别的类目的品牌参数 |

**根因不是简单地「没填品牌」，而是类目属性模板参数错了。** 不同类目的模板值不能混用。

### 4.2 `harvest-native-props.mjs` 用法与产物

#### 用法

```bash
# 已有草稿：直接打开草稿页采集
node scripts/harvest-native-props.mjs --shop <shopKey> --catId <类目ID> --goods <goods_id> --commit <goods_commit_id>

# 没有草稿：复制一个源商品，让它走一次页面提交
node scripts/harvest-native-props.mjs --shop <shopKey> --catId <类目ID> --source <源商品ID>
```

- `--shop` 必填，对应浏览器账号 Profile。
- `--goods` / `--commit` 与 `--source` 二选一；不传前者时必须传 `--source`。
- 脚本会打开草稿页、填写参考价、点击「提交并上架」，拦截**页面自己发出的 `goodsCommit/action/edit`**。

#### 原理

```
页面提交 → 前端调 template/mall 拉权威类目模板
        → 重建 goods_properties（template_pid / template_module_id / vid）
        → 发 action/edit
        → 脚本拦截 body 并保存
```

页面自己算出的值是平台认可的权威值，比手工拼字段可靠。

#### 产物

| 文件 | 内容 |
|---|---|
| `artifacts/pdd-native-props/cat<catId>_<shopKey>.json` | 属性模板：`propertys_tid`、`catProperties`、`goods_properties_tpl`、`template_module_id_candidates`、`brandRule` |
| `artifacts/pdd-native-props/cat<catId>_<shopKey>_native-body.json` | 页面实际提交的完整 157 字段 `action/edit` body，作为后续提交的底座 |

脚本还会打印品牌判定：该类目是否需要品牌、品牌 `vid`、`template_pid`、`template_module_id`，以及 `propertys_tid`。**每个类目采集一次，之后复用该文件。**

状态：cat16675（纸杯）与 cat22278（门贴）已采到，见 `_CLEANUP_SPEC.md`。

### 4.3 品牌字段对照表

| 字段 | 纸杯 cat16675 | 门贴 cat22278 |
|---|---|---|
| `propertys_tid` | `63387` | `39060` |
| `template_module_id` | `91765` | `50716` |
| 品牌 `vid`（`goods_properties` 中 `ref_pid=310` 那一条） | `157882` | 不需要品牌 |
| `brand_limit` | `true` | `false` |

纸杯品牌条目的关键字段（采集脚本实测打印）：

```json
{
  "ref_pid": 310,
  "template_pid": 661648,
  "template_module_id": 91765,
  "vid": 157882,
  "content": "爱绿意",
  "value": ""
}
```

> **`vid` ≠ `brand_id`**：`/draco-ms/mms/brand/audit/record` 返回的 `brand_id`（实测 `143701`）不是提交时要带的值。提交体 `goods_properties[ref_pid=310].vid` 必须填 `157882`；两者不是同一个 ID，不能互换。

### 4.4 两个 body schema 的差异（不能混用）

| 接口 | 字段数 | 用途 | 注意事项 |
|---|---|---|---|
| `commit/detail`（草稿读取） | 174 | 读取草稿详情 | 含大量展示字段（`id` / `owner` / `mall_id` 等），**不能直接当提交体** |
| `goodsCommit/action/edit`（提交） | 157 | 保存/提交编辑 | 含提交必需字段（`propertys_tid` / `isbn_properties_related` / `must_have_spu` 等） |

直接拿 `commit/detail` 的 174 字段 body 去提交，会报 `请求method,argument,body错误`。

**正确做法：用 `harvest-native-props.mjs` 保存的原生 157 字段 body 当底座，只改业务字段；不要把两个 schema 的字段互相拼接。**

---

## 五、限流与风控

### 5.1 错误码与处理

先读接口返回的 `error_code`，不要只凭「操作太过频繁」一类文案判断。处理入口参见 `skills/_shared/pdd-error.mjs`，账号冷却与健康分记录参见 `skills/_shared/pdd-antiban.mjs`。

| 错误码 | 含义 | 处理 |
|---|---|---|
| `40002` | 高频限流（`rate_limit`），常见提示为「操作太过频繁」或「系统繁忙」 | 停止连续重试，进入 **240 秒**冷却；冷却后仍受限就换时间段，或改用独立的降级路径。补请求头、换签名、反复重放都不是通用修复办法。尤其是 `file/create` 纯 HTTP 上传，仓库记录为持续 `40002`，不要靠本表承诺重试即可成功。 |
| `54001` | 平台风控 / 需要安全验证（`risk_control`） | 先冷却并停止批量操作。可走的既有自愈流程是「清旧 token → 从验证响应提取新 token → 有值才重放」；仍失败时暂停自动发布，人工打开商家后台完成滑块。不要把它当成会话过期而反复重新登录。基础冷却为 **60 秒**，`pdd-antiban.mjs` 会按当日次数退避。 |
| `43001` | 会话过期（`token_expired`），**不是风控** | 立即停止请求，到「账号连接」重新扫码登录；登录成功前不要继续提交。优先使用浏览器当前 Cookie，避免旧凭证快照造成误判。 |
| `40001` | 未登录（`token_expired`） | 到「账号连接」重新扫码登录，并确认实际使用的是 `pdd_mms` 商家后台会话。不要通过重复发布来探测登录态。 |
| `40010` | 无权限（`no_permission`） | 核对账号类型、店铺权限以及是否应使用主店号；权限未解决前不要重试或换参数硬顶。旧文档提到可能涉及诚信通/实力商家，但是否需要该资质取决于具体账号与接口。 |
| `48143` | 非法请求（`api_error`），该接口依赖页面 SDK 的请求上下文，如签名头或 Referer 状态 | 不要继续在 Node 或 `page.evaluate(fetch)` 中机械复刻。让真实页面通过 DOM 操作自行发请求，并抓取页面原生请求/响应；先确认当前页面与登录态有效。 |

**最容易误判的两点：**

- `54001` 是风控/验证问题，`43001` 与 `40001` 才是登录态问题；三者处理不能互换。
- `40002` 与 `48143` 都不等于「随便再发一次」。前者先限频冷却，后者先回到页面原生上下文。

### 5.2 节流参数

`publish-by-copy.mjs` 的 `post()` 在每次请求前调用 `reserveSlot(shopKey, endpoint)`，参数实现在 `skills/_shared/pdd-antiban.mjs` 的 `THROTTLE`：

| 参数 | 当前值 | 作用 |
|---|---:|---|
| 账号级基础间隔 | 4000 ms | 同一店铺账号的请求时间槽基础间隔 |
| 账号级随机抖动 | 0～2000 ms | 与基础间隔叠加，实际账号级间隔为 **4～6 秒** |
| 同接口最小间隔 | 1800 ms | 对去掉域名和 query 的接口路径单独限频 |
| `40002` 后冷却 | **240000 ms（240 秒）** | 命中高频限流后暂停，期间不要持续重放 |
| `54001` 基础冷却 | 60000 ms（60 秒） | 风控后的基础冷却，实际时长按当日次数退避 |

节流按**账号**而不是单个 Node 进程计算，状态持久化在 `~/.dsh/pdd-throttle-state.json`。账号级与接口级时间槽取较晚者，并在等待前预留时间槽，避免并发同时穿透。即使增加并发进程，也不能绕过店铺级节流。

`publish-by-copy.mjs` 对 `40002` 有等待 240 秒后重试的实现，但这**不是解除限流的保证**：共享排障记录明确记载过「冷却 240 秒零请求后仍受限」。自动化任务应设置上限并报告失败，不能无限等待或无限重试。

#### 40002 按接口计

`40002` 的触发与接口有关，**不同接口相互独立**：一个接口受限，不代表另一个接口必然受限。可以切换到确属不同业务路径的降级方案（例如搜索受限时使用 feed），但不要换参数反复打同一个接口，也不要借「接口独立」绕开账号冷却继续批量发布。

特别注意 **`template/mall` 阈值极低**。旧 `SKILL.md` 的说明是正常商家一天只调用几次，测试时最容易被限；这里没有额外的实测阈值数字。因此：

1. 类目模板优先复用已缓存的原生模板，不要每次预演都重新采集。
2. `--dry` / `--no-submit` 也会产生真实请求，不能把它们当作零风险循环测试。
3. 一旦 `template/mall` 返回 `40002`，停止本轮模板采集；不要连续换类目重试来寻找阈值。
4. `file/create` 的 `40002` 还应结合「已知失败清单」处理，不能把它误当成仅等待 240 秒即可恢复的普通节流。

### 5.3 滑块与 closed Shadow DOM

滑块弹窗可能渲染在 **`#shadow-root (closed)`** 内。closed 模式下，从外部读取 `element.shadowRoot` 会得到 `null`，所以：

```js
document.querySelector('#slide-captcha-dialog') // 可能查不到实际存在的弹窗
```

「查不到弹窗」因此不等于「没有弹窗」。仓库对应实现为 **`skills/_shared/pdd-shadow-hook.mjs`**：

1. 在页面脚本执行前，用 `page.evaluateOnNewDocument()` 注入。
2. 劫持 `Element.prototype.attachShadow`；当调用方传入 `{ mode: 'closed' }` 时，复制配置并改为 `open`，让后续深度查询能穿透该 shadow root。
3. 通过 `window.__pddDeepQuery()` / `__pddDeepQueryAll()` 递归查询 open shadow root。
4. 用 `detectSliderDeep(page)` 区分普通 DOM 命中、仅在 shadow 内命中，以及仍无法确认的情况。

以 `skills/pdd-publish-http/scripts/` 下的脚本为例，安装顺序如下：

```js
import { installShadowHook, detectSliderDeep } from '../../_shared/pdd-shadow-hook.mjs'

await installShadowHook(page) // 必须在 goto 之前
await page.goto(goodsUrl)
const slider = await detectSliderDeep(page)
```

`publish-by-copy.mjs` 与 `harvest-native-props.mjs` 中则有通过 `PLUGIN` 拼绝对路径后动态导入的实际示例。

**时机是关键：**必须在 `goto` 前安装。页面加载后再补装，只能影响之后新建的 shadow root，已经创建的 closed root 无法回溯打开。该 hook 解决的是「如何看到滑块 DOM」，**不代表已经实现自动滑块识别或保证验证通过**；检测到滑块后应暂停自动发布并交由人工完成验证，不要连续刷新、重登录或重复提交。

### 5.4 批量发布时的风控顺序

1. 每个商品使用同一账号串行处理，保留账号级 4～6 秒与接口级 1.8 秒间隔。
2. 请求前检查账号是否仍在冷却或需要重新登录，不在冷却期强行发单。
3. `40002`：记录受限接口，停止连续重试，按 240 秒冷却处理；模板接口直接终止本轮采集。
4. `54001` 或发现滑块：暂停本账号的后续批量提交；必要时人工验证，不能靠下一单继续试探。
5. `43001` / `40001`：整批停止并重新登录，避免把后续失败误记成商品数据问题。
6. `40010` / `48143`：分别核对权限、回到页面原生请求上下文，不以增加重试次数代替修复。

以上阈值和参数的证据为当前仓库实现与旧 `SKILL.md`；未另行进行线上压测，不应把「等待一个冷却周期」表述为已验证必然恢复。

---

## 六、已知失败清单（不要重复踩）

这一节记录**试过但失败**的路，避免下次重复。

| # | 问题 | 现象 | 试过什么 | 结论 |
|---|---|---|---|---|
| 1 | **纯 HTTP 上传新主图** | `file/create` 恒返回 `{"error_code":40002,"error_msg":"操作太过频繁，请稍后再试！"}` | ① Node 直连 fetch ② `page.evaluate` 页面内执行 ③ 补全 `sec-fetch-*` / `sec-ch-ua` 浏览器特征头 ④ 每张图重新生成 Anti-Content ⑤ 4 种参数组合（原始 / 加 `pic_operations` / 加 `width`+`height`+`size` / 换 CDN 域名）⑥ 3 个不同店铺账号 ⑦ 重试 3 次 × 间隔 8-10s | ❌ **全部失败**。三个账号同时 40002，不是账号配额问题。`get_signature` 和 `store_image` 都能过，只有 `file/create` 挂。**该接口拒绝程序化调用，原因未查明** |
| 2 | **换主图** | 偶尔成功，多数失败 | 见 #1 | 只在 `publish-by-copy.mjs` 里成功过 1 次（`1026511479126`，走 `publish-by-copy.mjs` 但当时 `preuploadProductImages` 恰好成功），之后无法复现。**要换图请用 `publish-flow.mjs`（页面控件传图）** |
| 3 | **详情图纯 HTTP** | `commit/submit` 报 `商品详情图数量必须在1-50张之间` | ① 只带 `decorationDetail`（14 楼层）② 只带 `detail_gallery`（10 张）③ 两个都带 ④ 换图后重读 `commit/detail` 回写 ⑤ 调 `/gorse/mms/goods/decoration/commit/save` 保存楼层 | ⚠️ **部分可行**：`detail_gallery` + `decorationDetail` 都带时，**不换主图可过**。但换主图后必须让页面点一次「保存草稿」重建装修楼层，那个按钮经常找不到（草稿页加载慢） |
| 4 | **跨店复制** | `该商品不属于该店铺` | — | `copyGoodsCommit` 只能复制**本店**商品。跨店无解 |
| 5 | **同一源商品复制第二次** | `600102 该商品已被新建过,请勿连续新建` | 换 `goods_commit_id` 重试 | 源商品复制一次后即被锁。**必须准备多个源商品轮换** |
| 6 | **标题超长** | `商品标题最多填写30个汉字（60个字符）` | — | 脚本已前置校验。中文按 1 字算，超 30 直接拒 |
| 7 | **参考价缺失/过小** | `商品参考价必须填写！` 或 `规格单买价格必须小于参考价格` | — | `market_price` 必须 > 最大 SKU 单买价。脚本已自动算 `max(单买价)+1` |
| 8 | **body schema 混用** | `请求method,argument,body错误` | 用 `commit/detail` 的 174 字段直接提交 | `commit/detail`（174 字段，含大量展示字段）≠ `action/edit`（157 字段）。**必须用 `harvest-native-props.mjs` 存的原生 body 做底座** |
| 9 | **`propertys_tid` 填错** | `输入的属性值'XXX'不可用,请更换！`（XXX 是别的类目的品牌名） | 用 `53475`（童装类目）| 平台按 `propertys_tid` 选属性模板。填错类目的值 → 回退到默认模板 → 带出别的类目的品牌。**必须用 `harvest-native-props.mjs` 采到的真实值** |
| 10 | **品牌 `vid` 用成 `brand_id`** | `属性[品牌]校验错误：该属性必填` | 用 `/draco-ms/mms/brand/audit/record` 返回的 `brand_id: 143701` | ❌ 两者不同。纸杯类目提交要用 `vid: 157882`。**`brand_id` 是审核记录 ID，`vid` 是品牌值 ID** |
| 11 | **`page.evaluate` 超时** | `Runtime.callFunctionOn timed out` / 挂 120s+ | 加 Chrome 防节流 flags | ⚠️ 缓解但没根治。**关键接口（`commit/submit`）改用 Node 直连 fetch + 传浏览器 Cookie，167ms 返回** |
| 12 | **滑块查不到** | `没找到弹窗：#slide-captcha-dialog 不存在` | 常规 `document.querySelector` | 滑块在 `#shadow-root (closed)` 内。**必须先装 `pdd-shadow-hook.mjs` 劫持 `attachShadow`（`goto` 之前装）** |
| 13 | **`template/mall` 限流** | `40002 操作太过频繁` | 重试 | 该接口阈值极低（正常商家一天调几次）。**用 `harvest-native-props.mjs` 存本地模板，之后不再调** |

---

## 七、排障速查

先记录**脚本名、源商品 `goods_id`、失败接口、完整错误码与错误文案**，再按下表处理。不要只靠最后一次报错重试；同一源商品或同一接口反复失败时，先核对是否命中已知限制。证据行号以当前工作树文件为准；没有成功记录的处理均明确标为「未验证」。

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 未登录、跳转登录页，或接口提示会话失效 | 浏览器中的拼多多商家会话已过期；脚本读取到的 Cookie 已不能用于商家后台 | 在脚本使用的浏览器配置中重新登录商家后台，确认能打开商品列表后再运行；重新执行当前流程，不要沿用失效会话中的请求结果继续提交。具体有效期：**未验证** |
| 拿不到维度表，提示「维度不在候选表」 | 当前类目的候选规格维度与 `product.json` 的 `specs` 不一致；也可能是页面尚未加载完成，读取到了空候选集 | 先确认已进入正确的发布类目，再读取页面实际候选维度，按候选名称修正 `specs` 后重跑。`specs` 最多 2 维，且 `skus` 必须覆盖全部维度组合；不要用其他类目的维度模板硬套。页面加载与候选维度映射是否均已验证：**未验证** |
| `action/edit` 报「请求 body 错误」 | 把 `commit/detail` 返回的完整 body 直接用于 `action/edit`；两者字段集合不同，混用会带出不接受或缺失的字段 | 以 `action/edit` 自身读取到的草稿结构为基础，只修改目标字段后原样回传。不要把 `commit/detail` 的 174 字段 schema 与 `action/edit` 的 157 字段 schema 互相替代；同时检查 `goods_id`、`goods_commit_id` 是否属于同一份草稿。字段数的原始日志证据：**未验证** |
| `commit/submit` 报「属性必填」 | 类目属性未采全、必填项为空，或沿用其他类目的属性模板 | 对当前类目运行 `harvest-native-props.mjs` 重新采集，逐项补齐必填属性后再提交；不要只删除报错字段或留空字符串绕过校验。真实采集记录：cat16675、cat22278（见 `_CLEANUP_SPEC.md`「类目模板采集」） |
| `commit/submit` 报「输入的属性值 XXX 不可用」或「属性值不可用」 | `propertys_tid` 填错，带出了其他类目的品牌值；也可能把品牌接口返回的 `brand_id` 当成属性 `vid` | 按当前类目的采集结果同时修正 `propertys_tid`、`template_module_id` 和品牌 `vid`。纸杯 cat16675 使用 `propertys_tid=63387`、`template_module_id=91765`、品牌 `vid=157882`；门贴 cat22278 使用 `39060`、`50716`，不需要品牌。`vid` 不等于 `brand/audit/record` 返回的 `brand_id=143701`（证据：`_CLEANUP_SPEC.md`「品牌字段」） |
| `commit/submit` 报详情图数量不对 | `detail_gallery` 缺失、为空或张数不符合平台要求；只提交 `decorationDetail` 不能代替详情图数组 | 检查提交 body 的 `detail_gallery`，保留源详情图或填入有效详情图，数量控制在 1–50 张；`decorationDetail` 仍需同时携带。换图后回页面点「保存草稿」重建装修楼层再提交。证据：`publish-by-copy.mjs:315-321`（空数组回退到源详情图）、`SKILL.md:167`（平台校验 1–50 张）；换图稳定复现情况：**未验证** |
| `copyGoodsCommit` 报 `600102` | 同一源商品已复制过一次，被平台锁定，不能再次作为复制源 | 停止对同一源商品重试，换用本店内另一个可复制的源商品；继续提交不会解除锁定。证据：`SKILL.md:56` 记录完整文案「600102 该商品已被新建过,请勿连续新建」；解锁条件：**未验证** |
| `copyGoodsCommit` 报「该商品不属于该店铺」 | 源商品不在当前登录店铺，或复制请求中的 `goods_id` / `goods_commit_id` 与当前账号不匹配 | 先在当前账号的商品列表确认源商品存在且可编辑，并使用该商品当前草稿对应的两个 ID；跨店商品改用本店商品作为源。不要通过更换接口参数绕过店铺归属校验。接口实际提交这两个 ID 的证据：`publish-by-copy.mjs:243`；该错误文案的实测日志：**未验证** |
| 页面 `page.evaluate` 超时 | 后台窗口失焦或被遮挡，Chrome 冻结/节流渲染器；也可能是页面尚未就绪或导航中断 | 将浏览器窗口置前，避免最小化和遮挡，重新打开目标页面后重试。`publish-by-copy.mjs:101` 已设置 `protocolTimeout: 600000`；`stage-nav.mjs:101` 的 `safeEval` 封装页面求值。不要仅把超时时间继续调大来代替恢复页面。窗口置前能解决超时的实测记录：**未验证** |
| 换详情图后找不到「保存草稿」按钮 | 装修楼层尚未重建，页面状态或按钮位置与脚本预期不一致；这是已记录的页面路径不稳定点 | 回到该商品的页面编辑流程，等待页面完整加载后查找并点击「保存草稿」，确认保存成功再提交；不要用连续点击或重复 `commit/submit` 代替保存。若仍找不到，保留现状并改用已验证的源详情图路径。证据：`_CLEANUP_SPEC.md`「明确的已知失败」记录该按钮经常找不到；稳定修复方法：**未验证** |

### 重试前的最小检查

1. **账号与商品归属一致**：当前浏览器账号能看到并编辑源商品。
2. **类目与模板一致**：属性、品牌和规格维度都来自当前类目，而非旧商品或其他类目的缓存。
3. **接口与 schema 一致**：`commit/detail` 和 `action/edit` 的 body 不混用；复制请求使用同一份草稿的 ID。
4. **页面状态可见**：需要 DOM 操作时保持窗口前台，先恢复导航，再执行填写或保存。
5. **已知失败不硬撞**：跨店复制、同一源商品重复复制及不稳定的换主图流程，不因增加重试次数而变得可用。纯 HTTP 上传新主图恒返回 `40002 操作太过频繁` 时，不要继续换参数重试；证据：`_CLEANUP_SPEC.md`「明确的已知失败」。
