---
name: sycm-customer
description: |
  分析店铺客户概览（新访/未购回访/已购回访）与客户画像（职业、学历、品牌、品类、购买力），生成 JSON/CSV/HTML 报告。
  触发：客户分析、客户概览、客户画像、店铺客户、新访客户、老客复购。
  适合「导出店铺客户数据」「分析客户结构与画像」。
license: MIT
metadata:
  builtin_skill_version: "1.2"
  dsagent:

    display_name: "生意参谋客户分析"
    emoji: "👥"
---

> 执行：`cd "{this_skill_dir}" && python -m customer_analysis ...`
> 运行时：DeepSeek Agent 注入 `{workspace}/.dsagent/runtime/`（`platform_client`）
> 绑定：Connect `GET /api/v1/accounts?include_cookie=false`；平台 API：`POST /api/v1/proxy`
> 产物：`{workspace}/artifacts/` 下的 JSON、CSV、HTML 报告（不写 skill-cache）

## 前置条件

1. 在 **平台连接** 登录 **生意参谋**（`platform=sycm`）并绑定当前智能体
2. 由 Agent 在智能体 workspace 中执行本技能

## 数据说明

### 客户概览（oneQuery）

- 接口：`sycm.taobao.com/domain/oneQuery.json`
- `domainCode=tao.shop.customer.overview`
- 默认按**单日**统计（`dateType=day`）
- 指标分组：
  - **店铺整体**：店铺客户数、同行同层优秀
  - **客户新访**：新访人数、成交/未成交、转化率、客单价、召回率等
  - **未购客户回访**：回访人数、成交、转化率、客单价等
  - **已购客户回访**：回访人数、老客复购、转化率、客单价等

### 客户画像（multiQuery）

- 接口：`sycm.taobao.com/domain/multiQuery.json`
- `domainCode=tao.shop.customer.newprofile`
- 默认近 **30 天**（`dateType=recent30`）
- 人群类型来自页面配置 `getPageInfo.json?pageCode=bxJCiiv7`
- **汇总画像**（4 类人群均有）：偏好类型、兴趣爱好、性别、年龄、省份、城市
  - `shop_crowd` 店铺客户 = 新访 + 未购回访 + 已购回访的**汇总**
  - `new_crowd` / `unpur_crowd` / `purch_crowd` 分别为三类细分人群
- **深度画像**（仅 `shop_crowd`）：职业、学历、品牌偏好、品类偏好、购买力

## 直接使用

- `导出店铺客户分析` → 默认昨天 + 全部 4 类人群（汇总 + 店铺深度画像）
- `只看客户新访画像` → `--crowd-type new_crowd`

```bash
python -m customer_analysis
python -m customer_analysis --date 2026-07-05
python -m customer_analysis --date 2026-07-05 --crowd-type shop_crowd,new_crowd
python -m customer_analysis --date 2026-07-05 \
  --from-overview-json 1.json \
  --from-page-info-json customer_analysis/3.json \
  --from-profile-json-shop customer_analysis/7.json \
  --from-profile-json-new customer_analysis/4.json \
  --from-profile-json-unpur customer_analysis/5.json \
  --from-profile-json-purch customer_analysis/6.json \
  --from-profile-detail-json 2.json
```

## CSV 列

**客户概览**：数据类型、指标键、指标名称、指标值、环比、说明

**客户画像**：统计日期、客户类型、画像类型、画像维度、属性值、店铺客户数、占比

## 执行完成后怎么回复用户

成功时必须给出 3 条真实绝对路径：

```text
数据文件路径: /绝对路径/xxx.json
CSV 文件路径: /绝对路径/xxx.csv
HTML 报告路径: /绝对路径/xxx.html
```

同时简要说明：统计日期、画像维度数量、画像细分条数。

## 产物与存储

| 类型 | 路径 |
|------|------|
| JSON / CSV / HTML | `{workspace}/artifacts/` |

## Excel 转换

如需 `.xlsx`，先运行本 Skill 拿到 CSV，再调用 **xlsx Skill** 转换。

---

## API 接口

> 通过 Chrome DevTools 网络抓包获取，2026-04-10

### 端点总览

三个完整 URL 定义在 `config.py`：

| 常量 | URL | 用途 |
|------|-----|------|
| `SYCM_BASE_URL` | `https://sycm.taobao.com/domain/oneQuery.json` | 客户概览 |
| `SYCM_MULTI_URL` | `https://sycm.taobao.com/domain/multiQuery.json` | 客户画像（多属性批量查询） |
| `SYCM_PAGE_INFO_URL` | `https://sycm.taobao.com/oneauth/constructed/getPageInfo.json` | 页面配置信息 |

### 客户概览 — GET /domain/oneQuery.json

获取店铺客户整体概览数据（新访客/未购回访/已购回访的量、转化率、复购率等）。

