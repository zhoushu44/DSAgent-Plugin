## 四、类目模板与品牌

### 4.1 为什么需要类目模板

`propertys_tid` 是类目的**属性模板 ID**，必须与目标类目匹配。

| 现象 | 原因 | 处理 |
|---|---|---|
| `输入的属性值XXX不可用，请更换！`（如「倾听果」） | `propertys_tid` 用了别的类目的值，平台回退到默认模板，带出错误类目的品牌值 | 用目标类目重新采集模板，替换 `propertys_tid` / `template_module_id` / 品牌 `vid` |
| `属性[品牌]校验错误：该属性必填，需在编辑页确认后重新提交` | 品牌条目的 `vid` 或模板字段不符合该类目 | 按该类目的 `brandRule` 填写，不能复用别的类目的品牌参数 |

**根因不是简单地「没填品牌」，而是类目属性模板参数错了。** 不同类目的模板值不能混用。

### 4.2 `harvest-native-props.mjs` 用法与产物

#### 用法

```bash
# 已有草稿：直接打开草稿页采集
node scripts/harvest-native-props.mjs --shop <shopKey> --catId <类目ID> --goods <goods_id> --commit <goods_commit_id>

# 没有草稿：复制一个源商品，让它走一次页面提交
node scripts/harvest-native-props.mjs --shop <shopKey> --catId <类目ID> --source <源商品ID>
```

- `--shop` 必填，对应浏览器账号 Profile。
- `--goods` / `--commit` 与 `--source` 二选一；不传前者时必须传 `--source`。
- 脚本会打开草稿页、填写参考价、点击「提交并上架」，拦截**页面自己发出的 `goodsCommit/action/edit`**。

#### 原理

```
页面提交 → 前端调 template/mall 拉权威类目模板
        → 重建 goods_properties（template_pid / template_module_id / vid）
        → 发 action/edit
        → 脚本拦截 body 并保存
```

页面自己算出的值是平台认可的权威值，比手工拼字段可靠。

#### 产物

| 文件 | 内容 |
|---|---|
| `artifacts/pdd-native-props/cat<catId>_<shopKey>.json` | 属性模板：`propertys_tid`、`catProperties`、`goods_properties_tpl`、`template_module_id_candidates`、`brandRule` |
| `artifacts/pdd-native-props/cat<catId>_<shopKey>_native-body.json` | 页面实际提交的完整 157 字段 `action/edit` body，作为后续提交的底座 |

脚本还会打印品牌判定：该类目是否需要品牌、品牌 `vid`、`template_pid`、`template_module_id`，以及 `propertys_tid`。**每个类目采集一次，之后复用该文件。**

状态：cat16675（纸杯）与 cat22278（门贴）已采到，见 `_CLEANUP_SPEC.md`。

### 4.3 品牌字段对照表

| 字段 | 纸杯 cat16675 | 门贴 cat22278 |
|---|---|---|
| `propertys_tid` | `63387` | `39060` |
| `template_module_id` | `91765` | `50716` |
| 品牌 `vid`（`goods_properties` 中 `ref_pid=310` 那一条） | `157882` | 不需要品牌 |
| `brand_limit` | `true` | `false` |

纸杯品牌条目的关键字段（采集脚本实测打印）：

```json
{
  "ref_pid": 310,
  "template_pid": 661648,
  "template_module_id": 91765,
  "vid": 157882,
  "content": "爱绿意",
  "value": ""
}
```

> **`vid` ≠ `brand_id`**：`/draco-ms/mms/brand/audit/record` 返回的 `brand_id`（实测 `143701`）不是提交时要带的值。提交体 `goods_properties[ref_pid=310].vid` 必须填 `157882`；两者不是同一个 ID，不能互换。

### 4.4 两个 body schema 的差异（不能混用）

| 接口 | 字段数 | 用途 | 注意事项 |
|---|---|---|---|
| `commit/detail`（草稿读取） | 174 | 读取草稿详情 | 含大量展示字段（`id` / `owner` / `mall_id` 等），**不能直接当提交体** |
| `goodsCommit/action/edit`（提交） | 157 | 保存/提交编辑 | 含提交必需字段（`propertys_tid` / `isbn_properties_related` / `must_have_spu` 等） |

直接拿 `commit/detail` 的 174 字段 body 去提交，会报 `请求method,argument,body错误`。

**正确做法：用 `harvest-native-props.mjs` 保存的原生 157 字段 body 当底座，只改业务字段；不要把两个 schema 的字段互相拼接。**
