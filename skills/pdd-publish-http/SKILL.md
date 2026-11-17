---
name: pdd-publish-http
description: "拼多多商品上架【RPA 页面模式】。用真实浏览器操作发布页：选类目 → 传图 → 填标题/规格/SKU/价格 → 提交。支持 1~2 维规格、任意自定义规格名与数量。核心 publish-flow.mjs（实测 4 单成功）。备选 publish-by-copy.mjs 复制本店商品改包（不换图，8 单成功）。含类目参数实测值、19 次换图失败记录、风控与滑块方案。触发：拼多多上架、拼多多发布、拼多多批量上架、拼多多改SKU。排除：采集比价、订单/库存/客服/分析、淘宝/闲鱼/抖店发布。需绑定拼多多商家后台账号；发布为 L2，须先预览并获用户同意。"
metadata:
  builtin_skill_version: "3.1"
  dsagent:
    display_name: "拼多多·商品上架"
    emoji: "🚀"
    requires: {}
---


---

## 🚫 铁律：未经用户明确许可，禁止改动本技能任何文件

> **用户原话（2026-11-16）：「现在禁止改，我不希望你再改他了，我说改才能改。」**

### 必须遵守

| 禁止 | 说明 |
|---|---|
| ❌ 改代码 | `steps/*.mjs`、`steps/helpers/*.mjs`、`templates/index.mjs`、`modules/*` |
| ❌ 改文档 | `SKILL.md`、`docs/*.md` |
| ❌ 改模板 | `artifacts/pdd-templates/*/template.json` |
| ❌ 改数据结构 | `product.json` 的字段定义 |
| ❌ 「顺手优化」 | 看到可改进的地方也不许动 |
| ❌ 「我觉得有问题」就改 | 先报告现象，等用户判断 |

### 唯一允许

**只有用户说出「改」「改吧」「可以改」这类明确指令，才可以动手。**

### 为什么

这个技能经过 **18 个类目**、几十轮调试才定稿。任何「顺手改一下」都可能导致：

- 已通过的类目跑不通
- 规格/属性判断链断掉
- 提交被平台拦截

**改动前必须先问，改动后必须跑回归测试。**

### 如果发现 bug

1. 先**报告现象**（日志、截图、复现步骤）
2. 等用户判断是否要改
3. 用户说改 → 才改
4. 改完 → 跑 18 类目回归

---
# 拼多多商品上架 · 完整技术文档

> **一句话：要换图就用 RPA 页面（`publish-flow.mjs`），不要碰纯 HTTP 上传。**
>
> 纯 HTTP 换图试了 19 次、7 种方案、4 个账号，全部失败。

## 前置条件

| # | 条件 | 不满足时的现象 | 处置 |
|---|------|---------------|------|
| 1 | 「账号连接」已绑定 **pdd_mms** 账号，状态 `valid` | `not_bound` / `token_expired` | 到「账号连接」绑定或重新登录拼多多商家后台 |
| 2 | `product.json` 已备好（见「四、product.json 格式」） | `api_error`，预览阶段即返回字段缺失 | 按格式补齐；主图/详情图用本地绝对路径 |
| 3 | 该叶子类目模板已建过（`templates/index.mjs build`） | 属性区填不进去 / 提交被拦 | 先建模板；新类目需先手动上架 1 个当样本 |
| 4 | 本机有 Node + Chrome | `skill_error` | 安装后重试 |
| 5 | 账号不在风控冷却期 | `risk_control` / `40002` | 等冷却结束（见「七、风控与限流」），别反复试 |

## 执行入口（宿主按「脚本型」调用本技能）

**唯一入口：`steps/index.mjs`**（与 `contract.json` 的 `entry.script` 一致）

```bash
# 预览（默认）：只校验商品数据 + 回显上架计划，不开浏览器、零写操作
node {baseDir}/steps/index.mjs --product-file "<product.json 绝对路径>" --account "<shopKey>"

# 真实上架：L2 写操作，用户明确确认后才允许带 --confirm true
node {baseDir}/steps/index.mjs --product-file "<product.json 绝对路径>" --account "<shopKey>" --confirm true
```

⚠ 改入口脚本时必须同步改这两行 + `contract.json`。

### 全部走基座

| 模块 | 用途 |
|---|---|
| `pdd-launch.launchStealth()` | 浏览器启动（stealth 参数 + profile 清理）|
| `pdd-antiban.reserveSlot()` | 请求配额节流 |
| `pdd-risk.checkCooldown()` | 账号冷却检查 |
| `pdd-request.request()` | 接口请求（Node 签名 / 浏览器双通道）|

### 步骤 1→16

```
1 打开发布页（事件驱动等新标签，1.9s）
2 主图 5 张（uploadFile + 补派发 input/change）
3 标题
4 类目检查 + 手动选择 + 下一步
5 白底图（JS 注入，不弹窗）
6 属性 + 自动补必填（扫 span.Form_itemRequired）
6b 详情图上传（detailImages → 详情区 input[type=file]）
11 规格（按模板 type 分派）
12 价格库存 + SKU 预览图（rowspan 逻辑列）
13 参考价（不传则自动 = 最大单买价 + 1）
14 满件折扣
15 承诺发货时间
16 提交（内置必填校验 + .success-title 判成功）
```

### 规格分派（核心设计）

模板 `template.json` 里每个维度标 `type`，上架时 `switch(dim.type)` 选填充器：

```js
case 'text':       fillByGroup      // 勾选框 + 输入框按组配对
case 'checkbox':   fillByGroup      // 预设值点选（含裸输入框兜底）
case 'size-table': fillSizeTable    // 尺码表（自动切欧码/中国码）
```

**新类目只需标对 `type`，step11 不用改。**

### 已验证类目（8/8）

