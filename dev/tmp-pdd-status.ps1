$body = '{"action":"list_accounts"}'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
$obj = $r.Content | ConvertFrom-Json
Write-Output '=== pdd / pdd_mms 账号状态 ==='
$obj.rows | Where-Object { $_.platform -match 'pdd' } | ForEach-Object {
  Write-Output ("platform={0}  status={1}  accountId={2}  shopKey={3}" -f $_.platform, $_.status, $_.accountId, $_.shopKey)
}
Write-Output ''
Write-Output '=== 目标账号 3b422bc ==='
$tgt = $obj.rows | Where-Object { $_.accountId -match '3b422bc' }
if ($tgt) { $tgt | Format-List } else { Write-Output '3b422bc NOT in rows' }
