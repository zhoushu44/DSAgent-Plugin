# DSAgent Plugin 需求文档

## 日期：2026-09-21（v2.4 更新）

## 1. 概述

本文档记录 dsagent-plugin 从原项目迁移后的测试需求及后续需求。

本轮（第三轮）以**DSH Web UI 真实对话**为唯一验收口径，覆盖 `skills/` 下全部 **39 个技能**，
累计发现并修复 **65 个问题**（见 FIX-LOG.md）。

### 测试要求

- **完全权限**：测试时 DSH 会话需使用 `danger-full-access`；出现「等待审批 · 允许一次」时应放行，不得跳过
- **正常使用技能和账号**：不能跳过账号和技能完成，必须正常触发技能
- **出现问题就修复**：遇到问题先修复再继续测试；实在修不动的**跳过并记录**
- **多 Agent 并发测试**：同时开多个 DSH 会话并发测试不同技能
- **全部 UI 测试**：通过 DSH Web UI (`http://127.0.0.1:3080`) 真实触发技能，只认 UI 证据
- **不中断**：单个技能失败不阻断整轮测试，转为「跳过 + 记录」

## 2. 测试方法学（第三轮确立，必须遵守）

### 2.1 并发派发流程

1. 在 DSH Web UI 点「新建会话」
2. composer 输入自然语言触发语
3. 点「发送消息」（新建后该按钮初始 disabled，输入后才 enabled）
4. 无需等待完成，立刻新建下一个会话派发下一个技能（**并发**）
5. 回到各会话读结果与用量，判定 PASS / FAIL / SKIP
6. 修复 → 复测 → 记录 TEST-LOG.md

**composer 占位符有两种，正则必须都匹配**（见 FIX-LOG #37）：

```javascript
const COMPOSER = /(?:textbox|textarea) "[^"]*(?:描述你想要构建的内容|发消息或创建任务)[^"]*" \[(e\d+)\]/;
```

### 2.2 ★工作区约定（决定性，见 FIX-LOG #41）

**DSH 会话工作区 = `E:\360MoveData\Users\Administrator\Desktop\测试`**，不是插件目录、也不是项目根。

- 派发任何**带路径**的任务前，必须先把输入文件放进该工作区（建议 `artifacts/`）
- 否则模型看到的是「工作区里真的没有这个文件」，会被误判成技能缺陷
- 判定工具：以 `browser_snapshot` / `document.title` 为准，**不看 `browser_navigate` 的 status**（见 FIX-LOG #40）

### 2.3 验收口径

- **PASS**：会话产出可验证结果（文件落盘 / 明确数据 / 明确结论），且无静默失败
- **SKIP**：执行载体缺失（外部 CLI、MCP、频道未配置），记录原因不修
- **非插件 FAIL**：平台风控、上游反爬、测试输入不合法 → 记录定性，不计入插件缺陷
- **禁止**：以「代码层验证通过」替代 UI 实测；以「静默返回 0 条」冒充成功

### 2.4 已登录账号

| 平台 | shopKey | 状态 |
|------|---------|------|
| 淘宝 | taobao_998780447574 | valid |
| 淘宝 | taobao_2218891961201 | expired |
| 生意参谋 | sycm_1c078c827b38f646fe229f3c13101451 | valid |
| 闲鱼 | xianyu_2216797908875 | valid |
| 小红书 | xiaohongshu_030037ad... | valid |
| 知乎 | zhihu_5db7b2f0... | valid |
| 抖音 | douyin_cdcf4d6d... | valid |
| B站 | bilibili_03977c73... | valid |

## 3. 全部技能测试结论（39 个）

### 3.1 PASS（17 个）

