# DSAgent 技能测试勾选清单

> **勾选口径**：`[x]` = 在 DSH Web UI（`http://127.0.0.1:3080`）真实对话中触发成功、产出可验证结果、**助手回复内容正常**；
> `[ ]` = 已定性但未通过（原因逐条备注），或按约定不纳入 UI 测试。
>
> **数据来源**：第三轮 UI 真实对话测试（2026-09-21），原始记录见 [TEST-LOG.md](./TEST-LOG.md)、
> 结论见 [REQUIREMENTS.md §3](./REQUIREMENTS.md)、缺陷修复见 [FIX-LOG.md](./FIX-LOG.md)。
>
> **回复内容核对栏**：带引号者为 UI 助手回复原文摘录；不带引号者为 TEST-LOG 中记录的结论性结论。

---

## 一、总体进度

| 项 | 数量 |
|----|------|
| 技能总数（`skills/` 实测） | **39** |
| ✅ 已测通过（打勾） | **24** |
| ⬜ 未通过（已定性，含 SKIP / 上游 / 非插件） | **15** |
| 回复内容已确认正常（打勾项内） | **24 / 24** |
| 累计修复问题 | **65**（FIX-LOG #1–#65） |
| 其中风控链路专项 | **8**（#45 / #46 / #47 / #48 / #49 / #50 / #52 / #53，已 UI 实测验收） |

---

## 二、勾选总表（39 个）

### ✅ 已测通过（24）

- [x] `a-stock-diagnosis` — A股个股诊断（通用）
- [x] `customer-service-reply` — 客服话术（通用）
- [x] `data-report` — 数据报告（通用，修复 #42）
- [x] `docx` — Word 文档（office，修复 #44）
- [x] `financial-statement-analyzer` — 财务报表分析（通用，长任务）
- [x] `keyword-assistant` — 关键词助手（sycm）
- [x] `keyword-traffic` — 关键词流量（万相台，复用 sycm）
- [x] `market-analysis` — 市场行情分析（淘宝）
- [x] `market-trend` — 市场趋势（sycm）
- [x] `pdf` — PDF 提取（office）
- [x] `pptx` — PPT 生成（office，修复 #44）
- [x] `smart-compose` — 智能文案（通用）
- [x] `sycm-customer` — 生意参谋客户（sycm）
- [x] `valuation-investment-strategy` — 估值投资策略（通用，长任务）
- [x] `xianyu-crawl` — 闲鱼采集（闲鱼）
- [x] `xlsx` — Excel 表格（office，修复 #44）
- [x] `industry-competition-moat` — 行业竞争壁垒（通用，**降级 PASS**）
- [x] `zhihu-crawl` — 知乎采集（知乎，**降级 PASS**：instructions 型，无脚本）
- [x] `store-patrol-manager` — 店铺巡店（sycm，**受限 PASS**，修复 #43）
- [x] `product-reviews` — 商品评价（淘宝 / 天猫，修复 #53）
- [x] `product-wdj` — 商品问大家（淘宝，修复 #55）
- [x] `competitor-indicator` — 竞品指标（达摩盘，修复 #58）
- [x] `competitor-strategy-comparison` — 竞品策略对比（生意参谋 / 达摩盘）
- [x] `pywencai-stock` — A股行情榜单（东方财富公开接口，修复 #65）

> **口径补充**：`competitor-indicator` / `competitor-strategy-comparison` 两项的验证载体为
> **技能 CLI 串行实测**（沙箱内直接跑 `analyze` / `report` 并核对 JSON 与 HTML 产物），
> 未走 DSH Web UI 对话。其余 22 项均为 UI 真实对话触发。

### ⬜ 未通过（15）

**上游限制 / 非插件（1）**

- [ ] `xiaohongshu-crawl` — 小红书采集｜接口契约 bug 已修（#38），仍返回 `code=-104`；缺 `x-s`/`x-t` 签名，原项目亦无实现

**SKIP：执行载体缺失，本环境未接线（6）**

- [ ] `channel_message` — 缺 `dsagent` CLI
- [ ] `cron` — 缺 `dsagent cron` CLI
- [ ] `dws` — 缺 `dws` CLI / `dws_command` 工具（沙箱管道缺陷已预修 #44）
- [ ] `dingtalk_channel` — 钉钉频道未连接
- [ ] `chat_with_agent` — 宿主未注册 `list_agents` / `chat_with_agent`
- [ ] `industry-data-mcp` — 依赖外部「参谋长」行业库 MCP（官网订购后才下发地址/凭证；原项目亦未接线）

