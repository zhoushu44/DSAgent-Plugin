# 拼多多上架 · 来源与同步（SOURCE）

> 用途：本 skill（`dsagent_pdd_publish2`，引擎 `src/pdd-publish.ts`）的上架链路 / 字段 / 选择器来自**本机真机实测**，
> 早期还参考过一份**已过时**的影刀工程选择器。
> 当 skill 出现问题时（拼多多改版、选择器失效、字段对不上），**回到本文的来源重新比对，再同步更新**。
> 来源更新时，按第 5 节流程重做一遍。

---

## 1. 来源标识

| 项 | 值 |
|---|---|
| 主来源 | **本机真机实测**（在真实拼多多商家后台走通整条发布链路，逐锚点验证）|
| 实测时间 | **2026-10-14**（流程变更后重测）|
| 逆向来源（神笔）| **神笔 Setup 1.2.4**（PDD 上传工具），逆向提取 31 步发布流程锚点。详见第 7 节 |
| 参考来源（已证伪）| 影刀（ShadowBot）工程 `xbot_robot/selectorsV2.xml`（明文），app「noco传宝贝」拼多多组 —— 锚点**全部过时**，见第 4 节 |
| 官方更新页（飞书）| 见第 1.1 节（同类拼多多上货工具的官方下载/更新页，用于后续比对同类实现）|
| 商家后台 | `https://mms.pinduoduo.com/`（凭证库 platform = `pdd_mms`）|
| 引擎实现 | `src/pdd-publish.ts`（host 半区 puppeteer 驱动，非纯 HTTP）|
| 技能文档 | `skills/pdd-publish-2/SKILL.md` |

> **为什么主来源是真机实测而非逆向第三方工具**：拼多多发布页的类目、属性、提交接口都要求页面 JS 运行时生成的签名与真实会话票据（PASS_ID），
> 且主图走 multipart 二进制上传；开放平台 `pdd.goods.add` 只对**已审核通过的自研应用**开放，普通店铺拿不到资质。
> 因此只能驱动商家后台网页版发布页，链路与锚点**以真机实测为准**。

### 1.1 官方更新页（飞书）★ 核心字段

同类拼多多上货 / 上传工具的官方飞书页（来源：`downloads/ecommerce_catalog.md`）。用于：
**当本 skill 的链路/字段出问题时，对照同类工具的官方更新说明，判断是平台改版还是实现缺陷。**

| 工具 | 类型 | 飞书页 / 官方页 |
|---|---|---|
| 灰熊上货 | 拼多多上传 | https://my.feishu.cn/wiki/N7I9w9W2kiC8kWkEM5HcTCmqnrd |
| 神笔 | 拼多多上传 | https://my.feishu.cn/wiki/EkJtwAL4AioXN1kLBdPcRGWWnbh |
| 天牛多多版 | 拼多多上传 | https://my.feishu.cn/wiki/L7y5wIANkiAabtkPfMYcRwwmnXb |
| 福德上货（原小鼠搬家）| 拼多多上传 | https://my.feishu.cn/wiki/Yx0YwJxKNiQ4Ijk8PhZcoJG9nLg |
| 向风店管家 | 拼多多上传 | https://docs.qq.com/doc/DUkdKQlhBSUdiQldJ |
| 上货精灵（旺宝）| 拼多多上货 | http://www.58wangbao.com/help.html |

> 注：这些是**生态参考**，本 skill 未直接采用其实现（本 skill 按真机实测实现）。飞书页会随工具更新，
> 是观察「拼多多后台改版」最快的旁证。

---

## 2. 采集方法（可重复）

1. 绑定「拼多多商家后台」账号（登录 `mms.pinduoduo.com`，扫码或账密）。
2. 用 puppeteer 打开**可见浏览器**，从商品列表 `https://mms.pinduoduo.com/goods/goods_list` 起，人工/脚本走完一遍发布链路。
3. 每到一个页面，用 DevTools 记录：
   - 页面 URL 形态（含查询参数）
   - 关键控件锚点（属性选择器 / 文本锚点）
   - 页面跳转方式（新标签页 vs 同页跳转）