| 技能 ID | 平台 | 关键证据 |
|---------|------|----------|
| pywencai-stock | 通用 | A股涨幅榜真实数据（`ok: true`，`total: 5560`，返回 10 条）；换源重写为东方财富公开接口（FIX-LOG #65），无需登录/API Key |
| a-stock-diagnosis | 通用 | 实时行情 + 60 日走势 + 诊断报告；34.2K / 18 秒 |
| customer-service-reply | 通用 | 3 版话术；90.1K / 21 秒 |
| data-report | 通用 | `手机壳关键词数据分析报告.html` 12.4 KB + 分析脚本；27 调用 / 3 分 42 秒 / 913K tok / 112 tok/s；提权问题已修（#42） |
| docx | office | `保温杯选品建议报告.docx` 14.3 KB，XSD 校验通过 |
| financial-statement-analyzer | 通用 | `data/贵州茅台_2023年报_财务健康度分析报告.md` 18273 B；五家同行对比 + 4 个跟踪关注点；1 轮 64 步 / 4.3M tok / 42 tok/s |
| keyword-assistant | sycm | 985K / 1 分 06 秒 |
| keyword-traffic | 万相台(复用 sycm) | 144K / 30 秒 |
| market-analysis | 淘宝 | 47.1K / 45 秒 |
| market-trend | sycm | HTML 77.8 KB + CSV 68.2 KB；1 轮 11 步 / 123 tok/s |
| pdf | office | `pdf-test-sample-extracted.md` 812 B（pypdf + pdfplumber 双引擎交叉验证）；9 调用 / 48 秒 / 157K tok |
| pptx | office | `保温杯产品介绍.pptx` 110.8 KB + 3 张 PNG |
| smart-compose | 通用 | 34.3K / 19 秒 |
| sycm-customer | sycm | 32.8K / 37 秒 |
| valuation-investment-strategy | 通用 | `白酒行业估值与投资策略分析报告.md` 14759 B + `baijiu_fetch.py`；41 步 / 11 分 55 秒 / 1.3M tok / 46 tok/s |
| xianyu-crawl | 闲鱼 | 245K / 39 秒 |
| xlsx | office | `保温杯竞品价格对比.xlsx` 6.4 KB |

### 3.2 PASS（降级，2 个）

| 技能 ID | 现象 | 处置 |
|---------|------|------|
| industry-competition-moat | 缺联网搜索密钥（`DEEPSEEK_API_KEY`），仍产出报告 | 降级 PASS，记录环境缺失 |
| zhihu-crawl | 技能仅含 `SKILL.md`（instructions 型），无脚本 | 降级 PASS，模型按正文给操作指引 |

### 3.3 PASS（受限：上游数据可用性受限，1 个）

| 技能 ID | 技能本体结论 | 受限原因（上游/平台侧） |
|---------|-------------|------------------------|
| store-patrol-manager | ✅ 跑通并交付：`巡店报告_tb998780447574_2026-09-14至2026-09-20.html`（14785 B）+ `patrol_evidence/facts/validation.json`；`valid: true`；1 轮 116 步 · 44 tok/s · 9.5M tok · 缓存命中 97% | 仅客户域接口可用（`/domain/oneQuery.json`、`/domain/multiQuery.json`）；本店自有数据仅 09-17 / 09-20 返回，其余日期只有同行同层基准；推广层（alimama）需 csrf 且 `checkAccess` 未实现；行业页 `getPageInfo.json` 返回 `[深度超限]` 截断。另修组合命令沙箱管道缺陷（FIX-LOG **#43**） |

> 「受限」指**上游数据可得性**受限，非插件/技能缺陷：技能已按要求产出报告，并在报告中显式标注未覆盖层与缺数日期。

### 3.4 修复后仍受上游限制（1 个）

| 技能 ID | 现象 | 处置 |
|---------|------|------|
| xiaohongshu-crawl | 接口契约 bug 已修（GET 404 → POST 200），仍返回 `code=-104`（账号无权限）；该接口需 `x-s` / `x-t` 签名头，原项目亦无此实现 | 标记已知限制；技能已能正确报错，不再静默返回 0 条（FIX-LOG #38） |

### 3.5 非插件 FAIL（4 个）

| 技能 ID | 定性 |
|---------|------|
| competitor-indicator | 测试输入的商品 ID 非本店商品 |
| competitor-strategy-comparison | 同上 |
| product-wdj | 淘宝风控 `FAIL_SYS_USER_VALIDATE` / `RGV587_ERROR` |
| product-reviews | 淘宝风控 |

### 3.6 上游 FAIL（0 个）

原 1 个（`pywencai-stock`，iwencai 反爬 HTTP 403）已通过**换源重写**解决：改用东方财富免费公开接口，
技能名与调用方式不变，实测返回真实数据（FIX-LOG **#65**），已并入 §3.1 PASS。

