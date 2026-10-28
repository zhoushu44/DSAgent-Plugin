# dev/ — 调试与真机验证脚本

本目录是**开发期工具**，不是产品路径。产品路径是 host 工具（`dsagent_taobao_publish` 等）
和 `skills/*/scripts/*.py` 薄壳。这里的东西用于：接入新平台时探 DOM、单链路真机验证、逆向提取。

> ⚠️ 这些脚本 `import` 的是 `lib/` 编译产物。改完 `src/` 必须先 `npm run build:host` 再跑。

## 淘宝发布链路（2026-10-28 类目属性修复配套）

| 脚本 | 用途 |
|------|------|
| `publish-taobao-direct.mjs` | **真机发布**，走 `directPublishUrl` 直达 catId 发布页。`--catId=150708 --confirm --brand=007 --title="..."` |
| `probe-taobao-catprop.mjs` | 探「类目属性」区真实 DOM（label/required/struct-p-\*/容器链）。零风险，不填表不提交 |
| `probe-taobao-brand.mjs` | 探「品牌」属性能否自动填（combobox 键入 + 选中 + 回读）。零风险 |
| `probe-taobao-catid3.mjs` | 借引擎选类目能力拿 catId（搜索 → 点路径 → 填品牌让「确认下一步」可用 → 从跳转 URL 抓 catId） |
| `probe-taobao-catid4.mjs` | 真实鼠标点击版选类目拿 catId（单关键词） |
| `probe-taobao-catid5.mjs` | **批量**拿多属性类目 catId（多关键词一轮）。双路径：网络 `selectProp` 响应只读拿 catId + 属性定义；辅路径点「确认，下一步」到发布页验证。`--confirm=0` 纯只读 |
| `probe-taobao-catid5b.mjs` | 诊断「品牌选中后按钮仍 disabled」+ 抓 selectProp 响应（单关键词，dump 品牌 DOM/面板/候选） |
| `probe-taobao-catid5c.mjs` | 已知 catId 时统计**发布页**类目属性规模（属性项/必填/未填清单）。只读 |
| `probe-taobao-attrscale.mjs` | 同上简版（kind 分布 + 「重要属性 N/M」进度 + 每项当前值） |
| `probe-taobao-attrkind.mjs` | 读单个属性项控件 DOM，判断 select / combobox / text；附「展开后真实候选」 |
| `probe-taobao-material.mjs` | 探「材质成分」行式复合属性（按钮增行 + 每行下拉 + 弹窗结构） |
| `probe-taobao-material2.mjs` | 复刻 `fillMaterialRows` 每步并打印状态（含落值回读） |
| `probe-taobao-model.mjs` | 定位「型号」字段容器（未填品牌前它不渲染，label 找不到） |
| `probe-taobao-size.mjs` | 探「请选择尺码」弹层（滚动到可见 + 等异步加载 + 定位「确定」按钮 + dump SKU 表 DOM） |
| `probe-taobao-colortag.mjs` | 诊断「主色(必选)」颜色值建立（Enter vs 点候选 vs 清空方式） |
| `probe-taobao-fillcheck.mjs` | 未填基线 dump（对照用） |
| `publish-taobao.mjs` | 旧版真机发布入口（扁平参数 + 相关性选类目）。保留作对照 |

实测结论已回填到 `skills/taobao-publish-mqs/SOURCE.md` §5.3、§5.4。

> `publish-taobao-direct.mjs` 参数：`--catId` / `--brand` / `--model` / `--title` / `--price` / `--stock`
> / `--attrs="裙型=碎花裙,面料=全棉"` / `--skus="黑色|110cm|59|100,白色|110cm|59|100"`

## 多属性类目 catId 速查（2026-10-28 探针 5 实测，均已验证）

