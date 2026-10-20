$body = '{"action":"list_accounts"}'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
  $obj = $r.Content | ConvertFrom-Json
  Write-Output ("ok={0} count={1}" -f $obj.ok, $obj.accounts.Count)
  $obj.accounts | Where-Object { $_.accountId -match '3b422bc' -or $_.platform -match 'pdd' } | ForEach-Object {
    Write-Output ("--- {0} | {1} | status={2} | {3}" -f $_.platform, $_.accountId, $_.status, $_.displayLabel)
  }
} catch {
  Write-Output ("ERR: {0}" -f $_.Exception.Message)
}
