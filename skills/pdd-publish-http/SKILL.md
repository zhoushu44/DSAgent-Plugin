---
name: pdd-publish-http
description: "拼多多商品上架【RPA 页面模式】。用真实浏览器操作发布页：选类目 → 传图 → 填标题/规格/SKU/价格 → 提交。支持 1~2 维规格、任意自定义规格名与数量。核心 publish-flow.mjs（实测 4 单成功）。备选 publish-by-copy.mjs 复制本店商品改包（不换图，8 单成功）。触发：拼多多上架、拼多多发布、拼多多批量上架、拼多多改SKU。排除：采集比价、订单/库存/客服/分析、淘宝/闲鱼/抖店发布。需绑定拼多多商家后台账号；发布为 L2，须先预览并获用户同意。"
metadata:
  builtin_skill_version: "3.0"
  dsagent:
    display_name: "拼多多·商品上架"
    emoji: "🚀"
    requires: {}
---

# 拼多多 · 商品上架（RPA 页面模式）

> **结论先行：走 RPA 页面操作，不要走纯 HTTP。**
>
> 纯 HTTP 在「换主图」这一步必然失败（19 次尝试、7 种方案、4 个账号，全部卡在同一个服务端校验）。
> 页面操作慢，但页面自己处理图片/属性/详情图，不会失败。

---

## 目录

