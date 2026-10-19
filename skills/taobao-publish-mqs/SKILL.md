---
name: taobao-publish-mqs
description: "淘宝商品上架（觅千手 v5.61 同款 goods_manager 链路）：把统一商品数据（标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性）经浏览器驱动提交到淘宝卖家中心 item.upload.taobao.com，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段真实链路。触发：淘宝上架、淘宝发布、淘宝批量上架、用统一商品数据发淘宝、觅千手上架淘宝、把商品挂到淘宝。排除：天猫上架用 tmall-publish-mqs、拼多多用 pdd-publish-2、闲鱼用 xianyu-publish、采集比价用 taobao-crawl、生意参谋分析用 sycm 系技能。需绑定淘宝账号（与天猫共用同一套登录态）；发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "淘宝·商品上架（mqs）"
    emoji: "🛒"
    requires: {}
---

# 淘宝 · 商品上架（mqs 链路）

> **重要：** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `confirm=true`。

## 前置条件

- 已绑定**淘宝**账号（`dsagent_list_accounts` 里 platform=taobao 且 status=valid）。淘宝与天猫**共用同一套登录态**，无需也无法单独登录天猫。
- 主图为本机绝对路径且真实存在，1~5 张，单张 ≤ 20MB（页面侧另有 ≤3MB 软限制，超限请先压缩）。
- 标题必填；页面 `maxlength` 为 60 字符，模型层对淘宝/天猫另有 30 字符的平台裁剪规则（超长会记一条 warning，见 PUBLISH-SPEC.md §3.8）。
- 同一时间只允许一个淘宝浏览器任务；已有任务进行中时先等它结束。
- 锚点与超时参数全部外置在 `publish-config/taobao.json`，改锚点**不需要重启宿主**（发布时现读）。

## 何时使用

- 用户说「把这个发到淘宝」「淘宝上架」「淘宝发布」「把商品挂到淘宝」→ 用本技能。
- 用户给出一件商品的**统一 JSON**（或可组装成该 JSON 的字段：标题 + 主图 + 规格维度 + SKU 行）要求发到淘宝 → 用本技能。
- 用户说「用觅千手那套上架淘宝」「mqs 上架」→ 用本技能（同一条 goods_manager 引擎链路）。

## 边界

- **不做天猫发布** → 用 `skills/tmall-publish-mqs/SKILL.md`（同为 goods_manager 引擎，域名 sell.publish.tmall.com）。
- **不做拼多多 / 闲鱼 / 抖店 / 京东 / 1688 发布** → 分别用 pdd-publish-2、xianyu-publish 与本系列其它 mqs 技能。
- **不做商品采集与比价** → 用 taobao-crawl；**不做生意参谋分析** → 用 sycm 系技能。
- **不做批量 / 定时发布**：当前只支持**单件**商品发布，多件需逐件调用。
- ★ **品牌一律不自动填**（涉及品牌授权，`ATTR_SKIP_RE` 跳过），留给用户在弹出窗口内人工补全。
- ★ **商品资质与部分类目属性**仍需人工补全（平台因类目而异，无法统一自动化）。

## 输入

工具名 `dsagent_taobao_publish`，参数如下：

| 参数 | 必需 | 说明 |
|------|------|------|
| `images` | 是 | 主图本机绝对路径，逗号分隔或 JSON 数组字符串，1~5 张 |
| `title` | 是 | 标题，≤60 字符（模型层对淘宝/天猫先截到 30 字符并记 warning） |
| `price` / `stock` | 否 | 一口价（元，正数）/ 库存（非负整数） |
| `itemNo` | 否 | 商家编码 / 货号 |
| `category` | 否 | 类目关键词或类目路径；不传则从标题推断 |
| `skus` | 否 | SKU 行 JSON 数组，每行给全维度规格值 + 价格 + 库存 + 可选 outerId |
| `attributes` | 否 | 显式属性 name→value（命中页面下拉选项才生效，品牌除外） |
| `confirm` | 否 | **省略或 false → 只返回预览，不产生任何写操作**；`true` → 才真正打开浏览器提交 |
| `account` | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |

## 工作流

### 1. 组装统一商品 JSON

从用户话里提取字段；`title` 与 `images` 是必需项，缺了就主动问。规格最多 2 维（如「颜色分类 × 尺码」），SKU 行必须覆盖全部维度。

### 2. 先取「发布预览」（不带 confirm）

调用 `dsagent_taobao_publish`，**只传业务参数，不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：账号、标题、一口价、库存、货号、主图清单、规格维度、SKU 组合、显式属性。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现给用户，并明确问一句「确认要发布吗？」。同时**必须提醒**：品牌、商品资质与部分类目属性不会被自动填写，稍后需在弹出的浏览器窗口内人工补全。

**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，按 `publish-config/taobao.json` 的 flow 依次执行：
openEntry（类目搜索页）→ selectCategory → waitFor 表单就绪 → fillTitle → uploadMainImages → fillSku → fillAttributes → uploadDetailImages → submit。

### 5. 报告结果

- 成功：告知已提交、商品 ID（若页面返回），并说明**平台仍会审核**，最终状态以卖家中心「出售中的宝贝」为准；同时列出**未自动填写的字段**。
- 失败：按返回的 failureKind 走下方「错误处理」。

## 平台硬规则（工具已内化，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| 类目决定一切 | 销售属性 ID 由**类目**决定（实测「颜色分类」= 1627207），类目选错则属性与 SKU 全错，故类目永远排在属性之前 |
| 主图上传必须真实鼠标点击 | 主图区的 untrusted click 会被页面忽略，必须用真实坐标点击 |
| 规格值必须逐值键入 + Tab | 淘宝销售属性是受控输入，只有「键入后按 Tab」才能提交进 state，直接赋 value 无效 |
| 标题双上限 | 页面 maxlength 60 字符；模型层另有 30 字符平台裁剪规则 |
| 运费模板是隐藏必填 | 勾选运费后必须再选一个模板，否则提交被拦 |
| 属性下拉展开方式每平台不同 | 淘宝只有元素原生 click 能展开，鼠标事件全无效（拼多多相反） |

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定淘宝账号 | not_bound | 引导用户到「账号连接」页面添加**淘宝**账号（登录淘宝后天猫即可用） |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 发布页未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录淘宝** |
| 命中 baxia 滑块 / 安全验证 | risk_control | 调用 `dsagent_risk_verify`（platform=taobao，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| 页面长时间停在「选择类目」 | api_error | 让用户在窗口内选好类目；选完类目才会进入正式表单 |
| 提交后提示类目属性 / 详情未填 | api_error | 类目属性与商品详情不由工具自动填写，让用户补全后手动点提交 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png） |
| 属性值不在下拉候选里 | api_error | 说明该属性当前类目无可选值，让用户人工选择；不要强行写值 |
| 提交后未检测到成功标志 | api_error | 让用户查看窗口内提示，补全必填项后手动提交；有滑块需人工完成 |
| 已有淘宝浏览器任务在进行中 | api_error | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |

## 证据与参考

- 共享接入规范：PUBLISH-MATRIX.md（7 函数链 / 三路错误回读 / 各平台现状）与 PUBLISH-SPEC.md（JSON 驱动、XPath 四级锚点、能力块六步协议）。
- 锚点集：`publish-config/taobao.json`（分级 selector、timeouts、regexes，发布时现读）。
- 觅千手 v5.61 平台矩阵与字符偏移坐标：`docs/mqs-publish-platform-matrix.md`。
- 同族旧实现对照：`skills/taobao-publish/SKILL.md`。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。账号凭证由 host 工具从凭证库读取并在浏览器内注入 Cookie，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