### 3.7 长任务（2 个，均已跑完并计入 §3.1 PASS）

| 技能 ID | 状态 |
|---------|------|
| valuation-investment-strategy | ✅ **PASS**：产出 `白酒行业估值与投资策略分析报告.md`（14759 B）+ `baijiu_fetch.py`；1 轮 41 步 · 11 分 55 秒 · 1.3M tok · 46 tok/s · 缓存命中 90%；接通东方财富 `RPT_VALUEANALYSIS_DET` 取 PE_TTM 序列，并显式标注「不用 DCF」 |
| financial-statement-analyzer | ✅ **PASS**：产出 `data/贵州茅台_2023年报_财务健康度分析报告.md`（18273 B）；1 轮 64 步 · 42 tok/s · 4.3M tok · 缓存命中 95%；五家同行对比（茅台毛利率/净利率/负债率全面占优，ROE 低于汾酒 43.1% 系沉淀巨额现金所致）+ 4 个跟踪关注点（合同负债 −8.7%、低收益金融资产拖累 ROE、CCC≈1333 天存货风险、关联交易结构性依赖） |

> 两个长任务均已完成，结论已并入 §3.1「PASS（17 个）」，本节仅保留长任务专属证据（耗时 / token / 缓存命中）。

### 3.8 SKIP：执行载体缺失（6 个）

| 技能 ID | 缺失载体 |
|---------|----------|
| channel_message | `dsagent` CLI |
| cron | `dsagent cron` CLI |
| dws | `dws` CLI / `dws_command` 工具 |
| dingtalk_channel | 钉钉频道未连接 |
| chat_with_agent | 宿主未注册 `list_agents` / `chat_with_agent` |
| industry-data-mcp | 外部「参谋长」行业库 MCP 未订购（无地址/凭证） |

### 3.9 不纳入 UI 测试（8 个）

DSH 宿主自带或连接器 / meta 类：`file_reader`、`make_plan`、`make-skill`、`skill-creator`、
`multi_agent_collaboration`、`browser_cdp`、`browser_visible`、`platform_bindings`。

> **说明**：原需求中的 `douyin-crawl` / `bilibili-crawl` 在 `skills/` 下**不存在对应技能目录**
> （原项目亦未提供采集实现）；抖音、B站的**账号登录**已支持并通过绑定校验。

### 3.10 覆盖核对（39/39，全部有最终结论）

| 分节 | 数量 | 技能 |
|------|------|------|
| §3.1 PASS | 17 | a-stock-diagnosis、customer-service-reply、data-report、docx、financial-statement-analyzer、keyword-assistant、keyword-traffic、market-analysis、market-trend、pdf、pptx、**pywencai-stock**、smart-compose、sycm-customer、valuation-investment-strategy、xianyu-crawl、xlsx |
| §3.2 PASS（降级） | 2 | industry-competition-moat、zhihu-crawl |
| §3.3 PASS（受限） | 1 | store-patrol-manager |
| §3.4 上游限制 | 1 | xiaohongshu-crawl |
| §3.5 非插件 FAIL | 4 | competitor-indicator、competitor-strategy-comparison、product-wdj、product-reviews |
| §3.6 上游 FAIL | 0 | 无（原 pywencai-stock 已换源修复，见 FIX-LOG #65） |
| §3.8 SKIP（载体缺失） | 6 | channel_message、cron、dws、dingtalk_channel、chat_with_agent、industry-data-mcp |
| §3.9 不纳入 UI 测试 | 8 | file_reader、make_plan、make-skill、skill-creator、multi_agent_collaboration、browser_cdp、browser_visible、platform_bindings |
| **合计** | **39** | 与 `skills/` 目录实测清单一一对应，无遗漏、无重复 |

> §3.7 的两个长任务（`valuation-investment-strategy`、`financial-statement-analyzer`）**已计入 §3.1 的 17 个**，不重复计数。

## 4. 待解决问题

### 4.1 ~~`data-report` 静态校验触发沙箱提权~~ —— 已修复

**状态：** ✅ 已修复（FIX-LOG **#42**）

**原因：** `scripts/html_report.py --validate-html` 用 `capture_output=True` 捕获 `node --check` 输出，
CPython 在 Windows 上走匿名管道（`CreatePipe`），被 DSH 沙箱（`workspace-write`）拦截 → 每次都停在「等待审批」。

