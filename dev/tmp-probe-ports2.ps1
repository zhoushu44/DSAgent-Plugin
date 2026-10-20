Write-Output '=== session.json ==='
Get-Content 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\desktop-service\session.json' -ErrorAction SilentlyContinue
Write-Output ''
Write-Output '=== outbox ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\desktop-service\outbox' -ErrorAction SilentlyContinue | Select-Object -First 10 Name, Length
Write-Output '=== try with common headers ==='
foreach ($port in 19387,24032) {
  foreach ($h in @(@{k='Authorization';v='Bearer test'}, @{k='X-DSAgent-Token';v=''}, @{k='Content-Type';v='application/json'})) {
    $hdr = @{}
    if ($h.v -ne '') { $hdr[$h.k] = $h.v } else { $hdr[$h.k] = 'x' }
    try {
      $body = '{"action":"browser_login"}'
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/dsagent/api" -Method POST -Body $body -ContentType 'application/json' -Headers $hdr -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
      Write-Output ("POST {0} {1} -> {2} : {3}" -f $port, $h.k, $r.StatusCode, $r.Content.Substring(0,[Math]::Min(150,$r.Content.Length)))
    } catch {
      $msg = $_.Exception.Message.Split([char]10)[0]
      Write-Output ("POST {0} {1} -> ERR {2}" -f $port, $h.k, $msg)
    }
  }
}
