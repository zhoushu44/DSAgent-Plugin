# dev/ — 构建链与验证套件

本目录是**开发期工具**，不是产品路径。产品路径是 host 工具（`dsagent_taobao_publish` 等）
和 `skills/*/scripts/*.py` 薄壳。

> 2026-11-26 清理：删掉了 294 个一次性探针脚本（`probe-*` / `diag-*` / `check-*` / `fix_*` /
> `dump-*` / `test-*` 等）与运行时产物目录（`dev/.ui-shots/`、`dev/patrol-evidence/`）。
> 现在还留在这里的，只有**构建链**、**自检套件**、**测试**和**仍在用的辅助**。
> 需要重新探 DOM 时另写脚本，别往这里堆。

## 构建链（`npm run build` 会调用）

| 文件 | 作用 |
|---|---|
| `check-esm-purity.mjs` | `npm run check:esm`：检查源码没有 require / 非 ESM 写法 |
| `build-client.mjs` | 打客户端 bundle（依赖 `node-stub.js`） |
| `smoke-client.mjs` | 客户端 bundle 冒烟 |
| `node-stub.js` | `build-client.mjs` 的浏览器 API 打桩 |
| `portable/` | 便携版打包：`sync-to-host.mjs` / `build-portable.ps1` / `build-update.ps1` / `prepare-pydeps.ps1` |

## 自检套件

这些脚本 `import` 的是 `lib/` 编译产物，**改完 `src/` 必须先 `npm run build:host`**。

```bash
node dev/verify-skill-governance.mjs   # 47 项：双语评分 / 解析 / triggers / 统计 / patch
node dev/verify-patch-layer.mjs        # 25 项：patch 参与真实执行链路 / 对外 API
node dev/verify-wiki.mjs               # 68 项：八域 Schema / 锁定模板 / 漂移拦截 / 落盘
node dev/verify-wiki-textpath.mjs      # 25 项：文本路径与模板路径校验一致性（机密字段泄漏回归）
node dev/verify-pitfalls.mjs           # 54 项：签名折叠 / 证据阈值 / 陈旧退出 / 并发安全 / 记录策略
node dev/verify-host-integration.mjs   # 27 项：apply() 注册 38 工具 / 提示词 / 无回归
node dev/verify-real-triggers.mjs      # 用真实技能文件验证 triggers 匹配
node dev/workflow-test.mjs             # 73 项：模板校验 / 任务 CRUD / 变量渲染 / 失败策略 / 重启对账
node dev/workflow-real-create-run.mjs  # 真实技能创建+运行工作流（tariff-search / zhihu-crawl / douyin-crawl）
node dev/audit-skill-quality.mjs skills # 全体技能质量体检（可接 CI）
```

## 单元测试

`*.test.mjs`，直接 `node <文件>` 跑：

| 文件 | 覆盖 |
|---|---|
| `account-regression.test.mjs` | 账号服务回归 |
| `attr-cache.test.mjs` | 属性缓存 |
| `category-profile.test.mjs` | 类目档案 |
| `credential-health.test.mjs` | 凭证健康检查 |
| `gateway-cache.test.mjs` / `gateway-cache-e2e.test.mjs` | 网关响应缓存（单测 + 端到端） |
| `pdd-mode2-assemble.test.mjs` / `pdd-mode2-diff.test.mjs` | 拼多多 mode2 请求体组装与差异 |
| `patrol-publish.test.mjs` | 巡店发布链路（配套 `patrol-publish.mjs`） |
| `smart-truncate.test.mjs` | 长文本截断 |
| `suggest-rules.test.mjs` | 建议规则 |

## 淘宝多属性类目 catId 速查（2026-10-28 实测，均已验证）

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
>    所以判断「是否多属性类目」必须看发布页。
> ② 淘宝童装/女装叶子类目的必填属性实测是 **4~8 项**（不是 10~20）；全部必填，无选填。
>    「重要属性 0/N」里的 N = 必填项数。

### 坑位结论（实测坐实，脚本已清但结论有效）

**选类目三大坑**

- 品牌是 **readonly select**（`.next-select-trigger`，input 只作面板内搜索框），
  选项**只有 `.options-item`** 可点 —— `.sell-o-select-options` / `.options-content` 是容器，
  用 `[class*="option"]` 会误抓容器导致点不中、按钮永不解禁；
- 页面**左侧类目树常驻可点**（约 191 个 `.category-item`），不是级联弹窗，
  误点会把类目改掉（曾把「家居服套装」点成「浴袍」）；
- catId 有只读来源：选中类目时 SPA 发
  `router/asyncOpt.htm?optType=selectProp&...&catId=<数字>`，响应体即属性定义。

**发布页三坑**

- `scrollIntoView` 是**平滑滚动**，立刻取 `getBoundingClientRect` 拿到的是滚动中的坐标
  （实测 y=450，稳定后应 y≈298）→ `mouse.click` 点到别的东西。必须轮询到坐标稳定再点；
- 「确定」按钮**不在**尺码浮层里（浮层只有「全选/全不选」），是独立浮层的
  `next-btn.submit-btn`，只在尺码 panel 里找 button 永远找不到；
- 点「移除」清理自定义宝贝规格残留，会把已建好的颜色/尺码值**一起删掉**（已废止该做法）。

## 运行时产物

`src/taobao-publish.ts` / `src/mqs-publish.ts` 的诊断模式会往 `dev/.ui-shots/` 截图和 dump JSON，
目录不存在时会自己 `mkdir -p`，所以平时可以不建。

## 逆向提取笔记

觅千手本地包只含**搬家**能力（`pageHooks.js`），不含淘宝**发品**属性填充 ——
结论见 `skills/taobao-publish-mqs/SOURCE.md` §5.3.1。
