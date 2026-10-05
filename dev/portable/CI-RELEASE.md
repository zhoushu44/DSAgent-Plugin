# 自动发布（push 即更新 Release）

推送到 `main`（或推 `v*` tag）后，GitHub Actions 会自动构建并更新 Release。
你不用在本机跑任何打包命令。

---

## 一、对方怎么下载

**增量更新包**（每次 push 都会更新，地址永久固定）：

```
https://github.com/zhoushu44/DSAgent-Plugin/releases/download/latest/DSAgent-Update.zip
```

> ★ 用 **tag 固定地址**，不要用 `/releases/latest/download/`。
> 后者会解析到「最新的非预发布 Release」，一旦你另外发了 `v1.0.0` 之类的
> 版本化 Release，同一个链接就会跳到别的资产上。

**完整绿色包**（首次安装用，约 343 MB）在同页 Release 的资产列表里。

| 包 | 体积 | 用途 |
|---|---|---|
| `DSAgent-Update.zip` | ~3.3 MB | 已有绿色包的用户：解压覆盖 → 全部替换 → 重启 |
| `DSAgent-Portable.zip` | ~343 MB | 新用户首次安装（默认不自动构建，见第四节） |
| `SHA256SUMS.txt` | 1 KB | 校验和 |

---

## 二、触发方式

| 事件 | 结果 |
|---|---|
| push 到 `main` | 更新滚动 Release（tag `latest`） |
| push tag `v1.2.3` | 创建 / 更新该 tag 的正式 Release |
| Actions 页手动触发 | 同上，并可勾选同时组装完整包 |

工作流文件：`.github/workflows/release.yml`

---

## 三、为什么完整包默认不自动构建

**结论：托管 runner 拿不到 DSH 的运行时，无法从零组装完整包。**

实测（2026-10-05，DSH Desktop 0.11.0 官方安装包）：

| 打包需要的东西 | 本机 0.10.0 | 在线 0.11.0 |
|---|---|---|
| `app/resources/app.asar` | 6.2 MB | **268.4 MB**（依赖全塞进 asar） |
| `app.asar.unpacked/node_modules/node/bin/node.exe` | ✅ 85.5 MB | ❌ **不存在** |
| `@deepseek-ai/dsh/lib/bin.js` | ✅ unpacked | ⚠️ 在 asar 内部 |
| `esbuild` | ✅ | ❌ 不在 asar 里 |

我递归扫了 0.11.0 的整个 asar（21221 个条目）：**`node.exe` 条目数 = 0**，
`node` 包不存在，`esbuild` 不存在。

而 `launch.ps1` 第 49 行硬性要求包内有 `node.exe`：

```powershell
$NodeExe = Join-Path $AppDir 'resources\app.asar.unpacked\node_modules\node\bin\node.exe'
if (-not (Test-Path $NodeExe)) { Fail "缺少 DSH 运行环境..." }
```

所以托管 runner 上 `build-portable.ps1` 必然在第一步就 `throw`。

---

## 四、想自动构建完整包：上传一次「基座」

完整包里 93% 是**极少变动**的部分：

| 目录 | 体积 | 变动频率 |
|---|---|---|
| `app/` | ~638 MB | 只在 DSH 升级时变 |
| `python/` | ~294 MB | 只在依赖清单变时变 |
| `plugin/` | ~41 MB | **每次发版都变** |

所以：把 `app/` + `python/` 作为「基座」发布**一次**，
之后每次都用「基座 + 新 plugin/」重组。

### 4.1 生成基座（在本机，一次性）

```powershell
cd C:\Users\zs\Desktop\DSAgent-Plugin

# 先确保完整包是最新的（三条命令，顺序不能变）
npm run build
npm run portable
npm run portable:deps

# 抽出 app/ + python/ 作为基座
pwsh -NoProfile -File dev/portable/make-base.ps1
```

产物：`%USERPROFILE%\DSAgent-Portable-build\DSAgent-Base.zip`（约 300 MB）

