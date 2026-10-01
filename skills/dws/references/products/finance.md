# 智能财务 (finance) 命令参考

> **渐进式文档**：本文件为路由层（索引 + 意图判断），各命令的详细参数、示例和踩坑说明在 [finance/](./finance/) 目录下按需加载。

## 命令索引表

### receipt (付款单/收款单管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `receipt create` | 创建付款单 | `--amount` | 可附加 `--category-code`、`--supplier-code`、`--invoices` |
| `receipt create-collection` | 基于银行明细创建收款单 | `--amount` `--title` `--detail-id` | 需先从 `bank query` 获取 detail-id |

### invoice (发票管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `invoice upload` | 上传发票文件（OCR识别+查验） | `--url` `--name` `--type` | 支持 pdf/jpg/png 格式 |
| `invoice issue` | 开具发票 | — | 支持数电专票(8)/普票(9)，`--products` 为 JSON 数组 |
| `invoice issue-result` | 查询开票结果 | `--order-id` | 开票后轮询使用 |
| `invoice recommend-category` | AI推荐发票收支类别 | `--items` | items 为 JSON 数组，含 requestId 和 companyIndexId |
| `invoice list-application` | 查询开票申请列表 | — | 支持 `--start-time` `--end-time` 筛选 |
| `invoice add-record` | 添加发票到审批单 | `--business-id` `--invoice-pdf-url` | 用于保存发票到审批单 |

### bank (银行交易明细)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `bank create` | 录入银行交易明细 | `--trade-time` `--amount` `--in-out-flag` `--my-name` `--my-account` `--other-name` `--other-account` `--my-bank` | in-out-flag: C=收入, D=支出 |
| `bank query` | 查询银行交易明细 | `--detail-id` | 用于创建收款单前查询明细 |

### voucher (会计凭证)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `voucher entries` | 根据审批单生成会计分录 | `--instance-id` | 返回借贷分录列表 |
| `voucher generate` | 根据审批单生成会计凭证 | `--biz-id` | 审批单据号 |

### customer (客户管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `customer list` | 分页查询客户列表 | — | 支持 `--query` 模糊匹配，默认 pageSize=20 |
| `customer get` | 根据名称精确查询客户 | `--name` `--corp-id` | 精确匹配客户名称 |
| `customer save` | 新建客户 | `--customer-name` `--purchaser-name` `--tax-no` | customer-name用于档案展示，purchaser-name是发票抬头 |

### account (企业账户管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `account list` | 分页查询企业账户列表 | — | 支持 `--query` 或 `--account-no` 筛选 |

### journal (现金日报)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `journal daily` | 按日查询现金日报 | `--date` | 格式 yyyy-MM-dd |
| `journal detail-url` | 获取现金日报明细链接 | — | 跳转查看详细现金日报 |

### supplier (供应商管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `supplier search` | 模糊搜索供应商 | — | 支持 `--query`，搜索名称/编码/联系人 |

### category (收支类别管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `category search` | 搜索收支类别 | `--type` | type: income=收入, expense=支出 |

### company (主体管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `company search` | 模糊搜索主体 | — | 仅返回生效主体 |
| `company save` | 保存主体 | `--name` `--tax-no` | 新建主体 |
| `company update` | 修改主体信息 | `--code` `--name` `--tax-no` | 通过 code 定位主体 |

