<#
.SYNOPSIS
  生成「增量更新包」——只含会变的部分（插件代码 + 技能），体积约 10 MB 级。

.DESCRIPTION
  为什么需要：
    完整绿色包 538 MB，但其中 934 MB 的 DSH 程序与 483 MB 的 Python 极少变动。
    git 更新后真正变化的只有 plugin/lib（2 MB）与 plugin/skills（9 MB）。
    每次重发全量包纯属浪费带宽，对方下载也慢。

  本脚本产出 DSAgent-Update-<commit>.zip，结构与绿色包一致（根下就是 plugin/），
  对方**解压覆盖**到绿色包目录即可，data/（账号、会话）不受影响。

  用法：
    pwsh -File dev/portable/build-update.ps1
    pwsh -File dev/portable/build-update.ps1 -Full   # 连 node_modules 一起（依赖有变时）

.PARAMETER Full
  包含 plugin/node_modules（puppeteer-core 等）。仅当 package.json 的依赖变化时才需要。

.PARAMETER OutRoot
  输出目录，默认 %USERPROFILE%\DSAgent-Portable-build

.EXAMPLE
  pwsh -File dev/portable/build-update.ps1
#>
[CmdletBinding()]
param(
  [string]$OutRoot,
  [switch]$Full
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
if (-not $OutRoot) { $OutRoot = Join-Path $env:USERPROFILE 'DSAgent-Portable-build' }

Write-Host ''
Write-Host '=== 生成增量更新包 ===' -ForegroundColor Cyan
Write-Host "仓库: $RepoRoot"
Write-Host ''

function Write-Step([string]$T) { Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok([string]$T)   { Write-Host "    OK $T" -ForegroundColor Green }

function Get-DirSizeMB([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  $sum = (Get-ChildItem $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [math]::Round($sum / 1MB, 1)
}

# ── 1. 前置检查：必须有构建产物 ─────────────────────────────────────────
Write-Step '检查构建产物'
$clientJs = Join-Path $RepoRoot 'lib\client.js'
$hostJs   = Join-Path $RepoRoot 'lib\index.js'
if (-not (Test-Path $clientJs) -or -not (Test-Path $hostJs)) {
  throw "缺少构建产物，请先运行: npm run build"
}
$clientSize = (Get-Item $clientJs).Length
if ($clientSize -lt 50000) {
  throw "lib/client.js 仅 $clientSize 字节（疑似被 tsc 覆盖成裸源码），请重新: npm run build"
}
Write-Ok "lib/client.js $([math]::Round($clientSize/1KB)) KB、lib/index.js 就绪"

# ── 2. 组装临时目录（镜像绿色包结构）───────────────────────────────────
$stage = Join-Path $env:TEMP ("dsagent-update-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$stagePlugin = Join-Path $stage 'plugin'
New-Item -ItemType Directory -Force -Path $stagePlugin | Out-Null

Write-Step '收集更新内容'

# plugin/lib —— 每次都变（代码）
Copy-Item (Join-Path $RepoRoot 'lib') (Join-Path $stagePlugin 'lib') -Recurse -Force
Write-Ok "plugin/lib      $(Get-DirSizeMB (Join-Path $stagePlugin 'lib')) MB"

# plugin/skills —— 常变（技能）
Copy-Item (Join-Path $RepoRoot 'skills') (Join-Path $stagePlugin 'skills') -Recurse -Force
# 清掉字节码缓存，避免把本机解释器版本的 .pyc 带到对方机器
Get-ChildItem (Join-Path $stagePlugin 'skills') -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Ok "plugin/skills   $(Get-DirSizeMB (Join-Path $stagePlugin 'skills')) MB"

# 清单与配置
foreach ($f in @('package.json', 'cordis.patch.yml')) {
  $src = Join-Path $RepoRoot $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $stagePlugin $f) -Force }
}
Write-Ok 'package.json / cordis.patch.yml'

# node_modules（仅 -Full 时）
if ($Full) {
  $nm = Join-Path $RepoRoot 'node_modules'
  if (Test-Path $nm) {
    Write-Step '拷贝 node_modules（-Full，较慢）'
    Copy-Item $nm (Join-Path $stagePlugin 'node_modules') -Recurse -Force
    Write-Ok "plugin/node_modules $(Get-DirSizeMB (Join-Path $stagePlugin 'node_modules')) MB"
  }
} else {
  Write-Host '    （未含 node_modules；若 package.json 依赖有变，请加 -Full 重新生成）' -ForegroundColor DarkYellow
}

# ── 3. 版本信息 ─────────────────────────────────────────────────────────
$commit = 'unknown'
try { $commit = (& git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch {}
$commitTime = ''
try { $commitTime = (& git -C $RepoRoot log -1 --format=%ci 2>$null) } catch {}

$info = [ordered]@{
  kind         = 'incremental-update'
  builtAt      = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  gitCommit    = $commit
  commitTime   = $commitTime
  includesNodeModules = [bool]$Full
  contents     = @('plugin/lib', 'plugin/skills', 'plugin/package.json', 'plugin/cordis.patch.yml')
  sizeMB       = (Get-DirSizeMB $stage)
}
$info | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $stage 'update-info.json') -Encoding UTF8

# ── 4. 附一份给对方看的更新说明 ─────────────────────────────────────────
$readme = @"
# DSAgent 更新包（$commit）

这是**增量更新**，不是完整安装包。只包含插件代码与技能，不含 DSH 程序与 Python。

## 怎么用（三步）

1. 右键本压缩包 → **解压到** 你原来的绿色包目录
   （即包含 `启动 DSAgent.cmd`、`app`、`python`、`plugin` 的那个目录）

2. 提示「是否替换现有文件」→ 选 **全部替换**

3. 重新双击 `启动 DSAgent.cmd`

## 注意

- **`data` 目录不会被覆盖**，你的账号登录态和会话记录都保留。
- 更新前请先**关闭**正在运行的 DSAgent（否则文件被占用会替换失败）。
- 如果启动异常，说明本次更新需要新的依赖：请向发布者索取**完整包**，或
  在包目录内执行：
  ```
  .\python\python.exe -m pip install --target .\python\Lib\site-packages -i https://pypi.tuna.tsinghua.edu.cn/simple <缺失的包名>
  ```

## 本次更新内容

- 插件代码：`plugin/lib`（账号连接页、技能市场页、全部工具）
- 技能：`plugin/skills`（共 $((Get-ChildItem (Join-Path $stagePlugin 'skills') -Directory -ErrorAction SilentlyContinue).Count) 个技能目录）
- 版本：git $commit$(if ($commitTime) { "（$commitTime）" } else { '' })
"@
Set-Content -Path (Join-Path $stage '更新说明.md') -Value $readme -Encoding UTF8
Write-Ok '更新说明.md / update-info.json'

# ── 5. 压缩 ─────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null
$zipName = "DSAgent-Update-$commit.zip"
$zipPath = Join-Path $OutRoot $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Step '压缩'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
$zipMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)

# 清理临时目录
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

# ── 完成 ────────────────────────────────────────────────────────────────
$fullZip = Join-Path $OutRoot 'DSAgent-Portable.zip'
$fullMB = if (Test-Path $fullZip) { [math]::Round((Get-Item $fullZip).Length / 1MB) } else { 0 }

Write-Host ''
Write-Host '=== 完成 ===' -ForegroundColor Cyan
Write-Host "  更新包: $zipPath"
Write-Host "  体积  : $zipMB MB"
if ($fullMB -gt 0) {
  Write-Host "  对比  : 完整包 $fullMB MB → 省 $([math]::Round((1 - $zipMB / $fullMB) * 100))%"
}
Write-Host ''
Write-Host '发给对方后，对方解压覆盖到绿色包目录、重启即可。' -ForegroundColor Yellow
Write-Host '（data/ 账号与会话不受影响）'
Write-Host ''
