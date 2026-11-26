---
name: pdd-publish
description: "拼多多商品上架（RPA 页面模式，唯一入口 steps/index.mjs）。用真实浏览器操作发布页，1→16 步：选类目 → 传主图/详情图 → 填标题 → 填规格 → 填价格库存（走「Excel 批量编辑规格」）→ SKU 预览图 → 属性 → 发货。支持 1~2 维规格、任意自定义规格名与数量。默认只预览，--confirm true 才提交；--stop-before-submit 填完停在提交前。"
metadata:
  builtin_skill_version: "4.0"
  dsagent:
    display_name: "拼多多·商品上架"
    emoji: "🚀"
    requires: {}
---

## 🚫 铁律：未经用户明确许可，禁止改动本技能任何文件

> **用户原话（2026-11-16）：「现在禁止改，我不希望你再改他了，我说改才能改。」**

### 必须遵守

| 禁止 | 说明 |
|---|---|
| ❌ 改代码 | `steps/*.mjs`、`steps/helpers/*.mjs`、`templates/index.mjs`、`modules/*` |
| ❌ 改文档 | `SKILL.md`、`docs/*.md` |
| ❌ 改模板 | `skills/pdd-publish/templates/*/template.json` |
| ❌ 改数据结构 | `product.json` 的字段定义 |
| ❌ 「顺手优化」 | 看到可改进的地方也不许动 |
| ❌ 「我觉得有问题」就改 | 先报告现象，等用户判断 |

### 唯一允许

**只有用户说出「改」「改吧」「可以改」这类明确指令，才可以动手。**

### 为什么

这个技能经过 **20+ 个类目**、几十轮调试才定稿。任何「顺手改一下」都可能导致：

- 已通过的类目跑不通
- 规格/属性判断链断掉
- 提交被平台拦截

**改动前必须先问，改动后必须跑回归测试。**

### 如果发现 bug

1. 先**报告现象**（日志、截图、复现步骤）
2. 等用户判断是否要改
3. 用户说改 → 才改
4. 改完 → 跑回归

---

# 拼多多商品上架

> **只有一个入口：`steps/index.mjs`。** 没有第二套脚本、没有旁路。
> 纯 HTTP 换图这条路 2026-10 试了 19 次、7 种方案、4 个账号全失败，已彻底放弃。

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **pdd_mms** 账号，状态 `valid` | `not_bound` / `token_expired` | 到「账号连接」绑定或重新登录拼多多商家后台 |
| 2 | `product.json` 已备好（见「产品数据格式」） | `api_error`，预览阶段即返回字段缺失 | 按格式补齐；主图/详情图用本地绝对路径 |
| 3 | 该叶子类目模板已在 `templates/` 里 | 属性区填不进去 / 规格维度对不上 / 提交被拦 | 先拉模板（见「类目模板」），别硬跑 |
| 4 | 本机有 Node + Chrome | `skill_error` | 安装后重试 |
| 5 | 账号不在风控冷却期 | `risk_control` / `40002` | 等冷却结束（见「风控与限流」），别反复试 |

## 执行入口（唯一）

**`steps/index.mjs`** —— 与 `contract.json` 的 `entry.script` 一致。

```bash
# ① 预览（默认）：只校验商品数据 + 回显上架计划，不开浏览器、零写操作
node {baseDir}/steps/index.mjs --product-file "<product.json 绝对路径>" --account "<shopKey>"

# ② 填完停在提交前：真开浏览器把 1→15 全填完、跑提交前必填校验，但不提交
node {baseDir}/steps/index.mjs --product-file "<product.json 绝对路径>" --account "<shopKey>" \
  --confirm true --stop-before-submit

# ③ 真实上架：L2 写操作，用户明确确认后才允许带 --confirm true
node {baseDir}/steps/index.mjs --product-file "<product.json 绝对路径>" --account "<shopKey>" --confirm true
```

插件根的 `run-to-submit.mjs` 只是入口 ② 的**薄壳**（固定店铺 + 转调同一套代码），
不是第二套实现：

```bash
node run-to-submit.mjs <product.json> [shopKey]    # shopKey 缺省 = 空空商行 pdd_mms_800050996
```

