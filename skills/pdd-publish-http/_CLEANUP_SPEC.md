# 拼多多上架技能整理规范（必须严格遵守）

## 目标

把 `skills/pdd-publish-http/` 从「31 个脚本 + 1208 行混乱文档」整理成：
- **一个清晰的 SKILL.md**（目录化，快速定位）
- **只保留真正在用的脚本**
- **删除所有这两天试验失败留下的死代码**

## 铁律（违反即淘汰）

1. **不要修改任何 .mjs 的业务逻辑**。只做：保留 / 删除 / 改文档。
2. **不要新增脚本**。整理不是重写。
3. **不要编造实测数据**。所有「实测成功」的结论必须来自 `artifacts/pdd-publish-by-copy/run-*.log` 或 `pdd_js_analysis/reports/flow-*.log` 里的真实记录。
4. **不确定就写「未验证」**，不要写得像验证过。
5. 每个文件独立处理，不要碰别人的文件。

## 当前真实状况（这是唯一事实来源）

### 已验证能跑通的路径

| 路径 | 脚本 | 状态 | 证据 |
|---|---|---|---|
| 复制本店商品改包 | `publish-by-copy.mjs` | ✅ 6 单成功 | 见下方 goods_id 列表 |
| 页面全流程提交 | `publish-flow.mjs` | ✅ 4 单成功 | 见下方 goods_id 列表 |
| 类目模板采集 | `harvest-native-props.mjs` | ✅ 可用 | 采到 cat16675 / cat22278 |
| 批量跑 | `batch-publish.mjs` | ⚠️ 未验证 | 只有代码，无成功记录 |

### publish-by-copy.mjs 真实成功记录（6 单）

```
1026511479126  换图5张
1026569086908  源图
1026569940637  源图
1026574634568  无图
1026709254803  无图（退化body）
1026710800048  源图
```

### publish-flow.mjs 真实成功记录（4 单）

```
1025462371503  源图
1025846514486  源图
1026312995086  源图
1026321720727  源图
```

### 明确的已知失败（必须写进文档，不能隐瞒）

| 问题 | 状态 |
|---|---|
| 纯 HTTP 上传新主图（`file/create`） | ❌ 恒返回 `40002 操作太过频繁`，试过 Node 直连 / 页面内执行 / 补浏览器头 / 换 Anti-Content / 4 种参数组合，全失败。三个账号都失败 |
| 换主图 | 只有 1 单成功过（`1026511479126`），之后无法复现 |
| 详情图纯 HTTP | 需 `detail_gallery` + `decorationDetail` 同时带；换图后需页面点「保存草稿」重建装修楼层，该按钮经常找不到 |

### 品牌字段（已确认的正确值）

| 字段 | 纸杯 cat16675 | 门贴 cat22278 |
|---|---|---|
| `propertys_tid` | `63387` | `39060` |
| `template_module_id` | `91765` | `50716` |
| 品牌 `vid` | `157882` | 不需要品牌 |
| `brand_limit` | true | false |

**`vid` ≠ `brand/audit/record` 返回的 `brand_id`（143701）**，两者不同。

## 必删文件（这两天试验留下的孤立死代码）

```
scripts/pdd-upload-image-node.mjs   ← 上传失败，从未成功
scripts/pdd-upload-via-page.mjs     ← 上传失败，从未成功
scripts/batch-final.mjs             ← 我的一次性批测脚本
scripts/attr-template-direct.mjs    ← 孤立，无人引用
scripts/category-template-v2.mjs    ← 孤立，无人引用
```

## 必须保留的文件（有引用）

```
scripts/publish-by-copy.mjs         ← 主路径
scripts/publish-flow.mjs            ← 页面路径
scripts/publish-v2.mjs
scripts/publish.mjs
scripts/harvest-native-props.mjs
scripts/category-template.mjs
scripts/batch-publish.mjs
scripts/stage-nav.mjs
scripts/stage-submit.mjs
scripts/spec-dims.mjs
scripts/spec-row-fill.mjs
scripts/sku-table.mjs
scripts/sku-thumb.mjs
scripts/attr-harvest.mjs
scripts/attr-composite.mjs
scripts/attr-fill-generic.mjs
scripts/field-basic.mjs
scripts/field-images.mjs
scripts/field-service.mjs
scripts/field-shipping.mjs
scripts/img-prep.mjs
scripts/compress-images.mjs
scripts/vision-fill.mjs
scripts/vision-cache.mjs
scripts/analyze_spec_ui.py
scripts/imgprep.py
```

## SKILL.md 目标结构

```markdown
# 拼多多商品上架

## 快速开始（30 秒决定用哪条路）
  表格：场景 → 用哪个脚本 → 限制

## 目录
  （一）两条发布路径
  （二）脚本清单
  （三）product.json 格式
  （四）类目模板与品牌
  （五）限流与风控
  （六）已知失败清单
  （七）排障速查

## 一、两条发布路径
  1.1 publish-by-copy.mjs（推荐，快）
  1.2 publish-flow.mjs（慢，但能处理换图）

## 二、脚本清单（按用途分组，不按文件名）
  2.1 主流程
  2.2 类目/属性
  2.3 表单填写（DOM 流程用）
  2.4 图片
  2.5 辅助

## 三、product.json 格式
  字段表 + 完整示例 + 校验规则

## 四、类目模板与品牌
  4.1 为什么要模板
  4.2 harvest-native-props 用法
  4.3 品牌字段对照表
  4.4 body schema 差异

## 五、限流与风控
  5.1 错误码表
  5.2 节流参数
  5.3 滑块处理

## 六、已知失败清单（不要重复踩）
  表格：问题 / 现象 / 试过什么 / 结论

## 七、排障速查
  表格：症状 → 原因 → 处理
```

## 输出要求

- 中文
- 表格优先，不要大段散文
- 每条结论后面标证据（日志文件名或 goods_id）
- 不写「大概」「应该」，要么确定要么标「未验证」
