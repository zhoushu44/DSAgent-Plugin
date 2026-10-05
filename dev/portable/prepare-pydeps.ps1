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

if (-not $PkgDir) { $PkgDir = Join-Path $env:USERPROFILE 'DSAgent-Portable-build\DSAgent-Portable' }

# 与 build-portable.ps1 保持一致：产物绝不能放在仓库内，否则 DSH Desktop 的
# 插件 profile 迁移会扫到 app.asar 并判定 Invalid package，导致迁移失败、
# 插件被固定到旧快照（表现为「插件 UI 不显示，重构建也不生效」）。
$repoCheck = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
if ((Resolve-Path $PkgDir -ErrorAction SilentlyContinue).Path -like "$repoCheck*") {
  throw "包目录不能位于仓库内：$PkgDir`n请改用仓库外路径（默认已改为用户目录）。"
}

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

# ── 3. pip 自检（不升级）────────────────────────────────────────────────
# ★ 不要 `pip install --upgrade pip`：实测它会长时间卡住（自升级要解析自身
#   依赖并重装，在网络受限/镜像不稳时几乎不返回），且对本包毫无必要 ——
#   包内 pip 25.3 足以安装下面这些包。
#   改为只确认 pip 可用，坏了才尝试修复。
Write-Step '检查包内 pip'
$pipOk = $false
try {
  $v = & $PyExe -m pip --version 2>&1
  if ($LASTEXITCODE -eq 0) { Write-Ok ($v -join ' '); $pipOk = $true }
} catch {}
if (-not $pipOk) {
  Write-Host '    ! 包内 pip 不可用，尝试用 ensurepip 修复' -ForegroundColor DarkYellow
  & $PyExe -m ensurepip --default-pip 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) { throw 'pip 不可用且修复失败，无法安装依赖' }
  Write-Ok 'pip 已修复'
}

# ── 4. 安装依赖 ─────────────────────────────────────────────────────────
Write-Step "安装依赖（约 400 MB，视网速需几分钟）"

# 用 -t 直接装到包内 site-packages：
#   - 不依赖 --user / --target 的 sys.path 差异
#   - 保证启动器设的 PYTHONPATH 一定能 import 到
#
# ★ 一次性批量安装（不是逐个装）：
#   逐个装会让 pip 对每个包各解析一次依赖树，重复下载、重复检查，
#   实测在 akshare 这种长依赖链上极慢（单个包几分钟）。批量装交给 pip
#   一次算完整闭包，快得多且不会重复。
$sitePkgs = Join-Path $PkgDir 'python\Lib\site-packages'
New-Item -ItemType Directory -Force -Path $sitePkgs | Out-Null

$failed = @()
$out = & $PyExe -m pip install --upgrade --target $sitePkgs --index-url $IndexUrl `
                --disable-pip-version-check --no-warn-script-location `
                --upgrade-strategy only-if-needed @reqLines 2>&1
$out | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
if ($LASTEXITCODE -ne 0) {
  Write-Host '    ! 批量安装未全部成功，尝试逐个补装失败项' -ForegroundColor DarkYellow
  # 从输出里挑出失败的包逐个重试，尽量救回
  foreach ($pkg in $reqLines) {
    $probeName = ($pkg -replace 'beautifulsoup4', 'bs4' -replace 'Pillow', 'PIL' `
                      -replace 'PyYAML', 'yaml' -replace 'python-docx', 'docx' `
                      -replace 'python-pptx', 'pptx' -replace '-', '_')
    $check = & $PyExe -c "import importlib,sys; sys.path.insert(0,r'$sitePkgs'); importlib.import_module('$probeName')" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Host "    · 补装 $pkg" -ForegroundColor DarkGray
      $r2 = & $PyExe -m pip install --target $sitePkgs --index-url $IndexUrl `
                     --disable-pip-version-check --no-warn-script-location $pkg 2>&1
      if ($LASTEXITCODE -ne 0) { $failed += $pkg; $r2 | Select-Object -Last 2 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkRed } }
    }
  }
}

# ── 5. 验证 ─────────────────────────────────────────────────────────────
Write-Step '验证依赖可导入'

# ★ 探测列表由 py-requirements.txt 生成，不硬编码。
#   曾经硬编码过一份，结果清单里删掉 akshare/matplotlib/pywencai 后，
#   这里仍按旧列表检查，报出「MISSING=matplotlib,pywencai,akshare」的假警报。
#   改为从清单推导 import 名，保证「装什么」与「验什么」永远一致。
$importAlias = @{
  'beautifulsoup4' = 'bs4'
  'Pillow'         = 'PIL'
  'PyYAML'         = 'yaml'
  'python-docx'    = 'docx'
  'python-pptx'    = 'pptx'
  'pdfminer.six'   = 'pdfminer'
}
$probeMods = $reqLines | ForEach-Object {
  if ($importAlias.ContainsKey($_)) { $importAlias[$_] } else { $_ }
}
$modList = ($probeMods | ForEach-Object { "'$_'" }) -join ','
$probe = @"
mods = [$modList]
ok, bad = [], []
for m in mods:
    try:
        __import__(m); ok.append(m)
    except Exception:
        bad.append(m)
print('OK=%d/%d' % (len(ok), len(mods)))
print('MISSING=' + (','.join(bad) if bad else '(none)'))
"@

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
