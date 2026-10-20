Write-Output '=== 拼多多/登录相关窗口现状 ==='
Get-Process | Where-Object { $_.MainWindowTitle -match '拼多多|登录|商家|pinduoduo|扫码' } | Select-Object Id, ProcessName, MainWindowTitle, StartTime | Format-Table -AutoSize | Out-String -Width 220
Write-Output '=== dsagent-accounts.json 当前 mtime（再写入=登录成功落库）==='
(Get-Item 'C:\Users\Administrator\.dsh\dsagent-accounts.json').LastWriteTime
Write-Output '=== pdd_mms profile 目录最近活动 ==='
Get-ChildItem 'C:\Users\Administrator\.dsh\browser-profiles' -Directory -ErrorAction SilentlyContinue | Where-Object Name -match 'mms|pdd' | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime | Format-Table -AutoSize
