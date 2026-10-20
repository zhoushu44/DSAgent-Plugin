Write-Output '=== 所有 chrome/chromium/edge 类进程（doBrowserLogin 拉起的 CDP 浏览器）==='
Get-Process | Where-Object { $_.ProcessName -match 'chrome|chromium|msedge' } | Select-Object Id, ProcessName, MainWindowTitle, StartTime | Sort-Object StartTime -Descending | Select-Object -First 12 | Format-Table -AutoSize | Out-String -Width 200
Write-Output '=== 最近 60s 内新起的进程（找登录浏览器）==='
$cut = (Get-Date).AddSeconds(-90)
Get-Process | Where-Object { $_.StartTime -gt $cut } | Select-Object Id, ProcessName, MainWindowTitle, StartTime | Format-Table -AutoSize | Out-String -Width 200
Write-Output '=== pdd profile 锁/目录 ==='
Get-ChildItem 'C:\Users\Administrator\.dsh' -ErrorAction SilentlyContinue | Select-Object Name, LastWriteTime | Format-Table -AutoSize
Get-ChildItem 'C:\Users\Administrator\.dsh' -Recurse -Depth 1 -Filter '*pdd*' -ErrorAction SilentlyContinue | Select-Object FullName, LastWriteTime | Select-Object -First 10 | Format-Table -AutoSize | Out-String -Width 250
