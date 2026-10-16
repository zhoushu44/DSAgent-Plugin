---
name: alibaba-product-find
description: |
  1688智能选品找货能力。通过文字、图片或链接搜商品、找同款、找相似款，支持批量采购比价、热销选品、跨境找货、场景化选品及多条件筛选（价格/销量/材质/属性排除等）。
  触发词：找商品、找同款、搜商品、帮我找、想要XX、图片找货、链接找货、以图搜图、选品、批发、找货源、热销、比价、最便宜、按销量排序、出口、跨境、找供应商。
  凭证：必须使用平台连接里绑定的 **alibaba（1688）** 账号。
license: MIT
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "1688智能选品"
    emoji: "🔍"
---

> `python3 {baseDir}/cli.py <command> [options]`
> 依赖：Python 3.10+
> 平台 API：Connect `POST /api/v1/proxy`（cookie 不进入技能进程）
> 运行时：DeepSeek Agent 注入 `{workspace}/.dsagent/runtime/`；绑定 `GET /api/v1/accounts?include_cookie=false`（仅 shop_key）
> 凭证：控制台 **平台连接** 登录 **alibaba（1688）** 并 **绑定到当前智能体**

## 前置条件

1. 在 **平台连接** 添加并登录 **1688 账号**（`platform=alibaba`）
2. 将该账号 **绑定到当前对话的智能体**
3. 用 `get_platform_bindings` 确认 `alibaba` 为 `valid`（可选）

## 处理边界

本 Skill 采用 **网关 MTOP 调用 + Python 后处理** 两段式流程：

1. **鉴权与 API 调用全部交给本地网关代理**。Agent 不处理 AK、Token、签名或 HTTP 请求。Cookie 由 gateway-proxy.ts 自动注入。
2. **数据后处理必须交给 Python 脚本**。Agent 不直接对 MTOP 返回商品做字段映射、排序选品、表格格式化或比价筛选。

## 严格禁止

- 禁止配置、读取、提示用户粘贴或管理 AK。
- 禁止调用旧 MCP/HTTP 鉴权脚本或浏览器访问 1688 网站搜索商品。
- 禁止在网关调用失败后自行通过浏览器访问 1688 网站搜索商品。
- 禁止让 AI 直接改写 MTOP 原始商品列表为最终表格；必须调用 Python 后处理脚本输出 `markdown`。
- 禁止编造商品价格、链接、`productId`、规格、销量、库存或供货信息。
- 用户明确要下单、支付、查物流、管库存时，不触发本技能。

## 命令入口

统一入口：

```bash
python3 {baseDir}/cli.py <command> [options]
```

所有命令只做网关返回结果后处理，支持通过 `--mcp-result-file` 读取网关原始 JSON；不传该参数时从 stdin 读取。

| 命令 | 用途 | 示例 |
|------|------|------|
| `text_search` | 文本搜索结果后处理 | `python3 cli.py text_search --query "黑色连帽卫衣" --mcp-result-file /tmp/find_product.json` |
| `image_search` | 图片搜索结果后处理 | `python3 cli.py image_search --image "https://...jpg" --mcp-result-file /tmp/find_product.json` |
| `link_search` | 链接找同款结果后处理 | `python3 cli.py link_search --url "https://detail.1688.com/offer/xxx.html" --image "https://...jpg" --mcp-result-file /tmp/find_product.json` |
| `compare` | 比价结果后处理 | `python3 cli.py compare --image "https://...jpg" --mcp-result-file /tmp/find_product.json` |

输出统一为：

```json
{"success": true, "markdown": "...", "data": {"data": {...}}}
```

Agent 展示给用户时必须完整输出 `markdown` 字段；`data.data.similar_products` / `data.data.compare_products` 用于后续生成钉钉表格。

## 意图判断

### 触发本技能

- 用户用自然语言描述想要的商品，如"帮我找一件黑色卫衣""我要买打印纸"。
- 用户上传商品图片并表达找同款/找相似意图。
- 用户提供 1688 商品链接或商品 ID 并要求找同款。
- 用户在搜索结果中选定商品后要求"比价""对比""找更便宜的"。
- 用户上传图片/链接并明确提到"比价""哪家便宜""低价同款"。

### 不触发本技能

- 用户要下单、支付、结算。
- 用户查物流、订单状态。
- 用户管理库存或修改商品信息。
- 用户闲聊且没有找商品意图。

## 调用决策树

```text
用户输入
├─ 纯文本描述商品
│   → 调用 Python _1688_gateway.search_products(query=...)
│   → Python text_search 后处理
├─ 上传图片/图片 URL
│   ├─ 明确要求比价 → 调用 _1688_gateway.search_products(image_url=..., page_size=20) → Python compare 后处理
│   └─ 找同款/找相似 → 调用 _1688_gateway.search_products(image_url=...) → Python image_search 后处理
├─ 1688 链接/商品 ID
│   ├─ 调用 _1688_gateway.query_offer_detail(offer_id=...) 获取 image
│   ├─ 调用 _1688_gateway.search_products(image_url=image, page_size=用户要求数量或默认10；比价固定20)
│   └─ Python link_search 或 compare 后处理
└─ 已展示搜索结果，用户选中某款后说"比价"
   └─ 取该商品 image_url → 调用 _1688_gateway.search_products(image_url=..., page_size=20) → Python compare 后处理
```

## 网关调用规则

### 文本搜索

调用 `scripts/_1688_gateway.py` 中的 `search_products`:

