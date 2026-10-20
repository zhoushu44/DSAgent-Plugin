# 1) browser_login 是同步阻塞，先看它是否已返回（再发一次会不会撞 operation 复用而立即返回缓存结果）
$body = '{"action":"browser_login","platform":"pdd_mms","accountId":"pdd_mms_3b422bc6631bd52b245db96bde9e1002","loginUrl":"https://mms.pinduoduo.com/login"}'
Write-Output '=== 再调 browser_login（幂等，应返回已完成的 operation 结果）==='
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop
  Write-Output ("STATUS {0}" -f $r.StatusCode)
  Write-Output $r.Content
} catch {
  Write-Output ("browser_login ERR/timeout: {0}" -f $_.Exception.Message.Split([char]10)[0])
}
Write-Output ''
Write-Output '=== 强制刷新后再读账号状态 ==='
$body2 = '{"action":"list_accounts","refresh":true}'
$r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body2 -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
$obj2 = $r2.Content | ConvertFrom-Json
$obj2.rows | Where-Object { $_.accountId -match '3b422bc' } | ForEach-Object { Write-Output ("status={0}" -f $_.status) }
Write-Output ("cred file mtime: {0}" -f (Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime)
