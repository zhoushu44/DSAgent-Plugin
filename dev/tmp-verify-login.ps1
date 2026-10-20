$body = '{"action":"list_accounts"}'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
$obj = $r.Content | ConvertFrom-Json
Write-Output '=== 3b422bc 账号状态 ==='
$obj.rows | Where-Object { $_.accountId -match '3b422bc' } | ForEach-Object {
  Write-Output ("status={0}  platform={1}  authType={2}" -f $_.status, $_.platform, $_.authType)
}
Write-Output '=== 凭证库文件 mtime ==='
(Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime
Write-Output '=== pdd 登录页当前 URL（跳离 login 即成功）==='
$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
$tabs | Where-Object { $_.url -match 'pinduoduo' } | ForEach-Object { Write-Output ("[{0}] {1}" -f $_.type, $_.url) }
