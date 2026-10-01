---
name: xianyu-crawl
description: "闲鱼数据采集：按关键词搜索闲鱼商品，采集商品详情与卖家信息，支持同类比价。触发：闲鱼、xianyu、闲鱼商品搜索、闲鱼采集、闲鱼比价、闲鱼卖家信息。排除：淘宝商品市场分析（用 market-analysis）、抖音/小红书数据采集。需绑定 xianyu 账号。"
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "闲鱼·数据采集"
    emoji: "🔌"
    requires:
      bins: [python3]
---

# 闲鱼数据采集

> **重要:** 采集结果仅供数据分析与比价参考，不得用于商业用途。请求间隔 ≥ 2 秒，避免触发风控。

## 何时使用

- 用户说"帮我搜闲鱼上的 iPhone"、"闲鱼上搜索xxx" → 关键词搜索商品
- 用户说"采集闲鱼商品数据"、"闲鱼比价" → 搜索 + 详情采集
- 用户说"看看闲鱼上xxx卖多少" → 关键词搜索 + 价格统计

## 边界

- 不采集卖家联系方式或个人隐私数据
- 不做批量爬取（单次搜索 ≤ 50 条结果）
- 不自动下单或联系卖家
- 如 Cookie 失效需重新登录

## 执行流程

### 1. 数据采集

运行采集脚本，通过闲鱼 H5 API 搜索商品：

```bash
python3 {baseDir}/scripts/fetch_data.py --keyword "搜索关键词" [--page 1] [--size 20]
```

脚本自动完成：
- 从 `DSCONNECT_URL` 读取本地代理网关地址
- 通过网关代理 `POST /api/v1/proxy` 发请求（网关自动注入 Cookie，QIWork 模式）
- 通过 `mtop.taobao.idlehome.home.webpc.feed` 引导获取 `_m_h5_tk` token
- 计算 sign 签名后调用 `mtop.taobao.idlemtopsearch.pc.search` 搜索商品
- 采集商品标题、价格、卖家、地区、图片等信息
- 输出 `__DSAGENT_RESULT__` JSON

### 2. 结果说明

采集结果为 JSON 数组，每条商品包含：

| 字段 | 说明 |
|------|------|
| `item_id` | 商品 ID |
| `title` | 商品标题 |
| `price` | 现价（纯数字字符串），取 `clickParam.args.price`（等价 `exContent.detailParams.soldPrice`） |
| `original_price` | 原价（纯数字字符串），取 `exContent.oriPrice`（形如 `¥66`）；仅部分商品有，取不到为 `null` |
| `seller_nick` | 卖家昵称 |
| `seller_id` | 卖家 ID |
| `area` | 发货地区 |
| `image_url` | 首图 URL |
| `want_count` | 想要人数，取 `exContent.fishTags` 中的「N人想要」标签文本 |

**搜索接口不返回的字段（保持字段存在但恒为空值，勿据此判断商品属性）：**

| 字段 | 恒定值 | 说明 |
|------|--------|------|
| `description` | `""` | 搜索结果不含商品描述，需另取详情接口 |
| `view_count` | `0` | 搜索结果不含浏览次数（原始响应无 `viewCount` 字段） |

> `want_count` 注意：`clickParam.args.wantNum` 恒为占位字符串 `'0'`，**不是**真实想要人数；
> 真实值只存在于 `exContent.fishTags.<row>.tagList[].data.content` 的「N人想要」文本标签中，解析时以标签为准。
>
> `price` 注意：`exContent.price` 是**组件数组**（`[{"type":"sign","text":"¥"},{"type":"integer","text":"15"},{"type":"decimal","text":".90"}]`），
> 不可直接当字符串用；脚本优先取 `clickParam.args.price` 这个纯文本字段。

## 环境变量

技能执行时，以下环境变量由 DSAgent 插件自动注入：

| 变量 | 说明 |
|------|------|
| `DSCONNECT_URL` | 本地代理网关地址（脚本通过网关代理发请求，Cookie 不出网关） |
| `DSCONNECT_TOKEN` | 网关认证令牌（占位值，本地网关不验签） |
| `DSCONNECT_AGENT_ID` | 智能体 ID（占位值，本地网关用 platform 匹配账号） |
| `DSAGENT_REQUEST` | 用户原始请求文本（可用于提取中文关键词） |
| `DSAGENT_WORKSPACE` | 工作目录 |
| `DSAGENT_SKILL_ROOT` | 技能根目录 |
| `DSAGENT_COOKIE` | （向后兼容）闲鱼登录 Cookie，网关也使用此凭证 |

## 输出格式

采集完成后，通过 stdout 输出 `__DSAGENT_RESULT__` 行，JSON 格式：

```json
{
  "ok": true,
  "keyword": "iPhone 15",
  "total": 20,
  "data": [
    {
      "item_id": "123456789",
      "title": "95新 iPhone 15 Pro 256G",
      "price": "4599",
      "seller_nick": "闲鱼卖家",
      "area": "浙江杭州",
      "want_count": 12
    }
  ]
}
```

## 错误处理

| 错误场景 | failure_kind | 处理方式 |
|---------|-------------|---------|
| DSCONNECT_URL 未设置 | `not_bound` | 引导用户到「账号连接」页面绑定闲鱼账号 |
| _m_h5_tk 获取失败 | `token_expired` | 提示账号登录态可能失效，需重新登录 |
| 搜索请求被风控 | `risk_control` | 提示用户去平台完成安全验证后重试 |
| 搜索接口限流 | `rate_limit` | 告诉用户稍后重试 |
| 响应解析失败 | `parse_error` | 展示原始返回 |
| 搜索结果为空 | — | 返回 `{ ok: true, data: [], total: 0 }` |