4. 把验证通过的锚点回填到 `src/pdd-publish.ts` 文件头注释与对应函数，并更新本文第 3 节。

---

## 3. 实测有效锚点（2026-10-14）

### 3.1 四段链路

| 段 | 页面 | URL 特征 | 跳转方式 |
|---|---|---|---|
| 段 1 | 商品列表 → 点「发布新商品」| `/goods/goods_list` | **新开标签页** |
| 段 2 | 选择分类页 | `/goods/category?id=…&goods_id=…&type=add` | 同标签页 |
| 段 3 | 发布表单页 | `/goods/goods_add/index?type=add&from=category&id=…` | **同页跳转**（targetchanged）|
| 段 4 | 提交成功 | `/goods/goods_add/success?goods_id=…` | 同标签页 |

> ★ **不能直接敲表单 URL**：直接 `goto /goods/goods_add/index` 会得到「空壳页」（`#goods-category` 为空、底部按钮永远「加载中」且 disabled、初始化接口一个都不发）。
> 必须从「选择分类」页点「确认发布该类商品」，由平台即时生成 `type=add&from=category&id=<类目id>&goods_id=<商品id>` 上下文参数。

### 3.2 控件锚点

| 位置 | 锚点 | 备注 |
|---|---|---|
| 列表入口按钮 | 文本恰为「发布新商品」的最内层可见元素 | |
| 类目搜索框 | `input[placeholder*="搜索分类"]` | ★ 不能放宽为 `[placeholder*="搜索"]`：会先命中顶部全局搜索框 |
| 类目搜索结果 | `li.SPP_searchItem_*` | 完整路径文本，untrusted click 有效 |
| 类目确认按钮 | 文本恰为「确认发布该类商品」的可见 button | untrusted click 有效 |
| 表单标题 | `input[data-tracking-click-viewid="title_input_area"]` | |
| 表单主图 | `input[data-tracking-click-viewid="carousel_img_localfile_upload"]` | |
| 表单提交 | 文本恰为「提交并上架」的可见 button | |
| 提交成功 | `div[data-testid="beast-core-toast"]` / 「查看商品详情」| |
| 风控滑块 | `div#slide-captcha-dialog` / `.captcha-wrapper__slider` / `div.slide-handlebar` / `#slide-button` | 见 3.3 |

### 3.3 两处与淘宝的结构差异

- **拼多多发布页没有 iframe**（淘宝主图走 `sucai-selector-ng` 素材选择器 iframe）；所有控件都在主文档里，直接操作即可。
- **风控滑块是页内内联的**（不是淘宝那种 baxia iframe 拦截页），无可透传 verifyUrl；因此不交给 `dsagent_risk_verify`，而是本工具在**已打开的可见窗口内**等用户完成拼图后自动继续（`waitSliderCleared`）。

### 3.4 已知的稳定现象（非故障）

- 首次点「下一步」可能被页面时序吞掉 → 工具**自动补点一次**（整体耗时偏长，属正常）。
- 提交被平台拦下时页面**不弹 toast**，拦因只出现在右侧「商品填写建议」面板 → 工具读该面板并把真实原因写进返回值（`readSubmitErrors`）。

---

## 4. 已证伪的过时参考（切勿再采用）

影刀（ShadowBot）工程 `xbot_robot/selectorsV2.xml` 的拼多多锚点**全部过时**：

| 影刀旧锚点 | 实测结论 |
|---|---|
| 类目面板 `.cate-container-v2` | 实为 `.category_v4_cateContainerV4__2jyMc`（v4）|
| 提交按钮 `button#submit_button` | **不存在** |
| `#goods_name` | **不存在**（表单标题改用 `title_input_area`）|
| `button#bottomSubmitBtnId` | **不存在** |
| `local_upload` | **不存在**（主图改用 `carousel_img_localfile_upload`）|

> 旧版「两步式」流程（category 页直接出主图+标题表单、底部「下一步」）**已废除**，现为四段链路（见 3.1）。

---

## 5. 同步更新流程（拼多多后台改版时）

