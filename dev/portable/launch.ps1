<#
.SYNOPSIS
  DSAgent 绿色版启动器。

.DESCRIPTION
  由「启动 DSAgent.cmd」调用。职责：
    1. 以自身所在目录为包根（__PKG__），实现「拷到哪都能跑」
    2. 把配置模板里的 __PKG__ 替换成真实绝对路径，写入 data/
    3. 设置 DSH_HOME / DSAGENT_PYTHON，让数据与依赖都留在包内
    4. 用包内自带的 node.exe + DSH CLI 启动，不依赖对方装 Node / Python / DSH
    5. 启动后自动打开浏览器

  为什么用 CLI 而不是 DSH Desktop.exe：
    - Desktop 有全局单实例锁，绿色版会与本机已装的 DSH 冲突
    - Desktop 把 userData 硬编码到 %APPDATA%\dsh-desktop，绕开它要改注册表
    CLI 原生支持 DSH_HOME + --patch，天然干净，且两者可并存。

.PARAMETER Port
  Web UI 端口，默认 7788。设为 0 让系统自动挑一个空闲端口。

.PARAMETER NoBrowser
  不自动打开浏览器。

.PARAMETER Reset
  清空包内 data/（会话、账号等），恢复到首次使用状态。

.EXAMPLE
  pwsh -File launch.ps1
  pwsh -File launch.ps1 -Port 0 -NoBrowser
