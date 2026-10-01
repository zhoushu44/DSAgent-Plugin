# product-reviews（淘宝商品评价）

抓取淘宝/天猫商品 `mtop.taobao.rate.detaillist.get` 评价列表，导出 CSV。

## 用法

```bash
cd "{this_skill_dir}"
python -m product_reviews 614498626290
```

本地调试（跳过 API，解析 JSONP 样本）：

```bash
python -m product_reviews --from-json ../1.json --item_id 614498626290
```

## CSV 列

序号、用户、SKU名称、标签、初评时间、晒图/视频、评价内容、追评内容、追评晒图/视频、有用

## 产物

| 类型 | 路径 |
|------|------|
| JSON/CSV/HTML | `{workspace}/artifacts/` |
