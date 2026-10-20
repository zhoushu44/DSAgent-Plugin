# 直接调起 pdd_mms 登录（与账号连接页「扫码登录」同一条 doBrowserLogin 内核链路）
# account 3b422bc6631bd52b245db96bde9e1002，loginUrl mms.pinduoduo.com/login
$body = @{
  action = 'browser_login'
  platform = 'pdd_mms'
  accountId = 'pdd_mms_3b422bc6631bd52b245db96bde9e1002'
  loginUrl = 'https://mms.pinduoduo.com/login'
} | ConvertTo-Json -Compress
Write-Output "REQ body: $body"
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
  Write-Output ("STATUS: {0}" -f $r.StatusCode)
  Write-Output ("RESP: {0}" -f $r.Content)
} catch {
  Write-Output ("ERR: {0}" -f $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Output ("DETAIL: {0}" -f $_.ErrorDetails.Message) }
}