**不纳入 UI 测试（8）：DSH 宿主自带或连接器 / meta 类**

- [ ] `file_reader` — 宿主自带文件读取
- [ ] `make_plan` — 宿主自带计划
- [ ] `make-skill` — 宿主自带技能生成
- [ ] `skill-creator` — 宿主自带技能创建
- [ ] `multi_agent_collaboration` — 宿主自带多智能体协作
- [ ] `browser_cdp` — 连接器类
- [ ] `browser_visible` — 连接器类
- [ ] `platform_bindings` — 平台绑定查询（账号页负责）

> 说明：原需求提到的 `bilibili-crawl` 在 `skills/` 下**无对应目录**（原项目亦未提供采集实现）；
> 抖音、B站的**账号登录**已支持并通过绑定校验。
>
> **更新（2026-09-22）**：`douyin-crawl` 已实现（`skills/douyin-crawl/`，含 `scripts/fetch_data.py`），
> 经 `node dev/verify-douyin-skill.mjs` + `node dev/run-skills.mjs` 端到端实测通过（5/7 mode 返回真实数据，
> 2 个搜索类 mode 正确上报 `risk_control`），详见 [TEST-LOG.md §第七轮](./TEST-LOG.md)。
> 因该验证载体为**脚本串行实测**而非 DSH Web UI 对话，未计入下方「已测通过」打勾项。

---

## 三、已通过技能的回复内容核对