### digital-invoice (数电发票管理) → 详见 [finance-digital-invoice.md](./finance/finance-digital-invoice.md)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `digital-invoice do-login-status` | 查询数电登录状态 | `--company-code` | 未登录时需先登录 |
| `digital-invoice login-page` | 获取数电登录页面链接 | `--company-code` | 可附加 `--company-name` `--tax-no` |
| `digital-invoice do-login` | 数电登录认证 | `--company-code` `--login-account` `--taxpayer-user-id` `--login-id` `--login-pwd` `--taxpayer-user` `--taxpayer-user-phone` `--serial-no` | 支持账号密码/手机验证码登录 |
| `digital-invoice account` | 查询数电账号信息 | `--company-code` | 开票前确认账号状态 |
| `digital-invoice sms-code` | 上传数电登录短信验证码 | `--company-code` `--serial-no` `--sms-code` `--phone` | 配合 do-login 使用 |
| `digital-invoice goods-code` | 商品智能赋码 | `--company-code` `--good-name` | 智能匹配税收分类编码 |
| `digital-invoice face-qr` | 获取人脸识别二维码 | `--company-code` `--id-auth-type` | id-auth-type: 0=税务App, 1=个税App |
| `digital-invoice face-status` | 获取人脸认证状态 | `--company-code` | faceSwiping="1"表示认证成功 |
| `digital-invoice title` | 智能抬头 | `--company-code` `--name` | 智能匹配购方纳税人信息 |
| `digital-invoice issue` | 开具数电发票 | `--company-code` `--serial-no` `--invoice-type-code` `--customer-code` `--total-exclude-tax` `--total-tax-amount` `--total-include-tax` `--details` | details 为 JSON 数组 |
| `digital-invoice file` | 获取发票版式文件 | `--serial-no` `--drew-date` `--invoice-no` | 返回 PDF/OFD/XML 文件 URL |
| `digital-invoice skill-version` | 查询开票 Skill 版本 | — | V1=SaaS版, V2=轻量化版 |
| `digital-invoice send-email` | 发送发票邮件（轻量化版） | `--company-code` `--items` | 适用于 V2 版本 |
| `digital-invoice send-email-saas` | 发送发票邮件（SaaS版） | `--company-code` `--items` | 适用于 V1 版本 |
| `digital-invoice batch-draw` | 批量开票（轻量化版） | `--company-code` `--items` | V2 版本，一次性多张发票 |
| `digital-invoice batch-draw-saas` | 批量开票（SaaS版） | `--company-code` `--batch-no` `--orders` | V1 版本 |
| `digital-invoice batch-draw-query` | 批量开票查询（轻量化版） | `--company-code` `--batch-no` | 查询 V2 开票状态 |
| `digital-invoice batch-draw-query-saas` | 批量开票查询（SaaS版） | `--company-code` `--batch-no` | 查询 V1 开票状态 |
| `digital-invoice get-table` | 获取发票表格配置 | `--type` | 可选 `--data` JSON 对象 |
| `digital-invoice import-goods` | 导入商品 | `--company-code` `--items` | items 为 JSON 数组，含 goodsName、revenueCode 等 |
| `digital-invoice search-goods` | 搜索商品 | `--company-code` | 支持 `--goods-name` 搜索 |

### payment (支付/付款管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `payment create` | 创建待付款审批单 | `--amount` `--payee-account-no` `--payee-account-type` `--payee-account-name` | 可选 `--payee-bank-name` `--payee-branch-name` |
| `payment list` | 查询待付款列表 | — | 支持 `--payee-account-no` 筛选 |
| `payment account-list` | 查询收款账户列表 | — | 支持 `--query` 搜索 |
| `payment cashier-url` | 查询支付收银台链接 | `--instance-id` 或 `--instance-ids` | 二选一传入 |
| `payment account-url` | 获取收款账户管理页面链接 | — | 跳转收款账户管理 |
| `payment payer-list` | 查询付款账户列表 | — | 返回当前企业可用付款账户 |

### process (审批单管理)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `process form-data` | 根据审批编号查询审批表单信息 | `--business-id` | 返回完整表单详情 |
| `process list` | 根据审批模版名查询审批单列表 | `--form-name` `--start-time` `--end-time` | 支持分页 |

### gather (自定义经营报表数据采集)

| 命令 | 用途 | 必填参数 | 路由提醒 |
|------|------|----------|----------|
| `gather save-rule` | 保存采集规则 | `--process-code` `--rules` | 可选 `--table-field-id` 指定基准明细/表格 |
| `gather query-rule` | 查询采集规则 | — | 支持 `--process-code` 或 `--process-name` 查询 |
| `gather try-execute` | 尝试执行数据采集（单条验证） | — | 传入 `--process-code` + `--business-id` 或 `--instance-id` |
| `gather execute` | 执行数据采集（批量） | `--instances` | instances 为 JSON 数组，每项含 businessId/instanceId/processCode |

## 意图判断

用户说"付款单/付款":
- 创建 → `receipt create`（读 [finance-receipt.md](./finance/finance-receipt.md)）
- 查询待付款 → `payment list`
- 创建付款审批 → `payment create`

用户说"收款单/收款":
- 创建 → `receipt create-collection`（需先从 `bank query` 获取 detail-id）

