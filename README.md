# dsagent-plugin 使用说明

把「账号连接器」+「业务技能」装进 DSH：在界面上连接你在各平台的账号，然后直接在对话里让模型调用技能去采集数据、发布内容、做分析。

- **账号连接页** —— 手动扫码 / 导入 Cookie 连账号，查看登录态，绑定会话
- **技能市场页** —— 浏览、筛选、启用 / 停用技能，带**文档质量分**与缺陷清单
- **34 个工具** —— 注册给模型，覆盖账号查询、技能执行、平台代理、发布、采集、知识库
- **技能质量治理** —— 双语质量门禁、工具触发路由、使用统计、`SKILL.patch.md` 现场修正
- **八域知识库** —— 商家私域知识沉淀（商品/店铺/客户/经营/平台/资产/接待/概念）

---

## 1. 安装方式

DSAgent 支持两种部署方式：

### 方式一：DSH Web（开发/调试）

适用于开发调试或本地快速体验。见下文「前置条件」与「挂载与启动」。

### 方式二：DSH Desktop（生产/日常使用）

**推荐**：DSH Desktop v0.10.0+ 已内置插件市场，支持一键安装。

1. 下载 DSH Desktop：访问官方发布页下载 Windows 安装包
2. 安装并启动 DSH Desktop
3. 打开插件市场（侧边栏 🔌 图标），搜索 `dsagent-plugin`
4. 点击「安装」→ 等待完成 → **重启 DSH Desktop**
5. 重启后侧边栏出现 🔌 图标，即安装成功

> **注意**：市场安装后，DSAgent 的 `skills/` 目录会自动创建在插件数据目录内，无需手动创建。

---

## 2. 前置条件（仅 Web 方式需要）

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | `^22.19` 或 `>=24` | 与 DSH 引擎要求一致 |
| pnpm | 任意较新版本 | 仓库使用 pnpm workspaces |
| Python | 3.10+ | 技能脚本运行时 |
| Chrome / Edge | 本机已安装 | 登录与发布走 `puppeteer-core`，复用本机浏览器，不内置 Chromium |
| `DEEPSEEK_API_KEY` | 必填 | 模型调用；写在仓库根 `.env` |

---

## 3. 挂载与启动（Web 方式）

在 **deepseek-agent 仓库根目录**执行：

```bash
pnpm dsh web --patch ./plugins/dsagent-plugin/cordis.yml
```

启动后打开 DSH Web（默认 `http://127.0.0.1:3080`），左侧边栏出现 **🔌** 图标即挂载成功。

`cordis.yml` 里挂了两项：

| id | 作用 |
|---|---|
| `dsagent-plugin` | 插件本体：2 个页面 + 34 个工具 + 前置校验 + 定时巡检 |
| `dsagent-skills` | 技能发现：`includeDefaultRoots: false` + `customSkillDirs` 指向本项目 `skills/`，与 DSH 自带技能**双向隔离** |

把 `dsagent-plugin` 的 `disabled: true` 即可整套卸载（页面 + 工具），配置项保留，改回 `false` 恢复。

### 换机器 / 换目录必改 3 处

Harness 要求 `name` 必须是**绝对路径**，且本项目**不支持** YAML 里写 `${VAR}` 插值（写了会原样当字符串传下去）。因此 `cordis.yml` 中以下 3 处为硬编码，换环境需手动替换：

1. `dsagent-plugin.name` —— 插件 TS 入口
2. `dsagent-plugin.config.skillRoot` —— 技能根目录
3. `dsagent-skills.config.customSkillDirs` —— 技能发现目录

```yaml
- insert:
    - id: dsagent-plugin
      name: '<绝对路径>/plugins/dsagent-plugin/src/index.ts'
      disabled: false
      config:
        skillRoot: '<绝对路径>/skills'
        storePath: 'C:/Users/<你>/.dsh/dsagent-accounts.json'
        guideOnUnbound: true

    - id: dsagent-skills
      name: '@deepseek-ai/dsh-skill-filesystem'
      disabled: false
      config:
        includeDefaultRoots: false
        customSkillDirs:
          - '<绝对路径>/skills'
        watch: true
```

> **Desktop 用户无需手动配置**：市场安装会自动处理所有路径配置。

---

## 4. 界面使用

点侧边栏 **🔌** 打开 DSAgent 面板，面板有两个页签。

### 3.1 账号连接

