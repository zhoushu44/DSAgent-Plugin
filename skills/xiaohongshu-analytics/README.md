# 小红书·数据分析（xiaohongshu-analytics）

RE HTTP 链路采集当前小红书账号下全部笔记的发布状态、时间与互动数据，输出可执行结论。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（mode / note_id / limit / port / csv） |
| [SKILL.md](SKILL.md) | 技能全文：触发词、边界、前置条件、分析口径、错误处理 |
| [scripts/fetch_data.py](scripts/fetch_data.py) | 执行脚本 |

## 模式

| mode | 用途 |
|------|------|
| `overview` | 笔记列表 + 指标汇总（默认） |
| `list` | 仅笔记列表（标题/状态/日期/互动数） |
| `detail` | 单篇详情（预留） |
| `trend` | 单篇日趋势（预留） |

## 用法

```bash
python3 scripts/fetch_data.py --mode overview --limit 50 [--csv]
python3 scripts/fetch_data.py --mode list --limit 100
```

`--csv` 额外导出 CSV 到 `workspace/artifacts/xhs-analytics/`。

## 依赖

- Node.js + Chrome（`sign_service.js` 走 puppeteer-core）
- sign_service 会自动拉起；日志见技能目录 `sign_service.log`
- 登录态失效时引导用户到「账号连接」重新登录 xhs，不要重试原请求

## 相关技能

- 发布笔记：`xhs-publish-re` / `xiaohongshu-publish`
- 关键词采集：`xiaohongshu-crawl`
