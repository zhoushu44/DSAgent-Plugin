$body = '{"action":"list_accounts"}'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:19387/dsagent/api' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
  Write-Output "=== RAW (first 1500 chars) ==="
  Write-Output $r.Content.Substring(0, [Math]::Min(1500, $r.Content.Length))
  Write-Output ""
  Write-Output "=== keys ==="
  $obj = $r.Content | ConvertFrom-Json
  $obj.PSObject.Properties.Name | ForEach-Object { Write-Output "key: $_" }
  if ($obj.rows) { Write-Output "rows count: $($obj.rows.Count)" }
  if ($obj.list) { Write-Output "list count: $($obj.list.Count)" }
  if ($obj.items) { Write-Output "items count: $($obj.items.Count)" }
} catch {
  Write-Output ("ERR: {0}" -f $_.Exception.Message)
}
