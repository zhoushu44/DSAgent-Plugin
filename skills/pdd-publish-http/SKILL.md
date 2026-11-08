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

# 拼多多商品上架 · 完整技术文档

> **一句话：要换图就用 RPA 页面（`publish-flow.mjs`），不要碰纯 HTTP 上传。**
>
> 纯 HTTP 换图试了 19 次、7 种方案、4 个账号，全部失败。

---

## 目录

1. [结论先行](#一结论先行)
2. [真实成功记录](#二真实成功记录)
3. [两条发布路径](#三两条发布路径)
4. [product.json 格式](#四productjson-格式)
5. [类目参数实测值](#五类目参数实测值)
6. [已知失败清单](#六已知失败清单)
7. [风控与限流](#七风控与限流)
8. [逆向结论](#八逆向结论)
9. [脚本资产清单](#九脚本资产清单)
10. [排障速查](#十排障速查)
11. [教训总结](#十一教训总结)

---

## 一、结论先行

| 问题 | 答案 |
|---|---|
| 能用吗？ | **RPA 页面模式能用**（4 单成功）|
| 纯 HTTP 能发吗？ | 能，但**不能换图**（8 单成功）|
| 纯 HTTP 能换主图吗？ | **不能**，19 次全失败 |
| 为什么？ | `file/create` 恒返回 `40002`，平台拒绝程序化调用，根因未查明 |

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

**位置**：`skills\pdd-publish-http\scripts\`

### 主流程

| 脚本 | 作用 |
|---|---|
| `publish-flow.mjs` | **页面全流程**（推荐，能换图）|
| `publish-by-copy.mjs` | 复制改包（快，不能换图）|
| `publish-v2.mjs` | 页面流程 v2（含 AI 视觉填表）|
| `publish.mjs` | 页面流程 v1 |
| `batch-publish.mjs` | 批量遍历目录发布 |

### 类目与属性

| 脚本 | 作用 |
|---|---|
| `harvest-native-props.mjs` | 拦截页面 `action/edit` 拿权威属性结构 |
| `category-template.mjs` | 类目模板库 |
| `attr-harvest.mjs` | 采集类目属性清单 |
| `attr-fill-generic.mjs` | 通用属性填写 |
| `attr-composite.mjs` | 复合字段（「添加XX」多行）|

### 表单填写（DOM 流程内部）

`stage-nav.mjs` / `stage-submit.mjs` / `field-basic.mjs` / `field-images.mjs` / `field-service.mjs` / `field-shipping.mjs` / `spec-dims.mjs` / `spec-row-fill.mjs` / `sku-table.mjs` / `sku-thumb.mjs`

### 图片

`img-prep.mjs` / `compress-images.mjs` / `imgprep.py`

### 视觉辅助

`vision-fill.mjs` / `vision-cache.mjs` / `analyze_spec_ui.py`

### 共享依赖

| 路径 | 作用 |
|---|---|
| `skills/_shared/pdd-antiban.mjs` | 节流（账号级 4-6s / 接口级 1.8s）|
| `skills/_shared/pdd-risk.mjs` | 风控（20 次/分 + 冷却 + 滑块 + 账号锁）|
| `skills/_shared/pdd-shadow-hook.mjs` | 破解滑块 closed shadow root |
| `skills/_shared/pdd-slider-solver.mjs` | 滑块识别与拖拽 |
| `skills/_shared/pdd-http.mjs` | 凭证库 HTTP 通道 |
| `lib/pdd-image-preupload.js` | 页面内图片上传 |

---

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

## 附：文件位置

| 内容 | 路径 |
|---|---|
| 本文档 | `DSAgent-Plugin\skills\pdd-publish-http\SKILL.md` |
| 脚本 | `DSAgent-Plugin\skills\pdd-publish-http\scripts\` |
| 类目模板 | `DSAgent-Plugin\artifacts\pdd-native-props\` |
| 运行日志 | `DSAgent-Plugin\artifacts\pdd-publish-by-copy\run-*.log` |
| 千手扩展 | `Desktop\觅千手\` |
| 淘宝逆向资料 | `Desktop\童装\发布技能\` |
| 拼多多 JS 分析 | `Desktop\童装\pdd_js_analysis\` |
