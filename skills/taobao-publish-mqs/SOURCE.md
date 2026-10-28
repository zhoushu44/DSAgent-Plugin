# SOURCE.md — 淘宝/天猫发布「Json/Json2 setter 劫持重放」（replayMode）溯源

> 本文档记录 `src/taobao-publish.ts` 的 `replayMode` 分支与 `src/taobao-publish-replay.ts`
> 的设计来源、提取过程、产物结构与同步更新流程。**凡改动 replayMode 相关代码，必须回填本文档。**

---

## 一、来源标识

| 项 | 值 |
|---|---|
| 工具名 | 觅千手（MQS / 千觅） |
| 版本 | **v5.61** |
| 来源文件 | `E:\360MoveData\Users\Administrator\Desktop\觅千手\source\pageHooks.js` |
| 文件大小 | 57,617 字节（单行压缩混淆 JS） |
| 提取方式 | 静态逆向：按 `function <name>` 定位 + 大括号配平截取函数体（见下「提取/采集方法」） |
| 性质 | 第三方工具浏览器注入脚本（page hook），非本仓原创 |

> 注：觅千手为第三方浏览器插件，无官方源码仓库；本溯源基于其分发包的 `pageHooks.js` 静态逆向。

## 二、★ 官方更新页 / 参考入口

| 类型 | 说明 |
|---|---|
| 官方更新页 | 觅千手为第三方分发插件，**无公开官方更新页**。出问题时以「平台真实发布页当前 DOM/框架行为」为准重新对照（见「同步更新流程」） |
| 本仓参考先例 | `skills/pdd-publish-2/SOURCE.md`（拼多多拦改重放，同思路不同平台） |

## 三、提取 / 采集方法

`pageHooks.js` 是单行压缩文件，无法直接 Grep 阅读。提取脚本（已用完即弃，逻辑如下）：

```js
// 按 "function <name>" 定位起点，大括号配平找函数体终点
function extract(fname) {
  const idx = s.indexOf('function ' + fname);
  let depth = 0, end = idx, started = false;
  for (let i = idx; i < s.length; i++) {
    if (s[i] === '{') { depth++; started = true; }
    if (s[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return s.slice(idx, end);
}
```

常量（`PROTECTED_OFFICIAL_ONLY_KEYS=` / `MOVE_COMPONENT_SYNC_KEYS=` 等）按标识符 `indexOf` + 定长截取。

## 四、产物结构 / 锚点表（觅千手侧）

### 4.1 核心机制

淘宝发布页是 **React 受控表单**，框架会把整个表单 state 赋值给 `window.Json` / `window.Json2`。
觅千手用 `Object.defineProperty(window,"Json",{get,set})` 劫持 setter，**在框架赋值瞬间**把
localStorage 里存好的商品数据（formValues）**原地 merge 进框架自己的 state 对象**——框架随后
渲染的就是已填好的表单，不做任何 DOM 逐格输入，也不会触发受控组件的「程序值 vs 用户值」不同步问题。

### 4.2 门禁链 `evaluateMoveJsonFullReplay()`（全部满足才 merge）

| 门禁 | 判定 | 说明 |
|---|---|---|
| `isTaobaoSellPage` | `href.indexOf("item.upload.taobao.com/sell")` | 只在发布页生效 |
| `isSkuHookDone` | `localStorage["kdds_taobao_sku_hook_done"]==="true"` | **单次门禁**：merge 过后置 true，防重复 |
| `isMoveTabSessionActive` | `sessionStorage["kdds_taobao_move_tab_active"]==="1"` | 搬家标签会话活跃 |
| `isCustomSalePropStickyActive` | 自定义销售属性粘性快照 | 防与粘性重放冲突 |
| `isMoveSessionActive` | fission_end / close_load / detailData / hook_slice 任一存在 | 搬家会话活跃 |
| `loadStoredJsonDocument` | 读 `["Json","kdds_taobao_Json_backup"]`，结构 `{models:{formValues},components}` | 存储的表单文档 |
| `hasSubstantiveStoredContent` | title/images/sku/desc 等任一非空 | 防空 payload 污染 |
| `isStoredJsonMatchingCurrentMove` | stored 与 detailData 均存在 | 当前搬家匹配 |

