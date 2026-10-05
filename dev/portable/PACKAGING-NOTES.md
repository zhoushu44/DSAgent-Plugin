# DSAgent 绿色版 —— 打包者笔记

> 本文件是**内部文档**，只留在仓库里，不进分发包。
> 面向使用者的说明见 README-PORTABLE.md（会被拷进包内作为「使用说明.md」）。

---

## 六、给打包者（你自己看）

本包由仓库内 `dev/portable/` 的脚本生成。产物默认输出到
`%USERPROFILE%\DSAgent-Portable-build\`（**绝不能放仓库内**，原因见第七节）。

### 6.1 完整包（首次分发、或依赖有变时）

```powershell
cd <仓库根>
npm run build              # 编译 + 15 项冒烟 + 自动同步宿主
npm run portable           # 组装绿色包目录
npm run portable:deps      # 装 Python 依赖 + 自动打 zip
```

产物（体积已通过下文 7.4 的裁剪优化）：
- `DSAgent-Portable\`（约 **974 MB**，可直接拷走运行）
- `DSAgent-Portable.zip`（约 **342 MB**，发给对方）

### 6.2 对方自助更新（首选，无需你发任何东西）

包内自带 `更新.cmd`，对方双击即从 GitHub 拉取最新技能与插件代码：

- 版本检查走 **git info/refs**（`git ls-remote` 底层端点），**不用 GitHub REST API**
  —— 匿名 API 每小时仅 60 次，实测几次就被 403，会让更新「时好时坏」
- 下载 `codeload` 源码 zip（约 3 MB）
- **用包内工具链（node + 完整 typescript + esbuild）自行编译 `lib/`**
  —— 所以插件代码也能更新，而不只是技能
- 技能同步采用**只增不删**（上游没有的本地技能保持原样）
- 编译失败或校验不过时**保留原 `lib/`**，绝不把坏产物推给对方
- 更新前备份到 `backup-<时间戳>/`

### 6.3 增量更新包（对方无法访问 GitHub 时用）

```powershell
npm run build              # 编译
npm run portable:update    # 生成增量包
```

产物：`DSAgent-Update-<commit>.zip`（约 **3.3 MB**，比全量省 99%）

对方解压覆盖到绿色包目录 → 「全部替换」→ 重启。`data/` 不受影响。
仅当 `package.json` 依赖有变化时才加 `-Full`（约 30 MB）。

### 6.4 依赖清单怎么来的

`dev/portable/scan-py-deps.mjs` 生成 —— 扫描 `skills/` 下所有 `.py` 的 import，
并与 `src/services/skill-service.ts` 的 `SKILL_DEPS` **取并集**。

★ `SKILL_DEPS` 由脚本**从源码解析**（不再硬编码副本）。曾因两处各存一份而漂移：
源码里删了 `pywencai/akshare/matplotlib`，脚本里却还留着，导致这三个大包
被继续装进包内（pywencai 会拖入 py_mini_racer 38 MB + debugpy 31 MB +
jedi 14 MB + IPython/Jupyter 一整条链）。

用 `node dev/portable/audit-blank-deps.mjs` 复核「装了但从不 import」的包。

---

## 七、打包时必须注意（踩过的坑）

### 7.1 产物绝不能放在仓库内 ⚠️

DSH Desktop 有一套「profile 迁移」机制：它会把 profile 里的本地插件
**整份 staging** 成快照副本。如果它扫到仓库内的绿色包（含 `app.asar`），
会判定 `Invalid package` 并**迁移失败**；失败时插件 junction 已被改指到旧快照，
于是宿主不再读工作区 ——

> **表现为「插件 UI 不显示，而且重新构建也不生效」，极难排查。**

2026-10-04 就是这样踩了一次。因此：

- `build-portable.ps1` 默认输出到 `%USERPROFILE%\DSAgent-Portable-build\`
- 若显式把 `-OutRoot` 指向仓库内，脚本会**直接报错拒绝执行**

### 7.2 宿主可能在读快照，而非工作区

如果 plugin 的 junction 指向 `.generations/live/<id>/`（而不是工作区），
那么 `npm run build` 的产物宿主看不到。`npm run build` 已内置 `sync-to-host`
会自动把产物同步过去并触发 HMR 热重载，无需重启应用。

手动检查：
```powershell
npm run sync              # 自动判断并同步
Get-Item "$env:APPDATA\dsh-desktop\harness\profiles\web\node_modules\@dsagent\dsagent-plugin" | Select-Object Target
# Target 指向工作区 = 正常；指向 .generations = 已自动同步
```

### 7.3 Python 版本必须用 3.11/3.12，不要用 3.14

`lxml` / `pandas` / `numpy` 等**没有 cp314 的预编译 wheel**，用 3.14 时 pip 只能
源码编译，极慢甚至失败（依赖安装会长时间卡住）。3.11 有全套 cp311 wheel，秒装。

打包脚本已自动按 `Python311 → Python312 → pythoncore-3.14` 顺序探测。

### 7.4 体积优化：实测砍掉 484 MB（1458 → 974 MB）

| 措施 | 省下 | 依据 |
|---|---|---|
| 裁 Electron 主程序 + GPU DLL/pak | **~312 MB** | 绿色版走 `node.exe + harness-node-entry.mjs` 启动，**从不启动 `DSH Desktop.exe`**；resources 下四个 `.mjs` 入口都不 import electron，且 `app.asar.unpacked` 里没有任何包声明 electron 依赖。**已实测**：裁后启动成功、66 技能加载、15 工具注册 |
| 精简 Python 依赖 | **~150 MB** | 用 `audit-blank-deps.mjs` 查明 31 个包从未被 import（pywencai/akshare/matplotlib 及其依赖链）。site-packages 从 441 → 253 MB |
| 裁 Python `Doc/` `tcl/` `include/` `libs/` `Tools/` | **~57 MB** | 文档与 GUI 组件，技能运行时不需要 |
| 裁源解释器自带的无关包 | **~239 MB** | 系统那份 `pythoncore` 曾被用于打包工具链，带着 PyInstaller/cx_Freeze/PyQt6/ruff 等 |

**保留**：`resources/`（node.exe + node_modules + 入口 .mjs）、`locales/`、
Python 的 `DLLs/`（含 OpenSSL）、`Lib/`。

### 7.5 自重建能力依赖三个包，缺一不可

GitHub 的源码 zip **不含 `lib/`**（编译产物在 `.gitignore`），所以更新器要能自己编译。
打包时特意补入：

| 包 | 作用 | 坑 |
|---|---|---|
| `node.exe` | DSH 自带 | — |
| `esbuild` + `@esbuild/win32-x64` | 打包 browser 半区 | 约 11 MB |
| `typescript` | 编译 host 半区 | **必须用仓库里的完整版覆盖 DSH 自带的那份**：DSH 的 `typescript/lib` 被裁剪成 10 个文件、**0 个 `.d.ts`**，直接编译会报 `TS6053: lib.es2022.d.ts not found`。完整版有 102 个 `.d.ts` |

已验证：包内工具链能编译出 `lib/index.js`（177 KB）与 `lib/client.js`（233 KB）。

### 7.6 版本比较不能只看 sha（会导致降级）

发布者本地常有**尚未推送**的提交。此时远端 sha 与本地不同，但远端其实更旧 ——
只比 sha 会把本地新版本「更新」成远端旧版本。

实测：本地 `a8cb29b`（含未推送修复）被误判为「有新版本 `86ebccb`」，
而 `86ebccb` 是更早的提交。

因此 `build-info.json` 记录了 `commitTime`，更新器以**提交时间**为准：
本地时间 ≥ 远端时间 → 不更新。打包脚本会自动写入该字段。

### 7.7 .cmd 必须纯 ASCII + CRLF，.ps1 必须 UTF-8 with BOM ⚠️

**症状**：用户双击 `启动 DSAgent.cmd`，窗口里刷出一堆
```
'文件所在目录（保证相对路径正确）' is not recognized as an internal or external command
'运行未签名脚本，这是必须的）' is not recognized as an internal or external command
```

**原因**：cmd.exe 解析 `.cmd` 文件时，**按系统 ANSI 代码页**（中文 Windows = GBK）
读取，与文件自身编码无关。而我们的 `.cmd` 是 UTF-8 无 BOM + LF：
- UTF-8 的中文注释被按 GBK 解码 → 乱码
- 乱码行（`rem` 被吃掉）被当成命令执行 → 上面那串报错
- 只有 LF 换行也会让 `if (...)` 多行块解析错乱

**修法**（`fix-script-encoding.mjs` 自动完成，已接入 build-portable.ps1）：

| 文件类型 | 要求 | 原因 |
|---|---|---|
| `.cmd` | **纯 ASCII + CRLF** | cmd.exe 按 ANSI 读，非 ASCII 必乱码；批处理要求 CRLF |
| `.ps1` | **UTF-8 with BOM** | Windows PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI 解释，中文乱码 |

因此 `.cmd` 里**不放任何中文**（连注释也用英文），所有中文提示交给 `.ps1` 输出。
`chcp 65001` 放在 .cmd 里是安全的（纯 ASCII 命令），能让 .ps1 的中文正常显示。

打包脚本在最后会**校验**包内 `.cmd` 的编码，不合规就告警 —— 防回归，
因为这个问题只在对方双击时才暴露，本地用 `pwsh -File` 测试是发现不了的。

### 7.8 压缩时用 `<dir>\*` 而不是 `<dir>`

`Compress-Archive -Path '<dir>'` 会把目录本身也打进 zip，用户解压后多一层
（例如 `dsagent-hotfix-stage\...`），找不到启动文件。

- 完整包：需要一层 `DSAgent-Portable/`，用 `-Path $PkgDir`（**对**，因为要这层）
- 热修包：要扁平结构，用 `-Path "$stage\*"`（加 `\*` 才是对）

打包后应解压验证一次结构。`_check-zip-structure.mjs` 可做这件事。

---

## 八、CI 自动发布（2026-10-05 起）

工作流：`.github/workflows/release.yml`，说明见 `CI-RELEASE.md`。
push 到 `main` → 自动构建增量包并更新 Release（tag `latest`）。

### 8.1 托管 runner 拿不到 DSH 运行时 ⚠️

实测 DSH Desktop 0.11.0 官方安装包（`dshdesktop.com/updates/latest/`）：

| 打包需要 | 本机 0.10.0 | 在线 0.11.0 |
|---|---|---|
| `app.asar` | 6.2 MB | **268.4 MB**（依赖全进 asar） |
| `node_modules/node/bin/node.exe` | ✅ 85.5 MB | ❌ **不存在** |
| `@deepseek-ai/dsh/lib/bin.js` | ✅ | ⚠️ 在 asar 内 |
| `esbuild` | ✅ | ❌ 不在 asar 里 |

递归扫 0.11.0 的 asar（21221 条目）：**`node.exe` = 0 个**，`node` 包不存在。

而 0.10.0 的布局也对不上：线上包比本地大 77 MB（多出 libreoffice 170 MB +
sherpa-onnx + sharp），裁 Electron 的清单（-312 MB）全部失准。

**结论**：托管 runner 上 `build-portable.ps1` 第一步就 `throw`（它硬性要求
`app.asar.unpacked/node_modules/node/bin/node.exe`）。

**因此**：完整包改为「基座 + 新 plugin/」策略 ——
`make-base.ps1` 抽 `app/`+`python/` 发成 tag `base` 的 Release 资产，
`assemble-full-from-base.ps1` 在 CI 上重组。增量包（3.3 MB）则完全不受影响。

### 8.2 顺带发现：npm `node` 包能提供同样的 node.exe

`npm i node@24.9.0` 得到 `node_modules/node/bin/node.exe`，**85.5 MB / v24.9.0**，
与本机 DSH 自带的那份一致。若将来要彻底摆脱对 DSH Desktop 的依赖，
这是可行路径 —— 但还需要解决 `@deepseek-ai/dsh` 的宿主依赖（它们不在公共
npm 的 latest 上：`dsh-tools` latest 只有 `0.0.1-rc.1`，而本地用的是
`0.1.7-rc.2`），所以本轮没有采用。

### 8.3 `.cmd` 编码的坑在 CI 上会被放大

仓库里 `.cmd` 以 LF 存储，靠 `core.autocrlf` 在签出时还原 CRLF。
但 **CI runner 的 `autocrlf` 不保证是 true** —— 一旦是 false/input，
签出的 `.cmd` 就是裸 LF，打包校验直接失败。

修法：加 `.gitattributes`，用 `*.cmd text eol=crlf` 锁定（优先级高于 `core.autocrlf`）。

### 8.4 fixer 必须「先修再拷」

`assemble-full-from-base.ps1` 早期版本把 `Copy-Item` 写在 `fix-script-encoding.mjs`
**之前**，结果 fixer 修的是仓库里 `dev/portable/` 的源文件，包内那份仍是未修正的
—— 症状与 7.7 完全一样，且本地用 `pwsh -File` 测不出来。

已在脚本里：（1）调整为先修后拷；（2）增加**包内**编码校验，不合规直接 `throw`。

### 8.5 PowerShell 细节：环境变量与 gh 退出码

两个在 CI 上静默失败的坑：

- **环境变量**：`env:` 注入的变量必须写 `$env:TAG`。写成 `$TAG` 会静默取到
  `$null`，Release 说明就变成空白（不报错）。
- **gh 退出码**：`gh` 是原生程序，失败时**不会**抛异常。必须显式
  `if ($LASTEXITCODE -ne 0) { throw ... }`，否则发布失败也会显示绿灯。
  （实测：GHA 的 pwsh 包装下 `$PSNativeCommandUseErrorActionPreference = False`，
  即使 `$ErrorActionPreference = 'stop'` 也不会因原生命令非零退出而中断。）


