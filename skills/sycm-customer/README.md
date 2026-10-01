# 生意参谋客户分析

分析店铺客户概览（新访 / 未购回访 / 已购回访）与客户画像，导出 JSON / CSV / HTML 报告。

## 用法

```bash
cd "{this_skill_dir}"
python -m customer_analysis
python -m customer_analysis --date 2026-07-05
python -m customer_analysis --date 2026-07-05 --from-overview-json 1.json --from-profile-json 2.json
```

## 产物

| 类型 | 路径 |
|------|------|
| JSON / CSV / HTML | `{workspace}/artifacts/` |

## 画像维度

### 店铺客户（shop_crowd）

| 属性键 | 名称 |
|--------|------|
| career_type | 职业 |
| education_degree | 学历 |
| brand | 品牌偏好 |
| brand_cate | 品类偏好 |
| purchase_power | 购买力 |

### 客户新访 / 未购回访 / 已购回访

| 属性键 | 名称 |
|--------|------|
| prefer_type | 偏好类型 |
| interest | 兴趣爱好 |
| gender | 性别 |
| age | 年龄 |
| province | 省份 |
| city | 城市 |

人群分类来自 `getPageInfo.json?pageCode=bxJCiiv7` 页面配置。
