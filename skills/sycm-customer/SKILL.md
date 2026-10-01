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