**支持的平台**（10 个）：

| 平台 | 授权方式 |
|---|---|
| 淘宝 | 阿里 SSO |
| 抖音 | 官方开放 API / 扫码 |
| 小红书 | Cookie 托管 |
| B站 | Cookie 托管 |
| 快手 | Cookie 托管 |
| 微信公众号 | AppID + Secret / 管理员扫码 |
| 拼多多 | 官方开放 API / 扫码 |
| 拼多多商家后台 | Cookie 托管（商家账号） |
| 微信小店 | 官方开放 API |
| 知乎 | Cookie 托管 |

**添加账号**：点「添加账号」→ 选平台 → 选登录方式 → 完成。可用登录方式按平台提供：

- **扫码登录** —— 拉起浏览器，用对应 App 扫码
- **阿里 SSO 复用** —— 复用已连接的淘宝登录态
- **复用本机 Chrome** —— 读取本机已登录的 Chrome（`cdp`）
- **导入 Cookie** —— 手动粘贴 Cookie 字符串
- **AppID + Secret** —— 公众号 / 微信小店的开发者凭证

**账号列表**每行显示登录态（`有效` / `已失效` / `登录失效` / `待验证`），并提供：

- **检查** —— 实时探测登录态
- **重新登录** —— 刷新该账号登录态（闲鱼报失效时对淘宝账号重新登录即可重新同步）
- **绑定 / 解绑会话** —— 把账号绑定到当前会话（智能体），绑定后本会话自动使用它
- **删除** —— 清除登录态与浏览器 Profile（已采集数据保留）

> **复用淘宝登录态的平台**：生意参谋 / 万相台 / 达摩盘 / 天猫洞察 / 闲鱼 都复用淘宝登录态，账号页**没有**它们的独立登录入口 —— 登录淘宝后自动可用。闲鱼的 goofish 域 Cookie 由淘宝登录成功后自动同步，**不要**去扫码闲鱼 App。

> **拼多多两套登录态**：「拼多多」（买家 H5，采集用）与「拼多多商家后台」（mms.pinduoduo.com，发布用）完全独立，互不通用。

### 3.2 DSAgent 技能

三个页签：**技能市场** / **内置技能** / **已安装技能**，支持两个维度筛选（能力分类 × 平台）：

- 能力分类：文档处理 / 核心基础 / 协作 / 元能力 / 平台连接 / 消息频道 / 垂直业务 / 文案 / 客服 / 图表 / 店铺 / 分析
- 平台：抖音 / 小红书 / B站 / 快手 / 公众号 / 淘宝 / 拼多多 / 闲鱼 / 微信小店 / 知乎 / 通用

每张技能卡带风险等级徽标：

| 等级 | 含义 |
|---|---|
| `L0 只读` | 只取数据，无副作用 |
| `L1 低危` | 轻量写入 |
| `L2 中危` | 有真实副作用（发布 / 上架） |
| `L3 高危` | 资金类操作 |

点「启用 / 停用」会**真实改写该技能 `SKILL.md` 的 `disable-model-invocation`**，Harness 热更新、免重启生效。停用的技能不会出现在模型可见的技能清单里。

---

## 5. 在对话里使用

连好账号、启用技能后，直接在对话里说人话即可，例如：

```
帮我采集抖音上「降噪耳机」的热门视频，导出成表格
```

模型按以下优先级选择调用方式：

1. **有 `contract.json` 的技能** —— 已注册为独立工具（`dsagent_<技能id>`），参数表由契约生成，模型按具名参数直接调用。
2. **无契约的技能** —— 走 `dsagent_execute_skill(id, request, args)`，技能清单与用法由系统提示词提供。

你不需要记工具名，只需要：

- 说清**做什么**、**哪个平台**、**哪个关键词 / 商品 ID / 文件路径**
- 需要参数时给具体值，例如「用 args=`--keyword 手机壳 --page 2`」

### 发布类技能是两步式（重要）

所有发布工具（抖音 / 知乎 / B站 / 小红书 / 闲鱼 / 淘宝 / 拼多多）都是 **L2 真实副作用**，走两步：

1. 先不带 `confirm` 调用 → 返回**发布预览**
2. 模型把预览完整给你看 → 你**明确同意**后 → 才带 `confirm=true` 真正提交

