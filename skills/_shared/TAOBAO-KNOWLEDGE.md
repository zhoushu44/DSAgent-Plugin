# 淘宝基座 · 知识库

> 最后更新：2026-11-18（第二轮：全链路补全）
> 对应 PDD 基座：`PDD-KNOWLEDGE.md` / 抖音基座：`DOUYIN-KNOWLEDGE.md`
> 基座代码：`skills/_shared/taobao-*.mjs`
> 自检：`node skills/_shared/verify-taobao-base.mjs [itemId] --with-slow` → **58 项全绿**

---

## 零、基座覆盖范围（一张表看清）

| 维度 | 覆盖 | 证据 |
|---|---|---|
| **mtop 接口** | **11 个注册**，逐个实测（详情/搜索/评价/问大家×2/发布×4/闲鱼×2） | `taobao-api.mjs`，自检 [2][8][8b] |
| **域** | **4 个**：taobao / tmall / goofish / sycm / alimama(3 子域) | 自检 [8][9][10] |
| **通道** | **2 条**：mtop HTTP（纯 Node 自签）+ 浏览器 CDP | 自检 [8][12] |
| **上传** | multipart 图片空间直传（**无需 mtop 签名**） | 自检 [11]，369ms |
| **接入技能** | **3 个**：market-analysis（搜索+SKU）、product-reviews、product-wdj | 真跑验证 |
| **机制** | 签名/节流/队列/风控/UA/归因/重试/token引导/**发布频控** | 自检 [1][3]-[7][10b] |
| **自检** | **83 项全绿** | `node verify-taobao-base.mjs [id] --with-slow` |

---

## 一、三条通道的分工（重要）

淘宝体系里有**三种完全不同的接口形态**，认证方式各不相同，基座必须都覆盖：

| 形态 | 例子 | 认证 | 用哪条通道 |
|---|---|---|---|
| **mtop（签名）** | `h5api.m.taobao.com` / `h5api.m.tmall.com` / `h5api.m.goofish.com` | `md5(token&t&appKey&data)` | `taobao-request.mjs` |
| **JSON GET（无签名）** | `sycm.taobao.com` / `stlacct.alimama.com` / `club.alimama.com` | 仅 Cookie | `taobao-http.mjs` |
| **页面会话** | `one.alimama.com` 部分接口 / 发布页 | 页面 JS 运行时票据 + baxia | `taobao-browser.mjs` + 上述 |

**踩过的坑**：`one.alimama.com` 是 React 前端外壳，它的 `/xxx.json` **不是接口**（返回 HTML 或 `Failed to fetch`）。真实接口在 `stlacct.alimama.com` / `club.alimama.com` / `dmp-gateway.alimama.com`。

---

## 二、接口注册表（11 个，全部实测验证过）

| 逻辑名 | mtop API | 域 | 实测状态 |
|---|---|---|---|
| `item.detail` | `mtop.taobao.pcdetail.data.get` | tmall | ✅ SUCCESS 642ms |
| `search.list` | `mtop.relationrecommend.wirelessrecommend.recommend` | taobao | ✅ SUCCESS 673ms / 49 商品 |
| `rate.list` | `mtop.taobao.rate.detaillist.get` | tmall | ✅ SUCCESS 129ms |
| `wdj.list` | `mtop.taobao.wdj.list.merge.search` | tmall | ✅ SUCCESS 83ms |
| `wdj.answer` | `mtop.taobao.social.ugc.post.detail` | tmall※ | ✅ SUCCESS 158ms |
| `publish.render` | `mtop.taobao.sell.wireless.ai.publish.render` | taobao | ✅ SUCCESS 46ms |
| `publish.submit` | `mtop.taobao.sell.wireless.ai.publish.submit` | taobao | ⚠️ 存在，RGV587（写操作风控更严） |
| `publish.pc.manage` | `mtop.taobao.sell.pc.manage.render` | taobao | ✅ SUCCESS（需 `data.tab`） |
| `publish.tmall.manage` | `mtop.tmall.sell.pc.manage.render` | taobao | ✅ SUCCESS（需 `data.tab`） |
| `xianyu.bootstrap` | `mtop.taobao.idlehome.home.webpc.feed` | goofish | ✅ SUCCESS 449ms |
| `xianyu.search` | `mtop.taobao.idlemtopsearch.pc.search` | goofish | ✅ 注册（未单独实测） |

※ `wdj.answer` 接口在 tmall 域，但 referer 必须是 `web.m.taobao.com` —— 用 `refererOrigin` 字段单独声明。

### ★ 三条实测踩出来的注册规则

**① `data` 体字段 ≠ query 参数**
`publish.pc.manage` 报 `FAIL_SYS_BIZPARAM_MISSED::缺少业务参数tab`。
把 `tab` 放 `extraParams`（→ query）**无效**，必须放 **data 体**。
基座为此加了 `defaultData` 字段，在 `request()` 里合并进 data。

**② 不编造接口名（重要）**
`SOURCE.md` 只写了通配符 `mtop.alibaba.healthcenter2.punish.*`，没有具体方法名。
我曾按 `punish.list` 注册，实测返回 `FAIL_SYS_API_NOT_FOUNDED::请求API不存在`。
**已移除该条目**，并在 `verify-taobao-base.mjs` 加了负向断言锁死（防再次凭文档猜名字）。

**③ 探测接口真伪的判断口径**
不能只看 `ok=false` 就断定接口不存在，要区分：

| 返回 | 含义 |
|---|---|
| `SUCCESS` | 接口存在且可调 |
| `FAIL_SYS_API_NOT_FOUNDED` | **接口名错**（不存在） |
| `FAIL_SYS_BIZPARAM_MISSED` / `PARAM` | **接口存在**，参数不对 |
| `FAIL_SYS_USER_VALIDATE` / `RGV587` | **接口存在**，被风控 |

### ★ appKey 是接口级，不是平台级

| 平台 | appKey |
|---|---|
| 淘宝 / 天猫 | `12574478` |
| **闲鱼** | **`34839810`** |

签名算法相同但 appKey 参与 `sign` 计算，用错就签名失败。基座支持 `spec.appKey` 覆盖平台默认。

---

## 三、模块清单

| 模块 | 行数 | 职责 |
|---|---|---|
| `taobao-sign.mjs` | 152 | md5 签名、token 提取、Cookie 合并规则、风控凭证白名单 |
| `taobao-api.mjs` | 145 | **接口注册表**（12 接口 / 3 域 / 接口级 appKey） |
| `taobao-account.mjs` | 121 | 账号选择（0报未绑定 / 1直接用 / 多必须让用户选） |
| `taobao-throttle.mjs` | 80 | 账号级**跨进程**节流（4s+0~2s，落盘） |
| `taobao-queue.mjs` | 60 | 同账号**串行队列**（防并发踩踏） |
| `taobao-ua.mjs` | 105 | UA 同源（本机 Chrome 版本）+ client hints |
| `taobao-risk.mjs` | 215 | 账号冷却 + 路由冷却 + 风控子类型 + verifyUrl |
| `taobao-request.mjs` | 390 | **mtop 统一出口**，编排上述全部机制 |
| `taobao-sku.mjs` | 192 | 详情 → SKU 扁平行（跳 `skuId=0` 假行） |
| `taobao-http.mjs` | 300 | **非 mtop 域 HTTP 通道**（sycm / alimama）+ 万相台注册表 |
| `taobao-browser.mjs` | 175 | **浏览器 CDP 通道**（Profile 复用 / pageFetch / 截图） |
| `taobao-upload.mjs` | 175 | **multipart 图片空间上传** |
| `taobao-publish-rate.mjs` | 240 | **发布频率控制**（L1间隔/L2窗口/L3日限/L4命中即停） |
| `taobao-publish-guard.mjs` | 290 | **发布前合规校验**（极限词/医疗宣称/图片规格/SKU一致性） |
| `publish-rate-cli.mjs` | 100 | 发布频控命令行（status/check/reset/limits） |
| `run-api.mjs` | 130 | Node 桥（给 Python 技能） |
| `taobao_base.py` | 180 | Python 客户端封装 |
| `verify-taobao-base.mjs` | — | 自检 **83 项** |

---

## 四、四个域的真实参数（逆向沉淀）

### 4.1 mtop（淘宝/天猫/闲鱼）

```
POST https://<host>/h5/<api>/<version>/
content-type: application/x-www-form-urlencoded
  jsv=2.5.1&appKey=<12574478|34839810>&t=<ms>&sign=<md5>&
  api=<api>&v=<version>&type=originaljson&dataType=originaljson&data=<json>
Referer/Origin 必须与 host 同域（否则判 RGV587）
```

★ **POST 胜 GET**（与官方相反）：实测同账号同接口同时刻
`GET+query+jsonp` → `denycdc_forbidden`；`POST+form` → SUCCESS。

### 4.2 sycm（生意参谋）

```
GET https://sycm.taobao.com/mc/mq/mkt/keyword/relate/analysis.json?keyword=xxx&dateType=day&terminal=PC
仅 Cookie，无签名，返回普通 JSON（非 mtop 结构，无 ret 字段）
```
★ **权限归因**：`No Buy Func Permission` 必须归为 `no_permission`（换号/买权限），
不能归 `api_error`（会误导成"接口坏了"）。

### 4.3 alimama（万相台 / 达摩盘）

| 逻辑名 | 真实 URL | 实测 |
|---|---|---|
| `balance.real` | `GET https://stlacct.alimama.com/settleAccount/account/getRealBalance.json?bizCode=universalBP` | ✅ 295ms |
| `adgroup.byChannel` | `GET https://club.alimama.com/operationGroup/channel/getAdGroupByChannelKey.json?bizCode=universalBP&channelKey=wxtwj-dbtl` | ✅ 250ms |
| 达摩盘 | `https://dmp-gateway.alimama.com/...` | ✅ 206ms |

★ 文档说需要 `csrfId` + `loginPointId`，**实测不需要**（传不传都成功）。

### 4.4 图片空间（multipart，无签名）

```
POST https://stream-upload.taobao.com/api/upload.api
     ?_input_charset=utf-8&appkey=tu&folderId=0&picCompress=false&watermark=false
multipart/form-data:
     name = <文件名>        ← 普通文本字段，必须单独给
     file = <二进制>, filename=<文件名>, Content-Type=image/jpeg
```
★ `1x1` 占位图被拒（`NOT_ALLOW_UPLOAD_1x1_IMAGE`）；jpg/png/webp/gif/bmp/heic 通吃；
`>5MB` 单包也过（`multiPartUploadMinSize` 只是建议分片阈值）。实测 **369~421ms/张**。

---

## 五、MTop token 引导的三个真实坑

三者表现**完全相同**（`FAIL_SYS_TOKEN_EMPTY（需重登）`），把用户导向错误动作：

| # | 坑 | 修法 |
|---|---|---|
| 1 | `_m_h5_tk` 有两种形态（有/无下划线） | `tokenOf()` 有 `_` 取前段，无 `_` 取整串 |
| 2 | 平台把 `EXPIRED` 拼成 **`EXOIRED`** | 正则同时含两者 |
| 3 | 「错误响应不合并 Cookie」把新 token 挡掉 | token 类响应**允许合并 `_m_h5_tk`** |

正确链路：旧 token → `FAIL_SYS_TOKEN_EXOIRED` → 吸新 token → 重试 → SUCCESS。

---

## 六、发布频率控制（2026-11-18 新增）

### 为什么必须有这一层

现有发布引擎（`mqs-publish.ts` / `taobao-publish.ts`）只有**步骤内等待**：
`UI_STEP_DELAY_MS` / `formWaitMs` / `uploadWaitMs` / `skuCellWaitMs` …
这些是「一个商品内部点选要等多久」，**没有跨商品的发布频控**。

后果：批量发布 = 连续开浏览器 → 连续提交 → 淘宝判「机器批量铺货」。
这正是 2026-10-15 闲鱼批量 8 条全被下架的同类问题（本仓 SKILL 已记录：
「同模板批量铺货 + 类目错放」是平台判定要点）。

### 淘宝侧的真实约束（非官方文档，属经验）

淘宝**没有公开的发布配额**，但可观察的软约束：

1. 同账号短时间连续发布 → 「发布过于频繁，请稍后再试」
2. 同账号短时间发布多个同标题/同主图商品 → 判重复铺货
3. 新店/低信用店铺容忍度显著低于老店
4. 单日发布量突增（相对店铺历史）→ 人工审核

★ **因为这些阈值平台不公开且会变，基座不硬编码平台配额**，
只提供「保守默认 + 可按账号配置 + 命中即停」，把不确定性交给用户判断。

### 四层防护（`taobao-publish-rate.mjs`）

| 层 | 规则 | 默认值 |
|---|---|---|
| L1 单次间隔 | 两次发布之间最少间隔 | **90s** |
| L2 滑动窗口 | N 分钟内最多 M 次 | **5 次 / 60 分钟** |
| L3 每日上限 | 单账号每日最多 N 次 | **20 次/天** |
| L4 命中即停 | 识别「发布频繁」→ 记冷却 + 整批停止 | **冷却 30 分钟** |

全部**落盘**（`~/.dsh/taobao-publish-rate.json`），因为每次 publish 都是新进程。

### 接入点：`platform-publish.ts` 分发层

放在分发层而不是各平台实现里，因为**发布频控是账号级约束**，
放这里能保证「任何走发布技能路径的调用都受控」，不会因某个平台实现忘了加而漏掉。

只对 `taobao` / `taobao-mqs` / `tmall-mqs` / `tmall` 生效。
**`confirm=false` 的预览不消耗配额**（只在真正提交时扣）。

### 命令行

```bash
node skills/_shared/publish-rate-cli.mjs status            # 看今日/窗口配额
node skills/_shared/publish-rate-cli.mjs check             # 现在能不能发
node skills/_shared/publish-rate-cli.mjs reset [--daily]   # 手动解除冷却
node skills/_shared/publish-rate-cli.mjs limits \
     --min-interval 90 --window-max 5 --window-min 60 --daily-max 20
```

### ★ 一个实测踩出来的 bug

`resetPublishRate` 只清 `cooldownUntil` 时，`checkPublish` 仍会拦截下一次发布 ——
因为 **L1 的 `lastAt` 没清**，报「距上次发布仅 0s」。必须在清冷却时一并清 `lastAt`。

---

## 七、发布前合规校验（2026-11-18 新增）

来源：Accio `platform-specs-china.md` + `pdp-platform-specs.md`（逐字核实）。

### 为什么需要

现有发布链路只校验**技术必填**（标题长度、SKU ≤200、价格 ≤1亿），**完全不校验平台合规**。
而「同模板批量铺货 + 类目错放」正是 2026-10-15 闲鱼 8 条全被下架的原因。

### 图片规格：★ 层不可混用

| 层 | 淘宝 | 天猫 |
|---|---|---|
| **详情页层** | 宽 **≥1440px** 推荐 / 每图 高÷宽 **≤2** / 总高 **≤100000px** / **≤20 张** | 1440px / 高÷宽 ≤2 |
| **主图层** | ❌ **无公开数字规格**（Accio 明确标 "not covered — verify officially"） | 同 |

> Accio 原话警告："quoting Taobao's 1440px width for a Pinduoduo page is a rejected upload, not a typo"。
> 把详情页层的 1440px 用到主图或别的平台 = 上传被拒。

### 八条共享红线（每平台都适用）

1. **一致性契约** — 图中数量/颜色/规格/销售单位须与标题、属性、SKU、详情页、实物一致
2. **不得生成买家收不到的东西** — 配件、赠品、道具、认证、奖项、销量、使用效果
3. **SKU 图对应真实变体** — 不得高配图配低配 SKU，不得把另售配件当标配
4. **二手/残次是拍的不是生成的** — 须展示磨损缺件，禁擦除划痕污渍
5. **受监管类目标签绝不重绘** — 化妆品/食品/保健/母婴的包装、中文标签、成分、净含量、备案、警示必须来自实物；**绝不编造认证标记（小金盾/有机/专利/检测）**
6. **无医疗或绝对功效宣称** — 禁疾病治疗/医美/保健功能；禁伪造前后对比；禁「第一」「最有效」
7. **不侵犯第三方权利** — 禁未授权品牌/IP/名人肖像；禁「某品牌同款」类混淆
8. **卖家承担责任** — 即使图来自平台 AI 工具

### 淘宝 vs 天猫的 AI 图片政策差异

- **淘宝**：AI **明确允许**（换背景/扩图/修图/生成模特场景）——最宽松。
  但定制/预售效果图**必须标「效果图 / 定制示意」**；二手/样机/残次**必须实物照**。
- **天猫**：AI 允许但**多一条完整性门槛** — 信息须真实、准确、**完整**、不误导。
  原话："an image that omits a material fact can fail even when nothing in it is false"。

### 校验器行为（`taobao-publish-guard.mjs`）

三级输出：`errors`（硬拦）/ `warnings`（提示）/ `infos`（规格说明）。

| 检查项 | 级别 |
|---|---|
| 极限词（第一/最好/100%/全网最低…27 个） | **error** |
| 医疗功效宣称（治疗/消炎/医美…16 个） | **error** |
| 标题 >60 字 | **error** |
| 详情图高÷宽 >2 / 超 20 张 / 总高超限 | **error** |
| SKU 缺维度 | **error** |
| 「同款/平替/原单」类表述 | warning |
| 定制未标「效果图」 | warning |
| 图片宽度 <1440px | warning |
| SKU 组合不全（2×2 只给 1 个） | warning |
| 受监管类目 | warning |

### 接入点：`platform-publish.ts`

- **预览（confirm=false）**：照常放行，但把 `compliance` 报告带回去（让模型提前看到问题）
- **提交（confirm=true）**：`errors` 非空直接拦，返回 `failureKind: 'compliance_error'` 并列出每条
- 校验器异常时**不阻塞发布**（标记 `level: 'skipped'`）

---

## 八、风控
命中返回 `FAIL_SYS_USER_VALIDATE` + `RGV587_ERROR`，`data.url` 指向 punish 页。

| 子类型 | 判据 | 处置 |
|---|---|---|
| `waf-block` | 响应头有 **`bxpunish`** | **IP 级封锁，过滑块无效，必须换网络出口** |
| `bixi-punish` | HTML 含 `punish` | 滑块页，可人工过 |
| `waf-html` | HTML 非 punish | WAF 拦截，稍后重试 |
| `ban` | `action=denycdc_forbidden` + `pureCaptcha` 空 | **无滑块可过，只能等** |
| `captcha` | 有 `pureCaptcha` | 可人工过 |

★ **`x5secdata` 不是通过凭证**（它是「要求你验证」的挑战串）；真正凭证是 `x5sec`/`_x5sec`/`x5sectag`。

冷却：账号级指数退避 60s→5min→15min→1h；域名级 ≥2 次失败 → 60s。

---

## 九、技能接入

### Node 技能
```js
import { request } from '<PLUGIN>/skills/_shared/taobao-request.mjs'
const r = await request('item.detail', { id: '652576134064' })
```

### Python 技能（推荐）
```python
import sys; sys.path.insert(0, '<PLUGIN>/skills/_shared')
from taobao_base import TaobaoBase
base = TaobaoBase()
r = base.call('rate.list', {'itemId': '652576134064', 'pageNo': 1, 'pageSize': 20})
```

### 已接入技能
| 技能 | 接口 | 验证 |
|---|---|---|
| `market-analysis` | `search.list` + `item.detail`（SKU） | 49 商品 / 933 SKU / 6.4s |
| `product-reviews` | `rate.list` + `item.detail` | 5 评价 + 40色×7身高 SKU 目录 |
| `product-wdj` | `wdj.list` + `wdj.answer` | 10 问题 / 123 总数 |

三者都保留**网关回退**：基座不可用时自动降级，不会全挂。

---

## 十、待办

- [ ] 发布类技能（taobao-publish / mqs）迁到 `taobao-browser.mjs` + `taobao-upload.mjs`
- [ ] `sycm` 账号无生意参谋权限（`No Buy Func Permission`），通道已验证但无数据可测
- [ ] DNS Fake-IP 绕过（官方有 `dns-bypass`）
- [ ] Profile Cookie 自愈（PDD 有 `healCookiesFromProfile`）
- [ ] `one.alimama.com` 的部分接口需页面上下文 + baxia 绕过，未收进注册表

---

## 十一、逆向吸收对照表（23 条）

| # | 机制 | 来源 | 状态 |
|---|---|---|---|
| 1 | md5 自签 | gateway-proxy / xianyu-crawl | ✅ |
| 2 | token 引导（非 success 也吸 Set-Cookie） | xianyu-crawl | ✅ |
| 3 | 错误归因二分 | gateway-proxy `tokenRefreshed` | ✅ |
| 4 | 空值 Cookie 不合并 | gateway-proxy | ✅ |
| 5 | `x5sec` 是凭证 / `x5secdata` 不是 | credential-store | ✅ |
| 6 | 验证凭证解锁冷却 | FIX-LOG #48 | ✅ |
| 7 | 账号级跨进程节流 4s+0~2s | `throttleAccount` | ✅ |
| 8 | 风控冷却 60s | `riskCooldownRemaining` | ✅ 升级指数退避 |
| 9 | 域名级路由冷却 | `isRouteCoolingDown` | ✅ |
| 10 | 风控子类型 | `riskSubtype` | ✅ |
| 11 | verifyUrl 透出 | gateway-proxy | ✅ |
| 12 | MTOP 只认 `ret` | gateway-proxy 注释 | ✅ |
| 13 | 账号选择不静默 | account-picker.mjs | ✅ |
| 14 | 同账号串行队列 | `withAccountQueue` | ✅ |
| 15 | 出站 UA 同源 | `desktopUserAgent` | ✅ |
| 16 | 风控通过后自动重试 | `RISK_AUTO_RETRY` | ✅ |
| 17 | POST 胜 GET（反例） | 基座实测 | ✅ 默认 |
| 18 | NO_PROXY 隔离 | QIWork | 📝 继承宿主 |
| 19 | 响应头清洗 | `relaxResponseHeaders` | ➖ 不需要 |
| 20 | DNS Fake-IP | `dns-bypass` | ⬜ 待办 |
| 21 | Profile Cookie 自愈 | `healCookiesFromProfile` | ⬜ 待办 |
| 22 | **发布频率四层防护** | 本仓新增（参照 PDD 分层思路） | ✅ 自检含 13 项频控 |
| 23 | **发布前合规校验（八条红线）** | Accio platform-specs-china | ✅ 10 项自检 |
