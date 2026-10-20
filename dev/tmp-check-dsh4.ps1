Write-Output '=== dsh-desktop-updater pending mtime ==='
Get-Item 'C:\Users\Administrator\AppData\Local\dsh-desktop-updater\pending\dsh-desktop-windows-x64-setup.exe' -ErrorAction SilentlyContinue | Select-Object Name, LastWriteTime, Length | Format-List
Get-ChildItem 'C:\Users\Administrator\AppData\Local\dsh-desktop-updater' -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, LastWriteTime | Format-Table -AutoSize | Out-String -Width 250
Write-Output '=== Roaming dsh-desktop 关键文件 mtime ==='
Get-Item 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\DevToolsActivePort','C:\Users\Administrator\AppData\Roaming\dsh-desktop\window-state.json','C:\Users\Administrator\AppData\Roaming\dsh-desktop\logs\harness.log' | Select-Object Name, LastWriteTime | Format-Table -AutoSize
Write-Output '=== 全盘搜索 DSH Desktop.exe（D盘 Program Files + AppData）==='
Get-ChildItem 'D:\Program Files','C:\Users\Administrator\AppData\Local\Programs' -Recurse -Depth 2 -Filter 'DSH Desktop.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
Get-ChildItem 'D:\' -Filter 'DSH Desktop.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
Write-Output '=== registry uninstall DSH ==='
Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'DSH|Harness' } | Select-Object DisplayName, InstallLocation, DisplayVersion | Format-List
