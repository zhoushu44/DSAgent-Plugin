# 启动 DSH 宿主（DeepSeek Harness），等待初始化后验证进程/端口/日志
$exe = 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
Write-Output "=== launching: $exe ==="
Start-Process -FilePath $exe
Write-Output '=== waiting 18s for boot ==='
Start-Sleep -Seconds 18
Write-Output '=== processes ==='
Get-Process | Where-Object { $_.ProcessName -match 'DeepSeek|Harness|dsh' } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200
Write-Output '=== port 4173 ==='
(Test-NetConnection -ComputerName 127.0.0.1 -Port 4173 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Output '=== harness.log tail (fresh?) ==='
Get-Content 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs\harness.log' -Tail 6
