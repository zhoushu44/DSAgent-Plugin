# 淘宝上架 · 来源与同步（SOURCE）

> 用途：本 skill 的上架链路 / 字段 / 选择器来自对第三方工具「**上架助手 6.33**」的逆向提取。
> 当 skill 出现问题时（淘宝改版、选择器失效、字段对不上），**回到本文的来源重新提取比对，再同步更新**。
> 来源更新（出了新版本）时，按第 5 节流程重做一遍。

---

## 1. 来源工具标识

| 项 | 值 |
|---|---|
| 工具名 | 上架助手（Inno 产品名：`上架助手 Setup`）|
| 版本 | **6.33**（同目录另有 3.46 旧版）|
| 安装包路径 | `电商软件\安装上架助手6.33.exe` |
| 安装包大小 | 108 MB |
| 安装包 SHA-256 | `F8FEC439F6C93D4185C297034065A62BBE4BA3176EEC80F406264B731C00F4B9` |
| 打包器 | Inno Setup 6.0.0 (u) |
| 运行时 | PyInstaller · Python **3.8** x64（`python38.dll`）|
| 依赖栈 | PyQt5 + QtWebEngine（Chromium 内核）+ selenium + gevent + greenlet + cryptography + pywin32 + psutil |
| 主程序 | `上架助手.exe`（6.28 MB）SHA-256 `6038CC24D9B175E4B096F65D1960D1C9EB06277169C588EF5D474CF0950E9C34` |
| 更新器 | `updater.exe` SHA-256 `5E051E4C3926B4DA4E18FFB5895438736B52C469D86DC92A1EB514D6AE1D731F` |
| **官方更新页（飞书）** | **https://my.feishu.cn/wiki/O2Mhwgr3XisuslkIDIZc6dpfnvf** （「上架助手【最新实时更新安装包】」）|
| 定位 | 淘宝商品批量上架 / 店群管理（内置店铺数据看板）|

> **官方更新页（飞书）是溯源文档的核心必备字段**：出问题时先去该页看是否有新版本 / 更新说明，
> 再决定是否重做提取（第 5 节）。来源更新（出了新版本）时，先更新本行链接与版本号。
>
> 技术栈含义：**上架动作靠 selenium / QtWebEngine 驱动真实淘宝网页**完成，不是纯接口直发 —— 与我们的 skill 路线一致。

---

## 2. 提取方法（可重复）

7-Zip **不支持** Inno 格式，用 Inno 自带的静默解包（不写注册表、不装到系统盘）：

```powershell
$dir = 'E:\rea-tmp\shangjia633'
Start-Process -FilePath 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\电商软件\安装上架助手6.33.exe' `
  -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NOICONS',"/DIR=$dir" -PassThru -Wait