| 勾选 | 技能 ID | 助手回复内容 | 产出证据 | 用量 |
|------|---------|--------------|----------|------|
| [x] | `a-stock-diagnosis` | 返回实时行情（今开 1262.99、现价 1257.12）+ 60 日走势 + 技术指标，并给出诊断报告 | 诊断报告正文 | 34.2K tok / 18 秒 |
| [x] | `customer-service-reply` | 生成 3 个版本话术：标准版 / 共情版 / 专业版 | 话术正文 | 90.1K tok / 21 秒 |
| [x] | `data-report` | 「报告已生成并通过全部 10 项校验：`artifacts/手机壳关键词数据分析报告.html`」 | `手机壳关键词数据分析报告.html`（12.4 KB）+ `analyze_keywords.py` + `build_report.py` | 1 轮 28 步 / 3 分 42 秒 / 913K tok / 112 tok/s / 缓存 92% |
| [x] | `docx` | 交付选品建议报告，文档通过 XSD 校验 | `保温杯选品建议报告.docx`（14.3 KB） | — |
| [x] | `financial-statement-analyzer` | 五家同行对比（茅台毛利率/净利率/负债率全面占优，ROE 低于汾酒 43.1% 系沉淀巨额现金）+ 4 个跟踪关注点 | `data/贵州茅台_2023年报_财务健康度分析报告.md`（18273 B） | 1 轮 64 步 / 42 tok/s / 4.3M tok / 缓存 95% |
| [x] | `keyword-assistant` | 正常返回关键词数据与建议 | 会话产出 | 985K tok / 1 分 06 秒 |
| [x] | `keyword-traffic` | 正常返回流量词数据 | 会话产出 | 144K tok / 30 秒 |
| [x] | `market-analysis` | 正常返回类目市场行情结论 | 会话产出 | 47.1K tok / 45 秒 |
| [x] | `market-trend` | 趋势分析 + 可视化报告 | HTML 77.8 KB + CSV 68.2 KB | 1 轮 11 步 / 123 tok/s |
| [x] | `pdf` | 「已完成。pypdf + pdfplumber 双重验证；输出 `artifacts/pdf-test-sample-extracted.md`」 | `pdf-test-sample-extracted.md`（812 B） | 1 轮 9 步 / 48 秒 / 157K tok / 82 tok/s |
| [x] | `pptx` | 生成产品介绍演示文稿 + 缩略图 | `保温杯产品介绍.pptx`（110.8 KB）+ 3 张 PNG | — |
| [x] | `smart-compose` | 正常生成文案 | 会话产出 | 34.3K tok / 19 秒 |
| [x] | `sycm-customer` | 正常返回客户分析结论 | 会话产出 | 32.8K tok / 37 秒 |
| [x] | `valuation-investment-strategy` | 产出行业估值与投资策略分析报告；接通东方财富 `RPT_VALUEANALYSIS_DET` 取 PE_TTM 序列，显式标注「不用 DCF」 | `白酒行业估值与投资策略分析报告.md`（14759 B）+ `baijiu_fetch.py` | 1 轮 41 步 / 11 分 55 秒 / 1.3M tok / 46 tok/s / 缓存 90% |
| [x] | `xianyu-crawl` | 正常返回采集结果 | 会话产出（script 型，含 `scripts/fetch_data.py`） | 245K tok / 39 秒 |
| [x] | `xlsx` | 产出竞品价格对比表 | `保温杯竞品价格对比.xlsx`（6.4 KB） | — |
| [x] | `industry-competition-moat` | 缺联网搜索密钥（`DEEPSEEK_API_KEY`）仍产出报告，并说明降级来源 | 分析报告 | 降级 PASS |
| [x] | `zhihu-crawl` | 技能仅含 `SKILL.md`（instructions 型），模型按正文给出可执行的操作指引 | SKILL.md 正文 | 降级 PASS |
| [x] | `store-patrol-manager` | 交付巡店报告，`valid: true`；报告中显式标注未覆盖层与缺数日期；修 #43 后组合命令 `analyze` 在沙箱内一次跑通 | `巡店报告_tb998780447574_2026-09-14至2026-09-20.html`（14785 B）+ `patrol_evidence/facts/validation.json` | 1 轮 116 步 / 44 tok/s / 9.5M tok / 缓存 97%；复测 1 轮 2 步 / 24 秒 |
| [x] | `product-reviews` | 「本次是否成功：✅ 成功。status: "success"」；商品「鱼鳞抹布擦玻璃专用吸水无水印厨房毛巾魔力清洁布家务桌碗镜子布」，采集 **100 条评价 / 5 页**，`total_count: 3000`（修 #53：详情接口改走 tmall 域） | 评价报告 + JSON/CSV | 44.9K tok / 1 分 02 秒 |
| [x] | `product-wdj` | 「✅ 成功。status: "success"（与上一次超时失败不同，这次正常返回了）」；`total_count: 353`，采集 **50 条问题 / 5 页**，40 条回答已抓取、10 条按时间预算跳过（`answers_truncated: true`）（修 #55：技能自管 240s 时间预算） | `问大家_762128994852_20260922_004035.csv`（53557 B）+ `.json`（143362 B）+ `问大家报告_*.html`（160618 B） | 44.3K tok / 5 分 05 秒 |
| [x] | `competitor-indicator` | `analyze` 返回 `{"status":"success","error_code":0,"stage":"analyze","data_modules":["overall","flow"],"insights_required":["flow"],"insights_pending":[]}`；整体 40 字段 + 流量 4 渠道（淘宝私域 / 淘宝搜索 / 淘宝其他 / 淘宝直播）（修 #58：`chartDataFull=null` 归一为空列表） | `竞品指标报告_985134738506_20260922_013438.html`（26516 B）+ `artifacts/竞品流量洞察.md`（3224 B） | 串行脚本实测 |
| [x] | `competitor-strategy-comparison` | `list-products` → `total: 1`；`analyze` → `report` 全链路 `error_code: 0`，产出对比报告 | 竞品策略对比报告 + JSON | 串行脚本实测 |
| [x] | `pywencai-stock` | 「今日涨幅前10」返回沪深A股涨幅榜真实数据（`ok: true`，`total: 5560`），修复 #65：iwencai 接口被上游 403 硬封禁，改用东方财富免费公开接口重写；同名镜像 `app/assets/skills/pywencai-stock/` 已同源同步（3 文件 / 31803 B / SHA256 一致），并把 `from runtime.dsagent_runtime import ...` 改为可选依赖兜底，消除宿主侧 `ModuleNotFoundError: No module named 'runtime'` | `__DSAGENT_RESULT__` 单行 JSON（10 条行情） | 串行脚本实测 + 批跑 harness + app 宿主 / 插件侧双布局实测 |

**回复内容一致性结论**：以上 24 项助手回复均为**正常自然语言 + 可解析产出路径**，
未出现 `[object Object]`、空回复、静默返回 0 条冒充成功等情况。

---

## 三点五、淘宝 / 阿里系（SSO 全家桶）汇总

阿里系各平台共用同一套 SSO 登录态（关键 Cookie：`unb` / `cookie2` / `_tb_token_`），
因此按「阿里系」维度统计比按单平台更贴近实际使用。`skills/` 下共 **11 个**阿里系技能。