| 类目 | catId | 规格 |
|---|---|---|
| 餐饮具 > 纸杯 | 16675 | 容量 text |
| 女装 > T恤 | 8463 | 颜色 group + 尺码 size-table |
| 基础建材 > 隔音板 | 9683 | 无 |
| 家居饰品 > 门贴 | 22278 | 无 |
| 女装 > 休闲裤 | 8475 | 颜色 + 尺码 |
| 餐饮具 > 保温杯 | 16557 | 无 |
| 运动鞋 > 跑步鞋 | 12512 | 颜色 group + 鞋码 size-table(欧码) |
| 女装 > 连衣裙 | 8477 | 颜色 group + 尺码 size-table |

---

### 类目查询（纯 Node，不开浏览器）

选类目 / 拉属性模板**不需要浏览器**。两个接口都已收进基座注册表
（`mms.categorySearch` / `mms.mallTemplate`），自带签名、节流、Cookie 自愈：

```bash
# 关键词 → 类目树（拿叶子 catId）
node {baseDir}/scripts/pdd-category.mjs search --keyword "T恤" --account "<shopKey>"

# 叶子 catId → 属性 + 规格维度（--save 落成标准模板）
node {baseDir}/scripts/pdd-category.mjs template --cat-id 8463 --account "<shopKey>" --save

# 一条龙：关键词 → 第一个叶子类目 → 模板
node {baseDir}/scripts/pdd-category.mjs resolve --keyword "保温杯" --account "<shopKey>" --save
```

实测（2026-11-10，空空商行）：
`保温杯 → 餐饮具 > 杯子/水杯/水壶 > 保温杯/保冷杯 (catId=16557) → templateId=40001，13 个属性`
`T恤 → 女装/女士精品 > T恤 > T恤 (catId=8463) → templateId=53657，15 属性 + 2 规格维（颜色分类 115 预设 / 尺码 91 预设），SKU 上限 900`

> **只有叶子类目才有模板**。传一级/二级类目接口返回 200 + 空 modules，
> CLI 会明确报 `EMPTY_TEMPLATE` 并退出码 1（不会给你一个空模板去填表）。

---

## 目录

