---
name: 1688-publish-mqs
description: "1688（阿里巴巴）商品上架（觅千手 v5.61 goods_manager 同引擎）：把统一商品 JSON（标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性）经浏览器驱动提交到 1688 卖家工作台商品发布页 work.1688.com，走「选类目 → 填属性 → 填 SKU → 选运费模板 → 提交」五段真实链路。触发：1688 上架、阿里巴巴发布商品、1688 商家后台发布、把商品挂到 1688、用统一商品数据发 1688。排除：1688 选品找货用 ali1688-pick、淘宝用 taobao-publish-mqs、天猫用 tmall-publish-mqs、京东用 jd-publish-mqs、抖音小店用 douyin-publish-mqs、拼多多用 pdd-publish-2。发布为 L2 操作，必须先给用户看预览并获明确同意。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "1688·商品上架（mqs）"
    emoji: "🏭"
    requires: {}
---

# 1688 · 商品上架（mqs 链路）

> **重要：** 发布是**不可撤销的真实操作（L2）**。必须两步走：先拿「发布预览」给用户看，用户**明确同意**后才真正提交。
> 绝不要在一次调用里直接传 `confirm=true`。

## 前置条件

- 已绑定**1688（阿里巴巴）**账号（platform=1688 且 status=valid）。★ 1688 与淘宝同属阿里系 SSO，多数情况下复用淘宝登录态（关键 Cookie `unb` / `cookie2` / `_tb_token_`），但**必须是 1688 卖家（诚信通/实力商家）账号**；纯买家账号会在选类目阶段被挡。
- 主图为本机绝对路径且真实存在，1~5 张，单张 ≤ 3MB（1688 主图要求 1:1、≥ 750×750、白底）。
- 标题必填；字符上限**以页面 `maxlength` 为准**（发布时现读，不写死），超长由模型层按平台规则先截断并记一条 warning（见 `PUBLISH-SPEC.md` §3.8）。
- `specs` ≤ 2 维（如「颜色 × 规格」）；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。
- 1688 是**批发平台**，价格通常需要**阶梯价**（起订量 + 单价）；只传单个 `price` 时按最小起订量 1 件的一档处理，多档阶梯价需在窗口内人工补齐。
- 1688 商品必须有**类目**且命中类目树叶子节点；类目选错则属性表整张错位。
- 同一时间只允许一个 1688 浏览器任务；已有任务进行中时先等它结束。
- 锚点与超时参数外置（分级 selector / timeouts / regexes，发布时现读），改锚点**不需要重启宿主**。

## 何时使用

- 用户说「把这个发到 1688」「1688 上架」「阿里巴巴发布商品」「1688 商家后台发布」→ 用本技能。
- 用户给出一件商品的**统一 JSON**（或可组装成该 JSON 的字段：标题 + 主图 + 规格维度 + SKU 行）要求发到 1688 → 用本技能。
- 用户说「用觅千手那套上架 1688」「mqs 上架 1688」→ 用本技能（同一条 goods_manager 引擎链路）。
- 用户已在 1688 卖家工作台建好草稿，只想让 AI 补齐类目属性 / SKU → 用本技能取预览后按字段补齐。

## 边界

- **不做 1688 选品与找货** → 用 `skills/ali1688-pick/SKILL.md`；**不做找供应商** → 用 `skills/alibaba-source-suppliers/SKILL.md`。
- **不做淘宝 C 店 / 天猫发布** → 用 `skills/taobao-publish-mqs/SKILL.md` 与 `skills/tmall-publish-mqs/SKILL.md`（同引擎，阿里域）。
- **不做京东 / 抖音小店发布** → 用 `skills/jd-publish-mqs/SKILL.md` 与 `skills/douyin-publish-mqs/SKILL.md`。
- **不做拼多多 / 闲鱼发布** → 用 `skills/pdd-publish-2/SKILL.md` 与 `skills/xianyu-publish/SKILL.md`。
- **不做批量 / 定时发布**：当前只支持**单件**商品发布，多件需逐件调用。
- **不生成文案与主图** → 标题与卖点由用户提供（或先用 `skills/smart-compose/SKILL.md` 生成，再回到本技能发布）。
- ★ **品牌一律不自动填**（涉及品牌授权，`ATTR_SKIP_RE` 跳过），留给用户在弹出窗口内人工选择。
- ★ **商品资质、质检报告与部分类目属性**仍需人工补全（平台因类目而异，无法统一自动化）。
- ★ **阶梯价 / 起订量 / 发货时效**属批发专属字段，工具只填一档，其余交人工。

## 输入

工具名 `dsagent_1688_publish_mqs`，入参为单对象 product：

