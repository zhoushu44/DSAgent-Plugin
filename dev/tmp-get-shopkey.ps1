$body = '{"action":"list_accounts"}'
$r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing
$obj = $r.Content | ConvertFrom-Json
$obj.rows | Where-Object { $_.accountId -match '3b422bc' -or $_.shopKey -match '3b422bc' } | ForEach-Object {
  $_ | ConvertTo-Json -Depth 6
}