1. [结论先行](#一结论先行)
2. [**发布默认值**](#一点五发布默认值rpa-上架必守)
3. [真实成功记录](#二真实成功记录)
4. [两条发布路径](#三两条发布路径)
5. [product.json 格式](#四productjson-格式)
6. [类目参数实测值](#五类目参数实测值)
7. [已知失败清单](#六已知失败清单)
8. [风控与限流](#七风控与限流)
9. [逆向结论](#八逆向结论)
10. [脚本资产清单](#九脚本资产清单)
11. [排障速查](#十排障速查)
12. [教训总结](#十一教训总结)
13. [**RPA 组件**](#十二rpa-组件7-个独立模块)
14. [**拼多多基座**](#十三拼多多基座必须用不要自己造轮子)
15. [**实战知识库**](docs/09-实战知识库.md)
16. [**规格维度适配**](docs/10-规格维度适配.md)
17. [**价格与库存**](#十四价格与库存必读)

---

## 一、结论先行

| 问题 | 答案 |
|---|---|
| 能用吗？ | **RPA 页面模式能用**（4 单成功）|
| 纯 HTTP 能发吗？ | 能，但**不能换图**（8 单成功）|
| 纯 HTTP 能换主图吗？ | **不能**，19 次全失败 |
| 为什么？ | `file/create` 恒返回 `40002`，平台拒绝程序化调用，根因未查明 |

---

## 一点五、发布默认值（RPA 上架必守）

填 SKU 表格时，以下两项**不要求用户提供**，按默认值填：

| 字段 | 默认值 | 规则 |
|---|---|---|
| **库存数量** | **100** | 每行固定 100，不论规格数 |
| **单买价** | **拼单价 + 1** | 单位元，保留两位小数 |

### 示例

| 拼单价 | 单买价（自动） | 库存（自动）|
|---|---|---|
| 19.90 | 20.90 | 100 |
| 21.90 | 22.90 | 100 |
| 99.90 | 100.90 | 100 |

### 代码

```js
import { fillSkuTable } from './modules/02-form-input/index.mjs'

const DEFAULT_STOCK = 100
const DEFAULT_SINGLE_GAP = 1   // 单买价 = 拼单价 + 1

const rows = products.map(p => ({
  quantity: DEFAULT_STOCK,
  groupPrice: p.groupPrice,
  singlePrice: Number((p.groupPrice + DEFAULT_SINGLE_GAP).toFixed(2)),
  outSkuSn: p.itemNo,
}))

await fillSkuTable(page, rows)
```

### 注意

- **参考价（商品参考价）仍要单独算**：必须 > 最大单买价。若最大单买价为 25.90，参考价填 26.90
- 单买价必须严格大于拼单价，`+1` 满足该约束
- 库存 100 是**默认值**，用户明确指定时以用户为准

---

## 二、真实成功记录

### RPA 页面模式（`publish-flow.mjs`）— 4 单

```
1025462371503   源图   纸杯 2维6行
1025846514486   源图   纸杯 2维6行
1026312995086   源图   纸杯 2维6行
1026321720727   源图   纸杯 2维6行
```

### 纯 HTTP（`publish-by-copy.mjs`）— 8 单

```
1026511479126   换图5张   唯一换图成功的一单（页面控件传的图）
1026569086908   源图      纸杯
1026569940637   源图      纸杯
1026574634568   无图      纸杯
1026709254803   源图      门贴
1026710800048   源图      门贴
1026946979990   源图      纸杯
1026952523157   源图      纸杯
```

### 被平台驳回

```
1025450780832   标题与主图主体不一致；图片不清晰
```
**教训：标题必须描述真实商品，主图必须是这个商品本身。**

---

## 三、两条发布路径

### 3.1 RPA 页面模式（推荐）

```bash
# 预览：填到提交前，不点发布
node scripts/publish-flow.mjs --product-file <product.json> --account <shopKey> --no-submit

# 真实发布
node scripts/publish-flow.mjs --product-file <product.json> --account <shopKey> --confirm
```

**内部步骤**
```
1. goods_list -> 点「发布新商品」（开新标签页）
2. goods/category?id=<catId> -> 第1步：主图 + 标题
3. 点「下一步」-> goods_add/index?type=add&from=category&version=predictCate
4. 第2步：规格 / 价格 / 属性
5. 点「提交并上架」
```

**优点**：页面控件上传图片，不碰 `file/create`，没有 40002；页面自动处理属性模板、品牌、详情图装修
**缺点**：60-90 秒/单；偶发元素定位失败

### 3.2 纯 HTTP 复制改包（快，不能换图）

**前提**
1. 本店必须已有同类目商品作复制源（跨店报 `该商品不属于该店铺`）
2. 一个源只能复制一次（再复制报 `600102`），需准备多个源轮换
3. 账号已登录

```bash
# 1. 看本店可复制商品
node scripts/publish-by-copy.mjs --shop <shopKey> --list

# 2. 预览
node scripts/publish-by-copy.mjs --shop <shopKey> --product <json> --source <goodsId> --dry

# 3. 真实发布
node scripts/publish-by-copy.mjs --shop <shopKey> --product <json> --source <goodsId> --confirm
```

**能力边界**

| 能力 | 状态 |
|---|---|
| 改 SKU 规格（1~2 维、任意名、任意数量）| 能 |
| 改标题（≤30 汉字）| 能 |
| 改价格 / 库存 / 编码 | 能 |
| 换主图 / 换详情图 | **不能** |

---

## 四、product.json 格式

```json
{
  "title": "双层中空纸杯一次性咖啡杯加厚防烫热饮杯",
  "images": ["E:/path/to/main1.png", "E:/path/to/main2.png"],
  "price": "29.9",
  "stock": "500",
  "specs": [
    { "name": "款式", "values": [{"value":"雪域哑光"},{"value":"复古墨绿"}] },
    { "name": "容量", "values": [{"value":"14oz"},{"value":"16oz"}] }
  ],
  "skus": [
    { "specs": {"款式":"雪域哑光","容量":"14oz"}, "price":"19.9", "stock":"100", "itemNo":"A1" },
    { "specs": {"款式":"雪域哑光","容量":"16oz"}, "price":"21.9", "stock":"100", "itemNo":"A2" },
    { "specs": {"款式":"复古墨绿","容量":"14oz"}, "price":"20.9", "stock":"100", "itemNo":"B1" },
    { "specs": {"款式":"复古墨绿","容量":"16oz"}, "price":"22.9", "stock":"100", "itemNo":"B2" }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | **最多 30 汉字**，超了平台直接拒 |
| `images` | 否 | 本地绝对路径，1~5 张。不传用源商品图 |
| `price` | 否 | 参考价，必须 > 最大 SKU 单买价 |
| `stock` | 否 | 默认库存 |
| `specs` | 是 | 1~2 维，`name` 必须是该类目候选维度 |
| `skus` | 是 | 必须覆盖全部维度组合 |

**校验规则**：`title` 汉字 ≤ 30；`specs` 维度 ≤ 2；`skus` 数量 = 各维度值数量乘积

---

## 五、类目参数实测值

| 类目 | `cat_id` | `propertys_tid` | `template_module_id` | 品牌 |
|---|---|---|---|---|
| 纸杯 | 16675 | **63387** | **91765** | 必填，`vid` = **157882**（爱绿森）|
| 门贴/隔音棉 | 9683 | **14748** | **17295** | 不需要 |

### 三个必踩的坑

**① `propertys_tid` 填错 → 回退默认模板 → 带出别的类目品牌值**
```
报错：输入的属性值'XXX'不可用,请更换！
曾用童装的 53475，带出了「倾听果」
```

**② `vid` ≠ `brand_id`**
```
/draco-ms/mms/brand/audit/record 返回 brand_id = 143701
提交要用 vid = 157882
报错：属性[品牌]校验错误：该属性必填
```

**③ 两个 body schema 不能混用**

| 接口 | 字段数 | 用途 |
|---|---|---|
| `commit/detail` | 174 | 含大量展示字段，**不能直接提交** |
| `goodsCommit/action/edit` | 157 | 提交必需 |

混用报错：`请求method,argument,body错误`

### 怎么拿这些值

```bash
node scripts/harvest-native-props.mjs --shop <shopKey> --catId <类目ID> --source <源商品ID>
```

原理：打开草稿页 → 点提交 → **拦截页面自己发出的 `action/edit`** → 存下整个 body。

产物：
```
artifacts/pdd-native-props/cat<catId>_<shopKey>.json              ← 属性模板
artifacts/pdd-native-props/cat<catId>_<shopKey>_native-body.json  ← 完整 157 字段
```

**每个类目跑一次，永久复用。**

---

## 六、已知失败清单

### 6.1 纯 HTTP 上传新主图 — 8 种方案全失败

**接口**：`POST /garner/mms/file/create`
**报错**：`{"error_code":40002,"error_msg":"操作太过频繁，请稍后再试！"}`

| # | 尝试 | 结果 |
|---|---|---|
| 1 | Node 直连 fetch + Cookie | 40002 |
| 2 | `page.evaluate` 页面内执行 | 40002 |
| 3 | 补全 `sec-fetch-*` / `sec-ch-ua` 浏览器特征头 | 40002 |
| 4 | 每张图重新生成 Anti-Content | 40002 |
| 5 | 4 种参数组合（原始 / `pic_operations` / `width+height+size` / 换 CDN 域名）| 40002 |
| 6 | 4 个不同店铺账号 | 全部 40002 |
| 7 | 2 种 bucket_tag（`mms-material-img` / `detail`）| 40002 |
| 8 | 先调 `preCheck`（返回 `can_upload: true`）再上传 | 40002 |

**关键事实**
- `get_signature` ✅ 能过
- `store_image` ✅ 能过（拿到 `img.pddpic.com/mms-material-img/...`）
- **`file/create` ❌ 唯一卡点**

**结论：该接口对程序化调用有独立限流，原因未查明，不要再试。**

### 6.2 纯 HTTP 换主图 — 7 种组合全失败

**报错**：`commit/submit → 商品详情图数量必须在1-50张之间`

| # | 尝试 | 结果 |
|---|---|---|
| 1 | `detail_gallery` 同步为新图 | 失败 |
| 2 | `detail_gallery` 保留源图 + 新图 | 失败 |
| 3 | 装修楼层 `img_url` 统一为新图 | 失败 |
| 4 | 装修楼层 `save → query → 回写 action/edit` | 失败 |
| 5 | `gallery` 只放新图 | 失败 |
| 6 | `gallery` 保留源图 + 新图 | 失败 |
| 7 | `file_id` 全部置 null | 失败（装修接口报「非图片空间图片」）|

**确定的规律**
```
不换主图 → 100% 通过（8 单验证）
换主图   → 必报此错（19 次失败）
```

**前端源码里搜不到这个中文报错**（34 个 JS、20MB 全搜过，0 处匹配），说明是**服务端返回**，前端没有对应校验。

### 6.3 其它失败

| 问题 | 现象 | 结论 |
|---|---|---|
| 跨店复制 | `该商品不属于该店铺` | `copyGoodsCommit` 只能本店 |
| 同源复制第二次 | `600102 该商品已被新建过` | 源商品复制一次即锁，需轮换 |
| 标题超长 | `商品标题最多填写30个汉字` | 中文按 1 字算 |
| 参考价缺失 | `商品参考价必须填写` | `market_price` 必填 |
| 参考价过小 | `规格单买价格必须小于参考价格` | `market_price` > 最大单买价 |
| `page.evaluate` 超时 | `Runtime.callFunctionOn timed out` | Chrome 渲染器节流，加 4 个防节流 flag |
| 滑块查不到 | `没找到弹窗：#slide-captcha-dialog` | 在 `closed shadow root` 内 |
| `template/mall` 限流 | `40002` | 阈值极低，正常商家一天调几次 |

---

## 七、风控与限流

### 7.1 错误码表

| 码 | 含义 | 处理 |
|---|---|---|
| `40002` | ERR_HIGH_FREQUENCY 操作太频繁 | 冷却 240s |
| `54001` | ERR_CAPTCHA_CODE 命中风控 | 冷却 60s + 过滑块 |
| `43001` | ERR_SESSION_EXPIRED 会话已过期 | 重新登录 |
| `40001` | ERR_LOGIN_NEEDED 需登录 | 重新登录 |
| `40010` | ERR_NO_PERMISSION 无权限 | 换号 |
| `48143` | 非法请求 | Anti-Content 被复用，需重新生成 |

来源：前端 `app.js` 里的错误码映射表。

### 7.2 节流参数（`pdd-antiban.mjs` + `pdd-risk.mjs`）

```js
账号级间隔:    4-6 秒（含随机抖动）
接口级间隔:    1.8 秒
40002 后:     冷却 240 秒
54001 后:     冷却 60 秒
滑动窗口:      商品域 20 次/分钟（strict）
```

**关键**：`40002` 是**按接口**计的，不同接口互相独立。

### 7.3 滑块

**拼多多滑块在 `#shadow-root (closed)` 内**，普通 `document.querySelector` 永远查不到。

```js
// 必须在 goto 之前注入
await page.evaluateOnNewDocument(`
  const old = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    if (init && init.mode === 'closed') init = {...init, mode: 'open'};
    return old.call(this, init);
  };
`);
```

脚本：`skills/_shared/pdd-shadow-hook.mjs`

---

## 八、逆向结论

### 8.1 觅千手 v5.61（Chrome 扩展）

**位置**：`Desktop\觅千手\`

**真实架构**
```
1. chrome.webRequest 拦截 mms.pinduoduo.com/glide/mms/goodsCommit/action/edit
2. 修改 requestBody
3. 由【页面】代发（不是扩展发）
     sendPagePddEditRequest -> chrome.tabs.sendMessage
         -> content script -> window.postMessage -> 页面内 fetch
4. Anti-Content 每次实时从页面 getAntiContent() 取（不复用）
5. 页面代发失败才走 proxy 兜底
```

**关键代码**
```js
// file_id 处理
e => {
  const r = {...e}
  if (String(e.file_id)?.indexOf("local_") < 0 && !isNaN(Number(e.file_id)))
    r.file_id = e.file_id
  else
    r.file_id = null
  return r
}

// 图片 type 枚举
CAROUSEL_IMAGE = 1   // 主图
DETAIL_IMAGE   = 2   // 详情图

// file/create 真实参数（只有三个字段，无 create_time）
post("/garner/mms/file/create", {
  url: e,
  extension: e.match(/\.(jpeg|png|jpg)/)?.[1],
  name: 随机7位
})
```

**觅千手不做的事**
- `store_image` 搜索 0 处
- `detail_gallery` 搜索 0 处
- 图片由**页面控件**处理

**结论：觅千手的图片走页面，数据转换在云端。云端部分本地逆向不到。**

### 8.2 淘宝三软件（天牛 / 上架助手 / 神笔）

**位置**：`Desktop\童装\发布技能\`

| 软件 | 技术栈 | 有发布能力 | 可复用资产 |
|---|---|---|---|
| 天牛掌柜淘宝版 | .NET + CefSharp | 有 | 属性映射表 158+121 条 |
| 上架助手 6.33 | Python + PyQt5 + Selenium | 无（只改价改库存）| x5secdata 上报思路 |
| 神笔 1.0.9 | Electron | 无（采集仿制）| 采集登录态方案 |

**核心结论**
```
本地壳 -> 原生 TCP 隧道（RSA 协商 + 心跳）-> 服务端（签名/账号池/IP池）
```
**真正的「上货」能力都在服务端，本地只是执行终端。**
**mitmdump 验证：上架助手走原生 socket，HTTP 代理零捕获。**

### 8.3 淘宝 vs 拼多多

| 能力 | 淘宝 | 拼多多 |
|---|---|---|
| mitm 改包铺量 | 可用（10 商品）| 可用（8 单）|
| 改 SKU 结构 | 必须 UI 建 | **能改**（1~2 维任意）|
| 换主图 | UI 上传 + 选图 | 页面控件能传，纯 HTTP 不行 |
| 换类目 | 死路 | 未测 |

**拼多多在「改 SKU」上比淘宝容易——这是优势。**

---

## 九、脚本资产清单

### 入口（唯一）

| 文件 | 作用 |
|---|---|
| `steps/index.mjs` | **统一入口**：步骤 1→16，走基座，含提交前必填校验 |

### 步骤

| 文件 | 作用 |
|---|---|
| `steps/step4.mjs` | 类目检查 + 手动选择（搜索词去 `>` `/`）|
| `steps/step5.mjs` | 白底图（JS 注入不弹窗）|
| `steps/step6.mjs` | 属性 + 自动补必填 |
| `steps/step6b.mjs` | 商品详情图上传（定位 detail-benDi）|
| `steps/step11.mjs` | 规格（按模板 `type` 分派）|
| `steps/step12.mjs` | 价格库存（rowspan 逻辑列）|
| `steps/step13.mjs` | 参考价（不传 = 最大单买价 + 1）|
| `steps/step14.mjs` | 满件折扣 |
| `steps/step15.mjs` | 承诺发货时间 |
| `steps/step16.mjs` | 提交（内置必填校验）|

### 规格填充组件（核心）

| 文件 | 作用 |
|---|---|
| `steps/helpers/fill-by-group.mjs` | 勾选框 + 输入框按组配对（预设/自定义/裸输入框三模式）|
| `steps/helpers/size-table-fill.mjs` | 通用尺码表（自动切欧码/中国码，兼容鞋码）|
| `steps/helpers/product-schema.mjs` | 入口校验（不开浏览器就拦错，含 SKU 笛卡尔积检查）|

### 工具

| 脚本 | 作用 |
|---|---|
| `scripts/pdd-category.mjs` | 类目搜索 + 模板拉取（纯 Node）|
| `scripts/pull-tpl-final.mjs` | 批量拉 4 个类目模板 |
| `scripts/tag-types.mjs` | 给模板标 `type` |
| `scripts/scan-required.mjs` | 扫必填项写入模板 |
| `scripts/inject-cookie.mjs` | 把凭证库 cookie 注入浏览器 profile |
| `scripts/open-keep.mjs` | 打开浏览器并保持 |
| `scripts/test-8cats.mjs` | 8 类目全量验证 |
| `scripts/compress-images.mjs` | 图片压缩 |
| `scripts/img-prep.mjs` | 主图预处理 |

### 已弃用

`scripts/_deprecated/` —— 旧版 `publish*.mjs` / `attr-*` / `spec-*` / `sku-*` / `vision-*` 等 24 个脚本，
已被 `steps/index.mjs` 取代。保留仅作历史参考，**不要再用**。


## 十、排障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 未登录 | 浏览器 profile 会话失效 | 到「账号连接」重新登录 |
| 维度「X」不在候选表 | 维度名不是该类目的 | 先跑 `spec/name/list` 看候选 |
| `action/edit 请求body错误` | 用了 `commit/detail` 而非原生 body | 跑 `harvest-native-props.mjs` |
| `属性[X]必填` | `propertys_tid` 不对或缺属性 | 同上 |
| `详情图数量必须在1-50张` | 换主图后详情图没同步 | **改用 `publish-flow.mjs`** |
| `copyGoodsCommit 600102` | 该源已复制过 | 换 `--source` |
| `该商品不属于该店铺` | 跨店复制 | 只能用本店商品 |
| `40002 操作太过频繁` | 接口限流 | 等冷却（240s）|
| `54001 命中风控` | 触发验证码 | 装 `pdd-shadow-hook.mjs` + 过滑块 |
| `Runtime.callFunctionOn timed out` | Chrome 渲染器节流 | 加防节流 flags |
| 找不到「保存草稿」按钮 | 草稿页加载慢 | 延长轮询到 180s |

---

## 错误处理 / Pitfalls

| 场景 | failure_kind | 处置 |
|------|-------------|------|
| 未绑定或过期 | `not_bound` / `token_expired` | 引导到「账号连接」重登，**不要重试原请求** |
| 风控拦截（`40002` / 滑块） | `risk_control` | 立即停，等冷却；反复试会延长封禁（见「七、风控与限流」） |
| 类目属性填不进 | `api_error` | 多为模板缺失 → 先 `templates/index.mjs build`；或该类目需人工补必填项 |
| 图片被驳回 | `api_error` | 按 `_shared/PDD-KNOWLEDGE.md` 第十八章规则处理（宽度 750、高 ≤1500、超限切分、≤3MB） |
| 规格面板定位失败 | `api_error` | 用 `sku-panel-v2.mjs`；若 DOM 改版，参考知识库第十九章的视觉识别方案 |
| 提交后未跳成功页 | `api_error` | 查「十、排障速查」；草稿页加载慢时轮询可延到 180s |
| 预览被当成失败 | `needConfirm` | 预览不算失败，退出码 0 |

---

## 十一、教训总结

### 犯过的错误

| # | 错误 | 后果 |
|---|---|---|
| 1 | **用真实店铺做测试** | 创建了 10+ 测试商品、几十条草稿，部分标题是「二维测试_口味×容量_6行」|
| 2 | **用自己编的测试价格上线** | 没问过真实成本，导致价格错误、买家拍单亏损 |
| 3 | **把「跑通一次」当「解决了」** | 每次猜对参数就上线，参数一变就崩，重复一个月 |
| 4 | **反复改代码而不抓真实请求** | 应该一开始就用 `harvest-native-props` 拦截页面请求 |

### 正确做法

1. **先隔离**：测试用独立店铺或草稿，不要用真实在售商品
2. **先问价格**：任何上架前必须确认真实成本/售价
3. **先抓包**：不要猜平台参数，拦截页面真实请求
4. **承认边界**：纯 HTTP 换图做不到，就明确说不做到，不要反复试

### 给后续维护者

- **不要试图用纯 HTTP 换图**（19 次尝试、7 种方案、4 个账号全失败）
- **RPA 页面模式是唯一可靠路径**
- **千手也不做纯 HTTP 上传**，图片由页面控件处理
- **淘宝三软件的发布能力都在服务端**，本地逆向不到

---

## 工作流 / Workflow

本技能可作为工作流步骤被编排（`skill: pdd-publish-http`，走 `contract.json` 参数表）。

### W1：单商品上架（最小路径）

```bash
# ① 预览：校验 product.json + 回显上架计划，零写操作
node {baseDir}/steps/index.mjs --product-file "D:/p/product.json" --account "pdd_mms_xxx"

# ② 用户明确确认后，真实上架
node {baseDir}/steps/index.mjs --product-file "D:/p/product.json" --account "pdd_mms_xxx" --confirm true
```

### W2：在工作流里批量铺（推荐用法）

不要在本技能里循环。正确做法是让工作流逐轮调用：

```yaml
# skills/workflows/<某工作流>/workflow.yaml
steps:
  - name: 上架
    skill: pdd-publish-http      # 走契约参数（product_file / account / confirm）
    args:
      product_file: "{{prev.pack_dir}}/product.json"
      account: "pdd_mms_xxx"
      confirm: "true"
```

> 需要「一个款铺 N 条链接」时，用 `pdd-link-matrix`（`matrix.mjs`）或
> `skills/workflows/拼多多多链接矩阵`（自带 `run.py` 出素材）。

### W3：新类目首次上架

1. 手动上架 1 个商品当样本
2. `node templates/index.mjs build --cat <catId> --name <名字>` 沉淀类目模板
3. 之后自动上架直接复用模板，属性区可自动填

---

## 十三、拼多多基座（必须用，不要自己造轮子）

> ★ 2026-11-10 定稿：所有上架脚本必须走基座，禁止直接用裸 fetch / 裸 puppeteer。

### 基座模块（`skills/_shared/`）

| 模块 | 用途 | 关键导出 |
|---|---|---|
| `pdd-launch.mjs` | 启动 / 连接浏览器 | `launchStealth`、`STEALTH_ARGS`、`clearProfileLocks` |
| `pdd-request.mjs` | 接口请求（Node + Browser 双通道）| `request`、`invalidateStoreCookieCache` |
| `pdd-antiban.mjs` | 防风控节流 | `reserveSlot`、`canUse`、`backoffWait`、`getAccountState` |
| `pdd-risk.mjs` | 滑块 / 冷却 / 账号锁 | `guard`、`checkCooldown`、`markCooldown`、`solveSlider` |
| `pdd-vodka-signer.mjs` | vodka 域 0as 签名 | `signForAccount`、`initSandbox` |
| `pdd-seed-store.mjs` | localStorage 种子 | `readSeed`、`writeSeed`、`exportSeedFromBrowser` |
| `pdd-seed-auto.mjs` | 种子自动刷新 | `ensureSeed`、`seedStatus` |
| `pdd-http.mjs` | Cookie 工具 | `cookiesOf`、`call` |
| `pdd-guard.mjs` | 任务级守卫 | `openTask`、`withPddGuard` |
| `pdd-slider-solver.mjs` | 滑块求解 | `solveSliderInPage`、`diagnoseSlider` |

### 三条必须遵守的规则

**① 接口请求走 `request()`，不要裸 fetch**

```js
import { request } from '../../_shared/pdd-request.mjs'

const r = await request('/draco-ms/mms/template/mall?catId=16675', {}, {
  method: 'GET',
  account: acc,          // 凭证库账号对象
  shopKey: acc.shop_key,
  page: p,               // 传了就有浏览器兜底
})
// r = { ok, data, ec, channel, error_msg }
```

**为什么**：`template/mall` 用裸 fetch 一定 40002；`request()` 会自动加 Anti-Content 签名，并按需节流。

**② 浏览器用 connect，不要 kill chrome**

```js
// ✅ 对：扫端口找已有浏览器
const ports = execSync('Get-NetTCPConnection -State Listen ...')
for (const pt of ports) {
  const j = await (await fetch(`http://127.0.0.1:${pt}/json/version`)).json()
  if (/Chrome/i.test(j.Browser)) {
    const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${pt}` })
    if ((await b.pages()).some(x => /mms.pinduoduo.com/.test(x.url()))) return b
  }
}

// ❌ 错：Get-Process chrome | Stop-Process -Force   ← 会杀掉用户窗口 + 丢登录态
```

**③ 40002 第一次就停，不要重试**

```js
if (!r.ok && r.ec === 40002) {
  return { ok: false, error: '限流，请等 30 分钟' }   // 不要循环重试
}
```

重试只会加重限流，且**同一账号/同一通道都无效**，换账号也一样。

### 请求前先拿配额

```js
import * as AB from '../../_shared/pdd-antiban.mjs'

const slot = await AB.reserveSlot('pdd_mms', '/draco-ms/mms/template/mall')
if (slot.waitMs > 0) await new Promise(r => setTimeout(r, slot.waitMs))
```

---

## 十四、价格与库存（必读）

### 四个价格字段

| 字段 | 页面表头 | 含义 | 谁填 |
|---|---|---|---|
| `multiPrice` | `*拼单价(元)` | 2 人拼团价，**必须低于单买价** | step12 |
| `price` | `*单买价(元)` | 单独购买价 | step12 |
| `market_price` | 商品参考价 | 划线价，**不得高于最高单买价的 5 倍** | step13 |
| `discount` | 满件折扣 | 5.0~9.9，页面默认 9.5 | step14 |

### 商品数据里的写法

```json
{
  "price": 39.9,          // 单买价（SKU 行没写 price 时用它）
  "discount": 9.5,        // 满件折扣
  "skus": [
    {
      "specs": { "颜色分类": "白色", "尺码": "M" },
      "stock": 100,       // → 库存
      "multiPrice": 29.9, // → 拼单价
      "price": 39.9,      // → 单买价
      "itemNo": "白色-M"  // → 规格编码
    }
  ]
}
```

### 三条硬规则

**① 拼单价必须 < 单买价**

平台校验：单买价至少比拼单价高 1 元。否则提交报错：
```
单买价至少比拼单价高1元
```

**② 参考价 ≤ 最高单买价 × 5**

不传 `price` 给 step13 时，**自动计算**（推荐）：

```js
// steps/step13.mjs
let val = opts.value
if (val === undefined || val === null || val === '') {
  let maxPrice = 0
  for (const r of skuRows) { const p = Number(r.price); if (p > maxPrice) maxPrice = p }
  val = (maxPrice + 1).toFixed(2)   // 最大单买价 + 1
}
```

实例：连衣裙最高单买价 39.9 → 参考价自动 40.9（安全，远低于 199.5 上限）。

**③ 无规格类目 = 1 行 SKU**

纸杯/保温杯/隔音板/门贴这类无规格类目，SKU 表只有 1 行且**没有规格列**：

```
表头：0=*库存 1=*拼单价 2=*单买价 3=规格编码 4=商品编码 5=状态
```

step12 会自动判断：表头里没有 `颜色分类/尺码/鞋码/容量/款式/尺寸` → 直接用 td 索引，不做 rowspan 推算。

⚠ 不能包含「规格编码」——它含「规格」二字会被误判成规格列，导致整体错位一列。

### 库存

| 字段 | 页面 | 说明 |
|---|---|---|
| `stock` / `quantity` | `*库存` | 整数，按行填 |

### 常见错误

| 报错 | 原因 | 修法 |
|---|---|---|
| `单买价至少比拼单价高1元` | 拼单价 ≥ 单买价 | 单买价 = 拼单价 + 至少 1 |
| `参考价不得高于最高规格单买价的5倍: xxx元` | 传了过大的 `price` | 不传 `price`，让 step13 自动算 |
| `拼单价 39.9≠`（回读不一致）| 列定位错（规格编码被误判成规格列）| 已修，见上 |
| `库存 100≠`（回读不一致）| rowspan 推算偏移 | 已修 |

### 实测价格（8 类目验证时用的）

| 类目 | 拼单价 | 单买价 | 参考价（自动）| 库存 |
|---|---|---|---|---|
| 纸杯 | 10.8 / 11.8 | 11.8 / 12.8 | 13.8 | 500 |
| 女装T恤 | 29.9 | 39.9 | 40.9 | 100 |
| 跑步鞋 | 129 | 159 | 160 | 100 |
| 保温杯 | 39.9 | 49.9 | 50.9 | 200 |
| 连衣裙 | 29.9 | 39.9 | 40.9 | 100 |
| 休闲裤 | 29.9 | 39.9 | 40.9 | 100 |

---

## 十五、铁律：不要擅自改（2026-11-15 定稿）

> **只能用户说改才能改。发现问题 → 记录 → 等指令。**

### 禁止的自主操作

| 禁止 | 后果（实测） |
|---|---|
| 改 `template.json` 的 `name` 字段 | 童装 15021 把「参考分类」改成「身高」→ step11 全线失败，20 单全废 |
| 改 `presetValues` 结构 | 把数组写成字符串 → 模板报废，只能重新拉接口 |
| 改 `step*.mjs` 的匹配逻辑 | 上游数据没对齐时改逻辑，等于在错误方向上打补丁 |
| 猜测页面维度名 | 「参考分类」「身高」「尺码」都可能，猜错 3 次 wasted 30+ 分钟 |

### 正确做法

```
① 发现卡点 → 停下
② 把「模板怎么说的」「页面怎么显示的」「报错原文」三样记下来
③ 报告给用户，等明确指令
④ 用户说改，才改
```

### 模板是唯一数据源

`template.json` 里的 `name` / `refPid` / `presetValues` **全部来自 `/draco-ms/mms/template/mall?catId=xxx` 接口原文**。
不允许手改任何字段。模板坏了只有一条路：**重新拉接口重建**。

```js
// 重建模板（唯一正确方式）
const r = await request('/draco-ms/mms/template/mall?catId=15021', {}, {
  method: 'GET', account: acc, shopKey: acc.shop_key, page,
})
await T.buildTemplate({ catId: 15021, categoryName: '家居服套装', shopKey: acc.shop_key, keywords: ['家居服套装'], page, _raw: r.data })
```

---

## 十六、童装 15021 卡点记录（未解决，等指令）

### 类目

```
童装/婴儿装/亲子装 > 儿童家居服 > 家居服套装
catId = 15021
```

### 模板说什么（接口原文，已重建，数据干净）

```
规格 mode=mixed, maxDims=2

维度0  颜色分类   refPid=232  controlType=3  preset=115
       分组：白色系4 / 灰色系10 / 黑色系1 / 红色系18 / 黄色系16
             绿色系17 / 蓝色系17 / 紫色系9 / 棕色系21 / 透明系1 / 花色系1

维度1  参考分类   refPid=251  controlType=3  preset=54
       group=身高      26 个：48/52/59/66/73/75/80/85/90/95/100/105
                              110/115/120/125/130/135/140/145/150/155/160/165/170/175
       group=国际标准  28 个：1#/2#/3#/4#/5# ... 28#

属性 16 条（材质成分为必填，26 个选项）
```

### 页面实际维度名（用户确认 2026-11-15）

| 顺序 | 页面显示 | 模板里写的 | 是否一致 |
|---|---|---|---|
| 维度1 | **颜色** | 颜色分类 | ❌ 多了「分类」二字 |
| 维度2 | **尺寸** | 参考分类 | ❌ 完全不同 |

**这就是「找不到维度」的根因**：模板名与页面标题不一致，`fillByGroup` 按标题精确匹配时匹配不到。

### 页面报什么

```
11 ❌ 120:找不到维度「参考分类」
      130:找不到维度「参考分类」
      140:找不到维度「参考分类」
      150:找不到维度「参考分类」
      160:找不到维度「参考分类」
      170:找不到维度「参考分类」
```

### 流程走到哪

```
1  打开发布页      ✅
2  主图 1 张       ✅
3  标题（59/60字符）✅
4  类目匹配        ✅
5  白底图          ✅ 跳过
6  属性            ✅（自动补必填：商品参考价、承诺发货时间）
6b 详情图 1 张     ✅（locate=detailBenDi）
11 规格            ❌ ← 卡在这里
12/16             未执行
```

### 已排除

| 怀疑点 | 结论 |
|---|---|
| 模板数据坏 | 已重新拉接口重建，115+54 预设值完整 |
| 值不存在 | 120/130/140/150/160/170 全在「身高」组里 |
| 标题超限 | 已修（汉字算 2 字符，59/60 合规）|
| 浏览器/账号 | 正常，1~6b 全过 |

### 待确认（需要用户指令）

1. 页面上第 2 个规格维度的**真实标题文字**是什么
2. 页面上「参考分类」这个维度是否需要先手动加出来（点「添加规格类型」→ 选维度名）
3. 第 2 维是否是**页面自带**（像女装尺码表那样不需要手动加）

**在用户确认前，不要改 step11.mjs。**

---

## 附：文件位置

| 内容 | 路径 |
|---|---|
| 本文档 | `DSAgent-Plugin\skills\pdd-publish-http\SKILL.md` |
| **实战知识库** | `DSAgent-Plugin\skills\pdd-publish-http\docs\09-实战知识库.md` |
| 脚本 | `DSAgent-Plugin\skills\pdd-publish-http\scripts\` |
| 步骤 | `DSAgent-Plugin\skills\pdd-publish-http\steps\` |
| **类目模板** | `DSAgent-Plugin\artifacts\pdd-templates\<类目>-<catId>\` |
| 基座模块 | `DSAgent-Plugin\skills\_shared\pdd-*.mjs` |
| 千手扩展 | `Desktop\觅千手\` |
| 淘宝逆向资料 | `Desktop\童装\发布技能\` |
| 拼多多 JS 分析 | `Desktop\童装\pdd_js_analysis\` |

---

## 十二、RPA 组件（7 个独立模块）

**位置**：`modules/`，每个组件一个文件夹，`index.mjs` 入口 + `README.md` 说明。

| # | 组件 | 文件 | 主要导出 |
|---|---|---|---|
| 01 | 图片/视频上传 | `modules/01-image-upload/index.mjs` | `uploadImages` / `probeImageRegion` |
| 02 | 输入框（含 SKU 表格）| `modules/02-form-input/index.mjs` | `fillInput` / `fillSkuTable` / `fillCustomSpecValues` |
| 03 | 按钮 | `modules/03-button/index.mjs` | `clickButton` / `findButton` / `listButtons` |
| 04 | 下拉选择 | `modules/04-select/index.mjs` | `selectOptions` / `listOptions` / `closeAllSelects` |
| 05 | 单选框 | `modules/05-radio/index.mjs` | `selectRadio` / `listRadios` |
| 06 | SKU 预览图 | `modules/06-sku-thumb/index.mjs` | `setSkuThumbs` / `probeSkuThumbs` |
| 07 | 商品属性批量 | `modules/07-attributes/index.mjs` | `fillAttributesByName` / `listAttributes` |

### 完整上架示例（第 2 步 SKU 区）

```js
import { fillSkuTable } from './modules/02-form-input/index.mjs'
import { fillAttributesByName } from './modules/07-attributes/index.mjs'
import { setSkuThumbs } from './modules/06-sku-thumb/index.mjs'
import { clickButton } from './modules/03-button/index.mjs'

// ① 属性（按名称，不写死序号）
await fillAttributesByName(page, {
  '品牌': ['无品牌/无注册商标'],
  '适用场景': ['家用', '办公'],
  '重要材质': ['原木浆纸'],
})

// ② SKU 表格：库存默认 100，单买价 = 拼单价 + 1
const DEFAULT_STOCK = 100
const DEFAULT_SINGLE_GAP = 1
await fillSkuTable(page, skus.map(s => ({
  quantity: DEFAULT_STOCK,
  groupPrice: s.price,
  singlePrice: Number((s.price + DEFAULT_SINGLE_GAP).toFixed(2)),
  outSkuSn: s.itemNo,
})))

// ③ 预览图
await setSkuThumbs(page, { urls: galleryUrls })

// ④ 参考价（必须 > 最大单买价）
const maxSingle = Math.max(...skus.map(s => s.price + DEFAULT_SINGLE_GAP))
await fillInput(page, { trackingId: 'goods_advice_price', value: (maxSingle + 1).toFixed(2) })

// ⑤ 提交
await clickButton(page, { text: '提交并上架', waitNavigation: true })
```

### 组件使用原则

1. **一律按需引入单个组件**（`import from './modules/0X-xxx/index.mjs'`），不引总入口，避免加载无关代码
2. **值必须先探测**：下拉/单选/属性的可选值用 `listOptions` / `listRadios` / `listAttributes` 先读，不能硬编码
3. **不要写死序号**：属性 id 是 `basic.propertys.{序号}.value`，序号随类目变 → 按名称填
