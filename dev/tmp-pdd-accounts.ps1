$body = '{"action":"list_accounts"}'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
$obj = $r.Content | ConvertFrom-Json
Write-Output '=== 全部拼多多账号 ==='
$obj.rows | Where-Object { $_.platform -match 'pdd' } | ForEach-Object {
  $_ | Format-List
  Write-Output '---'
}
Write-Output '=== 全字段名 ==='
$obj.rows[0].PSObject.Properties.Name
