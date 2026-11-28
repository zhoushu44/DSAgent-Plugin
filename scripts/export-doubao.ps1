# 导出引擎到 doubao\engine\（post-commit 钩子自动跑；也可手动）
# 规矩：doubao\engine\ 是发布物，不手改——引擎源在 skills\_shared + lib + skills\pdd-publish + skills\pdd-crawl
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path          # ...\DSAgent-Plugin\scripts
$plugin = Split-Path -Parent $here                                # ...\DSAgent-Plugin
$db = Join-Path $plugin 'doubao\engine'
New-Item -ItemType Directory -Path $db -Force | Out-Null

# 闭包清单（唯一定义）：
$copyMap = @(
  @{ src = 'skills\_shared\pdd-launch.mjs';        dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-antiban.mjs';       dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-risk.mjs';          dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-antistring.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-captcha-gate.mjs';  dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-slider-solver.mjs'; dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-fingerprint.mjs';   dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-env-profile.mjs';   dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-profile-map.mjs';   dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-account-pick.mjs';  dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-proc-clean.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-error.mjs';         dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-seed-store.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-seed-auto.mjs';     dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-vodka-signer.mjs';  dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-risksdk.mjs';       dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-sign.mjs';          dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-transport.mjs';     dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-guard.mjs';         dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-token-refresh.mjs'; dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-http.mjs';          dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-request.mjs';       dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-client.mjs';        dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-api.mjs';           dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-sign-scope.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-missing-apis.mjs';  dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-goods-full.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-cdp-harvest.mjs';   dst = '_shared\' },
  @{ src = 'skills\_shared\pdd-native-ize.mjs';    dst = '_shared\' },
  @{ src = 'skills\_shared\cookie-clean.mjs';      dst = '_shared\' },
  @{ src = 'skills\_shared\terminate-guard.mjs';   dst = '_shared\' },
  @{ src = 'skills\_shared\check-pdd-guard.mjs';   dst = '_shared\' },
  @{ src = 'lib\pdd-crawl.js';                     dst = 'pdd\' },
  @{ src = 'lib\pdd-captcha.js';                   dst = 'pdd\' },
  @{ src = 'lib\pdd-mode2.js';                     dst = 'pdd\' },
  @{ src = 'lib\pdd-image-space.js';               dst = 'pdd\' },
  @{ src = 'lib\services\*.js';                    dst = 'pdd\services\' }
)
# 淘宝引擎源：单文件直出（保持测试目录为真源，这里是镜像——等合并进 src 后改这里）
$tbSrc = 'E:\360MoveData\Users\Administrator\Desktop\童装\淘宝多类目测试\engine-fix'

$n = 0
foreach ($m in $copyMap) {
  $s = Join-Path $plugin $m.src
  if (Test-Path -LiteralPath $s) { $d = Join-Path $db $m.dst; New-Item -ItemType Directory -Path $d -Force | Out-Null; Copy-Item -LiteralPath $s -Destination $d -Recurse -Force; $n++ }
}
# 淘宝三件套
foreach ($f in 'lib.cjs','submit-batch.cjs','img-space.cjs') { if (Test-Path -LiteralPath "$tbSrc\$f") { Copy-Item -LiteralPath "$tbSrc\$f" -Destination $db -Force; $n++ } }
# test-images（素材图）
if (Test-Path -LiteralPath $tbSrc\test-images) { New-Item -ItemType Directory -Path $db\test-images -Force | Out-Null; Copy-Item -LiteralPath $tbSrc\test-images\* -Destination $db\test-images -Force }
# puppeteer-core 及运行时依赖（增量 robocopy，快）
$nm = Get-ChildItem -LiteralPath (Join-Path $plugin 'node_modules') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(puppeteer-core|@puppeteer|debug|chromium-bidi|devtools-protocol|typed-query-selector|ws|semver|tar-fs|proxy-agent|extract-zip|progress|unbzip2-stream|yargs|cliui|ms|proxy-from-env|get-stream|pump|buffer-crc32|tar-stream|streamx|events-universal|text-decoder|through|yauzl|fd-slicer|fs-extra|jsonfile|graceful-fs|universalify|klaw|minimist|mkdirp|readable-stream|string_decoder|safe-buffer|core-util-is|isarray|process-nextick-args|util-deprecate|inherits|once|wrappy|end-of-stream|bl|buffer)' }
foreach ($d in $nm) { $dst = Join-Path $db "node_modules\$($d.Name)"; if (-not (Test-Path -LiteralPath $dst)) { Copy-Item -LiteralPath $d.FullName -Destination $dst -Recurse -Force; $n++ } }
# skills 兼容 junction（旧路径解析）
if (-not ([IO.Directory]::Exists("$db\skills"))) { try { New-Item -ItemType Junction -Path "$db\skills" -Target $db -ErrorAction Stop | Out-Null } catch {} }
Write-Host "导出完成：$n 项已同步 → doubao\engine\"