```

- 产物目录：`E:\rea-tmp\shangjia633`（**临时区，不在仓库内**，可能被清理 → 需要时按上表重跑）
- ⚠️ 安装器 `[Run]` 段会**自动拉起** `上架助手.exe`，解包后记得清掉：
  ```powershell
  Get-Process -Name '上架助手','updater' -ErrorAction SilentlyContinue | Stop-Process -Force
  ```

---

## 3. 提取产物结构

### 3.1 顶层（`E:\rea-tmp\shangjia633`）

| 文件 / 目录 | 说明 |
|---|---|
| `上架助手.exe` | PyInstaller 主程序（**仅启动壳**；业务逻辑在 `d2.pyd`，见 §4）|
| `updater.exe` | 自动更新器（实际逻辑在 `update.pyd`）|
| **`d2.pyd`** | **Cython 主业务模块**（7.88 MB，1029 个 `d2.*` 名）|
| **`update.pyd`** | Cython 更新器模块（149 KB）|
| `base_library.zip` | PyInstaller 冻结的 Python 标准库 |
| `python38.dll` / `*.pyd` | Python 3.8 运行时与扩展模块 |
| `PyQt5\` | Qt 界面 + **QtWebEngine**（内嵌 Chromium，上架网页载体）|
| `selenium\` | 浏览器自动化 |
| `Crypto\` `cryptography\` | 加解密（用于 `data_sjzs` 脚本解密）|
| `gevent\` `greenlet\` `psutil\` `win32\` | 并发 / 进程 / Win32 |
| `QtWebEngineProcess.exe` `icudtl.dat` `qtwebengine_*.pak` | Chromium 运行时 |
| `data_sjzs\` | **应用自有数据 / 脚本目录（关键）** |
| `groups.json` | 店铺分组配置（默认：`{"_default":"默认分组","_order":["默认分组"],"默认分组":[]}`）|
| `unins000.exe` / `.dat` | Inno 卸载器 |

### 3.2 `data_sjzs\`（资源与加密负载区）

| 文件 | 大小 | 头 16 字节 | 判定（2026-10 实测修正）|
|---|---|---|---|
| `sjzs_1/2/3/d/f/g/t/tt/x/z` | 16.6 KB | `00 00 01 00 01 00 40 40 …` | **原始 DIB 图标位图**（BITMAPINFOHEADER：64×64、32bpp）；由 CSS `image: url(data_sjzs/D)` 等引用 → **UI 图标，不是脚本** |
| `sjzs_l` | 66.1 KB | `00 00 01 00 01 00 80 80 …` | DIB 图标，**128×128** |
| `sjzs_s` | 4.2 KB | `00 00 01 00 01 00 20 20 …` | DIB 图标，**32×32** |
| `sjzs.q` / `sjzs0.q` | 2.8 / 3.3 KB | `89 50 4E 47` | PNG 图片（启动图/背景）|
| **`sjzs_di`** | 64.5 KB | ASCII base64 | **加密负载**：base64 解码后 **49571 B、熵 7.997**（≈全随机），非 utf8/gzip/zlib |
| **`sjzs_zd`** | 1513.4 KB | ASCII base64 | **加密负载**：base64 解码后 **1162297 B、熵 8.000**（≈全随机），非 utf8/gzip/zlib |
| `right6_display_settings.json` | 1.1 KB | JSON | 看板列显隐开关（店铺/余额/直通车等 44 项）|
| `error\<md5>\*.log.enc` | — | — | 加密运行日志 |
| `ck\` | 空 | — | cookie 目录 |

> **修正结论**：`sjzs_1…z` / `sjzs_l` / `sjzs_s` 是 **UI 图标位图**，早期「自定义二进制脚本」判定**已证伪**。
> 真正的加密负载只有 `sjzs_di`、`sjzs_zd` 两个 base64 blob，熵≈8.0（≈全随机）；
> 用静态候选密钥（RC4 / AES-ECB / AES-CBC / AES-GCM，多组 hex/b64/ascii key）试解**全部失败**
> → 密钥为**运行时协商**（见 §4.4 的 `work_key` / `_resume_key` / `ServerCTunnelClient`），**离线不可解**。

---

## 4. 核心业务逻辑位置与已解出的接口面

### 4.1 修正：业务逻辑不在 exe 的 `.pyc`，而在 Cython 扩展

| 模块 | 类型 | 说明 |
|---|---|---|
| `上架助手.exe` | PyInstaller（Python 3.8 x64）| 仅**启动壳**：`上架助手.pyc` 只做导入与界面拉起；`PYZ-00.pyz` 内含标准库 |
| **`d2.pyd`**（7.88 MB）| **Cython 0.29.37 编译** | **主业务模块**（1029 个 `d2.*` 限定名）：登录、发布、上下架、删除、体检、详情装修、隧道、加解密 |
| `update.pyd`（149 KB）| Cython 编译 | **自动更新器**（RSA-2048 验签 + AES-GCM 下载解密），**非** sjzs 解密模块 |

> `d2.pyd` / `update.pyd` 为 Cython 产物：**Python 字符串字面量（URL / 字段名 / 内嵌 JS）原样保留在二进制中**，可直接字符串提取。

### 4.2 从 `d2.pyd` 提取到的淘宝接口面（可直接参考）

| 用途 | 接口 / URL |
|---|---|
| 发布（无线 AI 发布）| `mtop.taobao.sell.wireless.ai.publish.render` / `.submit` |
| PC 管理（淘宝）| `mtop.taobao.sell.pc.manage.render` / `.async` |
| PC 管理（天猫）| `mtop.tmall.sell.pc.manage.render` / `.async` |
| 运费模板 | `https://item.upload.taobao.com/taobao/manager/refreshDeliveryTemplate` |
| 素材中心 | `https://sucai.wangpu.taobao.com` |
| 详情装修 | `https://xiangqing.wangpu.taobao.com/index.html` |
| 商品列表（在线/仓库）| `https://xiangqing.wangpu.taobao.com/item/ajax/ItemList.do?currentPage=1&pageSize=1&importantItem=0&online=2` |
| 图片空间 | `https://tadget.taobao.com/redaction/redaction/json.json?cmd=json_batch_query｜json_file_ref｜json_ref_query｜json_async_delete` |
| 卖家中心 | `https://myseller.taobao.com/home.htm/SellManage/on_sale｜rubbish`、`/home.htm/PriceManagement` |
| 登录 | `https://login.taobao.com/member/login.jhtml?style=mini&newMini2=true&redirectURL=https://myseller.taobao.com/home.htm#/index`、`https://login.taobao.com/newlogin/login.do` |
| 体检 / 违规 | `https://healthcenter.taobao.com/home/health_home.htm`、`mtop.alibaba.healthcenter2.punish.*` |
| 生意参谋 | `https://sycm.taobao.com/cc/cockpit/marcro/item/top.json` |
| **厂商自有服务端** | `https://sjzsapi.cn:1099`、`http://110.40.229.135:8080`、`http://183.56.247.52:107` |