> 流程固定版、三条硬规矩见 **`docs/00-上架固定流程.md`**。
> ⚠ 改入口脚本时必须同步改上面这几行 + `contract.json`。

### 全部走基座

| 模块 | 用途 |
|---|---|
| `pdd-launch.launchStealth()` | 浏览器启动（stealth 参数 + profile 清理）|
| `pdd-antiban.reserveSlot()` | 请求配额节流 |
| `pdd-risk.checkCooldown()` | 账号冷却检查 |
| `pdd-request.request()` | 接口请求（Node 签名 / 浏览器双通道）|

禁止直接用裸 fetch / 裸 puppeteer。

### 步骤 1→16

```
1  打开发布页（事件驱动等新标签，1.9s）
2  主图 5 张（uploadFile + 补派发 input/change）
3  标题
4  类目检查 + 手动选择 + 下一步
5  白底图（JS 注入，不弹窗）
6  属性 + 自动补必填（扫 span.Form_itemRequired）
6b 详情图上传（detailImages → 详情区 input[type=file]）
11 规格（按模板 type 分派）
12 价格库存（★ 走「Excel 批量编辑规格」，见「价格与库存」）
12b SKU 预览图（按行配色图，独立一步）
13 参考价（不传则自动 = 最大单买价 + 1）
14 满件折扣
15 承诺发货时间
16 提交（内置必填校验 + .success-title 判成功）
```

`--stop-before-submit` 停在 15 之后、16 之前，并把 16 的必填校验提前跑一遍作为交付证据。

### 规格分派（核心设计）

模板 `template.json` 里每个维度标 `type`，上架时 `switch(dim.type)` 选填充器：

```js
case 'text':       fillByGroup      // 勾选框 + 输入框按组配对
case 'checkbox':   fillByGroup      // 预设值点选（含裸输入框兜底）
case 'size-table': fillSizeTable    // 尺码表（自动切欧码/中国码）
```

**新类目只需标对 `type`，step11 不用改。**

### 已验证类目

| 类目 | catId | 规格 | 行数 | 价格回读 | 用时 |
|---|---|---|---|---|---|
| 家居服套装 | 15021 | 颜色分类 × 尺码 5×6 | 30 | 30/30 | 120s |
| 家居袍/睡袍 | 15023 | 颜色分类 × 参考分类 4×4 | 16 | 16/16 | 70s |
| 家居裙/睡裙 | 15024 | 颜色分类 1 维 | 4 | 4/4 | 56s |
| 套装 | 15068 | 颜色分类 × 参考分类 3×4 | 12 | 12/12 | 56s |
| 餐饮具 > 纸杯 | 16675 | 容量 text | 1 | ✅ | — |
| 女装 > T恤 | 8463 | 颜色 group + 尺码 size-table | — | ✅ | — |
| 基础建材 > 隔音板 | 9683 | 无 | 1 | ✅ | — |
| 家居饰品 > 门贴 | 22278 | 无 | 1 | ✅ | — |
| 女装 > 休闲裤 | 8475 | 颜色 + 尺码 | — | ✅ | — |
| 餐饮具 > 保温杯 | 16557 | 无 | 1 | ✅ | — |
| 运动鞋 > 跑步鞋 | 12512 | 颜色 group + 鞋码 size-table(欧码) | — | ✅ | — |
| 女装 > 连衣裙 | 8477 | 颜色 group + 尺码 size-table | — | ✅ | — |

### 类目查询 / 拉模板（纯 Node，不开浏览器）

选类目 / 拉属性模板**不需要浏览器**。接口已收进基座注册表
（`mms.categorySearch` / `mms.mallTemplate`），自带签名、节流、Cookie 自愈：

```bash
# 关键词 → 类目树（拿叶子 catId）
node {baseDir}/scripts/pdd-category.mjs search --keyword "T恤" --account "<shopKey>"

# 叶子 catId → 属性 + 规格维度（--save 落成标准模板）
node {baseDir}/scripts/pdd-category.mjs template --cat-id 8463 --account "<shopKey>" --save

# 一条龙：关键词 → 第一个叶子类目 → 模板
node {baseDir}/scripts/pdd-category.mjs resolve --keyword "保温杯" --account "<shopKey>" --save
```

