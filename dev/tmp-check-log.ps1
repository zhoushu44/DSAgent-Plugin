$log = 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs\harness.log'
Write-Output "=== log mtime: $((Get-Item $log).LastWriteTime) ==="
Write-Output '=== last 15 lines ==='
Get-Content $log -Tail 15
Write-Output '=== any login/browser_login/pdd lines today ==='
$today = (Get-Date).ToString('yyyy-MM-dd')
Get-Content $log | Where-Object { $_ -match $today -and $_ -match 'login|browser_login|pdd_mms|扫码|dsagent-login' } | Select-Object -Last 20