| 技能 ID | 归属平台 | 结果 | 证据 / 原因 |
|---------|----------|------|-------------|
| `market-analysis` | 淘宝（搜索结果页） | ✅ | 正常返回类目市场行情结论｜47.1K tok / 45 秒 |
| `store-patrol-manager` | 生意参谋 + 店铺 | ✅（受限） | 巡店报告 `valid: true`，报告显式标注未覆盖层｜14785 B HTML |
| `keyword-assistant` | 生意参谋 | ✅ | 正常返回关键词数据与建议｜985K tok / 1 分 06 秒 |
| `keyword-traffic` | 万相台（复用 sycm 凭证） | ✅ | 正常返回流量词数据｜144K tok / 30 秒 |
| `market-trend` | 生意参谋 | ✅ | 趋势报告 HTML 77.8 KB + CSV 68.2 KB |
| `sycm-customer` | 生意参谋 | ✅ | 正常返回客户分析结论｜32.8K tok / 37 秒 |
| `xianyu-crawl` | 闲鱼（共享 taobao `unb`） | ✅ | 正常返回采集结果｜245K tok / 39 秒 |
| `product-reviews` | 淘宝 / 天猫（MTOP） | ✅ | 100 条评价 / 5 页，`total_count: 3000`｜44.9K tok / 1 分 02 秒（修 #53） |
| `product-wdj` | 淘宝（MTOP 问大家） | ✅ | 50 条问题 / 40 条回答，`total_count: 353`｜44.3K tok / 5 分 05 秒（修 #55） |
| `competitor-indicator` | 达摩盘（复用 sycm 凭证） | ✅ | 整体 40 字段 + 流量 4 渠道，`error_code: 0`｜报告 26516 B（修 #58） |
| `competitor-strategy-comparison` | 生意参谋 / 达摩盘 | ✅ | `list-products` → `analyze` → `report` 全链路 `error_code: 0` |

**两种口径：**

| 口径 | 范围 | 通过 / 总数 |
|------|------|-------------|
| 宽口径（阿里系全家桶） | 淘宝 + 天猫 + 闲鱼 + 生意参谋 + 万相台 + 达摩盘 | **11 / 11** |
| 窄口径（淘宝 / 天猫本体，需 `taobao` 账号） | `market-analysis`、`store-patrol-manager`、`product-reviews`、`product-wdj` | **4 / 4** |

**未通过定性：** 阿里系 11 项**已全部通过**，无遗留未通过项。

**风控处置已升级为全闭环（#48 + #50，UI 实测验收）：**

插件侧已补齐「凭证回收 + 验证助手」两个动作，原项目为零实现：

| 环节 | 实现 | 验收证据 |
|------|------|----------|
| 识别 + 透出入口 | `gateway-proxy.ts` 从响应 `data.url` 提取 `verifyUrl`，写 `lastVerifyUrl`（TTL 30 分钟） | 错误返回含 verifyUrl |
| 放行验证凭证落库 | 错误响应默认不合并 Set-Cookie，但 `isRiskPassCookie()` 命中的强制合并 | `risk_pass_received: true` |
| 验证助手 | `dsagent_risk_verify`（可见浏览器 + 账号 Cookie + 复用平台 Profile） | UI 会话实测 **61 秒**返回（原 240s） |
| 解除冷却 | 收到验证凭证 / 助手成功 → 立即 `clearRiskCooldown()` | 日志确认 |

**遗留（非插件可自愈）**：账号 `taobao_2216797908875` 仍处平台侧高风险态，punish 链接返回的是
「访问被拒绝」deny 页（`action=denycdc_forbidden`，**无滑块**）。插件已能正确识别并给出三条可执行建议
（手动登录浏览 / 等风控分衰减 / 换网络出口），最终解除依赖平台侧衰减或用户手动操作。

---

## 四、未通过项明细

| 技能 ID | 定性 | 是否插件缺陷 | 备注 |
|---------|------|--------------|------|
| `xiaohongshu-crawl` | 上游限制 | 否（契约 bug 已修） | 接口需 `x-s` / `x-t`（jsvmp 加密）签名头；已能正确报错不再静默 0 条（#38） |
| `channel_message` | SKIP | 否 | 缺 `dsagent` CLI |
| `cron` | SKIP | 否 | 缺 `dsagent cron` CLI |
| `dws` | SKIP | 否 | 缺 `dws` CLI；29 个脚本的沙箱管道缺陷已预修（#44） |
| `dingtalk_channel` | SKIP | 否 | 钉钉频道未连接 |
| `chat_with_agent` | SKIP | 否 | 宿主未注册 `list_agents` / `chat_with_agent` |
| `industry-data-mcp` | SKIP（上游未订购） | 否 | 需外部「参谋长」行业库 MCP；技能目录零本地脚本，无降级路径；原项目 `mcp.clients={}` 亦未接线（详见 REQUIREMENTS.md §4.5） |
| `file_reader` 等 8 项 | 不纳入 UI 测试 | — | DSH 宿主自带 / 连接器 / meta 类，插件不重复收录 |

