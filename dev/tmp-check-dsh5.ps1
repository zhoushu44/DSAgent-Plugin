# DSH Desktop 的 lnk 指向 D:\Program Files\DSH Desktop\DSH Desktop.exe，但该文件已丢失（目录只剩 resources\app.asar）。
# registry 只有 DeepSeek Harness（不同应用）。查 pending 安装包版本号，并看 D 盘是否有备份目录。
Write-Output '=== DeepSeek Harness version file ==='
Get-ChildItem 'C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object FullName | Select-Object -First 15 | Format-Table -AutoSize | Out-String -Width 250
Write-Output '=== DeepSeek Harness app.asar 内 package.json 版本（读 asar 头）==='
$f = [System.IO.File]::OpenRead('C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar')
$buf = New-Object byte[] 100
$f.Read($buf, 0, 100) | Out-Null
$f.Close()
[System.Text.Encoding]::ASCII.GetString($buf)
