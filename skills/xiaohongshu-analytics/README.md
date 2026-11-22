# 小红书·数据分析（xiaohongshu-analytics）

统计当前登录账号自己的小红书笔记数据：发布状态、时间、互动数，输出指标汇总与结论。

> **v3.0 架构：HTTP 主链路 + 页面兜底**
> 默认 `GET /api/sns/web/v1/note_list`（纯 HTTP，秒级）；
> 签名被拒/风控/改版时自动退回页面 DOM 采集。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（mode / note_id / limit / csv / fallback / account） |
| [SKILL.md](SKILL.md) | 技能全文 |
| [scripts/fetch.mjs](scripts/fetch.mjs) | 执行入口 |
| `../../_shared/xhs-api.mjs` | HTTP 接口（含 `normalizeNoteList` 响应归一） |
| `../../_shared/xhs-browser.mjs` | 浏览器会话（仅兜底用） |

## 模式

| mode | 用途 | 状态 |
|------|------|------|
| `overview` | 笔记列表 + 指标汇总（默认） | ✅ |
| `list` | 仅笔记列表 | ✅ |
| `detail` | 单篇详情 | 预留（降级为列表内定位，`degraded: true`） |
| `trend` | 单篇日趋势 | 预留 |

## 用法

```bash
node scripts/fetch.mjs --mode overview --limit 50 [--csv]
node scripts/fetch.mjs --mode list --limit 100
node scripts/fetch.mjs --mode list --fallback page   # 强制走页面 DOM
```

结果里的 `channel` 标明走的是 `http` 还是 `page`。

## 前置

- 「账号连接」绑定 **xhs** 账号
- Node（兜底通道还需 Chrome/Edge）
- 账号过期时主链路会返回 `token_expired`，**不会**开浏览器白等

## 迁移对照（v1 → v3）

| 文件 | 处理 |
|---|---|
| `scripts/fetch_data.py` | 已删除，逻辑并入 `scripts/fetch.mjs` |
| `sign_service.cjs` | 已删除（原常驻 8787 签名服务） |
| `xiaohongshu_analytics/` | 已删除（旧占位包，含一份未接入的 sign.py） |
| `.secrets/` | 已删除（旧手工 cookie 文件，凭证统一走凭证库） |

## 相关技能

- 发布笔记：`xhs-publish-re` / `xiaohongshu-publish`
- 关键词采集：`xiaohongshu-crawl`