### 4.3 从 `d2.pyd` 提取到的内嵌登录 / 滑块诊断 JS（可直接复用）

- 登录：`#fm-login-id`、`#fm-login-password`、`button.fm-button.fm-submit.password-login`、`i.iconfont.icon-password`
- 登录失败提示：`.login-error, .login-error-msg, #login-error`
- **baxia 滑块判定**：`iframe#baxia-dialog-content`
- 诊断全局：`window.__sjzsLoginDiagnostic`、`sjzs-screenshot-v1`、`.sjzs-login.lock`

### 4.4 加解密与授权线索（`d2.pyd`）

- 函数 / 符号：`rc4_decrypt`、`rc4_encrypt`、`primary_decrypt`、`work_key`、`old_key`、`_resume_key`、`aes_key`、`encrypted_key`、`encrypted_text`、`encrypted_image`
- 授权：`_license_*` / `_shop_license_*`、`LICENSE_REFRESH_WAIT`、`_resume_public_key`
- **反向隧道**：`ServerCTunnelClient` + `_ServerCResolver` + `TunnelAuthError`（心跳 / 重连 / 断线状态 `tunnel_offline`）
- 更新协议标签 `sjzs-long-text-v1` 位于 `update.pyd`，是**更新器协议标签**，**不是** sjzs 文件解密 key

> **结论**：`sjzs_di` / `sjzs_zd` 很可能由 `ServerCTunnelClient` 从厂商服务端（`sjzsapi.cn:1099`）下发的**加密脚本包**，
> 密钥运行时协商（`work_key` / `_resume_key`）→ **离线无法还原**（§3.2 试解已证）。

### 4.5 备选路线：运行时抓包（推荐，权威来源）

启动工具走一遍真实上架，用 REA 的 web / network 观测（或本地代理）抓取：
发布页真实 URL、DOM 选择器、字段映射、MTOP 请求参数与 `sign` 生成时机。

---

## 4.6 2026-10 新版 SKU 面板实测（「+ 创建规格」链路）——已定性：转人工，不做自动适配

> 实测时间：2026-10-16；平台后台：`https://item.upload.taobao.com/sell/v2/publish.htm?catId=50025033`（手机壳/保护套定制）。
> ★ 探针脚本（probe-attr-sku / attach-inspect / attach-plus-test 等）与证据 JSON/PNG 已按精简决策删除（2026-10-16），**本节是这段机制的唯一记录**。
> ★ 定性结论（2026-10-16 拍板）：**不为新面板写自动适配**（原 g3/fillSkusV2 方向废弃）。`src/taobao-publish.ts` `fillSkus()` 运行时检测到「+ 创建规格」即 push missed 转人工补填（+ 对话引导），不阻断发布。依据：
> ① 逆向结论——「上架助手 6.33」发布走 MTOP 无线 AI 发布接口（`mtop.taobao.sell.wireless.ai.publish.render/.submit`，服务端按类目渲染表单默认值，选择器脚本运行时下发），影刀靠人工维护 `selectorsV2.xml`——**没有任何工具做逐类目 DOM 适配**；
> ② 类目属性自动化已由类目档案（`src/services/category-profile.ts`，首次人工补 → 发布成功自动存档 → 二次回放）覆盖；SKU 是**商品级**数据，不入类目档案，档案边界到属性为止。

