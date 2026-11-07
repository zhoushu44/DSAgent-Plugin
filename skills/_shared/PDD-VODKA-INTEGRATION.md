# PDD 纯 Node 真签名通道 · 集成完成

> 2026-11-07
> **核心成果：`/vodka/` `/glide/` 从「必须开浏览器 28 秒」变成「纯 Node 60~330 毫秒」**

---

## 一、改了什么

### 新增

| 文件 | 作用 |
|---|---|
| `skills/_shared/pdd-vodka-signer.mjs` | jsdom + react_anti SDK → 纯 Node 生成 `0as` 真签名 |
| `~/.dsh/pdd-risk-sdk/react_anti.decoded.js` | SDK 缓存（142.9 KB） |

### 修改

| 文件 | 改动 |
|---|---|
| `skills/_shared/pdd-api.mjs` | `api()` 新增纯 Node 分支（`opts.account`）；注册表 +5 个接口 |
| `skills/_shared/pdd-transport.mjs` | 新增 `t2n` 通道（纯 Node 真签名） |

---

## 二、怎么用

### 最简单

```js
import { api } from './skills/_shared/pdd-api.mjs'

const account = {
  cookies: acc.cookies,              // 账号 Cookie 对象
  localStorage: seed.localStorage,   // ISLOGIN / MMS-LOGIN-FP / _nano_fp ...
}

// 第一个参数传 null（不传 page = 不开浏览器）
const r = await api(null, 'goods.listGlide', { page: 1, size: 10 }, { account })
// → { ok: true, ec: null, data: { total: 14, ... } }
```

### 只生成签名

```js
import { sign } from './skills/_shared/pdd-vodka-signer.mjs'

const sig = await sign({ cookies: acc.cookies, localStorage: seed.localStorage })
// → "0asWfxUEMwVE..." 411 字符
```

---

## 三、性能

| 场景 | 耗时 |
|---|---|
| 沙箱首次初始化 | 1600~2000ms（一次性） |
| 后续生成签名 | **9ms** |
| 接口调用（含签名） | **60~330ms** |
| **对比浏览器通道** | **28000ms** |

**提速约 100~180 倍。**

---

## 四、通道矩阵

| 通道 | 模块 | 浏览器 | 签名 | 适用 |
|---|---|---|---|---|
| `t1` | pdd-http.mjs | ❌ | 简化 | `/sydney/` `/earth/` `/lakemms/` `/opportunity-goods/` |
| **`t2n`** | **pdd-vodka-signer.mjs** | **❌** | **0as** | **`/vodka/` `/glide/`（首选）** |
| `t2` | pdd-client.mjs | ✅ | 0as | 无账号种子时的兜底 |
| `t3` | pdd-client.mjs | ✅ | 0as+webSpiderRule | 商品明细（必须浏览器） |

`pickTier(url, { hasAccount: true })` 会自动选到 `t2n`。

---

## 五、实测可用接口

| 接口 | 状态 | 耗时 | 返回 |
|---|---|---|---|
| `goods.listGlide` | ✅ | 1847ms（首次） | total=14 |
| `goods.count` | ✅ | 162ms | — |
| `goods.copyedExist` | ✅ | 60ms | — |
| `goods.newStyleGray` | ✅ | 89ms | — |
| `common.status` | ✅ | 65ms | — |
| `goods.list`（mall/goodsList） | ⚠️ | — | 接口级限流，**浏览器也 54001** |

---

## 六、三个必要条件

### ① `antiVersion: 'v1'`

```js
inst.messagePack({ antiVersion: 'v1' })   // → 0as ✅
inst.messagePack('')                       // → 0at ❌
```

**机制（从 JVM2 反汇编得出）：**
```
getMessage 里：
  local2.antiVersion === "v1" ? antiVersion = "v1" : antiVersion = "v2"
  antiVersion === "v2" ? 用 "0at" : 用 "0as"
```

### ② localStorage 种子

必需字段：
```
ISLOGIN=1
MMS-LOGIN-FP
_nano_fp
new_userinfo
mms.pmm.did.2
```

缺了会生成 `0asA`（匿名），部分接口会拒。

### ③ `location.href` 必须是真实页面 URL

它参与签名（LocationInfo 段）。

---

## 七、不需要的东西

**不需要伪造鼠标/触摸事件。**

实测：采集器全空（ClickEvent / TouchStart / TouchMove / Scroll 全部返回 `[]`）也能生成 305 字节有效签名并通过。

之前折腾了十几轮伪造事件，**方向是错的**。

---

## 八、踩过的坑（重要）

| # | 错误认知 | 真相 |
|---|---|---|
| 1 | 签名是 `_` 分隔的多段 | **`_` 是 URL-safe Base64 字符**，不是分隔符 |
| 2 | `54001` = 签名无效 | **也代表「签名与请求不匹配」或「接口级限流」** |
| 3 | 要伪造真实交互 | **不需要，采集器为空也能过** |
| 4 | 重放会失败（有环境绑定） | **原样重放完全成功，签名可复用** |

### 最有价值的方法论

> **遇到鉴权失败，先做「原样重放」对照实验。**
>
> 1. 抓一份浏览器真实成功请求
> 2. 纯 Node 原样重放（不改任何东西）
> 3. 成功 → 传输层 OK，问题在你的构造
> 4. 失败 → 有环境因素
>
> **5 分钟的实验，能省下几小时。**

---

## 九、依赖

```json
"dependencies": {
  "jsdom": "^29.1.1"
}
```

SDK 缓存位置：`~/.dsh/pdd-risk-sdk/react_anti.decoded.js`
可用 `PDD_RISK_SDK` 环境变量覆盖。

---

## 十、验证命令

```bash
# 通道自检
node skills/_shared/pdd-transport.mjs

# 注册表校验
node -e "import('./skills/_shared/pdd-api.mjs').then(m=>console.log(m.validateTable()))"

# 风控闸门检查
npm run check:pdd-guard
```

---

## 相关

- [[SUCCESS-VODKA]] — 突破过程全记录
- [[JVM2-结论]] — JVM2 逆向（`antiVersion` 参数的来源）
- [[拼多多JS逆向地图]]
