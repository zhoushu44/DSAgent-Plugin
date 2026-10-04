---
name: product-wdj
description: |
  获取淘宝/天猫商品「问大家」问答列表与回答详情，导出 CSV、JSON 与 HTML 报告。
  触发：问大家、买家问答、商品问答、WDJ、问答导出。
  适合「导出762128994852的问大家」「获取这个商品的全部问答」。
  凭证：必须使用平台连接里绑定的 **taobao（淘宝买家）** 账号。
license: MIT
# 工具触发声明（见 tool-triggers.ts）：调用下列工具时自动提示先读本 SKILL.md。
# 本技能的关键坑位都写在正文里（240s 时间预算、answers_truncated 语义），
# 不提示的话模型会以为「漏抓的回答」是失败。
tool_triggers:
  - tool: dsagent_execute_skill
    args:
      id: /^product-wdj$/
  - tool: dsagent_product_wdj
  - tool: dsagent_proxy
    args:
      url: /qa\.taobao\.com|wdj/
metadata:
  builtin_skill_version: "1.2"
  dsagent:
    display_name: "淘宝商品问大家分析"
    emoji: "❓"
---

> `cd "{this_skill_dir}" && python -m product_wdj ...`
> 依赖：Python 3.10+、`httpx`、`jieba`、`markdown`（`pip install -e .`）
> 平台 API：
> - 列表 `mtop.taobao.wdj.list.merge.search` v1.0
> - 详情 `mtop.taobao.social.ugc.post.detail` v2.0
> 经 Connect `POST /api/v1/proxy`
> 凭证：控制台 **平台连接** 登录 **taobao** 并 **绑定到当前智能体**
> 产物：`{workspace}/artifacts/` 下的 JSON + CSV + HTML；缓存写入 Connect skill-cache（`platform=taobao`）

## 前置条件

1. 在 **平台连接** 添加并登录 **淘宝买家账号**（`platform=taobao`）
2. 将该账号 **绑定到当前对话的智能体**
3. 在 Chat 中由 Agent 执行本技能（cwd 为智能体 workspace）

## 直接使用

用户直接说商品 ID 或链接即可。**未明确说明时，默认获取 5 页问题（约 50 条），并拉取每条问题的全部回答。**

- `导出 762128994852 的问大家` → 默认 5 页 + 全量回答
- `翻 3 页问大家` → `--max_pages 3`
- `获取全部问大家` / `导出所有问答` → `--all_pages`（仅用户明确要求「全部」时）
- `只看发黄相关问大家` → 先获取 summary.tags 查 property_id，再 `--tag_id <property_id>`
- `只要问题不要回答` → `--skip_answers`

### 翻页

| 用户意图 | 行为 |
|----------|------|
| 未说明页数 | **默认 5 页**（每页 10 条问题） |
| 「翻 N 页」「获取 N 页」「前 N 页」 | `--max_pages N` 或 `--intent "获取N页"` |
| 「全部」「所有」「完整」 | `--all_pages`（翻至无下一页） |

Agent 应将用户自然语言映射为 CLI 参数，例如：

```bash
python -m product_wdj 762128994852
python -m product_wdj 762128994852 --max_pages 3
python -m product_wdj 762128994852 --intent "翻10页"
python -m product_wdj 762128994852 --all_pages
python -m product_wdj 762128994852 --tag_id 100003264
python -m product_wdj 762128994852 --skip_answers
```

## 手动命令行

```bash
cd "{this_skill_dir}" && python -m product_wdj 762128994852

cd "{this_skill_dir}" && python -m product_wdj "https://detail.tmall.com/item.htm?id=762128994852"

cd "{this_skill_dir}" && python -m product_wdj 762128994852 --page_size 10 --max_pages 5
```

本地调试（跳过 API，解析 JSONP 样本）：

```bash
python -m product_wdj --from-json ../问大家.js --item_id 762128994852
python -m product_wdj --from-json ../问大家.js --from-detail-json ../回答详情.js --item_id 762128994852
```

## CSV 表头