### 触发判定（skill 运行时检测，非按类目缓存）

`#struct-sku` / `#struct-saleProp` 内存在**可见**元素（button/a/div/span）文本匹配 `/^\s*\+\s*创建规格/` → 新面板链路（missed 转人工）；否则走旧版 `#struct-saleProp` 链路（fillSkus 原逻辑不变）。
面板提示语「近期已升级SKU面板，优化SKU创建流程提升操作体验」——**全类目改版，非手机类目特有**，任何类目都可能遇到，靠运行时检测分流。

### 新面板结构（`next-overlay-wrapper.opened` 弹层，文本含「确认创建」）——人工补填指引依据

1. 属性卡**默认预选**（颜色分类 + 适用型号均 `prop-item selected`，「属性 2/2」）；点已选卡会 **toggle 取消**——已选则跳过
2. 展示模式 radio：「分层展示·选择标准属性构建规格」为默认 checked
3. 每个已选属性一个区块，头部计数 `属性名(N)`；区块内每行一个输入框（颜色分类→`主色(必选)`+`备注(可选)`；适用型号→`请输入`）+ 区块级 **`+` 按钮 `button.next-btn.add`**（`next-icon-add`）
4. **值提交机制（最终结论，修正过一次，见下方已证伪表）**：
   - 仅键入 ≠ 提交——**确认创建时未提交的键入值被直接丢弃**
   - **键入 + Tab = 唯一有效提交方式**（tab-blur 进 React state；Enter 无效，值 append）
   - 计数 `属性名(N)` 只在**新槽位**收到 Tab 提交时 +1；同一槽位再键入再 Tab = 值**拼接**而非覆盖
5. **确认创建门槛**：每个已选属性须 ≥1 **已提交**值，否则点击无效果、无报错、按钮不 disabled、面板静默不关（skuConfirmError 铁证：`颜色分类(1)…适用型号(0)` + `closed:false` + `tables:[]`）
6. 确认创建按钮须在**所有** overlay 里搜（防多 overlay 空壳）→ 弹层关闭 → `#struct-sku` 渲染 SKU 表
7. 多属性选中 = **交叉乘积表**（行数 = 各属性已提交值数之积），与旧版单属性面板（TaobaoSkuInput 一项一行的语义）结构性冲突——这是放弃自动适配的根因之一

### 创建后 SKU 表结构（仅记录备查，不用于自动填）

```
列：☑ | 颜色分类 | 适用型号 | 价格(元) | 数量(件) | SKU分类 | 流行元素 | 图案类型 | 商家编码 | 是否上架 | 操作
```

- 数据行 td id 带 `{row}-` 前缀（实证 `1-skuOuterId` / `1-skuParam_p-557314268`）；`1-skuPrice` 在 attach 观察中被去重 key 吞掉（异常未复验）
- **不能依赖 `tr.sku-table-row`**（新表 tr class 未证实）；批量（粘贴导入）行无 `{row}-` 前缀
- 规格值列为纯文本不可编辑；表头 `thead` 无 th 文本（列序：价格=第 4 列、数量=第 5 列）

### 已证伪假说（含两处曾写反的错误结论，勿再踩）