**修复：** 子进程 `stdout` / `stderr` 改为**重定向到临时文件**再读回，不创建管道。
实测 `10/10 项通过`，`js_blocks: 1`（`node --check` 确已执行），全流程**不再需要人工提权**。

> **通用约束**：技能脚本在沙箱内**禁止 `capture_output=True` / `stdout=PIPE` / `stderr=PIPE`**，
> 需要子进程输出时一律重定向到临时文件。

### 4.2 淘宝风控阻断商品类技能

**优先级：中**（节流/冷却部分已实现，仅剩人工验证）

**现状：** `product-reviews` / `product-wdj` 连续拉取时被下发 `_____tmd_____/punish?x5secdata=…` 人机校验页。

**已实现（FIX-LOG #45）：**

| 能力 | 位置 | 参数 |
|------|------|------|
| 账号级节流 | `gateway-proxy.ts` `throttleAccount()` | 4.0s + 0~2.0s 抖动（与原项目 `taobao_client.py` 逐字一致） |
| 风控冷却 | `gateway-proxy.ts` `riskCooldownRemaining()` | 命中 `risk_control` 后该账号 60s 内不再向平台发请求 |
| 错误归因二分 | `gateway-proxy.ts` `tokenRefreshed` | `FAIL_SYS_TOKEN_EXOIRED` → 有下发新 `_m_h5_tk` 记 `rate_limit`（可重试），否则记 `token_expired`（需重登） |
| verifyUrl 透出 | `gateway-proxy.ts` | 风控时返回 `_____tmd_____/punish?x5secdata=…` 引导用户验证（FIX-LOG #36） |

**为什么节流必须放网关而不是技能脚本：** 技能侧 `MtopCaller._last_request_at` 是**实例级**变量，
每次 `dsagent_execute_skill` 都是新的 Python 子进程 → 计时器归零、首请求立即发出；
并发 N 个技能各自按 4~6s 节流却互不知情，同一账号实际出口频率 ≈ N × 1/5s。
网关是唯一能看见「同一账号全部请求」的地方。

**剩余（需人工/后续）：** 账号被 `RGV587_ERROR::SM` 标记后需用户在浏览器打开 verifyUrl 完成滑块；
`verifyUrl` 完成后的**自动重试**仍未实现。

**测试夹具约束（FIX-LOG #46）：** 必须使用 SKILL.md 登记的示例 ID
（`product-reviews` → `614498626290`、`product-wdj` → `762128994852`），
禁用来历不明的 id（`736445442290` 实测已失效，返回 `pc-static-redirect`）。

### 4.3 小红书搜索受签名限制

**优先级：低**

**现状：** 接口需 `x-s` / `x-t`（jsvmp 加密）签名头，原项目无实现。

**需求：** 若需该数据，须补签名算法或改走有权限账号。

### 4.4 ~~pywencai 上游反爬~~ —— 已解决（换源重写）

**状态：** ✅ 已解决（FIX-LOG **#65**）

**原因：** `pywencai` 库依赖的 `iwencai.com/customized/chart/get-robot-data` 被上游**无条件 403**
（openresty），与库版本、本地环境无关（`pywencai` 0.13.1 已是最新）。
叠加技能自身缺陷：原 `SKILL.md` 正文无脚本调用行 → 判定为 `INSTRUCTION_ONLY`，脚本从未被执行。

**修复：** 保留技能名 `pywencai-stock`（不改目录名/id、调用方式不变），
`scripts/search.py` 全量重写为东方财富免费公开接口（14 个子命令），
`SKILL.md` 重写并补齐 `{baseDir}/scripts/search.py` 用法行，同时匹配真机与 harness 两套正则。
实测「今日涨幅前10」返回沪深A股涨幅榜真实数据（`ok: true`，`total: 5560`）。

### 4.5 industry-data-mcp 需外部行业库 MCP（已定案：上游未订购）

**优先级：低（非插件缺陷，不阻塞其余 39 个技能）**

**现状：** 依赖外部「参谋长」行业库 MCP，该服务需在**官网订购**后才由服务方下发地址与凭证。
本机、原项目均无此配置，**无可迁移的接线代码**。

**技能侧特征：**

