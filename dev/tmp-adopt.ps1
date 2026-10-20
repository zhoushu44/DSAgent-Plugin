$ErrorActionPreference = 'Stop'
$acct = 'C:\Users\Administrator\.dsh\browser-profiles\accounts\pdd_mms_a557a85cfe79fc7311f4e8c2e3727c5b'
$plat = 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms'

# 删掉空壳目标，再整目录复制平台 Profile 过去（含 Default\Network\Cookies 登录态）
if (Test-Path $acct) { Remove-Item $acct -Recurse -Force }
New-Item -ItemType Directory -Path (Split-Path $acct) -Force | Out-Null
Copy-Item $plat $acct -Recurse -Force
Write-Output '=== 收编后核验 ==='
Write-Output ("账号目录 Default/Network/Cookies: " + (Test-Path "$acct\Default\Network\Cookies"))
$size = (Get-ChildItem $acct -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
Write-Output ("账号目录大小: {0:N0} bytes" -f $size)
