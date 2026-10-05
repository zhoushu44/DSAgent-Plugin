<#
.SYNOPSIS
  从本机已打好的完整绿色包里，抽出「基座」（app/ + python/）供 CI 复用。

.DESCRIPTION
  完整绿色包的体积里 93% 是极少变动的部分：
    app/     ~638 MB  DSH 运行时（node.exe + node_modules + harness 入口）
    python/  ~294 MB  便携 Python + 已装技能依赖

  这两块在托管 CI 上**无法从零得到**（官方在线安装包 0.11.0 里没有 node.exe），
  所以只发布一次：「基座 + 每次新 plugin/」重组即可。

  产物 DSAgent-Base.zip 上传到 tag「base」的 Release 后，
  .github/workflows/release.yml 的 full job 就能自动组装完整包。

  ★ 产物**不含** data/、不含 plugin/ —— data/ 是账号凭证，绝不能进分发链。

用法：
  pwsh -File dev/portable/make-base.ps1

.PARAMETER SourceDir
  已打好完整绿色包的目录，默认 %USERPROFILE%\DSAgent-Portable-build\DSAgent-Portable

.PARAMETER OutRoot
  基座 zip 的输出目录，默认 %USERPROFILE%\DSAgent-Portable-build

.PARAMETER NoZip
  只准备目录、不压缩（调试用）。
#>
[CmdletBinding()]
param(
  [string]$SourceDir,
  [string]$OutRoot,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE 'DSAgent-Portable-build' }
$OutRoot = (New-Item -ItemType Directory -Force -Path $OutRoot).FullName

if (-not $SourceDir) {
  $SourceDir = Join-Path $env:USERPROFILE 'DSAgent-Portable-build\DSAgent-Portable'
}

# 与两个打包脚本一致的护栏：产物不得落在仓库内（会破坏 DSH Desktop 的插件迁移）
if ($OutRoot.StartsWith($RepoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "产物目录不能放在仓库内：$OutRoot"
}

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
Write-Host '=== 生成 CI 基座（app/ + python/）===' -ForegroundColor Cyan
Write-Host "  来源: $SourceDir"
Write-Host "  输出: $OutRoot"
Write-Host ''

# ── 1. 前置检查 ─────────────────────────────────────────────────────────
Write-Step '检查来源完整包'

if (-not (Test-Path $SourceDir)) {
  throw @"
找不到完整绿色包目录：$SourceDir

请先在本机打好完整包（三条命令，顺序不能变）：
  npm run build
  npm run portable
  npm run portable:deps
"@
}

foreach ($need in @('app', 'python', 'plugin')) {
  if (-not (Test-Path (Join-Path $SourceDir $need))) {
    throw "来源不完整，缺少 $need/ ：$SourceDir"
  }
}
Write-Ok "app/ $(Get-DirSizeMB (Join-Path $SourceDir 'app')) MB、python/ $(Get-DirSizeMB (Join-Path $SourceDir 'python')) MB"

# ★ 关键校验：技能依赖真的装进去了吗？
#   build-portable.ps1 会清空 python/Lib/site-packages（只留 pip），
#   依赖全靠 prepare-pydeps.ps1 重装。若忘了跑第三步，基座里的 Python
#   是「没有依赖的空壳」，CI 组装出来的包技能全废 —— 且只有到用户那边才暴露。
$sp = Join-Path $SourceDir 'python\Lib\site-packages'
$depCount = @(Get-ChildItem $sp -Directory -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -notlike 'pip*' -and $_.Name -notlike 'setuptools*' -and $_.Name -ne '_distutils_hack' }).Count
if ($depCount -lt 10) {
  throw @"
python/Lib/site-packages 里只有 $depCount 个依赖目录，基座很可能没装依赖。

请先运行第三步：
  npm run portable:deps

（它会用 py-requirements.txt 把技能依赖装进包内 Python）
"@
}
Write-Ok "python 依赖目录 $depCount 个（已预装）"

# ── 2. 抽取基座 ─────────────────────────────────────────────────────────
Write-Step '抽取 app/ 与 python/'
$StageDir = Join-Path $OutRoot 'DSAgent-Base'
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

function Copy-Tree([string]$From, [string]$To, [string[]]$ExcludeDirs = @()) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  $rcArgs = @($From, $To, '/E', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  if ($ExcludeDirs.Count -gt 0) { $rcArgs += '/XD'; $rcArgs += $ExcludeDirs }
  $null = & robocopy @rcArgs
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 ($LASTEXITCODE): $From -> $To" }
}

Copy-Tree (Join-Path $SourceDir 'app')    (Join-Path $StageDir 'app')
Copy-Tree (Join-Path $SourceDir 'python') (Join-Path $StageDir 'python')
Write-Ok "基座 = $(Get-DirSizeMB $StageDir) MB"

# 防呆：基座绝不能带上 data/ 或 plugin/（前者是凭证，后者由 CI 每次重建）
foreach ($forbidden in @('data', 'plugin')) {
  $p = Join-Path $StageDir $forbidden
  if (Test-Path $p) {
    Remove-Item $p -Recurse -Force
    Write-Host "    ! 基座里出现 $forbidden/，已剔除" -ForegroundColor DarkYellow
  }
}

# ── 3. 压缩 ─────────────────────────────────────────────────────────────
if (-not $NoZip) {
  Write-Step '压缩为 zip（约 300 MB）'
  $zipPath = Join-Path $OutRoot 'DSAgent-Base.zip'
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  # ★ 用 -Path $StageDir（不带 \*）：基座内部需要保留 app/ 与 python/ 这两层，
  #   assemble-full-from-base.ps1 按这个结构读取。
  Compress-Archive -Path $StageDir -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Ok "zip = $([math]::Round((Get-Item $zipPath).Length/1MB)) MB"
  Write-Host ''
  Write-Host "  文件: $zipPath" -ForegroundColor Cyan
  Write-Host ''
  Write-Host '下一步：把它上传到 tag「base」的 Release，之后 CI 就能自动组装完整包。' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  gh release create base "<上面的路径>" --title "DSAgent 基座（CI 用）" --notes "CI 组装完整包用的运行时基座。"' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '注意：assemble-full-from-base.ps1 会把多包的一层自动拉平，' -ForegroundColor DarkGray
  Write-Host '      所以这里保留 DSAgent-Base/ 这一层是安全的。' -ForegroundColor DarkGray
}