| 列名 | 说明 |
|------|------|
| 序号 | 问题全局序号 |
| 问题ID | questionId |
| 问题 | questionTitle |
| 提问用户 | userNick |
| 提问标签 | 已购等 |
| 提问时间 | gmtCreate |
| 提问地区 | ip_location |
| 回答数 | answerCount |
| 回答ID | answerId |
| 回答内容 | answerTitle / title |
| 回答用户 | userNick |
| 回答时间 | gmtCreateStr |
| SKU | 买家购买规格 |
| 购买标签 | 近期已购 / 近期购买并好评 |
| 点赞数 | likeCount |
| 信誉等级 | creditLevel |

## 执行完成后怎么回复用户

成功时必须给出 3 条真实绝对路径：

```text
数据文件路径: /绝对路径/xxx.json
CSV 文件路径: /绝对路径/xxx.csv
HTML 报告路径: /绝对路径/xxx.html
```

同时简要说明：共获取多少条问题、多少条回答、是否还有下一页未获取完、是否使用了标签筛选。

若 `insights_pending` 非空，提示 Agent 按 `insights_artifacts.review_md` 写入问大家分析后执行 `report` 子命令。

## 完整 HTML 报告工作流（含分析结论）

### 1. 获取问大家

```bash
python -m product_wdj 762128994852
```

成功时 stdout JSON 含 `insights_pending`、`insights_artifacts`；缺洞察时 HTML 仍生成，分析结论区显示「待补充 AI 分析」占位。

### 2. 写 AI 洞察（固定路径，唯一来源）

| 模块 | 路径 |
|------|------|
| 问大家分析 | `{workspace}/artifacts/问大家洞察_{item_id}.md` |

模板：`references/insights_template.md`（按电商运营框架：样本说明 → 买家顾虑 → 回答质量 → 详情页优化 → 客服 FAQ → 品控反馈 → 行动清单）

**撰写规则**

- 至少 **4 个 `##` 小节**（建议按模板完整输出），全文 **≥300 字**
- 必须结合 JSON/CSV/HTML 中的真实数据：问题总数、标签分布、高频问法、SKU 差异、典型问答原话
- 每个结论要有证据，禁止空泛套话；可用 `**加粗**`、`-` 列表、表格
- 不要写 `#` 一级标题，直接从 `## 数据样本说明` 等小节开始

### 3. 重新生成 HTML

```bash
python -m product_wdj report --input artifacts/问大家_xxx.json
```

- 只读磁盘 md，JSON 内嵌洞察无效
- 缺文件或校验失败时报错；成功时 stderr 尾行 `[OUTPUT_FILES] HTML: ...`

## 接口说明

### 问大家列表

- API: `mtop.taobao.wdj.list.merge.search` v1.0
- 关键参数：`itemId`、`userId`（由 binding.`shop_key` 中 `/` 后数字自动转换）、`page`、`pageSize`、`type=mix_group`、`tagId`、`extraInfo.searchText`
- 返回：`questionList`（含 `topAnswerList` 首条回答）、`questionTotal`、`tags`、`hasNext`

### 回答详情

- API: `mtop.taobao.social.ugc.post.detail` v2.0
- 关键参数：`id`（questionId）、`userId`、`params.firstAnswerId`、`params.pageNum`
- 返回：`data.list.list` 全部回答，用于补全列表页仅展示的首答

## 存储与产物

| 类型 | 路径 |
|------|------|
| JSON/CSV/HTML | `{workspace}/artifacts/` |
| Connect skill-cache | 表 `cache_product_wdj_runs`、`cache_product_wdj_questions`、`cache_product_wdj_answers`，按 `shop_key` 隔离 |
| stdout | JSON 摘要（与 artifacts JSON 同源） |

每次成功获取会写入：
- **runs**：当次完整 payload（含 summary、路径、获取参数）
- **questions**：按 `question_id` 去重合并的单条问题
- **answers**：按 `answer_id` 去重合并的单条回答

纯本地调试（`--from-json`）不拉 binding 时**不入库**。

## Excel 转换

如需 `.xlsx`，先运行本 Skill 拿到 CSV，再调用 **xlsx Skill** 转换。

## 注意事项

- 拉取回答详情时，每个问题会额外请求 1～N 次详情接口，全量获取耗时较长，请合理控制 `--max_pages`
- 平台连接 binding 的 `shop_key` 形如 `taobao/3360359039`；技能调用问大家 API 时自动取 `/` 后数字作为 `userId`
- 本地 `--from-json` 调试仅解析列表页首答，不会请求详情接口
