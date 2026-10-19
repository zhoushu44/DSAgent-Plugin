---
name: jd-publish-mqs
description: "京东 POP 商品上架：把本地图片与商品信息发布为京东商品（京东价/市场价/库存/货号/SKU 规格/类目属性/运费模板），自动填通用字段后提交。触发：京东上架、京东发布商品、京麦上架、京东 POP 发布、把商品发到京东。排除：淘宝/天猫用 taobao-publish-mqs 与 tmall-publish-mqs、拼多多用 pdd-publish-2、抖音用 douyin-publish-mqs、1688 用 1688-publish-mqs、闲鱼用 xianyu-publish；不做京东商品采集与比价、不做订单与售后。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "京东·商品上架（mqs）"
    emoji: "🛒"
    requires: {}
---

# 京东 POP · 商品上架（mqs）

> **重要:** 上架是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 confirm=true。

## 前置条件

- 已绑定**京东**账号（dsagent_list_accounts 里 platform=jd 且 status=valid），且该账号在京麦商品发布后台有发布权限。
- 主图为**本机绝对路径**且真实存在，1~5 张，单张 ≤ 3MB（超限请先压缩）。
- 标题必填；字符上限**以页面 maxlength 为准**（发布时现读，不写死），超长由模型层按平台规则先截断并记一条 warning。
- 锚点、超时与正则全部外置在平台锚点集里（与 `PUBLISH-SPEC.md` 的 XPath 四级锚点规范一致），改锚点不需要重启宿主，发布时现读。
- 类目属性里的**品牌**一律不自动填（涉及品牌授权），留给用户在浏览器窗口内人工选择。

## 何时使用

- 用户说「把这个商品发到京东」「京东上架」「京东发布商品」「京麦上架」「京东 POP 发布」
- 用户给出本地图片路径 + 标题（可选价格/库存/货号/SKU），要求发布到京东店铺
- 需要把已组装好的商品数据（标题/主图/规格/SKU 行）上架到京东，且希望属性与运费模板尽量自动填

## 边界

- **不做淘宝 / 天猫发布** → 见 taobao-publish-mqs、tmall-publish-mqs 两个技能（同为 goods_manager 引擎，域名 item.upload.taobao.com / sell.publish.tmall.com）
- **不做拼多多发布** → 用 `skills/pdd-publish-2/SKILL.md`；**不做闲鱼发布** → 用 `skills/xianyu-publish/SKILL.md`
- **不做抖音 / 1688 发布** → 见 douyin-publish-mqs、1688-publish-mqs 两个技能
- **不做京东商品采集与比价、不做订单与售后** —— 采集走采集类技能，订单售后走京麦后台
- **不生成文案**：标题、价格、属性值由用户提供（可先用通用文案技能生成再回到本技能）
- **不做批量与定时上架**：本技能只负责**单件**上架，批量循环交给工作流模板编排

## 输入

工具名 dsagent_jd_publish，入参风格与 `skills/pdd-publish-2/SKILL.md` 的单对象 product 一致：

| 参数 | 必需 | 说明 |
|------|------|------|
| product | 是 | 统一商品 JSON 字符串：title / images / price（京东价）/ marketPrice（市场价，选填）/ stock / itemNo（货号）/ category / specs / skus / attributes |
| confirm | 否 | **省略或 false → 只返回预览，不产生任何写操作**；true → 才真正打开浏览器提交 |
| account | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |

product 关键字段规则：

- title 必填；images 必填，1~5 张，单张 ≤ 3MB，本机绝对路径且真实存在
- price 为**京东价**（正数，元）；marketPrice 为划线市场价（选填，须 ≥ 京东价，否则平台校验会拦）
- specs ≤ 2 维；skus 每行必须覆盖全部维度，缺价格/库存时回落顶层 price / stock
- attributes 里**品牌不自动填**；显式给出的属性值**命中页面下拉候选才点选**，未命中记入 missed 但不阻断发布

> 若宿主未注册 dsagent_jd_publish 工具，本技能降级为**指令型**：按下方工作流逐步给出人工操作指引与字段清单，不产生任何自动写操作。

## 工作流

### 1. 组装 product

