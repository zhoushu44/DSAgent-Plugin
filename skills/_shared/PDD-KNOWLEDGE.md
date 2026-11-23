# 拼多多基座 · 知识库

> 最后更新：2026-11-10
> 合并自 9 份分析文档，本文是**唯一权威版本**

---

## 目录

1. [架构总览](#一架构总览)
2. [签名体系](#二签名体系)
3. [通道矩阵](#三通道矩阵)
4. [接口参数规则](#四接口参数规则)
5. [限流机制](#五限流机制)
6. [种子维护](#六种子维护)
7. [能力边界](#七能力边界)
8. [踩坑记录](#八踩坑记录)
9. [**类目 / 模板（纯 Node）**](#九类目--模板纯-node)
10. [**账号 key 漂移**](#十账号-key-漂移pdd_mms-专属)
11. [上架图片规格与预处理](#十八上架图片规格与预处理吸收自-imgpreppy)
12. [规格区视觉识别](#十九规格区属性区视觉识别吸收自-analyze_spec_uipy)

---

## 一、架构总览

### 三个域，三套保护

| 域 | 域名 | 签名位置 | 保护强度 |
|---|---|---|---|
| 商家后台 | `mms.pinduoduo.com` | header `Anti-Content` | **JVM2 虚拟机**（最强） |
| 推广后台 | `yingxiao.pinduoduo.com` | body `crawlerInfo` | 普通混淆 |
| 视频/直播 | `live.pinduoduo.com` | header `VerifyAuthToken` | 需独立权限 |

### 统一入口

```
skill → pdd-guard.openTask()  （准入 + 节流 + 种子维护）
           ↓
     pdd-request.mjs          （统一请求入口）
           ├─ 自动识别域
           ├─ Node 优先（有种子时）
           └─ 失败自动降级浏览器
```

---

## 二、签名体系

### 商品域：JVM2 虚拟机（已完全逆向）

**指令集**：63 个操作码，全部还原
**反汇编**：2137 条指令 100% 合法
**加密**：三层，完全可逆

```
① 块级流密码    raw ^= mix32(cryptoKey ^ imul(offset+1, 668265261)) & 0xFF
② 指令级 XOR    (enc ^ key) & 0xFF → 仿射双射求逆
③ 操作数掩码    operandMaskByte(opcodeKey, cursor)

KDF: mix32(SEED ^ kdfDomain(domain) ^ imul(a+1,2654435761) ^ imul(b+1,2246822507) ^ imul(c+1,668265261))
SEED = 3516619612
```

**关键开关**：
```js
messagePack({ antiVersion: 'v1' })   // → 0as（有效）
messagePack('')                       // → 0at（无效）
```

机制（反汇编得出）：
```
getMessage:
  local2.antiVersion === 'v1' ? antiVersion = 'v1' : 'v2'
  antiVersion === 'v2' ? 用 '0at' : 用 '0as'
```

### 推广域：普通 JS（无虚拟机）

**SDK**：rspack 模块 `22768`，100KB UMD
**接口**：`new SDK({serverTime}).messagePack()`
**签名**：`0as*q` 开头

```js
// 提取方式
const chunks = window.rspackChunk_N_E
const mods = {}
for (const c of chunks) Object.assign(mods, c[1])
const m = { exports: {} }
mods['22768'].call(m.exports, m, m.exports, (id) => mods[id])
const SDK = m.exports.default
```

### 签名格式对照

| 域 | 前缀 | 长度 | payload | 绑定 |
|---|---|---|---|---|
| 商品 | `0as*x` | 411 | 302 字节 | URL |
| 推广 | `0as*q` | 424 | 314 字节 | **URL + body** |

**推广域签名不可重放**（绑定 body），商品域可重放。

---

## 三、通道矩阵

| 通道 | 模块 | 浏览器 | 签名 | 适用 |
|---|---|---|---|---|
| `t1` | pdd-http.mjs | ❌ | 简化 | `/sydney/` `/earth/` `/lakemms/` |
| **`t2n`** | **pdd-vodka-signer.mjs** | **❌** | **0as** | **`/vodka/` `/glide/`（首选）** |
| `t2` | pdd-client.mjs | ✅ | 0as | 无种子兜底 |
| `t3` | pdd-client.mjs | ✅ | 0as+webSpiderRule | 商品明细（必须浏览器） |
| **混合** | **pdd-promo-signer-hybrid.mjs** | **签名阶段需要** | 推广域/live 域 | **`/mms-gateway/`（推广）`live.`（视频）** |

### ★ 混合通道（2026-11-09）

**为什么需要**：推广域签名器是普通 JS 混淆，纯 jsdom 复刻**实测不可能**（jsdom 运行时语义与浏览器不同，不是环境变量问题）。

**怎么做**：**真实 Chrome 负责签名，Node 负责发请求**。

| 域 | Chrome 的职责 | Node 的职责 |
|---|---|---|
| yingxiao | 跑 SDK 生成 `crawlerInfo`（+ 同串 `anti-content` 头） | 带签名发 HTTP |
| live | 提供 Profile 里的 Cookie（含 `msfe-pc-cookie-captcha-token`） | 带 `VerifyAuthToken` 头发 HTTP |

**实现要点**：
- Chrome 用**账号自己的 Profile**（`~/.dsh/browser-profiles/accounts/<shopKey>`），所以登录态和浏览器一致
- Cookie 从 CDP `Storage.getCookies` 取（**不能用** `Network.getCookies`，Cookie DB 被 Chrome 锁住）
- 签名器常驻会占住事件循环 → skill 结束必须 `closeChannels()`

### 性能

| 通道 | 耗时 |
|---|---|
| 纯 Node | **58~330ms** |
| 混合（Chrome 签名 + Node 发） | 请求本身同纯 Node；**浏览器常驻成本 ~8s/次会话** |
| 浏览器 | 28000ms |

---

## 四、接口参数规则

### 命名规则（重要）

| 位置 | 规则 | 示例 |
|---|---|---|
| **请求参数** | **驼峰** | `goodsId` / `goodsIds[]` |
| **返回字段** | **下划线** | `goods_id` / `goods_commit_id` |

### 已知接口参数

| 接口 | 参数 | 备注 |
|---|---|---|
| `glide/.../addProperties/goodsList` | `{page_num, page_size, only_query_no_props_goods:false, only_query_un_auth_brand:false}` | `un_auth_brand:true` 会返回 0 条 |
| `vodka/.../query/sku/info` | `{goodsId}` | 用 `goods_id` 报 3000000 |
| `vodka/.../batchOnSale` | `{goodsIds:[id]}` | |
| `vodka/.../common/query/status` | `{}` | |
| `yingxiao/.../getAdvertiserDailyCosts` | `{}` | 成功码是 **1000** 不是 1000000 |
| `sydney/.../queryGoodsDetailVOList` | `{startDate,endDate,queryType:6,sortCol:0,sortType:1,pageNum,pageSize,actVs:1}` | 用 `beginDate` 报「开始结束时间不能为空」 |
| `chance-goods/get_hot_search_goods` | `{page,page_size,statistic_type}` | 缺 `statistic_type` → **http 500** |

### ★ 基座级默认 body（2026-11-09 新增）

拼多多的 body 字段名是**它自己定的**（`scenesMode` / `clientType` / `blockType` / `queryConfigList`…），
不抄真实请求就调不通 —— 之前 11 个推广接口全部 `ec=40001`，根因就是 body 缺字段（**不是签名问题**）。

**现在默认 body 表放在基座**（`pdd-api.mjs` 的 `API_BODY_DEFAULTS`），
`request()` 自动合并，**每个 skill 都不用改**。

| 能力 | 说明 |
|---|---|
| 表 | `API_BODY_DEFAULTS`（键 = 去掉 `/mms-gateway/` 前缀和前导 `/` 的路径） |
| 合并 | 显式传入的字段优先；`opts.noBodyDefaults` 可关掉 |
| 占位符 | `{{today}}` `{{yesterday}}` `{{mallId}}` 递归替换 |
| **mallId** | **基座自动解析**（`venus/api/user/userInfo`，按 shopKey 缓存）—— 它是**店铺级**的，不能写死 |

### ★ 报表接口的 body 形状（挖 JS bundle 的方法）

`poseidon/api/report/queryEntityReport` 猜了 5 版全 500，最后从页面 chunk 的调用点挖出真相
（`4271-*.js` 的 `getEntityTable`）：

```js
{
  entityId: mallId,          // 店铺级
  entityDimensionType: 0,    // MALL
  queryDimensionType: 2,     // UNIT
  reportPromotionType: 9,    // Goods
  blockTypes: [6],           // ReportTable
  startDate, endDate,
  queryRange: { pageNumber, pageSize },   // ★ 嵌套对象，不是顶层
  orderBy: 9999, orderType: 1,             // ★ orderType 必须为 1，填 0 服务端 500
  clientType: 1,                           // PC
  returnTotalSumReport: true,
}
```

**枚举值从 chunk 里挖**：`MALL=0 PLAN=1 UNIT=2 CREATIVE=4 AD_CREATIVE=11 SHOW=13`、
`ReportTable=6`、`Goods=9`、`PC=1`。

### 返回结构

```json
// glide/addProperties/goodsList
{ "total": 180, "list": [{ "goods_id": ..., "goods_name": ..., "goods_commit_id": ... }] }
```

**是 `result.list`，不是 `result.goodsList`。**

---

## 五、限流机制

### 实测数据

| 测试 | 结果 |
|---|---|
| 轻接口 1 秒间隔 × 20 次 | **20/20 全过** |
| 重接口 2 秒间隔 × 12 次 | **12/12 全过** |
| 重接口**零间隔** × 30 次 | **30/30 全过** |

**只读接口没有速率限制。**

### 真正的限流诱因

**60 秒内访问 > 12 个不同接口** → 触发「操作太过频繁」

**平台拦的是扫描式探测，不是正常业务。**

### 54001 的三种语义

| 类型 | 判据 | 处理 |
|---|---|---|
| **限流** | msg 含「频繁/稍后」且无 verifyAuthToken | 等 90 秒 |
| **真风控** | 带 verifyAuthToken | 指数退避 60s×2^(n-1) |
| **签名不匹配** | 其它 | 检查参数 |

### 节流配置

```js
readGapMs: 150,          // 读接口
writeGapMs: 3000,        // 写接口
scanWindowMs: 60000,     // 扫描检测窗口
scanDistinctLimit: 12,   // 不同接口上限
scanCooldownMs: 90000,   // 触发后冷却
```

---

## 六、种子维护

### 为什么需要

纯 Node 签名依赖 localStorage：
```
ISLOGIN=1
MMS-LOGIN-FP
_nano_fp
new_userinfo
mms.pmm.did.2
```

这些会随登录态变化 → 过期 → 签名被拒。

### 自动维护（挂在 openTask）

| 触发 | 动作 | 阻塞 |
|---|---|---|
| 种子不存在 | 立即导出 | ✅ |
| 损坏/字段缺失 | 立即导出 | ✅ |
| 超过 7 天 | 后台刷新 | ❌ |
| 连续 2 次签名失败 | 立即刷新 | ❌ |

**防抖 10 分钟，urgent 级无视防抖。**

### 存储位置

```
~/.dsh/pdd-risk-seeds/<shopKey>.json    种子
~/.dsh/pdd-seed-state.json              刷新状态
~/.dsh/pdd-risk-sdk/promo-sdk.mjs       推广 SDK（98KB）
~/.dsh/pdd-risk-sdk/react_anti.decoded.js  商品 SDK（143KB）
```

---

## 七、Cookie 自愈（2026-11-09 新增）

### 问题

凭证库里存的是**登录时那一份 Cookie 快照**，会过期（`43001 会话已过期`）；
但**同一个浏览器 Profile 里的会话还是活的** —— 实测同一时刻：
凭证库 Cookie 43001，Profile 打开推广页正常。

### 机制

```
request() 收到 43001
   ↓
从 Profile 浏览器 CDP Storage.getCookies 取实时 Cookie（过滤 *.pinduoduo.com）
   ↓
写回凭证库 store.setCookies(shopKey, jar)   ← 落盘，下次直接快
   ↓
用新 Cookie 重放一次原请求
```

### 效果

| 域 | 自愈前 | 自愈后 |
|---|---|---|
| mms `commonMallInfo` | 43001 | ✅ ok |
| shop / works / chance / promo | 全部 43001 | ✅ 全通 |

**这是基座能力** —— 所有拼多多 skill 自动受益，不用逐个改。

### 只在「会话失效」时触发

`43001` 才自愈；限流（`54001`/`100001`/`429`）**绝不**自愈 —— 那两种越试越糟。

---

## 八、能力边界

### ✅ 纯 Node 稳定（15 个）

| 接口 | 域 | 参数 |
|---|---|---|
| `goods.listGlide` | glide | `{page_num, page_size, only_query_no_props_goods:false, only_query_un_auth_brand:false}` |
| `goods.skuInfo` | vodka | `{goodsId}` |
| `goods.batchOnSale` | vodka | `{goodsIds:[id]}` |
| `goods.count` | vodka | `{}` |
| `goods.copyedExist` | vodka | `{}` |
| `goods.newStyleGray` | vodka | `{}` |
| `common.status` | vodka | `{}` |
| `shop.info` | earth | `{}` |
| `shop.flow` | sydney | `{}` |
| `chance.home` | opportunity-goods | `{}` |
| `promo.dailyCost` | yingxiao | `{}`（不稳定，会降级） |

### ✅ 纯 Node 可用（2026-11-09 全量审计：89 个接口，42 个通）

| 域 | 通过/总数 | 状态 |
|---|---|---|
| `shop` | **11/12** | ✅ 几乎全通（店铺流量/评分/商品明细/DSR） |
| `chance` | **9/11** | ✅ 机会商品几乎全通 |
| `promo` | **14/21** | ✅ 读接口全通；剩下 7 个是**写操作**（缺业务参数） |
| `goods` | 5/18 | ⚠️ 见下方限制 |
| `act` | 2/7 | ⚠️ 活动域 2 小时频控 |
| `common` | 1/1 | ✅ |
| `video` | 0/15 | ❌ 见下方限制 |
| `aivideo` | 0/4 | ❌ 独立鉴权域 |

**读接口基本全通**；不通的那批里 **17 个是写操作**（报「参数校验失败」= 传输层是好的，只是缺 adId/goodsId 这类业务参数）。

### ❌ 真正的硬缺口

| 项 | 数量 | 原因 | 谁能解 |
|---|---|---|---|
| **视频域** `live.pinduoduo.com` | 15 | **账号没登录 live.pinduoduo.com**（浏览器直接跳 `/login`，拿不到 `msfe-pc-cookie-captcha-token`） | **用户**：在该 Profile 登录一次多多视频创作者后台，基座自动接管 |
| **AI 素材域** `/api/banner-intelligent/` | 4 | 连接层就失败（ec=0），独立鉴权 | 需要单独打通 |
| `chance.total_info` | 1 | **拼多多服务端 500**（页面自己也是 500） | 拼多多 |
| `mall/goodsList` 族 | 5 | **服务端对该账号的接口族限制**（浏览器也 54001）；已用 `goods.listGlide` 替代，skill 不受影响 | 换账号 |
| `lakemms` 活动域 | 3 | `100001` 2 小时频控（连打触发） | 等冷却 |

### 写操作现状

| 操作 | 现状 |
|---|---|
| 推广域 6 个写接口 | **body 已抓到**（在 `promo.mjs`），Node 通道已通（混合签名），只差接业务参数 |
| 商品上架 | 走 `pdd-publish`，图片规整 + 改包重放链路已通 |
| 商品上下架 / 改价 | 浏览器路径可用，Node 路径受 `mall` 接口族限制 |

---

## 九、踩坑记录

### ① `_` 不是分隔符

**错误**：`sig.split('_')` 当成多段数据

**真相**：`_` 和 `-` 都是 **URL-safe Base64** 的合法字符

**教训**：签名是 `前缀 + Base64(二进制)`，不是分段拼接

### ② `54001` 不等于签名无效

**错误**：看到 54001 就换签名重试

**真相**：54001 还表示「限流」和「签名与请求不匹配」

**教训**：先看 `error_msg` 和 `verifyAuthToken`

### ③ Cookie 和 localStorage 的 `_nano_fp` 本来就不同

**错误**：用两者比对判断登录态

**真相**：Cookie 是会话级，localStorage 是设备级

**教训**：这个判据会导致无限刷新

### ④ 参数是驼峰，返回是下划线

**错误**：请求用 `goods_id`

**真相**：请求要 `goodsId`，返回才是 `goods_id`

### ⑤ 推广域签名不可重放

**错误**：复用同一签名打多个接口

**真相**：推广签名绑定 body，每次必须重新生成

### ⑥ 检查器的 false positive

`check-pdd-guard.mjs` 的 [7] 原来只要文件里同时有 `fetch(` 和 `page.evaluate(` 就报警。

**修正**：只在 `page.evaluate` 的实参块内扫描 `fetch`（括号配对）。

### ⑦ 推广域 40001 的真正根因是 body，不是签名（2026-11-09）

**错误**：11 个推广接口全 40001 → 以为是签名不对，反复换签名器

**真相**：推广域**签名必须同时出现在两处**（body `crawlerInfo` **和** header `anti-content`，同一个字符串），
且 body 里还缺拼多多自有字段（`scenesMode`/`clientType`/`blockType`…）。签名对了、body 不全，照样 40001。

**教训**：40001 先查 body 字段，再查签名位置。

### ⑧ async `beforeExit` 会让进程永不退出

**错误**：`process.on('beforeExit', async () => { await closeChannels() })`

**真相**：async 的 `beforeExit` 处理器会让 Node **反复重触发**它（回调把事件循环填满 → 触发 beforeExit → 又填满），
进程永远不退出。

**修正**：改成显式 `shutdown()`，在出结果前和每个 `process.exit()` 前调用。

### ⑨ SIGKILL 杀 Chrome 只杀父进程会留 Profile 锁

**错误**：`browser.close()` 后直接删 `SingletonLock`

**真相**：Chrome 被 SIGKILL 时，**子渲染进程还活着**并占着 Profile 锁 → 下次启动报
`Failed to launch the browser process!`

**修正**：退出时 `taskkill /PID <pid> /T /F` 杀**整棵进程树**；启动再加重试（4s/8s 退避）。

### ⑩ 默认 body 表的键要剥前导 `/`

**错误**：默认表键写 `sydney/api/...`，查找时用 `path.replace(/^\/mms-gateway\//,'')` → 得到 `/sydney/api/...`（**多一个斜杠**）

**真相**：mms 域路径不带 `/mms-gateway/` 前缀，剥不掉 → **全部 mms 类接口都没命中默认 body** → 报「开始结束时间不能为空」

**修正**：`.replace(/^\/mms-gateway\//,'').replace(/^\//,'')`。

### ⑪ `{{mallId}}` 不能写死

**错误**：默认 body 里 `entityId: 800050996`

**真相**：mall_id 是**店铺级**的，换账号就是另一个值，写死必错（而且报表接口全 500）

**修正**：基座按 shopKey 自动解析并缓存（`venus/api/user/userInfo`）。

### ⑫ 抽到 chunk 的调用点比猜 body 快 10 倍

`getEntityReport` 的 body 猜了 5 版全 500；从页面 chunk 的 `getEntityTable` 一眼看穿：
`queryRange` 是**嵌套对象**、`orderType` 必须为 **1**（填 0 服务端 500）。

**方法**：进页面 → `document.scripts` 拿 chunk → 逐个 `fetch` 下来 → 搜接口路径 → 看 `post()` 的第二个参数。

---

## 九、类目 / 模板（纯 Node）

**2026-11-10 收进基座注册表 —— 选类目、拉属性模板都不需要浏览器。**

| 注册名 | 路径 | 方法 | 说明 |
|---|---|---|---|
| `mms.categorySearch` | `/vodka/v2/mms/search/categories/v2` | GET | 关键词 → 类目树（`?keyword=`） |
| `mms.mallTemplate` | `/draco-ms/mms/template/mall` | GET | 叶子 catId → 属性 + 规格维度（`?catId=`） |

### GET 查询参数由基座拼

注册表加 `query: ['catId']`，调用方直接给对象，基座负责 URL 编码和拼接：

```js
await callApi('mms.mallTemplate', { catId: 8463 }, { account, shopKey })
// → GET /draco-ms/mms/template/mall?catId=8463
```

也支持路径占位符 `path: '/x/{catId}'`（同样从 body 取值）。

### 返回结构坑

`categories/v2` 的返回**顶层就是 `cat_info_v2_lists`**，不是文档写的 `result.cat_info_v2_lists`。
代码里两种都兼容。

### 只有叶子类目有模板

传一级/二级类目 → 接口 200 + `modules: []`（**不是报错**）。
`templateId=0` 且 0 属性 0 规格维 = 空模板 → CLI 报 `EMPTY_TEMPLATE`、退出码 1，
绝不能让上层拿空模板去填表。

### 实测数据（空空商行）

| 关键词 | 类目路径 | catId | templateId | 属性 | 规格维 |
|---|---|---|---|---|---|
| T恤 | 女装/女士精品 > T恤 > T恤 | 8463 | 53657 | 15 | 2（颜色分类 115 预设 / 尺码 91 预设），SKU 上限 900 |
| 保温杯 | 餐饮具 > 杯子/水杯/水壶 > 保温杯/保冷杯 | 16557 | 40001 | 13 | 0（该类目不开放规格） |

耗时：单次 2~5 秒（含签名），全程 `channel=node`。

### CLI

```bash
node skills/pdd-publish/scripts/pdd-category.mjs search   --keyword "T恤"
node skills/pdd-publish/scripts/pdd-category.mjs template --cat-id 8463 --save
node skills/pdd-publish/scripts/pdd-category.mjs resolve  --keyword "保温杯" --save
```

---

## 十、账号 key 漂移（pdd_mms 专属）

### 现象

同一个店铺的 shop_key 会**自己变**：
`pdd_mms_975543fcd3…` → `pdd_mms_3fa2ee60c6…` → `pdd_mms_25f216caa8…`

### 根因

`lib/services/credential-store.js` 里 `ACCOUNT_ID_FROM.pdd_mms = 'PASS_ID'` ——
商家后台没有独立的数字店铺 ID，只能拿 `PASS_ID` 派生 account_id。
而 **PASS_ID 会随 SSO 会话轮换** → `migrateDriftedKeys` 在 store 每次加载时
按 cookie 重新派生 key → 账号被改名。

连带失效（因为很多资产按 shop_key 命名）：
- Profile 目录 `~/.dsh/browser-profiles/accounts/<shop_key>`
- 签名种子 `~/.dsh/pdd-risk-seeds/<shop_key>.json`
- 签名器记忆 `~/.dsh/pdd-signer-choice.json`

### 已落的三道防线

**① 不再把轮换票据写回凭证库**
推广/自愈路径写 Cookie 时**只补缺失的键，绝不覆盖已有值**。
`PASS_ID` 不被覆盖 → account_id 稳定 → key 不再漂。

> ⚠ 这条是硬约束。改成 `setCookies(shopKey, 全量jar)` 会立刻复现漂移。

**② Profile 目录：映射表 + 自动发现 + Windows 目录联接**
`skills/_shared/pdd-profile-map.mjs`
- `~/.dsh/pdd-profile-map.json` 记 shop_key → 实际目录
- 默认目录不存在/是空壳（Cookies 为 0）→ 在同前缀目录里找**会话最全**的那个
- 找到后建 **junction**，让十几个按 `path.join(..., shopKey)` 硬拼路径的技能自动命中

> ⚠ Cookie 库路径要同时认 `Default/Network/Cookies`（Chrome ≥96）和 `Default/Cookies`。
> 只查旧路径会永远读到 0 字节 → 把有登录态的 Profile 误判成空壳。

**③ 种子读取：同店铺兜底**
`readSeed()` 精确 key 找不到时，在同前缀种子里挑**同店铺**的（比对 `new_userinfo` 的 mall_id）。
不同店铺绝不借用 —— 拿错种子 = 用别人的身份签名，比没有更糟。

---

## 十一、视频域（live）纯 Node —— 2026-11-10 打通

### 两个曾经的错误认知（都已纠正）

| 错误认知 | 实际 |
|---|---|
| live 域用 `VerifyAuthToken` 请求头 | ❌ **不存在**。抓 5 个真实接口，全部只带 `anti-content` |
| live 域票在 cookie `msfe-pc-cookie-captcha-token` | ❌ live 域 25 个 cookie 里**根本没有**这个键 |
| live 域和 mms 共用 `PASS_ID` | ❌ 各有各的：mms 用 `PASS_ID`，live 用 `L_PASS_ID` |

### 正确姿势（三条同时满足才能通）

1. **签名**：`anti-content` 请求头，用 `pdd-vodka-signer.mjs`（与 mms 同一套 JVM2 虚拟机）
2. **Cookie**：必须是 **live 域专属票据** `L_PASS_ID`（+ `HEARTBEAT_PASS_ID` / `L_PASS_TYPE`）
   —— 拿 mms 的 `PASS_ID` 去打 live 域 → **HTTP 403 + `{"error_code":40001,"error_msg":""}`**
   （空文案最坑：看着像「未登录」，其实是「票不对域」）
3. **body 参数名**：待发布列表是 `pageSize` / `pageNum`（不是 `page` / `pageSize`）

### 域的 cookie 分布（实测同一账号）

```
live.pinduoduo.com (7)    webp,_nano_fp,L_PASS_ID,L_PASS_TYPE,L_PASS_DEAD,HEARTBEAT_PASS_ID,pdd_user_id
mms.pinduoduo.com  (7)    webp,_nano_fp,PASS_ID,webp,mms_b84d1838,x-visit-time,JSESSIONID
.pinduoduo.com     (8)    api_uid,rckk,_bee,ru1k,_f77,ru2k,_a42,windows_app_shop_token_23
yingxiao.pinduoduo.com (3) _nano_fp,SUB_SYSTEM_ID,SUB_PASS_ID
```

→ 用 `daemonDomainCookies(shopKey, ['live.pinduoduo.com'])` 按域取，别混。

### 实测（空空商行）

| 接口 | 结果 |
|---|---|
| `video.list` | ✅ 首次 2.2s，热态 **102ms** |
| `video.publishQualification` | ✅ `hasQualification:true` |
| `video.topicList` | ✅ |
| `video.query` | ❌ **不通**（详见下） |

#### `video.query` 的坑：参数不是问题，接口本身就不通

实测四种参数组合（含页面内直发，带 `credentials:'include'` + 插件自动签名）：

```
{status:-1,pageSize:20,page:1,startTime,endTime}   → 40002 系统异常
{status:-1,pageNum:1,pageSize:20,startTime,endTime} → 40002 系统异常
{status:-1,page:1,pageSize:20}                      → 40002 系统异常
{}                                                  → 40002 系统异常
```

**页面内直发也 40002** → 不是签名、不是 Cookie、不是参数名的问题。
且失败会**连带账号冷却 30s**（40002 频控），别反复试。

⚠️ **曾经的假成功**：`published` 模式拿到 40002 时 `result` 为空 →
`feeds=[]` → 走待发布兜底 → 报「已发布视频 0 个」，看起来一切正常。
现已改成：`success === false` 直接抛错，绝不把接口失败伪装成「没有数据」。

**结论**：查已发布视频请用 `--mode list`（待发布队列，纯 Node 稳定）。
`video.query` 需要另找入口（可能是别的域名或需要额外凭证），暂标为不可用。

### 前置条件（否则 40001）

- 账号必须**登录过 live.pinduoduo.com**（多多视频创作者后台）。
  实测：空空商行 ✅ 有票；爱绿森两个账号 ❌ 只有 7 个通用 cookie，从没登录过 live 域。
- 常驻签名服务里要有该账号的浏览器（`daemonWarm` 预热）。

---

## 十二、**「进程不退出」全局坑**（2026-11-10，影响所有纯 Node 通道）

### 症状（最容易被误判）

skill **结果完全正确**、JSON 已经打印出来了，但**进程一直不退出**：
```
{"ok":true,"mode":"list",...,"total":396,...}    ← 结果正确
（然后进程挂着，永远不退出）
```
调用方 `WaitForExit` 超时 → 误判成「卡死 / 技能不通」。
实测 `pdd-works` / `pdd-shop` / `pdd-activity` / `pdd-promo` 全部中招。

### 根因（两个，都要治）

| # | 来源 | 说明 |
|---|---|---|
| ① | **jsdom**（主因） | `pdd-vodka-signer.mjs` 里 `new JSDOM(...)` 的 window 自带 `setInterval` / `MessageChannel` 等**活句柄**。不 `window.close()`，事件循环永远不空。**最小复现 = 只调一次 `sign()`**。 |
| ② | undici 连接池 | Node 24 内置 fetch 把 keep-alive socket 留在池里。`Connection: close` **无效**（PDD 走 HTTP/2，h2 忽略该头）。 |

### 修法

1. **签名器**：`pdd-vodka-signer.mjs` 的 `resetSandbox()` 真正 `_liveDom.window.close()` 并置空，
   下次签名自动重建（+75ms，可忽略）。
2. **基座**：`pdd-request.mjs` 的 `request()` 结尾调 `releaseDispatcherIfIdle()`，
   同时关 undici dispatcher + jsdom 沙箱 → **所有 skill 自动获得**。
3. **兜底**：`pdd-works` / `pdd-activity` / `pdd-promo` 入口加 `.then(() => process.exit(0))`。

### 排查方法（记住这个顺序）

```
1. node --check                     ← 语法
2. 单独跑最小案例：只 import → 加签名 → 加请求   ← 二分定位
3. process._getActiveHandles()       ← 看剩什么句柄
   （fd=2 是 stderr，不是 socket，别被骗）
4. 别用 RedirectStandardError 判断「是否卡死」    ← 管道本身会让进程看起来不退
```

### 顺带修掉的

- **`test-suite` 选号缺陷**：`pickPddAccount()` 只按 `status=valid` 选，但库里同时有
  「有种子」和「没种子」的账号 → 间歇性报「种子不存在」。
  已改成优先选 **valid + 有种子** 的账号。

---

## 十三、pdd-activity 的两个真 bug（2026-11-10）

### bug ① 作用域错误把真实错误全吞了

`activity.mjs` 的 `.catch()` 在**外层作用域**，里面却引用 `try` 内才定义的 `const SHOP`：
```js
})().catch(async (e) => {
  const cd = checkCooldown(SHOP)   // ← ReferenceError: SHOP is not defined
```
后果：**任何错误**进来都会先抛 `ReferenceError`，把真实原因整个吞掉，
外面只看到一个看不懂的堆栈（表现为「这个技能全挂了」）。

修：外层用 `argOf('account')` 兜底取账号。
> 这是通用教训 —— **错误处理代码本身抛异常，比原始错误更难查**。
> 写 catch 块时先确认引用的变量在这个作用域里存在。

### bug ② 无条件开浏览器 + 手搓 launch

只读模式（types/stats/effect/overview）也要开浏览器等 20s+，
且手搓 `puppeteer.launch({ executablePath: 硬编码路径 })` 拿不到
`launchOptions` 里的「让常驻签名服务释放 Profile 锁」→ 守护进程占着 Profile 就直接失败。

修：按需开（只有 `enroll` / `quit` / `records` 要页面），改用 `launchOptions()`。

**修复后实测四种只读模式全部 `ok:true`、退出码 0。**

---

## 十四、pdd-crawl 是「宿主工具型」，不是脚本型

`skills/pdd-crawl/` 下**只有 README + SKILL.md，没有任何脚本** —— 这不是缺失。

它的实现是 **TypeScript**：`src/pdd-crawl.ts`（37KB）→ 编译到 `lib/pdd-crawl.js`，
通过宿主工具 `dsagent_pdd_crawl(mode/keyword/goodsId/limit)` 调用。

> 所以「用 `ls skills/xxx/scripts` 判断技能有没有实现」是**错的**：
> 会漏掉 `pdd-crawl` 这类宿主工具型技能。

### 它的前提

用 **`pdd` 平台账号**（H5 买家态，Cookie 域 `.yangkeduo.com`），
与 `pdd_mms`（商家后台态）是**两套完全独立的登录态**，不通用。

### 当前状态（2026-11-10）

凭证库里有 `pinduoduo_8836271194`（status=valid、10 个 Cookie），
`dsagent_check_account_health` 也报「真实探测有效」，
但**实际调用仍然跳到 `login.html`** —— 说明凭证库里的 H5 Cookie 是老的、服务端已不认。
→ 需要在「账号连接」重新扫码登录 **pdd（买家态）** 账号。

---

## 十五、pdd-shop `--mode goods` 商品明细（2026-11-11 修）

### 症状

```
goodsDetailList: []           ← 空列表，但 CLI 报 ok:true「0 个」
PUA 解码覆盖 0 码点
连续重试 → 54001 → 账号冷却
```

### 根因（三个叠在一起）

| # | 问题 | 说明 |
|---|---|---|
| ① | **`queryType: 6` 是「今日实时」，会忽略 startDate/endDate** | 实测：`queryType=6 + startDate=2026-11-09` → 返回 `statDate=2026-11-11`。而 `queryType=1/2/3` 才认日期。原代码用 6 + 日期=TODAY，等于永远查「今天」，而生意参谋**当天不出数** → 恒空 |
| ② | **goods 默认 `transport=browser`**，走了页面 hook | 页面自己决定查哪天，`--date` 参数**完全不起作用**；且拿到什么算什么，空列表被当「没数据」 |
| ③ | **空列表返回 `ok:true`** | 把「没取到」伪装成「没有数据」，用户看不出问题 |

### 修法

1. `queryType` 默认 **1**（按日期查），支持 `--query-type` 覆盖
2. `--date` 默认**昨天**（当天不出数）
3. `TRANSPORT` 默认改 **`http`**（t3 纯 Node 真签名）——
   原默认 browser 的理由「静态 PUA_MAP 会解错」**已过时**，
   t3 分支早就换成 `buildPuaMap()` 动态推导了
4. 空列表 → 明确报 `empty_result` + 三条可执行建议，绝不返回假成功

### 实测对比

|  | 修复前 | 修复后 |
|---|---|---|
| 通道 | browser（页面 hook） | **t3 纯 Node** |
| 日期 | 2026-11-11（今天，不可控） | **2026-11-10（昨天，可控）** |
| 数据 | `[]` 空 / 假成功 | **uv:68 pv:89 payAmt:77.10 vcr:8.82%** |
| PUA | 0 码点 | **10/10** |

### queryType 实测表（同一账号，只改这一个变量）

| queryType | 结果 |
|---|---|
| 1 / 2 / 3 | ✅ 认 `startDate`，返回对应日期 |
| 4 | 2000000（无权限） |
| 5 / 7 | 空 |
| 6 | ✅ 但**忽略日期**，恒返回当天 |

### 附带修的：`needRelogin` 陈旧标记

`pdd-antiban` 的 `needRelogin: true` 一旦置上**没人清**，
用户重新扫码登录后仍报「需要重新登录」（`health` 还是 70，不是健康分问题）。

**处置**：`clearCooldown(shopKey)` 会删 `needRelogin` 并把健康分 +20。
> 重新登录后如果遇到「需要重新登录」，先跑一次 clearCooldown 再判断。

---

## 十六、系统性缺陷审计（2026-11-11）

由 `pdd-shop --mode goods` 空列表问题引发，全仓扫描后发现**四个同类模式缺陷**。

### 缺陷 A：空结果当成功（最危险）

```js
const list = r?.result?.list || []
emit({ ok: true, items: list })          // ← 接口失败也走这里
```
接口失败时 `result` 是 undefined → `list = []` → 报 `ok:true`「0 条」。
**把「没取到」伪装成「本来就没有」**，用户完全看不出问题。

| 受害点 | 状态 |
|---|---|
| `pdd-shop --mode goods`（goodsDetailList 恒空） | ✅ 已修（2026-11-11） |
| `pdd-video` `getQueue()` | ✅ 已修（改抛错） |
| `pdd-chance` `call()` 返回 `rr.raw ?? null` | ✅ 已修（改抛错） |
| `pdd-works` 的 `\|\| []` | ✅ 本来就安全（其 `call()` 已抛错） |

**基座已提供 `pickList(r, pick, label)`** —— 新代码请用它，别手写 `|| []`。

### 缺陷 B：`pdd-api` 绕过 `request()`，拿不到自愈

`pdd-api.mjs` 的纯 Node 路径用**自己的 fetch**，绕过了 `pdd-request.mjs`：

| 路径 | 43001 表现 |
|---|---|
| `request()` | ✅ 自动 Cookie 自愈 → 重试成功 |
| `pddApi()` | ❌ 原样返回 43001 |

→ 调用方以为「账号要重登」，其实刷新 Cookie 就能继续。
**已修**：`pdd-api` 加 43001/40001 自愈（复用 `healCookiesForApi()`）。

### 缺陷 C：`needRelogin` 永久锁死账号

`pdd-antiban` 里 `kind === 'session'` 就置 `needRelogin = true`，**永久有效**。
但 43001 经常是**瞬时**的（自愈后立刻能用）→ 用户明明重登了还一直报「需要重新登录」。

**已修**：加 15 分钟有效期（`needReloginUntil`）；老数据无该字段视为已过期。
`clearCooldown(shopKey)` 可立即清除并 +20 健康分。

### 缺陷 D：`queryType` 语义误解

详见第十五章。`queryType=6` 是「今日实时」，**忽略日期参数**；`1/2/3` 才按日期查。

### 排查方法论（这次用的）

```
1. 静态扫描：找 `|| []` 后无 `!arr.length` 检查就 ok:true 的地方
2. 精确扫描：找「取 result 但前 12 行内无 ok 检查」
3. **行为验证（最可靠）**：构造失败场景（错参数 / 临时改坏接口路径）
   → 看返回的是 ok:false 还是 ok:true
```

第 3 步最关键 —— 静态扫描会大量误报，行为验证一测一个准。

---

## 十七、基座修复完成情况（2026-11-11 收口）

### ✅ 已完成（4 项基座级修复）

| # | 修复 | 落点 | 覆盖方式 |
|---|---|---|---|
| 1 | **Cookie 自愈**补到 `pdd-api` | `pdd-api.mjs` 43001/40001 分支 | 所有走 `pddApi()` 的 skill 自动受益 |
| 2 | **`needRelogin` 加 15 分钟有效期** | `pdd-antiban.mjs` `canUse()` | 全局，不再永久锁号 |
| 3 | **`pickList()` 工具** | `pdd-request.mjs` 导出 | 新代码统一用，替代手写 `\|\| []` |
| 4 | **闸门检查项 [10] 假成功检测** | `check-pdd-guard.mjs` | CI 门禁，新代码再犯直接 fail |

### ⚠️ 诚实说明：`pickList` 目前是**可选工具，不是强制迁移**

当前**只有 3 个具体调用点**是手改修好的：
- `pdd-shop --mode goods`
- `pdd-video getQueue()`
- `pdd-chance call()`

其余 skill 的 `|| []` 经**行为验证**确认安全（它们的取数封装本身会 `throw`），
不是靠 `pickList` 覆盖的。所以准确说法是：

> 「基座补齐了 4 个能力 + 加了门禁防止退化」，
> **不等于**「所有 skill 的假成功都被改写成 pickList」。

### 检查项 [10] 的设计要点（踩过 3 次坑）

写这个检查器时连续误判，值得记录：

| 版本 | 问题 |
|---|---|
| v1 | `const call = async` 后 1200 字符内有 `throw` 就放行 → **节流的 throw 也算**，漏报 |
| v2 | 文件级匹配 `!r.ok → throw` → **被别的函数带偏**，漏报 |
| v3 ✅ | **只在 `call`/`get`/`api` 函数体内**匹配，且认两种写法：<br>`if (!r.ok) throw` / `if (r.ok) return; throw` |

**验证方法（关键）**：故意破坏一个 skill 的保护（把 `if (r.ok)` 改成 `if (true)`、
把 `throw` 改成 `return null`），跑闸门确认**报错**；再恢复。

> 只验证「不误报」不够 —— 必须验证「真能抓到」。
> 否则就是个永远 pass 的摆设。

---

## 十八、上架图片规格与预处理（吸收自 imgprep.py）

> 来源：`pdd-publish/scripts/imgprep.py`（2026-11 删除，逻辑收进本文）。
> 该脚本是纯 PIL 实现、零平台依赖，删文件不影响任何调用方（全仓库无引用）。

### 平台硬规则（实测被驳回后确认）

| 图类型 | 规则 |
|---|---|
| 详情图 | 宽 **480~1200px**，高 **≤1500px**，**逐张单图** |
| 主图 | **1:1 正方形**，建议 ≥800×800 |
| 规格预览图 | **1:1**，≥480×480 |
| 单张大小 | ≤**3MB** |

### 详情图处理顺序（固定，不跳步）

```
① 宽度统一到 750
     - 超宽（>750）→ 等比压缩到 750
     - 过窄（<750）→ 等比放大到 750
② 再看高度：高 > 1500 → 切分（宽度始终 750，绝不缩窄）
③ 高 ≤ 1500 → 直接用
```

**为什么不「压缩高度」**：`750×1800` 若按高度缩到 1500，宽度会跟着变成 625 ——
竖版图被压窄、比例失真。平台要的是**宽度保持 750**，超高的唯一正确解法是切分。

**切分用均分**：`n = ceil(高/1500)`，每段高 ≈ 高/n。
均分后每段高度接近，既没有碎片，切点也固定不漂移，上下段拼回去内容完全连贯
（切片总高 == 原图高，不重叠不丢失）。

### 体积压缩策略

按质量阶梯存，直到 ≤3MB：

```
95, 92, 90, 88, 85, 82, 78, 74, 70, 65, 60, 55, 50
```

全阶梯仍超限 → 降分辨率（每轮 ×0.85，`LANCZOS`），直到 `max(w,h) ≤ 480` 为止。
JPEG 参数：`optimize=True, progressive=True`。

### 调用形态（历史）

```bash
python imgprep.py --job job.json --report report.json
# job.json:    {"main":["a.jpg"],"detail":["b.jpg"],"spec":["c.jpg"],"maxBytes":3145728}
# report.json: {"main":[...],"detail":[...],"spec":[...],"actions":[{file,action,before,after}]}
```

> 若将来需要重新做图片规整，按上面规则用 `sharp`（Node）实现即可，
> 不必恢复 Python 依赖。

---

## 十九、规格区/属性区视觉识别（吸收自 analyze_spec_ui.py）

> 来源：`pdd-publish/scripts/analyze_spec_ui.py`（2026-11 删除，结论收进本文）。
> 该脚本会 `sys.path.insert` 到工作区外的绝对路径并硬编码 key，不适合留在技能里。

### 它解决什么问题

上架时「规格维度」那块的 UI 形态不固定，同一位置可能是四种输入控件之一，
盲点会点错。用视觉模型看截图来判断该用哪种交互策略：

| 视觉判定 `dim_type` | 对应交互 `strategy` |
|---|---|
| `text-input` | `type-and-blur`（输入后失焦提交） |
| `color-input` | `type-and-enter` |
| `checkbox` | `click-checkbox` |
| `dropdown` | `click-dropdown` |
| `unknown` | 报错，不猜 |

输出还带 `element_hints`（如「选择或输入主色」），用于二次确认。

### 实测结论

- 模型 `cn:glm-5v-turbo` 能正确读这类后台截图（温度 0.1）
- 输入：截图 + 目标维度名 + 候选值列表
- 输出：`{ok, dim_type, strategy, blur_target, element_hints}`

### 现在的做法

`pdd-publish` 已用 DOM 锚点 + `sku-panel-v2.mjs` 处理规格面板，
不再依赖截图识别。**保留这条知识**：若将来 DOM 锚点在改版后失效，
视觉识别是可行的第二方案（比盲试交互快得多）。

---

## 附：方法论

### 遇到鉴权失败，第一步不是改签名

1. 抓一份浏览器真实成功请求
2. **纯 Node 原样重放**（不改任何东西）
3. 成功 → 传输层 OK，问题在你的构造
4. 失败 → 有环境因素

**5 分钟的实验，能省下几小时。**

### 平台的设计思路

> **不追求「无法逆向」，而追求「逆向了也用不了」。**

商品域：JVM2 + 环境数据校验
推广域：普通混淆 + body 绑定
视频域：独立权限

**三个域三种强度，按敏感度分级。**

## 40032：live 域票据轮换（2026-11-22 新增）

/mms/amco/prePublish/query 等直播/视频域接口返回 **40032** = **凭证库的 L_PASS_ID 已过期**（浏览器 Profile 里的 live 票被 SSO 轮换，落库快照没跟上），不是频控。

**实验证据**：同一接口，凭证库 Cookie → 40032；浏览器当前 Cookie **无签名直发** → success:true。该接口不强制签名，只认有效 live 票。

**处置**：
1. 代码层已修：pdd-video 的 shouldFallback 对 live 域 40032 触发浏览器兜底（页面上下文用新鲜票据，自愈）
2. 注意区分：mms 域 40002 = 真频控不兜底；live 域 40032 = 票过期可自愈
3. 首次遇到未记录错误码时，先做「页面内 fetch vs Node 同接口」对照实验再下结论

**多店注意**：每家店的 shopKey（mallId 派生）独立，live 票按店独立轮换。换店扫码后对应技能首次调用可能触发一次浏览器兜底预热，属正常。

## 多多视频发布「上传成功但队列无 vid」根因（2026-11-23，4 轮实测）

三层问题叠加，全部实测定位：

1. **上传完成判定失效**：发布面板（内容声明+一键发布）是上传页的【静态表单】，
   页面加载完就存在 —— 旧逻辑看到面板文字就立即判"上传完成"（3s），
   0.6MB 视频还在上传中浏览器就被关闭 → 上传中途被杀。
   修：等「上传成功」提示或进度出现后消失，无进度时 30s 兜底。

2. **vid 轮询耗光发布窗口**：面板在上传成功后 ~10-20s 被页面自动收起，
   原 6×4s=24s 队列轮询把窗口耗光，发布块执行时面板已没了。
   修：带 --publish 时第 1 次查空就跳过轮询，立即走面板发布。

3. **前置操作挤掉面板**（待修）：发布块先关遮罩/绑商品/选声明（~10s），
   面板已收起 → 找不到发布按钮。需要在面板存活窗口内压缩完成三步，
   或上传完成瞬间立即点发布（goodsId 事后补绑）。

**当前状态**：上传判定 ✅ 修复、轮询跳过 ✅ 修复、面板窗口内三步 ⏳ 待修。
**兜底方案**：视频文件本地已存（aivideo-out/），手动上传到多多视频后台 1 分钟完成。
