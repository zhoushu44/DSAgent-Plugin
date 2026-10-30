# dom-map-rpa 优化建议与补丁说明

**日期**：2026-10-30  
**背景**：拼多多商家后台使用 beast-core 非语义组件，原 `page-mapper.js` 的字段绑定逻辑完全失效（379 个 formFields 全是页头页脚装饰，0 个真实属性字段）。

---

## 已打补丁（5 个）

### 补丁 ①：容器级 label 推断

**问题**：`fieldLabelInfo` 只认 `label[for]` / `aria-labelledby`，而拼多多属性区是**非语义 div 嵌套**：

```html
<div class="property-item">
  <label>材质成分</label>              <!-- 字段名在这 -->
  <div id="basic.propertys.0.value">
    <input data-testid="beast-core-select-htmlInput">
  </div>
</div>
```

字段名和控件是**兄弟节点**，没有 for/aria 关联。

**修法**：在 `fieldLabelInfo` 里加「容器级 label 推断」——
从当前元素往上找 `.property-item / .goods-spec-row / .property-container-v2`，
在容器内按优先级取：
1. `.property-name-title` / `[class*="sizeStandardWrapper_title"]`
2. 容器内**不在控件子树里**的 `<label>`
3. 带 `label`/`title` 类名的元素

**位置**：`page-mapper.js` `fieldLabelInfo` 函数内，`const text = ...` 之前。

---

### 补丁 ②：下拉候选探测

**问题**：`collect()` 是只读快照，不会开下拉，所以**拿不到候选值**。

**修法**：在 `collect()` 的 `return { nodes, ... }` 之前，加一段：
- 找当前**已展开**的下拉面板（`[class*="dropdownPanel"]` / `[class*="dropdownMain"]` / `[class*="PP_popover"]`）
- 读面板里的 `li / [role="option"] / [class*="ST_item"]` 文本
- 附到**最后一个 select 节点**的 `options` 字段上

**注意**：不主动点开下拉（避免改变页面状态），只读已展开的。

---

### 补丁 ③：portal 感知

**问题**：拼多多的下拉面板**挂在 body 下**（`PP_popoverContent` / `dropdownPanel`），不在字段容器内。

**修法**：同补丁 ②，全局搜 `[class*="PP_popover"]`，不局限于字段容器。

---

### 补丁 ④：组件签名识别

**问题**：拼多多自定义组件类名（`beast-core-*` / `IPT_*` / `CBX_*` / `RD_*`）无法映射到标准角色。

**修法**：加 `pddComponentRole(el)` 工具函数：

| 类名/属性前缀 | 标准角色 |
|---|---|
| `beast-core-select` / `ST_select` / `selectValueSingle` | `select` |
| `beast-core-input` / `IPT_` | `input` |
| `CBX_` | `checkbox` |
| `RD_outerWrapper` / `RDG_` | `radio` |
| `IngredientList` | `ingredient`（材质成分多选弹窗） |

**位置**：`fieldLabelInfo` 函数前插入。

---

### 补丁 ⑤：role 附加到 fieldLabelInfo

**修法**：`fieldLabelInfo` 返回值加 `role` 字段，来自 `pddComponentRole(el)`。

这样下游可以按 `role` 分派填法：
- `select` → 开下拉选
- `input` → JS setter 填
- `checkbox` → 勾选
- `ingredient` → 弹窗多选

---

## 验证结果

**升级前**：`formFields: 379`，其中 `labelText` 非空的 **0 个**（全是页头页脚装饰）

**升级后**：待重新采集验证（需登录态）

---

## 与 attr-harvest.mjs 的关系

`attr-harvest.mjs` 是**针对 beast-core 写的专用采集器**，已验证能正确采集：
- 纸杯：4 个属性 + 27 个候选值

`dom-map-rpa` 补丁是**通用化改造**，让它也能处理这类非语义组件。

**建议**：
- **生产路径**：继续用 `attr-harvest.mjs`（已验证）
- **dom-map-rpa**：作为通用探索工具，补丁让它能覆盖更多非标准页面

---

## 后续可优化

1. **framePath 枚举**：拼多多后台可能有 iframe，需要递归 frame 采集
2. **弹窗联动**：材质成分弹窗是 `IngredientList_searchPanel`（272×360 小浮层），需要专门处理
3. **级联下拉**：品牌 → 子品牌 → 型号 的级联选项，需要记录父子关系
4. **AI map 紧凑化**：`toAIMap` 目前可能因字段过多导致协议错误，需要限制大小