| 假说 | 结论 |
|---|---|
| 直接键入即生效（无需 commit） | **错——本文档曾写反**：仅键入的值在确认创建时被丢弃；键入 + Tab 才提交 |
| Tab blur 只是副作用、非必需 | **错——本文档曾写反**：Tab 是**唯一**有效提交方式 |
| Enter commit | 无效（值 append） |
| suggest 联想候选点选 | 输入时不弹联想 |
| commit 后框清空复用同框填多值 | 否——**一个框一个值**，多值须点 `+` 加行（同槽位重提 = 拼接） |
| 坐标点击输入框 | 面板动画致 stale，改 `scrollIntoView + focus()` 后 keyboard.type |
| 全局 `.find()` 按 placeholder 找框 | 永远命中第一个属性的主色框，第 2 属性必打错框（正解：ownerOf 向上爬「唯一含 `属性名(N)` 计数文本」的最高祖先 = 属性块容器） |
| 「轮 2：键入后 React 已收集」 | 误定位——轮 2 读到的信号不代表 React 已收集的规格值；铁证是确认创建时 `适用型号(0)`（键入过但未 Tab 的值未被收集） |
| 逐类目属性适配代码（fillMaterialComposition，`#struct-p-149422948` 材质成分类目特化） | **已删（2026-10-16 止损决策）**——违反「不写类目适配代码」总决策；每个类目特化 = 新维护面，逆向也证实无工具走这条路。类目属性统一走 g5 档案（首次人工 → 自动存档 → 二次回放） |
| 跨域 Lite 详情编辑器详情图自动上传（fillDetailImages） | **已删（2026-10-16）**——对话路径不可达的死代码（工具 schema 不暴露 detailImages、dev 入口不传），详情图交由人工在窗口内补 |
| env 文本模型回退链（TAOBAO_TEXT_MODEL_* → OpenAI 兼容 /chat/completions） | **已删（2026-10-16）**——死路：tools-publish 装配工具时总会从当前会话路由装配 attrModel，env 回退永远走不到 |

### 同步更新流程（新面板改版 / 需要重验机制时）

1. 探针已删；需要重探时参考 `dev/patrol-publish.mjs`（PDD 巡检脚本，同一套 puppeteer 挂起 + `DevToolsActivePort` attach 蓝本）**重写临时探针，用完即删**
2. 验证点按优先级：① 「+ 创建规格」检测锚点是否仍命中（fillSkus 分流的唯一依赖）；② 键入 + Tab 提交机制；③ 确认创建门槛行为
3. 更新本节 + `src/taobao-publish.ts` fillSkus 注释与检测代码，`npm run build:host` + `npm run sync` 后真机回归

---

## 5. 同步更新流程（来源出新版时）

1. **先看官方更新页（飞书）**：确认是否出了新版本 / 更新说明；记录新安装包的 **路径 / 大小 / SHA-256**，更新第 1 节表格
2. 按第 2 节重新解包到新的临时目录（如 `E:\rea-tmp\shangjia633_vX`）
3. 比对第 3 节结构差异：新增/消失的 `sjzs_*`、新增依赖、`right6_display_settings.json` 字段变化
4. 重跑第 4 节，更新第 6 节映射表
5. 同步改 skill 的选择器 / 字段 / 流程，并跑该 skill 的回归用例

---

## 6. skill ↔ 来源映射

> skill 里的每个 URL / 选择器 / 字段 → 来源的具体位置。来源有三类：
> ① `d2.pyd` 字符串（离线解包）；② 本机影刀工程 `xbot_robot/selectorsV2.xml`（明文，app「noco传宝贝」，
> 淘宝组 criteria `https://item.upload.taobao.com`、天猫组 `https://sell.publish.tmall.com`）；
> ③ **真实实测（2026-09）**——本机登录卖家中心走真实发布页抓 DOM 的结论，逐条对应 `src/taobao-publish.ts` 注释。
> 已确认的落位到具体来源；尚无法确认的标 `_待核实_`（待运行时抓包 §4.5）。

