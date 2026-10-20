Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$sig = @'
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
Add-Type -TypeDefinition $sig
$proc = Get-Process | Where-Object { $_.MainWindowTitle -match '拼多多|商家后台' } | Select-Object -First 1
if ($proc) {
  [W2]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
  [W2]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 900
  Write-Output "focused window: $($proc.MainWindowTitle)"
}
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\tmp-pdd-qr2.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved: $out"
