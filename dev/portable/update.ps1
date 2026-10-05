<#
.SYNOPSIS
  一键更新 DSAgent 绿色版（从 GitHub 拉取最新技能与插件代码）。

.DESCRIPTION
  放在绿色包目录内，对方双击「更新.cmd」即可。它会：
    1. 读本地版本（build-info.json 的 gitCommit）
    2. 查 GitHub 最新 commit
    3. 若无更新 → 提示已是最新
    4. 有更新 → 下载源码 zip（约 3 MB）→ 同步 skills/
                 并用**包内自带的工具链**重新编译 lib/（插件代码）
    5. 更新 build-info.json

  ★ 版本检查为什么不用 GitHub REST API：
    实测匿名调用 api.github.com 每小时仅 60 次，连续更新几次就被
    403 rate limit 挡住 —— 对用户就是「更新时好时坏」。
    改用 Git 智能协议的 info/refs 端点（git ls-remote 底层走的就是它），
    匿名可读且没有那种限流；备选 commits.atom。

  ★ 为什么能自重建插件代码：
    GitHub 的源码 zip 里没有 lib/（编译产物在 .gitignore）。
    但绿色包在打包时特意补入了 node.exe + typescript + esbuild，
    所以可以直接在对方机器上编译 —— 真正做到代码与技能一起更新。
    编译失败时会保留原 lib/，绝不把坏产物推给对方。

  ★ data/ 目录绝不被触碰：账号、会话、配置全部保留。
  ★ 技能同步采用「只增不删」：上游没有的本地技能不会被删除。
    （曾用 robocopy /MIR 镜像，实测一次误删了 9 个本地新增技能。）

.PARAMETER Repo
  GitHub 仓库，默认 zhoushu44/DSAgent-Plugin

.PARAMETER Branch
  源码分支，默认 main

.PARAMETER Check
  只检查是否有更新，不下载、不修改。

.PARAMETER Force
  即便版本相同也重新同步（用于修复被改坏的文件）。

.EXAMPLE
  pwsh -File update.ps1
  pwsh -File update.ps1 -Check