> **只有叶子类目才有模板**。传一级/二级类目接口返回 200 + 空 modules，
> CLI 会明确报 `EMPTY_TEMPLATE` 并退出码 1（不会给你一个空模板去填表）。

## 产品数据格式（不要改字段）

```json
{
  "title": "双层中空纸杯一次性咖啡杯加厚防烫热饮杯",
  "catId": 16675,
  "images": ["E:/p/main1.png", "E:/p/main2.png"],
  "detailImages": ["E:/p/d1.png"],
  "price": "13.8",
  "shipTime": "48小时",
  "specs": [
    { "name": "款式", "values": [{ "value": "雪域哑光" }, { "value": "复古墨绿" }] },
    { "name": "容量", "values": [{ "value": "14oz" }, { "value": "16oz" }] }
  ],
  "skus": [
    { "specs": { "款式": "雪域哑光", "容量": "14oz" }, "price": "11.8", "multiPrice": "10.8", "stock": "500", "itemNo": "A1" }
  ],
  "attributes": { "品牌": ["无品牌/无注册商标"], "重要材质": ["原木浆纸"] }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 平台限 60 字符（**建议 ≤30 汉字**）|
| `catId` | 是 | 叶子类目 ID；决定用哪个模板、规格维度叫什么 |
| `images` | 是 | 本地绝对路径 1~5 张；**颜色 i 对应 `images[i]`**（预览图靠这个映射）|
| `detailImages` | 否 | 详情图，≤50 张 |
| `specs` | 是 | 1~2 维，`name` **必须是该类目模板里的维度名** |
| `skus` | 是 | 必须覆盖全部维度组合，数量 = 各维度值数量乘积 |
| `attributes` | 否 | 按名称给值；缺的必填项由 step6 自动补第一个候选 |
| `price` / `shipTime` | 否 | 参考价（不传自动算）、承诺发货时间 |

## 价格与库存（必读）

### 四个价格字段

| 字段 | 页面表头 | 含义 | 谁填 |
|---|---|---|---|
| `multiPrice` | `*拼单价(元)` | 2 人拼团价，**必须低于单买价** | step12 |
| `price` | `*单买价(元)` | 单独购买价 | step12 |
| `market_price` | 商品参考价 | 划线价，**不得高于最高单买价的 5 倍** | step13 |
| `discount` | 满件折扣 | 5.0~9.9，页面默认 9.5 | step14 |

### 四条硬规则

**① 拼单价必须 < 单买价**（平台要求单买价至少高 1 元）
报错：`单买价至少比拼单价高1元`

**② 参考价 ≤ 最高单买价 × 5** —— 不传 `price` 时 step13 自动取「最大单买价 + 1」，推荐这样。

**③ 无规格类目 = 1 行 SKU**，表头 `0=*库存 1=*拼单价 2=*单买价 3=规格编码 4=商品编码 5=状态`，
step12 会自动判断「表头里没有规格列」→ 直接用 td 索引。⚠ 列名不能包含「规格」二字否则误判成规格列、整体错位。

**④ 价格表是虚拟列表，只渲染约 18 行** —— 一滚动/一聚焦就重渲染收缩。
所以价格**不逐格填**，走平台自带的 **Excel 批量编辑规格**：

```text
①「Excel批量编辑规格」→「导出当前规格数据(N)」
② openpyxl 改 xlsx
③「导入规格数据」→ ★ 必须点弹窗里的「确认编辑」← 少了这步导入等于没发生，页面还不报错
④ 再导出一次做回读校验，逐行比对价格/库存/规格编码
```

逐格填只作兜底，且**行数不足时必须拒绝写**，不能把价格写到别的行上。

### 常见错误

| 报错 | 原因 | 修法 |
|---|---|---|
| `单买价至少比拼单价高1元` | 拼单价 ≥ 单买价 | 单买价 = 拼单价 + 至少 1 |
| `参考价不得高于最高规格单买价的5倍: xxx元` | 传了过大的 `price` | 不传 `price`，让 step13 自动算 |
| `拼单价 39.9≠` / `库存 100≠`（回读不一致）| 列定位错 / 逐格填被滚动带偏 | 走 Excel 批量 |
| `导出文件里找不到这 N 行的规格` | 商品 JSON 的行和页面行对不上 | 检查 specs×skus 是否覆盖全组合 |

## 类目模板（唯一数据源）

模板在 `skills/pdd-publish/templates/<templateId>__<name>/template.json`，
`steps/step4.mjs` 按「目录名以 `-<catId>` 结尾 → 退化为包含 catId」匹配。

**模板决定规格维度的名字和 type**，商品 JSON 的 `specs[].name` 必须与之一致：

- `15023 家居袍/睡袍` 内置「颜色分类 × 参考分类」，写成「图案 × 尺码」会直接报
  `找不到维度「颜色」`；
- 乱点「添加规格类型」还会被误选成「尺寸」。

**新类目首次上架**：

1. 手动上架 1 个商品当样本（或先用 `docs/00-上架固定流程.md` 的预览模式跑一遍看缺什么）
2. `node scripts/pdd-category.mjs template --cat-id <catId> --account <shopKey> --save`
3. 之后自动上架直接复用模板

## 错误处理 / Pitfalls

### 按 failure_kind

| 场景 | failure_kind | 处置 |
|------|-------------|------|
| 未绑定或过期 | `not_bound` / `token_expired` | 引导到「账号连接」重登，**不要重试原请求** |
| 风控拦截（`40002` / 滑块） | `risk_control` | 立即停，等冷却；反复试会延长封禁 |
| 该类目没有模板 | `api_error` | 先拉模板，别硬跑（见「类目模板」） |
| 规格维度名对不上 | `api_error` | 按模板的维度名改 product.json |
| 图片被驳回 | `api_error` | 宽度 750、高 ≤1500、≤3MB；超限切分 |
| 提交后未跳成功页 | `api_error` | 查「排障速查」；草稿页慢时轮询延到 180s |
| 预览被当成失败 | `needConfirm` | 预览不算失败，退出码 0 |

### 页面级现象 → 根因 → 处理（实测）

| 现象 | 根因 | 处理 |
|---|---|---|
| 类目被悄悄发成别的类目 | 缺模板时静默返回失败 | 已修：打日志 + 检查返回值 + 停下给拉模板命令 |
| 30 行只画出 18 行 | 价格表虚拟列表，滚动即收缩 | 滚到中间 + 抖动 + 派发 scroll 补画，补完不回滚 |
| 价格填了但回读不一致 | 逐格填时 focus 触发滚动，值写到别的行 | 走 Excel 批量 |
| Excel 导入后什么都没变、页面也不报错 | 少了点「确认编辑」 | 导入后必点，再导出回读 |
| 预览图步骤报「✅ 0 行」 | 按「含拼单价」找表，命中表头那张空表 | 统一从 `#sku` 取行 |
| 第 19~30 行「无 file input」 | 上传前 `scrollIntoView` 把表格压回 18 行 | 不滚动，行掉了自动补画重试 |
| `打不开「Excel批量编辑规格」弹窗` | 规格没建出来，页面上没有价格表 | 是上游建规格失败的连锁，看 11 步 |
| `页面上找不到该属性` | 该属性名不属于这个类目 | 记录跳过不阻断，真正拦截靠提交前必填校验 |