### 4.3 merge 字段集 / 保护字段（觅千手常量）

```js
MOVE_COMPONENT_SYNC_KEYS = ["title","shopping_title","mainImagesGroup","images",
  "threeToFourImages","sku","saleProp","customSaleProp","descRepublicOfSell","price",
  "quantity","outerId","tbExtractWay","shippingArea","shopcat","catProp","wirelessDesc",
  "deliverWeight","multiDiscountPromotion","sizeMapping"]
LISTING_DELIVERY_FV_KEYS = ["startTime","tmDeliveryTime","tbDeliveryTime","deliveryTimeType"]
PROTECTED_OFFICIAL_ONLY_KEYS = ["auctionPoint","stuffStatus","sevenDaySupport",
  "ysbCheckTask","qualityIdentify"]   // 官方已有值就保留不覆盖
```

### 4.4 localStorage 体系（觅千手 kdds_* key）

`kdds_taobao_detailData`（采集数据）、`kdds_taobao_hook_slice`、`Json` / `kdds_taobao_Json_backup`（存储的表单文档）、`kdds_taobao_sku_hook_done`（单次门禁）、`kdds_taobao_fission_end`、`kdds_taobao_close_load`、`kdds_taobao_move_tab_active`（sessionStorage）。

## 五、已证伪 / 边界（避免重复踩坑）

| 结论 | 原因 |
|---|---|
| **catchup 只在 draft.htm 草稿页做，发布页不补课** | 「安装时 localStorage.Json 可能仍是上一单，补进去会污染新表单」。本仓 replayMode 遵守同一边界：**payload 由宿主每次发布前注入，不给旧页面补课** |
| merge 必须原地改框架传入的 `val`，不能整体替换 | 框架持有该对象引用，整体替换会让框架继续用旧引用渲染 |
| `catProp` 用「stored 打底 + target 覆盖」合并而非直接覆盖 | 框架可能已写入类目默认属性 |

## 五之二、★ 图片链路实测（2026-10，逆向 + 真机反复验证）
这一节是本仓对觅千手「预上传 + 重放」链路的实测校准，踩过的坑全部记在这里。

### 5.2.1 逆向 HTTP 上传（已落地 `src/taobao-image-space.ts`）

上传只需 1 个 POST，**不需要 mtop 签名、不需要浏览器**：

```
POST https://stream-upload.taobao.com/api/upload.api
     ?_input_charset=utf-8&appkey=tu&folderId=0&picCompress=false&watermark=false
multipart: name=<文件名>   file=<二进制>
```

- 200 → `{"object":{"fileId","url","fileName","size","pix","quality"},"success":true}`
- `NOT_ALLOW_UPLOAD_1x1_IMAGE` = 1×1 占位图被拒；jpg/png/webp/bmp/heic 通吃；>5MB 单包可直传。
- Cookie 只要 `.taobao.com` 域下登录态（cookie2 / _tb_token_ / unb / tfstk …）。
- 实测：17 张图（5 主图 + 12 详情图）**3.5 秒**传完，对比原 DOM 上传要几分钟。

### 5.2.2 `mainImagesGroup` 的写入形态（关键，错一次就静默失败）

| 尝试 | 结果 |
|---|---|
| `formValues.mainImagesGroup = { images: ['https://…'] }`（字符串数组） | state 有值，**DOM 一片空白**，页面仍显示「上传图片」×5 |
| `components.mainImagesGroup.props.value` 写成裸数组 | 同上，无效 |
| **`{ images: [{ url, pix }] }`（对象数组）** | ✅ 主图正常渲染 |

- 元素必须是**对象** `{ url, pix }`，与觅千手 `resolveSearchPicture()` 返回的 `skuPicture` 同构
  （`{url: fullUrl, pix: pixel||pix}`）。纯 URL 字符串会被 `simplyImages` 当成无效项丢弃。
- `pix` 从 CDN 文件名 `-WxH` 尾缀推断，取不到给 `800x800`（只影响比例校验提示，不影响渲染）。

### 5.2.3 `syncComponentProp` 的取值映射（第二个坑）

