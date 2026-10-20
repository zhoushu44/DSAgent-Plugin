$p = Get-CimInstance Win32_Process -Filter "ProcessId=16108"
Write-Output '=== PID 16108 command line ==='
Write-Output $p.CommandLine
