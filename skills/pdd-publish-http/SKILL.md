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

<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->

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

## 组件化结构（2026-10-29 定稿）

### 铁律：组件化 = 结构化拆分，**不是重写逻辑**

> 血泪教训：曾把 `lib/pdd-publish.js` 里**已经上架成功过**的
> `fillAttributes` / `fillSkuSpecMulti` / `fillPriceTable` 全部重写成新实现，
> 结果材质成分连续坏 3 次（滚动 → 弹窗定位 → 搜索框），上架直接失败。
>
> **正确做法**：给 lib 里已验证的函数加 `export`，组件文件只做 `re-export`。
> 一行业务逻辑都不新写。

### 组件清单（`scripts/`）

| 组件 | 导出的函数（全部来自 lib，已验证） | 是否随类目变化 |
|---|---|---|
| `field-basic.mjs` | `fillTitle`、`fillField`（+ `readCategory`） | ❌ 通用 |
| `field-images.mjs` | `uploadImages`、`uploadDetailImages`、`readUploadCount`、`findFileInput` | ❌ 通用 |
| `field-attributes.mjs` | `fillAttributes`（含材质成分 IngredientList） | ⚠️ **是** |
| `field-shipping.mjs` | `fillShippingAndFreight`、`disableSizeChart` | ❌ 通用 |
| `spec-dims.mjs` | `fillSkuSpecMulti`、`fillSkuSpec` | ⚠️ **是** |
| `sku-table.mjs` | `fillPriceTable` | ❌ 通用 |
| `publish-flow.mjs` | `publishFlow(page, product, opts)` 总编排 | ❌ 通用 |

**只有两个模块随类目变化**：属性（`field-attributes`）和规格（`spec-dims`）。
其余全部类目无关——这就是「一套代码打所有类目」的依据。

### 段4 调用顺序（**不能改**）

```
规格（fillSkuSpecMulti） → 价格库存（fillPriceTable） → 属性（fillAttributes） → 发货（fillShippingAndFreight）
```

属性必须在价格表**之后**：属性下拉重渲染会冲掉前面填的内容。

### 数据形状坑

- `fillSkuSpecMulti(page, specs, skuRows, category)` 的 `specs[].values`
  必须是**对象数组** `{ value, image }`，传字符串会被 `String(v?.value||'')`
  全部过滤 → 0 项、价格表只剩 1 行。
- `fillPriceTable(page, { price, stock, itemNo, rows })` 返回 `{ filled: [], missed: [] }`。

### 两条路径的关系

| 路径 | 入口 | 用途 | 状态 |
|---|---|---|---|
| **lib 内建** | `publish.mjs --product-file` | 生产默认 | ✅ 已验证（140s） |
| **组件链** | `publish-flow.mjs` | 独立编排 / 二次开发 | ✅ 已验证（120s，`goods_id=1022603205669`） |

`publish.mjs` 目前走 lib 内建路径；组件链供需要单独控制某一段的场景使用。

未验证的自研实现保留为 `sku-component-experimental.mjs`、`sku-thumb-experimental.mjs`、
`sku-rows.mjs`，**不要接入生产**，待逐项对比验证。

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
