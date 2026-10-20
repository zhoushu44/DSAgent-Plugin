# DeepSeek Harness 的 app.asar 里有 desktop-runtime.json（2.8MB），很可能打包了 DSH Desktop 的运行时。
# 查 app-update.yml 看更新源，并解析 asar 文件表找 desktop-runtime 相关文件名
Write-Output '=== app-update.yml ==='
Get-Content 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app-update.yml'
Write-Output '=== app.asar.unpacked\dsh ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar.unpacked\dsh' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 20 FullName, Length | Format-Table -AutoSize | Out-String -Width 250