- 常量: `config.SYCM_BASE_URL`
- 域: `config.OVERVIEW_DOMAIN = "tao.shop.customer.overview"`

params:
```json
{
  "domainCode": "tao.shop.customer.overview",
  "dateType": "day",
  "dateRange": "2026-04-01,2026-04-07",
  "bizCode": "sycm_pc",
  "pluginFlag": "customerOverview",
  "showType": "overview",
  "needPeriodsCrc": "true",
  "device": "0",
  "indexCodes": "sellerId,statDate,shopCustomer,shopCustomerAvgGood,..."
}
```

`indexCodes` 完整列表见 `config.OVERVIEW_INDEX_CODES`，覆盖 4 组指标：
- 店铺整体: shopCustomer, shopCustomerAvgGood
- 客户新访: newVisitorCnt, newVisitorBuyCnt, newVisitorPayRate, ...
- 未购客户回访: noPurchaseCnt, noPurchaseBuyCnt, noPurchasePayRate, ...
- 已购客户回访: hasPurchaseCnt, hasPurchaseUbyCnt, hasPurchasePayRate, ...

### 客户画像 — GET /domain/multiQuery.json

获取客户画像数据（性别/年龄/省份/城市/消费层级/职业/学历/品牌偏好/品类偏好/兴趣爱好/偏好类型）。

- 常量: `config.SYCM_MULTI_URL`
- 域: `config.PROFILE_DOMAIN = "tao.shop.customer.newprofile"`

params（特殊：`params` 字段本身是 JSON 字符串）:
```json
{
  "params": "[{\"extMap\":{\"granularity\":\"1m\",\"custCrowdType\":\"shop_crowd\",\"attributeName\":\"gender\"},\"domainCode\":\"tao.shop.customer.newprofile\",\"dateType\":\"recent30\",\"dateRange\":\"2026-03-10,2026-04-09\",\"showType\":\"list\",\"device\":0,\"indexCodes\":\"shopCustomerCnt,attrValue\"}]"
}
```

支持的人群类型 (`custCrowdType`) 见 `config.DEFAULT_CROWD_TYPES`:
- `shop_crowd` - 店铺客户
- `new_crowd` - 客户新访
- `unpur_crowd` - 未购客户回访
- `purch_crowd` - 已购客户回访

支持的画像属性见 `config.ATTRIBUTE_LABELS`:
- gender(性别), age(年龄), province(省份), city(城市)
- prefer_type(偏好类型), interest(兴趣爱好)
- career_type(职业), education_degree(学历)
- brand(品牌偏好), brand_cate(品类偏好), purchase_power(消费层级)

### 页面配置 — GET /oneauth/constructed/getPageInfo.json

获取页面构建配置（用于客户画像展示页面的布局信息）。

- 常量: `config.SYCM_PAGE_INFO_URL`
- params: `{ "pageCode": "bxJCiiv7" }`（默认值 `config.DEFAULT_PAGE_CODE`）

### 错误码

| 退出码 | 常量 | 含义 |
|--------|------|------|
| 0 | EXIT_SUCCESS | 成功 |
| 1 | EXIT_PARAM_ERROR | 参数错误 |
| 2 | EXIT_COOKIE_INVALID | 登录态失效 |
| 4 | EXIT_API_ERROR | API 通用错误 |
| 7 | EXIT_NO_PERMISSION | 登录态有效但无类目/业务权限（code=10013） |

---

## 证据分级（输出结论前必读）

本技能输出任何"结论"前，先按**证据四分级**标注级别（Observed 直采 / Calculated 计算 /
Proxy 代理推断 / Unknown 未知），并遵守五条禁止推断——尤其是：
**sycm/万相台指数一律标 Proxy，不得当绝对量**；**Unknown 不得当 0 参与平均**。

完整分级表、五条禁止推断与国内场景注释见 [references/evidence-rules.md](references/evidence-rules.md)。

## 工作流

1. 确认用户已登录生意参谋（platform=sycm）并绑定到当前智能体
2. 执行 `python -m customer_analysis --date <日期>` 获取客户概览和画像数据
3. 读取 stdout JSON，检查退出码和数据完整性
4. 按需用 `--crowd-type` 指定人群类型（shop_crowd/new_crowd/unpur_crowd/purch_crowd）
5. 向用户报告 3 条真实绝对路径（JSON/CSV/HTML）
6. 简要说明统计日期、画像维度数量、画像细分条数

## 错误处理

- 退出码=2 时登录态失效，引导用户在平台连接重新登录 sycm
- 退出码=4 时为 API 通用错误，检查参数和权限
- 退出码=7 时登录态有效但无类目/业务权限（code=10013）
- 需 Excel 格式时先拿 CSV 再调用 xlsx 技能转换