| skill 位置 | 来源位置 | 说明 |
|---|---|---|
| `SKILL.md` 执行流程：淘宝发布页 `item.upload.taobao.com` | `d2.pyd` 字符串（同域 `https://item.upload.taobao.com/taobao/manager/refreshDeliveryTemplate`）| 同一发布域；工具实际发布走 MTOP `mtop.taobao.sell.wireless.ai.publish.render` / `.submit` |
| `SKILL.md` 执行流程：天猫发布页 `sell.publish.tmall.com` | `d2.pyd` `mtop.tmall.sell.pc.manage.render` / `.async` | 天猫发布链路 |
| `SKILL.md` 错误处理：baxia 滑块 `risk_control` → `dsagent_risk_verify` | `d2.pyd` 内嵌 JS `iframe#baxia-dialog-content` | 滑块 iframe 判定 |
| `SKILL.md` 错误处理：`token_expired` → 重新登录淘宝 | `d2.pyd` 登录 URL `login.taobao.com/member/login.jhtml?style=mini&newMini2=true&redirectURL=…` + 内嵌 JS `#fm-login-id` / `#fm-login-password` / `button.fm-button.fm-submit.password-login` | 登录态失效处理 |
| `src/taobao-publish.ts` `adoptRecommendations()`（类目属性「一键采纳推荐值」） | `d2.pyd` `mtop.taobao.sell.wireless.ai.publish.render` 的服务端渲染逻辑（服务端按类目下发推荐默认值） | 属性没把握时的第 0 层兜底，先点推荐值再逐项检查 |
| `src/services/category-profile.ts`（g5 类目档案） | **本仓原创**（非外部参考）——设计上对应 A2「通用模板+店铺级套用」（见 PUBLISH-SPEC.md §1），实现不参考任何外部工具 | 首次人工补 → 发布成功自动存档 → 二次同类目回放；档案边界到类目属性为止，SKU 不入档（商品级数据） |
| 主图 / 标题 / 一口价 / 库存 / 货号 字段选择器 | 真实实测（2026-09），见 `src/taobao-publish.ts` `uploadImages()` / `fillField()` / `readCatPropItems()`；选择器锚点亦见影刀 `selectorsV2.xml` | 主图区 `#struct-mainImagesGroup`，弹层 `#images-v2-media-popup-content` → iframe `sucai-selector-ng`（点虚线占位须**真实鼠标点击**，上传走 iframe 内 `input[type=file]`+`uploadFile`，瓦片 `[class*=PicList_pic_background]`）。**一口价 / 总库存无 placeholder**，必须标签锚定（`['一口价']` / `['总库存','库存']`）；标题 `['宝贝标题','商品标题']`；货号 `['货号','商家编码']`。类目属性根 `#struct-catProp`，项 `#struct-p-XXXX` → 表单 `sell-field-p-XXXX` |
| 「选择类目」流程 | 真实实测（2026-09），见 `src/taobao-publish.ts` `selectCategory()`；2026-10-16 修正候选选择（见下「选类目相关性打分」行）| 入口 `sell/ai/category.htm?force=true`（`sell/publish.htm` 已跳 `v2/publish.htm?null`）；搜索框 `input[placeholder*="类目关键词"]` **必须按 Enter** 才出结果；结果分区 `.sell-component-general-category-result-cate-path`；点开级联树 `.cascade-selection .category-item`；必填属性 `.sell-catProp-item-common`（品牌 auto-complete / 型号 text）填好后 `button`「确认，下一步」由禁用变可用；选完**新开标签页** `sell/v2/publish.htm?catId=...` |
| 选类目相关性打分（`nextCategoryCandidate` 页内 bigram） | **本仓原创**（2026-10-16 真机踩坑后自研，非外部参考）——背景：用户搜「童装」第一位候选是「兑换卡>童装卡」，与标题零重叠但无必填属性 →「确认，下一步」直接可用被误选 | 算法：候选类目路径与商品标题做 bigram（连续两字滑窗）重叠计数，叶子段（路径最后一级，`>`/`＞`/`/`/`／` 分隔）×2 权重、中间段 ×1；**有正分候选时只按分数降序试，0 分（与标题零重叠）仅在全池无正分时兜底**——堵死「无关类目恰好无必填属性→按钮可用→误选」。打分在 `page.evaluate` 页内执行（避免 DOM→Node 序列化往返）。真机验证（2026-10-16）：搜「儿童睡衣」首选「童装/婴儿装/亲子装>儿童家居服>家居服套装」相关分 12，正确避开 0 分的「兑换卡>童装卡」。**参数引导**：`categoryKeyword` 应传叶子类目词（如「儿童睡衣」），不传一级大类名（如「童装」）或整段标题——tool schema / prompt.ts / 预览文案三处已同步 |
| （未纳入 skill）批量上下架 / 删除 / 体检 / 详情装修 | `d2.pyd` 函数 `classification_down_up` / `new_del_item` / `Load_healthcenter` / `xiangqing_wangpu` | 工具偏「店群批量运维」；本 skill 仅做单件发布 |
| （已删除）`fillMaterialComposition` 材质成分类目特化 | 曾为「材质成分」必填类目写的 DOM 特化（`#struct-p-149422948`） | 2026-10-16 删；路线证伪见 §4.6 已证伪表 |
| （已删除）`fillDetailImages` 详情图上传 | 曾复刻素材库跨域 Lite 编辑器链路 | 2026-10-16 删（对话路径死代码）；pdd 侧 `uploadDetailImages` 保留 |