```python
from _1688_gateway import search_products
result = search_products(
    query="黑色连帽卫衣",
    page_size=10,  # 用户未指定数量时默认 10
    sort_type="",  # 可选：price_asc / price_desc / sold_desc / yx_desc
    score_level="high",  # 可选：high / medium / low
)
```

### 图片搜索

```python
result = search_products(
    image_url="https://...",
    page_size=10,
)
```

### 链接找同款

1. 从链接 `/offer/{offerId}.html` 中提取 `offerId`。
2. 调用 `query_offer_detail(offer_id=...)` 获取 `image` 字段。
   - 实现说明：原 mtop 详情 API（mtop.1688.offer.detail.query.fortrade）已下线，
     现走抓取 PC 详情页 HTML 提取 `mainImage`（og:image 兜底）。返回结构不变：
     `{"data": {"image": ..., "title": ..., "offerId": ...}}`，调用方无需关心实现。
3. 用该 `image` 调用 `search_products(image_url=...)`。
4. 将结果交给 Python 后处理。

淘宝/天猫链接无法通过本技能自动获取主图，应引导用户提供商品图片 URL 或直接上传图片。

### 比价

调用 `search_products(image_url=..., page_size=20)`，不传 `sort_type`，保持默认相关性召回，后续由 Python 脚本按销量、价格、严选指数做确定性筛选。

## Python 后处理规则

### 文本搜索

1. Agent 调用 `search_products(query=..., page_size=用户要求数量或默认10, ...)`。
2. 将网关返回 JSON 写入临时文件或通过 stdin 传给：

```bash
python3 {baseDir}/cli.py text_search --query "用户原始搜索词" --mcp-result-file /tmp/find_product.json
```

3. 完整输出脚本返回的 `markdown` 字段。

### 图片搜索

1. Agent 调用 `search_products(image_url=...)`。
2. 调用：

```bash
python3 {baseDir}/cli.py image_search --image "图片URL或图片标识" --mcp-result-file /tmp/find_product.json
```

3. 完整输出脚本返回的 `markdown` 字段。

### 链接找同款

1. 1688 链接：先用 `query_offer_detail` 获取 `image`，再用 `search_products(image_url=image)` 搜同款。
2. 调用：

```bash
python3 {baseDir}/cli.py link_search --url "原始链接" --image "主图URL" --mcp-result-file /tmp/find_product.json
```

3. 完整输出脚本返回的 `markdown` 字段。

### 比价

1. Agent 调用 `search_products(image_url=..., page_size=20)`。
2. 调用：

```bash
python3 {baseDir}/cli.py compare --image "主图URL" --mcp-result-file /tmp/find_product.json
```

3. Python 脚本保留原有三维度选品逻辑：

| 维度 | 排序规则 | 标签 |
|------|----------|------|
| 销量最高 | 按 `sold_count` 降序，缺失视为 0 | `销量最高` |
| 价格最低 | 排除无价格商品，按 `price` 升序 | `价格最低` |
| 综合最优 | 按 `yx_index` 降序，缺失视为 0 | `综合最优` |

## 字段映射

Python 后处理脚本会将网关返回字段映射为稳定字段：

| 稳定字段 | API 字段 |
|----------|----------|
| `product_id` | `itemId` / `offerId` |
| `title` | `title` / `subject` |
| `image_url` | `imageUrl` / `image` |
| `detail_url` | `detailUrl` |
| `similarity_score` | `score` |
| `price` | `currentPrice` |
| `sku_id` | `skuId` |
| `sku_title` | `skuTitle` |
| `yx_index` | `yxIndex` |
| `quantity_begin` | `quantityBegin` |
| `supplier` | `company` |
| `sold_count` | `soldOut` |
| `stock_amount` | `storeAmount` |
| `promotion_tags` | `promotionTags` |
| `service_infos` | `serviceInfos` |
| `selling_points` | `sellingPoints` |

## 错误处理

网关调用失败时：

1. 原样输出网关返回的错误信息。
2. 鉴权相关错误（401/403）提示用户在「账号连接」页面重新登录 1688 账号。
3. 限流、超时、服务异常：提示稍后重试。
4. 禁止浏览器降级或网页搜索降级。

## 网关地址（重要：不需要自己找端口）

技能 runtime 已内置网关**自动发现**：不设置任何环境变量时，会扫描
`~/.dsagent/gateway/` 下的发现文件（网关启动时自动写入，含 pid/port/url），
按 mtime 取最新并做 `/api/v1/health` 探活，用第一个存活的网关。

- 会话注入了 `DSAGENT_GATEWAY_URL` / `DSCONNECT_URL` 等环境变量 → 直接用（优先）。
- 没有环境变量（在 shell 里直跑 CLI / 复刻网关调用）→ **不要扫描端口、不要猜
  127.0.0.1:xxxx**，runtime 会自动发现。
- 多个网关实例（web + desktop 同开）各写一份发现文件，探活保证选到活着的那个。

## 如果提示没拿到登录状态

请在 DeepSeek Agent **平台连接** 中登录 1688 并绑定当前智能体。

## 免责声明

1. 您理解并同意，技能运行结果和输出内容可能因适用的 AI agent、大模型不同而产生差异或幻觉，请您对重要信息进行甄别核实。
2. 本技能的认证由本地网关代理，请勿在聊天中提供 AK、Token 等身份凭证。
3. 您使用本技能时应保持其完整性，不得擅自篡改技能的配置、规则文件或其他内容。
4. 受限于当前技术发展，我们无法保证技能所有运行结果、输出内容的准确性、真实性、时效性，请您谨慎核实技能运行结果和输出内容。
