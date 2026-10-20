# 用 save_cookie 把活着的 Cookie 回写进连接器（不扫码，直接落库为 valid）
$json = Get-Content 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\tmp-pdd-cookies.json' -Raw | ConvertFrom-Json
$cookieStr = $json.cookieStr
$bodyObj = @{ action = 'save_cookie'; platform = 'pdd_mms'; cookieStr = $cookieStr }
$body = $bodyObj | ConvertTo-Json -Compress
Write-Output ("cookieStr len: {0}" -f $cookieStr.Length)
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 15 -UseBasicParsing
Write-Output ("STATUS {0}" -f $r.StatusCode)
Write-Output $r.Content
Write-Output '=== 回读后核验 ==='
$body2 = '{"action":"list_accounts"}'
$r2 = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body2 -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
($r2.Content | ConvertFrom-Json).rows | Where-Object { $_.platform -match 'pdd' } | ForEach-Object {
  Write-Output ("{0}  status={1}  label={2}" -f $_.shopKey, $_.status, $_.displayLabel)
}
