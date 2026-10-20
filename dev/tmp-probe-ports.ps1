Write-Output '=== probe candidate API on 19387 / 24032 ==='
foreach ($port in 19387, 24032) {
  foreach ($path in '/', '/dsagent/api', '/api', '/health', '/dsagent/health') {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
      Write-Output ("{0}{1} -> {2} len={3} body[0:200]={4}" -f $port, $path, $r.StatusCode, $r.RawContentLength, ($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length))))
    } catch {
      Write-Output ("{0}{1} -> ERR {2}" -f $port, $path, $_.Exception.Message.Split([char]10)[0])
    }
  }
}
