# 知乎·创作数据（zhihu-works）

拉取自己账号的内容表现数据，按六条口径输出分析结论。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（mode / content_id / type / days / limit / csv）|
| [SKILL.md](SKILL.md) | 技能全文：触发词、接口清单、分析口径、错误处理 |
| [scripts/run.py](scripts/run.py) | Python 入口包装（宿主只认 .py）|
| [scripts/works.mjs](scripts/works.mjs) | Node 主逻辑 |

## 用法

```bash
python3 scripts/run.py --mode overview --days 30 --limit 20 --csv
python3 scripts/run.py --mode list --limit 50
python3 scripts/run.py --mode article --content-id 2096024293196953340 --days 30
python3 scripts/run.py --mode trend   --content-id 2096024293196953340 --days 7
```

## 模式

| mode | 用途 |
|------|------|
| `overview` | 全部内容指标合并排名 + 六条结论（默认）|
| `list` | 仅创作列表 |
| `article` | 单篇近 N 天汇总（需 `--content-id`）|
| `trend` | 单篇逐日趋势（需 `--content-id`）|

`--type` 取值 `article`（默认）/ `answer` / `pin`。**禁止 `all`**（返回 `error type`）。

## 接口

```
GET /api/v4/creators/creations/v2/all                                    创作列表
GET /api/v4/creators/analysis/realtime/content/list?type=article         实时指标
GET /api/v4/creators/analysis/realtime/content/aggr?type=article&token=  单篇汇总
GET /api/v4/creators/analysis/realtime/content/daily?type=article&token= 单篇日趋势
GET /api/v4/creators/analysis/realtime/content/visitor_portrait          读者画像
```

全部需要 `x-zse-96`，由页面 JS 生成 → 必须在 `www.zhihu.com` 域下 fetch 并等 9 秒。

## 依赖

- Node.js（`DSAGENT_NODE_BIN` 可覆盖）
- Chrome / Edge
- 「账号连接」已绑定 zhihu 账号且登录态有效

## 与 zhihu-analytics 的区别

同一套接口的 Node 实现。产物落在技能目录 `artifacts/` 下；Python 版落在 workspace。