1. [快速决策](#一快速决策)
2. [推荐路径 publish-flow.mjs](#二推荐路径-publish-flowmjs)
3. [备选路径 publish-by-copy.mjs](#三备选路径-publish-by-copymjs)
4. [product.json 格式](#四productjson-格式)
5. [脚本清单](#五脚本清单)
6. [已知失败清单](#六已知失败清单不要重复踩)
7. [排障速查](#七排障速查)

---

## 一、快速决策

| 场景 | 用哪个 | 能换图 | 速度 | 实测 |
|---|---|---|---|---|
| **要换主图 / 详情图** | `publish-flow.mjs` | 能 | 60-90 秒 | 4 单成功 |
| **不换图，只改 SKU/标题/价格** | `publish-by-copy.mjs` | 不能 | 78 秒 | 8 单成功 |
| 批量多个商品 | `batch-publish.mjs` | 能 | 慢 | 未验证 |
| 纯 HTTP 换图 | —— | 不能 | —— | **19 次全失败，别再试** |

**一句话：要换图就一定是页面模式。**

---

## 二、推荐路径 publish-flow.mjs

页面全流程编排。页面自己处理图片上传、属性、详情图装修。

### 用法

```bash
# 预览：填到提交前，保留浏览器供人工核对，不点击发布
node scripts/publish-flow.mjs --product-file <product.json> --account <shopKey> --no-submit

# 真实发布（L2，需用户明确同意）
node scripts/publish-flow.mjs --product-file <product.json> --account <shopKey> --confirm
```

### 内部步骤

```
1. 打开 goods_list -> 点「发布新商品」（会开新标签页）
2. goods/category?id=<catId> -> 第1步：主图 + 标题
3. 点「下一步」-> goods_add/index?type=add&from=category&version=predictCate
4. 第2步：规格 / 价格 / 属性
5. 点「提交并上架」
```

### 优点

- 页面控件上传图片，**不碰 file/create，没有 40002**
- 页面自动处理属性模板、品牌、详情图装修
- 不同类目自动适配（页面自己加载对应模板）

### 缺点

- 慢：60-90 秒/单
- 依赖页面渲染，偶发元素定位失败

### 实测成功记录（4 单）

```
1025462371503
1025846514486
1026312995086
1026321720727
```

---

## 三、备选路径 publish-by-copy.mjs

复制本店已有商品 -> 改 SKU/标题/价格 -> 提交。

### 前提

1. **本店必须已有同类目商品**作复制源（跨店报 `该商品不属于该店铺`）
2. **一个源商品只能复制一次**（再复制报 `600102`），需准备多个源轮换
3. 账号已登录

### 用法

```bash
# 1. 看本店可复制的商品
node scripts/publish-by-copy.mjs --shop <shopKey> --list

# 2. 预览
node scripts/publish-by-copy.mjs --shop <shopKey> --product <json> --source <goodsId> --dry

# 3. 真实发布
node scripts/publish-by-copy.mjs --shop <shopKey> --product <json> --source <goodsId> --confirm
```

### 能力边界

| 能力 | 状态 |
|---|---|
| 改 SKU 规格（1~2 维、任意名字、任意数量）| 能 |
| 改标题（≤30 汉字）| 能 |
| 改价格 / 库存 / 编码 | 能 |
| **换主图** | **不能，必失败** |
| **换详情图** | 同上 |

### 实测成功记录（8 单）

```
1026511479126  换图（唯一成功的一次，页面控件传的）
1026569086908  源图
1026569940637  源图
1026574634568  无图
1026709254803  门贴 源图
1026710800048  门贴 源图
1026946979990  源图
1026952523157  源图
```

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

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | **最多 30 汉字**，超了平台直接拒 |
| `images` | 否 | 本地图片绝对路径，1~5 张。不传则用源商品图 |
| `price` | 否 | 参考价，必须 > 最大 SKU 单买价 |
| `stock` | 否 | 默认库存 |
| `specs` | 是 | 1~2 维，`name` 必须是该类目候选维度 |
| `skus` | 是 | 必须覆盖全部维度组合 |

### 校验规则（脚本会先查）

- `title` 汉字数 ≤ 30
- `specs` 维度数 ≤ 2
- `skus` 数量 = 各维度值数量的乘积

---

## 五、脚本清单

### 5.1 主流程

| 脚本 | 作用 |
|---|---|
| `publish-flow.mjs` | **页面全流程**（推荐，能换图）|
| `publish-by-copy.mjs` | 复制改包（快，不能换图）|
| `publish-v2.mjs` | 页面流程 v2（含 AI 视觉填表）|
| `batch-publish.mjs` | 批量遍历目录发布 |

### 5.2 类目与属性

| 脚本 | 作用 |
|---|---|
| `harvest-native-props.mjs` | 拦截页面 action/edit，拿权威属性结构（propertys_tid / 品牌 vid）|
| `category-template.mjs` | 类目模板库 |
| `attr-harvest.mjs` | 采集类目属性清单 |
| `attr-fill-generic.mjs` | 通用属性填写 |
| `attr-composite.mjs` | 复合字段（「添加XX」多行）|

### 5.3 表单填写（DOM 流程内部）

`stage-nav.mjs` / `stage-submit.mjs` / `field-basic.mjs` / `field-images.mjs` / `field-service.mjs` / `field-shipping.mjs` / `spec-dims.mjs` / `spec-row-fill.mjs` / `sku-table.mjs` / `sku-thumb.mjs`

### 5.4 图片

`img-prep.mjs` / `compress-images.mjs` / `imgprep.py`

### 5.5 视觉辅助

`vision-fill.mjs` / `vision-cache.mjs` / `analyze_spec_ui.py`

### 5.6 共享依赖

| 路径 | 作用 |
|---|---|
| `skills/_shared/pdd-antiban.mjs` | 节流（账号级 4-6s / 接口级 1.8s）|
| `skills/_shared/pdd-risk.mjs` | 风控（20 次/分 + 冷却 + 滑块 + 账号锁）|
| `skills/_shared/pdd-shadow-hook.mjs` | 破解滑块 closed shadow root |
| `skills/_shared/pdd-slider-solver.mjs` | 滑块识别与拖拽 |
| `lib/pdd-image-preupload.js` | 页面内图片上传（走页面控件）|

---

## 六、已知失败清单（不要重复踩）

| # | 问题 | 现象 | 试过什么 | 结论 |
|---|---|---|---|---|
| 1 | **纯 HTTP 上传新主图** | `file/create` 恒返回 `40002 操作太过频繁` | Node 直连 / 页面内执行 / 补 sec-fetch 头 / 换 Anti-Content / 4 种参数组合 / 4 个账号 / 3 种 bucket / 加 preCheck | **全失败**。store_image 能过，只有 file/create 挂。原因未查明，别再试 |
| 2 | **纯 HTTP 换主图** | `commit/submit` 报 `商品详情图数量必须在1-50张` | 1) detail_gallery 同步为新图 2) 保留源图+新图 3) 装修楼层统一 4) save→query→回写 5) gallery 只放新图 6) gallery 保留源图+新图 7) file_id 置 null | **19 次全失败**。不换图则 100% 通过。**换图必须走页面** |
| 3 | **跨店复制** | `该商品不属于该店铺` | —— | copyGoodsCommit 只能本店 |
| 4 | **同源复制第二次** | `600102 该商品已被新建过` | 换 commit_id 重试 | 源商品复制一次即锁，需轮换源 |
| 5 | **标题超长** | `商品标题最多填写30个汉字` | —— | 脚本已前置校验 |
| 6 | **参考价** | `商品参考价必须填写` / `规格单买价格必须小于参考价格` | —— | market_price 必须 > 最大单买价 |
| 7 | **body schema 混用** | `请求method,argument,body错误` | 用 commit/detail 的 174 字段 | 必须用 harvest-native-props.mjs 存的原生 157 字段 body 做底座 |
| 8 | **propertys_tid 错** | `输入的属性值'XXX'不可用`（别的类目品牌）| 用 53475 | 平台按 propertys_tid 选模板，填错会回退默认模板 |
| 9 | **vid 用成 brand_id** | `属性[品牌]校验错误：该属性必填` | 用 brand_id: 143701 | vid ≠ brand_id |
| 10 | **page.evaluate 超时** | `Runtime.callFunctionOn timed out` | 加 Chrome 防节流 flags | 缓解未根治 |
| 11 | **滑块查不到** | `没找到弹窗：#slide-captcha-dialog` | 常规 querySelector | 在 closed shadow root 内，必须先装 pdd-shadow-hook.mjs（goto 之前）|
| 12 | **template/mall 限流** | `40002` | 重试 | 阈值极低，用 harvest-native-props.mjs 存本地模板 |
| 13 | **页面控件上传图后图没生效** | 上传成功但 gallery 不变 | 直接 input[type=file] 上传 | 还需要在「图片空间上传」弹窗里选中确认（未验证）|