| catId | 类目路径 | 属性项/必填 |
|-------|----------|------------|
| 121424009 | 童装/婴儿装/亲子装>儿童家居服>家居服套装 | 4 / 4 |
| 50013618 | 童装/婴儿装/亲子装>裤子（新）>休闲裤 | 8 / 8（含品牌选定后才渲染的「型号」） |
| 121452038 | 童装/婴儿装/亲子装>裙子(新)>连衣裙 | 6 / 6 |
| 50013189 | 童装/婴儿装/亲子装>T恤 | 6 / 6 |
| 50023573 | 孕妇装/孕产妇用品/营养>孕妇裤/托腹裤>孕妇打底裤 | 8 / 8 |
| 50010518 | 童装/婴儿装/亲子装>卫衣/绒衫 | 8 / 8 |
| 124230010 | 童装/婴儿装/亲子装>羽绒服饰/羽绒内胆>羽绒服 | 7 / 7 |
| 50010548 | 童装/婴儿装/亲子装>外套/夹克/大衣>普通外套 | 6 / 6 |
| 201315701 | 童装/婴儿装/亲子装>儿童牛仔>儿童牛仔裤 | 6 / 6 |
| 50010527 | 童装/婴儿装/亲子装>衬衫 | 6 / 6 |

> ⚠️ 两点反直觉结论：
> ① **选类目页**右侧「类目必填属性」面板只显示「品牌」1 项 —— 真正的多属性要到**发布页**才渲染，
>    所以判断「是否多属性类目」必须看发布页（用 `probe-taobao-catid5c.mjs`）。
> ② 淘宝童装/女装叶子类目的必填属性实测是 **4~8 项**（不是 10~20）；全部必填，无选填。
>    「重要属性 0/N」里的 N = 必填项数。
>
> ★ 选类目三大坑（探针 5 实测坐实）：
>   · 品牌是 **readonly select**（`.next-select-trigger`，input 只作面板内搜索框），
>     选项**只有 `.options-item`** 可点 —— `.sell-o-select-options`/`.options-content` 是容器，
>     用 `[class*="option"]` 会误抓容器导致点不中、按钮永不解禁；
>   · 页面**左侧类目树常驻可点**（约 191 个 `.category-item`），不是级联弹窗，
>     误点会把类目改掉（曾把「家居服套装」点成「浴袍」）；
>   · catId 有只读来源：选中类目时 SPA 发
>     `router/asyncOpt.htm?optType=selectProp&...&catId=<数字>`，响应体即属性定义。
>
> ★ 发布页三坑（2026-10-29 实测）：
>   · `scrollIntoView` 是**平滑滚动**，立刻取 `getBoundingClientRect` 拿到的是滚动中的坐标
>     （实测 y=450，稳定后应 y≈298）→ `mouse.click` 点到别的东西。必须轮询到坐标稳定再点；
>   · 「确定」按钮**不在**尺码浮层里（浮层只有「全选/全不选」），是独立浮层的
>     `next-btn.submit-btn`，只在尺码 panel 里找 button 永远找不到；
>   · 点「移除」清理自定义宝贝规格残留，会把已建好的颜色/尺码值**一起删掉**（已废止该做法）。

## 逆向提取

| 脚本 | 用途 |
|------|------|
| `extract-mqs.mjs` | 从觅千手 `source/pageHooks.js` 提取函数体 / 关键词上下文。`fn <name>` / `ctx <kw> [before] [after]` / `grep <re>` |

> 觅千手本地包只含**搬家**能力（`pageHooks.js`），不含淘宝**发品**属性填充 ——
> 结论见 `skills/taobao-publish-mqs/SOURCE.md` §5.3.1。

## 其它

| 脚本 | 用途 |
|------|------|
| `taobao-batch-publish.mjs` | 淘宝批量发布 |
| `taobao-publish-image-space.mjs` | 图片空间逆向 HTTP 上传单测 |
| `diag-taobao-json.mjs` | dump `window.Json/Json2` 结构（排查 replayMode 字段路径） |
