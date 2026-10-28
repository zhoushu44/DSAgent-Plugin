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
- ★ **品牌默认不自动填**（涉及品牌授权，`ATTR_SKIP_RE` 跳过）。但用户**显式传 `brand`** 时除外——那是对自己品牌的声明，会被填入（仍只在页面真实候选里命中，不编造）。
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
| `attributes` | 否 | 显式属性 name→value（命中页面下拉选项才生效） |
| `brand` | 否 | **品牌**（详见下方「类目属性」节）。部分类目把「品牌」列为必填属性（如手机支架/手机配件），不填会永远卡在「重要属性 0/N」发不出去。传了会按「键入 → 从页面真实候选中选中」填入（只在候选里命中才填，不编造） |
| `model` | 否 | 型号。部分类目在选类目页把「型号」列为必填属性，不填则无法进入表单 |
| `directPublishUrl` | 否 | **已知类目 ID 时直达发布页**，形如 `https://item.upload.taobao.com/sell/v2/publish.htm?catId=150708`。跳过「选类目」页（原因见下方「类目属性」节）。批量发布同类目建议先跑一次拿到 catId，之后都用本参数 |
| `replayMode` | 否 | **觅千手式「Json/Json2 劫持重放」模式**（默认 false）。`true` 时进入发布页前注入劫持脚本：框架把表单 state 赋给 `window.Json/Json2` 的瞬间，把本地组装的商品数据原地 merge 进表单（一次门禁），命中则跳过 DOM 逐格填写，未命中自动降级回 DOM 填写。机制溯源见 `SOURCE.md`。★ 传了 `imageSpaceUpload`（默认开）并上传成功时会**自动启用**，无需手动传 |
| `imageSpaceUpload` | 否 | **逆向 HTTP 图片空间预上传**（默认 **true**）。本地主图/详情图先用图片空间接口（`stream-upload.taobao.com/api/upload.api`，纯 HTTP multipart，无 mtop 签名、无浏览器）传成 `img.alicdn.com` URL，再随 Json 劫持重放注入表单 —— 与觅千手 v5.61「预上传」同链路，主图与详情图都不再走页面文件控件。任一批整体失败自动回退原 DOM 上传。传 `false` 走旧的 DOM 文件上传 |
| `imageSpaceFolderId` | 否 | 图片空间目录 id（默认 `0` = 全部图片根目录）。想把素材归进自定义目录时传该目录 id |
| `imageSpaceConcurrency` | 否 | 图片空间上传并发（字符串数字，默认 3，上限 6）。并发过高易触发账号级限流 |
| `confirm` | 否 | **省略或 false → 只返回预览，不产生任何写操作**；`true` → 才真正打开浏览器提交 |
| `account` | 否 | 指定账号 shopKey；仅在返回 need_account_choice 时回传用户选定的值 |


## 两种执行方式

| 场景 | 入口 | 说明 |
|------|------|------|
| 对话里单次上架 | host 工具 `dsagent_taobao_publish_mqs` | 主路径，交互式，两步确认 |
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

从用户话里提取字段；`title` 与 `images` 是必需项，缺了就主动问。规格最多 2 维（如「颜色分类 × 尺码」），SKU 行必须覆盖全部维度。

### 2. 先取「发布预览」（不带 confirm）

调用 `dsagent_taobao_publish`，**只传业务参数，不要传 confirm**。工具此时**不会启动浏览器、不产生任何写操作**，只返回预览：账号、标题、一口价、库存、货号、主图清单、规格维度、SKU 组合、显式属性。

### 3. 把预览完整展示给用户并征求明确同意

把预览原样呈现给用户，并明确问一句「确认要发布吗？」。同时**必须提醒**：品牌、商品资质与部分类目属性不会被自动填写，稍后需在弹出的浏览器窗口内人工补全。

**这一步不可跳过、不可自行假设用户同意**（L2 风险门禁）。

### 4. 用户同意后带 confirm=true 重新调用

工具会弹出可见浏览器窗口，按 `publish-config/taobao.json` 的 flow 依次执行：
openEntry（类目搜索页）→ selectCategory → waitFor 表单就绪 → fillTitle → uploadMainImages → fillSku → fillAttributes → uploadDetailImages → submit。

### 4.5（可选）replayMode：觅千手式 Json/Json2 劫持重放

默认链路是 DOM 逐格填写（上节）。传 `replayMode=true` 则启用**觅千手 v5.61 同款**「Json/Json2 setter 劫持重放」：