模型不会在一次调用里直接提交。**淘宝发布第一步要选类目**，页面停在「选择类目」属正常；类目属性、商品详情、发货与售后设置**不会自动填**，需要你在弹出的窗口里人工补全后提交。拼多多同理，发货与售后、运费模板、商品资质需人工补全。

### 风控处理

技能返回 `failureKind=risk_control` 时，让模型调用 `dsagent_risk_verify(platform=...)` 拉起验证页，你完成滑块后凭证自动写回账号，然后重试原技能即可。

**例外**：拼多多的滑块风控是**页内内联**的（不是独立验证页），不能用 `dsagent_risk_verify` 处理 —— 发布工具会在已打开的可见窗口内等你手动拖动，超时才报 `risk_control`。

---

## 6. 工具清单（34 个）

### 账号类

| 工具 | 用途 |
|---|---|
| `dsagent_list_accounts` | 列出已连接的平台账号及登录态 |
| `dsagent_check_account_health` | 检查哪些账号需要重新登录 |
| `dsagent_search_accounts` | 按关键词 / token 查找匹配账号 |

### 登录 / 风控类

| 工具 | 用途 |
|---|---|
| `dsagent_browser_login` | 启动浏览器扫码登录 |
| `dsagent_browser_close` | 关闭登录浏览器 |
| `dsagent_risk_verify` | 拉起平台验证页处理风控 |
| `dsagent_save_cookie` | 手动导入 Cookie 字符串 |
| `dsagent_auth_status` | 查询登录 / 风控验证流程的当前进度（不传 operationId 则列出全部进行中的流程） |
| `dsagent_auth_advance` | 推进一个已暂停的登录 / 风控验证流程 |
| `dsagent_auth_cancel` | 取消进行中的流程并关闭其浏览器窗口 |

### 技能类

| 工具 | 用途 |
|---|---|
| `dsagent_list_skills` | 列出插件管理的业务技能 |
| `dsagent_get_skill_detail` | 查看单个技能详情与授权状态 |
| `dsagent_execute_skill` | 执行技能脚本（前置校验 + 报告检测） |
| `dsagent_generate_report` | 基于 AI 洞察 Markdown 生成 HTML 报告 |

### 平台 / 代理 / 对话类

| 工具 | 用途 |
|---|---|
| `dsagent_list_platforms` | 列出支持连接的平台及授权状态 |
| `dsagent_proxy` | 向平台发 HTTP 请求，自动注入 Cookie（`http_get` / `http_post` / `mtop_jsonp`） |
| `dsagent_gateway_cache` | 查看 / 清理网关响应缓存（相同参数的 GET 短时复用，降低风控与节流等待） |
| `dsagent_chat_with_context` | 基于技能执行结果生成自然语言回复 |

### 发布类（L2，两步式）

| 工具 | 用途 |
|---|---|
| `dsagent_douyin_publish` | 发布视频到抖音 |
| `dsagent_zhihu_publish` | 发布文章到知乎专栏 |
| `dsagent_bilibili_publish` | 投稿视频到 B站 |
| `dsagent_xiaohongshu_publish` | 发布笔记到小红书（视频 / 图文） |
| `dsagent_xianyu_publish` | 发布商品到闲鱼 |
| `dsagent_taobao_publish` | 发布商品到淘宝 / 天猫卖家中心 |
| `dsagent_pdd_publish` | 发布商品到拼多多商家后台 |

### 采集类（只读）

| 工具 | 用途 |
|---|---|
| `dsagent_bilibili_download` | 下载 B站 视频 / 番剧 / 合集 |
| `dsagent_pdd_crawl` | 采集拼多多商品数据（`feed` / `search` / `goods`） |
| `dsagent_xianyu_analytics` | 统计闲鱼商品表现（曝光 / 想要 / 收藏） |

> `dsagent_proxy` 是兜底手段：只有当已注册技能都满足不了需求时才用，不要拿它手拼 API（技能已封装签名、分页、数据清洗）。

### 知识库类（八域本体，移植自 Accio）

| 工具 | 用途 |
|---|---|
| `dsagent_wiki_schema` | 查看八域本体 Schema（不传 domain 返回路由表） |
| `dsagent_wiki_template` | 生成页面**锁定模板**（frontmatter 必须经此生成） |
| `dsagent_wiki_write` | 校验并写入页面（校验不过拒绝写入） |
| `dsagent_wiki_search` | 检索 / 读取 Wiki 页面 |
| `dsagent_wiki_stats` | Wiki 概览 + 重建 `INDEX.md` |
| `dsagent_pitfalls` | 查看平台坑位记忆 / 导出可审核草稿（`summary` / `all` / `draft`） |