#>
[CmdletBinding()]
param(
  [string]$Repo = 'zhoushu44/DSAgent-Plugin',
  [string]$Branch = 'main',
  [switch]$Check,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PkgRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginDir = Join-Path $PkgRoot 'plugin'
$InfoPath = Join-Path $PkgRoot 'build-info.json'

function Say([string]$t, [string]$c = 'Gray') { Write-Host "  $t" -ForegroundColor $c }

Write-Host ''
Write-Host '  DSAgent 更新' -ForegroundColor Cyan
Write-Host "  位置: $PkgRoot"
Write-Host ''

# ── 1. 本地版本 ─────────────────────────────────────────────────────────
$localCommit = 'unknown'
$localTime = ''
if (Test-Path $InfoPath) {
  try {
    $info = Get-Content $InfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $localCommit = $info.gitCommit
    $localTime = $info.commitTime
    # 兼容旧版包（没有 commitTime 字段）：退化为用 builtAt 估算
    if (-not $localTime -and $info.builtAt) { $localTime = $info.builtAt }
  } catch {}
}
Say "本地版本: $localCommit$(if ($localTime) { "  ($localTime)" })"

# ── 2. 远端最新 commit ──────────────────────────────────────────────────
#
# ★ 不用 GitHub REST API（api.github.com）。
#   实测匿名调用每小时仅 60 次，连续更新几次就被 403 rate limit 挡住 ——
#   对最终用户来说就是「更新功能时好时坏」，不可接受。
#
# 改用 Git 智能协议的 info/refs 端点（git ls-remote 底层走的就是它）：
#   · 公开仓库匿名可读，且**没有那种限流**
#   · 返回 pkt-line 文本，其中含 refs/heads/<branch> 的完整 sha
#   · 拿不到 commit message，但版本判断只需要 sha
# 备选：commits.atom（Atom feed），同样无限流，可拿到时间。
Say '正在检查更新…'

function Get-RemoteCommit([string]$repo, [string]$branch) {
  # A. Git info/refs（首选）
  try {
    $url = "https://github.com/$repo.git/info/refs?service=git-upload-pack"
    $raw = (Invoke-WebRequest -Uri $url -TimeoutSec 25 -UseBasicParsing -Headers @{
      'User-Agent' = 'dsagent-portable-updater'
    }).Content
    # pkt-line：<4位十六进制长度><内容>；找 refs/heads/<branch> 前的 40 位 sha
    $m = [regex]::Match($raw, "([0-9a-f]{40})\s+refs/heads/$([regex]::Escape($branch))\b")
    if ($m.Success) { return $m.Groups[1].Value.Substring(0, 7) }
    # 兜底：HEAD 的 sha（浅克隆或分支名为默认分支时的形态）
    $m2 = [regex]::Match($raw, "([0-9a-f]{40})\s+HEAD")
    if ($m2.Success) { return $m2.Groups[1].Value.Substring(0, 7) }
  } catch { }

  # B. Atom feed（备选）
  try {
    $feed = (Invoke-WebRequest -Uri "https://github.com/$repo/commits/$branch.atom" `
              -TimeoutSec 25 -UseBasicParsing -Headers @{ 'User-Agent' = 'dsagent-portable-updater' }).Content
    $m = [regex]::Match($feed, '<id>tag:github\.com,2008:Grit::Commit/([0-9a-f]{40})</id>')
    if ($m.Success) { return $m.Groups[1].Value.Substring(0, 7) }
  } catch { }

  return $null
}

function Get-RemoteCommitDate([string]$repo, [string]$branch) {
  try {
    $feed = (Invoke-WebRequest -Uri "https://github.com/$repo/commits/$branch.atom" `
              -TimeoutSec 20 -UseBasicParsing -Headers @{ 'User-Agent' = 'dsagent-portable-updater' }).Content
    $m = [regex]::Match($feed, '<updated>([^<]+)</updated>')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  return ''
}

$remoteCommit = Get-RemoteCommit $Repo $Branch
$remoteDate = ''
$remoteMsg = ''
if (-not $remoteCommit) {
  Say '无法连接 GitHub（网络不通或被拦截）' 'Yellow'
  Say '跳过更新检查，按原样启动。' 'Yellow'
  if (-not $Check) { exit 0 } else { exit 1 }
} else {
  $remoteDate = Get-RemoteCommitDate $Repo $Branch
  Say "远端版本: $remoteCommit$(if ($remoteDate) { "  ($remoteDate)" })"
}

# ── 3. 是否需要更新 ─────────────────────────────────────────────────────
#
# ★ 不能只比 sha！发布者本地可能存在**尚未推送**的提交 —— 此时远端 sha
#   与本地不同，但远端其实更旧；直接更新会造成「降级」（把新功能覆盖掉）。
#   实测踩过：本地 a8cb29b（含未推送修复）被判定为「有新版本 86ebccb」，
#   而 86ebccb 其实是更早的提交。
#
#   因此以**提交时间**为准：
#     · 本地时间 >= 远端时间  → 已是最新（或本地更新），不更新
#     · 本地时间 <  远端时间  → 远端确有新提交，执行更新
#   sha 相同则直接判定最新（最快路径）。
$needUpdate = $true
$reason = ''

if ($remoteCommit -eq $localCommit) {
  $needUpdate = $false
  $reason = '版本号一致'
}
elseif ($localTime -and $remoteDate -and -not $Force) {
  try {
    $lt = [datetime]::Parse($localTime).ToUniversalTime()
    $rt = [datetime]::Parse($remoteDate).ToUniversalTime()
    if ($lt -ge $rt) {
      $needUpdate = $false
      # 显示成本地时间，避免用户看到 UTC 时刻而困惑
      $reason = "本地提交($($lt.ToLocalTime().ToString('yyyy-MM-dd HH:mm')))不早于远端($($rt.ToLocalTime().ToString('yyyy-MM-dd HH:mm')))，本地可能含未推送的更新"
    }
  } catch {
    # 时间解析失败则保守起见继续更新（与旧行为一致）
  }
}

if (-not $needUpdate -and -not $Force) {
  Write-Host ''
  Say '已经是最新版本，无需更新。' 'Green'
  if ($reason) { Say $reason 'DarkGray' }
  Write-Host ''
  exit 0
}

if ($Check) {
  Write-Host ''
  Say "有新版本可用：$localCommit → $remoteCommit" 'Yellow'
  Write-Host ''
  exit 0
}

# ── 4. 下载源码 zip ─────────────────────────────────────────────────────
Write-Host ''
Say '正在下载更新包…'
$zipUrl = "https://codeload.github.com/$Repo/zip/refs/heads/$Branch"
$tmpRoot = Join-Path $env:TEMP ("dsagent-update-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
$zipPath = Join-Path $tmpRoot 'src.zip'

try {
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'dsagent-portable-updater')
  $wc.DownloadFile($zipUrl, $zipPath)
  $mb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
  Say "已下载 $mb MB" 'Green'
} catch {
  Say "下载失败：$($_.Exception.Message)" 'Red'
  Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

Say '正在解压…'
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tmpRoot -Force
} catch {
  Say "解压失败：$($_.Exception.Message)" 'Red'
  Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

# zip 内是 <repo>-<branch>/ 形式
$srcDir = Get-ChildItem $tmpRoot -Directory | Select-Object -First 1
if (-not $srcDir) {
  Say '压缩包结构异常，找不到源码目录' 'Red'
  Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}
Say "源码目录: $($srcDir.Name)"

# ── 5. 备份 → 同步 ──────────────────────────────────────────────────────
Write-Host ''
Say '正在应用更新…'

$backupDir = Join-Path $PkgRoot ("backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$updated = @()

# 5.1 技能（日常更新的主体，总是在 git 里）
$srcSkills = Join-Path $srcDir.FullName 'skills'
$dstSkills = Join-Path $PluginDir 'skills'
if (Test-Path $srcSkills) {
  if (Test-Path $dstSkills) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item $dstSkills (Join-Path $backupDir 'skills') -Recurse -Force
  }
  # 清掉字节码缓存，避免带上本机解释器版本的 .pyc
  Get-ChildItem $srcSkills -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  # ★ 用「只增不删」的合并策略，绝不用 robocopy /MIR。
  #
  #   实测教训（2026-10-04）：/MIR 是镜像模式，会把目标端多出来的内容**删掉**。
  #   绿色包里的 skills/ 可能比 GitHub 上的更新（发布者本地新增但尚未 push 的技能，
  #   实测一次就删掉了 9 个：customer-ltv-calculator、marketing-ideas 等），
  #   /MIR 直接把它们抹掉了。更新器绝不能删用户已有的东西。
  #
  #   改为：逐目录覆盖 —— 上游有的就更新/新增，上游没有的保持原样。
  #   这样既能拿到新技能与新改动，又不会误删本地独有的技能。
  $copied = 0
  $added = 0
  Get-ChildItem $srcSkills -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $target = Join-Path $dstSkills $_.Name
    $isNew = -not (Test-Path $target)
    Copy-Item $_.FullName $target -Recurse -Force
    $copied++
    if ($isNew) { $added++ }
  }
  # 上游根目录下的零散文件（如有）也同步
  Get-ChildItem $srcSkills -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $dstSkills $_.Name) -Force
  }
  # 清掉同步进来的字节码缓存
  Get-ChildItem $dstSkills -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  $n = (Get-ChildItem $dstSkills -Directory -ErrorAction SilentlyContinue).Count
  if ($added -gt 0) { Say "技能已同步（覆盖 $copied 个，新增 $added 个，共 $n 个）" 'Green' }
  else { Say "技能已同步（覆盖 $copied 个，共 $n 个，无新增）" 'Green' }
  $updated += 'skills'
} else {
  Say '源码包里没有 skills/，跳过' 'Yellow'
}