## 风控与限流

### 错误码表

| 码 | 含义 | 处理 |
|---|---|---|
| `40002` | ERR_HIGH_FREQUENCY 操作太频繁 | 冷却 240s |
| `54001` | ERR_CAPTCHA_CODE 命中风控 | 冷却 60s + 过滑块 |
| `43001` | ERR_SESSION_EXPIRED 会话已过期 | 重新登录 |
| `40001` | ERR_LOGIN_NEEDED 需登录 | 重新登录 |
| `40010` | ERR_NO_PERMISSION 无权限 | 换号 |
| `48143` | 非法请求 | Anti-Content 被复用，需重新生成 |

### 节流参数（`pdd-antiban.mjs` + `pdd-risk.mjs`）

```js
账号级间隔:    4-6 秒（含随机抖动）
接口级间隔:    1.8 秒
40002 后:     冷却 240 秒
54001 后:     冷却 60 秒
滑动窗口:      商品域 20 次/分钟（strict）
```

**关键**：`40002` 是**按接口**计的，不同接口互相独立。

### 滑块

**拼多多滑块在 `#shadow-root (closed)` 内**，普通 `document.querySelector` 永远查不到。
必须在 `goto` 之前注入 hook（`skills/_shared/pdd-shadow-hook.mjs`），
把 `attachShadow` 的 `mode: 'closed'` 改成 `'open'`。

