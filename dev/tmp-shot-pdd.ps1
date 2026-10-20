Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
# 聚焦拼多多窗口到前台
$sig = @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
Add-Type -TypeDefinition $sig -ReferencedAssemblies 'System.Drawing'
$proc = Get-Process -Id 16108 -ErrorAction SilentlyContinue
if ($proc) {
  [W]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
  [W]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 800
}
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\tmp-pdd-login-screen.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved: $out"
