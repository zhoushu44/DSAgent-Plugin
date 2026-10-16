# 商品发布规范化需求文档（JSON 驱动发布引擎）

> 日期：2026-10-15 · 状态：定稿待实施
> 范围：淘宝 / 拼多多 / 闲鱼 三平台发布改造（后续平台按同一架构接入）
> 来源：多轮对话设计收敛 + 200+ 多类目电商软件通用设计吸收 + 本仓三平台代码现状侦查

---

## 0. 一句话目标

**平台差异（锚点 / 字段策略 / 流程顺序）全部抽成 JSON 数据文件，通用引擎读 JSON 执行；平台改版只改 JSON，不改代码。**

---

## 1. 吸收：多类目电商软件的通用设计

调研对象：本地目录 `downloads/ecommerce_catalog.md`（200+ 个无货源店群软件：甩手工具箱、大淘营、福德上货、黑鲸鱼、云上货、易上货、一刻工具箱等）+ 公开资料（易仓 ERP、阿里 AI 发品、Voolist）。

这些软件覆盖「淘宝/天猫/拼多多/抖店/1688/京东/微信小店/小红书/快手」全平台 ×「采集/解析/上传/洗图/查词/客服/群控」全类目，支撑 200+ 个软件共存的市场说明其架构高度同构。提炼出六个可吸收点：

| # | 吸收点 | 来源软件 | 落到本方案 |
|---|---|---|---|
| A1 | **数据层/调度层/执行层分离** | 易仓、批量发布工程实践 | 数据（ProductData canonical）、调度（tools-publish 工具层）、执行（publish 引擎）三层已有，本方案把「平台适配」也抽成数据（JSON） |
| A2 | **通用模板 + 店铺级套用** | 易仓「针对平台/店铺设置固定政策/描述/刊登模板，生成草稿时自动套用」 | platformExtras（店铺级）+ profile（商品级）两级模板，缓存/答案档案复用 1000 个同属性商品 |
| A3 | **SKU 图片前缀自动匹配** | 易仓「图片代码前缀自动匹配产品 SKU」 | SKU 预览图按 `imageBase + specValue` 规则自动配图（模板配置） |
| A4 | **类目转换/指定类目发布** | 甩手「转换商品类目→检查匹配→批量编辑」、大淘营「指定发布类目」 | 类目搜索候选词 + 失败后指定类目重选（cateKeywordCandidates 逐词尝试，pdd 已实现） |
| A5 | **类目预测 + 属性批量编辑 + 违禁词检测** | 阿里 AI 发品、叮咚淘数据包 | AI 属性选值（宿主模型）+ 标题违禁词预检（图片预检同级门禁） |
| A6 | **任务队列 + 失败重试 + 逐条报告** | 所有批量上货软件的标配 | 批量发布的执行模型（单件能力已备，批量层后续扩展） |

**共同教训**：这 200+ 软件全死于「XPath 硬编码在程序里，平台一改版就集体失灵」（大淘营论坛满是「规格类型不一致」「类目为空」的求助帖）。本方案的 JSON 锚点 + 巡检闭环就是对此的解。

---

## 2. 现状（改造的起点）

