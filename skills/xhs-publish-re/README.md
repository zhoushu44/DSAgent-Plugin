# 小红书·发布（逆向复现版）（xhs-publish-re）

小红书图文/视频笔记发布，支持**定时发布**与 **dry-run 自检**。

> **v3.0 架构：HTTP 主链路 + 页面兜底**
> 默认走纯 HTTP + 自算签名（不开浏览器）；只有签名被拒/风控/接口改版时，
> 才自动退回页面代签名（真 Chrome + UI 填表）。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（type / title / images / video / desc / timer / dry / confirm / fallback / account） |
| [SKILL.md](SKILL.md) | 技能全文：两条通道、逆向要点、错误处理 |
| [scripts/publish.mjs](scripts/publish.mjs) | 执行入口（校验 → L2 门禁 → HTTP 主链路 → 必要时页面兜底） |
| [cos_sign.cjs](cos_sign.cjs) | 腾讯云 COS v5 签名（视频直传用，被 `_shared/xhs-api.mjs` 复用） |
| `../../_shared/xhs-sign.mjs` | x-s / x-t / x-s-common 签名（逐字节对齐 `xiaohongshu-crawl/scripts/xhs_sign.py`） |
| `../../_shared/xhs-api.mjs` | HTTP 接口封装（上传 / permit / COS PUT / 提交笔记） |
| `../../_shared/xhs-browser.mjs` | 浏览器会话（**仅兜底用**：Profile 复用 + Cookie 注入 + 页面代签名） |

## 用法

```bash
# 1) 预览（不提交，L2 门禁）
node scripts/publish.mjs --type image --title "标题" --images "a.jpg,b.jpg"

# 2) dry-run 自检（验证签名 + 登录态 + 素材，不发布）
node scripts/publish.mjs --type video --title "test" --video "a.mp4" --dry true

# 3) 确认发布（立即）
node scripts/publish.mjs --type image --title "标题" --images "a.jpg" --confirm true

# 4) 确认发布（定时）
node scripts/publish.mjs --type video --title "标题" --video "a.mp4" --timer "2026-10-25 20:00" --confirm true

# 5) 强制走页面兜底
node scripts/publish.mjs --type image --title "标题" --images "a.jpg" --fallback page --confirm true
```

## dry-run 会做什么

| 检查 | 判据 |
|---|---|
| 签名有效性 | homefeed 免登录接口做「正确签名 vs 篡改签名」对照：正确 200 且篡改 ≠200 |
| 登录态 | `GET /api/sns/web/v2/user/me` 的 `code` |
| 素材 | 存在性 / 大小 / 扩展名 |

输出里的 `publishable` 直接告诉你「现在能不能发」。

## 关键约束

- **POST body 必须用 `signHeaders` 返回的 bodyStr 原样发送**（重新序列化会导致 461）
- **COS key 必须精确等于 permit.fileIds[0]**（加后缀 → `401 upload token deny`）
- 标题 ≤20 字，正文 ≤1000 字，图文 ≤18 张

## 验证脚本

```bash
# 与 Python 版签名逐字节一致性（离线，含 ARC4/CRC32/b1）
node ../_shared/verify-xhs-sign-parity.mjs

# 签名是否被平台接受（在线对照实验）
node ../_shared/verify-xhs-sign-live.mjs
```

## 迁移对照（v1 → v3）

| 旧文件 | 处理 |
|---|---|
| `scripts/publish.py` | 已删除，逻辑并入 `scripts/publish.mjs` |
| `sign_service.cjs` | 已删除，`PAGE_HOOK` 迁到 `_shared/xhs-browser.mjs`（仅兜底） |
| `xhs_publish.cjs` | 已删除，UI 流程并入 `publish.mjs::publishViaPage()` |
| `cos_sign.cjs` | **保留**，`xhs-api.mjs::uploadVideoToCos()` 通过 `createRequire` 复用 |

## 相关技能

- 采集笔记：`xiaohongshu-crawl`
- 数据分析：`xiaohongshu-analytics`
- 原版发布（host 工具直驱）：`xiaohongshu-publish`
