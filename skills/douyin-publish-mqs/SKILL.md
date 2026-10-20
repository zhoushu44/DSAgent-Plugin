---
name: douyin-publish-mqs
description: "抖音小店（抖店）商品上架（觅千手 v5.61 goods_manager 同引擎）：把统一商品 JSON（标题 / 主图 / 规格维度 / SKU 行 / 类目属性）经浏览器驱动提交到抖店商家后台商品创建页，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段真实链路。触发：抖音小店上架、抖店发布商品、抖音电商上架、把商品挂到抖店。排除：抖音视频投稿用 douyin-publish、抖音采集用 douyin-crawl、淘宝用 taobao-publish-mqs、天猫用 tmall-publish-mqs、京东用 jd-publish-mqs、1688 用 1688-publish-mqs、拼多多用 pdd-publish-2。发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音小店·商品上架（mqs）"
    emoji: "🎵"
    requires: {}
---

# 抖音小店 · 商品上架（mqs 链路）

> **重要：** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `confirm=true`。

## 前置条件

- 已绑定**抖音小店（抖店）**账号（platform=douyin 且该账号具备抖店店铺资质）。★ 抖店没有独立登录态，复用抖音登录态，但**必须是有店铺权限的账号**；只有个人号、无小店资质的账号会在选类目阶段被挡。
- 主图为本机绝对路径且真实存在，1~5 张，单张 ≤ 3MB（建议 ≥ 800×800、1:1 白底）。
- 标题必填；字符上限**以页面 `maxlength` 为准**（发布时现读，不写死），超长由模型层按平台规则先截断并记 warning（见 `PUBLISH-SPEC.md` §3.8）。
- `specs` ≤ 2 维（如「颜色分类 × 尺码」）；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。
- 同一时间只允许一个抖店浏览器任务；已有任务进行中时先等它结束。
- 锚点与超时参数外置（分级 selector / timeouts / regexes，发布时现读），改锚点**不需要重启宿主**。

## 何时使用

- 用户说「把这个发到抖音小店」「抖店上架」「抖店发布商品」「抖音电商上架」→ 用本技能。
- 用户给出一件商品的**统一 JSON**（或可组装成该 JSON 的字段：标题 + 主图 + 规格维度 + SKU 行）要求发到抖店 → 用本技能。
- 用户说「用觅千手那套上架抖店」「mqs 上架抖店」→ 用本技能（同一条 goods_manager 引擎链路）。
- 用户已建好抖店草稿，只想让 AI 补齐类目属性 / SKU → 用本技能取预览后按字段补齐。

## 边界

- ★ **不做抖音视频 / 图文投稿** → 用 `skills/douyin-publish/SKILL.md`（内容发布，无类目属性，与商品上架是两条完全不同的链路）。
- **不做抖音数据采集**（作品列表 / 视频详情 / 搜索 / 热搜）→ 用 `skills/douyin-crawl/SKILL.md`。
- **不做淘宝 / 天猫 / 京东 / 1688 发布** → 分别用 taobao-publish-mqs、tmall-publish-mqs、jd-publish-mqs、1688-publish-mqs 四个同族技能。
- **不做拼多多 / 闲鱼发布** → 用 `skills/pdd-publish-2/SKILL.md` 与 `skills/xianyu-publish/SKILL.md`。
- **不做批量 / 定时发布**：当前只支持**单件**商品发布，多件需逐件调用。
- **不生成文案与主图** → 标题与卖点由用户提供（或先用 `skills/smart-compose/SKILL.md` 生成，再回到本技能发布）。
- ★ **品牌一律不自动填**（涉及品牌授权，`ATTR_SKIP_RE` 跳过），留给用户在弹出窗口内人工选择。
- ★ **商品资质、质检报告与部分类目属性**仍需人工补全（平台因类目而异，无法统一自动化）。

## 输入

工具名 `dsagent_douyin_shop_publish_mqs`，入参为单对象 product：

| 参数 | 必需 | 说明 |
|------|------|------|
| `product` | 是 | 统一商品 JSON 字符串：`title` / `images` / `price`（一口价）/ `stock` / `itemNo`（商家编码/货号）/ `channel`（**本技能固定 `douyin_shop`**）/ `category` / `specs` / `skus` / `attributes` |
| `confirm` | 否 | **省略或 false → 只返回预览，不产生任何写操作**；`true` → 才真正打开浏览器提交 |
| `account` | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |

product 关键字段规则：

- `channel` **必须显式传 `douyin_shop`**；省略会落到默认渠道（淘宝域），把商品发到错误后台。
- `title` 必填；`images` 必填，1~5 张，单张 ≤ 3MB，本机绝对路径且真实存在。
- `price` 为**一口价**（正数，元）；`stock` 为非负整数。
- `specs` ≤ 2 维；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。

## 工作流

### 1. 组装统一商品 JSON

从用户话里提取字段；`title` 与 `images` 是必需项，缺了就主动问。规格最多 2 维（如「颜色分类 × 尺码」），SKU 行必须覆盖全部维度。**必须把 `channel` 写成 `douyin_shop`**。

### 2. 先取「发布预览」（不带 confirm）

调用 `dsagent_douyin_shop_publish_mqs`，**只传 product（含 channel=douyin_shop），不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：ok=false + needConfirm=true，以及账号、标题、一口价、库存、货号、主图清单、规格维度、SKU 组合、显式属性。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现给用户，并明确问一句「确认要发布到抖音小店吗？」。同时**必须提醒**：品牌、商品资质与部分类目属性不会被自动填写，稍后需在弹出的浏览器窗口内人工补全。

