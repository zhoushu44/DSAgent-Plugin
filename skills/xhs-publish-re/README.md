# 小红书·发布（逆向复现版）（xhs-publish-re）

小红书图文/视频笔记发布，支持**定时发布**与 **dry-run 链路自检**。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（type / title / images / video / desc / timer / dry / confirm / port / account） |
| [SKILL.md](SKILL.md) | 技能全文：触发词、边界、逆向实现要点、错误处理 |
| [scripts/publish.py](scripts/publish.py) | 执行脚本（校验 → L2 门禁 → 拉起 sign_service → 调 xhs_publish.cjs） |
| [xhs_publish.cjs](xhs_publish.cjs) | Node 侧发布主流程（UI 驱动 + CustomEvent 穿透 closed shadow） |
| [sign_service.cjs](sign_service.cjs) | 常驻签名服务（真实 Chrome + 登录态 + 页面内请求代理） |
| [cos_sign.cjs](cos_sign.cjs) | 腾讯云 COS v5 签名复现器（上传链路用） |

## 用法

```bash
# 1) 预览（不提交，L2 门禁）
python3 scripts/publish.py --type image --title "标题" --images "a.jpg,b.jpg"

# 2) dry-run 链路自检（填表但不发布）
python3 scripts/publish.py --type video --title "test" --video "a.mp4" --dry true

# 3) 确认发布（立即）
python3 scripts/publish.py --type image --title "标题" --images "a.jpg" --confirm true

# 4) 确认发布（定时）
python3 scripts/publish.py --type video --title "标题" --video "a.mp4" --timer "2026-10-25 20:00" --confirm true
```

## 与 xiaohongshu-publish 的差异

| 能力 | xiaohongshu-publish | xhs-publish-re |
|---|---|---|
| 图文 / 视频发布 | ✅ | ✅ |
| 定时发布 | ❌ | ✅ |
| dry-run 自检 | ❌ | ✅ |
| Vue3 标题同步 | ⚠️ 可能丢 | ✅ 原生 setter |
| closed shadow 按钮 | ❌ 点不到 | ✅ CustomEvent |

## 前置

- 「账号连接」绑定 **xhs** 账号（登录态有效期短，过期需重新登录）
- 本机 Node.js + Chrome
- 首次运行自动拉起 `sign_service.cjs`（后台，端口 8787）；日志见技能目录 `sign_service.log`

> 注：脚本用 `.cjs` 后缀，因 DSAgent-Plugin 的 `package.json` 声明了 `"type": "module"`，
> `.js` 会被 Node 当 ESM 导致 `require is not defined`。

## 相关技能

- 采集笔记：`xiaohongshu-crawl`
- 数据分析：`xiaohongshu-analytics`
- 原版发布（host 工具直驱）：`xiaohongshu-publish`