---

## 6.5 技能质量治理（新增）

吸收自 Accio 的三套机制，详见 [ACCIO-REVERSE-ANALYSIS.md](./ACCIO-REVERSE-ANALYSIS.md)。

### 6.5.1 文档质量门禁

每个技能按 **0.00–1.00** 打分（与 Accio 同量表），市场页显示徽标，详情页列出缺陷：

| 权重 | 检查项 |
|---|---|
| 0.20 | 有「工作流 / Workflow」小节（权重最高：技能的价值在于沉淀可复用路径） |
| 0.15 | 有 `name` / 有 `description` / 正文 ≥200 字符 / 至少一个 `##` 小节 |
| 0.10 | 有「错误处理 / Pitfalls」、有「前置条件 / Preconditions」 |

**槽位匹配是中英双语的** —— `## 工作流` 与 `## Workflow` 等价，
`## 完整 HTML 报告工作流（含分析结论）` 这类描述式标题也能命中。

附加约束：description 长度 72–420 字符（甜区 120–380），
工作流 ≤7 步，Fallback / Pitfalls / Suggestions 各 ≤3 条。

> 实测：56 个技能平均分从 Accio 英文口径的 **0.600** 提升到 **0.807**（Workflow 命中 0→39）。
> 跑一次完整体检：`node dev/audit-skill-quality.mjs skills`

### 6.5.2 工具触发路由（`tool_triggers`）

技能可在 `SKILL.md` frontmatter 里声明「哪个工具 + 什么参数被调用时，提示模型先读我」：

```yaml
tool_triggers:
  - tool: dsagent_execute_skill
    args:
      id: /^product-reviews$/          # 支持 /正则/flags
  - tool: dsagent_product_reviews
  - tool: dsagent_proxy
    args:
      url: /rate\.taobao\.com/
```

解决的是「包了一层工具的技能，其坑位信息在调用前不可见」的问题：
模型调用工具时，插件把「先读该技能」的提示注入返回，逼它先加载 SKILL.md。

插件另带 **2 条内置规则**（无需改技能）：阿里系技能的风控预提示、
`dsagent_risk_verify` 通过后必须重试原技能的提示。

### 6.5.3 使用统计（`.skill-stats.json`）

技能**成功执行**后计数（失败不计，避免「从未成功」的技能看起来被频繁使用）。
市场页可按「待修优先 / 常用优先」排序。

> **本插件绝不自动删除技能**。Accio 会自动淘汰它自己从对话里提炼的副产品，
> 而本项目的技能是人工精编的连接器，误删是用户资产损失。
> 「长期未用」只作为候选列出，删除永远由人决定。

### 6.5.4 `SKILL.patch.md` 现场修正层

技能目录下可放 `SKILL.patch.md`。读取时自动合并到正文之后，并声明「与主文档冲突时以它为准」。

用途：**主文档保持出厂版本，现场修正单独成文件** —— 上游技能升级时不会覆盖你的现场经验。
已在 `product-reviews`（tmall 域修正）与 `product-wdj`（240s 时间预算）落地真实范例。

### 6.5.5 平台坑位记忆（从真实失败中累积）

技能**执行失败**时自动记录一条观测：失败类型、归一化后的错误签名、平台、时间。
同一问题**复现 ≥3 次**才晋升为「已确认坑位」，此后该技能**再次失败**时会随失败信息一并注入：

```
技能执行失败：商品 <ID> 详情接口被拒

---

【历史坑位提示】以下问题在本机真实复现过，请在动手前规避：

- [平台 taobao / risk_control] 已复现 5 次（最近 3 小时前）
  现象：商品 <ID> 详情接口被拒
  处置：调 dsagent_risk_verify(platform=该平台) 过滑块后再重试
  涉及技能：product-reviews

这些是历史统计，不是本次调用已发生的事实 —— 若本次顺利则忽略。
```

**注入位置是刻意的**：只在**失败路径**注入，成功路径不注入。
理由是成功时附一段「这技能历史上老失败」纯属噪声；
而失败当下正是模型需要「这问题第 5 次出现了，标准处置是什么」的时刻 ——
它能把模型从「盲目重试」推向「先走验证流程」。

