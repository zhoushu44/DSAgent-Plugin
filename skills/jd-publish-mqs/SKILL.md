---
name: jd-publish-mqs
description: "京东商品上架（觅千手 v5.61 goods_manager 同引擎）：把统一商品 JSON（标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性）经浏览器驱动提交到京东商家后台商品发布页 wares-jdm.jd.com，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段真实链路。触发：京东上架、京东发布商品、京东商家后台发布、把商品挂到京东、用统一商品数据发京东。排除：京东数据采集用 taobao-crawl 系采集技能、淘宝用 taobao-publish-mqs、天猫用 tmall-publish-mqs、抖音小店用 douyin-publish-mqs、1688 用 1688-publish-mqs、拼多多用 pdd-publish-2。发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "京东·商品上架（mqs）"
    emoji: "📦"
    requires: {}
---

# 京东 · 商品上架（mqs 链路）

> **重要：** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `confirm=true`。

## 前置条件

- 已绑定**京东**账号（platform=jd 且 status=valid）。★ 京东**有自己的登录态**，与淘宝/天猫/抖店的 Cookie 完全不通用；没有京东登录态就一定发不了京东。
- 该账号必须是**京东商家（POP 或自营供应商）账号**且有发品权限；纯京东买家账号会在选类目阶段被挡。
- 主图为本机绝对路径且真实存在，1~5 张，单张 ≤ 3MB（京东主图要求 1:1、≥ 800×800、白底）。
- 标题必填；字符上限**以页面 `maxlength` 为准**（发布时现读，不写死），超长由模型层按平台规则先截断并记一条 warning（见 `PUBLISH-SPEC.md` §3.8）。
- `specs` ≤ 2 维（如「颜色 × 尺码」）；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。
- 京东商品必须有**三级类目（一级 / 二级 / 末级）**且末级类目必须是类目树里的叶子节点；类目选错则属性表整张错位。
- 同一时间只允许一个京东浏览器任务；已有任务进行中时先等它结束。
- 锚点与超时参数外置（分级 selector / timeouts / regexes，发布时现读），改锚点**不需要重启宿主**。

## 何时使用

- 用户说「把这个发到京东」「京东上架」「京东发布商品」「京东商家后台发布」→ 用本技能。
- 用户给出一件商品的**统一 JSON**（或可组装成该 JSON 的字段：标题 + 主图 + 规格维度 + SKU 行）要求发到京东 → 用本技能。
- 用户说「用觅千手那套上架京东」「mqs 上架京东」→ 用本技能（同一条 goods_manager 引擎链路）。
- 用户已在京东商家后台建好草稿，只想让 AI 补齐类目属性 / SKU → 用本技能取预览后按字段补齐。

## 边界

- **不做淘宝 C 店 / 天猫发布** → 用 `skills/taobao-publish-mqs/SKILL.md` 与 `skills/tmall-publish-mqs/SKILL.md`（同引擎，阿里域）。
- **不做抖音小店 / 1688 发布** → 用 `skills/douyin-publish-mqs/SKILL.md` 与 `skills/1688-publish-mqs/SKILL.md`。
- **不做拼多多 / 闲鱼发布** → 用 `skills/pdd-publish-2/SKILL.md` 与 `skills/xianyu-publish/SKILL.md`。
- **不做京东商品采集与比价** → 采集走对应 crawl 技能；本技能只负责上架。
- **不做批量 / 定时发布**：当前只支持**单件**商品发布，多件需逐件调用。
- **不生成文案与主图** → 标题与卖点由用户提供（或先用 `skills/smart-compose/SKILL.md` 生成，再回到本技能发布）。
- ★ **品牌一律不自动填**（涉及品牌授权与品牌库校验，`ATTR_SKIP_RE` 跳过），留给用户在弹出窗口内人工选择。
- ★ **商品资质、3C 认证与部分类目属性**仍需人工补全（平台因类目而异，无法统一自动化）。

## 输入

工具名 `dsagent_jd_publish_mqs`，入参为单对象 product：

| 参数 | 必需 | 说明 |
|------|------|------|
| `product` | 是 | 统一商品 JSON 字符串：`title` / `images` / `price`（一口价/京东价）/ `stock` / `itemNo`（商家编码/货号）/ `channel`（**本技能固定 `jd`**）/ `category` / `specs` / `skus` / `attributes` |
| `confirm` | 否 | **省略或 false → 只返回预览，不产生任何写操作**；`true` → 才真正打开浏览器提交 |
| `account` | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |

product 关键字段规则：

- `channel` **必须显式传 `jd`**；省略会落到默认渠道（淘宝域），把商品发到错误后台。
- `title` 必填；`images` 必填，1~5 张，单张 ≤ 3MB，本机绝对路径且真实存在。
- `price` 为**一口价（京东价）**（正数，元）；`stock` 为非负整数。
- `specs` ≤ 2 维；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。

## 工作流

### 1. 组装统一商品 JSON

从用户话里提取字段；`title` 与 `images` 是必需项，缺了就主动问。规格最多 2 维（如「颜色 × 尺码」），SKU 行必须覆盖全部维度。**必须把 `channel` 写成 `jd`**。

### 2. 先取「发布预览」（不带 confirm）

调用 `dsagent_jd_publish_mqs`，**只传 product（含 channel=jd），不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：ok=false + needConfirm=true，以及账号、标题、一口价、库存、货号、主图清单、规格维度、SKU 组合、显式属性。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现给用户，并明确问一句「确认要发布到京东吗？」。同时**必须提醒**：品牌、商品资质与部分类目属性不会被自动填写，稍后需在弹出的浏览器窗口内人工补全。