- **机制**：进入发布页前注入劫持脚本，`Object.defineProperty(window,"Json"/"Json2",{get,set})` 劫持 setter；框架把表单 state 赋给 `window.Json` 的瞬间，把本地组装的商品数据（`{models:{formValues},components}` 文档结构）**原地 merge 进框架自己的 state**——框架随后渲染出的就是已填好的表单。
- **门禁**：只在 `item.upload.taobao.com/sell` 发布页生效；单次 merge 后置 `kdds_taobao_sku_hook_done=true` 防重复。
- **merge 字段**：title/price/quantity/outerId/sku/saleProp/customSaleProp/mainImagesGroup/images/desc 等 20 项；保护字段（auctionPoint/stuffStatus/sevenDaySupport 等）官方已有值不覆盖。
- **降级**：命中后跳过 DOM 逐格填写（仅保留类目属性/运费模板兜底）；未命中（框架没走 Json 赋值）自动降级回 DOM 填写链路，两种模式可无缝切换。
- **溯源**：完整机制 / 门禁链 / 字段集见同目录 `SOURCE.md`。

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
| **进入路径决定属性区能否渲染** | 从「选类目页 → 确认下一步」进发布页 → 属性区是**空壳**（`struct-p-*` 有 28 个但 label 0 个），必填属性读不到也填不上；从 `?catId=XXXX` **直达**则属性区完整渲染。已知 catId 就用 `directPublishUrl` |
| **成功判定认 URL，不认文案** | 淘宝发布成功的落地页是 `sell/v2/success.htm?primaryId=<商品ID>&catId=...`，该页**既无 `#success-container`、正文也无「发布成功」字样**，且残留校验提示会被当成拦因。URL 命中 `success.htm` 即判成功 |

## 类目属性（2026-10-28 重写，依据真机实测）

淘宝类目属性是发布链路上最容易整单失败的一环。四条实测结论：

**① 走 `directPublishUrl` 直达，别走选类目页。**
从选类目页「确认下一步」进入时，属性区渲染成空壳（`struct-p-*` 28 个 / `label` 0 个），
必填属性一个都读不到，提交被「重要属性 0/N」硬拦，**连请求都发不出去**。
从 `?catId=XXXX` 直达则属性区正常（`label.required` 正常出现，属性可填）。
批量发布同类目时，先跑一次拿到 catId，之后全部用 `directPublishUrl`。

**② 属性填充优先级（从高到低）：**

1. **显式 `attributes`** —— 用户传了 name→value，在页面真实候选里精确命中才填
2. **类目档案** —— `~/.dsh/publish-profiles/<platform>-cat-<catId>.json` 里上次生效的值，仍在当前候选里就直接复用
3. **宿主模型** —— 只让它从页面真实候选里挑，绝不凭空造值
4. **标题词匹配兜底** —— 标题分词命中候选才填
5. **必填项才允许取首项** —— 不填会卡住提交，两害相权；选填项匹配不到就**留空**

**③ 「盲选第一项」已废止。**
拼多多侧 2026-10-20 真机教训：模型不可用时盲选首项，填出「下装长=短款（商品是长裤）、
适用年龄段=14岁以上（商品110-160cm）、安全等级=A类（实物B类）、领型=挂脖（实物翻领）」——
不是「稍微不准」，而是把商品描述成**另一种东西**；更糟的是盲选值还会写进类目档案，
下次同类目直接复用（污染累积）。
所以现在：标题词命中才填；匹配不到且属性**非必填**就留空（宁可不填，也不写错——
写错 = 虚假描述 / 流量损失）；只有确为必填才取首项，并在结果里标注「建议人工核对」。

**④ 品牌是特例。**
品牌默认跳过（授权风险），但它是**部分类目的唯一必填属性**——手机支架类目必填只有
「品牌 + 适用场景」，跳过品牌就永远 `0/2`。所以用户显式传 `brand` 时应当填入。
品牌在淘宝是 **combobox**（`next-select-auto-complete`），`click` 选项无效，
必须「键入 → 等候选刷新 → 点中匹配项」，且键入要走**原型链原生 value setter**
（直接 `inp.value = x` 会被 React 丢弃）。

**⑤ 多属性类目（童装/女装）的三个额外坑（2026-10-29 实测）。**

| 坑 | 实况 | 工具已内化的处理 |
|---|---|---|
| **属性规模不是 10~20** | 实测叶子类目只有 **4~8 项且全部必填**（儿童睡衣 4 / 连衣裙 6 / 儿童裤子 8） | 不要预期「一堆选填项」；必填不过就发不出去 |
| **「型号」品牌选定后才渲染** | 初始扫描读到 7 项，填完品牌才动态出现第 8 项「型号」 | 属性循环改成**边填边重扫**，新出现的项自动补上 |
| **「材质成分」是行式复合属性** | 有「添加材质成分」按钮，点了**就地增行**（非弹窗），每行一个「请选择材质」下拉；input 是 readOnly | 单独走 `fillMaterialRows`：复用已有空行 → 展开 → **面板搜索过滤** → 点中 → 按容器文本回读（值不在 input.value 里） |