**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，依次执行：注入抖音登录态 → openEntry（抖店商品创建页）→ selectCategory（关键词搜类目 → 选叶子候选）→ waitFor 表单就绪 → fillTitle → uploadMainImages → fillSku（销售属性值逐值键入 + **Tab 提交** → SKU 表回填价格/库存/编码）→ fillAttributes（品牌跳过、类目档案回放优先）→ selectFreightTemplate（运费模板是隐藏必填）→ submit → readSubmitErrors（三路回读：toast + 字段红字 + 填写建议面板）。

### 5. 报告结果

- 成功：告知已提交、商品 ID（若页面返回），并说明**平台仍会审核**，最终状态以抖店后台「商品管理」为准；同时列出**未自动填写的字段**。
- ok=false 且 needConfirm=true：这是预览，回到第 3 步征求用户同意。
- ok=false 且带 `failureKind`：按下方「错误处理」走。

## 平台硬规则（工具已内化，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| 类目决定一切 | 抖店销售属性 ID 与属性表都由**类目**决定，类目选错则属性与 SKU 全错，故类目永远排在属性之前 |
| 抖店 ≠ 抖音内容 | 抖店上架走商家后台（有类目树 + 属性表）；抖音视频/图文投稿走创作服务平台（无类目属性），两条链路不可混用 |
| 规格值必须逐值键入 + Tab | 抖店销售属性是受控输入，只有「键入后按 Tab」才能提交进 React state，直接赋 value 无效 |
| 品牌必填且需授权 | 一律 `ATTR_SKIP_RE` 跳过，由用户在窗口内人工选择 |
| 运费模板是隐藏必填 | 选完发货方式后必须再选一个运费模板，否则提交被拦 |
| 类目规则从 DOM 读 | `maxlength` / `.required` / 红色校验文案都在页面里，不查文档 |
| 主图必须真实鼠标点击 | 主图区的 untrusted click 会被页面忽略，必须用真实坐标点击 |

## 平台差异（抖店 vs 淘宝 / 拼多多）

| 维度 | 抖音小店（抖店） | 说明 |
|------|------|------|
| 发布域 | 抖店商家后台商品创建页 | 与淘宝 item.upload.taobao.com、拼多多同引擎不同后台；按 `channel` 切域 |
| 登录态 | 复用抖音登录态，但需店铺资质 | 缺登录态 → token_expired；有登录态无店铺 → api_error |
| 类目选择 | 关键词搜索 + 选叶子候选 | 与淘宝一致（搜索框 → 候选 → 等提交按钮可用） |
| 规格提交键 | 键入 + **Tab** | 与淘宝一致（拼多多是填值后自动展开 SKU 表） |
| 详情图 | 人工补全优先 | 详情编辑器跨域，自动上传失败不阻断发布，只记 missed |

> 上表依据共享规范 `PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状；第八节把「抖音小店」列为待接的有类目树平台）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音账号 | not_bound | 引导用户到「账号连接」页面扫码登录抖音账号（需抖店店铺资质） |
| 有抖音登录态但无抖店店铺 | api_error | 说明抖店上架需小店资质，引导换账号或先去抖店开通店铺；★ 不要退化成抖音视频投稿 |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 后台未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录抖音** |
| 命中滑块 / 安全验证 | risk_control | 调用 `dsagent_risk_verify`（platform=douyin，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| product 非法 JSON / 缺 title 或 images / 图片超 3MB 或超 5 张 | api_error | 按返回文案修正 product 后重试（校验在浏览器启动**之前**完成，不产生写操作） |
| 忘传 channel 或误传 taobao | api_error | 修正为 `channel=douyin_shop` 后重新取预览，不要把预览结果当发布结果 |
| SKU 行未覆盖全部维度 / 规格值重复 / 规格超 2 维 | api_error | 补齐 SKU 行后重试 |
| 页面长时间停在「选择类目」 | api_error | 让用户在窗口内选好类目；选完类目才会进入正式表单 |
| 提交后提示类目属性 / 详情未填 | api_error | 类目属性与商品详情不由工具自动填写，让用户补全后手动点提交 |
| 属性值不在下拉候选里 | api_error | 说明该属性当前类目无可选值，让用户人工选择；不要强行写值 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png，1:1 白底） |
| 已有抖店浏览器任务在进行中 | api_error | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |
| 宿主未注册 dsagent_douyin_shop_publish_mqs | api_error | 降级为指令型：按工作流给出人工上架步骤与字段清单，不要假装已提交 |

## 证据与参考

- 共享接入规范：`PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。
- 同引擎实现对照：`src/taobao-publish.ts`（类目档案回放 / 7 函数链 / 三路错误诊断，按 channel 切域）。
- 内容发布对照（★ 别混用）：`skills/douyin-publish/SKILL.md`（视频投稿，入口 creator.douyin.com，无类目属性）。
- 同族技能对照：`skills/taobao-publish-mqs/SKILL.md`、`skills/tmall-publish-mqs/SKILL.md`、`skills/pdd-publish-2/SKILL.md`。
- 验收门禁：`dev/verify-mqs-skills.mjs`（frontmatter / 章节槽位 / L2 门禁 / 悬空路径一次校验）。
- 抖店主图与素材规范（尺寸、单图体积、禁用语）：`skills/image-prompt-guide/references/platform-specs-china.md`。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。账号凭证由 host 工具从凭证库读取并在浏览器内注入 Cookie，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
