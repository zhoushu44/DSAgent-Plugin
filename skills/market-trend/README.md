# 生意参谋市场排行分析（market-trend）

> 一句话定位：基于生意参谋市场排行，分析指定类目连续 4 个周期（周 / 月）的商品排行变化，识别上升 / 下降 / 新上榜 / 跌出榜 / 持平商品，输出 JSON + CSV 与蓝白主题的 HTML 报告。

## 能力

- **类目查询**（`list-categories`）：按名称搜索类目，返回父类目及其全部子类目，帮助确定 `cate_id`。
- **排行趋势**（数据获取）：对指定类目抓取 4 个周期（默认最近 4 周，或按 `--trend_mode month` 取月）的商品排行，计算每件商品的排名变化与趋势分类（上升 / 下降 / 新上榜 / 跌出榜 / 持平 / 持续上升）。
- **多榜单**：支持交易总量（默认）、交易增速、流量总量、加购收藏、新品流量五种榜单。
- **洞察生成**：由 Agent 依据 JSON 撰写趋势文字分析（持续上升商品、新上榜、竞争格局、策略建议）。
- **HTML 报告**：蓝白主题可视化报告，含可选 AI 洞察。
- **数据回存**：排行与报告 payload 写入 Connect `skill_cache`（表 `cache_market_trend_rank` / `cache_market_trend_runs`，按 `shop_key` 隔离）。

## 触发方式（自然语言示例）

- “帮我看看宠物类目的市场趋势”
- “女装类目最近有哪些新上榜商品？”
- “分析一下猫粮类目的市场趋势”
- “帮我出一份猫粮市场趋势分析报告”

## 输入

| 参数 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `--cate_id` | 是 | 类目 ID（先由 `list-categories` 确认） | — |
| `--rank_type` | 否 | 榜单：`gmv` / `growth` / `flow` / `add` / `newitm_ipv` | `gmv` |
| `--trend_mode` | 否 | `week`=周趋势，`month`=月趋势 | `week` |
| `--date_range` | 否 | 基准日期 `YYYY-MM-DD|YYYY-MM-DD`（自动向前推 3 个周期） | 自动取上周 / 上月 |
| `--max_pages` | 否 | 每周期页数（每页 20 条），0=全部 | `5`（100 条） |
| `--seller_type` | 否 | 店铺类型：`-1`=全部 / `0`=淘宝 / `1`=天猫 | `-1` |
| `--price_seg` / `--output_format` | 否 | 价格带筛选 / 输出格式（json / text / table） | 空 / `json` |

## 限制与边界

- 只覆盖生意参谋市场排行趋势，**不做**关键词拓词 / 排行榜（归 `keyword-assistant`），不做商品搜索大盘（归 `market-analysis`）。
- 数据为区间化口径（如“5000~7500 支付买家数”），非精确值。
- 单次取数耗时约 15–30 秒；多榜单需逐个串行查询，不宜用 `&&` 串联（易超时）。
- 命令使用下划线参数（如 `--rank_type`），数据获取命令无子命令名，直接传参数。

## 账号绑定

- 需绑定 **sycm（生意参谋）** 账号。在“平台连接”登录后绑定到当前智能体；cookie 由 Connect 代理，不进入技能进程。
- 会话失效时退出码为 2，需重新登录绑定。

## 输出

- **stdout**：UTF-8 JSON，含 `status`、`trend_items`、`summary`、`periods_summary` 及 `csv_path`。
- **CSV**：数据获取时自动生成到 `{workspace}/artifacts/`，路径记录在 JSON 的 `csv_path`。
- **HTML 报告**：通过 `inject-report` 子命令生成，从 stdout JSON 取 `report_path` 在浏览器打开。
- **报告流程**：数据获取（自动出 CSV）→ 洞察（Agent 写 `artifacts/洞察.md`）→ `inject-report`（指定 `--cate_id` / `--rank_type` / `--trend_mode`）生成 HTML。

## 错误处理速查

| 常见失败 | 处理动作 |
|----------|----------|
| 不知道 `cate_id` | 用 `list-categories --keyword 类目名` 查询，或在生意参谋市场排行页 URL 中找 `cateId=xxx` |
| 退出码 2，会话无效 | 在平台连接重新登录 sycm 并绑定 |
| 退出码 4，API 错误 | 检查类目 ID 是否有权限 |
| 退出码 3，限流 | 5 分钟后重试 |
| 数据量大加载慢 | 加 `--max_pages 3` 只取前 60 条/周期 |

## 相关技能

- **同类**：`keyword-assistant`（关键词榜），与之互补。
- **大盘 / 长期趋势**：`market-analysis`、`keyword-traffic`。
- **横向竞品维度**：`competitor-indicator`、`competitor-strategy-comparison`。