1. 先用第 1.1 节同类工具的**飞书页**确认是否为平台级改版（多款工具同期更新 = 大概率平台改版）。
2. 按第 2 节重新走一遍真机链路，记录新的 URL 形态与控件锚点。
3. 对照第 3 节，逐条更新 `src/pdd-publish.ts` 文件头注释 + 对应选择器函数。
4. 更新本文第 3 节锚点表；把新证伪的旧锚点移入第 4 节。
5. 跑发布相关回归（`node dev/publish-pdd2.mjs` 等）确认无回退。

---

## 6. skill ↔ 来源映射

> skill 里的每个 URL / 选择器 / 字段 → 本文来源位置。

| skill / 引擎位置 | 来源位置 | 说明 |
|---|---|---|
| `PDD_GOODS_LIST_URL` | 3.1 段 1 | 唯一正确起点（从列表点「发布新商品」才带完整上下文参数）|
| `STEP1_URL_RE` `/goods/category?` | 3.1 段 2 | 类目选择页特征 |
| 表单页路径前缀判定 | 3.1 段 3 | `type=add&from=category&id=…` |
| 类目搜索 / 结果 / 确认锚点 | 3.2 | `搜索分类` / `li.SPP_searchItem_*` / 「确认发布该类商品」|
| 表单标题 / 主图 / 提交锚点 | 3.2 | `title_input_area` / `carousel_img_localfile_upload` / 「提交并上架」|
| 提交成功判定 | 3.2 | `beast-core-toast` / 「查看商品详情」|
| 风控滑块处理 | 3.2 + 3.3 | `#slide-captcha-dialog` 等，页内内联等待 |
| 商品属性自动填 | `SKILL.md` 商品属性自动填 | 宿主对话模型从页面真实下拉选项选值；模型不可用时走标题词匹配 + 选第一项兜底（对齐神笔 step 10）|
| 发货与售后自动填 | 神笔 step 25（第 7 节） | `service.is_pre_sale` 非预售 + `service.shipment_limit_second` 发货时间 |
| 运费模板自动填 | 神笔 step 26（第 7 节） | `service.is_default_template_id` 其他模板 → 搜索模板名 |
| 尺码表停用 | 神笔 step 20（第 7 节） | `disable_size_chart` → 确认停用 |
| 类目确认锚点 | 神笔 step 11（第 7 节） | `data-tracking-click-viewid="cate_confirm"` / `confirm_publish_this_type_product` |
| 字段策略（自动/人工兜底）| `src/pdd-publish.ts` 文件头 | 类目/主图/标题/参考价/库存/货号/属性/发货售后/运费模板自动；品牌/资质人工 |

---

## 7. 神笔（Setup 1.2.4）逆向溯源详情

### 7.1 来源标识

| 项 | 值 |
|---|---|
| 工具名 | 神笔（Setup 1.2.4）|
| 类型 | 拼多多商品上传工具（Electron 桌面应用）|
| 安装包 | `神笔_Setup_1.2.4.exe` |
| 打包器 | NSIS-3 Unicode |
| 运行时 | Electron（Chromium + Node.js）|
| 核心产物 | `app-64.7z` → `resources/app.asar` → `background.js`（~5.9MB，31 步发布流程）|
| ★ 官方更新页（飞书） | **https://my.feishu.cn/wiki/EkJtwAL4AioXN1kLBdPcRGWWnbh** |
| 逆向时间 | 2026-10-14 |

> **用途**：神笔的 31 步流程锚点用于**对照验证**本 skill 的发布链路。当本 skill 出问题时，对照神笔的对应步骤锚点判断是拼多多改版还是本 skill 实现缺陷。神笔是**参考来源**，本 skill 的主来源仍为真机实测。

### 7.2 提取方法（可重复）

```bash
# 1. NSIS 静默解包（提取安装包内容到目录）
7z x "神笔_Setup_1.2.4.exe" -o"shenbi_extracted"

# 2. 解压 Electron 应用包
7z x "shenbi_extracted/app-64.7z" -o"shenbi_app"

# 3. 解包 asar 归档（提取 JS 源码）
npx @electron/asar extract "shenbi_app/resources/app.asar" "shenbi_src"

# 4. 核心 JS 在 background.js（~5.9MB），含完整 31 步发布流程
#    搜索 getStepName / data-tracking / XPath 锚点
```

