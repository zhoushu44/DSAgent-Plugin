Write-Output '=== 当前浏览器页 URL ==='
$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
$tabs | Where-Object { $_.url -match 'pinduoduo' -and $_.type -eq 'page' } | ForEach-Object { Write-Output $_.url }
Write-Output '=== cred file mtime ==='
(Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime
