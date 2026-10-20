$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut('C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\DSH Desktop.lnk')
Write-Output "Target: $($lnk.TargetPath)"
Write-Output "Args: $($lnk.Arguments)"
Write-Output "WorkDir: $($lnk.WorkingDirectory)"