从用户话里提取标题、图片、京东价、市场价、库存、货号、规格与 SKU 行；缺必填项就主动问，**不要自己编价格**。

### 2. 先取「发布预览」（不带 confirm）

调用 dsagent_jd_publish，**只传 product，不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：ok=false + needConfirm=true。
★ 这个 ok=false 是**正常流程**，不是报错。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现（账号、标题、京东价、市场价、库存、货号、主图张数），并明确问一句「确认要发布到京东吗？」。
**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。
同时必须提醒：类目属性（尤其品牌）、商品详情、发货与售后设置不会自动填写，稍后需要在弹出的浏览器窗口内人工补全。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，按能力块顺序执行：打开发布入口 → 选类目（同步拉类目树）→ 等表单就绪 → 上传主图 → 填标题/京东价/市场价/库存/货号 → 填 SKU 规格与 SKU 表 → 填类目属性（品牌跳过）→ 选运费模板 → 提交 → 三路回读错误（toast / 字段红字 / 填写建议面板）。

### 5. 报告结果

- 成功：告知已提交、返回的商品 ID 与页面 URL，并说明**平台仍会审核**，最终状态以京麦「商品管理」为准；同时列出未自动填写的字段
- ok=false 且 needConfirm=true：这是预览，回到第 3 步征求用户同意
- ok=false 且带 failureKind：按下方「错误处理」走

## 平台差异（京东 vs 淘宝/天猫）

| 维度 | 京东 | 说明 |
|------|------|------|
| 发布域 | wares-jdm.jd.com（京麦商品发布） | 与淘宝 item.upload.taobao.com、天猫 sell.publish.tmall.com 不同域 |
| 异步类目接口 | 无 | 只能同步拉类目树；淘宝/天猫有 asyncOpt 异步类目入口 |
| AI 类目推荐 | 无 | 类目靠搜索或路径选择确定 |
| 运费模板 | 有真实接口 | 提交前必须选中模板，否则被拦 |
| 图片空间 | 有 | 主图走图片空间上传 |
| 尺码模板 | 无 | 服饰类尺码模板不可自动映射，需人工在页面补 |
| 特有字段 | 京东价 / 市场价 / 货号 | 淘宝侧对应一口价 / 货号；市场价须 ≥ 京东价 |

> 上表依据共享规范 `PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块顺序）；同族旧实现对照见 `skills/taobao-publish/SKILL.md`。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定京东账号 | not_bound | 引导用户到「账号连接」页面添加**京东**账号并登录京麦 |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 发布页未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录京东** |
| 命中滑块 / 安全验证 | risk_control | 调用 dsagent_risk_verify（platform=jd，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| product 非法 JSON / 缺 title 或 images / 图片超 3MB 或超 5 张 | api_error | 按返回文案修正 product 后重试（校验在浏览器启动**之前**完成，不产生写操作） |
| 市场价低于京东价 / 价格或库存越界 | api_error | 修正价格后重试 |
| SKU 行未覆盖全部维度 / 规格值重复 | api_error | 补齐 SKU 行后重试 |
| 页面长时间停在「选择类目」 | api_error | 让用户在窗口内选好类目；选完才会进入正式表单 |
| 提交后提示类目属性 / 详情未填 | api_error | 类目属性与商品详情不由本技能自动填写，让用户在窗口内补全后手动点提交 |
| 提交后未选中运费模板被拦 | api_error | 让用户在窗口内选择或新建运费模板后重新提交 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png） |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |
| 宿主未注册 dsagent_jd_publish | api_error | 降级为指令型：按工作流给出人工上架步骤与字段清单，不要假装已提交 |

## 证据与坐标

- 平台矩阵与八平台上架引擎的字符偏移坐标见 `PUBLISH-MATRIX.md` 与 `PUBLISH-SPEC.md`；共享证据底稿（觅千手 v5.61 平台矩阵、域名/路径限定/取数能力/字段映射差异）在 docs/mqs-publish-platform-matrix.md。
- 京东在上架引擎里的注册域为 wares-jdm.jd.com；引擎侧运费模板与图片空间均为真实接口，尺码模板与异步/AI 类目接口均不存在。
