# product-wdj（淘宝商品淘宝商品问大家分析分析）

获取淘宝/天猫商品「淘宝商品问大家分析」问答，导出 CSV、JSON 与 HTML 报告。

## 用法

```bash
cd product-wdj
pip install -e .
python -m product_wdj 762128994852
```

本地调试（跳过 API，解析 JSONP 样本）：

```bash
python -m product_wdj --from-json ../淘宝商品问大家分析.js --item_id 762128994852
```

## 接口

| 用途 | API | 版本 |
|------|-----|------|
| 问题列表 | `mtop.taobao.wdj.list.merge.search` | 1.0 |
| 回答详情 | `mtop.taobao.social.ugc.post.detail` | 2.0 |

## 产物

| 类型 | 路径 |
|------|------|
| JSON/CSV/HTML | `{workspace}/artifacts/` |
| 洞察 Markdown | `{workspace}/artifacts/淘宝商品问大家分析洞察_{item_id}.md` |
| Connect skill-cache | 表 `cache_product_wdj_*`（按 shop_key） |

## 含 AI 洞察的完整报告

```bash
python -m product_wdj 762128994852
# Agent 写入 artifacts/淘宝商品问大家分析洞察_762128994852.md
python -m product_wdj report --input artifacts/淘宝商品问大家分析_xxx.json
```