> 需要「动手前就提醒」的场景由 §6.5.2 的 `tool_triggers` 覆盖 ——
> 两者分工：triggers 管「事先该读哪个文件」，坑位记忆管「事后这是什么问题」。

**为什么是 3 次**：单次失败可能只是网络抖动。误报的坑位会污染提示，比漏报代价更高。

**与 Accio 的关键差异**：Accio 用**另一个 LLM 调用**提炼技能，本插件**只记录机器可验证的事实**
（`failureKind` 来自脚本自报、`count` 来自真实调用次数、`lastSeenAt` 是时间戳，
**没有任何一项来自模型推断**），且**不写入技能目录** —— 需要沉淀时用
`dsagent_pitfalls(mode="draft")` 导出带证据的草稿，由人审核后粘贴到 `SKILL.patch.md`。

**不记录哪些失败**：`not_bound` / `need_account_choice` 属流程引导（由配置决定），
不是需要规避的平台坑，记进去只会污染统计。

两个关键工程细节：

| 细节 | 不处理的后果 |
|---|---|
| **签名归一化**（长数字→`<ID>`、引号值→`<VAL>`、路径→`<PATH>`） | `商品 123456 失败` 与 `商品 789012 失败` 会变成两条独立记录，各自计数永远到不了阈值，**坑位永远无法晋升** |
| **90 天陈旧退出** | 平台会修问题、账号会换；陈旧的坑位继续提示只会造成噪声（记录保留，仅退出提示） |

---

## 6.6 八域知识库（新增）

移植 Accio 的「商家私域知识 Wiki」本体，把分析结论沉淀成可检索的本地知识库。

**八域**：商品 / 店铺 / 客户 / 经营 / 平台 / 资产 / 接待 / **概念**

三条核心原则：

1. **实时数据不入 Wiki** —— 平台能直接导出的价格/库存/当日流量走实时工具；
   Wiki 只存对这些数据的理解、口径与策略。
2. **披露三档** —— 可对外 / 仅内部 / 机密。机密字段（价格底线、成本、客户名单、财务数据）
   不得进入对外回答，字段级声明优先于页级。
3. **概念域独立成域** —— 是各域字段口径的**唯一出处**，避免同一指标在多页面口径漂移。

### 硬约束：frontmatter 必须经脚本生成

> **模型只填值，不得增加、删除、改名或移动任何 key。**

流程：`dsagent_wiki_template` 生成锁定模板 → 模型只替换 `null` →
`dsagent_wiki_write` 校验并渲染。渲染时**递归删除空值**（缺席 ≠ 空值）。

校验器会拦下这些真实高频故障：

| 拦截项 | 说明 |
|---|---|
| Schema 外字段 | 自创字段名（如把「价格底线」写成「底价」）—— 会让按字段检索永久失效 |
| 错误枚举 | 「实体子类型」自创取值；单一形态域（商品/店铺/客户）不得出现该字段 |
| 机密泄露 | 机密字段出现在「可对外」页面 |
| 接待域 L1 | 证据不足的策略不得标「启用」；接待意图必须取受控 8 值且与意图码对应 |
| 空壳页 | 缺「实体识别字段」/「领域字段集」块；`title` 与正文 H1 不一致 |
| 废弃字段 | `页面编号` / `证据次数` / `元字段` 等 Accio 点名要清的脏数据 |

目录结构：`<工作区>/wiki/`，含 `INDEX.md`（自动生成，链接保证可达）、
`PRINCIPLES.md`（披露边界，人工维护）、`log.md`（达标待办，只追加）、
`raw/`（原始素材）与八域的 `entities/` + `concepts/`。

---

## 7. 配置项与环境变量

### 插件配置（`cordis.yml`）

| 配置项 | 必填 | 说明 |
|---|---|---|
| `skillRoot` | 是 | 技能根目录，插件扫描其下每个子目录的 `SKILL.md` |
| `storePath` | 否 | 凭证库 JSON 路径，默认 `~/.dsh/dsagent-accounts.json` |
| `guideOnUnbound` | 否 | 未绑定账号时返回引导文案而非硬报错，默认 `true` |
| `wikiRoot` | 否 | 八域知识库根目录，默认 `<工作区>/wiki` |

> 技能使用统计落在 `storePath` 同级的 `.skill-stats.json`（不放技能目录内，避免被技能扫描当成资源）；
> 平台坑位记忆落在同级的 `.pitfall-memory.json`。

