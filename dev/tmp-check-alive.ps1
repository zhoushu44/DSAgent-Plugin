# 先确认浏览器/登录页现状，再发起挂起的 browser_login（10分钟超时，等你扫码）
Write-Output '=== 当前 pdd 页 ==='
try {
  $port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort' -ErrorAction Stop)[0].Trim()
  $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 4
  $tabs | Where-Object { $_.url -match 'pinduoduo' -and $_.type -eq 'page' } | ForEach-Object { Write-Output ("alive: {0}" -f $_.url) }
} catch { Write-Output "browser gone: $($_.Exception.Message)" }
