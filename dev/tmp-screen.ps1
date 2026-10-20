Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\tmp-screen.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved: $out  $($bounds.Width)x$($bounds.Height)"
Write-Output '=== all visible windows (recheck) ==='
Get-Process | Where-Object MainWindowTitle -ne '' | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 220
