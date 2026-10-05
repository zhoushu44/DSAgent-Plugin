---
name: product-reviews
description: |
  抓取淘宝/天猫商品评价列表，导出 CSV 与 JSON。
  触发：商品评价、买家秀、追评、评价导出、rate list。
  适合「导出614498626290的评价」「抓取这个商品的全部评价」。
  凭证：必须使用平台连接里绑定的 **taobao（淘宝买家）** 账号。
license: MIT
# 工具触发声明：模型一调用相关工具，插件即把「先读本 SKILL.md」的提示注入返回。
# 解决「包了一层工具的技能，其坑位信息在调用前不可见」的问题（详见 tool-triggers.ts）。
# args 的值支持 /正则/flags 写法；缺 args 表示只要调用该工具就命中。
tool_triggers:
  - tool: dsagent_execute_skill
    args:
      id: /^product-reviews$/
  - tool: dsagent_product_reviews
  # 兜底：模型绕过封装技能、直接用代理打 MTOP 评价接口时也提示
  - tool: dsagent_proxy
    args:
      url: /rate\.taobao\.com|rate\.tmall\.com/
metadata:
  builtin_skill_version: "1.2"
  dsagent:

    display_name: "淘宝商品评价分析"
    emoji: "💬"
---

> `cd "{this_skill_dir}" && python -m product_reviews ...`
> 依赖：Python 3.10+、`httpx`、`jieba`、`markdown`（`pip install -e .`）
> 平台 API：`mtop.taobao.rate.detaillist.get` v6.0，经 Connect `POST /api/v1/proxy`
> 凭证：控制台 **平台连接** 登录 **taobao** 并 **绑定到当前智能体**
> 产物：`{workspace}/artifacts/` 下的 JSON + CSV；缓存写入 Connect skill-cache（`platform=taobao`）

## 前置条件

1. 在 **平台连接** 添加并登录 **淘宝买家账号**（`platform=taobao`）
2. 将该账号 **绑定到当前对话的智能体**
3. 在 Chat 中由 Agent 执行本技能（cwd 为智能体 workspace）

## 直接使用

用户直接说商品 ID 或链接即可。**未明确说明时，默认综合排序、抓取 5 页（约 100 条）。**

- `导出 614498626290 的评价` → 默认综合排序 + 5 页
- `按时间排序导出 614498626290 的评价` → `orderType=feedbackdate`
- `翻 3 页评价` → `--max_pages 3`
- `获取全部评价` / `导出所有评价` → `--all_pages`（仅用户明确要求「全部」时）

### 排序（`orderType`）

| 用户意图 | 参数 |
|----------|------|
| 综合排序 / 默认排序 / 未说明 | `searchImpr`（**默认**） |
| 时间排序 / 最新 / 按时间 | `feedbackdate` |

### 翻页

| 用户意图 | 行为 |
|----------|------|
| 未说明页数 | **默认 5 页** |
| 「翻 N 页」「抓 N 页」「前 N 页」 | `--max_pages N` 或 `--intent "翻N页"` |
| 「全部」「所有」「完整」 | `--all_pages`（翻至无下一页） |

Agent 应将用户自然语言映射为 CLI 参数，例如：

```bash
python -m product_reviews 614498626290
python -m product_reviews 614498626290 --order_type feedbackdate --max_pages 3
python -m product_reviews 614498626290 --intent "按时间排序翻10页"
python -m product_reviews 614498626290 --all_pages
```

## 手动命令行

```bash
cd "{this_skill_dir}" && python -m product_reviews 614498626290

cd "{this_skill_dir}" && python -m product_reviews "https://detail.tmall.com/item.htm?id=614498626290"

cd "{this_skill_dir}" && python -m product_reviews 614498626290 --page_size 20 --max_pages 10 --order_type feedbackdate
```

## CSV 表头

| 列名 | 来源字段 |
|------|----------|
| 序号 | 全局序号 |
| 用户 | userNick |
| SKU名称 | skuValueStr / skuMap |
| 标签 | rateTagList + userTagList |
| 初评时间 | feedbackDate |
| 晒图/视频 | feedPicPathList + rateResourceList |
| 评价内容 | feedback |
| 追评内容 | appendedFeed.appendedFeedback |
| 追评晒图/视频 | appendedFeed.appendFeedPicPathList |
| 有用 | interactInfo.likeCount |

## 执行完成后怎么回复用户

成功时必须给出 3 条真实绝对路径：

```text
数据文件路径: /绝对路径/xxx.json
CSV 文件路径: /绝对路径/xxx.csv
HTML 报告路径: /绝对路径/xxx.html
```

同时简要说明：共抓取多少条评价、排序方式、是否还有下一页未抓完。

若 `insights_pending` 非空，提示 Agent 按 `insights_artifacts.review_md` 写入评价分析后执行 `report` 子命令。

## 完整 HTML 报告工作流（含分析结论）

### 1. 抓取评价

```bash
python -m product_reviews 614498626290
```

成功时 stdout JSON 含 `insights_pending`、`insights_artifacts`；缺洞察时 HTML 仍生成，分析结论区显示「待补充 AI 分析」占位。

### 2. 写 AI 洞察（固定路径，唯一来源）

| 模块 | 路径 |
|------|------|
| 评价分析 | `{workspace}/artifacts/商品评价洞察_{item_id}.md` |

模板：`references/insights_template.md`（按电商运营框架：样本说明 → 口碑诊断 → 产品力拆解 → SKU 差异 → 风险预警 → 详情页优化 → 客服品控 → 行动清单）

**撰写规则**

- 至少 **4 个 `##` 小节**（建议按模板完整输出），全文 **≥300 字**
- 必须结合 JSON/CSV/HTML 中的真实数据：好中差评占比、SKU 分布、词云关键词、追评与典型原话
- 每个结论要有证据，禁止空泛套话；可用 `**加粗**`、`-` 列表、表格
- 不要写 `#` 一级标题，直接从 `## 数据样本说明` 等小节开始

### 3. 重新生成 HTML

```bash
python -m product_reviews report --input artifacts/商品评价_xxx.json
```

- 只读磁盘 md，JSON 内嵌洞察无效
- 缺文件或校验失败时报错；成功时 stderr 尾行 `[OUTPUT_FILES] HTML: ...`

## 存储与产物

| 类型 | 路径 |
|------|------|
| JSON/CSV/HTML | `{workspace}/artifacts/` |
| Connect skill-cache | 表 `cache_product_reviews_runs`、`cache_product_reviews_items`，按 `shop_key` 隔离 |
| stdout | JSON 摘要（与 artifacts JSON 同源） |

每次成功抓取会写入：
- **runs**：当次完整 payload（含 summary、路径、抓取参数）
- **items**：按 `rate_id` 去重合并的单条评价

纯本地调试（同时 `--from-json` 且 `--from-detail-json`）不拉 binding 时**不入库**。

## Excel 转换

如需 `.xlsx`，先运行本 Skill 拿到 CSV，再调用 **xlsx Skill** 转换。

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。