### 运行时环境变量

| 变量 | 用途 | 读取位置 |
|---|---|---|
| `DSAGENT_WORKSPACE` | 工作区目录（技能落盘 / 溢出 payload 落 `artifacts/`），默认 `process.cwd()` | 插件与技能脚本 |
| `DSAGENT_SKILL_ROOT` | 技能根目录（runtime 模块定位用） | 技能脚本 |

### 插件注入给技能脚本的变量（无需手配）

| 变量 | 说明 |
|---|---|
| `DSCONNECT_URL` | 本地网关地址 |
| `DSCONNECT_TOKEN` | 本地占位值 `local`（本地网关不验签） |
| `DSCONNECT_AGENT_ID` | 当前会话 / 智能体 ID |
| `DSCONNECT_SHOP_KEY` | 本次调用选定的账号主键 |
| `DSAGENT_REQUEST` | 用户原话 / 参数描述 |
| `PYTHONIOENCODING` / `PYTHONUTF8` | 固定 `utf-8` / `1` |

> 旧脚本兼容变量 `DSAGENT_COOKIE` / `DSAGENT_PLATFORM` / `DSAGENT_ACCOUNT_ID` / `DSAGENT_TB_TOKEN` 仍会注入，但新脚本一律走 `DSCONNECT_URL` 网关，**不直接拿 Cookie**。

---

## 8. 失败类型与处理

工具返回文本末尾带 `[failureKind] <类型>`，按类型处理：

| failureKind | 含义 | 该怎么办 |
|---|---|---|
| `not_bound` | 平台未绑定 | 到「账号连接」添加账号 |
| `token_expired` | 登录态过期 | 到「账号连接」重新登录 |
| `risk_control` | 被风控拦截 | 调 `dsagent_risk_verify(platform=...)` 过滑块后重试 |
| `rate_limit` | 接口限流 | 稍后重试 |
| `no_permission` | 登录态有效但无该业务 / 类目权限 | **不要重新登录**（重登无用），换有权限的账号 |
| `need_account_choice` | 该平台有多个可用账号，本会话未绑定 | 列出候选让用户选，把 `shopKey` 填进 `account` 参数 |
| `api_error` / `parse_error` / `skill_error` | 执行出错 | 看错误信息，不要盲目重试 |
| `skill_not_found` | 技能 ID 错误 | 用返回的可用技能列表重新选择 |
| `invalid_args` | 参数不合法 | 按返回的「用法」补 `args` 后重调 |

> 静默选错账号会污染所有使用该平台的技能，且症状隐蔽（不报错、只是空数据）—— 遇到 `need_account_choice` 必须先问清楚。

---

## 9. 已知限制

- **淘宝风控强度 L3**：建议使用专用小号登录，避免与日常购物号混用；命中 baxia 滑块需过验证页。
- **拼多多 search / goods 有账号级频控**（常返回 429 `error_code=40002`）：`mode=feed` 稳定可用，命中频控时改用 `feed`，不要反复重试 `search`。
- **部分闲鱼类目网页版不支持发布**：页面会要求「扫码去 APP 发布」，此时只能到闲鱼 App 操作。
- **技能脚本禁止匿名管道**：Windows 下 `capture_output=True` / `stdout=PIPE` / `stderr=PIPE` 会被 DSH 沙箱拦截，脚本一律重定向到临时文件。
- **大数据量结果落盘**：单次工具回传文本上限 32000 字符，超限时完整数据写入工作区 `artifacts/<技能id>_payload_<时间戳>.json`，模型可自行读该文件拿全量数据。
- **页面跳转**：账号页与技能页各自独立，互不跳转。

---

## 10. 目录结构

