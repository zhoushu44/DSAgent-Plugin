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
| 毛巾 | 2 维（尺寸×颜色）**全新类目** | 第1次 229s / 第2次 137s | 25→34 | 6/6 ✅ | **省 40%** |

**毛巾两次运行证明模板复用有效：**
```
第 1 次：[template] 无「毛巾」模板，本次从头探测
        [template] ✅ 沉淀模板：catId=205041314615 维度 2 属性 11
第 2 次：[template] 命中模板（2 维 / 11 属性）
        [template] 从模板补全 10 条属性
        用 catId=205041314615 直达表单页 → 直达页已就绪
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

## 二、段4 正确顺序（不可改）

```
① 规格（逐行 + 补勾）→ ② 价格库存 → ③ SKU 预览图 → ④ 属性（多轮级联）
→ ⑤ 【补】价格库存（新增行）→ ⑥ 【补】SKU 预览图（新增行）→ 段5 提交
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

## 七、参考价与默认值

| 项 | 规则 |
|---|---|
| **参考价** | **默认 = `max(SKU 拼单价) + 1`**（平台要求 > 最大单买价）<br>例：毛巾 SKU 价 19.9/29.9 → 参考价 **30.9**<br>`product.price` 显式给了就用显式的 |
| 默认库存 | **100**（每 SKU） |
| 默认发货时间 | **48 小时** |
| 主图数量 | **按输入全量**（1-10 张，不写死 5） |
| 提交判定 | `错误（0）` 不算错，只有 `错误（N>0）` 才停 |

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

## 十、性能

| 场景 | 耗时 | 说明 |
|---|---|---|
| 新类目（第 1 次） | 215-239s | 从头探测 + 沉淀模板 |
| 老类目（第 2 次起） | **137s** | 命中模板 + catId 直达，**省 40%** |

优化点：
- 固定等待 → 轮询（按钮出现 / URL 变化 / 表单就绪）
- 视觉分析结果缓存（`vision-cache.mjs`，同类目第 2 单起省 8s）
- 老类目 catId 直达（省 5s）
- 规格填值 JS setter 优先 → 键盘兜底

---

## 十一、组件清单

| 文件 | 职责 |
|---|---|
| `publish-v2.mjs` | 主入口（参数解析 + 浏览器 + 5 段编排 + 模板沉淀） |
| `publish-flow.mjs` | 段3+段4 组件编排 |
| `stage-nav.mjs` | 段1 打开列表 + 段2 选类目 |
| `stage-submit.mjs` | 段5 提交 + 校验 |
| `spec-row-fill.mjs` | 规格逐行填写 + 单位剥离 + 补勾 |
| `spec-dims.mjs` | 规格维度（scanDims / alignDims） |
| `sku-table.mjs` | 库存/拼单价/单买价（列映射 + skip-existing） |
| `sku-thumb.mjs` | 每行预览图 |
| `attr-fill-generic.mjs` | 属性采集 + 填写 + AI 选值 + 必填复核 |
| `attr-harvest.mjs` | 属性候选采集入库（attr-schema.json） |
| `category-template.mjs` | 类目模板读写 |
| `field-basic.mjs` | 标题 / 参考价 |
| `field-images.mjs` | 主图 / 详情图 |
| `field-shipping.mjs` | 发货售后（通用模糊匹配） |
| `vision-fill.mjs` | 视觉分析规格区 |
| `vision-cache.mjs` | 视觉分析结果缓存 |
| `analyze_spec_ui.py` | 视觉模型调用（截图 → JSON） |
| `imgprep.py` | 图片规整 |

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