| 参数 | 必需 | 说明 |
|------|------|------|
| `product` | 是 | 统一商品 JSON 字符串：`title` / `images` / `price`（批发单价）/ `stock` / `itemNo`（商家编码/货号）/ `category` / `specs` / `skus` / `attributes` / `detailImages` |
| `confirm` | 否 | **省略或 false → 只返回预览，不产生任何写操作**；`true` → 才真正打开浏览器提交 |
| `account` | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |
| `diagDom` | 否 | DOM 诊断模式（默认 false）。只打开发布页 dump 可见 input/button/file 清单 + 截图后返回，不上传不填表不提交（零风险，绕过 confirm 门禁）。**首次接 1688 时先跑它**，把 `publish-config/1688.json` 里的语义锚点替换成真实选择器 |

product 关键字段规则：

- **不需要传 `channel`**：1688 是独立工具（`dsagent_1688_publish_mqs`），渠道由工具本身决定，不会误发到淘宝。
- `title` 必填；`images` 必填，1~5 张，单张 ≤ 3MB，本机绝对路径且真实存在。
- `price` 为**批发单价**（正数，元）；`stock` 为非负整数。**阶梯价/起订量是批发专属必填**，工具只填一档。
- `specs` ≤ 2 维；`skus` 每行必须覆盖全部维度，缺价格/库存时回落顶层 `price` / `stock`。


## 两种执行方式

| 场景 | 入口 | 说明 |
|------|------|------|
| 对话里单次上架 | host 工具 `dsagent_1688_publish_mqs` | 主路径，交互式，两步确认 |
| **工作流步骤 / 批量编排** | 脚本 `{baseDir}/scripts/publish.py` | 脚本型外壳，让上架能作为工作流步骤被执行 |

```bash
python3 {baseDir}/scripts/publish.py --product-file ./product.json                  # 只出预览
python3 {baseDir}/scripts/publish.py --product-file ./product.json --confirm true   # 真正提交
```

入参是「一个 product JSON」（标题 / 主图 / 详情图 / 规格维度 / SKU 行 / 类目属性），
与本技能 host 工具同构。脚本只把请求转给 host 的 `publish_platform` action，
真实实现仍是 puppeteer 引擎（分发逻辑见 `src/platform-publish.ts`）。
**L2 门禁完全保留**：不带 `--confirm true` 只返回预览、不启动浏览器、不产生任何写操作。

> 为什么需要这个外壳：本技能原本是纯指令型（无脚本入口），工作流引擎六项校验的
> 第二项会拒绝它当步骤（「是纯指令型（无可执行入口），不能作为步骤」）。

## 工作流

### 1. 组装统一商品 JSON

从用户话里提取字段；`title` 与 `images` 是必需项，缺了就主动问。规格最多 2 维（如「颜色 × 规格」），SKU 行必须覆盖全部维度。

### 2. 先取「发布预览」（不带 confirm）

调用 `dsagent_1688_publish_mqs`，**只传 product，不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：ok=false + needConfirm=true，以及账号、标题、批发单价、库存、货号、主图清单、规格维度、SKU 组合、显式属性。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现给用户，并明确问一句「确认要发布到 1688 吗？」。同时**必须提醒**：品牌、商品资质、阶梯价与部分类目属性不会被自动填写，稍后需在弹出的浏览器窗口内人工补全。

**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，按 `publish-config/1688.json` 的 flow 依次执行：注入 1688 登录态（`.1688.com` + `.taobao.com` 双域）→ openEntry（1688 商品发布页 offer-new.1688.com/&lt;unit&gt;/publish.htm）→ selectCategory（类目搜索框 → 回车 → 按与标题相关性挑候选 → 点「确认，下一步」）→ waitFor 表单就绪 → fillTitle/price/stock/itemNo（maxlength 从 DOM 现读）→ uploadMainImages（直投 file input，落空则真实点上传区等 fileChooser）→ fillSku（销售属性值逐值键入 + **Tab 提交** → SKU 表回填价格/库存/编码）→ fillAttributes（品牌跳过）→ fillFreight（运费模板是隐藏必填）→ submit → readSubmitErrors（toast + 字段红字两路回读）。

**任一步锚点没命中都不会假成功**：该步记入 `missed`，窗口留给用户人工补全，最后如实报告「哪些字段没自动填」。


### 5. 报告结果

- 成功：告知已提交、商品 ID（若页面返回），并说明**平台仍会审核**，最终状态以 1688 卖家工作台「商品管理」为准；同时列出**未自动填写的字段**（尤其阶梯价与起订量）。
- ok=false 且 needConfirm=true：这是预览，回到第 3 步征求用户同意。
- ok=false 且带 `failureKind`：按下方「错误处理」走。

## 平台硬规则（工具已内化，回答用户时可引用）