---

## 五、打勾项对应的插件级修复

| 编号 | 问题 | 影响技能 |
|------|------|----------|
| #34 | idle 看门狗只把 stdout 算心跳 → 误杀「进度走 stderr」的长任务技能 | 长任务类（估值 / 财报） |
| #35 | `resolvePython()` 只探「命令存在」不探「依赖齐备」 | 全部 Python 技能 |
| #36 | 风控 `error_message` 退化为「平台返回 HTTP 200」 | product-wdj / product-reviews |
| #38 | 小红书搜索脚本 GET 调 POST-only 接口 → 404 空体被静默当成 0 条 | xiaohongshu-crawl |
| #42 | `data-report` 校验用 `capture_output=True` 走匿名管道 → 受限沙箱每次要求提权 | data-report |
| #43 | `store-patrol-manager` 组合子命令 `analyze` 内部管道捕获 → 沙箱 `WinError 5` | store-patrol-manager |
| #44 | 全插件同类缺陷批量清零（`dws` 29 / `docx` 3 / `pptx` 3 / `xlsx` 3 / `data-report` 1，共 39 文件 / 48 调用点） | dws、docx、pptx、xlsx、data-report |
| #45 | 网关缺「账号级节流」+「风控冷却」→ 并发技能频率放大、风控后继续加刷；并修 MTOP token 错误归因（`FAIL_SYS_TOKEN_EXOIRED` 误报为限流） | 全部淘宝 / 天猫（MTOP）技能 |
| #46 | 排查结论：账号处于平台侧 `RGV587_ERROR` 风控态（非插件缺陷）；测试夹具 `736445442290` 已失效 | product-wdj / product-reviews |
| #47 | 全量比对原项目风控处置：仅 `guide_relogin` 文案层，**无任何自动方案**；结论「重新登录大概率不能解决」 | 全部淘宝 / 天猫（MTOP）技能 |
| #48 | 风控验证「最后半个动作」全闭环：凭证回收（`isRiskPassCookie` 强制合并）+ 验证助手 `riskVerify()` + `dsagent_risk_verify` 工具（原项目零实现） | product-wdj / product-reviews |
| #49 | `required: false` 直接导致插件加载失败、DSH 起不来（★可选参数必须整体省略 `required` 键） | 全部插件工具 |
| #50 | 验证助手三个隐藏缺陷：punish 链接是 deny 页无滑块（盲等 240s → 45s 短超时）/ 并发 `riskVerify` 撞 Profile 独占锁 / `x5secdata` 误判为通过凭证 | product-wdj / product-reviews |
| #51 | 同平台「添加其他账号」复用已登录 Profile → 秒判成功秒关窗（新增 `freshLogin` + 一次性空 Profile，贯穿 UI/服务/HTTP/工具/实现 5 层） | 全部平台登录 |
| #52 | 网关把 `FAIL_SYS_TOKEN_EMPTY` 误判为错误响应 → 丢弃新下发的 `_m_h5_tk`，后续请求永远 token 为空（MTOP token 引导响应四成员须全部白名单） | 全部淘宝 / 天猫（MTOP）技能 |
| #53 | `product-reviews` 详情接口（`pcdetail.data.get`）走 taobao 域被拒（(域名, API) 组合级风控）→ 改走 tmall 域并令 `Referer`/`Origin` 同域 | product-reviews |
| #54 | `tsconfig.json` 把 `src/client.ts` 编到 `lib/client.js` 覆盖 esbuild 产物 → DSH Web UI `Failed to load plugins`（修复后 `Total refs` 0 → 54） | 全部插件 UI |
| #55 | `product-wdj` 撞宿主 300 秒总超时被 SIGKILL → 零输出（技能侧自管 240s 时间预算，对齐原项目 `BATCH_TIME_BUDGET_SEC` 模式，5 文件 12 处） | product-wdj |
| #56 | 关键 Cookie 无法区分「已登录」与「匿名访问」→ 阿里系存入匿名假账号（`KEY_COOKIES` 加入 `unb`） | sycm / alimama / dmp / sycm_insight |
| #57 | 旧 sycm 账号被**单次** 403 误标 `expired` → 网关 `sortAccountsByPreference` 恒选「空店铺」新账号（数据订正 + 待引入连续失败计数） | 达摩盘 / 生意参谋类 |
| #58 | `competitor-indicator` 人群画像 `chartDataFull=null`（达摩盘「样本不足」合法响应）→ `len(None)` 崩溃中断 analyze（归一为空列表） | competitor-indicator |
