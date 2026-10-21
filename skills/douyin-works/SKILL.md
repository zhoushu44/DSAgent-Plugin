---
name: douyin-works
description: "抖音作品数据查询与分析：拉自己账号的作品列表与 30 项内容质量指标（播放/点赞/完播率/2秒跳出率/涨粉/封面曝光），按六条口径出分析结论，也可查单条视频的播放直链。触发：抖音作品、抖音作品列表、我抖音发了什么、抖音播放量、抖音数据、抖音作品分析、抖音哪个视频好、抖音完播率、抖音涨粉、抖音播放直链。排除：抖音内容发布（用 douyin-publish-http 或 douyin-publish）、抖音搜索/热搜等公开数据采集（用 douyin-crawl）。需绑定 douyin 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "抖音·作品数据"
    emoji: "📊"
    requires:
      douyin: "抖音账号"
      bins: [node]
---

# 抖音作品数据查询与分析

拉**自己账号**的作品表现数据，输出可执行的分析结论。核心是 `work_list` 一个接口返回 **30 个内容质量字段**，比创作者后台的数据中心还细。

## 何时使用

- 用户说"我抖音发了什么"、"看看我抖音作品" → 作品列表
- 用户说"抖音哪个视频数据好"、"哪条播放高" → 列表 + 分析
- 用户说"抖音播放量多少"、"抖音涨粉"、"完播率" → 30 项指标
- 用户说"这条抖音视频的播放地址" → 播放直链
- 用户说"分析下我抖音账号" → 六条口径分析

## 边界

- **只读，零写操作** —— 不发布、不点赞、不关注、不删除
- **只查自己的数据** —— 没有竞品/全站内容数据，要做对标得另找路径
- **不做公开数据采集** —— 关键词搜索 / 热搜榜 / 用户搜索请用 `douyin-crawl`
- **不发布内容** —— 发布请用 `douyin-publish-http`
- 查询会**弹出可见浏览器窗口**（约 13 秒，用于建立 `a_bogus` 签名环境）
- 登录态失效会直接报错退出，不会重试

## 执行流程

### 1. 选模式

入口统一走 `scripts/run.py`（Python 包装，转调 `scripts/works.mjs`）——
技能宿主的入口探测只认 `.py`，参数原样透传。

| 模式 | 命令 | 用途 |
|------|------|------|
| 列作品（默认） | `python3 {baseDir}/scripts/run.py --count 20` | 列表 + 30 项指标 |
| 六条口径分析 | `python3 {baseDir}/scripts/run.py --analyze` | 出结论，不只罗列数字 |
| 查播放直链 | `python3 {baseDir}/scripts/run.py --video <video_id>` | `play_url` + `poster_url` |
| 原始 JSON | `python3 {baseDir}/scripts/run.py --json` | 全字段，供二次加工 |

### 2. 按需补参数

| 参数 | 说明 |
|------|------|
| `--count` | 返回条数上限，默认 20 |
| `--video` | video_id（形如 `v0300fg10000dbbpgefog65m7t0n3jb0`），查播放直链 |
| `--account` | 账号 shopKey；多账号时必须指定 |
| `--analyze` | 按六条口径输出分析结论 |
| `--json` | 输出原始 JSON |

### 3. 报告结果

- 列表模式：逐条给出播放/点赞/评论/分享/涨粉 + 点赞率 + 2s 跳出率 + 5s 完播率
- 分析模式：额外给出六条口径结论（见下）
- 直链模式：给出 `play_url`，并提醒**该链接带时效签名，需重新请求刷新**

## 六条分析口径（`--analyze` 输出什么）

不要只罗列数字，必须回答这六个问题：

1. **头马篇** —— `view_count` 最高的一条，占总播放多少？
2. **互动匹配度** —— 播放高但互动低 → 正文没接住流量；反之 → 标题/封面没打开
3. **涨粉效率** —— `subscribe_count / view_count`。为 0 说明内容没有建立「关注理由」
4. **限流检测** —— 看 `review.details`，**不要只看 `review.status`**（`status=2` 也可能被限流）
5. **流量来源** —— `cover_show = 0` 但有点播 → 推荐流未给量，问题在封面/开头不在选题
6. **下一步做什么** —— 给具体动作，不写「继续优化内容质量」这种空话

## metrics 30 字段速查

| 字段 | 含义 | 用途 |
|---|---|---|
| `view_count` | 播放数 | 基础 |
| `like_count` / `comment_count` / `share_count` | 赞 / 评 / 转 | 互动 |
| `favorite_count` | 收藏 | 内容价值信号 |
| `subscribe_count` | **该作品带来的涨粉** | 人设沉淀 |
| `dislike_count` | 不赞数 | 负面信号 |
| `download_count` | 下载数 | 传播意愿 |
| `homepage_visit_count` | 主页访问 | 人设吸引力 |
| `completion_rate` | **完播率** | 内容质量核心 |
| `completion_rate_5s` | **5 秒完播率** | 开头吸引力 |
| `bounce_rate_2s` | **2 秒跳出率** | 开头/封面吸引力 |
| `avg_view_second` | 人均观看时长（秒）| 完播补充 |
| `avg_view_proportion` | 人均观看占比 | 完播补充 |
| `cover_show` | 封面曝光 | 推荐流量入口 |
| `cover_click_rate` | 封面点击率 | 封面质量 |
| `fan_view_proportion` | 粉丝观看占比 | 私域占比 |
| `like_rate` / `comment_rate` / `share_rate` | 各互动率 | 互动 |
| `subscribe_rate` / `unsubscribe_rate` | 关注率 / 掉关率 | 人设 |
| `description_completion_rate` | 描述完读率 | 文案质量 |
| `description_spread_rate` | 描述扩散率 | 文案传播 |
| `image_avg_view_count` | 图文人均看图数 | 图文专属 |

**判断内容质量四项核心**：`completion_rate`、`completion_rate_5s`、`bounce_rate_2s`、`avg_view_second`。

## 错误处理

| 场景 | failure_kind | 引导动作 |
|------|-------------|---------|
| 未绑定抖音账号 | `not_bound` | 引导用户到「账号连接」页面添加抖音账号 |
| 平台有多个可用账号且未指定 | `need_account_choice` | **把候选列表给用户选**，把选定的 `shopKey` 填进 `--account` 重调；★ 绝不要自己挑一个 |
| 登录态失效（`status_code:8`）| `token_expired` | 引导用户到「账号连接」页面对该抖音账号**重新登录** |
| work_list 返回空 | `api_error` | 账号可能没有作品，或被风控；重试一次 |
| 查播放直链失败 | `api_error` | 检查 `video_id` 是否正确（形如 `v0300fg1...`）|

## 已知限制

- **`a_bogus` 必须借浏览器** —— 由 secsdk 在 fetch 内部附加，Node 侧无法独立复现。所以查询也会弹一次浏览器窗口（约 13 秒）
- **数据中心页面不抓** —— `/creator-micro/data-center` 是 SPA + iframe 嵌套，图表数据走懒加载。`work_list` 的 metrics 已比它更细，没必要纠缠
- **三套 id 不通用** —— `item_id`（加密）/ `item_id_plain`（明文）/ `work_list.id`（plain+`000`），转换规则要记清
- **单位混乱** —— `item/list/` 的 `duration` 是毫秒，`video/transend/` 是秒

## 环境变量

| 变量 | 用途 |
|------|------|
| `DSAGENT_PLUGIN_ROOT` | 插件根目录（默认按技能目录上推三级，一般无需设置）|
