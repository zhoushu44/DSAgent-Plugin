# 知乎·数据采集（zhihu-crawl）

> 一句话定位：在「知乎」平台按关键词搜索回答/文章/问题/用户，采集回答、评论、用户主页与热榜，可导出 CSV。

## 能力
- 关键词搜索：按关键词搜索回答 / 文章 / 问题 / 用户（`--search-type` 区分）。
- 回答采集：指定问题下的回答列表（`--sort-by` 热度排序）、单条回答详情（含正文）。
- 评论采集：回答的一级评论（可含二级 `--with-child`）。
- 用户主页：用户资料、用户回答列表、用户文章列表。
- 热点：知乎热榜（≤ 50 条）。
- 当前账号资料查询。
- 支持翻页（`--offset` / `--count`）与导出 CSV 到 `artifacts/`。
- **不可做**：不发布内容、不点赞、不关注（只读采集）。

## 触发方式（自然语言示例）
- 「搜一下知乎上的 xxx」
- 「这个问题下有哪些回答」
- 「采集知乎评论」
- 「知乎用户 xxx 的主页」
- 「知乎热榜 / 知乎今天有什么热点」

## 输入
| 参数 | 必需 | 说明 |
|------|:----:|------|
| `--mode` | 否 | 场景：`search` / `answers` / `answer` / `comments` / `member` / `member-answers` / `member-articles` / `hot` / `profile`；不传时按已给 ID 自动判定 |
| `--keyword` | 视场景 | 关键词或昵称（`search`/`member` 系列需要；也可从请求文本自动提取） |
| `--question-id` | 视场景 | 问题 ID（`answers`） |
| `--answer-id` | 视场景 | 回答 ID（`answer`/`comments`） |
| `--url-token` | 否 | 用户 url_token（`member` 系列；也可传昵称 `--keyword` 自动解析） |
| `--count` | 否 | 返回条数，单页 ≤ 20，热榜 ≤ 50 |
| `--offset` | 否 | 翻页游标（用上一轮的 `next_offset`） |
| `--csv` | 否 | 加此参数同时在 `artifacts/` 导出 CSV |
| `--sort-by` / `--order` | 否 | 回答排序 / 评论排序选项 |

> 采集请求间隔 ≥ 2 秒（网关另有账号级节流）。结果仅供数据分析参考，不得用于商业用途。

## 限制与边界
- **不采集问题详情**：问题标题改从回答列表的 `question.title` 间接取得。
- **不采集单篇文章详情**：文章能力降级为「用户文章列表」。
- 不做批量爬取；单页 ≤ 20 条，热榜 ≤ 50 条。
- `member-answers` 端点无 `voteup_count`，回退取 `reaction.statistics.like_count`。
- 命中风控需用户去知乎完成安全验证；Cookie（`z_c0`）失效需重新登录。
- 抖音/小红书/闲鱼等其它平台采集走对应平台技能。

## 账号绑定
- 绑定**知乎（zhihu）**平台账号，登录态由本地代理网关注入（Cookie 不出网关）。
- 拿不到当前账号资料即登录态失效，需重新登录。

## 输出
- 采集结果通过 stdout 输出 `__DSAGENT_RESULT__` 行，JSON 结构：
  ```
  { ok, mode, keyword, total, offset, next_offset, has_more, data: [...], csv_path, fetch_time }
  ```
- `data` 内字段随 mode 不同而不同：搜索含 `type/id/title/excerpt/voteup_count/author.../url`；回答/文章/评论/用户/热榜各有对应字段。
- `csv_path` 仅在 `--csv` 时出现，同时在 stderr 的 `---[OUTPUT_FILES]` 行上报。
- 无结果（非风控）返回 `{ ok: true, data: [], total: 0 }`。

## 错误处理速查
| 常见失败 | 处理动作 |
|---------|---------|
| 未绑定知乎账号（`not_bound`） | 引导到「账号连接」绑定 |
| 拿不到当前账号资料（`token_expired`） | 登录态失效，重新登录 |
| 命中风控 403 / 文案含未登录（`risk_control`） | 引导完成安全验证后重试，勿当 0 条 |
| `error.code=4041` | 资源不存在（问题/回答/用户不存在），展示 message |
| 其他 `error` 信封 | 展示 `error.message` |
| 响应解析失败（`parse_error`） | 展示原始返回 |
| 结果为空（非风控） | 按空结果返回 |

## 相关技能
- 发文到知乎专栏：`zhihu-publish`
- 其它平台采集：`xiaohongshu-crawl` / `xianyu-crawl` 等