| 规则 | 说明 |
|------|------|
| 类目决定一切 | 1688 销售属性 ID 与属性表都由**类目**决定，类目选错则属性与 SKU 全错，故类目永远排在属性之前 |
| 登录态属阿里系 SSO | 1688 与淘宝共用 `unb` / `cookie2` / `_tb_token_`，但需 1688 卖家资质；缺登录态 → failureKind=token_expired |
| 规格值必须逐值键入 + Tab | 1688 销售属性是受控输入，只有「键入后按 Tab」才能提交进 state，直接赋 value 无效 |
| 品牌必填且需授权 | 一律 `ATTR_SKIP_RE` 跳过，由用户在窗口内人工选择 |
| 运费模板是隐藏必填 | 选完发货方式后必须再选一个运费模板，否则提交被拦 |
| 阶梯价是批发专属必填 | 起订量 + 单价多档，工具只填一档，其余交人工；不填阶梯价常导致提交被拦 |
| 类目规则从 DOM 读 | `maxlength` / `.required` / 红色校验文案都在页面里，不查文档 |
| 主图必须真实鼠标点击 | 主图区的 untrusted click 会被页面忽略，必须用真实坐标点击 |

## 平台差异（1688 vs 淘宝 / 京东）

| 维度 | 1688 | 说明 |
|------|------|------|
| 发布域 | work.1688.com（卖家工作台） | 与淘宝 item.upload.taobao.com、天猫 sell.publish.tmall.com 不同域；同一引擎按 `channel` 切域 |
| 登录态 | 阿里系 SSO（多数复用淘宝登录态） | 但必须 1688 卖家资质；有登录态无卖家资质 → api_error |
| 类目选择 | 关键词搜索 + 选叶子候选 | 与淘宝一致（搜索框 → 候选 → 等提交按钮可用） |
| 价格模型 | **批发阶梯价**（起订量 + 单价） | 淘宝/京东是一口价；拼多多是拼单价 + 单买价（自动 +1） |
| 起订量 | 批发专属必填 | 工具只填一档，其余交人工 |

> 上表依据共享规范 `PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定 1688 账号 | not_bound | 引导用户到「账号连接」页面添加**1688（阿里巴巴）**账号（阿里系 SSO，登录淘宝后多数可直接用，但需卖家资质） |
| 有阿里系登录态但无 1688 卖家资质 | api_error | 说明 1688 发布需诚信通/实力商家资质，引导换账号或先去 1688 开通卖家 |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 发布页未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录 1688 / 淘宝** |
| 命中滑块 / 安全验证 | risk_control | 调用 `dsagent_risk_verify`（platform=1688，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| product 非法 JSON / 缺 title 或 images / 图片超 3MB 或超 5 张 | api_error | 按返回文案修正 product 后重试（校验在浏览器启动**之前**完成，不产生写操作） |
| 忘传 channel 或误传 taobao | api_error | 修正为 `channel=1688` 后重新取预览，不要把预览结果当发布结果 |
| SKU 行未覆盖全部维度 / 规格值重复 / 规格超 2 维 | api_error | 补齐 SKU 行后重试 |
| 提交后提示「请填写阶梯价 / 起订量」 | api_error | 批发专属字段不由工具自动填写，让用户在窗口内补阶梯价与起订量后手动提交 |
| 页面长时间停在「选择类目」 | api_error | 让用户在窗口内选好类目；选完类目才会进入正式表单 |
| 提交后提示类目属性 / 详情未填 | api_error | 类目属性与商品详情不由工具自动填写，让用户补全后手动点提交 |
| 属性值不在下拉候选里 | api_error | 说明该属性当前类目无可选值，让用户人工选择；不要强行写值 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png，1:1 白底） |
| 已有 1688 浏览器任务在进行中 | api_error | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |
| 宿主未注册 dsagent_1688_publish_mqs | api_error | 降级为指令型：按工作流给出人工上架步骤与字段清单，不要假装已提交 |

## 证据与参考

- 共享接入规范：`PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议）。
- 同引擎实现对照：`src/mqs-publish.ts`（锚点集驱动的通用 mqs 链路：选类目 / 主图 / SKU / 属性 / 运费模板 / 两路回读 / DOM 自诊）、`src/taobao-publish.ts`（淘宝天猫专用实测链路，1800+ 行真机补丁）。
- 同族技能对照：`skills/taobao-publish-mqs/SKILL.md`（渠道默认 taobao）、`skills/tmall-publish-mqs/SKILL.md`（渠道 tmall）、`skills/jd-publish-mqs/SKILL.md`（渠道 jd）。
- 选品 / 找货对照（★ 别混用）：`skills/ali1688-pick/SKILL.md`、`skills/alibaba-source-suppliers/SKILL.md`。
- 锚点集：`publish-config/1688.json`（分级 selector、timeouts、regexes，发布时现读；改锚点不需重启宿主）。
- 验收门禁：`dev/verify-mqs-skills.mjs`（frontmatter / 章节槽位 / L2 门禁 / 悬空路径一次校验）。
- 1688 主图与素材规范（尺寸、单图体积、禁用语）：`skills/image-prompt-guide/references/platform-specs-china.md`。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。账号凭证由 host 工具从凭证库读取并在浏览器内注入 Cookie，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
