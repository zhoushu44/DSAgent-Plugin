# 挂起 browser_login 直到登录完成落库（TimeoutSec 600，不提前断开）
$body = '{"action":"browser_login","platform":"pdd_mms","accountId":"pdd_mms_3b422bc6631bd52b245db96bde9e1002","loginUrl":"https://mms.pinduoduo.com/login"}'
Write-Output ("REQ @ {0}  (挂起等待扫码，最多10分钟)" -f (Get-Date).ToString('HH:mm:ss'))
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 600 -UseBasicParsing -ErrorAction Stop
  Write-Output ("RETURNED @ {0}  STATUS {1}" -f (Get-Date).ToString('HH:mm:ss'), $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("browser_login ERR @ {0}: {1}" -f (Get-Date).ToString('HH:mm:ss'), $_.Exception.Message.Split([char]10)[0])
}
Write-Output '=== 落库核验 ==='
$body2 = '{"action":"list_accounts"}'
$r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body2 -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
($r2.Content | ConvertFrom-Json).rows | Where-Object { $_.accountId -match '3b422bc' } | ForEach-Object { Write-Output ("status={0}" -f $_.status) }
Write-Output ("cred mtime: {0}" -f (Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime)