### 关键类目参数（已实测）

| 类目 | cat_id | propertys_tid | template_module_id | 品牌 |
|---|---|---|---|---|
| 纸杯 | 16675 | 63387 | 91765 | 必填，vid=157882（爱绿森）|
| 门贴/隔音棉 | 9683 | 14748 | 17295 | 不需要 |

---

## 七、排障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 未登录 | 浏览器 profile 会话失效 | 到「账号连接」重新登录 |
| 维度「X」不在候选表 | 维度名不是该类目的 | 先跑 spec/name/list 看候选 |
| action/edit 请求body错误 | 用了 commit/detail 而非原生 body | 跑 harvest-native-props.mjs 建模板 |
| 属性[X]必填 | propertys_tid 不对或缺属性 | 同上 |
| 详情图数量必须在1-50张 | 换主图后详情图没同步 | **改用 publish-flow.mjs** |
| copyGoodsCommit 600102 | 该源已复制过 | 换 --source |
| copyGoodsCommit 该商品不属于该店铺 | 跨店复制 | 只能用本店商品 |
| 40002 操作太过频繁 | 接口限流 | 已内置节流，等待冷却 |
| 54001 命中风控 | 触发验证码 | 装 pdd-shadow-hook.mjs + 自动过滑块 |
| Runtime.callFunctionOn timed out | Chrome 渲染器节流 | 加防节流 flags，关键接口走 Node |
| 找不到「保存草稿」按钮 | 草稿页加载慢 | 延长轮询到 180s |

---

## 八、给后续维护者

1. **不要试图用纯 HTTP 换图。** 19 次尝试、7 种方案、4 个账号，全失败。
2. **RPA 页面模式是唯一可靠路径。** 慢，但页面自己处理一切。
3. **千手（觅千手）也不做纯 HTTP 上传。** 逆向其扩展（service_worker_new.js / content_script_loader_v3.js）确认：只拦截 action/edit 改 SKU/标题/价格，图片由页面控件处理。数据转换在云端，本地逆向不到。
4. **淘宝类逆向参考** `童装/发布技能/` 目录：三个软件（天牛/上架助手/神笔）的发布能力都在服务端，本地只是执行终端。