#>
[CmdletBinding()]
param(
  [int]$Port = 7788,
  [switch]$NoBrowser,
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'

# ── 1. 定位包根：以本脚本所在目录为准（可移植性的基础）────────────────
$PkgRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$AppDir    = Join-Path $PkgRoot 'app'
$PluginDir = Join-Path $PkgRoot 'plugin'
$PyDir     = Join-Path $PkgRoot 'python'
$DataDir   = Join-Path $PkgRoot 'data'
$HomeDir   = Join-Path $DataDir 'dsh-home'

$NodeExe = Join-Path $AppDir 'resources\app.asar.unpacked\node_modules\node\bin\node.exe'
$DshBin  = Join-Path $AppDir 'resources\app.asar.unpacked\node_modules\@deepseek-ai\dsh\lib\bin.js'
# ★ 必须用官方启动包装器，不能直接跑 DSH 的 bin.js：
#   包装器会 registerHostModuleFallback()，让插件的 @deepseek-ai/* 依赖回退到宿主
#   自带的那份（这正是 Desktop 为外链插件设计的机制）。直接调 bin.js 会缺少该钩子，
#   插件会因为找不到 dsh-scope / dsh-llm / dsh-typert-protocol 等而激活失败。
$HarnessEntry = Join-Path $AppDir 'resources\harness-node-entry.mjs'
$PyExe   = Join-Path $PyDir 'python.exe'

function Fail([string]$Msg) {
  Write-Host ''
  Write-Host '启动失败' -ForegroundColor Red
  Write-Host $Msg -ForegroundColor Red
  Write-Host ''
  Read-Host '按回车退出'
  exit 1
}

Write-Host ''
Write-Host '  DSAgent 正在启动…' -ForegroundColor Cyan
Write-Host "  位置: $PkgRoot"
Write-Host ''

# ── 2. 环境自检 ─────────────────────────────────────────────────────────
if (-not (Test-Path $NodeExe)) { Fail "缺少 DSH 运行环境:`n  $NodeExe`n`n绿色包可能不完整，请重新解压（注意：先用完整解压，不要直接在压缩包里双击运行）。" }
if (-not (Test-Path $DshBin))  { Fail "缺少 DSH 程序入口:`n  $DshBin`n`n绿色包可能不完整，请重新解压。" }
if (-not (Test-Path $HarnessEntry)) { Fail "缺少 DSH 启动包装器:`n  $HarnessEntry`n`n绿色包可能不完整，请重新解压。" }
if (-not (Test-Path (Join-Path $PluginDir 'lib\index.js'))) { Fail "缺少 DSAgent 插件:`n  $PluginDir\lib\index.js" }

$hasPython = Test-Path $PyExe
if (-not $hasPython) {
  Write-Host '  提示: 包内未包含 Python，走 Python 的技能将不可用。' -ForegroundColor DarkYellow
  Write-Host ''
}

# ── 3. -Reset：清空数据 ─────────────────────────────────────────────────
if ($Reset) {
  if (Test-Path $DataDir) {
    Write-Host '  正在清空数据目录（账号、会话将全部删除）…' -ForegroundColor DarkYellow
    Remove-Item $DataDir -Recurse -Force
    Write-Host '  已重置。' -ForegroundColor Green
  }
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null

# ── 4. 生成配置（把 __PKG__ 换成真实路径）──────────────────────────────
# 每次启动都重新生成：这样包被拷到别的盘符/目录后，配置自动跟着变，
# 不残留上一次运行时的旧绝对路径。
function Expand-PatchTemplate([string]$TemplateName, [string]$OutName) {
  $tpl = Join-Path $PkgRoot $TemplateName
  if (-not (Test-Path $tpl)) { Fail "缺少配置模板: $tpl" }
  $text = Get-Content $tpl -Raw -Encoding UTF8
  # YAML 里用正斜杠更安全（反斜杠在双引号里是转义符）
  $pkgSlash = $PkgRoot -replace '\\', '/'
  $text = $text.Replace('__PKG__', $pkgSlash)
  $out = Join-Path $DataDir $OutName
  Set-Content -Path $out -Value $text -Encoding UTF8
  return $out
}

$patchPlugin = Expand-PatchTemplate 'portable.patch.template.yml' 'portable.patch.yml'
$patchSkills = Expand-PatchTemplate 'skills.patch.template.yml'   'skills.patch.yml'

# ── 5. 组装环境变量 ─────────────────────────────────────────────────────
$env:DSH_HOME = $HomeDir

if ($hasPython) {
  # 插件优先读这个变量（见 src/services/skill-service.ts 的 pythonCandidates），
  # 指向包内 Python，技能依赖命中数最高会被自动选中。
  $env:DSAGENT_PYTHON = $PyExe
  # 让技能里的 python 子进程也能直接 import 到包内依赖
  $sitePkgs = Join-Path $PyDir 'Lib\site-packages'
  $env:PYTHONPATH = $sitePkgs
  $env:PYTHONUTF8 = '1'
  $env:PYTHONIOENCODING = 'utf-8'
}

Write-Host '  配置已生成:' -ForegroundColor DarkGray
Write-Host "    数据目录  $HomeDir" -ForegroundColor DarkGray
if ($hasPython) { Write-Host "    Python    $PyExe" -ForegroundColor DarkGray }
Write-Host ''

# ── 6. 启动 DSH web ─────────────────────────────────────────────────────
# ★ 两个都已实测踩过的坑：
#
#   坑1 参数顺序（--patch 是全局选项）：
#     ✗ dsh web --patch x      → error: unknown option '--patch'
#     ✗ dsh --patch x web      → error: --profile <name> is required
#     ✓ dsh --profile web --patch x ...
#
#   坑2 入口必须是 harness-node-entry.mjs（见上方 $HarnessEntry 说明）：
#     ✗ node dsh/lib/bin.js ...           → 插件找不到 @deepseek-ai/* 全部激活失败
#     ✓ node harness-node-entry.mjs <dsh bin.js> ...
#   包装器要求第一个参数是 DSH 入口路径，其后才是 DSH 自己的参数。
$dshArgs = @(
  $HarnessEntry,
  $DshBin,
  '--profile', 'web',
  '--patch', $patchPlugin,
  '--patch', $patchSkills,
  '--host', '127.0.0.1',
  '--port', "$Port"
)
if ($NoBrowser) { $dshArgs += '--no-open' }

Write-Host '  启动中，首次启动需要初始化，请稍候…' -ForegroundColor Cyan
Write-Host '  （关闭本窗口即可停止 DSAgent）' -ForegroundColor DarkGray
Write-Host ''

# 直接在控制台运行，日志留在窗口里便于排查
& $NodeExe @dshArgs
$exitCode = $LASTEXITCODE

Write-Host ''
if ($exitCode -ne 0) {
  Write-Host "  DSAgent 已退出（代码 $exitCode）" -ForegroundColor Red
  Write-Host '  若上方有报错，请把整段日志发给插件作者。' -ForegroundColor Red
  Read-Host '按回车退出'
} else {
  Write-Host '  DSAgent 已停止。' -ForegroundColor Green
}
