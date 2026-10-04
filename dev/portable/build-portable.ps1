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
  [switch]$SkipPython,
  [switch]$Zip,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$OutRoot   = Join-Path $RepoRoot 'dist'
$PkgDir    = Join-Path $OutRoot 'DSAgent-Portable'
$ZipPath   = Join-Path $OutRoot 'DSAgent-Portable.zip'

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

# robocopy：比 Copy-Item 快很多，且正确处理隐藏文件
function Copy-Tree([string]$From, [string]$To, [string[]]$ExcludeDirs = @()) {
  if (-not (Test-Path $From)) { throw "源目录不存在: $From" }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  $rcArgs = @($From, $To, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  if ($ExcludeDirs.Count -gt 0) { $rcArgs += '/XD'; $rcArgs += $ExcludeDirs }
  $null = & robocopy @rcArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 ($LASTEXITCODE): $From -> $To" }
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

if (-not $PythonPath) { $PythonPath = Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64' }
$HasPython = Test-Path (Join-Path $PythonPath 'python.exe')
if (-not $SkipPython -and -not $HasPython) {
  throw "未找到便携 Python: $PythonPath`n用 -PythonPath 指定，或加 -SkipPython 先验证流程。"
}
if ($HasPython) { Write-Ok "Python: $PythonPath" } else { Write-Warn2 '按参数跳过 Python' }

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
Get-ChildItem $AppDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue
Write-Ok "app/ = $(Get-DirSizeMB $AppDir) MB"

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
  Copy-Tree (Join-Path $nmSrc 'puppeteer-core') (Join-Path $nmDst 'puppeteer-core')
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
      if ((Get-Item $s).PSIsContainer) { Copy-Tree $s $d } else { Copy-Item $s $d -Force }
    }
  }
  # pnpm 的 .pnpm 实体（顶层若为软链，真实内容在这里）
  $pnpmSrc = Join-Path $nmSrc '.pnpm'
  if (Test-Path $pnpmSrc) { Copy-Tree $pnpmSrc (Join-Path $nmDst '.pnpm') @() }
  Write-Ok "puppeteer-core 及传递依赖已随包（浏览器类功能可用）"
} else {
  Write-Warn2 '仓库缺少 puppeteer-core，浏览器类功能（登录/发布）将不可用'
}
Write-Ok "plugin/node_modules = $(Get-DirSizeMB $nmDst) MB"
$skillCount = (Get-ChildItem (Join-Path $PluginDir 'skills') -Directory -ErrorAction SilentlyContinue).Count
Write-Ok "plugin/ = $(Get-DirSizeMB $PluginDir) MB（$skillCount 个技能目录）"

# ── 4. 便携 Python ──────────────────────────────────────────────────────
if (-not $SkipPython) {
  Write-Step '拷贝便携 Python（约 488 MB）'
  Copy-Tree $PythonPath $PyDir @('__pycache__')
  New-Item -ItemType Directory -Force -Path (Join-Path $PyDir 'Lib\site-packages') | Out-Null
  Write-Ok "python/ = $(Get-DirSizeMB $PyDir) MB（依赖安装见 prepare-pydeps.ps1）"
}

# ── 5. 生成配置与启动器 ─────────────────────────────────────────────────
Write-Step '生成配置与启动器'

# 5.1 插件挂载补丁：路径占位符 __PKG__ 由启动器在运行时替换为真实位置
Copy-Item (Join-Path $ScriptDir 'portable.patch.template.yml') (Join-Path $PkgDir 'portable.patch.template.yml') -Force

# 5.2 技能发现补丁：让 DSH 技能系统看到包内 skills/
Copy-Item (Join-Path $ScriptDir 'skills.patch.template.yml') (Join-Path $PkgDir 'skills.patch.template.yml') -Force

# 5.3 启动器
Copy-Item (Join-Path $ScriptDir 'launch.ps1') (Join-Path $PkgDir 'launch.ps1') -Force
Copy-Item (Join-Path $ScriptDir 'launch.cmd') (Join-Path $PkgDir '启动 DSAgent.cmd') -Force
Copy-Item (Join-Path $ScriptDir 'README-PORTABLE.md') (Join-Path $PkgDir '使用说明.md') -Force
Write-Ok '启动器 + 配置模板 + 使用说明'

# ── 6. 版本信息 ─────────────────────────────────────────────────────────
$gitRev = 'unknown'
try { $gitRev = (& git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch {}
[ordered]@{
  builtAt        = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  gitCommit      = $gitRev
  skillCount     = $skillCount
  pythonIncluded = (-not $SkipPython)
  sizes          = [ordered]@{
    app    = (Get-DirSizeMB $AppDir)
    plugin = (Get-DirSizeMB $PluginDir)
    python = (Get-DirSizeMB $PyDir)
    total  = (Get-DirSizeMB $PkgDir)
  }
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $PkgDir 'build-info.json') -Encoding UTF8
Write-Ok "build-info.json (commit $gitRev)"

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