觅千手：
```js
function getComponentPropValueFromFv(ck, targetFv){
  if (targetFv) return ck === "mainImagesGroup" && targetFv.mainImagesGroup
    ? cloneJsonValue(targetFv.mainImagesGroup)   // ← 整个对象，不是 .images
    : (void 0 !== targetFv[ck] ? cloneJsonValue(targetFv[ck]) : void 0)
}
```
本仓最初写成 `fv.mainImagesGroup.images`（取数组），导致 `props.value` 拿到裸数组 → 渲染为空。

### 5.2.4 合并时机：simplyImages 只在挂载时读值（第三个坑，最隐蔽）

内嵌实验（在真实发布页、表单已渲染后）把 `props.value` 换成**完全正确**的对象结构：

```
replace 前  img=0   「上传图片」×5
replace 后  img=0   「上传图片」×5
2s 后       img=0
```

→ 该组件**非受控、只读一次**，挂载后再改 `props.value` 不会重渲染。

因此本仓相对觅千手做了两点调整（**有意偏离，已验证有效**）：

1. **不做严格就绪门禁**：觅千手的 `isJsonReadyForCustomValuePlayback` 要求
   `val.components.sku.props` 已存在；本仓改为「只要 val 是对象就合并」，
   因为等组件齐全时往往已错过主图区的挂载窗口。
2. **catchup 反复合并**：`setInterval` 每 250ms 对已挂载的 `window.Json/Json2`
   重跑 merge（共 ~40s），merge 幂等、写的是同样的值，多合几次以命中最晚那次渲染窗口；
   不因 `kdds_taobao_sku_hook_done` 提前退出。

### 5.2.5 验收指标（工具已内建）

`verifyImagesRendered()` 直接数 DOM：
`#struct-mainImagesGroup` / `.sell-component-simply-images` 下的 `img` 数量，
与 `formValues` 记录数对照。**只信 DOM，不信 mergedFields** ——
出现过多轮「mergedFields 含 mainImagesGroup 但 DOM img=0」的假成功。

实测结果：主图 5/5 稳定渲染成功；详情图（富文本 `descRepublicOfSell` / `wirelessDesc`）
在部分轮次渲染成功、部分为 0，编辑器异步挂载时序尚不稳定，已在发布结果里显式提示需人工兜底。

### 5.2.6 与端到端发布的关系

图片链路已独立跑通。整条发布仍可能因**类目属性未填全**（如儿童裤子有 20+ 项必填/
条件必填，含「材质成分」复合表）在提交时被拦 —— 这是属性域的问题，与图片链路无关，
按既定决策（不写类目特化）交人工补全。

---

## 五之三、★ 类目属性链路实测（2026-10-28，两个类目真机发布验证）

本节是属性域的实测结论。**「按既定决策交人工补全」这句在 5.2.6 里已被部分推翻** ——
属性是可以自动填的，但有三条此前不知道的硬结论。

### 5.3.1 觅千手不填属性（源码级结论）

对本地分发包（`E:\...\Desktop\觅千手`，57KB `source/pageHooks.js` + 492KB `script/tb_subway/index.js`
+ 114KB `script/service_worker_new.js` + 153KB `source/iframeHandler.js`）做了全量扫描：

| 找的东西 | 结果 |
|---|---|
| `catProp` 填充逻辑 | pageHooks.js 有 12 处，但**全部是「搬家时搬走已有 catProp」**，不是从零填 |
| `kdds_taobao_catprop_filled` 写入方 | 全包**只读不写**，无写入方 |
| 淘宝发品属性填充 | **不存在**。pageHooks.js 的 61 个函数全是搬家/图片/SKU |
| CDN 引擎 `_gm.js`（5.83MB，含发品） | 已被清理，`rea-gm-modules/` 拆分产物也不在 |

**觅千手是搬品工具，不是发品工具。** 它的 catProp 策略（`applyFullJsonReplayToTarget` 内）：

```js
var srcCatProp = lsCatPropKeyCount > 0 ? lsCatProp          // localStorage kdds_taobao_catprop_filled
              : jsonFvCatPropKeyCount > 0 ? jsonFvCatProp    // 兜底 window.Json.models.formValues.catProp
              : null;
if (srcCatProp && srcCatPropKeyCount > 0) {
  var reactSessionCatProp = targetFv.catProp || {};
  var syncedCatProp = Object.assign({}, cloneJsonValue(srcCatProp), cloneJsonValue(reactSessionCatProp));
  targetFv.catProp = syncedCatProp;                                    // ① 写 formValues
  syncComponentProp(val, "catProp", cloneJsonValue(syncedCatProp));    // ② 同步组件 props
}
```

