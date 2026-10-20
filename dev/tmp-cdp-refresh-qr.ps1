# CDP WebSocket 连到 pdd 登录页，Runtime.evaluate 点击「点击刷新」刷新二维码
$port = (Get-Content 'C:\Users\Administrator\.dsh\browser-profiles\pdd_mms\DevToolsActivePort')[0].Trim()
$tabs = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 5
$page = $tabs | Where-Object { $_.url -match 'mms.pinduoduo.com' -and $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { Write-Output 'pdd tab not found'; exit 1 }

Add-Type -AssemblyName System.Net.Http
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $cts.Token).Wait()

function Send-CDP($ws, $method, $params) {
  $id = [System.Guid]::NewGuid().ToString('N').Substring(0,6)
  $msg = @{ id = 1; method = $method; params = $params } | ConvertTo-Json -Compress -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $seg = New-Object System.ArraySegment[byte] (,$bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
  # 读响应
  $buf = New-Object byte[] 65536
  $segR = New-Object System.ArraySegment[byte] (,$buf)
  $sb = New-Object System.Text.StringBuilder
  do {
    $res = $ws.ReceiveAsync($segR, $cts.Token).Result
    $sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $res.Count)) | Out-Null
  } while (-not $res.EndOfMessage)
  return $sb.ToString()
}

# 点击「点击刷新」——找含该文本的元素并点
$js = @'
(function(){
  var els = Array.from(document.querySelectorAll('div,span,button,a,p'));
  var btn = els.find(function(e){ return e.textContent && e.textContent.trim() === '点击刷新'; });
  if (!btn) { btn = els.find(function(e){ return e.textContent && e.textContent.indexOf('点击刷新') >= 0; }); }
  if (!btn) return 'NOT_FOUND';
  btn.click();
  return 'CLICKED: ' + btn.tagName + ' | ' + btn.textContent.trim();
})()
'@
$resp = Send-CDP $ws 'Runtime.evaluate' @{ expression = $js; returnByValue = $true }
Write-Output "CLICK result: $resp"
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts.Token).Wait()