### 7.3 神笔 31 步流程锚点表

以下列出本 skill 实际参考的步骤锚点（仅列出被采用/对照的步骤，非全部 31 步）：

| 步骤 | 神笔步骤名 | 锚点（XPath / data-tracking / 文本） | skill 对应函数 |
|---|---|---|---|
| step 10 | 商品属性填写 | 搜不到匹配值时取第一个选项（`options[0]`）| `fillAttributes` — 标题词匹配 + 选第一项兜底 |
| step 11 | 类目确认 | `button[data-tracking-click-viewid="cate_confirm"]` + `button[data-tracking-impr-viewid="confirm_publish_this_type_product"]` | `selectCategory` — 确认按钮锚点 |
| step 20 | 停用尺码表 | `a[data-tracking-impr-viewid="disable_size_chart"]` → `//button[.//text()="确认停用"]` | `disableSizeChart` — 新增函数 |
| step 25 | 发货与售后 | `//div[@id="service.is_pre_sale"]//label[.//text()="非预售"]`；`//div[@id="service.shipment_limit_second"]//label[.//text()="当日发货及揽收"]` | `fillShippingAndFreight` — 非预售 + 发货时间 |
| step 26 | 运费模板 | `//div[@id="service.is_default_template_id"]//label[.//text()="其他模板"]` → `.template-box-select input` → `//ul[@role="listbox"]//li[.//text()="${模板名}"]` | `fillShippingAndFreight` — 运费模板选择 |

### 7.4 skill ↔ 神笔映射（逐条可回溯）

| skill 修改点 | `src/pdd-publish.ts` 位置 | 神笔 background.js 对应步骤 | 采纳方式 |
|---|---|---|---|
| 类目确认锚点 | `selectCategory` 确认按钮段 | step 11 `cate_confirm` / `confirm_publish_this_type_product` | **直接采用** data-tracking 锚点替代文案匹配 |
| 尺码表停用 | `disableSizeChart` 函数 | step 20 `disable_size_chart` → 确认停用 | **直接采用**，chips 勾选后调用 |
| 发货时间 | `fillShippingAndFreight` ①②段 | step 25 `service.is_pre_sale` / `service.shipment_limit_second` | **直接采用** XPath 锚点 |
| 运费模板 | `fillShippingAndFreight` ③段 | step 26 `service.is_default_template_id` → 下拉搜索 | **直接采用** XPath + 下拉选择流程 |
| 属性兜底 | `fillAttributes` 兜底段 | step 10 搜不到取第一个 | **对齐策略**：标题词匹配优先，无匹配再选第一项 |
| chips 先全取消再勾选 | `fillSpecValueChips` 修改段 | 神笔未涉及此逻辑（神笔用 React 实例直调）| **本仓原创**修复（probe6 根因：force toggle 触发表重建）|

### 7.5 已证伪的旧参考（神笔部分）

| 神笔锚点 | 试过但不成立 | 原因 |
|---|---|---|
| 无 | — | 神笔的 data-tracking 锚点在 2026-10-14 实测均有效 |

> 神笔的 React 实例直调方式（如 `__reactProps$` / `__reactFiber$`）本 skill **未采用**——puppeteer 页面的 React 内部属性名不稳定，改用 data-tracking + XPath 更可靠。

### 7.6 同步更新流程（神笔出新版时）

1. 访问飞书页 **https://my.feishu.cn/wiki/EkJtwAL4AioXN1kLBdPcRGWWnbh** 确认是否有新版。
2. 下载新版安装包，按 7.2 节步骤重新解包。
3. 搜索 `background.js` 中 `getStepName` / `data-tracking` / `service.` 锚点，与 7.3 节对照。
4. 锚点变更 → 更新 `src/pdd-publish.ts` 对应函数 + 本节锚点表。
5. 跑 `npm run build:client` + `node dev/publish-pdd2.mjs` 确认无回退。