| 维度 | 现状 | 问题 |
|---|---|---|
| 拼多多 [pdd-publish.ts](file:///e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/pdd-publish.ts) | 3702 行，链路四段式（列表入口→类目页→表单页→填写+提交+轮询），attr-cache 已接，XPath+文本双锚点模式成熟 | 锚点散落 131 处内联 querySelector/查询，头部常量区 30+ 个魔法字符串 |
| 淘宝 [taobao-publish.ts](file:///e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/taobao-publish.ts) | 2122 行，sucai iframe 主图上传、byLabel 容器相对定位、真实键盘填 SKU；类目属性走 g5 类目档案（profile 回放优先于模型），attr-cache 已退场（仅 schemaFingerprint 共用） | 120 处内联锚点 |
| 闲鱼 [xianyu-publish.ts](file:///e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/xianyu-publish.ts) | 599 行，antd Select 分类解锁、contenteditable 描述 | 10 处内联锚点 |
| 缓存 [attr-cache.ts](file:///e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/services/attr-cache.ts) | 122 行，`platform:categoryKeyword` 键，命中即验证，tmp+rename 原子写；仅 pdd-publish 使用 | 只缓存属性值，未覆盖 SKU 维度/运费模板/发货时间 |
| 类目档案 [category-profile.ts](file:///e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/src/services/category-profile.ts) | `platform+catId` 精确键，存 attributes/freightTemplate/schemaNames/schemaFp；发布成功自动落档、二次同类目回放（淘宝已接） | 档案边界到类目属性为止，SKU 不入档 |
| 合计 | **261 处内联锚点** | 平台改版 = 逐处翻 4000+ 行代码 |

---

## 3. 核心设计

### 3.1 JSON 驱动原则（最重要的一条）

**JSON 里永远不写「平台有什么属性」，只写「怎么填」。**

- 「有什么」（类目属性 schema、SKU 维度、下拉选项）**每次发布从页面现拉**——平台加一栏属性、改一个下拉项，引擎自动看见，AI 自动补填，**零维护**。
- 「怎么填」（锚点、字段策略、流程顺序）写进 JSON——平台改版时改一行 JSON 即修复。
- 通用引擎不含任何平台 if/else——新增平台 = 新增一个 JSON 文件。

### 3.2 平台 JSON 三段结构

```jsonc
{
  "platform": "pdd",
  "version": 1,                      // 锚点集版本号，巡检报告对齐用
  "limits": { "maxImageBytes": 3145728, "maxImages": 10, "maxTitleLen": 60 },
  "flow": [                          // 能力块顺序（每平台不同）
    { "step": "openEntry",   "url": "https://mms.pinduoduo.com/goods/goods_list" },
    { "step": "selectCategory", "args": { "confirmText": "确认发布该类商品" } },
    { "step": "waitFor",     "match": "/goods/goods_add/" },
    { "step": "fillTitle" },
    { "step": "uploadImages" },
    { "step": "fillSku" },
    { "step": "fillAttributes" },
    { "step": "fillShipping" },
    { "step": "submit",      "args": { "buttonTextRe": "^(提交并上架|提交|确认提交|发布)$" } }
  ],
  "anchors": {                       // 多备选逐个尝试（XPath 四级规范）
    "titleInput": {
      "candidates": [
        { "level": 1, "selector": "input[data-tracking-click-viewid=\"title_input_area\"]" },
        { "level": 2, "selector": "#goods_name input[data-testid=\"beast-core-input-htmlInput\"]" },
        { "level": 3, "selector": "input[placeholder*=\"标题\"]" }
      ]
    },
    "mainImageInput": { "candidates": [ { "level": 1, "selector": "input[data-tracking-click-viewid=\"carousel_img_localfile_upload\"]" } ] }
  },
  "fieldStrategies": {               // 字段怎么填（type/select/selectOrType…）
    "title":    { "type": "type", "anchor": "titleInput", "maxLength": 60, "source": "data.title" },
    "price":    { "type": "type", "anchor": "priceInput", "source": "data.price" },
    "stock":    { "type": "type", "anchor": "stockInput", "source": "data.stock", "default": "1000" },
    "category": { "type": "categorySearch", "confirmText": "确认发布该类商品" }
  }
}
```

### 3.3 XPath 四级锚点规范

| 级 | 定义 | 示例 | 规则 |
|---|---|---|---|
| L1 | 稳定 ID/测试标识 | `input[data-tracking-click-viewid="title_input_area"]` | 平台埋点体系，最稳 |
| L2 | 语义层 | `input[placeholder*="标题"]`、文本匹配 | 常用退化路径 |
| L3 | 容器相对层 | `byLabel("价格").find("input")`（淘宝 fillField 已实现） | label→同行控件 |
| L4 | 绝对路径 | `/html/body/div[3]/div/div[2]/input` | **禁止手写**，仅供巡检报告诊断 |

每个锚点注册 `candidates[]`（按 L1→L2→L3 顺序），引擎逐个尝试；全部失联时输出诊断证据（URL+截图+DOM 片段）。

### 3.4 能力块六步协议（每个能力块内部）

1. **拉 schema**：进入表单后现拉当前页面真实控件清单（属性名/类型/选项/必填）
2. **缓存查询**：类目档案 / attr-cache 命中且 `options.includes(cached)` 验证通过 → 直接用（淘宝走 g5 类目档案，pdd 走 attr-cache）
3. **AI 填充**：未命中 → 宿主模型从真实选项里选（无外部 API 依赖）
4. **校验**：填后读 DOM 回验（verifyAttrValue 模式）
5. **执行**：React 受控组件须 native setter + input/change/blur 事件或真实键盘（type+Tab）；文件上传走 input[type=file] 投递，绝不弹原生对话框
6. **DOM 核验**：填完读回，不匹配就报错并附证据

### 3.5 三类平台变化 → 三种应对（自动维护闭环）

| 平台变化类型 | 应对 | 人工介入 |
|---|---|---|
| 属性多一栏 / 下拉项变化 | schema 现拉 + AI 补填 | **零维护** |
| XPath 小变（class 哈希后缀变） | candidates 多锚点备选自愈 | **零维护** |
| XPath 大变（DOM 结构改版） | 巡检报告给出「失联锚点 + URL + 截图 + DOM 片段」→ 人改一行 JSON | 改 JSON，5 分钟 |

### 3.6 缓存分层（键扩展）

| 层 | 键 | 值 | 失效 |
|---|---|---|---|
| 属性值（已有） | `pdd:咖啡纸杯`（pdd attr-cache）/ `taobao:catId`（g5 类目档案） | `{材质: "PP塑料", ...}` | 命中即验证（选项含该值才用） |
| 运费模板（已有） | g5 类目档案 `freightTemplate` 字段（淘宝） | 模板名 | 命中即验证（下拉含该值才用） |
| schema 指纹（已有） | g5 类目档案 `schemaFp`（淘宝）/ attr-cache schema 键（pdd） | 控件清单 hash | diff 变化 → 缓存值降级为「待验证」，AI 重填 |

### 3.7 图片预检门禁（发布前，并发 8）

- 大小/长宽/白底图检查（pdd 单张 ≤3MB / 10 张；taobao ≤20MB / 5 张；xianyu ≤10MB / 9 张）
- 白底图按平台模板决定是否必填（platformExtras 配置）
- 三级报告：全部通过 → 发；不通过 → 列出问题清单（哪张图哪个问题），绝不带病上传

### 3.8 数据模型（canonical ProductData 四段式）

```jsonc
{
  "template": { "title": "...", "images": [...], "detailImages": [...], "price": "...", "stock": "..." },
  "specs": [ { "name": "颜色", "values": [...] } ],      // 规格维度（先拉取再展开，不猜）
  "platformExtras": { "pdd": { "freightTemplate": "...", "deliveryTime": 2 } },  // 平台特定字段（店铺级模板可复用）
  "profile": { "imageBase": "...", "skuImageRule": "prefix" }   // 店铺级：SKU 图片前缀规则等
}
```

SKU 维度**先拉取再展开**：服饰是尺码、纸杯是数量——维度来自页面真实下拉，不靠猜。

---

## 4. 实施计划（9 步，每步可回滚）

| # | 内容 | 产出 | 验收 |
|---|---|---|---|
| 1 | 配置加载器 `src/services/publish-config-loader.ts` | 读 `publish-config/{pdd,taobao,xianyu}.json`，校验+缓存（fs watch 可选） | 单测：加载/字段校验 |
| 2 | 锚点解析引擎 `src/services/anchor-engine.ts` | `resolveAnchor(page, anchorKey)` candidates 逐个尝试，失败附诊断 | 单测：多候选命中/全失联报证据 |
| 3 | pdd JSON 化 | `publish-config/pdd.json` 全锚点迁移 + pdd-publish.ts 常量区改读配置 | 既有行为零变化（见 §5 验收） |
| 4 | taobao JSON 化 | 同上 | 同上 |
| 5 | xianyu JSON 化 | 同上（最小集） | 同上 |
| 6 | 缓存分层扩展 | ~~attr-cache 键扩展~~ 已由 g5 类目档案（category-profile，淘宝已接）替代落地 | category-profile.test.mjs |
| 7 | 图片预检门禁 | 发布前并发检查 | 单测 + 实测 |
| 8 | 巡检脚本 `dev/patrol-publish.mjs` | 复刻 verify-pdd-newflow 蓝本，遍历 JSON anchors 逐个打点 | 巡检报告三级判定 |
| 9 | 打包同步 | package.json `files` 补 `publish-config` + sync-to-host 同步 | 宿主可用 |

**改造纪律（每一步都必须遵守）**：
- **行为零变化**：抽取不改逻辑——pdd 的 fillShippingAndFreight、fillAttributes 的缓存链原样保留，只把字符串常量换成配置引用
- **引擎三步抽取演化**（不重写）：① selector 常量抽 JSON（本步）→ ② 流程顺序抽 flow 数组（后续）→ ③ 字段策略进 fieldStrategies（后续）。本次实施只做 ①，flow/fieldStrategies 在 JSON 里预留结构
- **不重写已验证的实现**：淘宝 iframe 上传三条退化路径、pdd SKU 真实键入、闲鱼 contenteditable 真键盘——这些真机踩坑成果原样保留
- 每平台改完跑 `npm run typecheck` + `node dev/smoke-client.mjs`
- 平台 JSON 属自研数据（锚点来自本仓真机实测，非外部参考），按项目溯源规则**无需 SOURCE.md**（pdd 锚点实测依据已在源码头部注释与 `skills/pdd-publish-2/SOURCE.md` 记录）

---

## 5. 验收标准

1. **配置加载**：三平台 JSON 加载成功，缺字段/非法字段在启动时报错（fail-fast）
2. **锚点自愈**：把某锚点第一候选 selector 改错，引擎自动用第二候选命中——行为不中断
3. **行为零变化回归**：改造前后对同一输入，浏览器执行的动作序列一致（fillTitle/fillSku/fillAttributes 等函数单测或真机抽查）
4. **平台改版模拟**：改 JSON 一行 selector → 无需改代码、无需重启宿主 → 下次发布生效（JSON 每次调用现读）
5. **巡检**：`node dev/patrol-publish.mjs pdd` 输出三级报告（全绿/指纹变化/失联+证据）
6. **构建**：`npm run build` 全绿 + sync-to-host 同步成功 + 宿主内发布工具可用

---

## 6. 落点清单（本方案产出的文件）

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/services/publish-config-loader.ts` | 新增 | 配置加载器（读+校验+进程内缓存） |
| `src/services/anchor-engine.ts` | 新增 | 锚点解析引擎（candidates 逐试+诊断） |
| `publish-config/pdd.json` / `taobao.json` / `xianyu.json` | 新增 | 三平台锚点+流程+字段策略 |
| `src/pdd-publish.ts` / `taobao-publish.ts` / `xianyu-publish.ts` | 修改 | 常量区改读配置，行为零变化 |
| `dev/patrol-publish.mjs` | 新增 | 巡检脚本（蓝本 verify-pdd-newflow.mjs） |
| `package.json` | 修改 | `files` 补 `publish-config` |
| `dev/portable/sync-to-host.mjs` | 修改 | 同步 publish-config/ 到宿主快照 |

---

## 7. 边界与不做

- 不做 API 直发（平台开放接口需自研应用资质，不可行，见 pdd-publish.ts 头注）
- 不做流程顺序重排（flow 数组本步只预留结构，不做能力块重排——现有顺序即真机验证过的顺序）
- 不做 batch 层（A6 任务队列列为后续扩展，单件能力优先稳住）
- 不做视频上传（主图视频留待模板需要时接入）
- 闲鱼无类目/属性/SKU——其 JSON 是 anchors 最小集 + flow 最短链