```
plugins/dsagent-plugin/
├── cordis.yml                    # 挂载清单（绝对路径 + 技能目录隔离）
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  # host 半区：34 工具 + 系统提示词 + 前置校验 + HTTP 路由 + 定时巡检
    ├── client.ts                 # browser 半区：侧边栏按钮 + 面板（两页签）
    ├── gateway-proxy.ts          # 本地代理网关（Cookie 注入 / 风控检测 / failure_kind / 节流）
    ├── browser-login.ts          # 浏览器登录（Profile 隔离 / SSO 刷新 / 风控验证）
    ├── *-publish.ts / *-crawl.ts # 各平台发布与采集实现
    └── services/
        ├── account-service.ts    # 账号取数 + 健康检查
        ├── credential-store.ts   # 凭证库（原子写 / Cookie 不出模块）
        ├── skill-service.ts      # 技能扫描 + SKILL.md 启停改写
        ├── skill-quality.ts      # 质量门禁：双语槽位评分 + frontmatter 解析 + tool_triggers 解析
        ├── tool-triggers.ts      # 工具触发注册表（含内置风控规则 + 会话级去重）
        ├── skill-stats.ts        # 使用统计 + 淘汰评分（只列候选，不自动删除）
        ├── skill-patch.ts        # SKILL.patch.md 现场修正层
        ├── pitfall-memory.ts     # 平台坑位记忆（从真实失败统计，证据≥3 次才提示）
        ├── wiki-schema.ts        # 八域本体 Schema（商品/店铺/客户/经营/平台/资产/接待/概念）
        ├── wiki-frontmatter.ts   # 锁定模板生成 + 校验 + 渲染（模型只填值）
        ├── wiki-store.ts         # 知识库落盘 / 索引 / 日志
        ├── arguments.ts          # 契约加载与工具参数生成
        └── types.ts
```

### 技能 Runtime 模块

技能脚本 `from dsagent_runtime import log, output_result, http_get` 即可获得全部公共函数：

```
skills/.dsagent/runtime/
├── runtime_http.py       # HTTP 底层：环境变量 / 认证头 / 通用 JSON 请求
├── output.py             # stdout/stderr 分离 / 结构化摘要
├── platform_client.py    # 平台请求层：绑定检查 / 代理请求 / 错误类型
├── http_retry.py         # 重试与节流：CallThrottle / 指数退避
└── dsagent_runtime.py    # 统一入口（re-export）
```

### 数据来源优先级

页面与服务层统一遵循：宿主注入（`window.__PLUGIN__.accounts` / `.skills`）→ 网关 REST API（需 `DSCONNECT_TOKEN`）→ 内置回退数据（用于预览，页面不报错）。

### 安全约束

- 插件内**不含任何 cookie / token 字段**，凭证一律留在本地凭证库
- 无出网旁路，平台访问统一走本地网关
- 技能服务只允许在 `skillRoot` 范围内读写，越界抛错
- 浏览器 Profile 隔离：每平台独立 `~/.dsh/browser-profiles/{platform}`，账号级 `.../accounts/{shopKey}`，Cookie 不串扰

---

## 11. 自检

```bash
cd plugins/dsagent-plugin
npm run build        # tsc + node dev/build-client.mjs
npm run typecheck    # tsc --noEmit
```

技能治理与知识库的验证套件（共 246 个用例）：

```bash
node dev/verify-skill-governance.mjs   # 47 项：双语评分 / 解析 / triggers / 统计 / patch
node dev/verify-patch-layer.mjs        # 25 项：patch 参与真实执行链路 / 对外 API
node dev/verify-wiki.mjs               # 68 项：八域 Schema / 锁定模板 / 漂移拦截 / 落盘
node dev/verify-wiki-textpath.mjs      # 25 项：文本路径与模板路径校验一致性（机密字段泄漏回归）
node dev/verify-pitfalls.mjs           # 54 项：签名折叠 / 证据阈值 / 陈旧退出 / 并发安全 / 记录策略
node dev/verify-host-integration.mjs   # 27 项：apply() 注册 34 工具 / 提示词 / 无回归
node dev/audit-skill-quality.mjs skills # 给全体技能做质量体检（可接 CI）
node dev/verify-real-triggers.mjs      # 用真实技能文件验证 triggers 匹配
```

## 12. 规范文档

| 文档 | 说明 |
|---|---|
| [.trae/rules/dsagent-account-spec.md](.trae/rules/dsagent-account-spec.md) | 账号连接规范（凭证库 / 登录 / 健康检查 / 工具输出） |
| [.trae/rules/dsagent-skill-spec.md](.trae/rules/dsagent-skill-spec.md) | 技能编写规范（SKILL.md / 输出规范 / runtime 模块） |
| [.trae/rules/dsagent-plugin-ui.md](.trae/rules/dsagent-plugin-ui.md) | UI 规则（页面职责 / 卡片显示 / 筛选器） |
| [.trae/rules/dsagent-runtime-spec.md](.trae/rules/dsagent-runtime-spec.md) | Runtime 模块 API 文档（函数签名 / 错误类型 / 使用示例） |
