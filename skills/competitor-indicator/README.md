# 达摩盘竞品指标对比（competitor-indicator）

> 一句话定位：基于达摩盘后台做商品级竞品核心指标对比——按竞品 ID 与分析 / 对比周期拉取整体、流量来源、人群画像三类数据，并生成 HTML 可视化报告。

## 能力

- **整体指标**（`overall`）：竞品的 shop + base 核心指标卡片（IPV、加购率、转化率、成交笔数、笔单价、新客占比、付费点击、点击成本、引导 ROI、引导成交笔数等）。
- **流量来源**（`flow`）：竞品流量渠道树（渠道表 + AI 洞察卡）。
- **人群画像**（`audience`）：竞品人群标签 / 图表，按行为（浏览 / 搜索 / 收藏 / 加购 / 购买）与天数维度拆分。
- **组合分析**（`analyze`）：一次拉取整体 + 流量 + 画像，写 JSON；洞察齐全时直接含 HTML。
- **报告**（`report`）：不拉 API，只从保存的 JSON + 洞察 Markdown 生成 HTML。
- **历史查询**（`history`）：查看本地历史产物。

## 触发方式（自然语言示例）

- “帮我对比这几个竞品的核心指标”
- “分析竞品 1025781404398 最近一周的流量来源”
- “看看这个竞品的人群画像和转化差异”
- “出一份竞品对比报告”

## 输入

| 参数 | 必需 | 说明 |
|------|------|------|
| `--competitor-ids` | 是 | 竞品商品 ID，逗号分隔，至少 1 个 |
| `--entity-id` | 是 | 达摩盘对比基准商品 ID（API 必填；**报告只展示竞品**） |
| `--begin-date` / `--end-date` | 是 | 分析周期 `YYYY-MM-DD` |
| `--peer-begin-date` / `--peer-end-date` | 否 | 对比周期 `YYYY-MM-DD` |
| `--competition-type` | 否 | 对比类型，默认 `2`（商品） |
| `--audience-action` | 否 | 画像行为（浏览 / 搜索 / 收藏 / 加购 / 购买，或 `1~5`） | 搜索 + 购买 |
| `--audience-days` | 否 | 画像天数：7 / 15 / 30 / 90 | `30` |
| `report --input` | 是（report） | Step 1 保存的 JSON 路径 |
| `history --competitor-id` / `--limit` | 否 | 历史筛选 / 条数 | 空 / `50` |

## 限制与边界

- 只对比**竞品商品**，报告不展示本店基准商品。
- 不做关键词趋势（归 `keyword-traffic`），不做建计划（归推广管理助手）。
- `competitors` 顶部指标卡仅来自 shop + base 指标，不混入流量 / 画像数据，两者只在对应 Tab 展示。
- DMP 数据为区间化 / 模糊化口径。

## 账号绑定

- 需绑定 **sycm（生意参谋 / 万相台 / 达摩盘）** 账号，由 Connect 代理达摩盘 API（`platform=sycm`），cookie 不落地到技能。

## 输出

- **stdout**：UTF-8 JSON，含 `competitors`、`competitor_channels`、`competitor_audience`、`report_path`、数据模块清单等。
- **HTML**：写到 `{workspace}/artifacts/`，成功后 stderr 尾行 `[OUTPUT_FILES] HTML: ...`，需在浏览器打开。
- **报告 UI**：顶部核心指标卡（红涨绿跌，正红负绿），Tab 分“流量来源”“人群画像”，多竞品按商品 ID 分块展示。
- **报告流程**：`analyze` 拉数（存 JSON）→ 写洞察 md（`artifacts/竞品流量洞察.md`、`artifacts/竞品画像洞察.md`）→ `report --input` 生成 HTML。

## 错误处理速查

| 常见失败 | 处理动作 |
|----------|----------|
| 未找到 workspace / runtime | 确认 cwd 在 DeepSeek Agent workspace 内 |
| Cookie 无效 | 检查平台绑定 sycm 账号是否过期 |
| 限流 | 等待后重试（接口串行间隔 ≥1.2s） |
| 缺洞察文件 | 按 `insights_artifacts` 路径写 md 后调 `report` |
| 洞察校验失败 | 补全 `##` 小节与字数，去除禁用词 |
| 报告无加粗 | 确保已安装 `markdown` 包 |

## 相关技能

- **同类**：`competitor-strategy-comparison`（竞品策略对比 / 更详细），`market-trend`（市场排行）。
- **上游拓词 / 大盘**：`keyword-assistant`、`market-analysis`。