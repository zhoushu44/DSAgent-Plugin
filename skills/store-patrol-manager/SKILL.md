---
name: store-patrol-manager
description: 基于当前绑定店铺和用户指定周期完成综合巡店，分析店铺、类目、商品、推广和退款，并在行业数据可用且类目可比时校准市场表现。触发：巡店、店铺涨跌归因、周复盘、综合经营诊断、店铺数据分析。排除：仅分析单一推广渠道或制作投放报表（用专门的推广分析技能）、商品市场大盘（用 market-analysis）。
metadata:
  builtin_skill_version: "2.0"
  dsagent:
    emoji: "🏪"
  display_name: 巡店管家
  requires:
    bins: [python3]
    pip: [openpyxl]
    env: []
---

# 巡店管家

回答三件事：店铺是否正常、问题或机会在哪里、下一步优先做什么。先形成可验证的证据，再写业务结论，不把巡店简化成报表制作。

## 运行环境

```bash
# 在当前 DeepSeek Agent workspace 的技能目录运行
cd "{workspace}/skills/巡店管家"
python -m store_patrol_manager <子命令> ...
```

- stdout 为 UTF-8 JSON；业务产物只写当前工作区 `artifacts/`。
- 店铺连接、行业 MCP 和登录态由当前 DeepSeek Agent runtime 注入，技能不保存凭证或服务地址；脱离已安装的 DeepSeek Agent workspace 时，CLI 和核心事实脚本必须拒绝运行。

## 子命令

| 子命令 | 用途 | 输出 |
|---|---|---|
| `prepare` | 将本次各层原始 JSON 冻结为证据包 | `patrol_evidence.json` |
| `aggregate` | 从证据确定性汇总事实 | `patrol_facts.json` |
| `validate` | 校验周期、覆盖、映射和严格日环比 | `patrol_validation.json` |
| `analyze` | 一次完成冻结、汇总和校验 | 路径与紧凑事实目录 JSON |
| `summary` | 只输出模型需要的紧凑事实目录 | UTF-8 JSON |

## 运行边界

1. 读取当前DeepSeek Agent绑定关系，锁定本次店铺；不得复用历史店铺、类目、结论或旧报告。
2. 用户没说周期时必须先问。相对周期默认不包含今天。
3. 正式周期为 `S~E`，日环比查询 `S-1~E`；基准日不能进入周期汇总、排名、ROI或计划表现。
4. 各数据层分别判断覆盖。店铺层可用不代表商品、推广、退款或行业层可用。
5. 当前会话没有原生注入行业MCP时，标记未绑定并跳过行业校准；禁止从配置、凭证、其他智能体或历史文件寻找MCP。
6. 某层缺失时继续完成其他有证据的诊断，不生成悬空等待状态，不使用演示或默认行业回退。
7. 本次产物只写当前工作区的 `artifacts/` 或 `tool_results/`，不修改已安装技能。

完整数据口径和故障状态见 [references/data-contract.md](references/data-contract.md)。只有实际涉及推广或行业分析时，再读取 [references/diagnosis-rules.md](references/diagnosis-rules.md)。

## 标准流程

### 1. 锁定请求

确认当前店铺、正式周期 `S~E` 和查询周期 `S-1~E`。`S`、`E` 一经确认，本次运行中不得改成接口实际返回的首末日。

### 2. 分层取数

分别获取并保存本次原始JSON：

- 店铺整体与每日趋势。
- 本店商品每日明细，必须包含可核验的商品和类目。
- 推广渠道与计划明细。
- 退款明细或退款指标。
- 可选行业数据及类目树。行业可用时，除一级大盘外，要覆盖本店实际经营的主要类目及其可比行业类目；不能只取一个叶子类目。

行业商品不能替代本店商品。推广计划名称只能用于识别投放对象或策略，不能证明商品对全店经营的贡献。

### 3. 冻结证据

运行统一预处理；未取得的数据层省略对应参数。默认使用组合命令，避免模型反复读取大原始文件：

```bash
cd <skill>
python -m store_patrol_manager analyze \
  --shop-name "<当前店铺名称>" \
  --display-start <S> --display-end <E> \
  --shop-raw artifacts/raw/shop.json \
  --item-raw artifacts/raw/item.json \
  --promotion-raw artifacts/raw/promotion \
  --refund-raw artifacts/raw/refund.json \
  --industry-raw artifacts/raw/industry \
  --category-map artifacts/category_map.json
```

`--*-raw` 可以重复传文件，也可以传包含JSON的目录。行业可比性由AI结合本店商品、主营类目和行业返回范围判断，判断结果写入 `category_map.json`；不能只按名称相等判断。

### 4. 确定性汇总和验收

`analyze` 已顺序执行冻结、汇总和校验。需要单步排错时才分别使用 `prepare`、`aggregate`、`validate`；校验通过后使用 `summary --facts artifacts/patrol_facts.json` 读取紧凑目录，不得把多 MB 原始 JSON 或整份事实表反复打印给模型。

`patrol_facts.json` 是数字、表格和分析的唯一事实来源。校验报错时先修正输入或明确降级，不得绕过；只有警告时可以交付，但要说明缺口及影响。

主流程只运行 `prepare_run.py`、`aggregate_store.py` 和 `validate_evidence.py`。其他脚本属于旧版兼容导出，不参与巡店取数、汇总、判断或默认HTML交付；除非用户明确要求旧版Excel，否则不要读取或运行。

### 5. 业务分析与交付

基于冻结事实一次性完成：店铺整体 → 类目贡献 → 商品贡献 → 推广/退款因素 → 可选行业校准 → 优先动作。

- 商品层缺失时跳过类目、商品归因。
- 推广先按渠道对比，再下钻计划；必须覆盖正式周期内所有实际投放渠道。
- 行业被判断为匹配或部分匹配时，先输出“本店全部经营类目 vs 行业一级大盘”的整体关联，再下钻已映射类目；不能只剩一个叶子类目对比。
- 每日店铺、每日店铺品类和每日行业品类必须按同一日期并排展示销售额与日环比。日环比严格按 D 对 D-1，绝不跨缺失日寻找上一个有效日。
- 不设固定成交笔数门槛；短周期零成交不能单独触发停计划。

输出结构和面向用户的字段要求见 [references/output-contract.md](references/output-contract.md)。优先使用 `patrol_facts.json` 的 `summary` 和已汇总表格形成业务结论，模型不再汇总每日原始数据。模型可以自行排版自包含HTML，但不得二次计算、补数或改变已冻结的事实。直接生成最终报告文件；不要临时编写或反复改写HTML生成脚本。文件较长时可按章节连续写入同一个最终文件，写完后做一次完整性检查。Excel仅在用户明确要求时生成。

## 跨设备

技能不携带机器路径、服务地址、账号、令牌或固定店铺信息。复制整个技能目录后，使用目标电脑当前DeepSeek Agent的绑定和登录态取数。

## 代码结构

```text
store_patrol_manager/
├── fetch/       # 本次原始输入检查，不发现凭证
├── parse/       # 证据冻结、确定性汇总和校验编排
├── insights/    # 面向模型的紧凑事实目录
├── report/      # 报告事实上下文，不内置固定 HTML 模板
├── storage/     # 当前工作区产物定位
└── cli/         # prepare / aggregate / validate / analyze / summary
```

详细口径仍以 `references/` 为准；`scripts/` 保留确定性事实核心和旧版兼容脚本。
