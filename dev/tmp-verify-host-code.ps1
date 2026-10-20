Write-Output '=== 宿主加载的 browser-login.js（快照）是否含判据收紧 ==='
$snap = 'C:\Users\Administrator\AppData\Roaming\dsh-desktop\harness\profiles\.generations\live'
Get-ChildItem $snap -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $cand = Join-Path $_.FullName 'node_modules\@dsagent\dsagent-plugin\lib\browser-login.js'
  if (Test-Path $cand) {
    $txt = Get-Content $cand -Raw
    Write-Output ("{0} :: mtime={1}" -f $_.Name, (Get-Item $cand).LastWriteTime)
    Write-Output ("  含判据收紧注释: {0}" -f ($txt -match '判据收紧'))
    Write-Output ("  含 isLoginLikeUrl: {0}" -f ($txt -match 'isLoginLikeUrl'))
    Write-Output ("  含 isOffLoginPage: {0}" -f ($txt -match 'isOffLoginPage'))
    Write-Output ("  含 baselineJar: {0}" -f ($txt -match 'baselineJar'))
  }
}
Write-Output '=== 是否弹出了 pdd 登录窗口（chromium/chrome 进程标题含 pinduoduo/login/商家）==='
Get-Process | Where-Object { $_.MainWindowTitle -match '拼多多|pinduoduo|登录|商家|login' } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200
