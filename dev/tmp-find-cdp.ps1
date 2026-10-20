Write-Output '=== 找 doBrowserLogin 拉起的 chrome 的 CDP 端口 ==='
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome' -and $_.CommandLine -match 'remote-debugging-port' }
$procs | ForEach-Object {
  $port = ([regex]::Match($_.CommandLine, 'remote-debugging-port=(\d+)')).Groups[1].Value
  $prof = ([regex]::Match($_.CommandLine, 'user-data-dir=([^\s"]+|"[^"]+")')).Groups[1].Value
  Write-Output ("PID={0}  port={1}  profile={2}" -f $_.ProcessId, $port, $prof)
}
if (-not $procs) { Write-Output 'no chrome with remote-debugging-port found' }
