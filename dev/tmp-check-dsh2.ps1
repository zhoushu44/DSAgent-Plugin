# 查看 DSH Desktop 磁盘重组情况：D:\Program Files\DSH Desktop 只剩 resources\app.asar
# 疑似某次自更新把主程序移走/重组了，DSH Desktop.exe 不在 lnk 指向的位置。
# 检查 1) app.asar 内主入口 2) 是否有 Local AppData 下的新版程序 3) Roaming 日志里的启动记录
Write-Output '=== Roaming dsh-desktop logs ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime, Length | Format-Table -AutoSize
Write-Output '=== AppData Programs 下所有 DSH 相关 ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Local\Programs' -Directory -ErrorAction SilentlyContinue | ForEach-Object Name
Write-Output '=== pending 安装包签名时间 ==='
Get-Item 'C:\Users\Administrator\AppData\Local\@deepseek-aidsh-desktop-updater\pending\deepseek-harness-0.2.0-rc.2-win-x64.exe' | Select-Object Name, LastWriteTime, Length | Format-List
