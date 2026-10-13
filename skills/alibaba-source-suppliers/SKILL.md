---
name: alibaba-source-suppliers
description: |
  1688找供应商 —— 结合用户需求与关键字查询对应的供应商及工厂信息。
  触发词：找供应商、查供应商、1688供应商、工厂信息、找厂家、找工厂、源头工厂、OEM、ODM、一件代发。
  不触发场景：找商品/选品 → alibaba-product-find；下单付款 → 不处理。
  凭证：必须使用平台连接里绑定的 **alibaba（1688）** 账号。
license: MIT
metadata:
  builtin_skill_version: "1.0"
  dsagent:
    display_name: "1688找供应商"
    emoji: "🏭"
---

> `python3 {baseDir}/cli.py ali_1688_source_suppliers [options]`
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
2. **供应商数据后处理必须交给 Python 脚本**。Agent 不直接解析网关原始结构、不自行筛选 `RETRIEVAL` 阶段、不自行生成供应商表格。

## 严格禁止

- 禁止配置、读取、提示用户粘贴或管理 AK。
- 禁止调用旧 MCP/HTTP 鉴权脚本或浏览器访问 1688 网站。
- 禁止在网关调用失败后自行通过外部网站补充供应商信息。
- 禁止让 AI 直接解析网关原始返回并生成最终表格；必须调用 Python 后处理脚本输出 `markdown`。
- 禁止编造供应商信息、伪造工厂数据、臆测供应商资质。

## 意图判断

### 匹配优先级

**P0 - 核心触发词（命中即触发）**：

> 供应商、工厂、厂家、厂商、生产商、制造商、代工厂、源头工厂、工厂店

**P1 - 行为触发词（需搭配商品词）**：

> 找供应商、找工厂、找厂家、采购XX、筛选供应商、对比供应商

**P2 - 服务触发词（需搭配供应商场景）**：

> 贴牌、OEM、ODM、一件代发、定制logo、打样

### 触发规则

```text
命中 P0 词 → 触发本技能
命中 P1 词 + 商品词 → 触发本技能
仅商品词/找商品/选品 → 不触发，交给 alibaba-product-find
下单/付款/订单/物流 → 不触发
```

## 关键字提取规则

| 用户输入 | 提取关键字 |
|---------|-----------|
| 帮我找做不锈钢保温杯的供应商 | `不锈钢保温杯供应商` |
| 我想找儿童书包厂家 | `儿童书包厂家` |
| 我需要采购宠物牵引绳 | `宠物牵引绳供应商` |

## 命令入口

```bash
python3 {baseDir}/cli.py ali_1688_source_suppliers --query "供应商关键字" --mcp-result-file /tmp/source_suppliers.json
```

也支持 stdin：

```bash
cat /tmp/source_suppliers.json | python3 {baseDir}/cli.py ali_1688_source_suppliers -q "供应商关键字"
```

输出 JSON：

```json
{"success": true, "markdown": "...", "data": {...}}
```

Agent 展示给用户时必须完整输出 `markdown` 字段；后续分析使用 `data.factories`。

## 执行流程

```text
步骤1: 提取关键字 → 商品词 + 供应商词

步骤2: 调用 Python 网关模块
       from _1688_gateway import search_suppliers
       result = search_suppliers(query="<关键字>")
       ├─ 网关失败 → 原样输出错误并按错误处理
       └─ 网关成功 → 将原始 JSON 写入临时文件或传给 stdin

步骤3: 调用 Python 后处理
       python3 {baseDir}/cli.py ali_1688_source_suppliers -q "<关键字>" --mcp-result-file /tmp/source_suppliers.json

步骤4: 处理脚本响应
       ├─ success: true → 完整输出 markdown；Agent 分析可追加在后面
       └─ success: false → 输出 markdown 后终止，不追加分析
```

## 输出格式

### 表格样式

| 序号 | 公司名称 | 所在地区 | 合作方式 | 服务 | 工厂信息 | 服务指标 |
|:----:|---------|---------|---------|------|---------|---------|
| 1 | [XX公司](url) | 广东中山 | OEM, ODM | 清加工 | 无牌工厂 | 高好评, 月38单 |

## 风险识别

| 风险关键词 | 风险类型 | Agent 应对 |
|-----------|---------|-----------|
| 大牌同款、高仿、复刻 | 侵权风险 | 输出结果后追加合规风险提示 |
| 儿童用品 + 低价 | 安全风险 | 提示重点核验安全资质 |
| 医用级、食品级 | 合规风险 | 提示核验证照、检测报告 |
| 帮我找方向 | 意图模糊 | 先追问具体品类 |

## 错误处理

网关调用失败时：

1. 原样展示网关返回的错误信息。
2. 鉴权相关错误（401/403）提示用户在「账号连接」页面重新登录 1688 账号。
3. 限流、超时、服务异常：提示稍后重试。
4. 禁止浏览器降级。

## 如果提示没拿到登录状态

请在 DeepSeek Agent **平台连接** 中登录 1688 并绑定当前智能体。