即「**搬来的值打底 + 页面已有值覆盖，双写（formValues + components.props.value）**」。
`syncComponentProp` 本体极简：`val.components[key].props.value = propValue`。
它假设属性已填好，只负责搬 —— 所以本地包里没有「从零填属性」的实现可抄。

**本仓的属性填充是对 `lib/pdd-publish.js` 的 `fillAttributes()` 的横向移植**（那是本仓
自己真机验证过的同类逻辑），不是抄觅千手。

### 5.3.2 进入路径决定属性区能否渲染（最坑的一条）

| 进入方式 | 属性区 DOM | 结果 |
|---|---|---|
| 选类目页 → 确认下一步 | `struct-p-*` 28 个 / `label` **0 个**（空壳） | 必填属性读不到也填不上，提交被「重要属性 0/N」硬拦，**连请求都发不出去** |
| `?catId=XXXX` 直达 | `label.required` 正常出现，属性可填 | 正常 |

所以 `taobaoPublish` 有 `directPublishUrl` 参数：已知 catId 时直接开
`https://item.upload.taobao.com/sell/v2/publish.htm?catId=XXXX`。
批量发布同类目：先跑一次拿到 catId，之后全部直达。

属性项定位用「**从 label 反查容器**」：全页扫 `label.required` + `#struct-catProp label` +
兜底所有 label，每个往上找最近的 `.sell-catProp-item-common / .sell-catProp-item / [id^="struct-p-"]`
容器（要求容器里确有 `.next-select / .next-select-trigger / input`），因为两套 DOM 并存，
`getElementById('struct-catProp')` 只拿得到空壳。

### 5.3.3 品牌是 combobox，click 选项无效

实测「品牌」属性容器 id 就是 `struct-p-20000`（= 发布 URL 里
`keyProps={"p-20000":{"value":3236884,"text":"007"}}` 那个键），控件是
`.next-select-auto-complete`。**直接 click 下拉选项后 `.next-select-values` 仍空、
「重要属性 0/2」不变** —— 必须「键入 → 等候选刷新 → 点中匹配项」，且键入要走
**原型链原生 value setter**（`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp),'value').set`），
直接 `inp.value = x` 会被 React 丢弃。

品牌是**部分类目的唯一必填属性**（手机支架/手机配件类目必填只有「品牌 + 适用场景」），
所以默认 `ATTR_SKIP_RE` 跳过品牌的策略会让这类目永远发不出去。现规则：
用户显式传 `brand` 时才填（用户对自己品牌的声明），且只在页面真实候选里命中。

### 5.3.4 成功判定必须认 URL，不能认文案

淘宝发布成功的落地页是：

```
https://item.upload.taobao.com/sell/v2/success.htm?primaryId=<商品ID>&catId=...&isEdit=false&pageStyle=
```

该页**既没有 `#success-container`，正文也没有「发布成功/上架成功/提交成功」等字样**，
且残留的校验提示还会被三路错误回读当成硬拦因。三者叠加导致连续两次
「**商品其实已发布（primaryId 都拿到了），却 180s 空转后报『未检测到成功标志』**」的假阴性。
现规则：循环开头先判 `if (/\/sell\/v\d*\/?success\.htm/i.test(finalUrl))`，命中即成功，
`primaryId` 直接当商品ID。URL 路由事实比任何文案都可靠。

### 5.3.5 真机验证记录（2026-10-28，账号 tb957985228335）

| 类目 | catId | 属性命中 | 商品ID |
|---|---|---|---|
| 手机支架/手机座 | 150708 | 2/2（品牌007 + 适用场景桌面） | 1096741116047 |
| 手机壳/保护套定制 | 50025033 | 3/6（材质硅胶 + 品牌/适用品牌闪魔） | 1096739872970 |

第二个类目未填的 3 项**全是选填项且与标题无关**（定制服务/保护套工艺/流行元素），
按新策略正确留空（宁可不填也不写错）。

