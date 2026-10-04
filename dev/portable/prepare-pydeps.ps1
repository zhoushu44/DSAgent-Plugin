<#
.SYNOPSIS
  把 skills 所需的 Python 依赖预装进「包内 Python」，不污染系统环境。

.DESCRIPTION
  必须在 build-portable.ps1 之后运行（依赖打包好的 python/ 目录）。

  为什么要预装：
    skills/ 下 315 个 .py 依赖 pandas / lxml / openpyxl / pypdf / Pillow 等第三方库。
    对方电脑不一定有 Python，更不会装这些库。本脚本把它们装进包内 Python，
    使技能开箱即用。

  为什么装进包内而不是系统：
    1. 不污染对方环境，删掉目录即彻底卸载
    2. 插件的 resolvePython() 按「能 import 多少个 SKILL_DEPS」给解释器打分，
       包内 Python 命中数最高才会被自动选中（启动器已用 DSAGENT_PYTHON 指定）

.PARAMETER IndexUrl
  pip 镜像源。默认清华源（国内快）。可传官方源 https://pypi.org/simple

.PARAMETER PkgDir
  绿色包目录，默认 dist/DSAgent-Portable

.EXAMPLE
  pwsh -File dev/portable/prepare-pydeps.ps1
  pwsh -File dev/portable/prepare-pydeps.ps1 -IndexUrl https://pypi.org/simple
#>
[CmdletBinding()]
param(
  [string]$IndexUrl = 'https://pypi.tuna.tsinghua.edu.cn/simple',
  [string]$PkgDir,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path

if (-not $PkgDir) { $PkgDir = Join-Path $RepoRoot 'dist\DSAgent-Portable' }

Write-Host ''
Write-Host '=== 预装 Python 依赖到绿色包 ===' -ForegroundColor Cyan
Write-Host "包目录: $PkgDir"
Write-Host "镜像源: $IndexUrl"
Write-Host ''

function Write-Step([string]$T) { Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok([string]$T)   { Write-Host "    OK $T" -ForegroundColor Green }

# ── 1. 检查包与 Python ──────────────────────────────────────────────────
if (-not (Test-Path $PkgDir)) {
  throw "绿色包不存在: $PkgDir`n请先运行: pwsh -File dev/portable/build-portable.ps1"
}

$PyExe = Join-Path $PkgDir 'python\python.exe'
if (-not (Test-Path $PyExe)) {
  throw "包内没有 Python: $PyExe`n说明打包时用了 -SkipPython。请重新打包（不要加该参数）。"
}
Write-Ok "包内 Python: $PyExe"

$ReqFile = Join-Path $ScriptDir 'py-requirements.txt'
if (-not (Test-Path $ReqFile)) {
  throw "缺少依赖清单: $ReqFile`n请先运行: node dev/portable/scan-py-deps.mjs"
}

# ── 2. 依赖清点 ─────────────────────────────────────────────────────────
$reqLines = Get-Content $ReqFile -Encoding UTF8 |
  Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() -ne '' }
Write-Host "  待安装依赖 $($reqLines.Count) 个:" -ForegroundColor DarkGray
Write-Host "    $($reqLines -join ', ')" -ForegroundColor DarkGray
Write-Host ''

# ── 3. 升级 pip（老 pip 装不了部分 wheel）───────────────────────────────
Write-Step '升级包内 pip'
& $PyExe -m pip install --upgrade pip --index-url $IndexUrl --disable-pip-version-check --quiet
if ($LASTEXITCODE -ne 0) { Write-Host '    ! pip 升级失败，继续尝试安装依赖（可能仍可用）' -ForegroundColor DarkYellow }
else { Write-Ok 'pip 已升级' }

# ── 4. 安装依赖 ─────────────────────────────────────────────────────────
Write-Step "安装依赖（约 400 MB，视网速需几分钟）"

# 用 -t 直接装到包内 site-packages：
#   - 不依赖 --user / --target 的 sys.path 差异
#   - 保证启动器设的 PYTHONPATH 一定能 import 到
$sitePkgs = Join-Path $PkgDir 'python\Lib\site-packages'
New-Item -ItemType Directory -Force -Path $sitePkgs | Out-Null

$failed = @()
foreach ($pkg in $reqLines) {
  Write-Host "    · $pkg" -ForegroundColor DarkGray -NoNewline
  $out = & $PyExe -m pip install --upgrade --target $sitePkgs --index-url $IndexUrl `
                  --disable-pip-version-check --no-warn-script-location $pkg 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "`r    OK $pkg" -ForegroundColor Green
  } else {
    Write-Host "`r    !! $pkg 安装失败" -ForegroundColor Red
    $failed += $pkg
    $out | Select-Object -Last 3 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkRed }
  }
}

# ── 5. 验证 ─────────────────────────────────────────────────────────────
Write-Step '验证依赖可导入'

# 与 src/services/skill-service.ts 的 SKILL_DEPS 对应，用于确认包内解释器能拿满分
$probe = @'
mods = ['httpx','requests','bs4','jieba','lxml','markdown','numpy','openpyxl',
        'pandas','PIL','docx','pptx','yaml','matplotlib',
        'pdfplumber','pypdf','pdf2image','defusedxml','pywencai','akshare']
ok, bad = [], []
for m in mods:
    try:
        __import__(m); ok.append(m)
    except Exception:
        bad.append(m)
print('OK=%d/%d' % (len(ok), len(mods)))
print('MISSING=' + (','.join(bad) if bad else '(none)'))
'@

$env:PYTHONPATH = $sitePkgs
$probeOut = $probe | & $PyExe -
$probeOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

# ── 6. 汇总 ─────────────────────────────────────────────────────────────
$totalMB = [math]::Round((Get-ChildItem $sitePkgs -Recurse -File -Force -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum / 1MB, 0)

Write-Host ''
if ($failed.Count -gt 0) {
  Write-Host "=== 完成，但有 $($failed.Count) 个依赖失败 ===" -ForegroundColor Yellow
  Write-Host "  失败: $($failed -join ', ')" -ForegroundColor Yellow
  Write-Host '  对应技能会不可用；可换镜像源重试:' -ForegroundColor Yellow
  Write-Host '    pwsh -File dev/portable/prepare-pydeps.ps1 -IndexUrl https://pypi.org/simple'
} else {
  Write-Host '=== 全部依赖安装完成 ===' -ForegroundColor Cyan
}
Write-Host "  包内 site-packages: $totalMB MB"

# ── 7. 压缩成可分发 zip ─────────────────────────────────────────────────
# 依赖装完之后才压缩，保证 zip 里含依赖（这是 build 脚本不做压缩的原因）。
if (-not $NoZip) {
  Write-Host ''
  Write-Step '压缩为 zip（体积较大，需数分钟）'
  $zipPath = Join-Path (Split-Path $PkgDir -Parent) 'DSAgent-Portable.zip'
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path $PkgDir -DestinationPath $zipPath -CompressionLevel Optimal
  $zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB)
  Write-Ok "zip = $zipMB MB"
  Write-Host ''
  Write-Host '=== 可以分发了 ===' -ForegroundColor Cyan
  Write-Host "  文件: $zipPath"
  Write-Host '  对方: 解压到任意目录 -> 双击「启动 DSAgent.cmd」'
} else {
  Write-Host ''
  Write-Host '已跳过压缩（-NoZip）。需要 zip 时运行:' -ForegroundColor Yellow
  Write-Host '  pwsh -File dev/portable/prepare-pydeps.ps1'
}
Write-Host ''
