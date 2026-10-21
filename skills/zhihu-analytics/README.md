# 知乎·创作数据分析（zhihu-analytics）

RE HTTP 链路采集当前知乎账号下全部创作的内容表现数据，输出可执行的结论。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（mode / content_id / type / days / limit / csv） |
| [SKILL.md](SKILL.md) | 技能全文：触发词、边界、接口清单、分析口径、错误处理 |
| [scripts/fetch_data.py](scripts/fetch_data.py) | 执行脚本 |

## 模式

| mode | 用途 |
|---|---|
| `overview` | 创作列表 + 实时指标合并排名（默认） |
| `list` | 仅创作列表（标题/ID/时间） |
| `article` | 单篇近 N 天汇总 |
| `trend` | 单篇逐日趋势 |

## 用法

```bash
python3 scripts/fetch_data.py --mode overview --days 30 --limit 20 [--csv]
python3 scripts/fetch_data.py --mode list --limit 50
python3 scripts/fetch_data.py --mode article --content-id 2096024293196953340 --days 30
python3 scripts/fetch_data.py --mode trend  --content-id 2096024293196953340 --days 30
```

`--type` 取值 `article`（默认）/ `answer` / `pin`。禁止 `all`（返回 `error type`）。

## 依赖

- Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`（可用 `ZHIHU_CHROME_PATH` 覆盖）
- Profile：`C:\Users\Administrator\.dsh\browser-profiles\accounts\zhihu_b6e693fd522a184552486607f38126dd`（可用 `ZHIHU_PROFILE_DIR` 覆盖）
- Python：`playwright`
- 登录态失效时引导用户到「账号连接」重新登录 zhihu，不要重试原请求
