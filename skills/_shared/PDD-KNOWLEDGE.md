# 拼多多基座 · 知识库

> 最后更新：2026-11-08
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

### 性能

| 通道 | 耗时 |
|---|---|
| 纯 Node | **58~330ms** |
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

## 七、能力边界

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

### ❌ 不可用

| 项 | 原因 |
|---|---|
| **视频域** `live.pinduoduo.com` | **账号无创作者权限**（浏览器也 302 到登录页） |
| `mall/goodsList` | 账号级接口限制（浏览器也 54001） |
| `lakemms` 活动 | `100001` 2 小时频控 |
| 写操作（改价/改库存） | 参数未抓全（需真实点击保存） |

---

## 八、踩坑记录

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