- 目录内**零本地脚本**——只有 `SKILL.md` + `templates/report_template.html` + `pyproject.toml`，
  因此没有「MCP 连不上就降级本地跑」的退路
- `skill.json` 里 `requirements: { require_bins: [], require_envs: [] }` —— **不声明任何依赖**，
  等于把「MCP 未接线」这件事完全隐藏，调用时才会暴露
- 引用 6 个 MCP 工具：`list_my_categories`、`list_my_subcategories`、`latest_data_date`、
  `qiwrok_category_stats`、`qiwrok_hot_words`、`qiwrok_list`

**原项目侧证据（2026-09-22 挖取，结论：原项目同样未接线）：**

| 证据 | 位置 | 结论 |
|------|------|------|
| 运行时 MCP 注册表为空 | `~/.QIWork/users/<uid>/config.json:106-108` → `"mcp": { "clients": {} }` | 全局配置零 MCP client |
| 每个 agent 的 MCP 注册表同样为空 | `~/.QIWork/users/<uid>/workspaces/default/agent.json:111-113` → `"mcp": { "clients": {} }` | agent 级亦零 MCP client |
| 网关日志只有空查询 | `~/.QIWork/desktop.log` 全部 `mcp` 命中 = 3 组 `OPTIONS/GET /api/mcp → 200` | **从未 POST 注册过任何 server** |
| 机器齐备但插头空着 | `resources/binaries/qiwork/_internal/` 含 `mcp-1.27.2.dist-info`、`fastmcp-3.3.1.dist-info`、`agentscope_runtime`；ReMe 启动配置 `"mcp_servers": {}`、`"mcp": {"transport":"stdio","port":8001}` | 有插座无电器 |
| 打包产物无自建 MCP 代码 | `app.asar`（567MB）grep `mcp` 仅 5 处，全是 `@agentscope-ai/design\|icons` 图标；`dist-electron/main.cjs` grep `mcp` **零命中** | 主进程只 spawn `qiworkconnect`（账号连接器）+ `qiwork`（网关）两个 sidecar |
| 技能来自官网市场 | `skill.json:878-883` → `installed_from: "llmplat"`、`catalog_slug: "industry-data-mcp"`、`catalog_description: "官网订购MCP后使用该技能分析行业数据产出报告"` | 厂家自述需先订购 |

**唯一可复用的挂载格式**（来自原项目 `docs/migration-to-harness.md` §4.1，
落点为 DSH profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: mcp-<name>
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: <name>
        transport: stdio              # 或 streamable-http
        command: python
        args: ['-m', '<module>']
        failOnStartupError: false
