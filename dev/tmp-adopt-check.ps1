$acct = 'C:\Users\Administrator\.dsh\browser-profiles\accounts\pdd_mms_a557a85cfe79fc7311f4e8c2e3727c5b'
$plat = 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms'
Write-Output '=== 账号目录（目标，应是空壳）==='
if (Test-Path $acct) { Get-ChildItem $acct -Force | Select-Object Name | Format-Table -AutoSize; Write-Output ("Default/Cookies: " + (Test-Path "$acct\Default\Cookies")); Write-Output ("Default/Network/Cookies: " + (Test-Path "$acct\Default\Network\Cookies")) } else { Write-Output '(不存在)' }
Write-Output '=== 平台目录（源，登录态在这）==='
Write-Output ("Default/Cookies: " + (Test-Path "$plat\Default\Cookies"))
Write-Output ("Default/Network/Cookies: " + (Test-Path "$plat\Default\Network\Cookies"))
# 确认没有浏览器进程占用
Write-Output '=== 占用该 Profile 的 chrome 进程 ==='
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'pdd_mms' }
if ($procs) { $procs | ForEach-Object { Write-Output ("PID {0}: {1}" -f $_.ProcessId, ($_.CommandLine.Substring(0,[Math]::Min(120,$_.CommandLine.Length)))) } } else { Write-Output '(无占用)' }