## 六、同步更新流程

1. 发布页结构变更（replayMode 失效）→ 打开淘宝真实发布页，DevTools 确认框架是否仍把表单 state 赋给 `window.Json`/`Json2`（`Object.keys(window)` 找 `Json`，或断点 `Object.defineProperty`）。
2. 若框架改走别的全局变量 → 更新 `buildTaobaoJsonReplayInitScript` 的劫持目标。
3. 若字段语义变化 → 对照 `MOVE_COMPONENT_SYNC_KEYS` 增删 merge 字段。
4. 改完跑 `npm run build:host`（类型检查）+ 真实发布实测（confirm 两步走）。

## 七、skill ↔ 来源映射（逐条可回溯）

| 本仓位置 | 觅千手来源 | 说明 |
|---|---|---|
| src/taobao-image-space.ts | （本仓逆向新增，觅千手为页内预上传） | 图片空间纯 HTTP 上传：stream-upload upload.api，无 mtop 签名 |
| buildTaobaoJsonDocument picItem() | resolveSearchPicture 的 {url,pix} | 主图元素必须为对象，纯字符串渲染为空 |
| getComponentPropValueFromFv 等价逻辑 | 同名函数 | mainImagesGroup 传整个对象而非 .images |
| isReady（宽松） + catchup 轮询 | isJsonReadyForCustomValuePlayback（严格） | 有意偏离：simplyImages 只在挂载读值，需更早/更频繁合并 |
| verifyImagesRendered() | 无（本仓新增验收） | 只信 DOM img 数，不信 mergedFields |
| `src/taobao-publish-replay.ts` `MOVE_COMPONENT_SYNC_KEYS` | pageHooks.js 同名常量 | merge 字段集 |
| 同上 `PROTECTED_OFFICIAL_ONLY_KEYS` | pageHooks.js 同名常量 | 保护字段 |
| 同上 `LISTING_DELIVERY_FV_KEYS` | pageHooks.js 同名常量 | 发货时间字段 |
| 同上 init script `applyReplay` | `applyFullJsonReplayToTarget`（6444 chars） | merge 核心（精简：去食品字段/sizeMapping 恢复/埋点） |
| 同上 init script `defineProperty(window,"Json"/"Json2")` | pageHooks.js defineProperty 安装段 | setter 劫持 |
| 同上 `hook_done` 单次门禁 | `isSkuHookDone` + `evaluateMoveJsonFullReplay` | 单次 merge 门禁 |
| 同上 `substantive()` | `hasSubstantiveStoredContent` | 空内容判定 |
| 同上 `hasSub()` | `hasSubstantiveFormValue` | 字段实质值判定 |
| `src/taobao-publish.ts` `replayMode` 注入点（evaluateOnNewDocument） | 觅千手「页面脚本执行前注入 page hook」 | 注入时机 |
| `src/taobao-publish.ts` 降级 DOM 填写 | —（本仓新增兜底，觅千手无） | 框架不走 Json 赋值时回退 |
| `buildTaobaoJsonDocument()` | `loadStoredJsonDocument` 的 `{models:{formValues},components}` 结构 | payload 文档结构 |
| `src/taobao-publish.ts` `directPublishUrl` | —（本仓新增，觅千手无对应路径） | 绕过「选类目页 → 空壳属性区」，见 §5.3.2 |
| `src/taobao-publish.ts` `fillCategoryAttrs` 的 label 反查 | —（本仓新增） | 两套 DOM 并存，`getElementById('struct-catProp')` 只拿空壳 |
| `src/taobao-publish.ts` `fillComboboxProp` | —（本仓新增，思路同 `lib/pdd-publish.js` 的 React setter 键入） | combobox 型属性（品牌）必须键入 + 原生 setter，见 §5.3.3 |
| `src/taobao-publish.ts` 标题词匹配兜底 | —（横向移植 `lib/pdd-publish.js` 2026-10-20 真机教训） | 废止「盲选第一项」，见 §5.3.3 / SKILL.md「类目属性」节 |
| `src/taobao-publish.ts` 成功判定 `success.htm` 分支 | —（本仓新增） | URL 判定优先于文案，见 §5.3.4 |