```

工具命名规则：`mcp__<serverName>__<rawName>`（如 `mcp__dsagent__get_platform_bindings`）。

**⚠️ 接入时的必做副作用：** `mcp-client` 会强制加 `mcp__<serverName>__` 前缀，与 SKILL.md 正文里的
裸名 `qiwrok_*` 不符 → 必须同步改两份副本共 9 处（`skills/industry-data-mcp/SKILL.md` L20/21/22/63/93/107/122/132/215
+ `app/assets/skills/industry-data-mcp/SKILL.md`）。

**⚠️ 红线：** `Over MCP, the model chooses whether to call your tool.` —— 走 MCP 只能「提供能力」，
不能强制「必须先查绑定态再干活」，此类强制约束必须留在 TS 插件侧。

**需求：** 用户在官网订购「参谋长」行业库并取得 MCP 地址 + Token 后，按上表接线并重测；
在此之前标记为**上游阻塞**，不视为插件缺陷。

## 5. 已修复问题汇总

共 **44** 个问题已修复，详见 [FIX-LOG.md](./FIX-LOG.md)。

| 编号 | 问题 | 文件 |
|------|------|------|
| 1 | MTOP data 参数传递方式错误 | gateway-proxy.ts |
| 2 | WorkspaceCache 缺失方法 | workspace_cache.py |
| 3 | MTOP API 缺少必需参数 | gateway-proxy.ts |
| 4 | 网关选中 expired 账号 | gateway-proxy.ts |
| 5 | MTOP sign 签名缺失 | gateway-proxy.ts |
| 6 | _tb_token_ 注入位置错误 | gateway-proxy.ts |
| 7 | 风控响应覆盖有效 Cookie | gateway-proxy.ts |
| 8 | JSONP 回调正则不兼容前导空格 | gateway-proxy.ts |
| 9 | dsagent_runtime 相对导入失败 | dsagent_runtime.py + 技能脚本 |
| 10 | http_post 不支持 form-urlencoded | gateway-proxy.ts |
| 11 | FAIL_SYS_ILLEGAL_ACCESS 阻断 Set-Cookie | gateway-proxy.ts |
| 12 | 网关账号匹配优先级错误 | gateway-proxy.ts |
| 13 | platform_client 不支持 inject_token | platform_client.py |
| 14 | page.cookies() 未指定域名导致跨域 Cookie 漏取 | browser-login.ts |
| 15 | 闲鱼登录 URL 错误 | index.ts + account-service.ts |
| 16 | SSO 登录未调用 refreshXianyuCookies | index.ts |
| 17 | 知乎 z_c0 Cookie 特殊字符导致 shop_key 不合法 | credential-store.ts |
| 18 | DSH Symbol 身份不匹配导致 scheduler 返回 undefined | dsh-agent-loop (getScheduler 三层 fallback) |
| 19-33 | 其余迁移期修复（账户页 / 技能页 / 网关 / 凭证库） | 见 FIX-LOG.md |
| **34** | idle 看门狗只把 stdout 算心跳 → 误杀「进度走 stderr」的长任务技能 | skill-service.ts |
| **35** | `resolvePython()` 只探「命令存在」不探「依赖齐备」→ 落到零依赖的 Python 3.13 | skill-service.ts |
| **36** | 风控 `error_message` 退化为「平台返回 HTTP 200」→ 拿不到可操作线索 | gateway-proxy.ts |
| **37** | 测试脚本侧：DSH UI composer 占位符正则漏配（新会话 placeholder 不同） | 测试脚本 |
| **38** | 小红书搜索脚本 GET 调 POST-only 接口 → 404 空体被静默当成 0 条 | skills/xiaohongshu-crawl/scripts/search_notes.py |
| **39** | 定性结论：`pdf` / `zhihu-crawl` / `dws` / `cron` / `channel_message` / `chat_with_agent` 属 instructions 型或外部 CLI 依赖型 | 非插件缺陷 |
| **40** | 测试脚本侧：`browser_navigate` 的 status 不可靠 | 测试脚本 |
| **41** | 测试方法纠偏：DSH 会话工作区 ≠ 插件目录（`Desktop\测试`） | 测试方法 |
| **42** | `data-report` 校验用 `capture_output=True` 走匿名管道 → 受限沙箱每次要求提权 | skills/data-report/scripts/html_report.py |
| **43** | `store-patrol-manager` 组合子命令 `analyze` 内部管道捕获 → 沙箱 `WinError 5`，模型被迫降级为单步（#42 同类第二例） | skills/store-patrol-manager/store_patrol_manager/parse/pipeline.py |
| **44** | 全插件同类缺陷批量清零：`capture_output=True` / `subprocess.PIPE` 遍布 5 个技能（`dws` 29 / `docx` 3 / `pptx` 3 / `xlsx` 3 / `data-report` 1），共 39 文件 / 48 调用点 → 全部改临时文件重定向；`py_compile` 39/39 通过、代码级残留 0 | skills/{dws,docx,pptx,xlsx,data-report}/**/*.py |

## 6. Rule 文件更新

| 文件 | 更新内容 |
|------|----------|
| `dsagent-runtime-spec.md` | 导入方式、inject_token 参数说明、示例代码 |
| `dsagent-account-spec.md` | §7.1 多域名 Cookie 提取、§7.3 闲鱼 SSO 复用、§8.1 网关代理账号匹配优先级、http_post form-urlencoded、FAIL_SYS_ILLEGAL_ACCESS 处理、inject_token 参数、Set-Cookie 合并规则 |
| `dsagent-plugin-ui.md` | 技能卡片显示规范、筛选器规范、分类体系 |
| `dsagent-skill-spec.md` | 技能触发机制、HTML 报告规范、runtime 模块、§9.1 stdout/stderr 分离、**§9.2 沙箱兼容约束（禁用管道捕获子进程）**：含「排查范围须覆盖编排层（pipeline / runner / wrapper / cli 组合子命令）」+ 取证案例 1（#42）/ 案例 2（#43） |
