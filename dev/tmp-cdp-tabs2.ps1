$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
Write-Output "CDP port: $port"
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
Write-Output '=== 当前所有 page ==='
$tabs | Where-Object { $_.type -eq 'page' } | ForEach-Object { Write-Output $_.url }