## 工作流 / Workflow

本技能可作为工作流步骤被编排（`skill: pdd-publish`，走 `contract.json` 参数表）。

### W1：单商品上架（最小路径）

```bash
# ① 预览：校验 product.json + 回显上架计划，零写操作
node {baseDir}/steps/index.mjs --product-file "D:/p/product.json" --account "pdd_mms_xxx"

# ② 填完停在提交前，自己看页面对不对
node {baseDir}/steps/index.mjs --product-file "D:/p/product.json" --account "pdd_mms_xxx" \
  --confirm true --stop-before-submit

# ③ 用户明确确认后，真实上架
node {baseDir}/steps/index.mjs --product-file "D:/p/product.json" --account "pdd_mms_xxx" --confirm true
```

### W2：在工作流里批量铺

不要在本技能里循环。让工作流逐轮调用：

```yaml
steps:
  - name: 上架
    skill: pdd-publish      # 走契约参数（product_file / account / confirm）
    args:
      product_file: "{{prev.pack_dir}}/product.json"
      account: "pdd_mms_xxx"
      confirm: "true"
```

> 「一个款铺 N 条链接」已无独立矩阵技能（旧 `pdd-link-matrix` 随旧引擎一起删了）。
> 需要时由工作流按不同标题/主图多次调用本技能。

### W3：新类目首次上架

1. 拉模板：`node scripts/pdd-category.mjs template --cat-id <id> --account <shop> --save`
2. 按模板的维度名组织 product.json
3. `--stop-before-submit` 跑一遍，看必填校验的缺失项
4. 补齐后再提交

## 排障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 未登录 | 浏览器 profile 会话失效 | 到「账号连接」重新登录 |
| 维度「X」不在候选表 | 维度名不是该类目的 | 先拉模板看真实维度名 |
| `属性[X]必填` | 模板缺该项或值与类目不符 | 补 `attributes` 或让 step6 自动补 |
| `详情图数量必须在1-50张` | detailImages 张数不合规 | 调整张数 |
| `40002 操作太过频繁` | 接口限流 | 等冷却（240s）|
| `54001 命中风控` | 触发验证码 | 装 `pdd-shadow-hook.mjs` + 过滑块 |
| `Runtime.callFunctionOn timed out` | Chrome 渲染器节流 | 加防节流 flags |
| `page.mouse.wheel` / `page.screenshot` 卡住 | 该商家后台页面会 hang | 改用 `evaluate` 设 `scrollTop` + 派发 scroll |

## 脚本资产清单（真实存在的）

| 类型 | 路径 | 用途 |
|---|---|---|
| **唯一入口** | `steps/index.mjs` | 1→16 步编排（预览 / 停提交前 / 提交） |
| 步骤 | `steps/step4|5|6|6b|11|12|13|14|15|16.mjs` | 各段实现 |
| SKU 价格 | `steps/helpers/sku-excel.mjs` | Excel 批量导改导 + 回读校验 |
| SKU 行 | `steps/helpers/sku-window.mjs` | 读行 / 补画虚拟列表 |
| 规格 | `steps/helpers/fill-by-group.mjs`、`fill-custom-spec2.mjs`、`size-table-fill.mjs` | 按 type 分派 |
| 属性 | `steps/helpers/attr-fill-js.mjs` | JS 注入批量填属性 |
| 模板 | `templates/index.mjs` | 模板加载 / 构建 |
| 类目 | `scripts/pdd-category.mjs` | 搜类目 / 拉模板（纯 Node）|
| 图处理 | `scripts/compress-images.mjs`、`scripts/img-prep.mjs` | 主图压缩 / 预处理 |
| 组件 | `modules/01~07` | 可复用 RPA 组件（见下） |