# 5.2 插件代码：优先用源码包里的 lib/；没有则**用包内工具链自重建**
#
# 背景：lib/ 是编译产物，默认不进 git，所以 codeload 的 zip 里没有它。
# 但绿色包自带 node.exe + typescript + esbuild（打包时特意补入），
# 因此可以在对方机器上直接编译 —— 真正做到「双击更新，代码+技能一起更新」。
$srcLib = Join-Path $srcDir.FullName 'lib'
$dstLib = Join-Path $PluginDir 'lib'
$appModules = Join-Path $PkgRoot 'app\resources\app.asar.unpacked\node_modules'
$nodeExe = Join-Path $appModules 'node\bin\node.exe'
$tscJs = Join-Path $appModules 'typescript\lib\tsc.js'
$esbuildExe = Join-Path $appModules '@esbuild\win32-x64\esbuild.exe'

if (Test-Path (Join-Path $srcLib 'index.js')) {
  # 源码包直接带了 lib/（发布者选择把产物一起提交时）
  if (Test-Path $dstLib) {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item $dstLib (Join-Path $backupDir 'lib') -Recurse -Force
  }
  $null = & robocopy $srcLib $dstLib /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1
  if ($LASTEXITCODE -lt 8) { Say '插件代码已同步（源码包自带 lib/）' 'Green'; $updated += 'lib' }
  else { Say "插件代码同步失败（robocopy $LASTEXITCODE）" 'Red' }
}
elseif ((Test-Path $nodeExe) -and (Test-Path $tscJs) -and (Test-Path $esbuildExe)) {
  Say '源码包不含 lib/，使用包内工具链自行编译…'
  $buildTmp = Join-Path $env:TEMP ("dsagent-rebuild-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $buildTmp | Out-Null

  try {
    # 把编译所需的源码与配置铺到临时目录
    foreach ($d in @('src', 'dev')) {
      $s = Join-Path $srcDir.FullName $d
      if (Test-Path $s) { Copy-Item $s (Join-Path $buildTmp $d) -Recurse -Force }
    }
    foreach ($f in @('tsconfig.json', 'package.json')) {
      $s = Join-Path $srcDir.FullName $f
      if (Test-Path $s) { Copy-Item $s (Join-Path $buildTmp $f) -Force }
    }
    # 让编译期能解析 @deepseek-ai/* 类型：借用包内的 node_modules
    $linked = $false
    try {
      New-Item -ItemType Junction -Path (Join-Path $buildTmp 'node_modules') -Target $appModules -ErrorAction Stop | Out-Null
      $linked = $true
    } catch { Write-Host "    (类型解析链接失败，编译仍可进行)" -ForegroundColor DarkGray }

    # 5.2.1 host 半区：tsc 编译 src/ → lib/
    $hostOk = $false
    Push-Location $buildTmp
    try {
      & $nodeExe $tscJs -p (Join-Path $buildTmp 'tsconfig.json') 2>&1 |
        Select-Object -Last 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
      $hostOk = Test-Path (Join-Path $buildTmp 'lib\index.js')
    } finally { Pop-Location }

    # 5.2.2 browser 半区：esbuild 打包 src/client.ts → lib/client.js
    $clientOk = $false
    if ($hostOk) {
      $stub = Join-Path $buildTmp 'dev\node-stub.js'
      $stubSlash = $stub -replace '\\', '/'
      $clientOut = Join-Path $buildTmp 'lib\client.raw.js'
      $esArgs = @(
        (Join-Path $buildTmp 'src\client.ts'),
        '--bundle', '--format=cjs', '--target=es2022', '--platform=browser',
        '--external:react', '--legal-comments=none',
        "--alias:node:fs/promises=$stubSlash", "--alias:node:fs=$stubSlash",
        "--alias:node:path=$stubSlash", "--alias:node:crypto=$stubSlash",
        "--alias:node:child_process=$stubSlash", "--alias:node:os=$stubSlash",
        "--alias:node:url=$stubSlash",
        "--outfile=$clientOut", '--log-level=error'
      )
      & $esbuildExe @esArgs 2>&1 | Select-Object -Last 5 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }

      if (Test-Path $clientOut) {
        # 套上 DSH ModuleLoader 工厂外壳（与 dev/build-client.mjs 的 BANNER/FOOTER 一致）
        $banner = "window.__ModuleLoader__.load({`n`tid: `"@dsagent/dsagent-plugin`",`n`tfactory: (require) => {`n`t`tvar module = { exports: {} };`n`t`tvar exports = module.exports;`n`t`tObject.defineProperty(exports, Symbol.toStringTag, { value: `"Module`" });`n`t`tlet react = require(`"react`");`n`t`tvar React = react;`n"
        $footer = "`n`t`treturn module.exports;`n`t}`n});`n"
        $body = Get-Content $clientOut -Raw -Encoding UTF8
        Set-Content -Path (Join-Path $buildTmp 'lib\client.js') -Value ($banner + $body + $footer) -Encoding UTF8 -NoNewline
        $built = Get-Content (Join-Path $buildTmp 'lib\client.js') -Raw -Encoding UTF8
        $clientOk = $built.StartsWith('window.__ModuleLoader__.load(') -and $built.Contains('id: "@dsagent/dsagent-plugin"')
      }
    }

    # 5.2.3 校验通过才替换（失败则保留旧版，绝不把坏产物推给对方）
    if ($hostOk -and $clientOk) {
      if (Test-Path $dstLib) {
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        Copy-Item $dstLib (Join-Path $backupDir 'lib') -Recurse -Force
      }
      New-Item -ItemType Directory -Force -Path $dstLib | Out-Null
      Copy-Item (Join-Path $buildTmp 'lib\*.js') $dstLib -Force
      Copy-Item (Join-Path $buildTmp 'lib\*.d.ts') $dstLib -Force -ErrorAction SilentlyContinue
      Say '插件代码已重建（host + browser 双半区）' 'Green'
      $updated += 'lib(重建)'
    } else {
      Say "编译未通过（host=$hostOk browser=$clientOk），保留原插件代码" 'Yellow'
      Say '技能已更新；插件代码请向发布者索取增量包。' 'Yellow'
    }
  } catch {
    Say "编译过程出错：$($_.Exception.Message)" 'Yellow'
    Say '保留原插件代码，技能更新不受影响。' 'Yellow'
  } finally {
    Remove-Item $buildTmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
else {
  Say '源码包不含 lib/，且包内缺少编译工具链 —— 插件代码保持原样' 'Yellow'
  Say '提示：若本次更新包含插件代码修复，请向发布者索取增量包。' 'Yellow'
}

# 5.3 package.json / cordis.patch.yml
foreach ($f in @('package.json', 'cordis.patch.yml')) {
  $s = Join-Path $srcDir.FullName $f
  if (Test-Path $s) { Copy-Item $s (Join-Path $PluginDir $f) -Force }
}

# ── 6. 记录版本 ─────────────────────────────────────────────────────────
$info = [ordered]@{
  builtAt     = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  gitCommit   = $remoteCommit
  commitTime  = $remoteDate
  updatedFrom = $localCommit
  updatedAt   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}
$info | ConvertTo-Json -Depth 3 | Set-Content $InfoPath -Encoding UTF8

Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue

# ── 完成 ────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  更新完成' -ForegroundColor Green
Say "$localCommit → $remoteCommit"
Say "已更新: $($updated -join ', ')"
if (Test-Path $backupDir) {
  Say "旧版本已备份到: $(Split-Path $backupDir -Leaf)" 'DarkGray'
  Say '（确认新版本正常后可删除该目录）' 'DarkGray'
}
Write-Host ''
Say '重新双击「启动 DSAgent.cmd」即可使用新版本。' 'Cyan'
Write-Host ''