用户说"发票/上传发票":
- 上传 → `invoice upload`
- 开具 → `invoice issue` 或 `digital-invoice issue`（根据 skill-version 选择）
- 查询开票结果 → `invoice issue-result`
- 批量开票 → `digital-invoice batch-draw` 或 `digital-invoice batch-draw-saas`

用户说"数电发票/数电":
- 登录状态 → `digital-invoice do-login-status`
- 登录认证 → `digital-invoice do-login` 或 `digital-invoice login-page`
- 开票 → `digital-invoice issue`
- 商品赋码 → `digital-invoice goods-code`
- 人脸识别 → `digital-invoice face-qr` + `digital-invoice face-status`

用户说"银行/银行明细":
- 录入 → `bank create`
- 查询 → `bank query`

用户说"会计凭证/凭证/分录":
- 生成分录 → `voucher entries`
- 生成凭证 → `voucher generate`

用户说"客户":
- 搜索/列表 → `customer list`
- 精确查询 → `customer get`
- 新建 → `customer save`

用户说"供应商":
- 搜索 → `supplier search`

用户说"收支类别/类别":
- 搜索 → `category search`（需指定 `--type` income/expense）

用户说"主体/公司":
- 搜索 → `company search`
- 新建 → `company save`
- 修改 → `company update`

用户说"现金日报/日报":
- 查询 → `journal daily`
- 查看明细 → `journal detail-url`

用户说"支付/付款/收银台":
- 创建付款 → `payment create`
- 查询待付款 → `payment list`
- 获取支付链接 → `payment cashier-url`
- 查询付款账户 → `payment payer-list`

用户说"审批/审批单":
- 查询表单 → `process form-data`
- 查询列表 → `process list`

用户说"经营报表/采集/采集规则":
- 保存规则 → `gather save-rule`
- 查询规则 → `gather query-rule`
- 验证采集 → `gather try-execute`
- 批量采集 → `gather execute`

用户说"企业账户/账户":
- 查询 → `account list`

命令报错/操作失败 → 读 [finance-error-recovery.md](./finance/finance-error-recovery.md)

**关键区分**: 
- receipt.create = 付款单，receipt.create-collection = 收款单
- invoice.issue = 传统开票，digital-invoice.issue = 数电开票
- payment.create = 创建付款审批，receipt.create = 创建付款单
- company = 主体，customer = 客户，supplier = 供应商

## 核心工作流

```bash
# 工作流 1: 上传发票并识别
dws finance invoice upload --url https://example.com/invoice.pdf --name "采购发票.pdf" --type pdf

# 工作流 2: 数电发票完整流程
# 2.1 检查登录状态
dws finance digital-invoice do-login-status --company-code COMP001

# 2.2 未登录则获取登录页面
dws finance digital-invoice login-page --company-code COMP001 --company-name "某某公司" --tax-no 91110000

# 2.3 查询数电账号信息
dws finance digital-invoice account --company-code COMP001

# 2.4 商品智能赋码
dws finance digital-invoice goods-code --company-code COMP001 --good-name "咨询服务"

# 2.5 智能抬头
dws finance digital-invoice title --company-code COMP001 --name "某某公司"

# 2.6 开具数电发票
dws finance digital-invoice issue --company-code COMP001 --serial-no SN001 \
  --invoice-type-code 026 --customer-code CUST001 \
  --total-exclude-tax 1000 --total-tax-amount 130 --total-include-tax 1130 \
  --details '[{"amount":"1000","taxAmount":"130","taxRate":"0.13","itemTitle":"咨询服务"}]'

# 2.7 获取发票文件
dws finance digital-invoice file --serial-no SN001 --drew-date 2025-07-01 --invoice-no 24110000000001234567

# 工作流 3: 批量开票（轻量化版 V2）
dws finance digital-invoice batch-draw --company-code COMP001 \
  --items '[{"invoiceTypeCode":"026","customerCode":"CUST001","details":[{"amountIncludeTax":"1000","taxRate":"0.13","revenueCode":"3040201","itemTitle":"咨询服务"}]}]'

# 工作流 4: 基于银行明细创建收款单
# 4.1 查询银行明细
dws finance bank query --detail-id DET001

# 4.2 创建收款单
dws finance receipt create-collection --amount 5000 --title "货款收入" --detail-id DET001

# 工作流 5: 创建付款单
dws finance receipt create --amount 1000.00 --category-code C001 --supplier-code S001

# 工作流 6: 录入银行交易明细
dws finance bank create --trade-time "2025-07-01 10:00:00" --amount 50000 \
  --in-out-flag C --my-name "我方公司" --my-account 622001234 \
  --other-name "供应商公司" --other-account 622009876 --my-bank "招商银行"

# 工作流 7: 创建付款审批并支付
# 7.1 创建待付款审批单
dws finance payment create --amount 5000 --payee-account-no 622001234 \
  --payee-account-type BANK_CARD --payee-account-name "某某公司"

# 7.2 获取支付收银台链接
dws finance payment cashier-url --instance-id INST001

# 工作流 8: 查询现金日报
dws finance journal daily --date 2025-07-01

# 工作流 9: 导入和搜索商品
# 9.1 导入商品到系统
dws finance digital-invoice import-goods --company-code COMP001 \
  --items '[{"goodsName":"办公用品","revenueCode":"3040201","unit":"个","taxRate":"0.13","unitPrice":"100","specifications":"标准版"}]'

# 9.2 搜索已导入的商品
dws finance digital-invoice search-goods --company-code COMP001 --goods-name "办公用品"
```

