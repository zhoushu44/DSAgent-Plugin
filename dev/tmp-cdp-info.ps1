# 通过 CDP 在拼多多登录页点「账号登录」Tab，dump 表单结构
$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
$page = $tabs | Where-Object { $_.url -match 'mms.pinduoduo.com' -and $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { Write-Output 'pdd tab not found'; exit }
Write-Output "tab: $($page.id)  url: $($page.url)"
Write-Output "ws: $($page.webSocketDebuggerUrl)"
