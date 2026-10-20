Write-Output '=== waiting 25s more for full boot ==='
Start-Sleep -Seconds 25
Write-Output '=== window titles ==='
Get-Process | Where-Object { $_.ProcessName -match 'DeepSeek|Harness|dsh|electron' } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200
Write-Output '=== port 4173 ==='
(Test-NetConnection -ComputerName 127.0.0.1 -Port 4173 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Output '=== other candidate ports (3000/5173/8080/9000/9230) ==='
foreach ($p in 3000,5173,8080,9000,9230) { "{0}: {1}" -f $p, (Test-NetConnection -ComputerName 127.0.0.1 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded }
Write-Output '=== fresh log lines (today) ==='
$today = (Get-Date).ToString('yyyy-MM-dd')
Get-Content 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs\harness.log' | Where-Object { $_ -match $today } | Select-Object -Last 8
