<#
.SYNOPSIS
  用「运维基座」+ 当前构建产物，组装一个完整绿色包。

.DESCRIPTION
  为什么需要本脚本：
    完整绿色包的体积里，93% 是**极少变动**的部分 ——
      app/     ~638 MB  DSH 运行时（node.exe + node_modules + harness 入口）
      python/  ~294 MB  便携 Python + 技能依赖
    而每次发版真正变的只有 plugin/（约 41 MB，其中 skills 9.5 MB）与几个脚本。

    托管 CI（GitHub Actions）**无法从零拿到 app/**：官方在线安装包 0.11.0 里
    没有 node.exe（实测 asar 21221 个条目中 node.exe 数量 = 0），而
    build-portable.ps1 依赖本机已装的 DSH Desktop 0.10.0 布局。

    因此 CI 侧的策略是：把 app/ 与 python/ 作为「基座」只发布一次，
    之后每次发版都用本脚本「基座 + 新 plugin/」快速重组。

用法：
  pwsh -File dev/portable/assemble-full-from-base.ps1 -BaseZip dist/DSAgent-Base.zip -OutRoot dist

.PARAMETER BaseZip
  基座 zip，需包含 app/ 与 python/（不含 plugin/ 也可，含则会被覆盖）。

.PARAMETER OutRoot
  输出目录，产物为 <OutRoot>/DSAgent-Portable.zip。

.PARAMETER NoZip
  只组装目录、不压缩（调试用）。

.PARAMETER AllowRepoOutput
  允许把产物写进仓库内（CI 用）。

  默认**禁止**写进仓库：本机跑时，DSH Desktop 的 profile 迁移会把插件目录整份
  staging，扫到仓库内的 app.asar 会判定 Invalid package 并迁移失败，宿主从此
  只读旧快照 —— 表现为「插件 UI 不显示，且重新构建也不生效」，极难排查。

  但 CI runner 上并没有 DSH Desktop，写进 workspace 的 dist/ 完全无害（而且
  那是 Actions 唯一方便取用产物的位置），所以由工作流显式开启本开关。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BaseZip,
  [string]$OutRoot,
  [switch]$NoZip,
  [switch]$AllowRepoOutput
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE 'DSAgent-Portable-build' }
$OutRoot = (New-Item -ItemType Directory -Force -Path $OutRoot).FullName

# ── 与 build-portable.ps1 一致的护栏：产物绝不能落在仓库内 ────────────────
# 理由（实测事故）：DSH Desktop 的 profile 迁移会把插件目录整份 staging，
# 扫到仓库内的 app.asar 会判定 Invalid package 并迁移失败，导致宿主从此
# 只读旧快照 —— 表现为「插件 UI 不显示，且重新构建也不生效」。
#
# CI（GitHub Actions）没有 DSH Desktop，dist/ 落在 workspace 里无害，
# 由工作流传 -AllowRepoOutput 显式放行。
if (-not $AllowRepoOutput -and $OutRoot.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "产物目录不能放在仓库内：$OutRoot`n请改用仓库外路径（如 `$env:USERPROFILE\DSAgent-Portable-build），或在 CI 上传 -AllowRepoOutput。"
}

$PkgDir = Join-Path $OutRoot 'DSAgent-Portable'
$ZipPath = Join-Path $OutRoot 'DSAgent-Portable.zip'

function Write-Step([string]$T) { Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok([string]$T)   { Write-Host "    OK $T" -ForegroundColor Green }

function Get-DirSizeMB([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  $sum = (Get-ChildItem $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

Write-Host ''
Write-Host '=== 基座 + 构建产物 → 完整绿色包 ===' -ForegroundColor Cyan
Write-Host "  基座: $BaseZip"
Write-Host "  输出: $OutRoot"
Write-Host ''

# ── 1. 前置检查 ─────────────────────────────────────────────────────────
Write-Step '检查输入'

if (-not (Test-Path $BaseZip)) { throw "基座 zip 不存在: $BaseZip" }

$HostJs   = Join-Path $RepoRoot 'lib\index.js'
$ClientJs = Join-Path $RepoRoot 'lib\client.js'
if (-not (Test-Path $HostJs) -or -not (Test-Path $ClientJs)) {
  throw "缺少构建产物，请先运行: npm run build"
}
# client.js 由 esbuild 产出（约 230 KB）。若被 tsc 覆盖成裸源码会小很多，
# 这种产物打进包后在对方机器上必然白屏，所以这里就拦住。
$clientSize = (Get-Item $ClientJs).Length
if ($clientSize -lt 50000) {
  throw "lib/client.js 仅 $clientSize 字节（疑似被 tsc 覆盖成裸源码），请重新: npm run build"
}
Write-Ok "构建产物齐备 (client.js $([math]::Round($clientSize/1KB)) KB)"

if (Test-Path $PkgDir) { Remove-Item $PkgDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $PkgDir | Out-Null

# ── 2. 解基座 ───────────────────────────────────────────────────────────
Write-Step '解压基座（app/ + python/）'
Expand-Archive -LiteralPath $BaseZip -DestinationPath $PkgDir -Force

# 基座可能多包一层目录（例如压缩时用了 <dir> 而非 <dir>\*），这里拉平
$entries = Get-ChildItem $PkgDir -Force
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer -and
    -not (Test-Path (Join-Path $PkgDir 'app'))) {
  $inner = $entries[0].FullName
  Write-Host "    基座多一层目录，拉平: $($entries[0].Name)" -ForegroundColor DarkGray
  Get-ChildItem $inner -Force | ForEach-Object { Move-Item $_.FullName $PkgDir -Force }
  Remove-Item $inner -Recurse -Force -ErrorAction SilentlyContinue
}

foreach ($need in @('app', 'python')) {
  if (-not (Test-Path (Join-Path $PkgDir $need))) {
    throw "基座里缺少 $need/ —— 基座必须包含 app/（DSH 运行时）与 python/（便携解释器）。"
  }
}
Write-Ok "app/ $(Get-DirSizeMB (Join-Path $PkgDir 'app')) MB、python/ $(Get-DirSizeMB (Join-Path $PkgDir 'python')) MB"

# ★ 基座里若混进了 data/（账号、会话凭证），必须剔除 —— 这是分发红线。
$stale = Join-Path $PkgDir 'data'
if (Test-Path $stale) {
  Remove-Item $stale -Recurse -Force
  Write-Host '    ! 基座含 data/，已剔除（凭证不得进分发包）' -ForegroundColor DarkYellow
}

# ── 3. 覆盖 plugin/ ─────────────────────────────────────────────────────
Write-Step '写入 plugin/（lib + skills + 清单）'
$PluginDir = Join-Path $PkgDir 'plugin'
if (Test-Path $PluginDir) { Remove-Item $PluginDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null

function Copy-Tree([string]$From, [string]$To, [string[]]$ExcludeDirs = @()) {
  if (-not (Test-Path $From)) { throw "源目录不存在: $From" }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  $rcArgs = @($From, $To, '/E', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  if ($ExcludeDirs.Count -gt 0) { $rcArgs += '/XD'; $rcArgs += $ExcludeDirs }
  $null = & robocopy @rcArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 ($LASTEXITCODE): $From -> $To" }
}

foreach ($item in @('lib', 'skills', 'package.json', 'cordis.patch.yml')) {
  $src = Join-Path $RepoRoot $item
  if (-not (Test-Path $src)) { throw "仓库缺少 $item（构建不完整）" }
  $dst = Join-Path $PluginDir $item
  if ((Get-Item $src).PSIsContainer) {
    Copy-Tree $src $dst @('__pycache__', 'node_modules', '.git')
  } else {
    Copy-Item $src $dst -Force
  }
}

# 插件独有运行期依赖：puppeteer-core 及其传递依赖（@deepseek-ai/* 由宿主兜底，不随包）
$nmDst = Join-Path $PluginDir 'node_modules'
$nmSrc = Join-Path $RepoRoot 'node_modules'
if (Test-Path (Join-Path $nmSrc 'puppeteer-core')) {
  New-Item -ItemType Directory -Force -Path $nmDst | Out-Null
  # pnpm 布局下 puppeteer-core 顶层是 junction，robocopy /XJ 不会跟进，
  # 因此这里用 -Recurse 的 Copy-Item（会自动解引用）
  Copy-Item (Join-Path $nmSrc 'puppeteer-core') (Join-Path $nmDst 'puppeteer-core') -Recurse -Force
  foreach ($dep in @('@puppeteer','chromium-bidi','devtools-protocol','debug','ms','ws',
                     'typed-query-selector','mitt','progress','proxy-agent','proxy-from-env',
                     'socks-proxy-agent','http-proxy-agent','https-proxy-agent','agent-base',
                     'socks','smart-buffer','ip-address','jsbn','sprintf-js','lru-cache',
                     'argparse','esprima','estraverse','esutils','buffer-crc32','fd-slicer',
                     'pend','yauzl','extract-zip','get-stream','pump','end-of-stream','once',
                     'wrappy','tar-fs','base64-js','ieee754','buffer','bare-events','bare-fs',
                     'bare-path','bare-stream','bare-url','events-universal','text-decoder',
                     'b4a','fast-fifo','streamx','tar-stream','queue-tick')) {
    $s = Join-Path $nmSrc $dep
    if (Test-Path $s) {
      $d = Join-Path $nmDst $dep
      New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null
      if ((Get-Item $s -Force).PSIsContainer) { Copy-Item $s $d -Recurse -Force }
      else { Copy-Item $s $d -Force }
    }
  }
  Write-Ok "plugin/node_modules = $(Get-DirSizeMB $nmDst) MB（puppeteer-core 随包）"
} else {
  Write-Host '    ! 仓库缺少 puppeteer-core，浏览器类功能（登录/发布）将不可用' -ForegroundColor DarkYellow
}

$skillCount = (Get-ChildItem (Join-Path $PluginDir 'skills') -Directory -ErrorAction SilentlyContinue).Count
Write-Ok "plugin/ = $(Get-DirSizeMB $PluginDir) MB（$skillCount 个技能目录）"

# ── 4. 启动器与配置模板 ─────────────────────────────────────────────────
Write-Step '写入启动器、更新器与配置模板'

# ★ 顺序很重要：先修源文件编码，再拷进包。
#
#   反过来的话（先拷后修），fixer 修的是仓库里 dev/portable/ 的源文件，
#   包内那份仍是未修正的 —— 对方双击就会刷出一堆
#     '文件所在目录（保证相对路径正确）' is not recognized as an internal or external command
#   这个坑只在对方机器上暴露，本地用 pwsh -File 测不出来。
#
#   fixer 的作用：.cmd → 纯 ASCII + CRLF；.ps1 → UTF-8 with BOM。
$fixer = Join-Path $ScriptDir 'fix-script-encoding.mjs'
if (Test-Path $fixer) {
  Push-Location $RepoRoot
  try { & node $fixer 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
  finally { Pop-Location }
} else {
  Write-Host '    ! 缺少 fix-script-encoding.mjs，.cmd 可能因编码问题无法双击运行' -ForegroundColor DarkYellow
}

foreach ($pair in @(
  @('launch.ps1',              'launch.ps1'),
  @('launch.cmd',              '启动 DSAgent.cmd'),
  @('update.ps1',              'update.ps1'),
  @('update.cmd',              '更新.cmd'),
  @('README-PORTABLE.md',      '使用说明.md'),
  @('portable.patch.template.yml', 'portable.patch.template.yml'),
  @('skills.patch.template.yml',   'skills.patch.template.yml')
)) {
  $src = Join-Path $ScriptDir $pair[0]
  if (Test-Path $src) { Copy-Item $src (Join-Path $PkgDir $pair[1]) -Force }
  else { Write-Host "    ! 缺少 $($pair[0])" -ForegroundColor DarkYellow }
}

# ★ 打包后校验**包内**那份的编码，而不是源文件。
#   这是防回归：源文件修好了、但拷贝顺序写错，症状完全一样。
$badCmd = @()
foreach ($n in @('启动 DSAgent.cmd', '更新.cmd')) {
  $p = Join-Path $PkgDir $n
  if (-not (Test-Path $p)) { continue }
  $bytes = [System.IO.File]::ReadAllBytes($p)
  $nonAscii = @($bytes | Where-Object { $_ -gt 0x7f }).Count
  $latin = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
  $loneLf = ([regex]::Matches($latin, "(?<!\r)\n")).Count
  if ($nonAscii -gt 0 -or $loneLf -gt 0) { $badCmd += "$n (非ASCII=$nonAscii 裸LF=$loneLf)" }
}
if ($badCmd.Count -gt 0) {
  throw @"
包内 .cmd 编码不合规，对方双击必然报错：
  $($badCmd -join '; ')

根因：dev/portable/ 下的 .cmd 源文件必须已经是「纯 ASCII + CRLF」。
fix-script-encoding.mjs 只能把非 ASCII 字符映射掉，**无法把中文注释变成英文**——
若源文件里还有中文，它只会告警并留下乱码。

处理：把 dev/portable/launch.cmd 与 update.cmd 里的中文注释改成英文后提交。
"@
}
Write-Ok '启动器 / 更新器 / 使用说明 / 配置模板（包内编码已校验）'

# ── 5. build-info.json ──────────────────────────────────────────────────
Write-Step '写入 build-info.json'
$gitRev = 'unknown'; $gitRevTime = ''
try { $gitRev     = (& git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch {}
try { $gitRevTime = (& git -C $RepoRoot log -1 --format=%cI 2>$null) } catch {}

[ordered]@{
  builtAt        = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  gitCommit      = $gitRev
  # ★ 更新器以提交时间而非 sha 判断新旧：发布者本地常有未推送提交，
  #   只比 sha 会把新版本误「更新」成远端旧版本（实测踩过）。
  commitTime     = $gitRevTime
  skillCount     = $skillCount
  pythonIncluded = $true
  sizes          = [ordered]@{
    app    = (Get-DirSizeMB (Join-Path $PkgDir 'app'))
    plugin = (Get-DirSizeMB $PluginDir)
    python = (Get-DirSizeMB (Join-Path $PkgDir 'python'))
    total  = (Get-DirSizeMB $PkgDir)
  }
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $PkgDir 'build-info.json') -Encoding UTF8
Write-Ok "build-info.json (commit $gitRev$(if ($gitRevTime) { ", $gitRevTime" }))"

# ── 6. 压缩 ─────────────────────────────────────────────────────────────
# ★ 用 -Path $PkgDir（不带 \*）：完整包需要保留 DSAgent-Portable/ 这一层，
#   否则用户解压后文件散落一地，找不到启动器。
if (-not $NoZip) {
  Write-Step '压缩为 zip（约 340 MB，需数分钟）'
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path $PkgDir -DestinationPath $ZipPath -CompressionLevel Optimal
  Write-Ok "zip = $([math]::Round((Get-Item $ZipPath).Length/1MB)) MB"
}

Write-Host ''
Write-Host '=== 组装完成 ===' -ForegroundColor Cyan
Write-Host "  目录: $PkgDir ($(Get-DirSizeMB $PkgDir) MB)"
if (-not $NoZip) { Write-Host "  zip : $ZipPath" }
Write-Host ''
Write-Host '注意：本次组装**未安装 Python 依赖**（基座里应已含）。' -ForegroundColor DarkYellow
Write-Host '      若基座是全新的便携 Python，需要再跑 prepare-pydeps.ps1。' -ForegroundColor DarkYellow
Write-Host ''
