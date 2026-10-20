$f = 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort'
Write-Output "exists: $(Test-Path $f)"
if (Test-Path $f) {
  $c = Get-Content $f
  Write-Output "port: $($c[0])"
  Write-Output "wsPath: $($c[1])"
  $port = $c[0].Trim()
  Write-Output '=== CDP /json/list (tabs) ==='
  try {
    $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
    $tabs | ForEach-Object { Write-Output ("[{0}] {1} :: {2}" -f $_.type, $_.title, $_.url) }
  } catch { Write-Output ("ERR: {0}" -f $_.Exception.Message) }
}