**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，依次执行：注入京东登录态 → openEntry（京东商品发布页 wares-jdm.jd.com）→ selectCategory（三级类目：一级 → 二级 → 末级叶子）→ waitFor 表单就绪 → fillTitle → uploadMainImages → fillSku（销售属性值逐值键入 + **Tab 提交** → SKU 表回填价格/库存/编码）→ fillAttributes（品牌跳过、类目档案回放优先）→ selectFreightTemplate（运费模板是隐藏必填）→ submit → readSubmitErrors（三路回读：toast + 字段红字 + 填写建议面板）。

### 5. 报告结果

- 成功：告知已提交、商品 ID（若页面返回），并说明**平台仍会审核**，最终状态以京东商家后台「商品管理 → 出售中」为准；同时列出**未自动填写的字段**。
- ok=false 且 needConfirm=true：这是预览，回到第 3 步征求用户同意。
- ok=false 且带 `failureKind`：按下方「错误处理」走。

## 平台硬规则（工具已内化，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| 三级类目决定一切 | 京东必须选到**末级叶子类目**，销售属性 ID 与属性表都由末级类目决定，选错则属性与 SKU 全错 |
| 登录态独立 | 京东 Cookie 与阿里系（淘宝/天猫）、抖店完全不通用，缺登录态 → failureKind=token_expired |
| 规格值必须逐值键入 + Tab | 京东销售属性是受控输入，只有「键入后按 Tab」才能提交进 state，直接赋 value 无效 |
| 品牌必填且需授权 | 一律 `ATTR_SKIP_RE` 跳过，由用户在窗口内人工选择（京东有品牌库校验） |
| 运费模板是隐藏必填 | 选完配送方式后必须再选一个运费模板，否则提交被拦 |
| 类目规则从 DOM 读 | `maxlength` / `.required` / 红色校验文案都在页面里，不查文档 |
| 主图必须真实鼠标点击 | 主图区的 untrusted click 会被页面忽略，必须用真实坐标点击 |

## 平台差异（京东 vs 淘宝 / 抖店）

| 维度 | 京东 | 说明 |
|------|------|------|
| 发布域 | wares-jdm.jd.com | 与淘宝 item.upload.taobao.com、天猫 sell.publish.tmall.com 不同域；同一引擎按 `channel` 切域 |
| 登录态 | **独立**（jd 账号，不共用阿里系） | 缺登录态 → token_expired；有登录态无商家资质 → api_error |
| 类目选择 | 三级级联（一级 → 二级 → 末级） | 与淘宝「关键词搜类目」不同：京东要按层级逐级点到叶子节点 |
| 价格字段 | 一口价（京东价） | 拼多多另有「单买价 = 拼单价 + 1」自动计算，京东无此规则 |
| 品牌属性 | **必填且需授权 + 品牌库校验** | 一律 `ATTR_SKIP_RE` 跳过，由用户在窗口内人工选择 |

> 上表依据共享规范 `PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状；第八节把「京东」列为待接的有类目树平台）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定京东账号 | not_bound | 引导用户到「账号连接」页面添加**京东**账号（京东登录态独立，不能用淘宝登录态顶替） |
| 账号是京东买家号、无商家发品权限 | api_error | 说明京东发布域需商家资质，引导换商家账号或先去京东商家后台开通 |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 发布页未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录京东** |
| 命中滑块 / 安全验证 | risk_control | 调用 `dsagent_risk_verify`（platform=jd，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| product 非法 JSON / 缺 title 或 images / 图片超 3MB 或超 5 张 | api_error | 按返回文案修正 product 后重试（校验在浏览器启动**之前**完成，不产生写操作） |
| 忘传 channel 或误传 taobao | api_error | 修正为 `channel=jd` 后重新取预览，不要把预览结果当发布结果 |
| SKU 行未覆盖全部维度 / 规格值重复 / 规格超 2 维 | api_error | 补齐 SKU 行后重试 |
| 页面长时间停在「选择类目」 | api_error | 京东要选到**末级叶子**类目才会出表单；让用户在窗口内点完三级类目 |
| 提交后提示类目属性 / 详情未填 | api_error | 类目属性与商品详情不由工具自动填写，让用户补全后手动点提交 |
| 属性值不在下拉候选里 | api_error | 说明该属性当前类目无可选值，让用户人工选择；不要强行写值 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png，1:1 白底） |
| 已有京东浏览器任务在进行中 | api_error | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |
| 宿主未注册 dsagent_jd_publish_mqs | api_error | 降级为指令型：按工作流给出人工上架步骤与字段清单，不要假装已提交 |

## 证据与参考

- 共享接入规范：`PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。
- 同引擎实现对照：`src/taobao-publish.ts`（类目档案回放 / 7 函数链 / 三路错误诊断，按 channel 切域）。
- 同族技能对照：`skills/taobao-publish-mqs/SKILL.md`（渠道默认 taobao）、`skills/tmall-publish-mqs/SKILL.md`（渠道 tmall）、`skills/pdd-publish-2/SKILL.md`（拼多多旧模式 attr-cache）。
- 锚点集 schema 参照：`publish-config/taobao.json`（分级 selector、timeouts、regexes，发布时现读）。
- 验收门禁：`dev/verify-mqs-skills.mjs`（frontmatter / 章节槽位 / L2 门禁 / 悬空路径一次校验）。
- 京东主图与素材规范（尺寸、单图体积、禁用语）：`skills/image-prompt-guide/references/platform-specs-china.md`。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。账号凭证由 host 工具从凭证库读取并在浏览器内注入 Cookie，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
