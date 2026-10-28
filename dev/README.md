# dev/ — 调试与真机验证脚本

本目录是**开发期工具**，不是产品路径。产品路径是 host 工具（`dsagent_taobao_publish` 等）
和 `skills/*/scripts/*.py` 薄壳。这里的东西用于：接入新平台时探 DOM、单链路真机验证、逆向提取。

> ⚠️ 这些脚本 `import` 的是 `lib/` 编译产物。改完 `src/` 必须先 `npm run build:host` 再跑。

## 淘宝发布链路（2026-10-28 类目属性修复配套）

| 脚本 | 用途 |
|------|------|
| `publish-taobao-direct.mjs` | **真机发布**，走 `directPublishUrl` 直达 catId 发布页。`--catId=150708 --confirm --brand=007 --title="..."` |
| `probe-taobao-catprop.mjs` | 探「类目属性」区真实 DOM（label/required/struct-p-\*/容器链）。零风险，不填表不提交 |
| `probe-taobao-brand.mjs` | 探「品牌」属性能否自动填（combobox 键入 + 选中 + 回读）。零风险 |
| `probe-taobao-catid3.mjs` | 借引擎选类目能力拿 catId（搜索 → 点路径 → 填品牌让「确认下一步」可用 → 从跳转 URL 抓 catId） |
| `publish-taobao.mjs` | 旧版真机发布入口（扁平参数 + 相关性选类目）。保留作对照 |

四个脚本的实测结论已回填到 `skills/taobao-publish-mqs/SOURCE.md` §5.3。

## 逆向提取

| 脚本 | 用途 |
|------|------|
| `extract-mqs.mjs` | 从觅千手 `source/pageHooks.js` 提取函数体 / 关键词上下文。`fn <name>` / `ctx <kw> [before] [after]` / `grep <re>` |

> 觅千手本地包只含**搬家**能力（`pageHooks.js`），不含淘宝**发品**属性填充 ——
> 结论见 `skills/taobao-publish-mqs/SOURCE.md` §5.3.1。

## 其它

| 脚本 | 用途 |
|------|------|
| `taobao-batch-publish.mjs` | 淘宝批量发布 |
| `taobao-publish-image-space.mjs` | 图片空间逆向 HTTP 上传单测 |
| `diag-taobao-json.mjs` | dump `window.Json/Json2` 结构（排查 replayMode 字段路径） |