插件根 `run-to-submit.mjs` = 入口薄壳；`dev/` 里有测试脚本，**不在发布路径上**。

## RPA 组件（7 个独立模块）

**位置**：`modules/`，每个组件一个文件夹，`index.mjs` 入口 + `README.md` 说明。

| # | 组件 | 主要导出 |
|---|---|---|
| 01 | 图片/视频上传 | `uploadImages` / `probeImageRegion` |
| 02 | 输入框（含 SKU 表格）| `fillInput` / `fillSkuTable` / `fillCustomSpecValues` |
| 03 | 按钮 | `clickButton` / `findButton` / `listButtons` |
| 04 | 下拉选择 | `selectOptions` / `listOptions` / `closeAllSelects` |
| 05 | 单选框 | `selectRadio` / `listRadios` |
| 06 | SKU 预览图 | `setSkuThumbs` / `probeSkuThumbs` |
| 07 | 商品属性批量 | `fillAttributesByName` / `listAttributes` |

### 组件使用原则

1. **一律按需引入单个组件**，不引总入口，避免加载无关代码
2. **值必须先探测**：下拉/单选/属性的可选值用 `listOptions` / `listRadios` / `listAttributes` 先读，不能硬编码
3. **不要写死序号**：属性 id 是 `basic.propertys.{序号}.value`，序号随类目变 → 按名称填

## 教训总结

### 犯过的错误

| # | 错误 | 后果 |
|---|---|---|
| 1 | **用真实店铺做测试** | 创建了 10+ 测试商品、几十条草稿 |
| 2 | **用自己编的测试价格上线** | 没问过真实成本，价格错误、买家拍单亏损 |
| 3 | **把「跑通一次」当「解决了」** | 参数一变就崩，重复一个月 |
| 4 | **反复改代码而不抓真实请求** | 应该一开始就拦页面请求 |

### 正确做法

1. **先隔离**：测试用独立店铺或草稿
2. **先问价格**：任何上架前必须确认真实成本/售价
3. **先抓包**：不要猜平台参数，拦页面真实请求
4. **承认边界**：纯 HTTP 换图做不到就明确说不做到

### 给后续维护者

- **不要试图用纯 HTTP 换图**（19 次尝试、7 种方案、4 个账号全失败）
- **RPA 页面模式是唯一可靠路径**
- **千手也不做纯 HTTP 上传**，图片由页面控件处理
- **淘宝三软件的发布能力都在服务端**，本地逆向不到

## 文档地图

| 文档 | 内容 |
|---|---|
| `docs/00-上架固定流程.md` | **流程固定版**：两个入口、数据格式、三条硬规矩、实测矩阵 |
| `docs/09-实战知识库.md` | 实战知识库（属性/规格/图片/风控长文） |
| `docs/11-规格填充总流程.md` | 规格填充完整流程 |
| `docs/11-CDP操控浏览器.md` | CDP 连接与操控细节 |
| `docs/06-ratelimit.md` | 限流与冷却 |
| `docs/08-troubleshoot.md` | 排障 |
| `docs/05-template-brand.md` | 模板与品牌 |
| `docs/10-规格维度适配.md` | 规格维度适配 |
| 仓库 `docs/knowledge/平台逆向与发布机制.md` | 平台机制**为什么长这样**（虚拟列表、chips、mode2） |

## 附：文件位置

| 内容 | 路径 |
|---|---|
| 本文档 | `skills\pdd-publish\SKILL.md` |
| 步骤 | `skills\pdd-publish\steps\` |
| 脚本 | `skills\pdd-publish\scripts\` |
| 类目模板 | `skills\pdd-publish\templates\<templateId>__<name>\template.json` |
| 基座模块 | `skills\_shared\pdd-*.mjs` |
