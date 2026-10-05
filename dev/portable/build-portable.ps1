<#
.SYNOPSIS
  组装 DSAgent 绿色版（免安装、可拷贝到任意 Windows 电脑运行）。

.DESCRIPTION
  产出一个自包含、路径无关的目录：DSH Desktop 程序 + 便携 Python（含技能依赖）
  + DSAgent 插件 + 全部技能。对方解压后双击「启动 DSAgent.cmd」即可用。

  ── 核心机制（全部经本机实测确认）────────────────────────────────────────
  1. DSH 自带 CLI（resources/.../@deepseek-ai/dsh/lib/bin.js）可脱离 Electron 独立运行，
     并自带 node.exe —— 对方无需安装 Node。
  2. `DSH_HOME` 环境变量指定数据根，会在该目录下自动创建干净的 profiles/web 骨架，
     **不需要**拷贝本机 590 MB 的 profiles（原方案的一大负担被消除）。
  3. `--patch <path>` 可叠加一层配置覆盖，用来注入 DSAgent 插件的绝对路径 ——
     启动器每次按自身位置重写该文件，因此换盘符/换目录都能跑。
  4. 插件的 Python 探测优先读 `DSAGENT_PYTHON`（见 src/services/skill-service.ts），
     启动器指向包内 Python，保证技能依赖命中数最高而被自动选中。
  5. 用 CLI 而非 Electron 启动，天然避开 Desktop 的全局单实例锁 —— 绿色版可与
     本机已安装的 DSH Desktop 并存。

  产物：
    dist/DSAgent-Portable/         可直接拷走的绿色目录
    dist/DSAgent-Portable.zip      分发包

.PARAMETER SkipPython
  跳过 Python 运行时拷贝（仅验证打包流程时用）。

.PARAMETER SkipZip
  不生成 zip。

.PARAMETER Force
  目标目录已存在时先删除。

.EXAMPLE
  pwsh -File dev/portable/build-portable.ps1 -Force
#>
[CmdletBinding()]
param(
  [string]$DshPath,
  [string]$PythonPath,
  # 产物输出目录。默认放用户目录（绝不能放仓库内，见下方说明）。
  [string]$OutRoot,
  [switch]$SkipPython,
  # 保留完整 Electron（默认裁掉省 ~312 MB；仅排查渲染相关问题时才需要）。
  [switch]$KeepElectron,
  [switch]$Zip,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

# ★ 产物必须放在**仓库之外**，否则会破坏 DSH Desktop 的插件迁移。
#
# 事故记录（2026-10-04）：曾把产物生成到 <仓库>/dist/，结果 DSH Desktop 做 profile
# 迁移时会把插件目录整份 staging，扫到 dist/DSAgent-Portable/app/resources/app.asar
# 就判定 "Invalid package" 并**迁移失败**；失败时插件 junction 已被改指到 generation
# 快照，宿主从此只读那份旧快照 → 页面上插件 UI 不再更新/不显示，且重新构建也没用
# （构建产物落在工作区，宿主根本不看）。
#
# 因此默认输出到用户目录，可用 -OutRoot 覆盖。
if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE 'DSAgent-Portable-build' }
$PkgDir    = Join-Path $OutRoot 'DSAgent-Portable'
$ZipPath   = Join-Path $OutRoot 'DSAgent-Portable.zip'

# 双保险：万一有人显式把 -OutRoot 指到仓库内，直接拒绝并在提示里说明原因。
if ($OutRoot.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw @"
产物目录不能放在仓库内：$OutRoot

原因：DSH Desktop 迁移插件 profile 时会 staging 整个插件目录，一旦扫到仓库内的
绿色包（含 app.asar），会判定 Invalid package 并导致迁移失败 —— 失败后插件会
被固定到旧的 generation 快照，宿主不再读取工作区，表现为「插件 UI 不显示，
且重新构建也不生效」。

请改用仓库外的目录，例如：
  pwsh -File dev/portable/build-portable.ps1 -OutRoot D:\DSAgent-Portable-build
"@
}

Write-Host ''
Write-Host '=== DSAgent 绿色版打包 ===' -ForegroundColor Cyan
Write-Host "仓库: $RepoRoot"
Write-Host "输出: $PkgDir"
Write-Host ''

