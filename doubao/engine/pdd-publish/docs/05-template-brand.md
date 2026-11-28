## 四、类目模板与品牌

### 4.1 为什么必须按类目拉模板

`propertys_tid` 是类目的**属性模板 ID**，必须与目标类目匹配；不同类目的模板参数**不能混用**。

| 现象 | 原因 | 处理 |
|---|---|---|
| `输入的属性值XXX不可用，请更换！`（如「倾听果」） | `propertys_tid` 用了别的类目的值，平台回退到默认模板，带出错误类目的品牌值 | 用目标类目重新拉模板，替换 `propertys_tid` / `template_module_id` / 品牌 `vid` |
| `属性[品牌]校验错误：该属性必填，需在编辑页确认后重新提交` | 品牌条目的 `vid` 或模板字段不符合该类目 | 按该类目的 `brandRule` 填写，不能复用别的类目的品牌参数 |

**根因不是简单地「没填品牌」，而是类目属性模板参数错了。**

### 4.2 现在怎么拉模板（唯一方式）

```bash
# 叶子 catId → 属性 + 规格维度，--save 落成标准模板
node skills/pdd-publish/scripts/pdd-category.mjs template --cat-id 16675 --account "<shopKey>" --save

# 一条龙：关键词 → 第一个叶子类目 → 模板
node skills/pdd-publish/scripts/pdd-category.mjs resolve --keyword "保温杯" --account "<shopKey>" --save
```

产物：`skills/pdd-publish/templates/<templateId>__<name>/template.json`，含

| 字段 | 内容 |
|---|---|
| `category` | 类目全名 + catId |
| `attributes` | 属性清单（名称 / 是否必填 / 候选值 / `propertys_tid`）|
| `specs` | 规格维度（**维度名 + type**，决定 step11 用哪个填充器）|
| `brandRule` | 该类目是否需要品牌、品牌 `vid` |

> 坑：只有**叶子类目**才有模板。传一级/二级类目会返回 200 + 空 modules，
> CLI 明确报 `EMPTY_TEMPLATE` 并退出码 1（不会给空模板去填表）。
> 另外模板必须同时存在于 `skills/pdd-publish/templates/`（`artifacts/` 是 gitignored 的）。

### 4.3 品牌字段对照（历史实测值，仍有效）

| 字段 | 纸杯 cat16675 | 门贴 cat22278 |
|---|---|---|
| `propertys_tid` | `63387` | `39060` |
| `template_module_id` | `91765` | `50716` |
| 品牌 `vid`（`goods_properties` 中 `ref_pid=310` 那一条） | `157882` | 不需要品牌 |
| `brand_limit` | `true` | `false` |

纸杯品牌条目的关键字段：

```json
{ "ref_pid": 310, "template_pid": 661648, "template_module_id": 91765, "vid": 157882, "content": "爱绿意", "value": "" }
```

> **`vid` ≠ `brand_id`**：`/draco-ms/mms/brand/audit/record` 返回的 `brand_id`（实测 `143701`）
> 不是提交时要带的值；提交体 `goods_properties[ref_pid=310].vid` 必须填 `157882`。两者不能互换。

### 4.4 两个 body schema 的差异（读流量时用得上，不能混用）

| 接口 | 字段数 | 用途 | 注意事项 |
|---|---|---|---|
| `commit/detail`（草稿读取） | 174 | 读取草稿详情 | 含大量展示字段（`id` / `owner` / `mall_id` 等），**不能直接当提交体** |
| `goodsCommit/action/edit`（提交） | 157 | 保存/提交编辑 | 含提交必需字段（`propertys_tid` / `isbn_properties_related` / `must_have_spu` 等） |

直接拿 174 字段 body 去提交会报 `请求method,argument,body错误`。
**只改业务字段，不要把两个 schema 的字段互相拼接。**

> 这段是 2026-10 走 HTTP 直提时踩出来的；现在上架走 RPA 页面（`steps/index.mjs`），
> 页面自己算这些字段，但**排查接口/看抓包时仍需知道这两个 schema 的差别**。