> 颜色/尺码等**销售属性（SKU）维度**目前只部分自动化：尺码弹层（勾选 + 点「确定」）已通，
> 颜色值的候选面板在完整发布链路里偶发不弹出，未闭合。遇此类目提交被拦时，
> 按窗口提示在「销售属性」区手工补齐颜色/尺码即可，其余字段都已自动填好。

## 平台差异（淘宝 C 店 vs 天猫 / 拼多多 / 京东）

| 维度 | 淘宝 C 店 | 说明 |
|------|-----------|------|
| 发布域 | item.upload.taobao.com | 与天猫 sell.publish.tmall.com、京东 wares-jdm.jd.com、1688 work.1688.com 不同域；同一引擎按 `channel` 切域 |
| 登录态 | 与天猫**共用**一套淘宝登录态 | 绑定淘宝后即可发天猫；缺登录态 → token_expired |
| 类目选择 | 关键词搜索 + 选第一个候选（AI 推荐可直进 `ai/category.htm?force=true`） | 与天猫一致；京东 / 1688 走三级级联，抖店与 1688 走叶子候选 |
| 规格提交键 | 键入 + **Tab** | 与天猫 / 抖店一致；拼多多相反（填值后自动展开 SKU 表） |
| 运费模板 | **隐藏必填**（勾选运费后必须再选模板） | 淘宝 / 天猫独有，京东与抖店无此门禁 |
| 属性下拉展开 | 仅元素原生 click 有效，鼠标事件全无效 | 拼多多相反（必须走鼠标事件） |
| 价格模型 | 一口价 | 1688 是批发阶梯价，拼多多是拼单价 + 单买价（自动 +1） |
| 品牌属性 | 部分类目必填，是 **combobox** | 默认 `ATTR_SKIP_RE` 跳过（授权风险）；用户显式传 `brand` 时按「键入 → 选中」填入 |

> 上表依据共享规范 `PUBLISH-MATRIX.md`（7 函数链 / 三路错误回读 / 各平台现状；第八节把「淘宝/天猫」列为同一条完整链路）与 `PUBLISH-SPEC.md`（JSON 驱动、XPath 四级锚点、能力块六步协议），以及锚点集 `publish-config/taobao.json`。

## 错误处理

| 场景 | failureKind | 引导动作 |
|------|-------------|---------|
| 未绑定淘宝账号 | not_bound | 引导用户到「账号连接」页面添加**淘宝**账号（登录淘宝后天猫即可用） |
| 平台有多个可用账号且当前会话未绑定 | need_account_choice | **把候选列表给用户选**，把选定的 shopKey 填进 account 重调；★ 绝不要自己挑一个 |
| 发布页未登录 / 登录态失效 | token_expired | 引导用户到「账号连接」页面**重新登录淘宝** |
| 命中 baxia 滑块 / 安全验证 | risk_control | 调用 `dsagent_risk_verify`（platform=taobao，可带返回的 verifyUrl）拉起验证页，用户完成滑块后在窗口内重新提交 |
| 页面长时间停在「选择类目」 | api_error | 让用户在窗口内选好类目；选完类目才会进入正式表单 |
| 提交后提示类目属性未填 | api_error | 按「类目属性」节排查：① 是否走了选类目页（改用 `directPublishUrl`）② 品牌是否必填而未传 `brand` ③ 让用户补全后手动点提交 |
| 主图上传控件未找到 / 上传失败 | api_error | 让用户在窗口内人工上传主图（建议 jpg/png） |
| 属性值不在下拉候选里 | api_error | 说明该属性当前类目无可选值，让用户人工选择；不要强行写值 |
| 提交后未检测到成功标志 | api_error | **先看返回的 finalUrl**：已是 `sell/v2/success.htm?primaryId=xxx` 即**发布已成功**（平台落地页无「发布成功」字样，属已知假阴性）；否则让用户查看窗口内提示，补全必填项后手动提交 |
| 已有淘宝浏览器任务在进行中 | api_error | 提示先等待或关闭已弹出的浏览器窗口 |
| 未找到 Chrome / Edge | api_error | 提示用户安装 Chrome 或 Edge |

## 证据与参考

- 共享接入规范：PUBLISH-MATRIX.md（7 函数链 / 三路错误回读 / 各平台现状）与 PUBLISH-SPEC.md（JSON 驱动、XPath 四级锚点、能力块六步协议）。
- 锚点集：`publish-config/taobao.json`（分级 selector、timeouts、regexes，发布时现读）。
- 觅千手 v5.61 平台矩阵与字符偏移坐标：见 `PUBLISH-MATRIX.md` 第八节「各平台现状对照」。
- 同族旧实现对照：`skills/taobao-publish/SKILL.md`。

## 环境变量

本技能为纯指令型，不执行脚本，无环境变量依赖。账号凭证由 host 工具从凭证库读取并在浏览器内注入 Cookie，日志与返回值均已脱敏，**技能侧不接触 Cookie**。
