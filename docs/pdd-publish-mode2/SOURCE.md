# 拼多多上架模式2 · 来源与同步（SOURCE）

> 用途：本目录（`docs/pdd-publish-mode2/`）是「上架模式2（请求劫持改包）」的复刻施工底稿，
> **全部核心设计（拦截机制、变换流水线、字段映射、Anti-Content 破解、消息协议）来自 Chrome 扩展「觅千手 v5.61」的逆向提取**，非本仓原创。
> 按《溯源文档规则》登记来源与同步流程。当模式2 链路出问题时，回到本文判断是「拼多多改版」还是「提取过时」。

---

## 1. 来源标识

| 项 | 值 |
|---|---|
| 主来源（逆向） | **Chrome 扩展「觅千手」v5.61**（MV3，扩展安装目录 + CDN 下发引擎） |
| 版本依据 | `src-mirror/manifest.json:4`（version 5.61）；`config/app-config.json:7`（versions 5.61） |
| 本体镜像 | `C:\Users\Administrator\AppData\Local\Temp\mqs-swarm\src-mirror\`（扩展包只读镜像） |
| CDN 引擎副本 | `scripts/_gm.js`（约 583 万字符 / 5.83MB，仅 12 个换行，单行压缩 bundle） |
| 关键模块 | `m_042_8087`（拼多多上架 S 类）、`m_062_8174`（Anti-Content 破解）、`service_worker_new.js`（SW 劫持）、`content_script_loader_v3.js`（双 world 桥） |
| 模块清单 | `rea-gm-modules/_manifest.json`（215 模块，swarm 拆分产物） |
| 提取时间 | 2026-10（本仓 r1~r3 逆向阶段，静态阅读，未执行扩展） |
| 提取方法 | REA + 本地 Node 脚本：按字符偏移从单行 bundle 切片 → 正则平衡引号 + 按 `;{}` 换行的简易美化 → 落盘 `extracted/`（44 段，已归档本目录 `evidence/`） |
| 分析文档 | `C:\Users\Administrator\mqs-swarm-docs-result\`（00-06 共 7 篇 + README；`verify-facts.mjs` 84 条坐标断言可复验） |
| 本地安装包位置 | `E:\360MoveData\Users\Administrator\Desktop\觅千手`（用户桌面目录，原始扩展来源） |

### 1.1 官方更新页（飞书）★ 核心字段

| 项 | 值 |
|---|---|
| 觅千手官方更新页 | **待补**（当前未从扩展内提取到官方飞书 wiki/官网链接；提取方法见 §2.5：搜 `_manifest.json` 元数据与扩展商店页字段） |
| 同类工具官方页（旁证） | 见 `skills/pdd-publish-2/SOURCE.md` §1.1（灰熊/神笔/天牛/福德/向风/上货精灵的飞书页） |

> 出问题时先看这里判断「拼多多改版」还是「我们提取过时」。

---

## 2. 提取/采集方法（可重复）

全部脚本保留在 `C:\Users\Administrator\AppData\Local\Temp\mqs-swarm\scripts\`，平台改版后按序重跑：

| 步骤 | 脚本 | 作用 |
|---|---|---|
| 1. 拆 bundle | `split-webpack-ts.mjs` | 把 5.83MB 单行 `_gm.js` 按 webpack 模块边界拆成 `rea-gm-modules/` 215 个模块 + `_manifest.json` |
| 2. 建偏移索引 | `find-offsets.mjs` / `find-offsets2.mjs` / `find-anti.mjs` / `find-gT.mjs` / `find-sw.mjs` / `find-sw2.mjs` | 符号（函数名/字符串常量）→ 字符偏移索引；输出全部命中偏移列表 |
| 3. 切片落盘 | `extract-8087.mjs` / `-round2` / `-round3` / `extract-anti.mjs` / `extract-sw.mjs` / `sw2` / `sw3` / `sw4` | 按偏移切出代码段 → 简易美化（引号平衡 + `;{}` 换行 + 缩进）→ 落盘 `extracted/` |
| 4. 归档 | 本目录 `archive-evidence.mjs` | `extracted/` → `docs/pdd-publish-mode2/evidence/`（幂等同步） |
| 5. 补官方页 | （手工） | 从扩展 `_manifest.json` / 商店列表页 / `config/app-config.json` 里找官方更新页链接，回填 §1.1 |

**已知坑（已固化，勿重踩）：**
- PowerShell `node -e` 内嵌引号会炸 → 一律写 `.mjs` 文件执行。
- 单行大文件的偏移是**字符偏移**，Read 工具的行 offset 读不了 → 一律 `String.slice(start, start+len)` 落盘再读。
- 锚点匹配要带完整签名 `方法名(e,t){`，`async xxx(` 前一字符可能是空格不是 `{,;`。
- REA 语义 trace（property seed）匹配不到类方法 → 直接偏移直读，效率更高。

---

## 3. 产物结构 / 锚点表

### 3.1 evidence/（44 段，`_manifest.json` 有字节清单）

**8087 系列**（页面世界 S 类，模块 m_042_8087）：
`transformRequestBody_def`（四步流水线入口）→ `fillImageData_def` / `fillSkuPriceData_def` / `fillShippingConfig_def` / `applyPddElecGoodsAttributes_def`（四步）→ `fillNoSpecSkuPriceDataInRequest_def`、`applyPddMarketReferencePrice_def`、`buildStablePriceDetailForFill_def`、`getOrderedSkuKeyIdsWithPrice_def`、`getPddStockMode_def`、`findPriceDataForMultiDimensionalSku_def`、`resolveSafePddOutGoodsSn_def`（辅助函数）→ `summarizeEditBody_def`（快照+页面重放+trace）、`setupMessageListener` / `pdd_transform_request_handler` / `transform_request_body_handler` / `send_modified_request_branch` / `transform_call_site` / `hijackWait_block` / `messageListener_pdd_cases` / `msg_listener_tail` / `localstorage_keys_table`（消息层）、`anti_generator_def` / `fetch_anti_105443` / `fetch_anti_85776` / `fetch_anti_97349` / `antiContent_passthrough` / `anti_content_172432`（Anti 调用点）、`const_underscore_34301`、`testFillSkuPrice_diag`

**sw 系列**（Service Worker，`service_worker_new.js`，字符偏移见文件名）：
`sw_hijack_goods_commit_51753`（常量表+DNR enable/disable+trace）、`webrequest_tail` @64650（劫持主流程全文）、`webrequest_tail2` @67650（proxy 兜底+收尾）、`handlePddSetHijackFlag_87605`、`finish_success_failure_62294`、`sendPagePddEditRequest_58940`、`sendProxyRequestOnce_57433`、`shouldUseProxyFallback_61112`、`transform_timeout_55198`、`sw_dnr_88623` / `sw_dnr_setup_23890` / `sw_dnr_update_52926`、`sw_webRequest_63874`、`sw_set_hijack_flag_74943`

### 3.2 原始偏移索引（`Temp\mqs-swarm\src-mirror\script\service_worker_new.js`，单行，字符偏移）

| 函数 | 偏移 |
|---|---|
| enablePddEditBlock / disablePddEditBlock | @53000 区 |
| transformRequestBodyWithTimeout | @55198 |
| sendProxyRequestOnce | @57433 |
| sendPagePddEditRequest | @58940 |
| shouldUseProxyFallback | @61112 |
| webRequest.onBeforeRequest 注册 | @63904 |
| finishHijackSuccess / Failure | @62294–63285 |
| pdd_set_hijack_flag 入口 | @74943 |
| handlePddSetHijackFlag | @87605 |

模块 m_042_8087（`_gm.js` 内）偏移见各 evidence 文件名尾数（如 `fillImageData_def @256635`）。

### 3.3 未切片整文件（复刻时直接读原文）

- `Temp\mqs-swarm\rea-gm-modules\m_062_8174.js`（8294B，Anti-Content 破解全文）
- `Temp\mqs-swarm\src-mirror\script\content_script_loader_v3.js`（10814B，双 world 桥协议全文）
- `Temp\mqs-swarm\src-mirror\script\interceptor\injected.js`（8096B）+ `content_interceptor.js`（3342B）+ `config.json`（2329B）——采集侧拦截器（与上架劫持是两套独立机制，模式2 不依赖）
- `Temp\mqs-swarm\rea-gm-modules\m_001_7095.js`（9292B，模式1 UI 自动化 12 步对照清单）

---

## 4. 已证伪的旧参考

| 参考 | 为什么错 |
|---|---|
| REA property-seed 语义 trace 定位类方法 | 匹配不到压缩 bundle 的类方法，全部改偏移直读 |
| Read 工具按行读单行大文件 | 单行文件行号恒为 1，行 offset 无意义，必须字符偏移 |
| Grep 统计单行文件 | 22 个匹配全落同 1 行，count 输出无意义，改用索引脚本 |
| `_gm.js` 内搜 fetch/XHR hook 找拦截 | 8087 模块内没有业务 hook——拦截靠 SW 的 DNR+webRequest，模块内 fetch 全是页面直调 |
| 把采集拦截器（injected.js）当上架机制 | 两者独立：采集拦 XHR 拿数据；上架拦提交改包。config.json 规则只含 taobao/tmall，不含 pdd |
| runtime.sendMessage 通道做页面↔SW 变换 | 8087 内被显式拒绝（`use_postMessage_channel`），实际全走 postMessage（source: `kdcm_extension_v3`） |

---

## 5. 同步更新流程（觅千手出新版 / 拼多多改版）

1. **拼多多改版（提交 403 / 接口 404 / anti 失效）**：先看 §1.1 官方页与同类工具飞书页——若同类工具同时公告失效，则是平台改版。
   - 接口路径变：重新真机抓 `goodsCommit` 提交 URL，更新 BLUEPRINT §2 常量表与拦截匹配（保持前缀宽松）。
   - anti 失效：重跑 §2 步骤 2 的 `find-anti.mjs`；在 webpackJsonp 模块里搜 `updateServerTime`/`messagePack` 特征定位新模块 id（替换 `fbeZ`）。
2. **觅千手出新版**：拿新版扩展包 → 更新 `src-mirror/` 镜像 → 重跑 §2 步骤 1~4（拆分/索引/切片/归档）→ diff `evidence/` 新旧版本差异 → 更新 BLUEPRINT.md 对应节 → 更新本文 §3 锚点表。
3. **回填**：任何 evidence 更名/新增/替换，同步 §3.1 清单与本表。

---

## 6. skill ↔ 来源映射（BLUEPRINT 章节 → 证据文件）

| BLUEPRINT 章节 | 内容 | 证据文件 |
|---|---|---|
| §2 常量表 | 全部常量/错误码 | `sw_hijack_goods_commit_51753` |
| §3.1 DNR | ruleId/条件/挂摘 | `sw_hijack_goods_commit_51753`、`sw_dnr_*` |
| §3.2 webRequest | 三重校验/主流程 | `webrequest_tail`、`sw_webRequest_63874` |
| §3.3 兜底判定 | 判定式 | `shouldUseProxyFallback_61112` |
| §4 流水线 | 四步 + 前后快照 | `transformRequestBody_def`、`summarizeEditBody_def` |
| §4.1 图片 | gallery/装修/视频 | `fillImageData_def` |
| §4.2 SKU | 匹配链/单买价/库存/货号 | `fillSkuPriceData_def`、`fillNoSpecSkuPriceDataInRequest_def`、`applyPddMarketReferencePrice_def`、`buildStablePriceDetailForFill_def`、`getOrderedSkuKeyIdsWithPrice_def`、`getPddStockMode_def`、`findPriceDataForMultiDimensionalSku_def`、`resolveSafePddOutGoodsSn_def` |
| §4.3 运费 | 模板/时效/折扣 | `fillShippingConfig_def` |
| §4.4 电子发货 | time_type/days_time | `applyPddElecGoodsAttributes_def` |
| §5.1 页面重放 | fetch + Anti-Content | `summarizeEditBody_def`（内含 `_pddPageSendModifiedEdit`）、`sw_sendPagePddEditRequest_58940` |
| §5.2 云端兜底 | proxyRequest | `sw_sendProxyRequestOnce_57433`、`webrequest_tail2` |
| §5.3 收尾 | 成功/失败/重载 | `finish_success_failure_62294` |
| §6 Anti-Content | webpackJsonp→sj('fbeZ') | `rea-gm-modules/m_062_8174.js`（整文件）、`anti_generator_def`、`fetch_anti_*` |
| §7 消息协议 | 全部 type/source/超时 | `src-mirror/script/content_script_loader_v3.js`（整文件）、`setupMessageListener`、`pdd_transform_request_handler`、`send_modified_request_branch`、`hijackWait_block` |
| §8 字段映射表 | 17 条映射 | 上述 §4 各证据 + `localstorage_keys_table` |
| 模式1 对照 | UI 自动化 12 步 | `rea-gm-modules/m_001_7095.js`（整文件） |