## 上下文传递表

| 操作 | 从返回中提取 | 用于 |
|------|-------------|------|
| `company search` | `code` | `company update` 的 `--code`，`digital-invoice` 系列命令的 `--company-code` |
| `customer list/get` | `customerCode` | `digital-invoice issue` 的 `--customer-code` |
| `supplier search` | `supplierCode` | `receipt create` 的 `--supplier-code` |
| `category search` | `categoryCode` | `receipt create` 的 `--category-code` |
| `bank query` | `detailId` | `receipt create-collection` 的 `--detail-id` |
| `invoice upload` | `requestId`, `companyIndexId` | `invoice recommend-category` 的 `--items` |
| `invoice issue` | `orderId` | `invoice issue-result` 的 `--order-id` |
| `digital-invoice issue` | `invoiceNo`, `drewDate`, `serialNo` | `digital-invoice file` 的参数 |
| `digital-invoice batch-draw` | `batchNo` | `digital-invoice batch-draw-query` 的参数 |
| `payment create` | `instanceId` | `payment cashier-url` 的参数 |
| `process list` | `businessId` | `process form-data` 的参数 |

## 注意事项

- **数电开票前必须完成登录认证**：先调用 `do-login-status` 检查，未登录则引导用户完成登录流程
- **skill-version 路由**：开票前调用 `digital-invoice skill-version` 判断使用 V1（SaaS版）还是 V2（轻量化版）
- **所有操作使用 ID**：尽量使用编码（companyCode/customerCode/supplierCode等），而非名称
- **JSON 参数格式**：`--details`、`--items`、`--products`、`--invoices` 等参数为 JSON 数组，注意转义
- **银行明细 in-out-flag**：C = 收入，D = 支出
- **发票类型**：8 = 数电专票，9 = 数电普票
- **收支类别类型**：income = 收入类别，expense = 支出类别
- **人脸识别认证**：face-qr 获取二维码 → 用户扫码 → face-status 轮询确认状态（faceSwiping="1"表示成功）
- **批量开票查询**：batch-draw 后需用 batch-draw-query 轮询开票状态和结果
- **导入商品格式**：import-goods 的 items 为 JSON 数组，每个商品必须包含 goodsName（商品名称）和 revenueCode（税收分类编码）

## 相关参考

- 数电发票详细文档 → [finance-digital-invoice.md](./finance/finance-digital-invoice.md)
- 发票单元格值格式 → 参考 aitable 的 [aitable-cell-value.md](./aitable/aitable-cell-value.md)
- 错误恢复指南 → [finance-error-recovery.md](./finance/finance-error-recovery.md)（待创建）
- 最佳实践 → [finance-best-practices.md](./finance/finance-best-practices.md)（待创建）

## 自动化脚本

| 脚本 | 场景 |
|------|------|
| [finance_daily_cashflow.py](../../scripts/finance_daily_cashflow.py) | 每日现金流查询 |
| [finance_expense_flow.py](../../scripts/finance_expense_flow.py) | 费用流水查询 |

## 相关产品

- [aitable](./aitable.md) — AI表格，可用于财务数据管理和分析
- [doc](./doc.md) — 富文本文档，可用于生成财务报告
- [approval](./approval.md) — 审批流程，财务审批单管理
