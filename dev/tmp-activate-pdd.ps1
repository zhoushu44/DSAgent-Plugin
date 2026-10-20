$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
$page = $tabs | Where-Object { $_.url -match 'mms.pinduoduo.com' -and $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { Write-Output 'pdd page tab not found'; exit }
Write-Output "tab id: $($page.id)  url: $($page.url)"
# Page.captureScreenshot via CDP 需要 WebSocket；改用最简单的 HTTP 截图不可用。
# 退而求其次：激活该标签 + 聚焦窗口，再读一次 url 判断是否跳离登录页
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/activate/$($page.id)" -TimeoutSec 5 | Out-Null
  Write-Output 'tab activated (brought to front)'
} catch { Write-Output "activate err: $($_.Exception.Message)" }