> 脚本会校验 `python/Lib/site-packages` 里的依赖目录数 ≥ 10。
> 不足 10 个说明你漏跑了 `npm run portable:deps`，基座会是个**没有依赖的空壳**，
> 组装出来的包技能全废 —— 而且只有到用户那边才暴露。

### 4.2 上传基座

```powershell
gh release create base "$env:USERPROFILE\DSAgent-Portable-build\DSAgent-Base.zip" `
  --title "DSAgent 基座（CI 用）" `
  --notes "CI 组装完整包用的运行时基座，非最终用户下载项。"
```

### 4.3 之后就能自动组装

在 Actions 页手动触发 Release 工作流，勾选 `full` 即可。
产物 `DSAgent-Portable.zip` 会挂到同一个 Release 上。

---

## 五、另一条路：self-hosted runner

不想维护基座资产的话，在你自己那台**已装好 DSH Desktop 0.10.0** 的机器上
注册一个 runner，然后直接把 `full` job 的 `runs-on` 改成 `self-hosted`：

```yaml
full:
  runs-on: self-hosted
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run build
    - run: pwsh -NoProfile -File dev/portable/build-portable.ps1 -Force
    - run: pwsh -NoProfile -File dev/portable/prepare-pydeps.ps1 -NoZip
    - run: pwsh -NoProfile -File dev/portable/zip-only.ps1   # 或直接 Compress-Archive
```

优点：零改造，用现成脚本。
缺点：runner 得常开；公共仓库的 self-hosted runner 也免费。

---

## 六、发布前必须做的事

### 6.1 先 push 提交，否则「更新.cmd」链路是断的

包内 `build-info.json` 记的是**本地 HEAD 的提交时间**。你本地常有未推送提交，
这时远端时间比本地**早**，更新器（`update.ps1` 第 161 行按时间比较）会判定
「已是最新」，直接跳过更新。

所以：**每次打包前先 `git push`。**

### 6.2 `dev/portable/` 下的脚本必须全部提交

CI 只能看到已提交的文件。以下是**必需**的：

| 文件 | 作用 |
|---|---|
| `build-update.ps1` | 增量包（工作流直接调用） |
| `sync-to-host.mjs` | `npm run build` 的最后一步，**缺了 build 会失败** |
| `fix-script-encoding.mjs` | 修 `.cmd`/`.ps1` 编码，**缺了对方双击报错** |
| `update.ps1` / `update.cmd` | 分发包里的「更新.cmd」 |

### 6.3 `.cmd` / `.ps1` 的编码是硬性要求

| 文件 | 要求 | 原因 |
|---|---|---|
| `.cmd` | **纯 ASCII + CRLF** | cmd.exe 按系统 ANSI 代码页解析，中文注释会被当命令执行 |
| `.ps1` | **UTF-8 with BOM** | Windows PowerShell 5.1 读无 BOM 的 `.ps1` 会按 ANSI 解释，中文乱码 |

已加 `.gitattributes` 锁定换行（`eol=crlf`）：仓库里 `.cmd` 以 LF 存储，
靠 `core.autocrlf` 在签出时还原 —— 而 CI runner 上 `autocrlf` **不保证是 true**，
一旦是 false 就是裸 LF，打包校验会直接失败。

> `fix-script-encoding.mjs` **无法把中文注释变成英文**，只会映射掉非 ASCII 字符
> 并告警。`.cmd` 里不能有任何中文，所有中文提示交给 `.ps1` 输出。

---

## 七、排查

| 症状 | 原因 |
|---|---|
| `npm run build` 报 `'tsc' is not recognized` | 本机 `node_modules/.bin` 缺失（非 npm 安装）。CI 上 `npm ci` 会正常生成 |
| 增量包名变成 `DSAgent-Update-.zip` | 目录不是 git 仓库，取不到 sha。CI 的 `actions/checkout` 不会有此问题 |
| Release 说明是空白 | PowerShell 里把环境变量写成 `$TAG` 而非 `$env:TAG`（静默取到 `$null`） |
| 完整包 job 报「没有基座资产」 | 还没做第四节的上传基座步骤 |
| `gh release` 命令静默失败 | `gh` 的退出码不会自动抛异常，必须显式判断 `$LASTEXITCODE` |
