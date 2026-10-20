# 重发 browser_login 并长时等待完成（不再客户端超时断开），让它走完落库闭环
$body = '{"action":"browser_login","platform":"pdd_mms","accountId":"pdd_mms_3b422bc6631bd52b245db96bde9e1002","loginUrl":"https://mms.pinduoduo.com/login"}'
Write-Output ("REQ @ {0}" -f (Get-Date).ToString('HH:mm:ss'))
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 180 -UseBasicParsing -ErrorAction Stop
  Write-Output ("DONE @ {0}  STATUS {1}" -f (Get-Date).ToString('HH:mm:ss'), $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("browser_login ERR: {0}" -f $_.Exception.Message.Split([char]10)[0])
}
Write-Output '=== 立即核验落库 ==='
$body2 = '{"action":"list_accounts"}'
$r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body2 -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
($r2.Content | ConvertFrom-Json).rows | Where-Object { $_.accountId -match '3b422bc' } | ForEach-Object { Write-Output ("status={0}" -f $_.status) }
Write-Output ("cred mtime: {0}" -f (Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime)