function Write-Step([string]$T) { Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok([string]$T)   { Write-Host "    OK $T" -ForegroundColor Green }
function Write-Warn2([string]$T){ Write-Host "    ! $T" -ForegroundColor DarkYellow }

function Get-DirSizeMB([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  $sum = (Get-ChildItem $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

# robocopy：比 Copy-Item 快很多，且正确处理隐藏文件。
# ★ 两个关键参数：
#   /XJ  排除 junction/符号链接本身（否则 robocopy 会跟进链接，可能递归或撞权限错误）
#   这里配合下面的 Resolve-Link 使用：调用方先解开 junction 再拷真实内容。
function Copy-Tree([string]$From, [string]$To, [string[]]$ExcludeDirs = @()) {
  if (-not (Test-Path $From)) { throw "源目录不存在: $From" }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  $rcArgs = @($From, $To, '/E', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  if ($ExcludeDirs.Count -gt 0) { $rcArgs += '/XD'; $rcArgs += $ExcludeDirs }
  $null = & robocopy @rcArgs
  # robocopy 退出码：0=无需拷贝 1=有文件拷贝 2=有额外项 3=1+2 … <8 都算成功
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 ($LASTEXITCODE): $From -> $To" }
}

# 拷一个包目录，若是 junction/symlink 则解开拷其真实内容（避免把链接带进包）。
function Copy-Package([string]$From, [string]$To, [string[]]$ExcludeDirs = @()) {
  if (-not (Test-Path $From)) { return $false }
  $item = Get-Item $From -Force
  $real = $From
  if ($item.LinkType -and $item.Target) {
    $t = @($item.Target)[0]
    $real = if ([IO.Path]::IsPathRooted($t)) { $t } else { Join-Path (Split-Path $From -Parent) $t }
    if (-not (Test-Path $real)) { return $false }
  }
  Copy-Tree $real $To $ExcludeDirs
  return $true
}

# ── 0. 定位依赖 ─────────────────────────────────────────────────────────
Write-Step '检查依赖与源目录'

if (-not $DshPath) { $DshPath = Join-Path $env:LOCALAPPDATA 'Programs\DSH Desktop' }
if (-not (Test-Path $DshPath)) {
  throw "未找到 DSH Desktop: $DshPath`n请用 -DshPath 指定。"
}
$NodeExe = Join-Path $DshPath 'resources\app.asar.unpacked\node_modules\node\bin\node.exe'
$DshBin  = Join-Path $DshPath 'resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path $NodeExe)) { throw "缺少 DSH 自带 node.exe: $NodeExe" }
if (-not (Test-Path $DshBin))  { throw "缺少 DSH CLI 入口: $DshBin" }
Write-Ok "DSH Desktop: $DshPath"
Write-Ok "node.exe / dsh bin.js 齐备"

# ★ 默认用 Python 3.11，不用 3.14。
#
# 原因（实测）：本机是 Python 3.14，而 lxml / pandas / numpy 等**没有 cp314 的
# 预编译 wheel**，pip 只能退回源码编译 —— 极慢甚至失败（这正是之前依赖安装
# 卡住不动的原因）。Python 3.11 有全套 cp311 wheel，秒装：
#   lxml-6.1.3-cp311-cp311-win_amd64.whl  (3.8 MB)
# 且 3.11 的目录体积更小（150 MB vs 488 MB）。
#
# 兼容性：技能声明 requires-python >= 3.10，3.11 满足。
if (-not $PythonPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312'),
    (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64')
  )
  $PythonPath = $candidates | Where-Object { Test-Path (Join-Path $_ 'python.exe') } | Select-Object -First 1
}
$HasPython = $PythonPath -and (Test-Path (Join-Path $PythonPath 'python.exe'))
if (-not $SkipPython -and -not $HasPython) {
  throw "未找到可用的便携 Python。`n已尝试: `n  $($candidates -join "`n  ")`n可用 -PythonPath 指定，或加 -SkipPython 先验证流程。"
}
if ($HasPython) {
  $pyVer = & (Join-Path $PythonPath 'python.exe') -c "import sys; print('.'.join(map(str,sys.version_info[:3])))" 2>$null
  Write-Ok "Python: $PythonPath (v$pyVer)"
} else { Write-Warn2 '按参数跳过 Python' }

# 插件必须已构建
$LibDir = Join-Path $RepoRoot 'lib'
$HostJs = Join-Path $LibDir 'index.js'
$ClientJs = Join-Path $LibDir 'client.js'
if (-not (Test-Path $HostJs) -or -not (Test-Path $ClientJs)) {
  throw "缺少构建产物。请先运行: npm run build"
}
$clientSize = (Get-Item $ClientJs).Length
if ($clientSize -lt 50000) {
  throw "lib/client.js 仅 $clientSize 字节，疑似被 tsc 覆盖成裸源码。请运行: npm run build"
}
Write-Ok "插件构建产物完整 (client.js $([math]::Round($clientSize/1KB)) KB)"

# ── 1. 输出目录 ─────────────────────────────────────────────────────────
Write-Step '准备输出目录'
if (Test-Path $PkgDir) {
  if (-not $Force) { throw "输出目录已存在: $PkgDir`n加 -Force 先删除。" }
  Remove-Item $PkgDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PkgDir | Out-Null

$AppDir = Join-Path $PkgDir 'app'
$PluginDir = Join-Path $PkgDir 'plugin'
$PyDir  = Join-Path $PkgDir 'python'
Write-Ok $PkgDir

# ── 2. DSH Desktop 程序 ─────────────────────────────────────────────────
Write-Step '拷贝 DSH Desktop 程序（约 934 MB）'
Copy-Tree $DshPath $AppDir

# ★ 裁掉 Electron 主程序与 GPU 相关二进制（约 312 MB）。
#
# 依据（已实测）：绿色版走 `node.exe + harness-node-entry.mjs` 启动，**从不启动
# DSH Desktop.exe**；且 resources 下那四个 .mjs 入口文件都不 import electron，
# app.asar.unpacked 里也没有任何包声明 electron 依赖。
# 实测裁掉后启动成功：dsh web 起来、66 个技能加载、15 个契约工具注册。
#
# 保留清单（运行必需）：
#   resources/            node.exe + node_modules(@deepseek-ai/*) + 入口 .mjs
#   locales/              Electron 语言包，极小且 harness 可能读取
# 删除清单：
#   DSH Desktop.exe       235 MB   Electron 主程序（启动器不用）
#   *.dll (GPU/媒体)      ~55 MB   d3dcompiler/dxcompiler/dxil/libGLESv2/
#                                   vk_swiftshader/ffmpeg/libEGL/vulkan-1
#   *.pak / *.bin         ~15 MB   渲染进程资源（chrome_*.pak/resources.pak/
#                                   snapshot_blob.bin/v8_context_snapshot.bin）
#   *.html (卸载器文档)    ~20 MB   LICENSES.chromium.html（Chromium 许可全文）
if (-not $KeepElectron) {
  $electronCandidates = @(
    'DSH Desktop.exe',
    'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'libEGL.dll', 'libGLESv2.dll',
    'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'ffmpeg.dll',
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'resources.pak',
    'snapshot_blob.bin', 'v8_context_snapshot.bin', 'icudtl.dat',
    'LICENSES.chromium.html',
    'Uninstall DSH Desktop.exe'
  )
  $freedMB = 0
  foreach ($f in $electronCandidates) {
    $p = Join-Path $AppDir $f
    if (Test-Path $p) {
      $sz = (Get-Item $p).Length
      Remove-Item $p -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path $p)) { $freedMB += $sz }
    }
  }
  Write-Ok "app/ = $(Get-DirSizeMB $AppDir) MB（已裁 Electron 主程序等 $([math]::Round($freedMB/1MB)) MB）"
} else {
  Write-Ok "app/ = $(Get-DirSizeMB $AppDir) MB（-KeepElectron：保留完整 Electron）"
}

# 3.0 补进 esbuild 与完整版 typescript，让绿色包具备**自重建插件代码**的能力。
#
# 为什么值得这 ~12 MB：
#   GitHub 的源码 zip 不含 lib/（编译产物在 .gitignore），所以「双击更新.cmd」
#   原本只能更新技能、更新不了插件代码（工具与页面）。补上工具链后，
#   update.ps1 就能在对方机器上完整重建，真正做到「双击更新，代码+技能一起更新」。
#
# ★ typescript 必须用**仓库里的完整版**覆盖 DSH 自带的那份：
#   实测 DSH 自带的 typescript/lib 只有 10 个文件、**一个 .d.ts 都没有**
#   （被裁剪过），用它编译会报 TS6053 "lib.es2022.d.ts not found"。
#   仓库里的完整版有 112 个文件（22.5 MB），含全部 lib.*.d.ts。
$EsbuildSrc = Join-Path $RepoRoot 'node_modules\@esbuild\win32-x64'
$EsbuildPkg = Join-Path $RepoRoot 'node_modules\esbuild'
$TsPkg = Join-Path $RepoRoot 'node_modules\typescript'
$AppModules = Join-Path $AppDir 'resources\app.asar.unpacked\node_modules'
if ($AppModules -and (Test-Path $AppModules)) {
  # esbuild（打包 browser 半区用）
  if ((Test-Path $EsbuildSrc) -and (Test-Path $EsbuildPkg)) {
    Copy-Tree $EsbuildPkg (Join-Path $AppModules 'esbuild')
    $dstNative = Join-Path $AppModules '@esbuild\win32-x64'
    Copy-Tree $EsbuildSrc $dstNative
    if (Test-Path (Join-Path $dstNative 'esbuild.exe')) {
      Write-Ok "esbuild 已补入（$([math]::Round((Get-Item (Join-Path $dstNative 'esbuild.exe')).Length/1MB,1)) MB）"
    } else {
      Write-Warn2 'esbuild 拷贝异常，更新器将无法重建 browser 半区'
    }
  } else {
    Write-Warn2 '仓库缺少 esbuild，包内无法自重建 browser 半区'
  }

  # 完整版 typescript（替换 DSH 的精简版，否则 tsc 缺 lib.*.d.ts）
  if (Test-Path $TsPkg) {
    $dstTs = Join-Path $AppModules 'typescript'
    $dtsCount = 0
    if (Test-Path (Join-Path $dstTs 'lib')) {
      $dtsCount = (Get-ChildItem (Join-Path $dstTs 'lib') -Filter '*.d.ts' -File -ErrorAction SilentlyContinue).Count
    }
    if ($dtsCount -eq 0) {
      if (Test-Path $dstTs) { Remove-Item $dstTs -Recurse -Force -ErrorAction SilentlyContinue }
      Copy-Tree $TsPkg $dstTs
      $newCount = (Get-ChildItem (Join-Path $dstTs 'lib') -Filter '*.d.ts' -File -ErrorAction SilentlyContinue).Count
      Write-Ok "typescript 已替换为完整版（.d.ts $dtsCount → $newCount 个）"
    } else {
      Write-Ok "typescript 已是完整版（.d.ts $dtsCount 个）"
    }
  } else {
    Write-Warn2 '仓库缺少 typescript，包内无法自重建 host 半区'
  }
}

# ── 3. 插件与技能 ───────────────────────────────────────────────────────
Write-Step '拷贝 DSAgent 插件与技能'
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
foreach ($item in @('lib', 'skills', 'package.json', 'cordis.patch.yml')) {
  $src = Join-Path $RepoRoot $item
  if (-not (Test-Path $src)) { Write-Warn2 "缺少 $item，跳过"; continue }
  $dst = Join-Path $PluginDir $item
  if ((Get-Item $src).PSIsContainer) {
    Copy-Tree $src $dst @('__pycache__', 'node_modules', '.git')
  } else {
    Copy-Item $src $dst -Force
  }
}

# ── 3.1 插件依赖：只带「插件独有的运行期依赖」──
#
# ★ 不要把 @deepseek-ai/* 拷进包！（曾这么做，导致启动失败）
#
# DSH Desktop 的官方启动器 resources/harness-node-entry.mjs 会调用
# registerHostModuleFallback()：插件解析 @deepseek-ai/* 失败时，宿主用自己携带的
# 那份重试。这是 Desktop 专为「外链插件」设计的机制（源码注释：
# "Let linked Profile plugins consume the Harness packages carried by Desktop"）。
#
# 手工拷贝会陷入死循环：副本自己又有传递依赖（如 dsh-llm -> dsh-typert-protocol），
# 而后者在 app 里根本不存在（由别的机制补），永远拷不全。
# 因此交给宿主兜底 —— 前提是启动器走 harness-node-entry.mjs，
# 而不是直接调 dsh/lib/bin.js（后者不注册兜底钩子）。
#
# 插件真正需要随包的是 puppeteer-core（自己 require，宿主不提供）。
$nmDst = Join-Path $PluginDir 'node_modules'
New-Item -ItemType Directory -Force -Path $nmDst | Out-Null

Write-Step '拷贝插件依赖'
$nmSrc = Join-Path $RepoRoot 'node_modules'
if (Test-Path (Join-Path $nmSrc 'puppeteer-core')) {
  # Copy-Package 会在遇到 junction 时解开、拷其真实内容（puppeteer-core 顶层就是 junction，
  # 指向 .pnpm 里的实体）。因此不需要再整份拷 .pnpm —— 那既慢又会撞 robocopy 权限错误。
  Copy-Package (Join-Path $nmSrc 'puppeteer-core') (Join-Path $nmDst 'puppeteer-core') | Out-Null
  # puppeteer-core 的传递依赖
  foreach ($dep in @('@puppeteer', 'chromium-bidi', 'devtools-protocol', 'debug', 'ms',
                     'ws', 'typed-query-selector', 'mitt', 'progress', 'proxy-agent',
                     'proxy-from-env', 'socks-proxy-agent', 'http-proxy-agent',
                     'https-proxy-agent', 'agent-base', 'socks', 'smart-buffer',
                     'ip-address', 'jsbn', 'sprintf-js', 'lru-cache', 'argparse',
                     'esprima', 'estraverse', 'esutils', 'buffer-crc32', 'fd-slicer',
                     'pend', 'yauzl', 'extract-zip', 'get-stream', 'pump',
                     'end-of-stream', 'once', 'wrappy', 'tar-fs', 'base64-js', 'ieee754',
                     'buffer', 'bare-events', 'bare-fs', 'bare-path', 'bare-stream',
                     'bare-url', 'events-universal', 'text-decoder', 'b4a', 'fast-fifo',
                     'streamx', 'tar-stream', 'queue-tick')) {
    $s = Join-Path $nmSrc $dep
    if (Test-Path $s) {
      $d = Join-Path $nmDst $dep
      New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null
      $item = Get-Item $s -Force
      if ($item.PSIsContainer) { Copy-Package $s $d | Out-Null } else { Copy-Item $s $d -Force }
    }
  }
  Write-Ok "puppeteer-core 及传递依赖已随包（浏览器类功能可用）"
} else {
  Write-Warn2 '仓库缺少 puppeteer-core，浏览器类功能（登录/发布）将不可用'
}
Write-Ok "plugin/node_modules = $(Get-DirSizeMB $nmDst) MB（@deepseek-ai/* 由宿主兜底，不随包）"
$skillCount = (Get-ChildItem (Join-Path $PluginDir 'skills') -Directory -ErrorAction SilentlyContinue).Count
Write-Ok "plugin/ = $(Get-DirSizeMB $PluginDir) MB（$skillCount 个技能目录）"

# ── 4. 便携 Python ──────────────────────────────────────────────────────
if (-not $SkipPython) {
  Write-Step '拷贝便携 Python'
  # 排除项：文档、GUI 组件、静态库、测试与示例 —— 技能运行时完全不需要。
  #   Doc/    49.7 MB  官方文档（HTML）
  #   tcl/     6.8 MB  Tk GUI 运行时
  #   include/ 0.8 MB  C 头文件（编译扩展才用）
  #   libs/    0.5 MB  静态导入库
  #   Tools/   0.5 MB  辅助脚本
  # 保留：DLLs/（.pyd 扩展与 OpenSSL）、Lib/（标准库 + site-packages）、
  #       python311.dll、vcruntime*.dll —— 这些是运行必需。
  Copy-Tree $PythonPath $PyDir @('__pycache__', 'Doc', 'tcl', 'include', 'libs', 'Tools', 'test', 'tests', 'idlelib', 'tkinter')

  # ★ 清空源解释器 site-packages，只留 pip 引导件。
  #
  #   为什么必须清：本机那份 pythoncore 曾被用于打包工具链，site-packages 里
  #   带着 PyInstaller / cx_Freeze / PyQt6 / fastapi / setuptools / ruff 等
  #   约 270 MB 无关内容。不清的话绿色包白白胖 200 MB+，PyQt6 之类还可能
  #   干扰技能依赖。
  #
  #   为什么「只留 pip」而不是「列一张保留清单」：
  #   白名单容易漏 —— 技能依赖的传递依赖（如 pdfplumber 需要 pdfminer.six、
  #   pandas 需要 pytz/tzdata）数量多且会变；一旦漏了，技能在对方机器上才报错，
  #   很难排查。改为全清 + 由 prepare-pydeps.ps1 用 pip 重新装齐，
  #   依赖关系交给 pip 解析，永远不会漏。
  $sp = Join-Path $PyDir 'Lib\site-packages'
  if (Test-Path $sp) {
    # pip 自身及其引导文件（没有它就无法安装依赖）
    $keepPip = @('pip', 'pip-*.dist-info', 'pkg_resources', 'setuptools', 'setuptools-*.dist-info',
                 '_distutils_hack', 'distutils-precedence.pth', 'README.txt')
    $removed = 0
    $removedMB = 0
    Get-ChildItem $sp -Force -ErrorAction SilentlyContinue | ForEach-Object {
      $isPip = $false
      foreach ($pat in $keepPip) { if ($_.Name -like $pat) { $isPip = $true; break } }
      if (-not $isPip) {
        $sz = 0
        try { $sz = (Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } catch {}
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $_.FullName)) { $removed++; $removedMB += $sz }
      }
    }
    Write-Ok "清空源解释器自带包 $removed 项（省 $([math]::Round($removedMB/1MB)) MB，依赖由 pip 重装）"
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $PyDir 'Lib\site-packages') | Out-Null
  Write-Ok "python/ = $(Get-DirSizeMB $PyDir) MB（依赖安装见 prepare-pydeps.ps1）"
}

# ── 5. 生成配置与启动器 ─────────────────────────────────────────────────
Write-Step '生成配置与启动器'

# 5.1 插件挂载补丁：路径占位符 __PKG__ 由启动器在运行时替换为真实位置
Copy-Item (Join-Path $ScriptDir 'portable.patch.template.yml') (Join-Path $PkgDir 'portable.patch.template.yml') -Force

# 5.2 技能发现补丁：让 DSH 技能系统看到包内 skills/
Copy-Item (Join-Path $ScriptDir 'skills.patch.template.yml') (Join-Path $PkgDir 'skills.patch.template.yml') -Force

# 5.2.5 ★ 修正脚本编码 —— 这一步不能省，否则对方双击会报一堆
#        "'...' is not recognized as an internal or external command"
#
#   .cmd 必须「纯 ASCII + CRLF」：cmd.exe 按系统 ANSI 代码页（中文 Windows = GBK）
#   解析 .cmd，与文件自身编码无关。UTF-8 的中文注释会被读成乱码并当命令执行。
#   （2026-10-04 实测复现：注释里的中文全部被当成命令，报 8 条错误。）
#   .ps1 必须是「UTF-8 with BOM」：Windows PowerShell 5.1 读无 BOM 的 .ps1
#   会按 ANSI 解释，中文同样乱码。
Write-Step '修正脚本编码（.cmd 纯 ASCII+CRLF，.ps1 UTF-8+BOM）'
$fixer = Join-Path $ScriptDir 'fix-script-encoding.mjs'
if (Test-Path $fixer) {
  Push-Location $RepoRoot
  try { & node $fixer 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
  finally { Pop-Location }
  Write-Ok '编码已修正'
} else {
  Write-Warn2 '缺少 fix-script-encoding.mjs，.cmd 可能因编码问题无法双击运行'
}

# 5.3 启动器
Copy-Item (Join-Path $ScriptDir 'launch.ps1') (Join-Path $PkgDir 'launch.ps1') -Force
Copy-Item (Join-Path $ScriptDir 'launch.cmd') (Join-Path $PkgDir '启动 DSAgent.cmd') -Force
Copy-Item (Join-Path $ScriptDir 'README-PORTABLE.md') (Join-Path $PkgDir '使用说明.md') -Force

# 5.4 一键更新器：对方双击「更新.cmd」即可从 GitHub 拉最新技能/代码，
#     不必再等他发增量包。data/（账号、会话）不受影响。
Copy-Item (Join-Path $ScriptDir 'update.ps1') (Join-Path $PkgDir 'update.ps1') -Force
Copy-Item (Join-Path $ScriptDir 'update.cmd') (Join-Path $PkgDir '更新.cmd') -Force

# 5.5 打包后校验：确认包内的 .cmd 真的是纯 ASCII + CRLF。
#     这一步是防回归 —— 编码问题只在对方双击时才暴露，本地测试容易漏。
$badCmd = @()
foreach ($n in @('启动 DSAgent.cmd', '更新.cmd')) {
  $p = Join-Path $PkgDir $n
  if (-not (Test-Path $p)) { continue }
  $bytes = [System.IO.File]::ReadAllBytes($p)
  $nonAscii = ($bytes | Where-Object { $_ -gt 0x7f }).Count
  $text = [System.Text.Encoding]::Latin1.GetString($bytes)
  $loneLf = ([regex]::Matches($text, "(?<!\r)\n")).Count
  if ($nonAscii -gt 0 -or $loneLf -gt 0) {
    $badCmd += "$n (非ASCII=$nonAscii 裸LF=$loneLf)"
  }
}
if ($badCmd.Count -gt 0) {
  Write-Warn2 "以下 .cmd 编码仍不规范，双击可能报错：$($badCmd -join '; ')"
} else {
  Write-Ok '启动器 + 更新器 + 配置模板 + 使用说明（编码已校验）'
}

# ── 6. 版本信息 ─────────────────────────────────────────────────────────
$gitRev = 'unknown'
$gitRevTime = ''
try { $gitRev = (& git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch {}
try { $gitRevTime = (& git -C $RepoRoot log -1 --format=%cI 2>$null) } catch {}
[ordered]@{
  builtAt        = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  gitCommit      = $gitRev
  # ★ 记录提交时间：更新器用它判断「远端是否真的更新」。
  #   只比 sha 是不够的 —— 发布者本地可能有尚未推送的提交（sha 不在远端），
  #   此时远端 sha 与本地不同，但远端其实是**更旧**的版本；直接更新会造成降级。
  commitTime     = $gitRevTime
  skillCount     = $skillCount
  pythonIncluded = (-not $SkipPython)
  sizes          = [ordered]@{
    app    = (Get-DirSizeMB $AppDir)
    plugin = (Get-DirSizeMB $PluginDir)
    python = (Get-DirSizeMB $PyDir)
    total  = (Get-DirSizeMB $PkgDir)
  }
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $PkgDir 'build-info.json') -Encoding UTF8
Write-Ok "build-info.json (commit $gitRev$(if ($gitRevTime) { ", $gitRevTime" }))"

# ── 7. 压缩 ─────────────────────────────────────────────────────────────
# 注意：默认不压缩。因为 Python 依赖是在本脚本之后由 prepare-pydeps.ps1 装进
# python/Lib/site-packages 的，此处压缩会得到一个「缺依赖」的包。
# 需要在此处直接压缩时显式加 -Zip（仅适用于 -SkipPython 或依赖已就绪的场景）。
if ($Zip) {
  Write-Step '压缩为 zip（体积较大，需数分钟）'
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path $PkgDir -DestinationPath $ZipPath -CompressionLevel Optimal
  Write-Ok "zip = $([math]::Round((Get-Item $ZipPath).Length/1MB)) MB"
}

Write-Host ''
Write-Host '=== 打包完成 ===' -ForegroundColor Cyan
Write-Host "  目录: $PkgDir  ($(Get-DirSizeMB $PkgDir) MB)"
if ($Zip) { Write-Host "  zip : $ZipPath" }
Write-Host ''
if (-not $SkipPython) {
  Write-Host '下一步（必须执行，否则技能缺 Python 依赖）:' -ForegroundColor Yellow
  Write-Host '  pwsh -File dev/portable/prepare-pydeps.ps1'
  Write-Host '  它会在装完依赖后自动生成 zip。'
} else {
  Write-Host '提示：本次跳过了 Python，技能无法运行。若要完整包请不加 -SkipPython。' -ForegroundColor Yellow
}
Write-Host ''
