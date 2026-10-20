$ids = (Get-Process | Where-Object { $_.ProcessName -match 'DeepSeek|Harness|dsh' }).Id
Write-Output "PIDs: $($ids -join ',')"
Write-Output '=== listening ports owned by these PIDs ==='
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess }
$conns | Select-Object LocalAddress, LocalPort, OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize
Write-Output '=== logs dir all files ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime, Length | Format-Table -AutoSize
Write-Output '=== logs dir subdirs ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Get-ChildItem $_.FullName | Sort-Object LastWriteTime -Descending | Select-Object -First 3 @{n='Dir';e={$_.Directory.Name}}, Name, LastWriteTime } | Format-Table -AutoSize
